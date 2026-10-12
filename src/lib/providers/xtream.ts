// Xtream Codes API client (player_api.php) and mapping to Raw* types.
//
// Endpoints: account info (no action), get_vod_categories, get_vod_streams,
// get_series_categories, get_series, get_series_info (lazy, per series),
// get_live_categories, get_live_streams, get_short_epg, and xmltv.php for the guide.
//
// Stream urls:
//   movie:   {server}/movie/{u}/{p}/{stream_id}.{container_extension}
//   episode: {server}/series/{u}/{p}/{episode_id}.{container_extension}
//   live:    {server}/live/{u}/{p}/{stream_id}.m3u8   (HLS; best for the player)
//            {server}/live/{u}/{p}/{stream_id}.ts     (MPEG-TS fallback: liveTsUrl())
//
// Real-world panels are messy: numbers arrive as strings, empty strings mean "unknown",
// fields are missing or null, `episodes` may be an object keyed by season or an array,
// and short_epg titles are base64. Every field goes through the tolerant helpers in util.ts.
import type { EpgProgramme, RawChannel, RawMovie, RawSeries } from '#lib/types.ts';
import { fetchJSON, HttpError, type HttpOptions } from '#lib/providers/http.ts';
import {
	asArray,
	categoryMap,
	mapLiveStream,
	mapSeries,
	mapShortEpg,
	mapVodStream,
	normalizeServerUrl,
	parseAccount,
	xmltvUrl,
	type Json,
	type XtreamAccount,
	type XtreamCredentials
} from '#lib/providers/xtream-map.ts';

export * from '#lib/providers/xtream-map.ts';

/**
 * If the user pasted a full Xtream url (get.php?username=..&password=..), extract the
 * parts. Returns undefined when the input has no credentials.
 */
export function parseXtreamUrl(input: string): XtreamCredentials | undefined {
	try {
		const u = new URL(input.trim());
		const username = u.searchParams.get('username');
		const password = u.searchParams.get('password');
		if (!username || !password) return undefined;
		return {
			serverUrl: normalizeServerUrl(`${u.protocol}//${u.host}${u.pathname}`),
			username,
			password
		};
	} catch {
		return undefined;
	}
}

export class XtreamClient {
	readonly creds: XtreamCredentials;
	readonly http: HttpOptions;

	constructor(creds: XtreamCredentials, http: HttpOptions = {}) {
		this.creds = { ...creds, serverUrl: normalizeServerUrl(creds.serverUrl) };
		this.http = { ...http, secrets: [creds.password, creds.username, ...(http.secrets ?? [])] };
	}

	apiUrl(action?: string, params: Record<string, string> = {}): string {
		const q = new URLSearchParams({ username: this.creds.username, password: this.creds.password });
		if (action) q.set('action', action);
		for (const [k, v] of Object.entries(params)) q.set(k, v);
		return `${this.creds.serverUrl}/player_api.php?${q}`;
	}

	async #get<T>(action?: string, params?: Record<string, string>, timeoutMs?: number): Promise<T> {
		return fetchJSON<T>(this.apiUrl(action, params), {
			...this.http,
			timeoutMs: timeoutMs ?? this.http.timeoutMs
		});
	}

	/** Account info; throws HttpError('auth' | 'expired' | ...) on problems. */
	async authenticate(): Promise<XtreamAccount> {
		return parseAccount(await this.#get(undefined, undefined, 15_000));
	}

	vodCategories() {
		return this.#get<unknown>('get_vod_categories');
	}
	seriesCategories() {
		return this.#get<unknown>('get_series_categories');
	}
	liveCategories() {
		return this.#get<unknown>('get_live_categories');
	}
	/** Large lists: allow 90 s. */
	vodStreams() {
		return this.#get<unknown>('get_vod_streams', undefined, 90_000);
	}
	series() {
		return this.#get<unknown>('get_series', undefined, 90_000);
	}
	liveStreams() {
		return this.#get<unknown>('get_live_streams', undefined, 90_000);
	}
	seriesInfo(seriesId: string) {
		return this.#get<unknown>('get_series_info', { series_id: seriesId });
	}
	async shortEpg(streamId: string, channelId = streamId, limit = 10): Promise<EpgProgramme[]> {
		const d = await this.#get<Json>('get_short_epg', { stream_id: streamId, limit: String(limit) });
		return asArray(d?.epg_listings)
			.map((x) => mapShortEpg(x, channelId))
			.filter((x): x is EpgProgramme => !!x);
	}
	xmltvUrl(): string {
		return xmltvUrl(this.creds);
	}
}

export interface XtreamLoadResult {
	account: XtreamAccount;
	movies: RawMovie[];
	series: RawSeries[];
	channels: RawChannel[];
}

/**
 * Fetch the full VOD/series/live catalog. Category lists are optional (a failing
 * category call only loses category names). A failing stream list is fatal only if
 * every list fails; partial results are returned with `warnings`.
 */
export async function loadXtreamCatalog(
	client: XtreamClient,
	sourceId: string,
	onStep?: (step: 'auth' | 'movies' | 'series' | 'live', done: number, total: number) => void
): Promise<XtreamLoadResult & { warnings: string[] }> {
	onStep?.('auth', 0, 4);
	const account = await client.authenticate();
	const warnings: string[] = [];
	const ctxBase = { sourceId, creds: client.creds };
	const soft = async <T>(p: Promise<T>, label: string): Promise<T | undefined> => {
		try {
			return await p;
		} catch (err) {
			warnings.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
			return undefined;
		}
	};
	let done = 1;
	const step = (s: 'movies' | 'series' | 'live') => onStep?.(s, ++done, 4);

	const [movies, series, channels] = await Promise.all([
		(async () => {
			const [cats, items] = await Promise.all([
				soft(client.vodCategories(), 'vod_categories'),
				soft(client.vodStreams(), 'vod_streams')
			]);
			const ctx = { ...ctxBase, cats: categoryMap(cats) };
			const out = asArray(items)
				.map((i) => mapVodStream(i, ctx))
				.filter((x): x is RawMovie => !!x);
			step('movies');
			return { out, ok: items !== undefined };
		})(),
		(async () => {
			const [cats, items] = await Promise.all([
				soft(client.seriesCategories(), 'series_categories'),
				soft(client.series(), 'series')
			]);
			const ctx = { sourceId, cats: categoryMap(cats) };
			const out = asArray(items)
				.map((i) => mapSeries(i, ctx))
				.filter((x): x is RawSeries => !!x);
			step('series');
			return { out, ok: items !== undefined };
		})(),
		(async () => {
			const [cats, items] = await Promise.all([
				soft(client.liveCategories(), 'live_categories'),
				soft(client.liveStreams(), 'live_streams')
			]);
			const ctx = { ...ctxBase, cats: categoryMap(cats) };
			const out = asArray(items)
				.map((i) => mapLiveStream(i, ctx))
				.filter((x): x is RawChannel => !!x);
			step('live');
			return { out, ok: items !== undefined };
		})()
	]);
	if (!movies.ok && !series.ok && !channels.ok) {
		throw new HttpError('invalid', `Xtream: no lists could be loaded (${warnings.join('; ')})`);
	}
	return { account, movies: movies.out, series: series.out, channels: channels.out, warnings };
}
