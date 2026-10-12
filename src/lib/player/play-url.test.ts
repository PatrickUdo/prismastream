import { describe, expect, it } from 'vitest';
import type { StreamVariant } from '#lib/types.ts';
import { isPlayUrl, playUrlFor, playableVariant } from './play-url.ts';
import { streamCandidates } from './source.ts';

const PLAY = 'https://backend.test/v1/play/ppx_abc/src~123';

describe('playUrlFor', () => {
	it('adds via=proxy for backend play urls on the web', () => {
		expect(isPlayUrl(PLAY)).toBe(true);
		expect(playUrlFor(PLAY, { native: false })).toBe(`${PLAY}?via=proxy`);
		expect(playUrlFor(`${PLAY}?x=1`, { native: false })).toBe(`${PLAY}?x=1&via=proxy`);
		expect(playUrlFor(`${PLAY}?via=proxy`, { native: false })).toBe(`${PLAY}?via=proxy`);
	});

	it('leaves native, https-known and non-play urls alone', () => {
		expect(playUrlFor(PLAY, { native: true })).toBe(PLAY);
		expect(playUrlFor(PLAY, { native: false, upstreamSecure: true })).toBe(PLAY);
		const demo = 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8';
		expect(playUrlFor(demo, { native: false })).toBe(demo);
	});

	it('maps altUrls too', () => {
		const v: StreamVariant = {
			id: 'a',
			sourceId: 's',
			url: PLAY,
			altUrls: [PLAY + '.ts'],
			audioLangs: [],
			subtitleLangs: [],
			quality: 'HD',
			label: ''
		};
		const out = playableVariant(v, { native: false });
		expect(out.url).toContain('via=proxy');
		expect(out.altUrls?.[0]).toBe(`${PLAY}.ts?via=proxy`);
		expect(playableVariant(v, { native: true })).toBe(v);
	});
});

describe('streamCandidates for play urls', () => {
	it('never rewrites the play path and tries altUrls last', () => {
		const c = streamCandidates(PLAY, 'ts', [PLAY + '-ts']);
		expect(c[0]).toEqual({ url: PLAY, kind: 'hls' });
		expect(c[1].url).toBe(PLAY + '-ts');
		expect(c.every((x) => !x.url.endsWith('.m3u8'))).toBe(true);
		expect(streamCandidates(PLAY, 'mp4')[0].kind).toBe('progressive');
	});
});
