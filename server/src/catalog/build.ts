// One catalog build for one account (runs in a worker thread, see worker.ts):
//   1. raw data per enabled source: from the per-source cache when fresh (12 h catalog, 6 h EPG),
//      otherwise fetched (Xtream / M3U / XMLTV), masked and written to the cache;
//   2. lazily loaded Xtream episodes (cat_series) are put back into their raw series;
//   3. buildCatalog() from the shared core (same engine as the apps);
//   4. everything is written to catalog.db in ONE transaction (readers keep the old version
//      until the commit);
//   5. optional TMDB enrichment (shared cache); when it found something, steps 3-4 again.
import type { DatabaseSync } from 'node:sqlite';
import {
	analyzeRaw,
	buildCatalog,
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
	type Catalog,
	type Channel,
	type EpgProgramme,
	type Masker,
	type RawCatalog,
	type RawEpisode,
	type RawSeries,
	type StreamVariant,
	type Title,
	type TmdbIndex
} from './core.ts';
import { checkpoint, openCatalogDb, packJson, tx } from './db.ts';
import { toSourceError } from './fetch.ts';
import {
	EPG_PAST,
	epgCandidates,
	loadM3U,
	loadXmltv,
	loadXtream,
	type FetchLimits,
	type LoadedCatalog
} from './providers.ts';
import {
	cacheAge,
	readCatalogCache,
	readEpgCache,
	sourceDir,
	writeCatalogCache,
	writeEpgCache,
	type CachedCatalog
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
}

export type BuildEvent =
	| { type: 'progress'; phase: string; ratio: number }
	| { type: 'source'; id: string; status: Record<string, unknown> }
	| { type: 'built'; builtAt: number; version: number; counts: CatalogCounts }
	| { type: 'warn'; message: string };

export interface CatalogCounts {
	movies: number;
	series: number;
	channels: number;
	programmes: number;
}

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

// ---- masking --------------------------------------------------------------------------------

/**
 * Masks credentials in every stream url (not in images, see sanitizeImage). Mutates in place:
 * copying 50.000 items would double the peak memory of a build.
 */
