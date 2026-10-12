// One catalog build for one account (runs in a worker thread, see worker.ts). Built to scale to
// providers with hundreds of thousands of items inside a small memory budget:
//
//   1. Sources: when the per-source cache is stale (12 h), the provider lists are streamed item by
//      item (masked) into cache/<account>/<source>/items.ndjson.gz; nothing is collected. The EPG
//      (6 h) streams from XMLTV (or its cache) straight into SQLite.
//   2. Movies, then series, then channels are merged ONE KIND AT A TIME with buildCatalog() from
//      the shared core (matching never crosses kinds), reading only that kind from the cache.
//      Each kind's raw items are released before the next kind is loaded.
//   3. Rows are written in batches (transactions of ~5.000) under a new generation key
//      (`<accountId>@<gen>`); readers keep using the previous generation. One small transaction
//      at the end flips cat_state to the new generation, then the old one is deleted.
//      A failed build deletes its staging rows: the previous catalog stays available.
//   4. Optional TMDB enrichment afterwards (shared cache, from the stored cards); when it finds
//      something, the service queues one follow-up build that uses the new ids.
import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import {
	analyzeRaw,
	buildCatalog,
	buildChannels,
	createMasker,
	enrichTitles,
	foldText,
	genreSlug,
	isKidsChannelGroup,
	isSampleSourceId,
	liveTsUrl,
	sampleCatalogs,
	SAMPLE_SOURCE_NAMES,
	slugify,
	TmdbClient,
	toChannelCard,
	toTitleCard,
	urlHasSecrets,
	type Channel,
	type EpgProgramme,
	type Masker,
	type RawCatalog,
	type RawChannel,
	type RawEpisode,
	type RawMovie,
	type RawSeries,
	type StreamVariant,
	type Title
} from './core.ts';
import { checkpoint, compact, deleteGeneration, genKey, openCatalogDb, packJson } from './db.ts';
import { toSourceError } from './fetch.ts';
import {
	EPG_PAST,
	epgCandidates,
	loadM3U,
	loadXmltv,
	loadXtream,
	type FetchLimits,
	type ItemSink
} from './providers.ts';
import {
	CACHE_VERSION,
	epgAge,
	epgPath,
	itemsPath,
	NdjsonWriter,
	readEpg,
	readItems,
	readMeta,
	sourceDir,
	writeMeta,
	type CatalogMetaFile,
	type ItemKind,
	type ReadStats
} from './rawcache.ts';
import { secretList, type ResolvedSource } from './sources.ts';
import { hasTmdbData, sqliteTmdbCache, sqliteTmdbIndex } from './tmdb.ts';

export interface BuildJob {
	accountId: string;
	dataDir: string;
	catalogDbPath: string;
	/** Enabled sources (secrets resolved, in memory only). `sample` = the demo library. */
	sources: ResolvedSource[];
	/** Bypass the cache for these source ids ('*' = all). */
	force: string[];
	preferLang: string;
	limits: FetchLimits;
	ttl: { catalogMs: number; epgMs: number; seriesMs: number };
	tmdb?: { apiKey: string; maxTitles: number };
	/** Raw items merged at once (tests); default BATCH_ITEMS. */
	batchItems?: number;
}

export interface CatalogCounts {
	movies: number;
	series: number;
	channels: number;
	programmes: number;
}

export type BuildEvent =
	| { type: 'progress'; phase: string; ratio: number }
	| { type: 'source'; id: string; status: Record<string, unknown> }
	| { type: 'built'; builtAt: number; version: number; counts: CatalogCounts }
	| { type: 'tmdb'; changed: boolean }
	| { type: 'warn'; message: string };

/** Lazy series reference (Xtream episodes not loaded yet), kept in the detail row. */
export interface LazyRef {
	sourceId: string;
	providerId: string;
	audio: string[];
	subs: string[];
	quality: StreamVariant['quality'];
	seriesTitle: string;
}

export type StoredTitle = Title & { _lazy?: LazyRef[]; _lazyFailedAt?: number };

const BATCH = 5000;
/** Raw items merged at once (whole match groups; a bigger group makes a bigger batch). */
const BATCH_ITEMS = 25_000;

// ---- small helpers ----------------------------------------------------------------------------

