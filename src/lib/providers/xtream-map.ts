// Pure Xtream Codes mapping: API JSON → Raw* types, stream urls and account info.
// No network and no platform imports, so the web app and the Apple TV core (JavaScriptCore)
// share it. The client and loader live in xtream.ts, which re-exports everything here.
import type { EpgProgramme, RawChannel, RawEpisode, RawMovie, RawSeries } from '#lib/types.ts';
import { HttpError } from '#lib/providers/errors.ts';
import {
	decodeBase64Utf8,
	durationToSec,
	httpUrl,
	list,
	num,
	posInt,
	splitUrl,
	str,
	unixToMs,
	year,
	youtubeUrl
} from '#lib/providers/util.ts';

export interface XtreamCredentials {
	serverUrl: string;
	username: string;
	password: string;
}

export interface XtreamAccount {
	status: string;
	/** Epoch ms, undefined = unlimited. */
	expiresAt?: number;
	maxConnections?: number;
	activeConnections?: number;
	isTrial: boolean;
	createdAt?: number;
	/** Timezone reported by the server, if any. */
	timezone?: string;
	allowedFormats?: string[];
}

export type Json = Record<string, unknown>;

/**
 * Normalise what users type as server: add http://, strip trailing slashes and
 * known endpoint paths (player_api.php, get.php, xmltv.php, panel_api.php).
 */
export function normalizeServerUrl(input: string): string {
	let s = input.trim();
	if (!s) return s;
	if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = 'http://' + s;
	const u = splitUrl(s);
	if (!u) return s.replace(/\/+$/, '');
	let path = u.pathname.replace(/\/(player_api|get|xmltv|panel_api)\.php$/i, '');
	path = path.replace(/\/+$/, '');
	return `${u.protocol}//${u.host}${path}`;
}

const enc = encodeURIComponent;

export function movieUrl(c: XtreamCredentials, streamId: string, ext = 'mp4'): string {
	return `${normalizeServerUrl(c.serverUrl)}/movie/${enc(c.username)}/${enc(c.password)}/${streamId}.${ext}`;
}
export function episodeUrl(c: XtreamCredentials, episodeId: string, ext = 'mp4'): string {
	return `${normalizeServerUrl(c.serverUrl)}/series/${enc(c.username)}/${enc(c.password)}/${episodeId}.${ext}`;
}
export function liveUrl(
	c: XtreamCredentials,
	streamId: string,
	ext: 'm3u8' | 'ts' = 'm3u8'
): string {
	return `${normalizeServerUrl(c.serverUrl)}/live/${enc(c.username)}/${enc(c.password)}/${streamId}.${ext}`;
}
/** MPEG-TS alternative for an Xtream live url (some panels only serve .ts). */
export function liveTsUrl(url: string): string | undefined {
	return /\/live\/[^/]+\/[^/]+\/[^/]+\.m3u8(\?|$)/.test(url)
		? url.replace(/\.m3u8(\?|$)/, '.ts$1')
		: undefined;
}
export function xmltvUrl(c: XtreamCredentials): string {
	return `${normalizeServerUrl(c.serverUrl)}/xmltv.php?username=${enc(c.username)}&password=${enc(c.password)}`;
}

function cleanExt(v: unknown, fallback: string): string {
	const s = str(v)?.replace(/^\./, '').toLowerCase();
	return s && /^[a-z0-9]{2,5}$/.test(s) ? s : fallback;
}

export function asArray(v: unknown): Json[] {
	if (Array.isArray(v)) return v.filter((x): x is Json => !!x && typeof x === 'object');
	// Some panels return an object keyed by index instead of an array.
	if (v && typeof v === 'object')
		return Object.values(v).filter((x): x is Json => !!x && typeof x === 'object');
	return [];
}

/** Map of category_id → category_name. */
export function categoryMap(cats: unknown): Map<string, string> {
	const m = new Map<string, string>();
	for (const c of asArray(cats)) {
		const id = str(c.category_id);
		const name = str(c.category_name);
		if (id && name) m.set(id, name);
	}
	return m;
}

function category(item: Json, cats: Map<string, string>): string | undefined {
	const id = str(item.category_id) ?? str(asStrList(item.category_ids)[0]);
	return id ? cats.get(id) : undefined;
}

function asStrList(v: unknown): string[] {
	return Array.isArray(v) ? v.map((x) => str(x)).filter((x): x is string => !!x) : [];
}

function rating(item: Json): number | undefined {
	const r = num(item.rating);
	if (r !== undefined && r > 0 && r <= 10) return r;
	const r5 = num(item.rating_5based);
	if (r5 !== undefined && r5 > 0 && r5 <= 5) return Math.round(r5 * 20) / 10;
	return undefined;
}

