// Pure stream-format detection and fallback-candidate generation.
//
// IPTV providers deliver HLS (.m3u8), progressive files (.mp4/.mkv/.webm/.mov) and raw
// MPEG-TS (.ts) live streams. Browsers cannot play a raw, endless MPEG-TS stream through
// <video> (only Safari plays some TS files natively, and never endless live TS), so for
// `.ts` we first try the `.m3u8` twin of the url (Xtream servers expose both
// `/live/user/pass/123.ts` and `/live/user/pass/123.m3u8`), and only then the original url.

export type StreamKind = 'hls' | 'progressive';

export interface StreamCandidate {
	url: string;
	kind: StreamKind;
}

const HLS_EXT = new Set(['m3u8', 'm3u']);
const PROGRESSIVE_EXT = new Set(['mp4', 'm4v', 'mkv', 'webm', 'mov', 'ogv', 'avi', 'mp3', 'aac']);

/** Lower-case file extension of the url path (ignores query and hash), or '' if none. */
export function urlExtension(url: string): string {
	let path: string;
	try {
		path = new URL(url, 'http://x/').pathname;
	} catch {
		path = url.split(/[?#]/)[0];
	}
	const last = path.split('/').pop() ?? '';
	const dot = last.lastIndexOf('.');
	return dot > 0 ? last.slice(dot + 1).toLowerCase() : '';
}

/** Replace the extension of the url path, keeping query and hash. */
export function withExtension(url: string, ext: string): string {
	const m = /^([^?#]*?)(\.[a-z0-9]+)?([?#].*)?$/i.exec(url);
	if (!m) return url;
	return `${m[1]}.${ext}${m[3] ?? ''}`;
}

/**
 * Ordered list of playback attempts for a url. The engine tries them until one works.
 * `altUrls` (e.g. the .ts twin of a live stream) are tried after the url's own candidates.
 */
export function streamCandidates(
	url: string,
	containerExt?: string,
	altUrls: string[] = []
): StreamCandidate[] {
	const own = ownCandidates(url, containerExt);
	const seen = new Set(own.map((c) => `${c.kind}|${c.url}`));
	for (const alt of altUrls) {
		if (!alt || alt === url) continue;
		for (const c of ownCandidates(alt)) {
			const key = `${c.kind}|${c.url}`;
			if (!seen.has(key)) {
				seen.add(key);
				own.push(c);
			}
		}
	}
	return own;
}

function ownCandidates(url: string, containerExt?: string): StreamCandidate[] {
	const ext = (containerExt || urlExtension(url)).toLowerCase().replace(/^\./, '');
	const urlExt = urlExtension(url);
	if (HLS_EXT.has(ext)) return [{ url, kind: 'hls' }];
	if (PROGRESSIVE_EXT.has(ext)) return [{ url, kind: 'progressive' }];
	if (ext === 'ts' || ext === 'mpegts') {
		const out: StreamCandidate[] = [];
		if (urlExt === 'ts') out.push({ url: withExtension(url, 'm3u8'), kind: 'hls' });
		out.push({ url, kind: 'progressive' });
		return out;
	}
	if (!urlExt) {
		// Extensionless (common in M3U lists): usually HLS behind a redirect, sometimes a file.
		return [
			{ url, kind: 'hls' },
			{ url, kind: 'progressive' }
		];
	}
	// Unknown extension (.php, .flv, ...): let the browser sniff it first, then try HLS.
	return [
		{ url, kind: 'progressive' },
		{ url, kind: 'hls' }
	];
}
