import { describe, expect, it } from 'vitest';
import {
	detectTv,
	initialMode,
	isTvUserAgent,
	modeForEvent,
	POINTER_GRACE_MS,
	tvOverride
} from './detect.ts';

const UA = {
	androidTv:
		'Mozilla/5.0 (Linux; Android 12; BRAVIA 4K VH2 Build/STT1.211025.001.Z4; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0 Mobile Safari/537.36',
	googleTv:
		'Mozilla/5.0 (Linux; Android 12; Chromecast Build/STTL.240206.002; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0 Safari/537.36 GoogleTV',
	fireTv:
		'Mozilla/5.0 (Linux; Android 9; AFTMM Build/PS7633; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/108.0 Mobile Safari/537.36',
	tizen:
		'Mozilla/5.0 (SMART-TV; LINUX; Tizen 6.5) AppleWebKit/537.36 (KHTML, like Gecko) 85.0.4183.93/6.5 TV Safari/537.36',
	webos:
		'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/94.0 Safari/537.36 WebAppManager',
	tizenWatch:
		'Mozilla/5.0 (Linux; Tizen 5.5; SAMSUNG SM-R820) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/1.0 Chrome/69.0 Mobile Safari/537.36 Watch',
	iphone:
		'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
	androidPhone:
		'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36',
	mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
};

describe('isTvUserAgent', () => {
	it.each([
		['Android TV (BRAVIA)', UA.androidTv],
		['Google TV', UA.googleTv],
		['Fire TV', UA.fireTv],
		['Tizen', UA.tizen],
		['webOS', UA.webos]
	])('detects %s', (_, ua) => expect(isTvUserAgent(ua)).toBe(true));

	it.each([
		['iPhone', UA.iphone],
		['Android phone', UA.androidPhone],
		['desktop', UA.mac],
		['Tizen watch', UA.tizenWatch]
	])('does not flag %s', (_, ua) => expect(isTvUserAgent(ua)).toBe(false));
});

describe('detectTv', () => {
	it('honours ?tv=1 and ?tv=0', () => {
		expect(detectTv({ userAgent: UA.mac, search: '?tv=1' })).toBe(true);
		expect(detectTv({ userAgent: UA.tizen, search: '?tv=0' })).toBe(false);
	});

	it('keeps a stored override for the session', () => {
		expect(detectTv({ userAgent: UA.mac, search: '', stored: '1' })).toBe(true);
		expect(tvOverride('', null)).toBeNull();
		expect(tvOverride('?tv=true', '0')).toBe(true);
	});

	it('detects Android TV in the app: no touch and a large screen', () => {
		const env = { userAgent: UA.androidPhone, search: '', platform: 'android' };
		expect(detectTv({ ...env, maxTouchPoints: 0, screenWidth: 960, screenHeight: 540 })).toBe(true);
		expect(detectTv({ ...env, maxTouchPoints: 5, screenWidth: 960, screenHeight: 540 })).toBe(
			false
		);
		expect(detectTv({ ...env, maxTouchPoints: 0, screenWidth: 412, screenHeight: 915 })).toBe(
			false
		);
	});

	it('is false for a normal desktop browser', () => {
		expect(detectTv({ userAgent: UA.mac, search: '', platform: 'web', maxTouchPoints: 0 })).toBe(
			false
		);
	});
});

describe('modeForEvent', () => {
	const now = 10_000;

	it('switches to remote on arrows and OK, not on typing', () => {
		expect(modeForEvent({ type: 'keydown', key: 'ArrowDown' }, now, 0)).toBe('remote');
		expect(modeForEvent({ type: 'keydown', key: 'Enter' }, now, 0)).toBe('remote');
		expect(modeForEvent({ type: 'keydown', key: 'Unidentified', keyCode: 38 }, now, 0)).toBe(
			'remote'
		);
		expect(modeForEvent({ type: 'keydown', key: 'a' }, now, 0)).toBeNull();
		expect(
			modeForEvent({ type: 'keydown', key: 'ArrowLeft', inTextField: true }, now, 0)
		).toBeNull();
	});

	it('switches back to pointer on real mouse movement', () => {
		expect(modeForEvent({ type: 'mousemove', movementX: 4, movementY: 0 }, now, 0)).toBe('pointer');
		expect(modeForEvent({ type: 'mousemove', movementX: 0, movementY: 0 }, now, 0)).toBeNull();
	});

	it('ignores mouse events right after a key press (fake moves on scroll)', () => {
		const lastKey = now - POINTER_GRACE_MS / 2;
		expect(modeForEvent({ type: 'mousemove', movementX: 3 }, now, lastKey)).toBeNull();
		expect(modeForEvent({ type: 'wheel' }, now, lastKey)).toBeNull();
	});

	it('switches to touch on touch input', () => {
		expect(modeForEvent({ type: 'touchstart' }, now, 0)).toBe('touch');
		expect(modeForEvent({ type: 'pointerdown', pointerType: 'touch' }, now, 0)).toBe('touch');
		expect(modeForEvent({ type: 'pointerdown', pointerType: 'mouse' }, now, 0)).toBe('pointer');
		expect(
			modeForEvent({ type: 'pointermove', pointerType: 'touch', movementX: 5 }, now, 0)
		).toBeNull();
	});

	it('picks a sensible initial mode', () => {
		expect(initialMode({ tv: true, coarseOnly: false })).toBe('remote');
		expect(initialMode({ tv: false, coarseOnly: true })).toBe('touch');
		expect(initialMode({ tv: false, coarseOnly: false })).toBe('pointer');
	});
});
