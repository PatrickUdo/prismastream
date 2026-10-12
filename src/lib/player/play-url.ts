// Play urls for the current platform. In remote mode every StreamVariant.url is a backend
// play url (`…/v1/play/<playToken>/<variant>`) that answers with a 302 to the provider.
//
// - Native (Capacitor): use the play url as is; AVPlayer/ExoPlayer/hls.js follow the redirect.
// - Web: IPTV upstreams are often plain http (mixed content) and never send CORS headers, so
//   unless the variant is known to be https end to end, add `?via=proxy`: the backend then
//   streams it over https (HLS playlists rewritten). Urls that are not play urls (demo streams,
//   local sources) are left alone.
import { Capacitor } from '@capacitor/core';
import type { StreamVariant } from '#lib/types.ts';

const PLAY_PATH = /\/v1\/play\/[^/?#]+\//;

export function isPlayUrl(url: string): boolean {
	return PLAY_PATH.test(url);
}

function withVia(url: string): string {
	if (/[?&]via=/.test(url)) return url;
	const hash = url.indexOf('#');
	const base = hash === -1 ? url : url.slice(0, hash);
	const tail = hash === -1 ? '' : url.slice(hash);
	return `${base}${base.includes('?') ? '&' : '?'}via=proxy${tail}`;
}

export interface PlayUrlOptions {
	/** Defaults to Capacitor.isNativePlatform(). */
	native?: boolean;
	/** The upstream is known to be https and CORS-friendly (optional hint from the server). */
	upstreamSecure?: boolean;
}

/** The url to hand to the player for a stream url on this platform. */
export function playUrlFor(url: string, opts: PlayUrlOptions = {}): string {
	const native = opts.native ?? Capacitor.isNativePlatform();
	if (native || !isPlayUrl(url) || opts.upstreamSecure) return url;
	return withVia(url);
}

/** A variant with its url and altUrls adjusted for this platform (see playUrlFor). */
export function playableVariant<V extends StreamVariant>(v: V, opts: PlayUrlOptions = {}): V {
	const hint = (v as V & { upstreamSecure?: boolean; upstream?: string }).upstreamSecure;
	const o = { ...opts, upstreamSecure: opts.upstreamSecure ?? hint === true };
	const url = playUrlFor(v.url, o);
	const altUrls = v.altUrls?.map((u) => playUrlFor(u, o));
	if (url === v.url && (!v.altUrls || altUrls!.every((u, i) => u === v.altUrls![i]))) return v;
	return { ...v, url, ...(altUrls ? { altUrls } : {}) };
}