function firstUrl(v: unknown): string | undefined {
	if (Array.isArray(v)) {
		for (const x of v) {
			const u = httpUrl(x);
			if (u) return u;
		}
		return undefined;
	}
	return httpUrl(v);
}

function releaseDate(item: Json): string | undefined {
	return (
		str(item.releasedate) ?? str(item.releaseDate) ?? str(item.release_date) ?? str(item.air_date)
	);
}

function imdb(v: unknown): string | undefined {
	const s = str(v);
	return s && /^tt\d{5,}$/.test(s) ? s : undefined;
}

/** get_vod_streams item → RawMovie. */
export function mapVodStream(
	item: Json,
	ctx: { sourceId: string; creds: XtreamCredentials; cats: Map<string, string> }
): RawMovie | undefined {
	const id = str(item.stream_id);
	const rawTitle = str(item.name) ?? str(item.title);
	if (!id || !rawTitle) return undefined;
	const ext = cleanExt(item.container_extension, 'mp4');
	const rd = releaseDate(item);
	return {
		kind: 'movie',
		sourceId: ctx.sourceId,
		providerId: id,
		rawTitle,
		category: category(item, ctx.cats),
		originalTitle: str(item.o_name) ?? str(item.original_name),
		year: year(item.year) ?? year(rd),
		tmdbId: posInt(item.tmdb) ?? posInt(item.tmdb_id),
		imdbId: imdb(item.imdb) ?? imdb(item.imdb_id),
		posterUrl: httpUrl(item.stream_icon) ?? httpUrl(item.cover) ?? httpUrl(item.cover_big),
		backdropUrl: firstUrl(item.backdrop_path),
		plot: str(item.plot) ?? str(item.description),
		genres: list(item.genre),
		cast: list(item.cast) ?? list(item.actors),
		director: str(item.director),
		releaseDate: rd,
		rating: rating(item),
		durationSec:
			num(item.duration_secs) ||
			durationToSec(item.episode_run_time) ||
			durationToSec(item.duration, 'min'),
		trailerUrl: youtubeUrl(item.youtube_trailer) ?? youtubeUrl(item.trailer),
		addedAt: unixToMs(item.added),
		url: movieUrl(ctx.creds, id, ext),
		containerExt: ext
	};
}

/** get_series item → RawSeries (episodes are loaded lazily via get_series_info). */
export function mapSeries(
	item: Json,
	ctx: { sourceId: string; cats: Map<string, string> }
): RawSeries | undefined {
	const id = str(item.series_id);
	const rawTitle = str(item.name) ?? str(item.title);
	if (!id || !rawTitle) return undefined;
	const rd = releaseDate(item);
	return {
		kind: 'series',
		sourceId: ctx.sourceId,
		providerId: id,
		rawTitle,
		category: category(item, ctx.cats),
		year: year(item.year) ?? year(rd),
		tmdbId: posInt(item.tmdb) ?? posInt(item.tmdb_id),
		imdbId: imdb(item.imdb) ?? imdb(item.imdb_id),
		posterUrl: httpUrl(item.cover) ?? httpUrl(item.stream_icon),
		backdropUrl: firstUrl(item.backdrop_path),
		plot: str(item.plot) ?? str(item.description),
		genres: list(item.genre),
		cast: list(item.cast),
		director: str(item.director),
		releaseDate: rd,
		rating: rating(item),
		durationSec: durationToSec(item.episode_run_time),
		trailerUrl: youtubeUrl(item.youtube_trailer),
		addedAt: unixToMs(item.last_modified) ?? unixToMs(item.added)
	};
}

/** get_live_streams item → RawChannel. */
export function mapLiveStream(
	item: Json,
	ctx: { sourceId: string; creds: XtreamCredentials; cats: Map<string, string> }
): RawChannel | undefined {
	const id = str(item.stream_id);
	const rawName = str(item.name);
	if (!id || !rawName) return undefined;
	const archive = num(item.tv_archive);
	const archiveDays = num(item.tv_archive_duration);
	const n = posInt(item.num);
	return {
		kind: 'live',
		sourceId: ctx.sourceId,
		providerId: id,
		rawName,
		tvgId: str(item.epg_channel_id),
		logoUrl: httpUrl(item.stream_icon),
		group: category(item, ctx.cats),
		number: n,
		url: liveUrl(ctx.creds, id),
		catchupDays: archive && archiveDays && archiveDays > 0 ? archiveDays : undefined
	};
}

