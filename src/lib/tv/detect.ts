// Pure detection helpers: TV devices and the current input mode (pointer, touch, remote).

export type InputMode = 'pointer' | 'touch' | 'remote';

/**
 * Smart-TV / streaming-box user agents: Android TV, Fire TV (AFT*), Samsung Tizen,
 * LG webOS, generic SMART-TV / HbbTV, Sony BRAVIA, Google TV, Chromecast and a few others.
 */
const TV_UA =
	/Android TV|\bAFT[A-Z0-9]|Tizen|Web0S|webOS|SMART-?TV|SmartTV|BRAVIA|GoogleTV|Google TV|CrKey|HbbTV|NetCast|Opera TV|VIDAA|Viera|AQUOS|PhilipsTV|Roku|AppleTV/i;

/** Tizen and webOS also run on watches and phones; exclude obvious mobile UAs. */
const MOBILE_UA = /Mobile|Watch|wearable/i;

export function isTvUserAgent(ua: string): boolean {
	if (!TV_UA.test(ua)) return false;
	// "Android TV" / AFT / BRAVIA etc. never say "Mobile"; Tizen phones and watches do.
	if (/Tizen|webOS|Web0S/i.test(ua) && MOBILE_UA.test(ua) && !/SMART-?TV|SmartTV/i.test(ua))
		return false;
	return true;
}

export interface TvEnv {
	userAgent: string;
	/** location.search, e.g. "?tv=1". */
	search: string;
	/** Value persisted for this session by an earlier ?tv=… ("1" / "0"), if any. */
	stored?: string | null;
	/** Capacitor.getPlatform(). */
	platform?: string;
	maxTouchPoints?: number;
	screenWidth?: number;
	screenHeight?: number;
}

/** Explicit override from the url (`?tv=1` / `?tv=0`), else from session storage. */
export function tvOverride(search: string, stored?: string | null): boolean | null {
	const v = new URLSearchParams(search).get('tv');
	if (v === '1' || v === 'true') return true;
	if (v === '0' || v === 'false') return false;
	if (stored === '1') return true;
	if (stored === '0') return false;
	return null;
}

/**
 * Is this a TV (10-foot UI)? `?tv=1` forces it (handy for testing), `?tv=0` turns it off.
 * Otherwise the user agent, or the Android app without a touchscreen on a large screen
 * (Android TV / Fire TV with the leanback feature).
 */
export function detectTv(env: TvEnv): boolean {
	const forced = tvOverride(env.search, env.stored);
	if (forced !== null) return forced;
	if (isTvUserAgent(env.userAgent)) return true;
	if (env.platform === 'android' && (env.maxTouchPoints ?? 1) === 0) {
		const long = Math.max(env.screenWidth ?? 0, env.screenHeight ?? 0);
		const short = Math.min(env.screenWidth ?? 0, env.screenHeight ?? 0);
		return long >= 900 && short >= 500;
	}
	return false;
}

// ---- Input mode ---------------------------------------------------------------------------

export interface InputEventLike {
	type: string;
	key?: string;
	keyCode?: number;
	pointerType?: string;
	movementX?: number;
	movementY?: number;
	/** The event target is a text field (typing there is not remote use). */
	inTextField?: boolean;
}

/** Mouse events this soon after a key press are ignored (TV browsers fake them on scroll). */
export const POINTER_GRACE_MS = 600;

const REMOTE_KEYS = new Set([
	'ArrowLeft',
	'ArrowRight',
	'ArrowUp',
	'ArrowDown',
	'Left',
	'Right',
	'Up',
	'Down',
	'Enter',
	'Select',
	'Accept'
]);

/**
 * The input mode an event switches to, or null when it does not change the mode.
 * Arrows and OK → remote; mouse movement → pointer; touch → touch.
 */
export function modeForEvent(e: InputEventLike, now: number, lastKeyAt: number): InputMode | null {
	switch (e.type) {
		case 'keydown': {
			if (e.inTextField) return null;
			const remoteCode = e.keyCode !== undefined && e.keyCode >= 37 && e.keyCode <= 40;
			return REMOTE_KEYS.has(e.key ?? '') || remoteCode ? 'remote' : null;
		}
		case 'touchstart':
			return 'touch';
		case 'pointerdown':
			if (e.pointerType === 'touch' || e.pointerType === 'pen') return 'touch';
			if (e.pointerType === 'mouse') return 'pointer';
			return null;
		case 'mousemove':
		case 'pointermove': {
			if (e.pointerType && e.pointerType !== 'mouse') return null;
			if (now - lastKeyAt < POINTER_GRACE_MS) return null;
			if (!e.movementX && !e.movementY) return null;
			return 'pointer';
		}
		case 'wheel':
			return now - lastKeyAt < POINTER_GRACE_MS ? null : 'pointer';
		default:
			return null;
	}
}

/** Initial mode before any input: TVs start in remote mode, touch-only devices in touch. */
export function initialMode(opts: { tv: boolean; coarseOnly: boolean }): InputMode {
	if (opts.tv) return 'remote';
	return opts.coarseOnly ? 'touch' : 'pointer';
}