/** Masks credentials in the stream urls of one raw item, in place (images are not masked). */
export function maskItem(kind: ItemKind, item: RawMovie | RawSeries | RawChannel, m: Masker) {
	if (m.noop) return;
	if (kind === 'm') (item as RawMovie).url = m.mask((item as RawMovie).url);
	else if (kind === 's') {
		for (const e of (item as RawSeries).episodes ?? []) e.url = m.mask(e.url);
	} else {
		const c = item as RawChannel;
		c.url = m.mask(c.url);
		if (c.altUrls) c.altUrls = c.altUrls.map(m.mask);
	}
}

export function maskEpisodes(eps: RawEpisode[], m: Masker): RawEpisode[] {
	return m.noop ? eps : eps.map((e) => ({ ...e, url: m.mask(e.url) }));
}

/** Image urls go to devices as-is; drop the rare ones that carry credentials. */
export function sanitizeImage(url: string | undefined, passwords: string[]): string | undefined {
	if (!url) return undefined;
	if (urlHasSecrets(url)) return undefined;
	for (const p of passwords) if (p.length >= 4 && url.includes(p)) return undefined;
	return url;
}

export function genreSlugOf(name: string): string {
	return genreSlug(name) ?? `g-${slugify(name) || 'x'}`;
}

function listCol(values: string[]): string {
	return values.length ? `|${values.join('|')}|` : '';
}

/** Columns + card for one title row (also used after a lazy series load). */
export function titleRow(t: Title) {
	const card = toTitleCard(t);
	// Only what the card does not have already (title, alt titles and genres come from the card).
	const search = {
		c: t.cast.slice(0, 15).map((p) => p.name),
		d: t.director,
		// For TMDB enrichment from stored rows.
		i: t.tmdbId,
		s: t.sourceIds
	};
	return {
		kind: t.kind,
		sortTitle: foldText(t.title) || t.title.toLowerCase(),
		year: t.year ?? 0,
		popularity: t.popularity,
		addedAt: t.addedAt,
		kids: t.kidsSafe === true ? 1 : 0,
		hasOverview: t.overview ? 1 : 0,
		genres: listCol(t.genres.map(genreSlugOf)),
		langs: listCol(t.languages),
		card: JSON.stringify(card),
		search: JSON.stringify(search)
	};
}

export function titleVariants(t: Title): StreamVariant[] {
	if (t.kind === 'movie') return t.variants;
	return t.seasons?.flatMap((s) => s.episodes.flatMap((e) => e.variants)) ?? [];
}

// ---- meta (counts, genres, languages, groups), accumulated while writing ----------------------

class Facets {
	movies = 0;
	series = 0;
	channels = 0;
	genres = new Map<string, number>();
	languages = new Map<string, number>();
	groups = new Map<string, number>();

	title(t: Title) {
		if (t.kind === 'movie') this.movies++;
		else this.series++;
		for (const g of t.genres) this.genres.set(g, (this.genres.get(g) ?? 0) + 1);
		for (const l of t.languages)
			if (l !== 'und') this.languages.set(l, (this.languages.get(l) ?? 0) + 1);
	}

	channel(c: Channel) {
		this.channels++;
		this.groups.set(c.group, (this.groups.get(c.group) ?? 0) + 1);
	}

	json(programmes: number) {
		const sorted = <K extends string>(m: Map<string, number>, key: K) =>
			[...m]
				.map(([k, count]) => ({ [key]: k, count }) as Record<K, string> & { count: number })
				.sort((a, b) => b.count - a.count || a[key].localeCompare(b[key]));
		return {
			counts: { movies: this.movies, series: this.series, channels: this.channels, programmes },
			genres: sorted(this.genres, 'name').map((g) => ({
				slug: genreSlugOf(g.name),
				name: g.name,
				count: g.count
			})),
			languages: sorted(this.languages, 'lang'),
			groups: sorted(this.groups, 'name')
		};
	}
}

export type CatalogMetaJson = ReturnType<Facets['json']> & { kids: ReturnType<Facets['json']> };

// ---- batched writer for one generation ------------------------------------------------------

class GenerationWriter {
	readonly key: string;
	#db: DatabaseSync;
	#n = 0;
	#open = false;
	#title: StatementSync;
	#detail: StatementSync;
	#variant: StatementSync;
	#channel: StatementSync;
	#epg: StatementSync;
	#exists: StatementSync;
	facets = new Facets();
	kidsFacets = new Facets();

