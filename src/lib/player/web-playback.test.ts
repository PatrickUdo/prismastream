import { describe, expect, it } from 'vitest';
import {
	classifyWebFailure,
	detectBrowser,
	diagnoseWebFailure,
	m3uFileName,
	m3uFor,
	type FailureInput
} from './web-playback.ts';

const HTTP = 'http://iptv.example:8080/live/u/p/1.m3u8';
const HTTPS = 'https://cdn.example/live/1.m3u8';

const base = (o: Partial<FailureInput> = {}): FailureInput => ({
	native: false,
	pageProtocol: 'https:',
	url: HTTP,
	error: { kind: 'network', manifestLoaded: false, status: 0 },
	probe: 'blocked',
	browser: 'chromium',
	...o
});

describe('detectBrowser', () => {
	it('recognises Chromium (Chrome, Edge, Brave, Opera), Safari and Firefox', () => {
		const chrome =
			'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
		expect(detectBrowser(chrome, undefined)).toBe('chromium');
		expect(detectBrowser(chrome.replace('Safari/537.36', 'Safari/537.36 Edg/130.0'))).toBe(
			'chromium'
		);
		expect(detectBrowser(chrome, [{ brand: 'Brave' }])).toBe('chromium');
		expect(detectBrowser(chrome + ' OPR/110.0', undefined)).toBe('chromium');
		expect(
			detectBrowser(
				'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
				undefined
			)
		).toBe('safari');
		expect(
			detectBrowser('Mozilla/5.0 (Macintosh; rv:131.0) Gecko/20100101 Firefox/131.0', undefined)
		).toBe('firefox');
		// Chrome on iOS is WebKit underneath: no insecure-content setting.
		expect(
			detectBrowser('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) CriOS/130.0 Mobile Safari', undefined)
		).toBe('safari');
	});
});

describe('classifyWebFailure', () => {
	it('http on https, blocked: step-by-step help in Chromium, app/VLC elsewhere', () => {
		expect(classifyWebFailure(base())).toBe('mixed-chromium');
		expect(classifyWebFailure(base({ browser: 'safari' }))).toBe('mixed-other');
		expect(classifyWebFailure(base({ browser: 'firefox' }))).toBe('mixed-other');
	});

	it('http allowed (probe answers) but the player failed: the provider sends no CORS', () => {
		expect(classifyWebFailure(base({ probe: 'reachable' }))).toBe('cors');
		expect(
			classifyWebFailure(
				base({ probe: 'unknown', error: { kind: 'network', manifestLoaded: true } })
			)
		).toBe('cors');
	});

	it('a failing <video src> (no CORS needed) on http means insecure content is not really allowed', () => {
		const progressive = {
			kind: 'network' as const,
			manifestLoaded: false,
			mode: 'progressive' as const
		};
		expect(classifyWebFailure(base({ probe: 'reachable', error: progressive }))).toBe(
			'mixed-chromium'
		);
		expect(
			classifyWebFailure(base({ probe: 'reachable', error: progressive, browser: 'safari' }))
		).toBe('mixed-other');
	});

	it('unknown probe and nothing loaded: treat as blocked mixed content', () => {
		expect(classifyWebFailure(base({ probe: 'unknown' }))).toBe('mixed-chromium');
	});

	it('https stream: CORS when reachable, a normal error when the host is down', () => {
		expect(classifyWebFailure(base({ url: HTTPS, probe: 'reachable' }))).toBe('cors');
		expect(classifyWebFailure(base({ url: HTTPS, probe: 'blocked' }))).toBeNull();
		expect(
			classifyWebFailure(
				base({
					url: HTTPS,
					probe: 'reachable',
					error: { kind: 'network', manifestLoaded: true, status: 404 }
				})
			)
		).toBeNull();
	});

	it('never on native, never for decode errors', () => {
		expect(classifyWebFailure(base({ native: true }))).toBeNull();
		expect(classifyWebFailure(base({ error: { kind: 'media', manifestLoaded: true } }))).toBeNull();
	});

	it('an http page (dev) has no mixed content', () => {
		expect(classifyWebFailure(base({ pageProtocol: 'http:', probe: 'blocked' }))).toBeNull();
	});
});

describe('diagnoseWebFailure', () => {
	it('probes the stream itself (never the server) and classifies', async () => {
		const seen: string[] = [];
		const r = await diagnoseWebFailure(
			HTTP,
			{ kind: 'network', detail: 'manifestLoadError', manifestLoaded: false, status: 0 },
			{ native: false, pageProtocol: 'https:' },
			async (u) => {
				seen.push(u);
				return 'reachable';
			}
		);
		expect(seen).toEqual([HTTP]);
		expect(r).toBe('cors');
	});
});

describe('m3u for VLC', () => {
	it('builds a one-entry playlist and a safe file name', () => {
		expect(m3uFor(HTTP, 'Kanaal 1, NL\n')).toBe(`#EXTM3U\n#EXTINF:-1,Kanaal 1  NL\n${HTTP}\n`);
		expect(m3uFileName('De Tijdbewakers S1E2 / test?')).toBe('De Tijdbewakers S1E2  test.m3u');
	});
});
