// Minimal TMDB client: search, details (+ credits, videos, alternative titles, translations),
// rate limited (~40 requests / 10 s) with a long-lived response cache.
// Works with a v3 API key (api_key query) or a v4 read access token (Bearer).
import type { LangCode, Person } from '#lib/types.ts';
import type { TmdbKind, TmdbMeta } from './types.ts';

const BASE = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p/';
const DAY = 86_400_000;

export interface TmdbCache {
	get(key: string): Promise<{ at: number; v: unknown } | undefined>;
	set(key: string, value: { at: number; v: unknown }): Promise<void>;
}

/** In-memory cache (tests, or when IndexedDB is unavailable). */
export function memoryCache(): TmdbCache {
	const map = new Map<string, { at: number; v: unknown }>();
	return {
		get: async (k) => map.get(k),
		set: async (k, v) => {
			map.set(k, v);
		}
	};
}

/** Sliding-window limiter: at most `max` calls per `windowMs`. */
export class RateLimiter {
	#stamps: number[] = [];
	constructor(
		readonly max = 40,
		readonly windowMs = 10_000,
		private now: () => number = Date.now,
		private sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))
	) {}

	async take(): Promise<void> {
		for (;;) {
			const t = this.now();
			while (this.#stamps.length && t - this.#stamps[0] >= this.windowMs) this.#stamps.shift();
			if (this.#stamps.length < this.max) {
				this.#stamps.push(t);
				return;
			}
			await this.sleep(this.windowMs - (t - this.#stamps[0]) + 5);
		}
	}
}

export class TmdbError extends Error {
	constructor(
		message: string,
		readonly status?: number
	) {
		super(message);
	}
}

interface ClientOptions {
	fetch?: typeof fetch;
	limiter?: RateLimiter;
	cache?: TmdbCache;
	/** Cache lifetime for hits (default 30 days) and misses (default 7 days). */
	ttl?: number;
	missTtl?: number;
}

type Json = Record<string, unknown>;

function str(v: unknown): string | undefined {
	return typeof v === 'string' && v.trim() ? v : undefined;
}
function num(v: unknown): number | undefined {
	return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}
function arr(v: unknown): Json[] {
	return Array.isArray(v) ? (v as Json[]) : [];
}
const US_RATINGS: Record<string, string> = {
	G: 'AL',
	'TV-Y': 'AL',
	'TV-G': 'AL',
	'TV-Y7': '6',
	PG: '6',
	'TV-PG': '9',
	'PG-13': '12',
	'TV-14': '14',
	R: '16',
	'TV-MA': '16',
	'NC-17': '18'
};

/** Normalise a certification to Kijkwijzer-style ages ('AL', '6', '9', '12', '14', '16', '18'). */
export function normalizeCertification(
	country: string,
	value: string | undefined
): string | undefined {
	const v = value?.trim().toUpperCase();
	if (!v) return undefined;
	if (country === 'US') return US_RATINGS[v];
	if (v === 'AL' || v === '0' || v === 'U' || v === 'TOUS PUBLICS') return 'AL';
	const n = /^(\d{1,2})/.exec(v);
	return n ? String(Number(n[1])) : undefined;
}

function certificationOf(kind: TmdbKind, d: Json): string | undefined {
	const order = ['NL', 'BE', 'DE', 'GB', 'US'];
	const found = new Map<string, string>();
	if (kind === 'movie') {
		for (const r of arr((d.release_dates as Json | undefined)?.results)) {
			const c = str(r.iso_3166_1);
			const cert = arr(r.release_dates)
				.map((x) => str(x.certification))
				.find(Boolean);
			if (c && cert) found.set(c, cert);
		}
	} else {
		for (const r of arr((d.content_ratings as Json | undefined)?.results)) {
			const c = str(r.iso_3166_1);
			const cert = str(r.rating);
			if (c && cert) found.set(c, cert);
		}
	}
	for (const c of order) {
		const n = normalizeCertification(c, found.get(c));
		if (n) return n;
	}
	return undefined;
}

function yearOf(date?: string): number | undefined {
	const m = date ? /^(\d{4})/.exec(date) : null;
	return m ? Number(m[1]) : undefined;
}

export class TmdbClient {
	readonly #key: string;
	readonly #bearer: boolean;
	readonly #fetch: typeof fetch;
	readonly #limiter: RateLimiter;
	readonly #cache: TmdbCache;
	readonly #ttl: number;
	readonly #missTtl: number;

	constructor(apiKey: string, opts: ClientOptions = {}) {
		this.#key = apiKey.trim();
		this.#bearer = this.#key.startsWith('eyJ') || this.#key.length > 40;
		this.#fetch = opts.fetch ?? ((...args) => fetch(...args));
		this.#limiter = opts.limiter ?? new RateLimiter();
		this.#cache = opts.cache ?? memoryCache();
		this.#ttl = opts.ttl ?? 30 * DAY;
		this.#missTtl = opts.missTtl ?? 7 * DAY;
	}

	async #get(path: string, params: Record<string, string | number | undefined>): Promise<Json> {
		const qs = new URLSearchParams();
		for (const [k, v] of Object.entries(params))
			if (v !== undefined && v !== '') qs.set(k, String(v));
		const cacheKey = `${path}?${qs}`;
		const cached = await this.#cache.get(cacheKey).catch(() => undefined);
		const now = Date.now();
		if (cached && now - cached.at < (cached.v ? this.#ttl : this.#missTtl)) {
			if (!cached.v) throw new TmdbError('not found', 404);
			return cached.v as Json;
		}
		if (!this.#bearer) qs.set('api_key', this.#key);
		await this.#limiter.take();
		const res = await this.#fetch(`${BASE}${path}?${qs}`, {
			headers: this.#bearer
				? { Authorization: `Bearer ${this.#key}`, Accept: 'application/json' }
				: { Accept: 'application/json' }
		});
		if (res.status === 404) {
			await this.#cache.set(cacheKey, { at: now, v: null }).catch(() => {});
			throw new TmdbError('not found', 404);
		}
		if (!res.ok) throw new TmdbError(`TMDB ${res.status}`, res.status);
		const json = (await res.json()) as Json;
		await this.#cache.set(cacheKey, { at: now, v: json }).catch(() => {});
		return json;
	}

	/** Find a TMDB id by title (+ year, ±1 tolerated). */
	async search(
		kind: TmdbKind,
		query: string,
		year?: number,
		lang: LangCode = 'en'
	): Promise<number | null> {
		const path = kind === 'movie' ? '/search/movie' : '/search/tv';
		const yearParam = kind === 'movie' ? 'year' : 'first_air_date_year';
		const run = async (y?: number) =>
			arr(
				(await this.#get(path, { query, [yearParam]: y, language: lang, include_adult: 'false' }))
					.results
			);
		let results = await run(year);
		if (!results.length && year) {
			results = (await run()).filter((r) => {
				const ry = yearOf(str(r.release_date) ?? str(r.first_air_date));
				return ry !== undefined && Math.abs(ry - year) <= 1;
			});
		}
		const first = results[0];
		return first ? (num(first.id) ?? null) : null;
	}

	/** Full metadata for one title, overview/genres in `lang`. */
	async details(kind: TmdbKind, id: number, lang: LangCode = 'en'): Promise<TmdbMeta> {
		const path = kind === 'movie' ? `/movie/${id}` : `/tv/${id}`;
		const d = await this.#get(path, {
			language: lang,
			append_to_response: `credits,videos,alternative_titles,translations,external_ids,${
				kind === 'movie' ? 'release_dates' : 'content_ratings'
			}`,
			include_video_language: `${lang},en,null`
		});
		const credits = (d.credits ?? {}) as Json;
		const cast: Person[] = arr(credits.cast)
			.slice(0, 15)
			.map((c) => ({
				name: str(c.name) ?? '',
				character: str(c.character),
				profileUrl: str(c.profile_path) ? `${IMG}w185${c.profile_path}` : undefined
			}))
			.filter((p) => p.name);
		const director =
			kind === 'movie'
				? str(arr(credits.crew).find((c) => c.job === 'Director')?.name)
				: str(arr(d.created_by)[0]?.name);
		const video = arr((d.videos as Json | undefined)?.results).find(
			(v) => v.site === 'YouTube' && (v.type === 'Trailer' || v.type === 'Teaser')
		);
		const altTitles: TmdbMeta['altTitles'] = [];
		for (const t of arr((d.translations as Json | undefined)?.translations)) {
			const data = (t.data ?? {}) as Json;
			const title = str(data.title) ?? str(data.name);
			const l = str(t.iso_639_1);
			if (title) altTitles.push({ title, lang: l });
		}
		const alt = (d.alternative_titles ?? {}) as Json;
		for (const t of arr(alt.titles ?? alt.results)) {
			const title = str(t.title);
			if (title) altTitles.push({ title });
		}
		const releaseDate = str(d.release_date) ?? str(d.first_air_date);
		const runtime = num(d.runtime) ?? num(arr(d.episode_run_time)[0] as unknown);
		return {
			id,
			kind,
			title: str(d.title) ?? str(d.name) ?? '',
			originalTitle: str(d.original_title) ?? str(d.original_name),
			originalLang: str(d.original_language),
			overview: str(d.overview),
			genres: arr(d.genres)
				.map((g) => str(g.name))
				.filter((g): g is string => !!g),
			runtimeMin: runtime || undefined,
			releaseDate,
			year: yearOf(releaseDate),
			rating: num(d.vote_average) ? Math.round(num(d.vote_average)! * 10) / 10 : undefined,
			cast,
			director,
			posterUrl: str(d.poster_path) ? `${IMG}w500${d.poster_path}` : undefined,
			backdropUrl: str(d.backdrop_path) ? `${IMG}w1280${d.backdrop_path}` : undefined,
			trailerUrl: video ? `https://www.youtube.com/watch?v=${video.key}` : undefined,
			imdbId: str(d.imdb_id) ?? str((d.external_ids as Json | undefined)?.imdb_id),
			certification: certificationOf(kind, d),
			altTitles,
			lang,
			fetchedAt: Date.now()
		};
	}
}
