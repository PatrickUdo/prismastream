// M3U / M3U8 playlist parser (extended M3U with IPTV attributes).
//
// - Reads line by line with indexOf (no regex over the whole file), incremental via
//   `M3UParser.push(chunk)` so a streamed download can be parsed as it arrives.
// - #EXTM3U header: url-tvg / x-tvg-url / tvg-url → epgUrls (suggestion for the EPG).
// - #EXTINF attributes: tvg-id, tvg-name, tvg-logo, group-title, tvg-language,
//   tvg-country, tvg-chno, catchup-days, tvg-type; display name after the attributes.
// - #EXTGRP sets the group when group-title is missing. #EXTVLCOPT / #KODIPROP are ignored.
// - Each entry is classified as live / movie / series episode (see `classify`).
//   Episodes are grouped into one RawSeries per (group, series name).
// - providerId = stable hash of the stream url.
import type { RawChannel, RawEpisode, RawMovie, RawSeries } from '#lib/types.ts';
import { hashString, str, toLangCode, urlExt, year as parseYear } from '#lib/providers/util.ts';

export interface M3UEntry {
	name: string;
	url: string;
	duration: number;
	attrs: Record<string, string>;
	group?: string;
}

export interface M3UResult {
	/** XMLTV urls announced in the #EXTM3U header. */
	epgUrls: string[];
	movies: RawMovie[];
	series: RawSeries[];
	channels: RawChannel[];
	/** Total entries seen (including skipped malformed ones). */
	entryCount: number;
}

export interface M3UOptions {
	sourceId: string;
}

const VOD_EXT = new Set([
	'mp4',
	'mkv',
	'avi',
	'mov',
	'wmv',
	'm4v',
	'flv',
	'webm',
	'mpg',
	'mpeg',
	'divx',
	'xvid',
	'3gp',
	'ogv',
	'vob'
]);
const LIVE_EXT = new Set(['ts', 'm2ts']);

const SERIES_GROUP = /\b(series|séries|serie|serien|seriale|dizi|tv[ -]?shows?|shows)\b/i;
const MOVIE_GROUP = /\b(vod|movies?|films?|filme|filmes|películas|peliculas|cinema|kino)\b/i;

// Episode markers inside a display name. Anchored on word boundaries; no nested
// quantifiers, so matching cost is linear in the (short) name.
const EP_PATTERNS: RegExp[] = [
	/\bS(\d{1,3})\s?[-._]?\s?E(\d{1,4})\b/i,
	/\b(\d{1,2})x(\d{2,3})\b/,
	/\b(?:season|seizoen|saison|staffel|temporada)\s?(\d{1,3})\s?[-.,:]?\s?(?:episode|ep|aflevering|afl|épisode|folge|episodio|capitulo|capítulo)\.?\s?(\d{1,4})\b/i
];

export interface EpisodeMatch {
	series: string;
	season: number;
	episode: number;
	title?: string;
}

/** Detect "Show S01E02 Title" / "Show 1x02" / "Show Season 1 Episode 2". */
export function parseEpisodeName(name: string): EpisodeMatch | undefined {
	for (const re of EP_PATTERNS) {
		const m = re.exec(name);
		if (!m) continue;
		const series = name
			.slice(0, m.index)
			.replace(/[\s\-–—:|.,_([]+$/u, '')
			.trim();
		const rest = name
			.slice(m.index + m[0].length)
			.replace(/^[\s\-–—:|.,_)\]]+/u, '')
			.trim();
		if (!series) continue;
		return {
			series,
			season: Number(m[1]),
			episode: Number(m[2]),
			title: rest || undefined
		};
	}
	return undefined;
}

export type EntryKind = 'live' | 'movie' | 'episode';

