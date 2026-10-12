// Catalog service (main thread): queries over catalog.db, the in-memory LRU (max. 2 accounts:
// light title list + search index), lazy Xtream series, direct stream urls (credentials filled
// in per request; the server never streams video),
// the build queue and the refresh scheduler.
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { Config } from '../config.ts';
import type { ServerKeys } from '../keys.ts';
import type { Store } from '../store.ts';
import { scrubUrls, sha256hex } from '../util.ts';
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
import {
	genKey,
	openCatalogDb,
	packJson,
	purgeAccount,
	purgeSourceSeries,
	unpackJson
} from './db.ts';
import { toSourceError } from './fetch.ts';
import { loadSeriesInfo, type FetchLimits } from './providers.ts';
import { BuildQueue, type AccountBuildStatus } from './queue.ts';
import { accountCacheDir, sourceDir } from './rawcache.ts';
import { secretList, SourceRepo, type ResolvedSource } from './sources.ts';

const HOUR = 3600_000;
const LRU_MAX = 2;
const EMPTY: never[] = [];

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
	#tmdbFollowUp = new Set<string>();
	#skipTmdb = new Set<string>();
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
				onFinished: (accountId, error, code) => this.#onFinished(accountId, error, code)
			},
			{
				inline: o.config.buildInline,
				// Read at every build (so a config change applies to the next build).
				get memoryMb() {
					return o.config.buildMemoryMb;
				}
			}
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
		// Free this account's in-memory lists while its build runs (memory budget); they are
		// rebuilt from the new generation on the next request. With --expose-gc (the image sets
		// it) the freed memory is reclaimed now, before the build worker needs it.
		if (this.#lru.delete(accountId)) (globalThis as { gc?: () => void }).gc?.();
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
			tmdb:
				this.config.tmdbApiKey && !this.#skipTmdb.delete(accountId)
				? { apiKey: this.config.tmdbApiKey, maxTitles: this.config.tmdbMaxTitles }
				: undefined
		};
	}

	#onEvent(accountId: string, e: BuildEvent) {
		if (e.type === 'source') {
			if (this.store.getAccount(accountId)) this.sources.setStatus(accountId, e.id, e.status);
		} else if (e.type === 'built') {
			this.#lru.delete(accountId);
		} else if (e.type === 'tmdb') {
			if (e.changed) this.#tmdbFollowUp.add(accountId);
		} else if (e.type === 'warn' && this.config.log) {
			console.warn(`[catalog] ${accountId}: ${scrubUrls(e.message)}`);
		}
	}

	#onFinished(accountId: string, error?: string, code = 'build_failed') {
		if (error) {
			if (this.config.log)
				console.warn(`[catalog] build ${accountId} mislukt (${code}): ${scrubUrls(error)}`);
			// The previous generation stays active; meta reports status 'error' with this.
			this.db
				.prepare(
					`INSERT INTO cat_state (account_id, error, error_code, error_at) VALUES (?, ?, ?, ?)
					 ON CONFLICT (account_id) DO UPDATE SET error = excluded.error,
					 error_code = excluded.error_code, error_at = excluded.error_at`
				)
				.run(accountId, scrubUrls(error).slice(0, 500), code, Date.now());
		}
		this.#lru.delete(accountId);
		// TMDB found new ids: one follow-up build (without TMDB) applies them.
		if (!error && this.#tmdbFollowUp.delete(accountId)) {
			this.#skipTmdb.add(accountId);
			this.queue.enqueue(accountId);
		}
	}

	/** Queues a refresh. `force` true = every source, or the given source id. */
	refresh(
		accountId: string,
		opts: { force?: boolean; sourceId?: string } = {}
	): AccountBuildStatus {
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
			console.warn('[catalog] purge failed', scrubUrls((err as Error).message));
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

	state(accountId: string):
		| {
				builtAt: number;
				version: number;
				gen?: string;
				meta?: CatalogMetaJson;
				error?: string;
				errorCode?: string;
				errorAt?: number;
		  }
		| undefined {
		const r = this.db.prepare('SELECT * FROM cat_state WHERE account_id = ?').get(accountId) as
			| Row
			| undefined;
		if (!r) return undefined;
		return {
			builtAt: Number(r.built_at),
			version: Number(r.version),
			gen: r.gen ? String(r.gen) : undefined,
			meta: r.meta ? (JSON.parse(String(r.meta)) as CatalogMetaJson) : undefined,
			error: r.error ? String(r.error) : undefined,
			errorCode: r.error_code ? String(r.error_code) : undefined,
			errorAt: r.error_at ? Number(r.error_at) : undefined
		};
	}

	/** account_id value of the ACTIVE catalog generation (see db.ts genKey). */
	#k(accountId: string): string {
		const r = this.db.prepare('SELECT gen FROM cat_state WHERE account_id = ?').get(accountId) as
			| { gen: string | null }
			| undefined;
		return genKey(accountId, r?.gen);
	}

	#loaded(accountId: string): Loaded {
		const version = this.state(accountId)?.version ?? 0;
		const hit = this.#lru.get(accountId);
		if (hit && hit.version === version) {
			this.#lru.delete(accountId);
			this.#lru.set(accountId, hit);
			return hit;
		}
		const stmt = this.db.prepare(
			'SELECT id, kind, popularity, added_at, kids, has_overview, genres FROM cat_titles WHERE account_id = ?'
		);
		// Minimal objects (only what home rows, similar and recommend read); identical genre lists
		// share one array. Rows are streamed (iterate), not materialised as one big array.
		const genreLists = new Map<string, string[]>();
		const light: Light[] = [];
		for (const r of stmt.iterate(this.#k(accountId)) as Iterable<Row>) {
			const g = String(r.genres);
			let genres = genreLists.get(g);
			if (!genres) genreLists.set(g, (genres = g ? g.slice(1, -1).split('|') : []));
			light.push({
				id: String(r.id),
				kind: String(r.kind) as Title['kind'],
				popularity: Number(r.popularity),
				addedAt: Number(r.added_at),
				kids: Number(r.kids) === 1,
				kidsSafe: Number(r.kids) === 1,
				overview: Number(r.has_overview) ? '1' : undefined,
				genres
			} as Light);
		}
		(globalThis as { gc?: () => void }).gc?.();
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
		const key = this.#k(accountId);
		for (let i = 0; i < ids.length; i += 200) {
			const chunk = ids.slice(i, i + 200);
			const rows = this.db
				.prepare(
					`SELECT id, card FROM cat_titles WHERE account_id = ? AND id IN (${chunk.map(() => '?').join(',')})${kids ? ' AND kids = 1' : ''}`
				)
				.all(key, ...chunk) as Row[];
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
		// The last attempt failed (newer than the last successful build): 'error', while the
		// previous catalog (counts below) stays available.
		const failed = !!st?.errorAt && st.errorAt >= (st.builtAt || 0);
		const status =
			q.state !== 'idle' ? 'building' : failed ? 'error' : st?.meta ? 'ready' : 'empty';
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
		if (failed && st?.error) {
			out.error = st.error;
			out.errorCode = st.errorCode ?? 'build_failed';
		}
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
			.all(this.#k(accountId), limit) as Row[];
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
		q: {
			kind?: string;
			genre?: string;
			lang?: string;
			sort: string;
			kids: boolean;
			limit: number;
			cursor?: string;
		}
	): string {
		this.ensureBuilt(accountId);
		const where: string[] = ['account_id = ?'];
		const args: (string | number)[] = [this.#k(accountId)];
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
			(
				this.db
					.prepare(`SELECT COUNT(*) AS n FROM cat_titles WHERE ${where.join(' AND ')}`)
					.get(...args) as Row
			).n
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
		const next =
			more && last ? encodeCursor(q.sort, last.k as string | number, String(last.id)) : undefined;
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

	/** Full title with direct stream urls and similar titles; lazy Xtream series load first. */
	async title(
		accountId: string,
		id: string,
		kids: boolean,
		direct: (v: StreamVariant) => StreamVariant | undefined
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
			variants: mapVariants(title.variants, direct),
			...(title.seasons
				? {
						seasons: title.seasons.map((s) => ({
							...s,
							episodes: s.episodes.map((e) => ({ ...e, variants: mapVariants(e.variants, direct) }))
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
			.get(this.#k(accountId), id) as { data: Uint8Array } | undefined;
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
				{ data: string } | undefined;
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
							`[catalog] serie laden mislukt: ${scrubUrls(toSourceError(err, secretList(ms.src)).message)}`
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
		const key = this.#k(accountId);
		try {
			this.db.exec('BEGIN IMMEDIATE');
			try {
				this.db
					.prepare('UPDATE cat_details SET data = ? WHERE account_id = ? AND id = ?')
					.run(packJson(t), key, t.id);
				this.db
					.prepare(
						'UPDATE cat_titles SET card = ?, langs = ?, search = ? WHERE account_id = ? AND id = ?'
					)
					.run(r.card, r.langs, r.search, key, t.id);
				const ins = this.db.prepare(
					'INSERT OR REPLACE INTO cat_variants (account_id, id, source_id, url, alt) VALUES (?, ?, ?, ?, NULL)'
				);
				for (const v of titleVariants(t)) ins.run(key, v.id, v.sourceId, v.url);
				this.db.exec('COMMIT');
			} catch (err) {
				this.db.exec('ROLLBACK');
				throw err;
			}
		} catch (err) {
			// A build is writing: the episodes stay in cat_series and come back with the build.
			if (this.config.log)
				console.warn('[catalog] serie opslaan uitgesteld:', scrubUrls((err as Error).message));
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
		// Only the fields the index needs (json_extract in SQLite; no full card parse per title).
		const stmt = this.db.prepare(
			`SELECT id, kind, popularity, json_extract(card, '$.title') AS t,
			 json_extract(card, '$.originalTitle') AS o, json_extract(card, '$.altTitles') AS a,
			 json_extract(card, '$.genres') AS g, json_extract(search, '$.c') AS c,
			 json_extract(search, '$.d') AS d
			 FROM cat_titles WHERE account_id = ?${kids ? ' AND kids = 1' : ''}`
		);
		const docs: Title[] = [];
		for (const r of stmt.iterate(this.#k(accountId)) as Iterable<Row>) {
			docs.push({
				id: String(r.id),
				kind: String(r.kind),
				popularity: Number(r.popularity),
				title: String(r.t ?? ''),
				originalTitle: r.o == null ? undefined : String(r.o),
				altTitles: r.a ? (JSON.parse(String(r.a)) as Title['altTitles']) : EMPTY,
				cast: r.c ? (JSON.parse(String(r.c)) as string[]).map((name) => ({ name })) : EMPTY,
				director: r.d == null ? undefined : String(r.d),
				genres: r.g ? (JSON.parse(String(r.g)) as string[]) : EMPTY
			} as unknown as Title);
		}
		const chans = this.db
			.prepare(
				`SELECT id, card FROM cat_channels WHERE account_id = ?${kids ? ' AND kids = 1' : ''} ORDER BY pos`
			)
			.all(this.#k(accountId)) as Row[];
		const channels = chans.map((r) => JSON.parse(String(r.card)) as Channel);
		const index = new SearchIndex(docs, channels);
		// After indexing, results only need id, kind and popularity of a title: drop the rest so
		// the index does not keep every alt title, cast list and genre list twice.
		for (const d of docs) {
			const x = d as unknown as Record<string, unknown>;
			x.title = '';
			x.originalTitle = undefined;
			x.altTitles = EMPTY;
			x.cast = EMPTY;
			x.director = undefined;
			x.genres = EMPTY;
		}
		if (kids) loaded.searchKids = index;
		else loaded.search = index;
		// Building the index leaves a lot of short-lived garbage: collect it now (--expose-gc).
		(globalThis as { gc?: () => void }).gc?.();
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

	recommend(
		accountId: string,
		history: string[],
		favorites: string[],
		limit: number,
		kids: boolean
	): string {
		this.ensureBuilt(accountId);
		const titles = this.#titlesFor(accountId, kids);
		const entries: HistoryEntry[] = history.map((titleId, i) => ({ titleId, at: -i }));
		const picked = recommend(titles, { favorites, history: entries, progress: {} }, limit);
		return `{"items":[${this.cards(
			accountId,
			picked.map((t) => t.id),
			kids
		).join(',')}]}`;
	}

	channels(
		accountId: string,
		q: { group?: string; lang?: string; kids: boolean },
		direct: (v: StreamVariant) => StreamVariant | undefined
	): string {
		this.ensureBuilt(accountId);
		const where = ['account_id = ?'];
		const args: string[] = [this.#k(accountId)];
		if (q.kids) where.push('kids = 1');
		if (q.group) {
			where.push('grp = ?');
			args.push(q.group);
		}
		if (q.lang) {
			where.push('langs LIKE ?');
			args.push(`%|${q.lang}|%`);
		}
		const stmt = this.db.prepare(
			`SELECT data FROM cat_channels WHERE ${where.join(' AND ')} ORDER BY pos`
		);
		// Streamed row by row into one string (no intermediate row/item arrays).
		let out = '{"items":[';
		let first = true;
		for (const r of stmt.iterate(...args) as Iterable<Row>) {
			const c = JSON.parse(String(r.data)) as Channel;
			out += (first ? '' : ',') + JSON.stringify({ ...c, variants: mapVariants(c.variants, direct) });
			first = false;
		}
		return out + ']}';
	}

	epg(
		accountId: string,
		epgIds: string[],
		from: number,
		to: number
	): Record<string, EpgProgramme[]> {
		const stmt = this.db.prepare(
			`SELECT start, stop, title, desc, category, icon FROM cat_epg
			 WHERE account_id = ? AND epg_id = ? AND stop > ? AND start < ? ORDER BY start`
		);
		const out: Record<string, EpgProgramme[]> = {};
		const key = this.#k(accountId);
		for (const id of epgIds) {
			const rows = stmt.all(key, id, from, to) as Row[];
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
		const key = this.#k(accountId);
		for (const id of channelIds) {
			const r = ch.get(key, id) as { epg_id: string | null } | undefined;
			if (!r?.epg_id) {
				out[id] = {};
				continue;
			}
			const list = (stmt.all(key, r.epg_id, now) as Row[]).map((x) =>
				programme(r.epg_id!, x)
			);
			if (list[0] && list[0].start <= now) out[id] = { now: list[0], next: list[1] };
			else out[id] = { next: list[0] };
		}
		return out;
	}

	// ---- stream urls -----------------------------------------------------------------------

	/**
	 * Variant → copy with the REAL upstream url(s), credentials filled in from the account's
	 * decrypted source secrets (only for this request; stored urls stay masked). Adds the
	 * `upstreamHttp` hint. Returns undefined when the source cannot be resolved (deleted, or
	 * secrets not decryptable): such a variant is dropped instead of leaking placeholders.
	 */
	directMapper(accountId: string): (v: StreamVariant) => StreamVariant | undefined {
		return (v) => {
			const masked = v.url.includes('\uE000') || v.altUrls?.some((u) => u.includes('\uE000'));
			let unmask = (u: string) => u;
			if (masked) {
				const ms = this.#masker(accountId, v.sourceId);
				if (!ms) return undefined;
				unmask = ms.masker.unmask;
			}
			const url = unmask(v.url);
			if (url.includes('\uE000')) return undefined;
			const out: StreamVariant & { upstreamHttp?: boolean } = {
				...v,
				url,
				upstreamHttp: url.startsWith('http:')
			};
			if (v.altUrls?.length) out.altUrls = v.altUrls.map(unmask);
			return out;
		};
	}

	async dispose() {
		clearInterval(this.#timer);
		clearTimeout(this.#startTimer);
		await this.queue.dispose();
		this.db.close();
	}
}

function mapVariants(
	list: StreamVariant[],
	f: (v: StreamVariant) => StreamVariant | undefined
): StreamVariant[] {
	const out: StreamVariant[] = [];
	for (const v of list) {
		const m = f(v);
		if (m) out.push(m);
	}
	return out;
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

function decodeCursor(
	cursor: string | undefined,
	sort: string
): { k: string | number; i: string } | undefined {
	if (!cursor) return undefined;
	try {
		const c = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
			s: string;
			k: string | number;
			i: string;
		};
		if (
			c.s !== sort ||
			typeof c.i !== 'string' ||
			(typeof c.k !== 'string' && typeof c.k !== 'number')
		)
			return undefined;
		return { k: c.k, i: c.i };
	} catch {
		return undefined;
	}
}
