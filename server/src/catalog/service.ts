// Catalog service (main thread): queries over catalog.db, the in-memory LRU (max. 2 accounts:
// light title list + search index), lazy Xtream series, play-url rewriting and play lookups,
// the build queue and the refresh scheduler.
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { Config } from '../config.ts';
import { hmac, seal, unseal, type ServerKeys } from '../keys.ts';
import type { DeviceRow, Store } from '../store.ts';
import { sha256hex } from '../util.ts';
import type { BuildEvent, BuildJob, CatalogMetaJson, LazyRef, StoredTitle } from './build.ts';
import { maskEpisodes, sanitizeImage, titleRow, titleVariants } from './build.ts';
import {
	createMasker,
	featured,
	mergeSeriesEpisodes,
	popular,
	recent,
	recommend,
	SearchIndex,
	similarTitles,
	trending,
	type Channel,
	type EpgProgramme,
	type HistoryEntry,
	type Masker,
	type RawEpisode,
	type RawSeries,
	type StreamVariant,
	type Title
} from './core.ts';
import { openCatalogDb, packJson, purgeAccount, purgeSourceSeries, unpackJson } from './db.ts';
import { toSourceError } from './fetch.ts';
import { loadSeriesInfo, type FetchLimits } from './providers.ts';
import { BuildQueue, type AccountBuildStatus } from './queue.ts';
import { accountCacheDir, sourceDir } from './rawcache.ts';
import { secretList, SourceRepo, type ResolvedSource } from './sources.ts';

const HOUR = 3600_000;
const LRU_MAX = 2;

/** Light title kept in memory per account (recommend, similar, home rows). */
type Light = Title & { kids: boolean };

interface Loaded {
	version: number;
	light: Light[];
	byId: Map<string, Light>;
	search?: SearchIndex;
	searchKids?: SearchIndex;
}

export interface CatalogServiceOptions {
	config: Config;
	store: Store;
	keys: ServerKeys;
	sources: SourceRepo;
}

type Row = Record<string, unknown>;

export function b64url(s: string): string {
	return Buffer.from(s, 'utf8').toString('base64url');
}

export class CatalogService {
	readonly config: Config;
	readonly store: Store;
	readonly keys: ServerKeys;
	readonly sources: SourceRepo;
	readonly db: DatabaseSync;
	readonly dbPath: string;
	readonly queue: BuildQueue;
	#lru = new Map<string, Loaded>();
	#seriesJobs = new Map<string, Promise<StoredTitle>>();
	#maskers = new Map<string, { at: number; masker: Masker; src: ResolvedSource }>();
	#timer: ReturnType<typeof setInterval> | undefined;
	#startTimer: ReturnType<typeof setTimeout> | undefined;

	constructor(o: CatalogServiceOptions) {
		this.config = o.config;
		this.store = o.store;
		this.keys = o.keys;
		this.sources = o.sources;
		this.dbPath = join(o.config.dataDir, 'catalog.db');
		this.db = openCatalogDb(this.dbPath);
		this.db.exec('PRAGMA busy_timeout = 3000');
		this.queue = new BuildQueue(
			{
				makeJob: (accountId, force) => this.#makeJob(accountId, force),
				onEvent: (accountId, e) => this.#onEvent(accountId, e),
				onFinished: (accountId, error) => this.#onFinished(accountId, error)
			},
			{ inline: o.config.buildInline, memoryMb: o.config.buildMemoryMb }
		);
		if (o.config.catalogRefreshHours > 0) {
			this.#timer = setInterval(() => this.tick(), 10 * 60_000);
			this.#timer.unref();
			this.#startTimer = setTimeout(() => this.tick(), 60_000);
			this.#startTimer.unref();
		}
	}

	get limits(): FetchLimits {
		const c = this.config;
		return {
			allowPrivate: c.proxyAllowPrivate,
			timeoutMs: c.fetchTimeoutMs,
			userAgent: c.fetchUserAgent,
			m3uMaxBytes: c.m3uMaxBytes,
			jsonMaxBytes: c.jsonMaxBytes,
			xmltvMaxBytes: c.xmltvMaxBytes
		};
	}

	// ---- builds -------------------------------------------------------------------------