/** Decide what an entry is, using (in order) explicit type, url path, name, extension, group. */
export function classify(e: M3UEntry): EntryKind {
	const type = (e.attrs['tvg-type'] ?? e.attrs['type'] ?? '').toLowerCase();
	if (type === 'live' || type === 'channel') return 'live';
	if (type === 'movie' || type === 'movies' || type === 'vod') return 'movie';
	if (type === 'series' || type === 'episode') return 'episode';

	const path = pathOf(e.url).toLowerCase();
	if (path.includes('/movie/') || path.includes('/movies/')) return 'movie';
	if (path.includes('/series/')) return 'episode';
	if (path.includes('/live/')) return 'live';

	const ext = urlExt(e.url);
	if (ext && LIVE_EXT.has(ext)) return 'live';
	const vodExt = !!ext && VOD_EXT.has(ext);
	const group = e.group ?? '';

	// An episode marker wins unless the entry looks like an HLS live stream outside a series group.
	if (parseEpisodeName(e.name) && (ext !== 'm3u8' || SERIES_GROUP.test(group))) return 'episode';
	if (vodExt) return 'movie';
	if (e.duration > 0) return 'movie';
	if (ext === 'm3u8' || !ext) {
		// HLS / extensionless: only a strong group hint turns it into VOD.
		if (/\bvod\b/i.test(group)) return 'movie';
		return 'live';
	}
	if (MOVIE_GROUP.test(group) || SERIES_GROUP.test(group)) return 'movie';
	return 'live';
}

function pathOf(url: string): string {
	const scheme = url.indexOf('://');
	const start = scheme === -1 ? 0 : url.indexOf('/', scheme + 3);
	if (start === -1) return '/';
	let end = url.length;
	const q = url.indexOf('?', start);
	if (q !== -1) end = q;
	return url.slice(start, end);
}

/**
 * Parse an attribute list: `key="value" key2='v' key3=bare`, stopping at the first
 * unquoted comma. Returns the index after that comma (or -1 if none).
 */
export function parseAttrs(line: string, from: number, attrs: Record<string, string>): number {
	const n = line.length;
	let i = from;
	while (i < n) {
		let c = line.charCodeAt(i);
		// skip whitespace
		while (i < n && (c === 32 || c === 9)) c = line.charCodeAt(++i);
		if (i >= n) return -1;
		if (c === 44 /* , */) return i + 1;
		// key
		const ks = i;
		while (i < n) {
			c = line.charCodeAt(i);
			if (c === 61 /* = */ || c === 32 || c === 9 || c === 44) break;
			i++;
		}
		const key = line.slice(ks, i).toLowerCase();
		if (c !== 61) {
			// bare token without value (e.g. the duration or junk): skip
			if (i === ks) i++;
			continue;
		}
		i++; // '='
		let value: string;
		const q = line.charCodeAt(i);
		if (q === 34 /* " */ || q === 39 /* ' */) {
			const close = line.indexOf(q === 34 ? '"' : "'", i + 1);
			if (close === -1) {
				// Unclosed quote: value runs to the last comma; name follows it.
				const lastComma = line.lastIndexOf(',');
				const end = lastComma > i ? lastComma : n;
				value = line.slice(i + 1, end);
				if (key) attrs[key] = value.trim();
				return lastComma > i ? lastComma + 1 : -1;
			}
			value = line.slice(i + 1, close);
			i = close + 1;
		} else {
			const vs = i;
			while (i < n) {
				c = line.charCodeAt(i);
				if (c === 32 || c === 9 || c === 44) break;
				i++;
			}
			value = line.slice(vs, i);
		}
		if (key) attrs[key] = value.trim();
	}
	return -1;
}

/** Parse one `#EXTINF:` line into duration, attributes and display name. */
export function parseExtinf(line: string): {
	duration: number;
	attrs: Record<string, string>;
	name: string;
} {
	const attrs: Record<string, string> = {};
	let i = 8; // after '#EXTINF:'
	const n = line.length;
	while (i < n && line.charCodeAt(i) === 32) i++;
	const ds = i;
	while (i < n) {
		const c = line.charCodeAt(i);
		if (c === 32 || c === 44 || c === 9) break;
		i++;
	}
	const duration = Number(line.slice(ds, i));
	let name = '';
	const after = parseAttrs(line, i, attrs);
	if (after !== -1) name = line.slice(after).trim();
	else {
		const lastComma = line.lastIndexOf(',');
		if (lastComma !== -1) name = line.slice(lastComma + 1).trim();
	}
	return { duration: Number.isFinite(duration) ? duration : -1, attrs, name };
}

