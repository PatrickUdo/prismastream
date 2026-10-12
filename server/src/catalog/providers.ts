// Server-side source loaders: Xtream Codes (player_api.php, streamed lists), M3U (streamed
// download + incremental parser) and XMLTV (streamed, gzip aware, filtered to a time window
// and the channels that exist). Same mapping code as the apps (shared core bundle).
import {
	categoryMap,
	createXmltvCollector,
	M3UParser,
	mapLiveStream,
	mapSeries,
	mapSeriesInfo,
	mapVodStream,
	normalizeServerUrl,
	parseAccount,
	xmltvUrl,
	type EpgProgramme,
	type RawChannel,
	type RawEpisode,
	type RawMovie,
	type RawSeries,
	type XtreamAccount,
	type XtreamCredentials
} from './core.ts';
import {
	fetchJson,
	maybeGunzipText,
	openUpstream,
	SourceError,
	streamJsonList,
	textChunks,
	toSourceError,
	type FetchOptions
} from './fetch.ts';
import { secretList, type ResolvedSource } from './sources.ts';

export interface FetchLimits {
	allowPrivate: boolean;
	timeoutMs: number;
	userAgent: string;
	m3uMaxBytes: number;
	jsonMaxBytes: number;
	xmltvMaxBytes: number;
}

export interface LoadedCatalog {
	movies: RawMovie[];
	series: RawSeries[];
	channels: RawChannel[];
	epgUrls: string[];
	account?: XtreamAccount;
	warnings: string[];
}

export const EPG_PAST = 6 * 3600_000;
export const EPG_FUTURE = 48 * 3600_000;

function opts(src: ResolvedSource, l: FetchLimits, maxBytes: number, timeoutMs = l.timeoutMs): FetchOptions {
	return {
		allowPrivate: l.allowPrivate,
		timeoutMs,
		maxBytes,
		secrets: secretList(src),
		userAgent: l.userAgent
	};
}

export function xtreamCreds(src: ResolvedSource): XtreamCredentials {
	if (!src.serverUrl || !src.username || !src.password)
		throw new SourceError('config', 'Xtream-gegevens onvolledig');
	return {
		serverUrl: normalizeServerUrl(src.serverUrl),
		username: src.username,
		password: src.password
	};
}

function apiUrl(c: XtreamCredentials, action?: string, params: Record<string, string> = {}): string {
	const q = new URLSearchParams({ username: c.username, password: c.password });
	if (action) q.set('action', action);
	for (const [k, v] of Object.entries(params)) q.set(k, v);
	return `${c.serverUrl}/player_api.php?${q}`;
}

/** Account check (player_api.php without action). Maps auth/expired to clear error codes. */
export async function xtreamAccount(src: ResolvedSource, l: FetchLimits): Promise<XtreamAccount> {
	const creds = xtreamCreds(src);
	const data = await fetchJson(apiUrl(creds), opts(src, l, 4 << 20, Math.min(l.timeoutMs, 20_000)));
	try {
		return parseAccount(data);
	} catch (err) {
		const e = toSourceError(err, secretList(src));
		if (e.code === 'expired') {
			const u = (data as { user_info?: { exp_date?: unknown } })?.user_info;
			const exp = Number(u?.exp_date);
			throw new SourceError('expired', e.message, {
				expiresAt: Number.isFinite(exp) && exp > 0 ? exp * 1000 : undefined
			});
		}
		throw e;
	}
}

/**
 * Full Xtream catalog. Lists are fetched one after another (many accounts allow only one
 * connection) and streamed item by item into the mappers. A failing list is a warning; all
 * three failing is an error.
 */
