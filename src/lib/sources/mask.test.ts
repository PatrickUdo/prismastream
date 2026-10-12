import { describe, expect, it } from 'vitest';
import { createMasker, mapCatalogUrls, maskEpisodes, unmaskEpisodes } from '#lib/sources/mask.ts';
import type { RawCatalog } from '#lib/types.ts';

const cat: RawCatalog = {
	sourceId: 'x',
	fetchedAt: 0,
	epg: [],
	movies: [
		{
			kind: 'movie',
			sourceId: 'x',
			providerId: '1',
			rawTitle: 'M',
			url: 'http://h/movie/john123/p%40ss/1.mkv',
			posterUrl: 'http://img/1.jpg'
		}
	],
	series: [
		{
			kind: 'series',
			sourceId: 'x',
			providerId: 's',
			rawTitle: 'S',
			episodes: [
				{ providerId: 'e', season: 1, episode: 1, url: 'http://h/series/john123/p%40ss/9.mp4' }
			]
		}
	],
	channels: [
		{
			kind: 'live',
			sourceId: 'x',
			providerId: 'c',
			rawName: 'C',
			url: 'http://h/live/john123/p%40ss/5.m3u8'
		}
	]
};

describe('createMasker', () => {
	it('removes secrets and restores them exactly', () => {
		const m = createMasker(['p@ss', 'john123']);
		const masked = mapCatalogUrls(cat, m.mask);
		const json = JSON.stringify(masked);
		expect(json).not.toContain('john123');
		expect(json).not.toContain('p%40ss');
		expect(mapCatalogUrls(masked, m.unmask)).toEqual(cat);
	});

	it('handles overlapping secrets (password inside username)', () => {
		const m = createMasker(['123', 'john123']);
		const url = 'http://h/live/john123/123/123.ts';
		const masked = m.mask(url);
		expect(masked).not.toContain('john123');
		expect(m.unmask(masked)).toBe(url);
	});

	it('restores with new secrets after a password change', () => {
		const masked = createMasker(['old', 'user']).mask('http://h/live/user/old/1.ts');
		expect(createMasker(['new', 'user']).unmask(masked)).toBe('http://h/live/user/new/1.ts');
	});

	it('is a no-op without secrets', () => {
		const m = createMasker(['', undefined]);
		expect(m.noop).toBe(true);
		const eps = cat.series[0].episodes!;
		expect(maskEpisodes(eps, m)).toBe(eps);
		expect(unmaskEpisodes(eps, m)).toBe(eps);
	});
});