/** Incremental M3U parser. Call push() with chunks, then end(). */
export class M3UParser {
	readonly sourceId: string;
	epgUrls: string[] = [];
	entryCount = 0;
	#rest = '';
	#pending: { duration: number; attrs: Record<string, string>; name: string } | null = null;
	#pendingGroup: string | undefined;
	#first = true;

	movies: RawMovie[] = [];
	channels: RawChannel[] = [];
	#series = new Map<string, RawSeries>();
	#autoEpisode = new Map<string, number>();

	constructor(opts: M3UOptions) {
		this.sourceId = opts.sourceId;
	}

	push(chunk: string): void {
		const text = this.#rest ? this.#rest + chunk : chunk;
		let start = 0;
		for (;;) {
			const nl = text.indexOf('\n', start);
			if (nl === -1) break;
			this.#line(text, start, nl);
			start = nl + 1;
		}
		this.#rest = start < text.length ? text.slice(start) : '';
	}

	end(): M3UResult {
		if (this.#rest) {
			const r = this.#rest;
			this.#rest = '';
			this.#line(r, 0, r.length);
		}
		return {
			epgUrls: this.epgUrls,
			movies: this.movies,
			series: [...this.#series.values()],
			channels: this.channels,
			entryCount: this.entryCount
		};
	}

	#line(text: string, s: number, e: number): void {
		// trim (handles \r\n and stray spaces) without allocating first
		while (s < e && text.charCodeAt(s) <= 32) s++;
		while (e > s && text.charCodeAt(e - 1) <= 32) e--;
		if (s === e) return;
		let line = text.slice(s, e);
		if (this.#first) {
			this.#first = false;
			if (line.charCodeAt(0) === 0xfeff) line = line.slice(1);
		}
		if (line.charCodeAt(0) === 35 /* # */) {
			if (line.startsWith('#EXTINF:') || line.startsWith('#extinf:')) {
				if (this.#pending) this.entryCount++; // previous EXTINF without url
				this.#pending = parseExtinf(line);
				return;
			}
			if (/^#EXTM3U/i.test(line)) {
				const attrs: Record<string, string> = {};
				parseAttrs(line, 7, attrs);
				for (const k of ['url-tvg', 'x-tvg-url', 'tvg-url']) {
					const v = attrs[k];
					if (!v) continue;
					for (const u of v.split(/[,\s]+/)) {
						const t = u.trim();
						if (/^https?:\/\//i.test(t) && !this.epgUrls.includes(t)) this.epgUrls.push(t);
					}
				}
				return;
			}
			if (/^#EXTGRP:/i.test(line)) {
				this.#pendingGroup = line.slice(8).trim() || undefined;
				return;
			}
			// #EXTVLCOPT, #KODIPROP, #EXT-X-*, comments: ignored.
			return;
		}
		// URL line
		const info = this.#pending ?? { duration: -1, attrs: {}, name: '' };
		this.#pending = null;
		const group =
			str(info.attrs['group-title']) ?? str(info.attrs['tvg-group']) ?? this.#pendingGroup;
		this.#pendingGroup = undefined;
		this.entryCount++;
		const url = line;
		if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) return; // not a url
		const name = info.name || str(info.attrs['tvg-name']) || nameFromUrl(url);
		this.#add({ name, url, duration: info.duration, attrs: info.attrs, group });
	}

	#add(e: M3UEntry): void {
		const kind = classify(e);
		const a = e.attrs;
		const langHint = toLangCode(a['tvg-language']);
		const providerId = hashString(e.url);
		const ext = urlExt(e.url);
		if (kind === 'live') {
			const chno = Number(a['tvg-chno'] ?? a['channel-number'] ?? a['tvg-num']);
			const catchup = Number(a['catchup-days'] ?? a['timeshift'] ?? a['tvg-rec']);
			this.channels.push({
				kind: 'live',
				sourceId: this.sourceId,
				providerId,
				rawName: e.name,
				tvgId: str(a['tvg-id']),
				tvgName: str(a['tvg-name']),
				logoUrl: str(a['tvg-logo']) ?? str(a['logo']),
				group: e.group,
				number: Number.isFinite(chno) && chno > 0 ? chno : undefined,
				url: e.url,
				langHint,
				catchupDays: Number.isFinite(catchup) && catchup > 0 ? catchup : undefined
			});
			return;
		}
		if (kind === 'movie') {
			this.movies.push({
				kind: 'movie',
				sourceId: this.sourceId,
				providerId,
				rawTitle: e.name,
				category: e.group,
				year: yearFromName(e.name),
				posterUrl: str(a['tvg-logo']) ?? str(a['logo']),
				durationSec: e.duration > 0 ? Math.round(e.duration) : undefined,
				langHint,
				url: e.url,
				containerExt: ext
			});
			return;
		}
		// episode
		const ep = parseEpisodeName(e.name);
		const seriesName = ep?.series ?? stripTrailingNumber(e.name);
		const key = `${e.group ?? ''}\u0001${seriesName.toLowerCase()}`;
		let series = this.#series.get(key);
		if (!series) {
			series = {
				kind: 'series',
				sourceId: this.sourceId,
				providerId: 's' + hashString(key),
				rawTitle: seriesName,
				category: e.group,
				year: yearFromName(seriesName),
				posterUrl: str(a['tvg-logo']) ?? str(a['logo']),
				langHint,
				episodes: []
			};
			this.#series.set(key, series);
		}
		const season = ep?.season ?? 1;
		let episode = ep?.episode;
		if (episode === undefined) {
			episode = (this.#autoEpisode.get(key) ?? 0) + 1;
			this.#autoEpisode.set(key, episode);
		}
		// The same S/E twice in one series (e.g. two qualities) is kept: urls differ.
		const raw: RawEpisode = {
			providerId,
			season,
			episode,
			title: ep?.title,
			durationSec: e.duration > 0 ? Math.round(e.duration) : undefined,
			stillUrl: str(a['tvg-logo']) ?? str(a['logo']),
			url: e.url,
			containerExt: ext
		};
		series.episodes!.push(raw);
		if (!series.langHint && langHint) series.langHint = langHint;
	}
}

function yearFromName(name: string): number | undefined {
	const m = /[([](\d{4})[)\]]/.exec(name);
	return m ? parseYear(m[1]) : undefined;
}

function stripTrailingNumber(name: string): string {
	return name.replace(/[\s\-–:#.]*\d{1,4}\s*$/u, '').trim() || name;
}

function nameFromUrl(url: string): string {
	const p = pathOf(url);
	const last = p.slice(p.lastIndexOf('/') + 1);
	try {
		return decodeURIComponent(last).replace(/\.[a-z0-9]{2,5}$/i, '') || url;
	} catch {
		return last || url;
	}
}

/** Parse a complete playlist string. */
export function parseM3U(text: string, opts: M3UOptions): M3UResult {
	const p = new M3UParser(opts);
	p.push(text);
	return p.end();
}

/** Parse a streamed body (Response.body) chunk by chunk. */
export async function parseM3UStream(
	body: ReadableStream<Uint8Array>,
	opts: M3UOptions & { onBytes?: (n: number) => void }
): Promise<M3UResult> {
	const p = new M3UParser(opts);
	const reader = body.getReader();
	const dec = new TextDecoder('utf-8');
	let bytes = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		bytes += value.byteLength;
		opts.onBytes?.(bytes);
		p.push(dec.decode(value, { stream: true }));
	}
	p.push(dec.decode());
	return p.end();
}

/** Quick sanity check used before parsing user-supplied files. */
export function looksLikeM3U(text: string): boolean {
	const head = text
		.slice(0, 2048)
		.replace(/^\uFEFF/, '')
		.trimStart();
	return /^#EXTM3U/i.test(head) || /#EXTINF:/i.test(head) || /^[a-z]+:\/\//i.test(head);
}
