// RemoteProvider: the CatalogProvider on top of the PrismaStream backend (docs/BACKEND.md).
//
// Local footprint: one LRU (TitleCards `c:<id>` and title details `d:<id>`, max ±300 items /
// ±5 MB) plus snapshots of the last home and meta responses for a fast start. No raw catalogs,
// no EPG dumps and no IPTV credentials. When the backend cannot be reached the provider answers
// from that cache where it can (and the library shows an offline notice).
import type { Channel, EpgProgramme, NowNext, TitleCard } from '#lib/types.ts';
import type {
	CatalogMeta,
	HomeResponse,
	SearchResponse,
	TitleDetail as WireDetail
} from '#lib/backend/types.ts';
import { BackendError, BackendOfflineError, type BackendClient } from '#lib/backend/client.ts';
import type { LruCache } from '#lib/backend/lru.ts';
import { fold as foldText } from '#lib/search/fold.ts';
import { withTimeout } from '#lib/idb.ts';
import type {
	CatalogProvider,
	Facets,
	HomeData,
	SearchView,
	TitleDetail,
	TitlePage,
	TitleQuery
} from './provider.ts';

/** Persistent key/value storage for snapshots (home, meta). */
export interface SnapshotStore {
	get<T>(key: string): Promise<T | undefined>;
	set(key: string, value: unknown): Promise<void>;
	clear(): Promise<void>;
}

export interface Snapshot<T> {
	body: T;
	etag?: string;
	savedAt: number;
}

export type CacheEntry = { card: TitleCard } | { detail: WireDetail; savedAt: number };

/** A cached detail younger than this is used without asking the server. */
const DETAIL_FRESH_MS = 10 * 60_000;
const CARD_FIELDS = [
	'id',
	'kind',
	'title',
	'originalTitle',
	'year',
	'genres',
	'rating',
	'runtimeMin',
	'posterUrl',
	'backdropUrl',
	'logoUrl',
	'addedAt',
	'popularity',
	'languages',
	'subtitleLanguages',
	'qualities',
	'certification',
	'kidsSafe',
	'originalLang',
	'altTitles',
	'overview',
	'seasonCount'
] as const;

/** Reduce a (possibly full) title to a TitleCard, so the cache never stores variants twice. */
export function toCard(t: TitleCard | WireDetail): TitleCard {
	const out: Record<string, unknown> = {};
	const src = t as unknown as Record<string, unknown>;
	for (const k of CARD_FIELDS) if (src[k] !== undefined) out[k] = src[k];
	const card = out as unknown as TitleCard;
	card.genres ??= [];
	card.languages ??= [];
	card.subtitleLanguages ??= [];
	card.qualities ??= [];
	card.altTitles = (card.altTitles ?? []).slice(0, 12);
	if (typeof card.overview === 'string' && card.overview.length > 280)
		card.overview = card.overview.slice(0, 279) + '…';
	if (card.seasonCount === undefined && 'seasons' in t && Array.isArray(t.seasons))
		card.seasonCount = t.seasons.length;
	return card;
}

function isOffline(err: unknown): boolean {
	return err instanceof BackendOfflineError;
}

function chunks<T>(list: T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
	return out;
}

const HOUR = 3_600_000;

export interface RemoteProviderOptions {
	client: BackendClient;
	cache: LruCache<CacheEntry>;
	snapshots: SnapshotStore;
	now?: () => number;
	/** Give up on the persisted cache after this long (ms). */
	primeTimeoutMs?: number;
}

export class RemoteProvider implements CatalogProvider {
	readonly kind = 'remote' as const;
	readonly client: BackendClient;
	readonly cache: LruCache<CacheEntry>;
	readonly snapshots: SnapshotStore;
	#now: () => number;
	#primed: Promise<void> | null = null;
	#primeTimeoutMs: number;

	constructor(o: RemoteProviderOptions) {
		this.client = o.client;
		this.cache = o.cache;
		this.snapshots = o.snapshots;
		this.#now = o.now ?? Date.now;
		this.#primeTimeoutMs = o.primeTimeoutMs ?? 2500;
	}

