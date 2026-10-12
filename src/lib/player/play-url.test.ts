import { describe, expect, it } from 'vitest';
import { httpOnHttps, isMixedContent, mobileOs, playUrlFor, vlcUrl } from './play-url.ts';
import { streamCandidates } from './source.ts';

const WEB = { native: false, pageProtocol: 'https:' };
const NATIVE = { native: true, pageProtocol: 'https:' };
const UPSTREAM = 'http://iptv.example:8080/live/user/pass/123.m3u8';

describe('play urls (no server in the video path)', () => {
	it('uses the stream url as is, never a proxy', () => {
		expect(playUrlFor(UPSTREAM)).toBe(UPSTREAM);
		expect(playUrlFor('https://cdn.example/a.m3u8')).toBe('https://cdn.example/a.m3u8');
		expect(playUrlFor(UPSTREAM)).not.toContain('via=');
	});

	it('flags http streams on an https page in the browser only', () => {
		expect(isMixedContent(UPSTREAM, WEB)).toBe(true);
		expect(isMixedContent('https://cdn.example/a.m3u8', WEB)).toBe(false);
		expect(isMixedContent(UPSTREAM, NATIVE)).toBe(false);
		expect(isMixedContent(UPSTREAM, { native: false, pageProtocol: 'http:' })).toBe(false);
	});

	it('httpOnHttps uses the upstreamHttp hint even without a url (cached detail)', () => {
		expect(httpOnHttps({ url: '', upstreamHttp: true }, WEB)).toBe(true);
		expect(httpOnHttps({ url: UPSTREAM }, WEB)).toBe(true);
		expect(httpOnHttps({ url: UPSTREAM, upstreamHttp: true }, NATIVE)).toBe(false);
		expect(httpOnHttps(undefined, WEB)).toBe(false);
	});

	it('offers VLC only on phones', () => {
		expect(mobileOs('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')).toBe('ios');
		expect(mobileOs('Mozilla/5.0 (Linux; Android 15)')).toBe('android');
		expect(mobileOs('Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0)')).toBeNull();
		expect(vlcUrl(UPSTREAM, 'ios')).toBe(`vlc://${UPSTREAM}`);
		expect(vlcUrl(UPSTREAM, null)).toBeNull();
	});
});

describe('streamCandidates', () => {
	it('tries the .m3u8 twin of a .ts live url, then the original', () => {
		const c = streamCandidates('http://iptv.example/live/u/p/1.ts', 'ts');
		expect(c[0]).toEqual({ url: 'http://iptv.example/live/u/p/1.m3u8', kind: 'hls' });
		expect(c[1].url).toBe('http://iptv.example/live/u/p/1.ts');
	});
});
