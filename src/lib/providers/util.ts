// Small helpers shared by the providers: tolerant value coercion, hashing, language hints.
import type { LangCode } from '#lib/types.ts';

/** Stable, fast 53-bit string hash (cyrb53), base36. Used for M3U providerIds. */
export function hashString(str: string, seed = 0): string {
	let h1 = 0xdeadbeef ^ seed;
	let h2 = 0x41c6ce57 ^ seed;
	for (let i = 0; i < str.length; i++) {
		const ch = str.charCodeAt(i);
		h1 = Math.imul(h1 ^ ch, 2654435761);
		h2 = Math.imul(h2 ^ ch, 1597334677);
	}
	h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
	h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
	h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
	h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
	return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** Trimmed non-empty string, or undefined. Accepts numbers. */
export function str(v: unknown): string | undefined {
	if (v == null) return undefined;
	if (typeof v === 'number') return Number.isFinite(v) ? String(v) : undefined;
	if (typeof v !== 'string') return undefined;
	const s = v.trim();
	if (!s || s === 'null' || s === 'undefined' || s === 'N/A') return undefined;
	return s;
}

/** Finite number from number or numeric string, else undefined. */
export function num(v: unknown): number | undefined {
	if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
	const s = str(v);
	if (!s) return undefined;
	const n = Number(s.replace(',', '.'));
	return Number.isFinite(n) ? n : undefined;
}

/** Positive integer (ids such as tmdb), else undefined. */
export function posInt(v: unknown): number | undefined {
	const n = num(v);
	if (n === undefined) return undefined;
	const i = Math.trunc(n);
	return i > 0 ? i : undefined;
}

/** Comma/pipe/slash separated list → trimmed unique entries. */
export function list(v: unknown): string[] | undefined {
	if (Array.isArray(v)) {
		const out = v.map((x) => str(x)).filter((x): x is string => !!x);
		return out.length ? [...new Set(out)] : undefined;
	}
	const s = str(v);
	if (!s) return undefined;
	const out = s
		.split(/\s*[,|/]\s*/)
		.map((x) => x.trim())
		.filter(Boolean);
	return out.length ? [...new Set(out)] : undefined;
}

/** Plausible release year (1880..next year) from a number or a date-ish string. */
export function year(v: unknown): number | undefined {
	const s = str(v);
	if (!s) return undefined;
	const m = /(18[89]\d|19\d\d|20\d\d)/.exec(s);
	if (!m) return undefined;
	const y = Number(m[1]);
	return y <= new Date().getFullYear() + 1 ? y : undefined;
}

/** Unix seconds (number or string) → epoch ms. */
export function unixToMs(v: unknown): number | undefined {
	const n = num(v);
	if (!n || n <= 0) return undefined;
	// Already ms?
	return n > 1e12 ? Math.trunc(n) : Math.trunc(n * 1000);
}

/** "01:45:00" | "105 min" | "105" (minutes) → seconds. */
export function durationToSec(v: unknown, plainUnit: 'min' | 'sec' = 'min'): number | undefined {
	if (typeof v === 'number') {
		if (!Number.isFinite(v) || v <= 0) return undefined;
		return Math.round(plainUnit === 'min' ? v * 60 : v);
	}
	const s = str(v);
	if (!s) return undefined;
	const hms = /^(\d{1,3}):(\d{1,2})(?::(\d{1,2}))?$/.exec(s);
	if (hms) {
		const sec =
			hms[3] !== undefined
				? Number(hms[1]) * 3600 + Number(hms[2]) * 60 + Number(hms[3])
				: Number(hms[1]) * 60 + Number(hms[2]);
		return sec > 0 ? sec : undefined;
	}
	const n = num(s.replace(/\s*(min|mins|minutes|m)\.?$/i, ''));
	if (n === undefined || n <= 0) return undefined;
	return Math.round(plainUnit === 'min' ? n * 60 : n);
}

/** YouTube id or url → canonical watch url. */
export function youtubeUrl(v: unknown): string | undefined {
	const s = str(v);
	if (!s) return undefined;
	if (/^https?:\/\//i.test(s)) return s;
	return /^[\w-]{6,20}$/.test(s) ? `https://www.youtube.com/watch?v=${s}` : undefined;
}

/** http(s) url or undefined. */
export function httpUrl(v: unknown): string | undefined {
	const s = str(v);
	return s && /^https?:\/\//i.test(s) ? s : undefined;
}

const LANG_ALIASES: Record<string, LangCode> = {};
const add = (code: LangCode, ...names: string[]) => {
	for (const n of [code, ...names]) LANG_ALIASES[n.toLowerCase()] = code;
};
add(
	'nl',
	'nld',
	'dut',
	'dutch',
	'nederlands',
	'netherlands',
	'holland',
	'flemish',
	'vlaams',
	'be-nl'
);
add('en', 'eng', 'english', 'engels');
add('de', 'deu', 'ger', 'german', 'deutsch', 'duits');
add('fr', 'fra', 'fre', 'french', 'français', 'francais', 'frans');
add('es', 'spa', 'spanish', 'español', 'espanol', 'castellano', 'spaans');
add('it', 'ita', 'italian', 'italiano', 'italiaans');
add('tr', 'tur', 'turkish', 'türkçe', 'turkce', 'turks');
add('ar', 'ara', 'arabic', 'العربية', 'عربي', 'arabisch');
add('pl', 'pol', 'polish', 'polski', 'pools');
add('pt', 'por', 'portuguese', 'português', 'portugues', 'portugees');
add('ru', 'rus', 'russian', 'русский', 'russisch');
add('ja', 'jpn', 'japanese', '日本語', 'japans');
add('ko', 'kor', 'korean', '한국어', 'koreaans');
add('zh', 'zho', 'chi', 'chinese', 'mandarin', '中文', 'chinees');
add('hi', 'hin', 'hindi');
add('sv', 'swe', 'swedish', 'svenska', 'zweeds');
add('da', 'dan', 'danish', 'dansk', 'deens');
add('no', 'nor', 'nob', 'nb', 'norwegian', 'norsk', 'noors');
add('fi', 'fin', 'finnish', 'suomi', 'fins');
add('el', 'ell', 'gre', 'greek', 'ελληνικά', 'grieks');
add('ro', 'ron', 'rum', 'romanian', 'română', 'romana', 'roemeens');

/**
 * Map a free-form language label ("Dutch", "Nederlands", "NL", "nld", "Dutch;English")
 * to an ISO 639-1 code. Returns the first recognised language, or undefined.
 */
export function toLangCode(v: unknown): LangCode | undefined {
	const s = str(v);
	if (!s) return undefined;
	for (const part of s.split(/[;,|/]/)) {
		const k = part.trim().toLowerCase();
		if (!k) continue;
		const hit = LANG_ALIASES[k] ?? LANG_ALIASES[k.split(/[-_]/)[0]];
		if (hit) return hit;
	}
	return undefined;
}

/** Decode base64 (as used by Xtream short_epg) to a UTF-8 string; returns input on failure. */
export function decodeBase64Utf8(v: unknown): string | undefined {
	const s = str(v);
	if (!s) return undefined;
	if (!/^[A-Za-z0-9+/=\s]+$/.test(s) || s.replace(/\s/g, '').length % 4 !== 0) return s;
	try {
		const bin = atob(s.replace(/\s/g, ''));
		const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
		return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	} catch {
		return s;
	}
}

/** File extension of a url path, lowercase without dot (ignores query/hash). */
export function urlExt(url: string): string | undefined {
	let end = url.length;
	const q = url.indexOf('?');
	if (q !== -1) end = q;
	const h = url.indexOf('#');
	if (h !== -1 && h < end) end = h;
	const slash = url.lastIndexOf('/', end - 1);
	const dot = url.lastIndexOf('.', end - 1);
	if (dot <= slash || end - dot > 6) return undefined;
	const ext = url.slice(dot + 1, end).toLowerCase();
	return /^[a-z0-9]{2,5}$/.test(ext) ? ext : undefined;
}

/** True for a syntactically valid http(s) url. */
export function isHttpUrl(v: string | undefined): boolean {
	if (!v) return false;
	try {
		const u = new URL(v.trim());
		return u.protocol === 'http:' || u.protocol === 'https:';
	} catch {
		return false;
	}
}

export interface UrlParts {
	/** Lowercase scheme with colon, e.g. 'http:'. */
	protocol: string;
	/** Lowercase host with port (default ports dropped), without credentials. */
	host: string;
	/** Path, at least '/'; no query or hash. */
	pathname: string;
}

const DEFAULT_PORTS: Record<string, string> = {
	'http:': '80',
	'https:': '443',
	'ws:': '80',
	'wss:': '443',
	'ftp:': '21'
};

/**
 * protocol/host/pathname of an absolute url, as WHATWG `URL` reports them, or undefined when
 * invalid. Uses `URL` when the platform has it; JavaScriptCore (Apple TV core) has none, so
 * there the pure `splitUrlPure` is used.
 */
export function splitUrl(input: string): UrlParts | undefined {
	if (typeof URL !== 'function') return splitUrlPure(input);
	try {
		const u = new URL(input);
		return { protocol: u.protocol, host: u.host, pathname: u.pathname };
	} catch {
		return undefined;
	}
}

/** Dependency-free equivalent of `splitUrl` for the common http(s) cases. */
export function splitUrlPure(input: string): UrlParts | undefined {
	const m = /^([a-z][a-z0-9+.-]*:)\/\/(?:[^@/?#\\]*@)?([^/?#\\]*)([^?#]*)/i.exec(input.trim());
	if (!m) return undefined;
	const protocol = m[1].toLowerCase();
	const hm = /^(\[[0-9a-f:.]+\]|[^:[\]\s<>^|%"`{}]+)(?::(\d*))?$/i.exec(m[2].toLowerCase());
	if (!hm) return undefined;
	let port = hm[2] ?? '';
	if (port) {
		const n = Number(port);
		if (n > 65535) return undefined;
		port = String(n);
	}
	const host = hm[1] + (port && port !== DEFAULT_PORTS[protocol] ? ':' + port : '');
	let pathname = m[3].replace(/\\/g, '/').replace(/ /g, '%20');
	if (!pathname.startsWith('/')) pathname = '/' + pathname;
	return { protocol, host, pathname };
}
