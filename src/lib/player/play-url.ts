// Stream urls and where they can play. Streaming always happens on the device, straight from
// the IPTV provider: the backend is never in the video path (no play redirects, no proxy).
//
// - Native (Capacitor iOS/Android/Android TV): play the url directly (with the native CORS
//   fallback loader for HLS).
// - Web: the player always tries first. A plain-http stream on an https page is mixed content;
//   Chromium plays it once the user allows insecure content. After a real failure,
//   web-playback.ts decides which help to show (AppFallback.svelte).
//
// Stream urls may contain the provider credentials: never persist or log them.
import { Capacitor } from '@capacitor/core';
import type { StreamVariant } from '#lib/types.ts';

export interface PlayEnv {
	native: boolean;
	/** Protocol of the page ('https:' in production). */
	pageProtocol: string;
}

export function currentPlayEnv(): PlayEnv {
	return {
		native: Capacitor.isNativePlatform(),
		pageProtocol: typeof location !== 'undefined' ? location.protocol : 'https:'
	};
}

/** The url to hand to the player: always the stream url itself. */
export function playUrlFor(url: string): string {
	return url;
}

/** A plain-http url that a https page cannot load (mixed content). */
export function isMixedContent(url: string, env: PlayEnv = currentPlayEnv()): boolean {
	return !env.native && env.pageProtocol === 'https:' && /^http:\/\//i.test(url);
}

/** A variant as the backend sends it: `upstreamHttp` tells (also without the url) it is http. */
export type PlayableVariant = Pick<StreamVariant, 'url'> & { upstreamHttp?: boolean };

/**
 * An http stream on an https page in the browser. It may still play (Chromium with "insecure
 * content" allowed); the player tries first and only then explains (see web-playback.ts).
 */
export function httpOnHttps(
	v: PlayableVariant | undefined,
	env: PlayEnv = currentPlayEnv()
): boolean {
	if (!v || env.native || env.pageProtocol !== 'https:') return false;
	return v.upstreamHttp === true || isMixedContent(v.url, env);
}

export type MobileOs = 'ios' | 'android' | null;

export function mobileOs(
	ua: string = typeof navigator !== 'undefined' ? navigator.userAgent : ''
): MobileOs {
	if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
	if (/Android/i.test(ua)) return 'android';
	return null;
}

/** "Open in VLC" link (VLC registers vlc:// on iOS and Android), or null elsewhere. */
export function vlcUrl(url: string, os: MobileOs = mobileOs()): string | null {
	if (!os || !/^https?:\/\//i.test(url)) return null;
	return `vlc://${url}`;
}