	/**
	 * Load the persisted cache and seed the ETag map with the snapshots (once). Never blocks the
	 * remote mode: a broken or blocked storage just means "no cache" (after `primeTimeoutMs`).
	 */
	prime(): Promise<void> {
		this.#primed ??= withTimeout(this.#loadCache(), this.#primeTimeoutMs, undefined);
		return this.#primed;
	}

	async #loadCache(): Promise<void> {
		return (async () => {
			await this.cache.load();
			for (const kids of [false, true]) {
				const path = this.#homePath(kids, 20);
				const snap = await this.snapshots.get<Snapshot<HomeResponse>>(`home:${kids ? 1 : 0}`);
				if (snap?.etag) this.client.seedEtag(path, snap.etag, snap.body);
			}
			const meta = await this.snapshots.get<Snapshot<CatalogMeta>>('meta');
			if (meta?.etag) this.client.seedEtag('/v1/catalog/meta', meta.etag, meta.body);
		})().catch(() => undefined);
	}

	#homePath(kids: boolean, limit: number) {
		return `/v1/catalog/home?${kids ? 'kids=1&' : ''}limit=${limit}`;
	}

	// ---- cache helpers ------------------------------------------------------------

	rememberCards(cards: TitleCard[] | undefined) {
		for (const c of cards ?? [])
			if (c && typeof c.id === 'string') this.cache.set('c:' + c.id, { card: toCard(c) });
	}

	/** Cached card (or the card part of a cached detail), without network. */
	peekCard(id: string): TitleCard | undefined {
		const e = this.cache.peek('c:' + id);
		if (e && 'card' in e) return e.card;
		const d = this.cache.peek('d:' + id);
		return d && 'detail' in d ? toCard(d.detail) : undefined;
	}

	peekDetail(id: string): WireDetail | undefined {
		const d = this.cache.peek('d:' + id);
		return d && 'detail' in d ? d.detail : undefined;
	}

	// ---- meta ---------------------------------------------------------------------------

	/** Catalog meta; `fromCache` is true when the server could not be reached. */
	async meta(signal?: AbortSignal): Promise<{ meta: CatalogMeta; fromCache: boolean }> {
		await this.prime();
		try {
			const meta = await this.client.meta(signal);
			void this.snapshots.set('meta', {
				body: meta,
				etag: this.client.etagFor('/v1/catalog/meta'),
				savedAt: this.#now()
			} satisfies Snapshot<CatalogMeta>);
			return { meta, fromCache: false };
		} catch (err) {
			if (!isOffline(err)) throw err;
			const snap = await this.#snapshot<CatalogMeta>('meta');
			if (!snap) throw err;
			return { meta: snap.body, fromCache: true };
		}
	}

	async cachedMeta(): Promise<CatalogMeta | undefined> {
		const snap = await this.#snapshot<CatalogMeta>('meta');
		return snap?.body;
	}

	/** A snapshot, or undefined when the storage fails or is too slow. */
	#snapshot<T>(key: string): Promise<Snapshot<T> | undefined> {
		return withTimeout(this.snapshots.get<Snapshot<T>>(key), this.#primeTimeoutMs, undefined);
	}

	async cachedHome(kids: boolean): Promise<HomeData | undefined> {
		const snap = await this.#snapshot<HomeResponse>(`home:${kids ? 1 : 0}`);
		return snap ? this.#homeData(snap.body) : undefined;
	}

	#homeData(h: HomeResponse): HomeData {
		return {
			featured: h.featured ?? [],
			recent: h.recent ?? [],
			popularMovies: h.popularMovies ?? [],
			trendingSeries: h.trendingSeries ?? [],
			genres: (h.genres ?? []).map((g) => ({ slug: g.slug, name: g.name, count: g.count })),
			live: h.live ?? []
		};
	}

	// ---- CatalogProvider ------------------------------------------------------------------

	async home(opts: { kids: boolean; limit?: number }, signal?: AbortSignal): Promise<HomeData> {
		await this.prime();
		const limit = opts.limit ?? 20;
		try {
			const h = await this.client.home({ kids: opts.kids, limit }, signal);
			this.rememberCards([...(h.featured ?? []), ...(h.recent ?? []).slice(0, 10)]);
			void this.snapshots.set(`home:${opts.kids ? 1 : 0}`, {
				body: h,
				etag: this.client.etagFor(this.#homePath(opts.kids, limit)),
				savedAt: this.#now()
			} satisfies Snapshot<HomeResponse>);
			return this.#homeData(h);
		} catch (err) {
			if (!isOffline(err)) throw err;
			const cached = await this.cachedHome(opts.kids);
			if (!cached) throw err;
			return cached;
		}
	}

	async facets(
		opts: { kind?: 'movie' | 'series'; kids: boolean },
		signal?: AbortSignal
	): Promise<Facets> {
		const { meta } = await this.meta(signal);
		return {
			genres: (meta.genres ?? []).map((g) => ({ slug: g.slug, name: g.name, count: g.count })),
			languages: (meta.languages ?? []).map((l) => ({ code: l.lang, count: l.count }))
		};
	}

	async titles(q: TitleQuery, signal?: AbortSignal): Promise<TitlePage> {
		await this.prime();
		try {
			const r = await this.client.titles(
				{
					kind: q.kind,
					genre: q.genre || undefined,
					lang: q.lang || undefined,
					sort: q.sort,
					kids: q.kids,
					limit: q.limit ?? 60,
					cursor: q.cursor
				},
				signal
			);
			const items = (r.items ?? []).filter((t) => t && typeof t.id === 'string');
			// Only the first page goes into the LRU: scrolling must not flush the cache.
			if (!q.cursor) this.rememberCards(items.slice(0, 24));
			return { items, nextCursor: r.nextCursor || undefined, total: r.total ?? items.length };
		} catch (err) {
			if (!isOffline(err) || q.cursor) throw err;
			// Offline: whatever matching cards are cached.
			const items = this.#cachedCards().filter(
				(c) =>
					(!q.kind || c.kind === q.kind) &&
					(!q.kids || c.kidsSafe === true) &&
					(!q.lang || c.languages.includes(q.lang))
			);
			if (!items.length) throw err;
			items.sort((a, b) => b.popularity - a.popularity);
			return { items, total: items.length };
		}
	}

	#cachedCards(): TitleCard[] {
		const out: TitleCard[] = [];
		const seen = new Set<string>();
		for (const key of this.cache.keys().reverse()) {
			const id = key.slice(2);
			if (seen.has(id)) continue;
			const card = this.peekCard(id);
			if (card) {
				seen.add(id);
				out.push(card);
			}
		}
		return out;
	}

	async cards(ids: string[], opts: { kids: boolean }, signal?: AbortSignal): Promise<TitleCard[]> {
		await this.prime();
		const wanted = [...new Set(ids.filter((id) => typeof id === 'string' && id))];
		const found = new Map<string, TitleCard>();
		const missing: string[] = [];
		for (const id of wanted) {
			const e = this.cache.get('c:' + id);
			const card = e && 'card' in e ? e.card : this.peekCard(id);
			if (card) found.set(id, card);
			else missing.push(id);
		}
		if (missing.length) {
			try {
				for (const part of chunks(missing, 100)) {
					const r = await this.client.titlesByIds(part, { kids: opts.kids }, signal);
					for (const c of r.items ?? []) {
						if (!c || typeof c.id !== 'string') continue;
						found.set(c.id, c);
					}
					this.rememberCards(r.items);
				}
			} catch (err) {
				if (!isOffline(err)) throw err;
			}
		}
		return wanted
			.map((id) => found.get(id))
			.filter((c): c is TitleCard => !!c && (!opts.kids || c.kidsSafe === true));
	}

	async title(
		id: string,
		opts: { similar?: boolean; fresh?: boolean } = {},
		signal?: AbortSignal
	): Promise<TitleDetail | null> {
		await this.prime();
		const cached = this.cache.get('d:' + id);
		// The cached detail has no stream urls (see stripStreamUrls): fine for the detail page,
		// never for playback.
		const fresh =
			!opts.fresh && cached && 'detail' in cached && this.#now() - cached.savedAt < DETAIL_FRESH_MS
				? cached.detail
				: undefined;
		let detail: WireDetail | undefined = fresh;
		if (!detail) {
			try {
				detail = await this.client.title(id, signal);
				if (detail && typeof detail.id === 'string') {
					this.cache.set('d:' + id, { detail: stripStreamUrls(detail), savedAt: this.#now() });
					this.cache.delete('c:' + id);
					this.rememberCards((detail.similar ?? []).slice(0, 6));
				}
			} catch (err) {
				if (err instanceof BackendError && err.status === 404) {
					this.cache.delete('d:' + id);
					this.cache.delete('c:' + id);
					return null;
				}
				// Offline: the cached detail (without stream urls) still shows the page; playback
				// needs a fresh one anyway.
				if (!isOffline(err) || opts.fresh || !cached || !('detail' in cached)) throw err;
				detail = cached.detail;
			}
		}
		if (!detail || typeof detail.id !== 'string') return null;
		return normalizeDetail(detail, opts.similar !== false);
	}

	async search(
		q: string,
		opts: { kids: boolean; limit?: number },
		signal?: AbortSignal
	): Promise<SearchView> {
		await this.prime();
		try {
			const r = await this.client.search(q, { kids: opts.kids, limit: opts.limit ?? 48 }, signal);
			return searchView(q, r, opts.kids);
		} catch (err) {
			if (!isOffline(err)) throw err;
			return this.#offlineSearch(q, opts.kids);
		}
	}

	#offlineSearch(q: string, kids: boolean): SearchView {
		const needle = foldText(q);
		const hits = this.#cachedCards().filter(
			(c) =>
				(!kids || c.kidsSafe === true) &&
				[c.title, c.originalTitle ?? '', ...c.altTitles.map((a) => a.title)].some((s) =>
					foldText(s).includes(needle)
				)
		);
		const movies = hits.filter((c) => c.kind === 'movie');
		const series = hits.filter((c) => c.kind === 'series');
		return {
			query: q,
			total: hits.length,
			movies: movies.map((title, i) => ({ title, score: 100 - i })),
			series: series.map((title, i) => ({ title, score: 100 - i })),
			people: [],
			channels: [],
			genres: []
		};
	}

	async recommend(
		input: { history: string[]; favorites: string[]; kids: boolean; limit?: number },
		signal?: AbortSignal
	): Promise<TitleCard[]> {
		try {
			const r = await this.client.recommend(
				{
					history: input.history.slice(0, 100),
					favorites: input.favorites.slice(0, 100),
					limit: input.limit ?? 24,
					kids: input.kids || undefined
				},
				signal
			);
			const items = (r.items ?? []).filter((t) => t && typeof t.id === 'string');
			return input.kids ? items.filter((t) => t.kidsSafe === true) : items;
		} catch (err) {
			if (isOffline(err)) return [];
			throw err;
		}
	}

	async channels(opts: { kids: boolean }, signal?: AbortSignal): Promise<Channel[]> {
		const r = await this.client.channels({ kids: opts.kids }, signal);
		return (r.items ?? []).filter(
			(c): c is Channel => !!c && typeof c.id === 'string' && Array.isArray(c.variants)
		);
	}

	async epg(
		epgIds: string[],
		from: number,
		to: number,
		signal?: AbortSignal
	): Promise<Record<string, EpgProgramme[]>> {
		const out: Record<string, EpgProgramme[]> = {};
		const span = 48 * HOUR;
		for (const ids of chunks([...new Set(epgIds)], 50)) {
			for (let start = from; start < to; start += span) {
				const r = await this.client.epg(ids, start, Math.min(to, start + span), signal);
				for (const [id, list] of Object.entries(r ?? {})) {
					if (!Array.isArray(list)) continue;
					(out[id] ??= []).push(...list.filter((p) => p && typeof p.start === 'number'));
				}
			}
		}
		return out;
	}

	async nowNext(channelIds: string[], signal?: AbortSignal): Promise<Record<string, NowNext>> {
		const out: Record<string, NowNext> = {};
		for (const ids of chunks([...new Set(channelIds)], 100)) {
			Object.assign(out, (await this.client.nowNext(ids, signal)) ?? {});
		}
		return out;
	}

	/** Forget everything cached on this device. */
	async clear(): Promise<void> {
		this.client.clearEtags();
		await this.cache.clear();
		await this.snapshots.clear();
	}
}