export async function loadXtream(
	src: ResolvedSource,
	l: FetchLimits,
	onStep?: (step: string, ratio: number) => void
): Promise<LoadedCatalog> {
	const creds = xtreamCreds(src);
	onStep?.('auth', 0);
	const account = await xtreamAccount(src, l);
	const warnings: string[] = [];
	const big = opts(src, l, l.jsonMaxBytes, Math.max(l.timeoutMs, 90_000));
	const small = opts(src, l, 16 << 20);
	const soft = async <T>(p: Promise<T>, label: string): Promise<T | undefined> => {
		try {
			return await p;
		} catch (err) {
			warnings.push(`${label}: ${toSourceError(err, big.secrets).message}`);
			return undefined;
		}
	};
	const list = async <T>(
		catAction: string,
		action: string,
		map: (item: Record<string, unknown>, cats: Map<string, string>) => T | undefined
	): Promise<{ out: T[]; ok: boolean }> => {
		const cats = categoryMap(await soft(fetchJson(apiUrl(creds, catAction), small), catAction));
		const out: T[] = [];
		const n = await soft(
			streamJsonList(apiUrl(creds, action), big, (item) => {
				if (!item || typeof item !== 'object' || Array.isArray(item)) return;
				const v = map(item as Record<string, unknown>, cats);
				if (v) out.push(v);
			}),
			action
		);
		return { out, ok: n !== undefined };
	};
	onStep?.('movies', 0.1);
	const movies = await list('get_vod_categories', 'get_vod_streams', (i, cats) =>
		mapVodStream(i, { sourceId: src.id, creds, cats })
	);
	onStep?.('series', 0.4);
	const series = await list('get_series_categories', 'get_series', (i, cats) =>
		mapSeries(i, { sourceId: src.id, cats })
	);
	onStep?.('live', 0.7);
	const channels = await list('get_live_categories', 'get_live_streams', (i, cats) =>
		mapLiveStream(i, { sourceId: src.id, creds, cats })
	);
	if (!movies.ok && !series.ok && !channels.ok)
		throw new SourceError('invalid_response', `Geen enkele lijst kon worden geladen (${warnings.join('; ')})`);
	return {
		movies: movies.out,
		series: series.out,
		channels: channels.out,
		epgUrls: [],
		account,
		warnings
	};
}

/** M3U download, parsed while it streams in. */
export async function loadM3U(src: ResolvedSource, l: FetchLimits): Promise<LoadedCatalog> {
	if (!src.playlistUrl) throw new SourceError('config', 'Geen playlist-url');
	const o = opts(src, l, l.m3uMaxBytes, Math.max(l.timeoutMs, 45_000));
	const up = await openUpstream(src.playlistUrl, o);
	const parser = new M3UParser({ sourceId: src.id });
	let head = '';
	for await (const chunk of textChunks(up.body, o.secrets)) {
		if (head.length < 4096) head += chunk;
		parser.push(chunk);
	}
	const r = parser.end();
	if (!r.entryCount)
		throw new SourceError(
			'invalid_response',
			/^\s*</.test(head)
				? 'De server gaf een webpagina in plaats van een playlist'
				: 'De playlist bevat geen items (is dit een M3U-bestand?)'
		);
	return {
		movies: r.movies,
		series: r.series,
		channels: r.channels,
		epgUrls: r.epgUrls,
		warnings: []
	};
}

/** EPG candidates: explicit override, Xtream xmltv.php, or the M3U header urls. */
export function epgCandidates(src: ResolvedSource, headerUrls: string[]): string[] {
	if (src.epgUrl) return [src.epgUrl];
	if (src.type === 'xtream') return [xmltvUrl(xtreamCreds(src))];
	return headerUrls.filter((u) => /^https?:\/\//i.test(u)).slice(0, 3);
}

/** Streams XMLTV and keeps programmes of known channels within [now-6h, now+48h]. */
export async function loadXmltv(
	src: ResolvedSource,
	urls: string[],
	channelIds: Set<string>,
	l: FetchLimits,
	now = Date.now()
): Promise<EpgProgramme[]> {
	if (!channelIds.size || !urls.length) return [];
	let last: unknown;
	for (const url of urls) {
		try {
			const o = opts(src, l, l.xmltvMaxBytes, Math.max(l.timeoutMs, 60_000));
			o.retries = 1;
			const up = await openUpstream(url, o);
			const c = createXmltvCollector({
				from: now - EPG_PAST,
				to: now + EPG_FUTURE,
				channelIds
			});
			for await (const chunk of maybeGunzipText(up.body, o.secrets, l.xmltvMaxBytes)) c.write(chunk);
			return c.finish().programmes;
		} catch (err) {
			last = err;
		}
	}
	throw toSourceError(last, secretList(src));
}

/** Xtream get_series_info for one series (lazy episodes). */
export async function loadSeriesInfo(
	src: ResolvedSource,
	providerId: string,
	l: FetchLimits
): Promise<{ info: Partial<RawSeries>; episodes: RawEpisode[] }> {
	const creds = xtreamCreds(src);
	const data = await fetchJson(
		apiUrl(creds, 'get_series_info', { series_id: providerId }),
		opts(src, l, 32 << 20)
	);
	return mapSeriesInfo(data, { creds });
}

export interface TestResult {
	ok: true;
	movies: number;
	series: number;
	channels: number;
	expiresAt?: number;
	status?: string;
	maxConnections?: number;
	activeConnections?: number;
	epgSuggestion?: string;
	warnings: string[];
}