/** get_series_info → { series metadata patch, episodes }. */
export function mapSeriesInfo(
	data: unknown,
	ctx: { creds: XtreamCredentials }
): { info: Partial<RawSeries>; episodes: RawEpisode[] } {
	const d = (data && typeof data === 'object' ? data : {}) as Json;
	const info = (d.info && typeof d.info === 'object' ? d.info : {}) as Json;
	const episodes: RawEpisode[] = [];
	const groups: [string | undefined, unknown][] = [];
	if (Array.isArray(d.episodes)) {
		// Either a flat list, or an array of per-season arrays.
		for (const g of d.episodes) groups.push([undefined, Array.isArray(g) ? g : [g]]);
	} else if (d.episodes && typeof d.episodes === 'object') {
		for (const [k, v] of Object.entries(d.episodes as Json)) groups.push([k, v]);
	}
	const seen = new Set<string>();
	for (const [seasonKey, eps] of groups) {
		for (const ep of asArray(eps)) {
			const id = str(ep.id) ?? str(ep.stream_id);
			if (!id || seen.has(id)) continue;
			seen.add(id);
			const epInfo = (
				ep.info && typeof ep.info === 'object' && !Array.isArray(ep.info) ? ep.info : {}
			) as Json;
			const season = num(ep.season) ?? num(epInfo.season) ?? num(seasonKey) ?? 1;
			const episodeNum = num(ep.episode_num) ?? num(epInfo.episode_num) ?? episodes.length + 1;
			const ext = cleanExt(ep.container_extension, 'mp4');
			episodes.push({
				providerId: id,
				season: Math.max(0, Math.trunc(season)),
				episode: Math.max(0, Math.trunc(episodeNum)),
				title: str(ep.title) ?? str(epInfo.name),
				plot: str(epInfo.plot) ?? str(epInfo.overview),
				durationSec: num(epInfo.duration_secs) || durationToSec(epInfo.duration, 'min'),
				stillUrl:
					httpUrl(epInfo.movie_image) ?? httpUrl(epInfo.cover_big) ?? httpUrl(epInfo.still_path),
				airDate: str(epInfo.releasedate) ?? str(epInfo.release_date) ?? str(epInfo.air_date),
				url: episodeUrl(ctx.creds, id, ext),
				containerExt: ext
			});
		}
	}
	episodes.sort((a, b) => a.season - b.season || a.episode - b.episode);
	const rd = releaseDate(info);
	const patch: Partial<RawSeries> = {
		plot: str(info.plot),
		genres: list(info.genre),
		cast: list(info.cast),
		director: str(info.director),
		releaseDate: rd,
		year: year(rd),
		rating: rating(info),
		backdropUrl: firstUrl(info.backdrop_path),
		posterUrl: httpUrl(info.cover),
		trailerUrl: youtubeUrl(info.youtube_trailer),
		tmdbId: posInt(info.tmdb) ?? posInt(info.tmdb_id),
		durationSec: durationToSec(info.episode_run_time)
	};
	for (const k of Object.keys(patch) as (keyof typeof patch)[])
		if (patch[k] === undefined) delete patch[k];
	return { info: patch, episodes };
}

/** user_info block → XtreamAccount; throws HttpError('auth'|'expired'|'invalid'). */
export function parseAccount(data: unknown): XtreamAccount {
	const d = (data && typeof data === 'object' ? data : {}) as Json;
	const u = d.user_info as Json | undefined;
	if (!u || typeof u !== 'object') {
		throw new HttpError(
			'invalid',
			'No user_info in Xtream response (is this an Xtream Codes server?)'
		);
	}
	const auth = num(u.auth);
	if (auth === 0) throw new HttpError('auth', 'Xtream login rejected (auth: 0)');
	const status = str(u.status) ?? 'Unknown';
	const expiresAt = unixToMs(u.exp_date);
	if (/^(expired|banned|disabled)$/i.test(status) || (expiresAt && expiresAt < Date.now()))
		throw new HttpError('expired', `Xtream account status: ${status}`);
	const server = (d.server_info ?? {}) as Json;
	return {
		status,
		expiresAt,
		maxConnections: num(u.max_connections),
		activeConnections: num(u.active_cons),
		isTrial: num(u.is_trial) === 1,
		createdAt: unixToMs(u.created_at),
		timezone: str(server.timezone),
		allowedFormats: asStrList(u.allowed_output_formats)
	};
}

/** short_epg item → EpgProgramme (base64 titles/descriptions decoded). */
export function mapShortEpg(item: Json, channelId: string): EpgProgramme | undefined {
	const start =
		unixToMs(item.start_timestamp) ?? Date.parse(String(item.start ?? '').replace(' ', 'T') + 'Z');
	const stop =
		unixToMs(item.stop_timestamp) ??
		Date.parse(String(item.end ?? item.stop ?? '').replace(' ', 'T') + 'Z');
	if (!Number.isFinite(start) || !Number.isFinite(stop)) return undefined;
	return {
		channelId: str(item.epg_id) ?? str(item.channel_id) ?? channelId,
		start,
		stop,
		title: decodeBase64Utf8(item.title) ?? '—',
		desc: decodeBase64Utf8(item.description)
	};
}