/**
 * A copy of a detail without stream urls (variant.url / altUrls carry the provider
 * credentials), so nothing secret ever reaches the LRU or IndexedDB.
 */
export function stripStreamUrls(d: WireDetail): WireDetail {
	const strip = <V extends { url: string; altUrls?: string[] }>(v: V): V => {
		const { altUrls: _alt, ...rest } = v;
		void _alt;
		return { ...rest, url: '' } as V;
	};
	return {
		...d,
		variants: (d.variants ?? []).map(strip),
		seasons: d.seasons?.map((s) => ({
			...s,
			episodes: (s.episodes ?? []).map((e) => ({ ...e, variants: (e.variants ?? []).map(strip) }))
		}))
	};
}

/** Defensive normalisation of a detail from the wire (arrays always present). */
export function normalizeDetail(d: WireDetail, withSimilar = true): TitleDetail {
	return {
		...d,
		altTitles: d.altTitles ?? [],
		genres: d.genres ?? [],
		cast: d.cast ?? [],
		variants: (d.variants ?? []).filter((v) => v && typeof v.id === 'string'),
		seasons:
			d.kind === 'series'
				? (d.seasons ?? []).filter((s) => s && Array.isArray(s.episodes))
				: d.seasons,
		languages: d.languages ?? [],
		subtitleLanguages: d.subtitleLanguages ?? [],
		qualities: d.qualities ?? [],
		sourceIds: d.sourceIds ?? [],
		rawRefs: d.rawRefs ?? [],
		similar: withSimilar ? (d.similar ?? []).filter((t) => t && typeof t.id === 'string') : []
	};
}

