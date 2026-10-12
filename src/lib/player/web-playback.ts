// Web playback of provider streams, straight from the provider to the browser (the server is
// never in the video path). Many IPTV providers serve plain http and send no CORS headers:
//
// - http on an https page is "mixed content". Chromium browsers (Chrome, Edge, Brave, Opera)
//   play it once the user allows "Onveilige inhoud" for the site; Safari and Firefox do not.
// - Without CORS headers hls.js cannot read the playlist or segments (XHR); progressive files
//   (.mp4/.mkv/.avi) play through <video src> and need no CORS.
//
// The player always tries first. Only after a real failure `diagnoseWebFailure` decides which
// help to show, using a direct no-cors probe of the stream url (a mixed-content block rejects
// it; a reachable server answers it, so the failure was CORS).
import type { EngineError } from './engine.svelte.ts';

export type BrowserFamily = 'chromium' | 'safari' | 'firefox' | 'other';

/** 'mixed-chromium': explain "allow insecure content"; 'mixed-other': app/VLC; 'cors': provider blocks browsers. */
export type WebBlock = 'mixed-chromium' | 'mixed-other' | 'cors';

export type ProbeResult = 'blocked' | 'reachable' | 'unknown';

interface UaBrand {
	brand: string;
}

export function detectBrowser(
	ua: string = typeof navigator !== 'undefined' ? navigator.userAgent : '',
	brands: UaBrand[] | undefined = typeof navigator !== 'undefined'
		? (navigator as Navigator & { userAgentData?: { brands?: UaBrand[] } }).userAgentData?.brands
		: undefined
): BrowserFamily {
	// iOS: every browser is WebKit (no "insecure content" setting).
	if (/iPhone|iPad|iPod/i.test(ua)) return 'safari';
	if (brands?.some((b) => /Chromium|Google Chrome|Microsoft Edge|Brave|Opera/i.test(b.brand)))
		return 'chromium';
	if (/Firefox\/|FxiOS/i.test(ua)) return 'firefox';
	if (/Chrome\/|Chromium\/|Edg\/|OPR\//i.test(ua)) return 'chromium';
	if (/Safari\//i.test(ua)) return 'safari';
	return 'other';
}

export function isHttpOnHttps(url: string, pageProtocol: string): boolean {
	return pageProtocol === 'https:' && /^http:\/\//i.test(url);
}

export interface FailureInput {
	native: boolean;
	pageProtocol: string;
	url: string;
	error: Pick<EngineError, 'kind' | 'manifestLoaded' | 'status' | 'mode'>;
	probe: ProbeResult;
	browser: BrowserFamily;
}

/** Which help to show for a failed web playback, or null for a normal player error. */
export function classifyWebFailure(i: FailureInput): WebBlock | null {
	if (i.native) return null;
	if (i.error.kind === 'media') return null; // a real decoding problem
	const mixed = isHttpOnHttps(i.url, i.pageProtocol);
	if (mixed) {
		if (i.probe === 'reachable') {
			// <video src> needs no CORS: a failing progressive http source on an https page means
			// the browser still upgraded or blocked it (insecure content not really allowed).
			if (i.error.mode === 'progressive')
				return i.browser === 'chromium' ? 'mixed-chromium' : 'mixed-other';
			return 'cors'; // allowed, but the provider sends no CORS for hls.js
		}
		if (i.probe === 'blocked' || !i.error.manifestLoaded)
			return i.browser === 'chromium' ? 'mixed-chromium' : 'mixed-other';
		return 'cors';
	}
	// https (or an http page): only CORS can be the browser's problem.
	if (i.probe === 'reachable' && (i.error.status === 0 || i.error.status === undefined))
		return 'cors';
	return null;
}

/**
 * Probe the stream url directly from the browser (no-cors, never through our server): a
 * mixed-content block or an unreachable host rejects; any answer resolves. The body is not
 * read (live streams are endless).
 */
export async function probeStream(url: string, timeoutMs = 8000): Promise<ProbeResult> {
	if (typeof fetch === 'undefined') return 'unknown';
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), timeoutMs);
	try {
		await fetch(url, {
			mode: 'no-cors',
			cache: 'no-store',
			credentials: 'omit',
			referrerPolicy: 'no-referrer',
			signal: ctrl.signal
		});
		return 'reachable';
	} catch {
		return ctrl.signal.aborted ? 'unknown' : 'blocked';
	} finally {
		clearTimeout(timer);
		ctrl.abort(); // stop downloading the stream body
	}
}

export async function diagnoseWebFailure(
	url: string,
	error: EngineError,
	env: { native: boolean; pageProtocol: string },
	probe: (url: string) => Promise<ProbeResult> = probeStream
): Promise<WebBlock | null> {
	if (env.native || error.kind === 'media') return null;
	const result = await probe(url).catch(() => 'unknown' as const);
	return classifyWebFailure({
		native: env.native,
		pageProtocol: env.pageProtocol,
		url,
		error,
		probe: result,
		browser: detectBrowser()
	});
}

/** A one-entry .m3u playlist for VLC and other players, generated on the device. */
export function m3uFor(url: string, title: string): string {
	const clean = title.replace(/[\r\n,]+/g, ' ').trim() || 'PrismaStream';
	return `#EXTM3U\n#EXTINF:-1,${clean}\n${url}\n`;
}

export function m3uFileName(title: string): string {
	const base =
		title
			.replace(/[^\p{L}\p{N} _.-]+/gu, '')
			.trim()
			.slice(0, 60) || 'stream';
	return `${base}.m3u`;
}