	#makeJob(accountId: string, force: string[]): BuildJob | null {
		if (!this.store.getAccount(accountId)) return null;
		const list = this.sources.list(accountId).filter((s) => s.enabled);
		const resolved: ResolvedSource[] = [];
		for (const rec of list) {
			try {
				resolved.push(this.sources.resolve(rec));
			} catch {
				this.sources.setStatus(accountId, rec.id, {
					lastError: 'Opgeslagen gegevens konden niet worden ontsleuteld (andere SERVER_KEY?)',
					errorCode: 'config'
				});
			}
		}
		return {
			accountId,
			dataDir: this.config.dataDir,
			catalogDbPath: this.dbPath,
			sources: resolved,
			force,
			preferLang: this.config.catalogLang,
			limits: this.limits,
			ttl: { catalogMs: 12 * HOUR, epgMs: 6 * HOUR, seriesMs: 12 * HOUR },
			tmdb: this.config.tmdbApiKey
				? { apiKey: this.config.tmdbApiKey, maxTitles: this.config.tmdbMaxTitles }
				: undefined
		};
	}

	#onEvent(accountId: string, e: BuildEvent) {
		if (e.type === 'source') {
			if (this.store.getAccount(accountId)) this.sources.setStatus(accountId, e.id, e.status);
		} else if (e.type === 'built') {
			this.#lru.delete(accountId);
		} else if (e.type === 'warn' && this.config.log) {
			console.warn(`[catalog] ${accountId}: ${e.message}`);
		}
	}

	#onFinished(accountId: string, error?: string) {
		if (error) {
			if (this.config.log) console.warn(`[catalog] build ${accountId} mislukt: ${error}`);
			this.db
				.prepare(
					`INSERT INTO cat_state (account_id, error) VALUES (?, ?)
					 ON CONFLICT (account_id) DO UPDATE SET error = excluded.error`
				)
				.run(accountId, error.slice(0, 500));
		}
		this.#lru.delete(accountId);
	}

	/** Queues a refresh. `force` true = every source, or the given source id. */
	refresh(accountId: string, opts: { force?: boolean; sourceId?: string } = {}): AccountBuildStatus {
		const force = opts.sourceId ? [opts.sourceId] : opts.force ? ['*'] : [];
		return this.queue.enqueue(accountId, force);
	}

	/** First request of an account without a catalog: build it. */
	ensureBuilt(accountId: string) {
		const st = this.state(accountId);
		if (!st && this.queue.status(accountId).state === 'idle') this.queue.enqueue(accountId);
	}

	/** Scheduler: refresh accounts with real sources every CATALOG_REFRESH_HOURS (spread). */
	tick(now = Date.now()) {
		const period = this.config.catalogRefreshHours * HOUR;
		if (!period) return;
		for (const { accountId, lastSeenAt } of this.sources.accountsWithSources()) {
			if (now - lastSeenAt > 30 * 24 * HOUR) continue; // inactive account: no upstream calls
			if (this.queue.status(accountId).state !== 'idle') continue;
			const builtAt = this.state(accountId)?.builtAt ?? 0;
			const jitter = parseInt(sha256hex('jitter:' + accountId).slice(0, 8), 16) % HOUR;
			if (now - builtAt > period + jitter) this.queue.enqueue(accountId);
		}
		this.purgeOldEpg(now);
	}

	purgeOldEpg(now = Date.now()) {
		try {
			this.db.prepare('DELETE FROM cat_epg WHERE stop < ?').run(now - 6 * HOUR);
		} catch {
			// busy: next tick
		}
	}

	/** Account deleted: catalog rows, caches and memory. */
	purgeAccount(accountId: string) {
		this.queue.forget(accountId);
		this.#lru.delete(accountId);
		try {
			purgeAccount(this.db, accountId);
		} catch (err) {
			console.warn('[catalog] purge failed', (err as Error).message);
		}
		rmSync(accountCacheDir(this.config.dataDir, accountId), { recursive: true, force: true });
	}

	/** Source removed or its credentials/urls changed: drop its caches. */
	purgeSource(accountId: string, sourceId: string) {
		this.#maskers.delete(`${accountId}:${sourceId}`);
		try {
			purgeSourceSeries(this.db, accountId, sourceId);
		} catch {
			// best effort
		}
		rmSync(sourceDir(this.config.dataDir, accountId, sourceId), { recursive: true, force: true });
	}

	// ---- state & memory ----------------------------------------------------------------

	state(accountId: string): { builtAt: number; version: number; meta?: CatalogMetaJson; error?: string } | undefined {
		const r = this.db.prepare('SELECT * FROM cat_state WHERE account_id = ?').get(accountId) as Row | undefined;
		if (!r) return undefined;
		return {
			builtAt: Number(r.built_at),
			version: Number(r.version),
			meta: r.meta ? (JSON.parse(String(r.meta)) as CatalogMetaJson) : undefined,
			error: r.error ? String(r.error) : undefined
		};
	}

	#loaded(accountId: string): Loaded {
		const version = this.state(accountId)?.version ?? 0;
		const hit = this.#lru.get(accountId);
		if (hit && hit.version === version) {
			this.#lru.delete(accountId);
			this.#lru.set(accountId, hit);
			return hit;
		}
		const rows = this.db
			.prepare(
				'SELECT id, kind, popularity, added_at, kids, has_overview, genres FROM cat_titles WHERE account_id = ?'
			)
			.all(accountId) as Row[];
		const light: Light[] = rows.map((r) => {
			const g = String(r.genres);
			return {
				id: String(r.id),
				kind: String(r.kind) as Title['kind'],
				popularity: Number(r.popularity),
				addedAt: Number(r.added_at),
				kids: Number(r.kids) === 1,
				kidsSafe: Number(r.kids) === 1,
				overview: Number(r.has_overview) ? '1' : undefined,
				genres: g ? g.slice(1, -1).split('|') : [],
				title: '',
				altTitles: [],
				cast: [],
				variants: [],
				languages: [],
				subtitleLanguages: [],
				qualities: [],
				sourceIds: [],
				rawRefs: []
			};
		});
		const loaded: Loaded = { version, light, byId: new Map(light.map((t) => [t.id, t])) };
		this.#lru.set(accountId, loaded);
		while (this.#lru.size > LRU_MAX) this.#lru.delete(this.#lru.keys().next().value!);
		return loaded;
	}

	#titlesFor(accountId: string, kids: boolean): Light[] {
		const l = this.#loaded(accountId).light;
		return kids ? l.filter((t) => t.kids) : l;
	}

	/** TitleCard JSON strings by id (unknown ids are skipped; order of `ids` kept). */
	cards(accountId: string, ids: string[], kids = false): string[] {
		const map = new Map<string, string>();
		for (let i = 0; i < ids.length; i += 200) {
			const chunk = ids.slice(i, i + 200);
			const rows = this.db
				.prepare(
					`SELECT id, card FROM cat_titles WHERE account_id = ? AND id IN (${chunk.map(() => '?').join(',')})${kids ? ' AND kids = 1' : ''}`
				)
				.all(accountId, ...chunk) as Row[];
			for (const r of rows) map.set(String(r.id), String(r.card));
		}
		const out: string[] = [];
		for (const id of ids) {
			const c = map.get(id);
			if (c) out.push(c);
		}
		return out;
	}

	// ---- queries ------------------------------------------------------------------------

	meta(accountId: string, kids: boolean) {
		this.ensureBuilt(accountId);
		const st = this.state(accountId);
		const q = this.queue.status(accountId);
		const m = st?.meta ? (kids ? st.meta.kids : st.meta) : undefined;
		const status =
			q.state !== 'idle' ? 'building' : st?.meta ? 'ready' : st?.error || q.error ? 'error' : 'empty';
		const out: Record<string, unknown> = {
			builtAt: st?.builtAt ?? 0,
			status,
			counts: m?.counts ?? { movies: 0, series: 0, channels: 0, programmes: 0 },
			genres: m?.genres ?? [],
			languages: m?.languages ?? [],
			groups: m?.groups ?? []
		};
		if (q.state !== 'idle') {
			out.progress = Math.round((q.progress ?? 0) * 100) / 100;
			if (q.phase) out.phase = q.phase.replace(/:.*$/, '');
		}
		const error = q.error ?? st?.error;
		if (error) out.error = error;
		return out;
	}

	home(accountId: string, kids: boolean, limit: number): string {
		this.ensureBuilt(accountId);
		const titles = this.#titlesFor(accountId, kids);
		const ids = (list: Title[]) => list.map((t) => t.id);
		const row = (list: Title[]) => `[${this.cards(accountId, ids(list)).join(',')}]`;
		const st = this.state(accountId);
		const m = st?.meta ? (kids ? st.meta.kids : st.meta) : undefined;
		const live = this.db
			.prepare(
				`SELECT card FROM cat_channels WHERE account_id = ?${kids ? ' AND kids = 1' : ''} ORDER BY pos LIMIT ?`
			)
			.all(accountId, limit) as Row[];
		return (
			`{"featured":${row(featured(titles, Math.min(limit, 8)))}` +
			`,"recent":${row(recent(titles, limit))}` +
			`,"popularMovies":${row(popular(titles, 'movie', limit))}` +
			`,"trendingSeries":${row(trending(titles, 'series', limit))}` +
			`,"genres":${JSON.stringify(m?.genres ?? [])}` +
			`,"live":[${live.map((r) => String(r.card)).join(',')}]}`
		);
	}

	titles(
		accountId: string,
		q: { kind?: string; genre?: string; lang?: string; sort: string; kids: boolean; limit: number; cursor?: string }
	): string {
		this.ensureBuilt(accountId);
		const where: string[] = ['account_id = ?'];
		const args: (string | number)[] = [accountId];
		if (q.kind === 'movie' || q.kind === 'series') {
			where.push('kind = ?');
			args.push(q.kind);
		}
		if (q.kids) where.push('kids = 1');
		if (q.genre) {
			where.push('genres LIKE ?');
			args.push(`%|${q.genre}|%`);
		}
		if (q.lang) {
			where.push('langs LIKE ?');
			args.push(`%|${q.lang}|%`);
		}
		const total = Number(
			(this.db.prepare(`SELECT COUNT(*) AS n FROM cat_titles WHERE ${where.join(' AND ')}`).get(...args) as Row).n
		);
		const sorts: Record<string, { col: string; dir: 'ASC' | 'DESC' }> = {
			popular: { col: 'popularity', dir: 'DESC' },
			new: { col: 'added_at', dir: 'DESC' },
			az: { col: 'sort_title', dir: 'ASC' },
			year: { col: 'year', dir: 'DESC' }
		};
		const s = sorts[q.sort] ?? sorts.popular;
		const cur = decodeCursor(q.cursor, q.sort);
		if (cur) {
			where.push(`(${s.col} ${s.dir === 'DESC' ? '<' : '>'} ? OR (${s.col} = ? AND id > ?))`);
			args.push(cur.k, cur.k, cur.i);
		}
		const rows = this.db
			.prepare(
				`SELECT id, card, ${s.col} AS k FROM cat_titles WHERE ${where.join(' AND ')}
				 ORDER BY ${s.col} ${s.dir}, id ASC LIMIT ?`
			)
			.all(...args, q.limit + 1) as Row[];
		const more = rows.length > q.limit;
		const page = rows.slice(0, q.limit);
		const last = page[page.length - 1];
		const next = more && last ? encodeCursor(q.sort, last.k as string | number, String(last.id)) : undefined;
		return (
			`{"items":[${page.map((r) => String(r.card)).join(',')}]` +
			(next ? `,"nextCursor":${JSON.stringify(next)}` : '') +
			`,"total":${total}}`
		);
	}

	titlesByIds(accountId: string, ids: string[], kids: boolean): string {
		const cards = this.cards(accountId, ids, kids);
		return `{"items":[${cards.join(',')}],"total":${cards.length}}`;
	}

	/** Full title with play urls and similar titles; lazy Xtream series are loaded first. */
	async title(
		accountId: string,
		id: string,
		kids: boolean,
		play: (v: StreamVariant) => StreamVariant
	): Promise<{ status: 200; body: string } | { status: 403 | 404; body?: undefined }> {
		this.ensureBuilt(accountId);
		let t = this.#detail(accountId, id);
		if (!t) return { status: 404 };
		if (kids && t.kidsSafe !== true) return { status: 403 };
		if (t.kind === 'series' && t._lazy?.length) t = await this.#ensureSeasons(accountId, t);
		const { _lazy, _lazyFailedAt, ...title } = t;
		void _lazy;
		void _lazyFailedAt;
		const out: Title = {
			...title,
			seasons: title.kind === 'series' ? (title.seasons ?? []) : title.seasons,
			variants: title.variants.map(play),
			...(title.seasons
				? {
						seasons: title.seasons.map((s) => ({
							...s,
							episodes: s.episodes.map((e) => ({ ...e, variants: e.variants.map(play) }))
						}))
					}
				: {})
		};
		const loaded = this.#loaded(accountId);
		const self = loaded.byId.get(id);
		const pool = kids ? loaded.light.filter((x) => x.kids) : loaded.light;
		const similar = self ? similarTitles(self, pool, 20).map((x) => x.id) : [];
		const json = JSON.stringify(out);
		return {
			status: 200,
			body: `${json.slice(0, -1)},"similar":[${this.cards(accountId, similar, kids).join(',')}]}`
		};
	}

	#detail(accountId: string, id: string): StoredTitle | undefined {
		const r = this.db
			.prepare('SELECT data FROM cat_details WHERE account_id = ? AND id = ?')
			.get(accountId, id) as { data: Uint8Array } | undefined;
		return r ? unpackJson<StoredTitle>(r.data) : undefined;
	}

	#ensureSeasons(accountId: string, t: StoredTitle): Promise<StoredTitle> {
		const key = `${accountId}\u0001${t.id}`;
		const running = this.#seriesJobs.get(key);
		if (running) return running;
		const job = this.#loadSeasons(accountId, t).finally(() => this.#seriesJobs.delete(key));
		this.#seriesJobs.set(key, job);
		return job;
	}

	async #loadSeasons(accountId: string, t: StoredTitle): Promise<StoredTitle> {
		// Retry failed upstream loads at most every 5 minutes.
		if (t._lazyFailedAt && Date.now() - t._lazyFailedAt < 5 * 60_000) return t;
		const now = Date.now();
		const inputs: Parameters<typeof mergeSeriesEpisodes>[1] = [];
		const remaining: LazyRef[] = [];
		const getCached = this.db.prepare(
			'SELECT data FROM cat_series WHERE account_id = ? AND source_id = ? AND provider_id = ? AND fetched_at > ?'
		);
		const putCached = this.db.prepare(
			'INSERT OR REPLACE INTO cat_series (account_id, source_id, provider_id, fetched_at, data) VALUES (?, ?, ?, ?, ?)'
		);
		let failed = false;
		for (const ref of t._lazy ?? []) {
			let res: { info: Partial<RawSeries>; episodes: RawEpisode[] } | undefined;
			const cached = getCached.get(accountId, ref.sourceId, ref.providerId, now - 12 * HOUR) as
				| { data: string }
				| undefined;
			if (cached) res = JSON.parse(cached.data);
			else {
				const ms = this.#masker(accountId, ref.sourceId);
				if (!ms || ms.src.type !== 'xtream') continue;
				try {
					const loaded = await loadSeriesInfo(ms.src, ref.providerId, this.limits);
					res = { info: loaded.info, episodes: maskEpisodes(loaded.episodes, ms.masker) };
					try {
						putCached.run(accountId, ref.sourceId, ref.providerId, now, JSON.stringify(res));
					} catch {
						// busy: the next view loads again
					}
				} catch (err) {
					failed = true;
					remaining.push(ref);
					if (this.config.log)
						console.warn(
							`[catalog] serie laden mislukt: ${toSourceError(err, secretList(ms.src)).message}`
						);
					continue;
				}
			}
			inputs.push({
				sourceId: ref.sourceId,
				audio: ref.audio,
				subs: ref.subs,
				quality: ref.quality,
				seriesTitle: ref.seriesTitle,
				episodes: res!.episodes,
				info: res!.info
			});
		}
		const merged = mergeSeriesEpisodes(t, inputs, this.config.catalogLang) as StoredTitle;
		const passwords = this.#passwords(accountId);
		merged.posterUrl = sanitizeImage(merged.posterUrl, passwords);
		merged.backdropUrl = sanitizeImage(merged.backdropUrl, passwords);
		for (const s of merged.seasons ?? [])
			for (const e of s.episodes) e.stillUrl = sanitizeImage(e.stillUrl, passwords);
		merged._lazy = remaining.length ? remaining : undefined;
		merged._lazyFailedAt = failed ? now : undefined;
		this.#persistTitle(accountId, merged);
		return merged;
	}

	#passwords(accountId: string): string[] {
		const out: string[] = [];
		for (const rec of this.sources.list(accountId)) {
			if (rec.type !== 'xtream') continue;
			try {
				const p = this.sources.secretOf(rec).password;
				if (p) out.push(p);
			} catch {
				// undecryptable: ignore
			}
		}
		return out;
	}

	#persistTitle(accountId: string, t: StoredTitle) {
		const r = titleRow(t);
		try {
			this.db.exec('BEGIN IMMEDIATE');
			try {
				this.db
					.prepare('UPDATE cat_details SET data = ? WHERE account_id = ? AND id = ?')
					.run(packJson(t), accountId, t.id);
				this.db
					.prepare('UPDATE cat_titles SET card = ?, langs = ?, search = ? WHERE account_id = ? AND id = ?')
					.run(r.card, r.langs, r.search, accountId, t.id);
				const ins = this.db.prepare(
					'INSERT OR REPLACE INTO cat_variants (account_id, id, source_id, url, alt) VALUES (?, ?, ?, ?, NULL)'
				);
				for (const v of titleVariants(t)) ins.run(accountId, v.id, v.sourceId, v.url);
				this.db.exec('COMMIT');
			} catch (err) {
				this.db.exec('ROLLBACK');
				throw err;
			}
		} catch (err) {
			// A build is writing: the episodes stay in cat_series and come back with the build.
			if (this.config.log) console.warn('[catalog] serie opslaan uitgesteld:', (err as Error).message);
		}
	}

	/** Masker + resolved source (secrets) for unmasking stream urls; cached briefly. */
	#masker(accountId: string, sourceId: string) {
		const key = `${accountId}:${sourceId}`;
		const hit = this.#maskers.get(key);
		const rec = this.sources.get(accountId, sourceId);
		if (!rec) {
			this.#maskers.delete(key);
			return undefined;
		}
		if (hit && hit.at === rec.updatedAt) return hit;
		let src: ResolvedSource;
		try {
			src = this.sources.resolve(rec);
		} catch {
			return undefined;
		}
		const entry = { at: rec.updatedAt, masker: createMasker(secretList(src)), src };
		if (this.#maskers.size > 200) this.#maskers.clear();
		this.#maskers.set(key, entry);
		return entry;
	}

	#search(accountId: string, kids: boolean): SearchIndex {
		const loaded = this.#loaded(accountId);
		const have = kids ? loaded.searchKids : loaded.search;
		if (have) return have;
		const rows = this.db
			.prepare(`SELECT id, kind, popularity, search FROM cat_titles WHERE account_id = ?${kids ? ' AND kids = 1' : ''}`)
			.all(accountId) as Row[];
		const docs = rows.map((r) => {
			const s = JSON.parse(String(r.search)) as {
				t: string;
				o?: string;
				a: string[];
				c: string[];
				d?: string;
				g: string[];
			};
			return {
				id: String(r.id),
				kind: String(r.kind),
				popularity: Number(r.popularity),
				title: s.t,
				originalTitle: s.o,
				altTitles: s.a.map((title) => ({ title })),
				cast: s.c.map((name) => ({ name })),
				director: s.d,
				genres: s.g
			} as unknown as Title;
		});
		const chans = this.db
			.prepare(`SELECT id, card FROM cat_channels WHERE account_id = ?${kids ? ' AND kids = 1' : ''} ORDER BY pos`)
			.all(accountId) as Row[];
		const channels = chans.map((r) => JSON.parse(String(r.card)) as Channel);
		const index = new SearchIndex(docs, channels);
		if (kids) loaded.searchKids = index;
		else loaded.search = index;
		return index;
	}

	search(accountId: string, query: string, limit: number, kids: boolean) {
		this.ensureBuilt(accountId);
		const r = this.#search(accountId, kids).search(query, {
			movies: limit,
			series: limit,
			channels: limit,
			people: Math.min(limit, 12),
			genres: Math.min(limit, 8)
		});
		const akas: Record<string, string> = {};
		for (const h of [...r.movies, ...r.series]) if (h.aka) akas[h.title.id] = h.aka;
		const cardsOf = (ids: string[]) => this.cards(accountId, ids, kids).map((c) => JSON.parse(c));
		const st = this.state(accountId)?.meta;
		const slugOf = new Map((st?.genres ?? []).map((g) => [g.name, g.slug]));
		return {
			query: r.query,
			total: r.total,
			movies: cardsOf(r.movies.map((h) => h.title.id)),
			series: cardsOf(r.series.map((h) => h.title.id)),
			people: r.people.map((p) => ({
				name: p.name,
				...(p.profileUrl ? { profileUrl: p.profileUrl } : {}),
				titles: cardsOf(p.titles.slice(0, 12).map((t) => t.id))
			})),
			channels: r.channels.map((h) => h.channel),
			genres: r.genres.map((g) => ({
				slug: slugOf.get(g.genre) ?? g.genre,
				name: g.genre,
				movies: g.movies,
				series: g.series,
				count: g.movies + g.series
			})),
			akas
		};
	}

	recommend(accountId: string, history: string[], favorites: string[], limit: number, kids: boolean): string {
		this.ensureBuilt(accountId);
		const titles = this.#titlesFor(accountId, kids);
		const entries: HistoryEntry[] = history.map((titleId, i) => ({ titleId, at: -i }));
		const picked = recommend(titles, { favorites, history: entries, progress: {} }, limit);
		return `{"items":[${this.cards(accountId, picked.map((t) => t.id), kids).join(',')}]}`;
	}

	channels(
		accountId: string,
		q: { group?: string; lang?: string; kids: boolean },
		play: (v: StreamVariant) => StreamVariant
	): string {
		this.ensureBuilt(accountId);
		const where = ['account_id = ?'];
		const args: string[] = [accountId];
		if (q.kids) where.push('kids = 1');
		if (q.group) {
			where.push('grp = ?');
			args.push(q.group);
		}
		if (q.lang) {
			where.push('langs LIKE ?');
			args.push(`%|${q.lang}|%`);
		}
		const rows = this.db
			.prepare(`SELECT data FROM cat_channels WHERE ${where.join(' AND ')} ORDER BY pos`)
			.all(...args) as Row[];
		const items = rows.map((r) => {
			const c = JSON.parse(String(r.data)) as Channel;
			return JSON.stringify({ ...c, variants: c.variants.map(play) });
		});
		return `{"items":[${items.join(',')}]}`;
	}

	epg(accountId: string, epgIds: string[], from: number, to: number): Record<string, EpgProgramme[]> {
		const stmt = this.db.prepare(
			`SELECT start, stop, title, desc, category, icon FROM cat_epg
			 WHERE account_id = ? AND epg_id = ? AND stop > ? AND start < ? ORDER BY start`
		);
		const out: Record<string, EpgProgramme[]> = {};
		for (const id of epgIds) {
			const rows = stmt.all(accountId, id, from, to) as Row[];
			out[id] = rows.map((r) => programme(id, r));
		}
		return out;
	}

	nowNext(accountId: string, channelIds: string[], now = Date.now()) {
		const ch = this.db.prepare('SELECT epg_id FROM cat_channels WHERE account_id = ? AND id = ?');
		const stmt = this.db.prepare(
			`SELECT start, stop, title, desc, category, icon FROM cat_epg
			 WHERE account_id = ? AND epg_id = ? AND stop > ? ORDER BY start LIMIT 2`
		);
		const out: Record<string, { now?: EpgProgramme; next?: EpgProgramme }> = {};
		for (const id of channelIds) {
			const r = ch.get(accountId, id) as { epg_id: string | null } | undefined;
			if (!r?.epg_id) {
				out[id] = {};
				continue;
			}
			const list = (stmt.all(accountId, r.epg_id, now) as Row[]).map((x) => programme(r.epg_id!, x));
			if (list[0] && list[0].start <= now) out[id] = { now: list[0], next: list[1] };
			else out[id] = { next: list[0] };
		}
		return out;
	}

	// ---- play urls ------------------------------------------------------------------------

	/** Deterministic per-device play token (HMAC of device id + generation); no plaintext stored. */
	playToken(device: DeviceRow): string {
		const token =
			'pt_' + hmac(this.keys.play, `${device.id}:${device.playTokenGen}`).toString('base64url');
		const hash = sha256hex(token);
		if (device.playTokenHash !== hash) {
			this.store.setPlayToken(device.id, device.playTokenGen, hash);
			device.playTokenHash = hash;
		}
		return token;
	}

	/** New generation: every previous play url of this device stops working. */
	rotatePlayToken(device: DeviceRow): string {
		const fresh = this.store.getDevice(device.id)!;
		fresh.playTokenGen += 1;
		fresh.playTokenHash = null;
		return this.playToken(fresh);
	}

	deviceForPlayToken(token: string): DeviceRow | undefined {
		if (!/^pt_[A-Za-z0-9_-]{43}$/.test(token)) return undefined;
		return this.store.deviceByPlayTokenHash(sha256hex(token));
	}

	/** Variant → copy with play urls (url, altUrls) and the upstreamHttp hint. */
	playMapper(base: string, token: string): (v: StreamVariant) => StreamVariant {
		return (v) => {
			const id = b64url(v.id);
			const ext = (u: string) => {
				const m = /\.([a-z0-9]{2,5})(?:[?#]|$)/i.exec(u.replace(/\d+/g, 'x'));
				return m ? '.' + m[1].toLowerCase() : '';
			};
			const out: StreamVariant & { upstreamHttp?: boolean } = {
				...v,
				url: `${base}/v1/play/${token}/${id}${ext(v.url)}`,
				upstreamHttp: v.url.startsWith('http:')
			};
			if (v.altUrls?.length)
				out.altUrls = v.altUrls.map((u, i) => `${base}/v1/play/${token}/${id}~${i + 1}${ext(u)}`);
			return out;
		};
	}

	/** Resolves a play path segment to the real (unmasked) upstream url. */
	resolvePlay(accountId: string, segment: string): string | undefined {
		const m = /^([A-Za-z0-9_-]{2,400})(?:~(\d{1,2}))?(?:\.[a-z0-9]{1,5})?$/.exec(segment);
		if (!m) return undefined;
		const variantId = Buffer.from(m[1], 'base64url').toString('utf8');
		const r = this.db
			.prepare('SELECT source_id, url, alt FROM cat_variants WHERE account_id = ? AND id = ?')
			.get(accountId, variantId) as { source_id: string; url: string; alt: string | null } | undefined;
		if (!r) return undefined;
		let url = r.url;
		if (m[2]) {
			const alt = r.alt ? (JSON.parse(r.alt) as string[]) : [];
			url = alt[Number(m[2]) - 1];
			if (!url) return undefined;
		}
		if (!url.includes('')) return url;
		const ms = this.#masker(accountId, r.source_id);
		return ms ? ms.masker.unmask(url) : undefined;
	}

	/** Upstream url sealed into a path segment (HLS rewriting via the play route). */
	sealSegment(accountId: string, url: string): string {
		return seal(this.keys.segment, url, 'seg:' + accountId).slice(3);
	}

	openSegment(accountId: string, sealed: string): string | undefined {
		try {
			return unseal(this.keys.segment, 'v1.' + sealed, 'seg:' + accountId);
		} catch {
			return undefined;
		}
	}

	async dispose() {
		clearInterval(this.#timer);
		clearTimeout(this.#startTimer);
		await this.queue.dispose();
		this.db.close();
	}
}

function programme(channelId: string, r: Row): EpgProgramme {
	const p: EpgProgramme = {
		channelId,
		start: Number(r.start),
		stop: Number(r.stop),
		title: String(r.title)
	};
	if (r.desc != null) p.desc = String(r.desc);
	if (r.category != null) p.category = String(r.category);
	if (r.icon != null) p.icon = String(r.icon);
	return p;
}

function encodeCursor(sort: string, k: string | number, i: string): string {
	return Buffer.from(JSON.stringify({ s: sort, k, i }), 'utf8').toString('base64url');
}

function decodeCursor(cursor: string | undefined, sort: string): { k: string | number; i: string } | undefined {
	if (!cursor) return undefined;
	try {
		const c = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
			s: string;
			k: string | number;
			i: string;
		};
		if (c.s !== sort || typeof c.i !== 'string' || (typeof c.k !== 'string' && typeof c.k !== 'number'))
			return undefined;
		return { k: c.k, i: c.i };
	} catch {
		return undefined;
	}
}