/** Map the backend search response to the view the search page renders. */
export function searchView(q: string, r: SearchResponse, kids: boolean): SearchView {
	const ok = (c: TitleCard | undefined): c is TitleCard =>
		!!c && typeof c.id === 'string' && (!kids || c.kidsSafe === true);
	const akas = r.akas ?? {};
	const hits = (list: TitleCard[] | undefined) =>
		(list ?? []).filter(ok).map((title, i) => ({ title, score: 1000 - i, aka: akas[title.id] }));
	const movies = hits(r.movies);
	const series = hits(r.series);
	const people = (r.people ?? [])
		.map((p, i) => ({
			name: p.name,
			profileUrl: p.profileUrl,
			titles: (p.titles ?? []).filter(ok),
			score: 900 - i
		}))
		.filter((p) => p.titles.length);
	const channels = (r.channels ?? [])
		.filter((c) => c && typeof c.id === 'string')
		.map((channel, i) => ({ channel, score: 800 - i }));
	const genres = (r.genres ?? []).map((g, i) => ({
		genre: g.name,
		slug: g.slug,
		movies: g.movies ?? g.count ?? 1,
		series: g.series ?? 0,
		score: 700 - i
	}));
	// Keep the server's ranking between groups: the first hit of a group gets the best score.
	if (movies[0]) movies[0].score = 1000;
	return {
		query: r.query ?? q,
		total: r.total ?? movies.length + series.length + people.length + channels.length,
		movies,
		series,
		people,
		channels,
		genres
	};
}