	passwords: string[];

	constructor(db: DatabaseSync, key: string, passwords: string[]) {
		this.#db = db;
		this.key = key;
		this.passwords = passwords;
		this.#title = db.prepare(
			`INSERT OR REPLACE INTO cat_titles (account_id, id, kind, sort_title, year, popularity, added_at, kids,
			 has_overview, genres, langs, card, search) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		);
		this.#detail = db.prepare(
			'INSERT OR REPLACE INTO cat_details (account_id, id, data) VALUES (?, ?, ?)'
		);
		this.#variant = db.prepare(
			'INSERT OR REPLACE INTO cat_variants (account_id, id, source_id, url, alt) VALUES (?, ?, ?, ?, ?)'
		);
		this.#channel = db.prepare(
			`INSERT OR REPLACE INTO cat_channels (account_id, id, pos, grp, kids, langs, epg_id, card, data)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
		);
		this.#epg = db.prepare(
			`INSERT OR IGNORE INTO cat_epg (account_id, epg_id, start, stop, title, desc, category, icon)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
		);
		this.#exists = db.prepare('SELECT 1 FROM cat_titles WHERE account_id = ? AND id = ?');
	}

	#tick() {
		if (!this.#open) {
			this.#db.exec('BEGIN IMMEDIATE');
			this.#open = true;
		}
		if (++this.#n >= BATCH) this.flush();
	}

	flush() {
		if (this.#open) this.#db.exec('COMMIT');
		this.#open = false;
		this.#n = 0;
	}

	abort() {
		if (this.#open) this.#db.exec('ROLLBACK');
		this.#open = false;
	}

	hasTitle(id: string): boolean {
		return !!this.#exists.get(this.key, id);
	}

	#variantRow(v: StreamVariant & { altUrls?: string[] }) {
		this.#variant.run(
			this.key,
			v.id,
			v.sourceId,
			v.url,
			v.altUrls?.length ? JSON.stringify(v.altUrls) : null
		);
	}

	title(raw: Title, lazy?: LazyRef[]) {
		const t: StoredTitle = {
			...raw,
			posterUrl: sanitizeImage(raw.posterUrl, this.passwords),
			backdropUrl: sanitizeImage(raw.backdropUrl, this.passwords),
			logoUrl: sanitizeImage(raw.logoUrl, this.passwords)
		};
		if (t.seasons)
			for (const s of t.seasons)
				for (const e of s.episodes) e.stillUrl = sanitizeImage(e.stillUrl, this.passwords);
		if (lazy?.length) t._lazy = lazy;
		const r = titleRow(t);
		this.#tick();
		this.#title.run(
			this.key,
			t.id,
			r.kind,
			r.sortTitle,
			r.year,
			r.popularity,
			r.addedAt,
			r.kids,
			r.hasOverview,
			r.genres,
			r.langs,
			r.card,
			r.search
		);
		this.#detail.run(this.key, t.id, packJson(t));
		for (const v of titleVariants(t)) this.#variantRow(v);
		this.facets.title(t);
		if (t.kidsSafe === true) this.kidsFacets.title(t);
	}

	channel(raw: Channel, pos: number) {
		const c: Channel = { ...raw, logoUrl: sanitizeImage(raw.logoUrl, this.passwords) };
		const kids = isKidsChannelGroup(c.group);
		this.#tick();
		this.#channel.run(
			this.key,
			c.id,
			pos,
			c.group,
			kids ? 1 : 0,
			listCol(c.languages),
			c.epgId ?? null,
			JSON.stringify(toChannelCard(c)),
			JSON.stringify(c)
		);
		for (const v of c.variants) this.#variantRow(v);
		this.facets.channel(c);
		if (kids) this.kidsFacets.channel(c);
	}

	programme(p: EpgProgramme) {
		if (!p.channelId || !(p.stop > p.start)) return;
		this.#tick();
		this.#epg.run(
			this.key,
			p.channelId,
			p.start,
			p.stop,
			p.title,
			p.desc ?? null,
			p.category ?? null,
			p.icon ?? null
		);
	}

	/** Programme count per EPG id (what buildChannels needs to pick an epgId). */
	epgCounts(): Record<string, EpgProgramme[]> {
		const rows = this.#db
			.prepare('SELECT epg_id, COUNT(*) AS n FROM cat_epg WHERE account_id = ? GROUP BY epg_id')
			.all(this.key) as { epg_id: string; n: number }[];
		const out: Record<string, EpgProgramme[]> = {};
		// Sparse arrays: only `.length` is read.
		for (const r of rows) out[r.epg_id] = new Array(Number(r.n));
		return out;
	}

	programmes(): number {
		return Number(
			(
				this.#db.prepare('SELECT COUNT(*) AS n FROM cat_epg WHERE account_id = ?').get(this.key) as {
					n: number;
				}
			).n
		);
	}
}

// ---- sources ----------------------------------------------------------------------------------

interface ReadySource {
	src: ResolvedSource;
	dir: string;
	meta: CatalogMetaFile;
}

/** Refreshes one source's cache when stale and streams its EPG into the generation. */
async function syncSource(
	job: BuildJob,
	src: ResolvedSource,
	w: GenerationWriter,
	emit: (e: BuildEvent) => void,
	now: number
): Promise<ReadySource | null> {
	const dir = sourceDir(job.dataDir, job.accountId, src.id);
	const secrets = secretList(src);
	const masker = createMasker(secrets);
	const force = job.force.includes('*') || job.force.includes(src.id);
	const status: Record<string, unknown> = {};
	const warnings: string[] = [];
	let meta = await readMeta(dir);
	const fresh = !force && meta && now - meta.savedAt < job.ttl.catalogMs;

	if (!fresh) {
		const out = NdjsonWriter.create(itemsPath(dir));
		try {
			emit({ type: 'progress', phase: `source:${src.id}`, ratio: 0 });
			const sink: ItemSink = (kind, item) => {
				maskItem(kind, item, masker);
				out.write([kind, item]);
			};
			const r =
				src.type === 'xtream'
					? await loadXtream(src, job.limits, sink, (step, ratio) =>
							emit({ type: 'progress', phase: `source:${src.id}:${step}`, ratio })
						)
					: await loadM3U(src, job.limits, sink);
			await out.commit();
			meta = {
				v: CACHE_VERSION,
				savedAt: Date.now(),
				epgUrls: r.epgUrls.map(masker.mask),
				account: r.account as Record<string, unknown> | undefined,
				warnings: r.warnings,
				counts: r.counts
			};
			await writeMeta(dir, meta);
			warnings.push(...r.warnings);
			status.lastSyncAt = meta.savedAt;
			status.lastError = null;
			status.errorCode = null;
			if (r.account) {
				const a = r.account;
				status.account = {
					status: a.status,
					expiresAt: a.expiresAt,
					maxConnections: a.maxConnections,
					activeConnections: a.activeConnections,
					isTrial: a.isTrial
				};
			}
		} catch (err) {
			await out.abort();
			const e = toSourceError(err, secrets);
			status.lastError = e.message;
			status.errorCode = e.code;
			if (e.expiresAt) status.account = { status: 'Expired', expiresAt: e.expiresAt };
			// A stale cache keeps the library working while the provider is down.
			meta = await readMeta(dir);
			if (!meta) {
				emit({ type: 'source', id: src.id, status });
				return null;
			}
		}
	}

	// EPG: own TTL; straight from XMLTV (or its cache) into SQLite. Failures are warnings.
	const lower = now - EPG_PAST;
	const ids = new Set<string>();
	for await (const c of readItems<RawChannel>(dir, ['c'])) if (c.tvgId) ids.add(c.tvgId);
	let programmes = 0;
	if (ids.size) {
		const age = await epgAge(dir);
		const epgFresh = !force && age !== undefined && age < job.ttl.epgMs;
		let fromCache = epgFresh;
		if (!epgFresh) {
			let out: NdjsonWriter | undefined;
			try {
				emit({ type: 'progress', phase: `epg:${src.id}`, ratio: 0 });
				const urls = epgCandidates(src, meta!.epgUrls.map(masker.unmask));
				programmes = await loadXmltv(
					src,
					urls,
					ids,
					job.limits,
					(p) => {
						out!.write(p);
						w.programme(p);
					},
					() => {
						void out?.abort();
						out = NdjsonWriter.create(epgPath(dir));
						out.write({ v: CACHE_VERSION, savedAt: Date.now() });
					},
					now
				);
				if (out) await out.commit();
				status.epgSyncAt = Date.now();
			} catch (err) {
				await out?.abort();
				warnings.push(`EPG: ${toSourceError(err, secrets).message}`);
				fromCache = true;
			}
		}
		if (fromCache) {
			programmes = 0;
			for await (const p of readEpg<EpgProgramme>(dir, lower)) {
				w.programme(p);
				programmes++;
			}
		}
		w.flush();
	}
	status.stats = { ...meta!.counts, programmes };
	status.lastWarning = warnings.length ? warnings.join(' · ').slice(0, 400) : null;
	emit({ type: 'source', id: src.id, status });
	return { src, dir, meta: meta! };
}

/** Puts cached lazy episodes back into their raw series (so rebuilds keep seasons). */
function injectEpisodes(db: DatabaseSync, job: BuildJob, raws: RawCatalog[], now: number) {
	const get = db.prepare(
		'SELECT data FROM cat_series WHERE account_id = ? AND source_id = ? AND provider_id = ? AND fetched_at > ?'
	);
	const any = db
		.prepare('SELECT 1 FROM cat_series WHERE account_id = ? AND fetched_at > ? LIMIT 1')
		.get(job.accountId, now - job.ttl.seriesMs);
	if (!any) return;
	for (const raw of raws) {
		raw.series = raw.series.map((s) => {
			if (s.episodes) return s;
			const row = get.get(job.accountId, s.sourceId, s.providerId, now - job.ttl.seriesMs) as
				| { data: string }
				| undefined;
			if (!row) return s;
			const { info, episodes } = JSON.parse(row.data) as {
				info: Partial<RawSeries>;
				episodes: RawEpisode[];
			};
			const out: RawSeries = { ...s, episodes };
			for (const [k, v] of Object.entries(info ?? {}))
				if (v != null && (out as unknown as Record<string, unknown>)[k] == null)
					(out as unknown as Record<string, unknown>)[k] = v;
			return out;
		});
	}
}

/** Lazy refs per title: raw Xtream series whose episodes are not loaded yet. */
function lazyRefs(titles: Title[], raws: RawCatalog[], job: BuildJob): Map<string, LazyRef[]> {
	const xtream = new Set(job.sources.filter((s) => s.type === 'xtream').map((s) => s.id));
	const rawSeries = new Map<string, RawSeries>();
	for (const raw of raws)
		if (xtream.has(raw.sourceId))
			for (const s of raw.series)
				if (!s.episodes) rawSeries.set(`${s.sourceId}\u0001${s.providerId}`, s);
	const out = new Map<string, LazyRef[]>();
	if (!rawSeries.size) return out;
	for (const t of titles) {
		const refs: LazyRef[] = [];
		for (const ref of t.rawRefs) {
			const raw = rawSeries.get(`${ref.sourceId}\u0001${ref.providerId}`);
			if (!raw) continue;
			const a = analyzeRaw(raw, { preferLang: job.preferLang });
			refs.push({
				sourceId: ref.sourceId,
				providerId: ref.providerId,
				audio: a.audio,
				subs: a.subs,
				quality: a.quality,
				seriesTitle: a.parsed.cleanTitle
			});
		}
		if (refs.length) out.set(t.id, refs);
	}
	return out;
}

/** Id of a series that collides with a movie id (only possible for shared imdb ids). */
function renameTitle(t: Title, id: string): Title {
	const old = t.id;
	return {
		...t,
		id,
		seasons: t.seasons?.map((s) => ({
			...s,
			episodes: s.episodes.map((e) => ({ ...e, id: id + e.id.slice(old.length) }))
		}))
	};
}

/**
 * Raw items of one kind from every ready source (+ demo), in a fixed order. `keep(index)`
 * selects a subset by the item's position in that order (used for batches).
 */
async function rawsOf<T>(
	ready: ReadySource[],
	kind: ItemKind,
	demo: RawCatalog[],
	keep: (index: number) => boolean = () => true
): Promise<RawCatalog[]> {
	const out: RawCatalog[] = [];
	let index = 0;
	const pick = (items: T[]) => items.filter(() => keep(index++));
	const field = kind === 'm' ? 'movies' : kind === 's' ? 'series' : 'channels';
	for (const r of ready) {
		const items: T[] = [];
		for await (const it of readItems<T>(r.dir, [kind])) if (keep(index++)) items.push(it);
		out.push({
			sourceId: r.src.id,
			movies: [],
			series: [],
			channels: [],
			epg: [],
			fetchedAt: r.meta.savedAt,
			[field]: items
		});
	}
	for (const d of demo)
		out.push({ ...d, movies: [], series: [], channels: [], epg: [], [field]: pick(d[field] as T[]) });
	return out;
}

/** 53-bit hash of a string (two FNV-1a variants). Collisions only make partitions coarser. */
function hash53(s: string): number {
	let h1 = 0x811c9dc5;
	let h2 = 0x01000193 ^ s.length;
	for (let i = 0; i < s.length; i++) {
		const c = s.charCodeAt(i);
		h1 = Math.imul(h1 ^ c, 16777619);
		h2 = Math.imul(h2 ^ c, 2246822519);
	}
	return (h1 >>> 0) * 2097152 + ((h2 >>> 0) & 0x1fffff);
}

/**
 * Splits the titles of one kind into batches that can be merged independently. Items are
 * connected when they share anything the matcher looks at (tmdb id, imdb id, a title key, or a
 * weak key that equals a title key); a connected group always lands in one batch, so merging a
 * batch gives the same titles as merging everything at once, at a fraction of the memory.
 * Only compact per-item data is kept (hashes in a Map, an Int32Array union-find).
 */
async function partition(
	ready: ReadySource[],
	kind: 'm' | 's',
	demo: RawCatalog[],
	opts: Parameters<typeof analyzeRaw>[1],
	batchItems: number,
	stats?: ReadStats
): Promise<{ batchOf: Uint16Array; batches: number; count: number }> {
	let parent = new Int32Array(1 << 16);
	let n = 0;
	const first = new Map<number, number>();
	const find = (i: number): number => {
		while (parent[i] !== i) {
			parent[i] = parent[parent[i]];
			i = parent[i];
		}
		return i;
	};
	const link = (key: string, i: number) => {
		const h = hash53(key);
		const j = first.get(h);
		if (j === undefined) first.set(h, i);
		else {
			const a = find(i);
			const b = find(j);
			if (a !== b) parent[a] = b;
		}
	};
	const add = (raw: RawMovie | RawSeries) => {
		if (n === parent.length) {
			const next = new Int32Array(parent.length * 2);
			next.set(parent);
			parent = next;
		}
		const i = n++;
		parent[i] = i;
		const a = analyzeRaw(raw, opts);
		if (a.tmdbId) link(`t|${a.tmdbId}`, i);
		if (a.imdbId) link(`i|${a.imdbId}`, i);
		for (const k of a.keys) if (k) link(`k|${k}`, i);
		for (const k of a.weakKeys) if (k) link(`k|${k}`, i);
	};
	for (const r of ready)
		for await (const it of readItems<RawMovie | RawSeries>(r.dir, [kind], stats)) add(it);
	for (const d of demo) for (const it of kind === 'm' ? d.movies : d.series) add(it);
	first.clear();

	const batchOf = new Uint16Array(n);
	const compBatch = new Map<number, number>();
	const compSize = new Map<number, number>();
	for (let i = 0; i < n; i++) {
		const r = find(i);
		compSize.set(r, (compSize.get(r) ?? 0) + 1);
	}
	let batch = 0;
	let filled = 0;
	for (let i = 0; i < n; i++) {
		const r = find(i);
		let b = compBatch.get(r);
		if (b === undefined) {
			const size = compSize.get(r)!;
			if (filled > 0 && filled + size > batchItems && batch < 65534) {
				batch++;
				filled = 0;
			}
			b = batch;
			compBatch.set(r, b);
			filled += size;
		}
		batchOf[i] = b;
	}
	return { batchOf, batches: n ? batch + 1 : 0, count: n };
}

/** A title id that is already taken (another batch or kind) gets a numbered suffix. */
function uniqueTitle(w: GenerationWriter, t: Title): Title {
	if (!w.hasTitle(t.id)) return t;
	let n = 2;
	while (w.hasTitle(`${t.id}-${n}`)) n++;
	return renameTitle(t, `${t.id}-${n}`);
}

// ---- the build --------------------------------------------------------------------------------

export async function runBuild(
	job: BuildJob,
	emit: (e: BuildEvent) => void,
	dbIn?: DatabaseSync
): Promise<CatalogCounts> {
	const db = dbIn ?? openCatalogDb(job.catalogDbPath);
	const gen = Date.now().toString(36) + randomBytes(3).toString('hex');
	const key = genKey(job.accountId, gen);
	const passwords = job.sources.flatMap((s) => (s.password ? [s.password] : []));
	const w = new GenerationWriter(db, key, passwords);
	try {
		// Leftovers of an interrupted build (never the active generation).
		const active = db.prepare('SELECT gen FROM cat_state WHERE account_id = ?').get(job.accountId) as
			| { gen: string | null }
			| undefined;
		deleteGeneration(db, job.accountId, undefined, active?.gen ?? undefined);

		const now = Date.now();
		const real = job.sources.filter((s) => s.enabled && s.type !== 'sample');
		const ready: ReadySource[] = [];
		for (let i = 0; i < real.length; i++) {
			emit({ type: 'progress', phase: 'sources', ratio: (i / Math.max(1, real.length)) * 0.5 });
			const r = await syncSource(job, real[i], w, emit, now);
			if (r) ready.push(r);
		}
		const demo = job.sources.some((s) => s.enabled && s.type === 'sample')
			? sampleCatalogs(now)
			: [];
		if (demo.length) {
			const stats = { movies: 0, series: 0, channels: 0, programmes: 0 };
			for (const d of demo) {
				stats.movies += d.movies.length;
				stats.series += d.series.length;
				stats.channels += d.channels.length;
				stats.programmes += d.epg.length;
				for (const p of d.epg) w.programme(p);
				d.epg = [];
			}
			w.flush();
			emit({ type: 'source', id: 'sample', status: { lastSyncAt: now, lastError: null, stats } });
		}

		const names: Record<string, string> = { ...SAMPLE_SOURCE_NAMES };
		for (const s of job.sources) names[s.id] = s.name;
		const tmdb = job.tmdb || hasTmdbData(db) ? sqliteTmdbIndex(db) : undefined;
		const opts = { sourceNames: names, preferLang: job.preferLang, tmdb, now };

		// Cache lines that do not parse are skipped (counted once, in the partition pass).
		const unreadable: ReadStats = { skipped: 0, lines: [] };

		// Movies, then series: in batches of independent title groups (see partition()).
		for (const [kind, phase, ratio] of [
			['m', 'movies', 0.55],
			['s', 'series', 0.7]
		] as const) {
			emit({ type: 'progress', phase, ratio });
			const { batchOf, batches } = await partition(
				ready,
				kind,
				demo,
				opts,
				job.batchItems ?? BATCH_ITEMS,
				unreadable
			);
			for (let b = 0; b < batches; b++) {
				let raws = await rawsOf<RawMovie | RawSeries>(ready, kind, demo, (i) => batchOf[i] === b);
				if (kind === 's') injectEpisodes(db, job, raws, now);
				const titles = buildCatalog(raws, opts).titles;
				const lazy = kind === 's' ? lazyRefs(titles, raws, job) : undefined;
				raws = [];
				for (let i = 0; i < titles.length; i++) {
					const t = uniqueTitle(w, titles[i]);
					w.title(t, lazy?.get(titles[i].id));
					titles[i] = undefined as unknown as Title; // let GC take written titles
				}
				w.flush();
				emit({ type: 'progress', phase, ratio: ratio + (0.15 * (b + 1)) / batches });
			}
		}

		// Channels (EPG ids chosen with the programme counts already in SQLite).
		emit({ type: 'progress', phase: 'channels', ratio: 0.85 });
		{
			let raws = await rawsOf<RawChannel>(ready, 'c', demo);
			for (const raw of raws)
				for (const ch of raw.channels)
					if (!ch.altUrls?.length) {
						// Xtream live: the MPEG-TS twin of an .m3u8 stream becomes an alt url.
						const ts = liveTsUrl(ch.url);
						if (ts) ch.altUrls = [ts];
					}
			const channels = buildChannels(raws, w.epgCounts());
			raws = [];
			channels.forEach((c, pos) => w.channel(c, pos));
			w.flush();
		}

		if (unreadable.skipped)
			emit({
				type: 'warn',
				message: `${unreadable.skipped} onleesbare item(s) overgeslagen (regels ${unreadable.lines.join(', ')})`
			});

		// Flip to the new generation in one small transaction.
		emit({ type: 'progress', phase: 'write', ratio: 0.95 });
		const programmes = w.programmes();
		const meta: CatalogMetaJson = {
			...w.facets.json(programmes),
			kids: w.kidsFacets.json(programmes)
		};
		db.exec('BEGIN IMMEDIATE');
		let version: number;
		let oldGen: string | null = null;
		try {
			const prev = db
				.prepare('SELECT version, gen FROM cat_state WHERE account_id = ?')
				.get(job.accountId) as { version: number; gen: string | null } | undefined;
			version = Number(prev?.version ?? 0) + 1;
			oldGen = prev?.gen ?? null;
			db.prepare(
				`INSERT INTO cat_state (account_id, built_at, version, meta, gen, error, error_code, error_at)
				 VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL)
				 ON CONFLICT (account_id) DO UPDATE SET built_at = excluded.built_at, version = excluded.version,
				 meta = excluded.meta, gen = excluded.gen, error = NULL, error_code = NULL, error_at = NULL`
			).run(job.accountId, now, version, JSON.stringify(meta), gen);
			db.exec('COMMIT');
		} catch (err) {
			db.exec('ROLLBACK');
			throw err;
		}
		emit({ type: 'built', builtAt: now, version, counts: meta.counts });
		if (oldGen) deleteGeneration(db, job.accountId, oldGen);
		checkpoint(db);
		compact(db);

		if (job.tmdb && tmdb) await enrich(db, job, key, tmdb, emit);
		return meta.counts;
	} catch (err) {
		w.abort();
		try {
			deleteGeneration(db, job.accountId, gen);
		} catch {
			// best effort
		}
		throw friendlyError(err);
	} finally {
		if (!dbIn) db.close();
	}
}

/**
 * Build errors as shown in meta.error: no raw parser/zlib messages (they can contain data
 * fragments), but a clear text with an error code.
 */
export function friendlyError(err: unknown): Error {
	const e = err as { name?: string; code?: string; message?: string };
	const msg = String(e?.message ?? err);
	const code = String(e?.code ?? '');
	if (err instanceof SyntaxError || /JSON/i.test(msg))
		return Object.assign(new Error('De bron gaf ongeldige gegevens terug'), {
			code: 'invalid_response'
		});
	if (code.startsWith('Z_') || /unexpected end of file|incorrect header check/i.test(msg))
		return Object.assign(
			new Error('De opgeslagen gegevens van een bron zijn beschadigd; vernieuw de bron'),
			{ code: 'invalid_response' }
		);
	return err instanceof Error ? err : new Error(msg);
}

/** TMDB lookups for the most popular stored titles; the next build uses what it finds. */
async function enrich(
	db: DatabaseSync,
	job: BuildJob,
	key: string,
	index: ReturnType<typeof sqliteTmdbIndex>,
	emit: (e: BuildEvent) => void
) {
	emit({ type: 'progress', phase: 'tmdb', ratio: 0.97 });
	const rows = db
		.prepare(
			'SELECT id, kind, year, popularity, card, search FROM cat_titles WHERE account_id = ? ORDER BY popularity DESC LIMIT ?'
		)
		.all(key, job.tmdb!.maxTitles * 2) as {
		id: string;
		kind: Title['kind'];
		year: number;
		popularity: number;
		card: string;
		search: string;
	}[];
	const titles = rows.map((r) => {
		const s = JSON.parse(r.search) as { i?: number; s?: string[] };
		const c = JSON.parse(r.card) as Pick<Title, 'title' | 'originalTitle' | 'altTitles'>;
		return {
			id: r.id,
			kind: r.kind,
			title: c.title,
			originalTitle: c.originalTitle,
			altTitles: c.altTitles,
			year: r.year || undefined,
			tmdbId: s.i,
			popularity: r.popularity,
			sourceIds: s.s ?? []
		} as unknown as Title;
	});
	let changed = false;
	try {
		await enrichTitles({
			apiKey: job.tmdb!.apiKey,
			lang: job.preferLang,
			titles,
			index,
			maxTitles: job.tmdb!.maxTitles,
			client: new TmdbClient(job.tmdb!.apiKey, { cache: sqliteTmdbCache(db) }),
			skipSource: isSampleSourceId,
			onBatch: (_i, c) => {
				if (c) changed = true;
			}
		});
	} catch (err) {
		emit({ type: 'warn', message: `TMDB: ${(err as Error).message}` });
	}
	emit({ type: 'tmdb', changed });
}