export function maskStreams(cat: LoadedCatalog, m: Masker): LoadedCatalog {
	if (m.noop) return cat;
	cat.epgUrls = cat.epgUrls.map(m.mask);
	for (const x of cat.movies) x.url = m.mask(x.url);
	for (const s of cat.series) if (s.episodes) for (const e of s.episodes) e.url = m.mask(e.url);
	for (const c of cat.channels) {
		c.url = m.mask(c.url);
		if (c.altUrls) c.altUrls = c.altUrls.map(m.mask);
	}
	return cat;
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

// ---- writing --------------------------------------------------------------------------------

function listCol(values: string[]): string {
	return values.length ? `|${values.join('|')}|` : '';
}

function countBy<T>(items: T[], keys: (t: T) => string[]): Map<string, number> {
	const m = new Map<string, number>();
	for (const it of items) for (const k of keys(it)) m.set(k, (m.get(k) ?? 0) + 1);
	return m;
}

function metaFor(titles: Title[], channels: Channel[], programmes: number) {
	const genres = [...countBy(titles, (t) => t.genres)]
		.map(([name, count]) => ({ slug: genreSlugOf(name), name, count }))
		.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
	const languages = [...countBy(titles, (t) => t.languages.filter((l) => l !== 'und'))]
		.map(([lang, count]) => ({ lang, count }))
		.sort((a, b) => b.count - a.count || a.lang.localeCompare(b.lang));
	const groups = [...countBy(channels, (c) => [c.group])]
		.map(([name, count]) => ({ name, count }))
		.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
	return {
		counts: {
			movies: titles.filter((t) => t.kind === 'movie').length,
			series: titles.filter((t) => t.kind === 'series').length,
			channels: channels.length,
			programmes
		},
		genres,
		languages,
		groups
	};
}

export type CatalogMetaJson = ReturnType<typeof metaFor> & { kids: ReturnType<typeof metaFor> };

/** Columns + card for one title row (also used after a lazy series load). */
export function titleRow(t: Title) {
	const card = toTitleCard(t);
	const search = {
		t: t.title,
		o: t.originalTitle,
		a: t.altTitles.map((a) => a.title),
		c: t.cast.slice(0, 15).map((p) => p.name),
		d: t.director,
		g: t.genres
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

/** Writes a complete catalog for one account in one transaction. Returns the new version. */
export function writeCatalog(
	db: DatabaseSync,
	accountId: string,
	catalog: Catalog,
	lazy: Map<string, LazyRef[]>,
	passwords: string[]
): number {
	const programmes = Object.values(catalog.epg).reduce((n, l) => n + l.length, 0);
	const kidsTitles = catalog.titles.filter((t) => t.kidsSafe === true);
	const kidsChannels = catalog.channels.filter((c) => isKidsChannelGroup(c.group));
	const meta: CatalogMetaJson = {
		...metaFor(catalog.titles, catalog.channels, programmes),
		kids: metaFor(kidsTitles, kidsChannels, programmes)
	};
	return tx(db, () => {
		for (const t of ['cat_titles', 'cat_details', 'cat_variants', 'cat_channels', 'cat_epg'])
			db.prepare(`DELETE FROM ${t} WHERE account_id = ?`).run(accountId);
		const insTitle = db.prepare(
			`INSERT OR REPLACE INTO cat_titles (account_id, id, kind, sort_title, year, popularity, added_at, kids,
			 has_overview, genres, langs, card, search) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		);
		const insDetail = db.prepare(
			'INSERT OR REPLACE INTO cat_details (account_id, id, data) VALUES (?, ?, ?)'
		);
		const insVariant = db.prepare(
			'INSERT OR REPLACE INTO cat_variants (account_id, id, source_id, url, alt) VALUES (?, ?, ?, ?, ?)'
		);
		const insChannel = db.prepare(
			`INSERT OR REPLACE INTO cat_channels (account_id, id, pos, grp, kids, langs, epg_id, card, data)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
		);
		const insEpg = db.prepare(
			`INSERT INTO cat_epg (account_id, epg_id, start, stop, title, desc, category, icon)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
		);
		const variant = (v: StreamVariant & { altUrls?: string[] }) =>
			insVariant.run(
				accountId,
				v.id,
				v.sourceId,
				v.url,
				v.altUrls?.length ? JSON.stringify(v.altUrls) : null
			);

		for (const raw of catalog.titles) {
			const t: StoredTitle = {
				...raw,
				posterUrl: sanitizeImage(raw.posterUrl, passwords),
				backdropUrl: sanitizeImage(raw.backdropUrl, passwords),
				logoUrl: sanitizeImage(raw.logoUrl, passwords)
			};
			if (t.seasons)
				for (const s of t.seasons)
					for (const e of s.episodes) e.stillUrl = sanitizeImage(e.stillUrl, passwords);
			const refs = lazy.get(t.id);
			if (refs?.length) t._lazy = refs;
			const r = titleRow(t);
			insTitle.run(
				accountId,
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
			insDetail.run(accountId, t.id, packJson(t));
			for (const v of titleVariants(t)) variant(v);
		}
		catalog.channels.forEach((raw, pos) => {
			const c: Channel = { ...raw, logoUrl: sanitizeImage(raw.logoUrl, passwords) };
			insChannel.run(
				accountId,
				c.id,
				pos,
				c.group,
				isKidsChannelGroup(c.group) ? 1 : 0,
				listCol(c.languages),
				c.epgId ?? null,
				JSON.stringify(toChannelCard(c)),
				JSON.stringify(c)
			);
			for (const v of c.variants) variant(v);
		});
		for (const [epgId, list] of Object.entries(catalog.epg))
			for (const p of list)
				insEpg.run(
					accountId,
					epgId,
					p.start,
					p.stop,
					p.title,
					p.desc ?? null,
					p.category ?? null,
					p.icon ?? null
				);
		const prev = db
			.prepare('SELECT version FROM cat_state WHERE account_id = ?')
			.get(accountId) as { version: number } | undefined;
		const version = Number(prev?.version ?? 0) + 1;
		db.prepare(
			`INSERT INTO cat_state (account_id, built_at, version, meta, error) VALUES (?, ?, ?, ?, NULL)
			 ON CONFLICT (account_id) DO UPDATE SET built_at = excluded.built_at, version = excluded.version,
			 meta = excluded.meta, error = NULL`
		).run(accountId, catalog.builtAt, version, JSON.stringify(meta));
		return version;
	});
}

// ---- the build ------------------------------------------------------------------------------

function statsOf(c: Pick<CachedCatalog, 'movies' | 'series' | 'channels'>, programmes: number) {
	return {
		movies: c.movies.length,
		series: c.series.length,
		channels: c.channels.length,
		programmes
	};
}

async function loadSource(
	job: BuildJob,
	src: ResolvedSource,
	emit: (e: BuildEvent) => void,
	now: number
): Promise<RawCatalog | null> {
	const dir = sourceDir(job.dataDir, job.accountId, src.id);
	const secrets = secretList(src);
	const masker = createMasker(secrets);
	const force = job.force.includes('*') || job.force.includes(src.id);
	const status: Record<string, unknown> = {};
	const warnings: string[] = [];
	let base: CachedCatalog | undefined;

	const age = await cacheAge(dir, 'catalog');
	const fresh = !force && age !== undefined && age < job.ttl.catalogMs;
	if (fresh) base = await readCatalogCache(dir);
	if (!base) {
		try {
			emit({ type: 'progress', phase: `source:${src.id}`, ratio: 0 });
			const loaded =
				src.type === 'xtream'
					? await loadXtream(src, job.limits, (step, ratio) =>
							emit({ type: 'progress', phase: `source:${src.id}:${step}`, ratio })
						)
					: await loadM3U(src, job.limits);
			const masked = maskStreams(loaded, masker);
			base = {
				v: 1,
				savedAt: Date.now(),
				epgUrls: masked.epgUrls,
				account: loaded.account as Record<string, unknown> | undefined,
				warnings: masked.warnings,
				movies: masked.movies,
				series: masked.series,
				channels: masked.channels
			};
			await writeCatalogCache(dir, base);
			warnings.push(...loaded.warnings);
			status.lastSyncAt = base.savedAt;
			status.lastError = null;
			status.errorCode = null;
			if (loaded.account) {
				const a = loaded.account;
				status.account = {
					status: a.status,
					expiresAt: a.expiresAt,
					maxConnections: a.maxConnections,
					activeConnections: a.activeConnections,
					isTrial: a.isTrial
				};
			}
		} catch (err) {
			const e = toSourceError(err, secrets);
			status.lastError = e.message;
			status.errorCode = e.code;
			if (e.expiresAt) status.account = { status: 'Expired', expiresAt: e.expiresAt };
			// Stale cache keeps the library working while the provider is down.
			base = await readCatalogCache(dir);
			if (!base) {
				emit({ type: 'source', id: src.id, status });
				return null;
			}
		}
	}

	// EPG (own TTL; failures are warnings).
	let epg: EpgProgramme[] = [];
	const lower = now - EPG_PAST;
	const epgAge = await cacheAge(dir, 'epg');
	const epgFresh = !force && epgAge !== undefined && epgAge < job.ttl.epgMs;
	const cachedEpg = epgFresh ? await readEpgCache(dir, lower) : undefined;
	if (cachedEpg) epg = cachedEpg;
	else {
		const ids = new Set<string>();
		for (const c of base.channels) if (c.tvgId) ids.add(c.tvgId);
		if (ids.size) {
			try {
				emit({ type: 'progress', phase: `epg:${src.id}`, ratio: 0 });
				const urls = epgCandidates(src, base.epgUrls.map(masker.unmask));
				epg = await loadXmltv(src, urls, ids, job.limits, now);
				await writeEpgCache(dir, epg);
				status.epgSyncAt = Date.now();
			} catch (err) {
				warnings.push(`EPG: ${toSourceError(err, secrets).message}`);
				epg = (await readEpgCache(dir, lower)) ?? [];
			}
		}
	}
	status.stats = statsOf(base, epg.length);
	status.lastWarning = warnings.length ? warnings.join(' · ').slice(0, 400) : null;
	emit({ type: 'source', id: src.id, status });
	return {
		sourceId: src.id,
		movies: base.movies,
		series: base.series,
		channels: base.channels,
		epg,
		fetchedAt: base.savedAt
	};
}

/** Puts cached lazy episodes back into their raw series (so rebuilds keep seasons). */
function injectEpisodes(db: DatabaseSync, job: BuildJob, raws: RawCatalog[], now: number) {
	const rows = db
		.prepare('SELECT source_id, provider_id, data FROM cat_series WHERE account_id = ? AND fetched_at > ?')
		.all(job.accountId, now - job.ttl.seriesMs) as {
		source_id: string;
		provider_id: string;
		data: string;
	}[];
	if (!rows.length) return;
	const byKey = new Map(rows.map((r) => [`${r.source_id}\u0001${r.provider_id}`, r.data]));
	for (const raw of raws) {
		raw.series = raw.series.map((s) => {
			if (s.episodes) return s;
			const data = byKey.get(`${s.sourceId}\u0001${s.providerId}`);
			if (!data) return s;
			const { info, episodes } = JSON.parse(data) as {
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
function lazyRefs(catalog: Catalog, raws: RawCatalog[], job: BuildJob): Map<string, LazyRef[]> {
	const xtream = new Set(job.sources.filter((s) => s.type === 'xtream').map((s) => s.id));
	const rawSeries = new Map<string, RawSeries>();
	for (const raw of raws)
		if (xtream.has(raw.sourceId))
			for (const s of raw.series) if (!s.episodes) rawSeries.set(`${s.sourceId}\u0001${s.providerId}`, s);
	const out = new Map<string, LazyRef[]>();
	if (!rawSeries.size) return out;
	for (const t of catalog.titles) {
		if (t.kind !== 'series') continue;
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

export async function runBuild(
	job: BuildJob,
	emit: (e: BuildEvent) => void,
	dbIn?: DatabaseSync
): Promise<CatalogCounts> {
	const db = dbIn ?? openCatalogDb(job.catalogDbPath);
	try {
		const now = Date.now();
		const raws: RawCatalog[] = [];
		const real = job.sources.filter((s) => s.enabled && s.type !== 'sample');
		for (let i = 0; i < real.length; i++) {
			emit({ type: 'progress', phase: 'sources', ratio: i / Math.max(1, real.length) });
			const raw = await loadSource(job, real[i], emit, now);
			if (raw) raws.push(raw);
		}
		if (job.sources.some((s) => s.enabled && s.type === 'sample')) {
			const demo = sampleCatalogs(now);
			raws.push(...demo);
			const stats = { movies: 0, series: 0, channels: 0, programmes: 0 };
			for (const d of demo) {
				stats.movies += d.movies.length;
				stats.series += d.series.length;
				stats.channels += d.channels.length;
				stats.programmes += d.epg.length;
			}
			emit({ type: 'source', id: 'sample', status: { lastSyncAt: now, lastError: null, stats } });
		}
		injectEpisodes(db, job, raws, now);
		// Xtream live: the MPEG-TS twin of an .m3u8 stream becomes an alt url (played via /v1/play).
		for (const raw of raws)
			for (const ch of raw.channels)
				if (!ch.altUrls?.length) {
					const ts = liveTsUrl(ch.url);
					if (ts) ch.altUrls = [ts];
				}

		const passwords = job.sources.flatMap((s) => (s.password ? [s.password] : []));
		const names: Record<string, string> = { ...SAMPLE_SOURCE_NAMES };
		for (const s of job.sources) names[s.id] = s.name;
		const tmdbIndex: TmdbIndex | undefined =
			job.tmdb || hasTmdbData(db) ? sqliteTmdbIndex(db) : undefined;
		const build = () => {
			emit({ type: 'progress', phase: 'merge', ratio: 0.8 });
			return buildCatalog(raws, {
				sourceNames: names,
				preferLang: job.preferLang,
				tmdb: tmdbIndex,
				now
			});
		};
		let catalog = build();
		const lazy = lazyRefs(catalog, raws, job);
		// Without TMDB the raw lists are not needed any more: free them before writing (peak RSS).
		if (!job.tmdb) raws.length = 0;
		emit({ type: 'progress', phase: 'write', ratio: 0.9 });
		let version = writeCatalog(db, job.accountId, catalog, lazy, passwords);
		let counts = countsOf(db, job.accountId);
		emit({ type: 'built', builtAt: catalog.builtAt, version, counts });

		if (job.tmdb && tmdbIndex) {
			emit({ type: 'progress', phase: 'tmdb', ratio: 0.95 });
			let changed = false;
			try {
				await enrichTitles({
					apiKey: job.tmdb.apiKey,
					lang: job.preferLang,
					titles: catalog.titles,
					index: tmdbIndex,
					maxTitles: job.tmdb.maxTitles,
					client: new TmdbClient(job.tmdb.apiKey, { cache: sqliteTmdbCache(db) }),
					skipSource: isSampleSourceId,
					onBatch: (_i, c) => {
						if (c) changed = true;
					}
				});
			} catch (err) {
				emit({ type: 'warn', message: `TMDB: ${(err as Error).message}` });
			}
			if (changed) {
				catalog = build();
				version = writeCatalog(db, job.accountId, catalog, lazyRefs(catalog, raws, job), passwords);
				counts = countsOf(db, job.accountId);
				emit({ type: 'built', builtAt: catalog.builtAt, version, counts });
			}
		}
		checkpoint(db);
		return counts;
	} finally {
		if (!dbIn) db.close();
	}
}

function countsOf(db: DatabaseSync, accountId: string): CatalogCounts {
	const r = db.prepare('SELECT meta FROM cat_state WHERE account_id = ?').get(accountId) as
		| { meta: string }
		| undefined;
	return r ? (JSON.parse(r.meta) as CatalogMetaJson).counts : { movies: 0, series: 0, channels: 0, programmes: 0 };
}
