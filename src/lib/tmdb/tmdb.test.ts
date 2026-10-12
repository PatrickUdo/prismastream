import { describe, expect, it } from 'vitest';
import type { RawCatalog } from '#lib/types.ts';
import { buildCatalog } from '#lib/merge/index.ts';
import { enrichTitles, emptyIndex, memoryCache, RateLimiter, TmdbClient } from './index.ts';
import { normalizeCertification } from './client.ts';

const NOW = Date.UTC(2026, 9, 9, 12);

function fakeFetch(log: string[]): typeof fetch {
	return (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = new URL(String(input));
		log.push(
			url.pathname + (init?.headers && 'Authorization' in (init.headers as object) ? ' bearer' : '')
		);
		const json = (body: unknown, status = 200) =>
			new Response(JSON.stringify(body), {
				status,
				headers: { 'content-type': 'application/json' }
			});
		if (url.pathname === '/3/search/movie') {
			const q = url.searchParams.get('query') ?? '';
			return json({
				results: /uhrmacher|clockmaker|horloger/i.test(q)
					? [{ id: 4242, release_date: '1980-05-01' }]
					: []
			});
		}
		if (url.pathname === '/3/movie/4242') {
			return json({
				id: 4242,
				title: 'De Klokkenmaker',
				original_title: 'Der Uhrmacher',
				original_language: 'de',
				overview: 'Een klokkenmaker in Wenen…',
				genres: [{ name: 'Drama' }],
				runtime: 101,
				release_date: '1980-05-01',
				vote_average: 7.46,
				poster_path: '/p.jpg',
				credits: {
					cast: [{ name: 'A. Actor', character: 'Klokkenmaker' }],
					crew: [{ job: 'Director', name: 'R. Regisseur' }]
				},
				videos: { results: [{ site: 'YouTube', type: 'Trailer', key: 'abc' }] },
				translations: {
					translations: [
						{ iso_639_1: 'fr', data: { title: "L'Horloger" } },
						{ iso_639_1: 'en', data: { title: 'The Clockmaker' } }
					]
				},
				alternative_titles: { titles: [] },
				release_dates: { results: [{ iso_3166_1: 'NL', release_dates: [{ certification: '12' }] }] }
			});
		}
		return json({}, 404);
	}) as typeof fetch;
}

describe('TMDB client', () => {
	it('v3 key as query parameter, v4 token as bearer; responses are cached', async () => {
		const log: string[] = [];
		const v3 = new TmdbClient('0123456789abcdef0123456789abcdef', {
			fetch: fakeFetch(log),
			cache: memoryCache()
		});
		expect(await v3.search('movie', 'Der Uhrmacher', 1980)).toBe(4242);
		expect(await v3.search('movie', 'Der Uhrmacher', 1980)).toBe(4242);
		expect(log).toEqual(['/3/search/movie']);
		const v4 = new TmdbClient('eyJhbGciOiJIUzI1NiJ9.token', {
			fetch: fakeFetch(log),
			cache: memoryCache()
		});
		await v4.search('movie', 'The Clockmaker');
		expect(log[1]).toBe('/3/search/movie bearer');
	});

	it('maps details incl. certification, trailer and translations', async () => {
		const c = new TmdbClient('k'.repeat(32), { fetch: fakeFetch([]) });
		const d = await c.details('movie', 4242, 'nl');
		expect(d).toMatchObject({
			title: 'De Klokkenmaker',
			originalLang: 'de',
			runtimeMin: 101,
			rating: 7.5,
			certification: '12',
			director: 'R. Regisseur'
		});
		expect(d.trailerUrl).toBe('https://www.youtube.com/watch?v=abc');
		expect(d.posterUrl).toBe('https://image.tmdb.org/t/p/w500/p.jpg');
		expect(d.altTitles).toContainEqual({ title: "L'Horloger", lang: 'fr' });
	});

	it('normalises certifications', () => {
		expect(normalizeCertification('US', 'PG-13')).toBe('12');
		expect(normalizeCertification('NL', 'AL')).toBe('AL');
		expect(normalizeCertification('DE', '16')).toBe('16');
	});

	it('rate limiter allows max calls per window', async () => {
		let t = 0;
		const waits: number[] = [];
		const rl = new RateLimiter(
			2,
			1000,
			() => t,
			async (ms) => {
				waits.push(ms);
				t += ms;
			}
		);
		await rl.take();
		await rl.take();
		await rl.take();
		expect(waits).toHaveLength(1);
		expect(t).toBeGreaterThanOrEqual(1000);
	});
});

describe('enrichment feeds the next build', () => {
	it('translated titles merge after enrichment', async () => {
		const raws: RawCatalog[] = [
			{
				sourceId: 'a',
				fetchedAt: NOW,
				movies: [
					{
						kind: 'movie',
						sourceId: 'a',
						providerId: '1',
						rawTitle: 'DE - Der Uhrmacher (1980)',
						url: 'u1'
					},
					{
						kind: 'movie',
						sourceId: 'a',
						providerId: '2',
						rawTitle: "FR - L'Horloger (1980)",
						url: 'u2'
					},
					{
						kind: 'movie',
						sourceId: 'a',
						providerId: '3',
						rawTitle: 'EN - The Clockmaker (1980)',
						url: 'u3'
					}
				],
				series: [],
				channels: [],
				epg: []
			}
		];
		const before = buildCatalog(raws, { now: NOW });
		expect(before.titles).toHaveLength(3);
		const index = emptyIndex();
		const client = new TmdbClient('k'.repeat(32), { fetch: fakeFetch([]) });
		const batches: boolean[] = [];
		await enrichTitles({
			apiKey: 'x',
			lang: 'nl',
			titles: before.titles,
			index,
			client,
			batchSize: 2,
			onBatch: (_i, changed) => void batches.push(changed)
		});
		expect(batches.length).toBe(2);
		const after = buildCatalog(raws, { now: NOW, tmdb: index });
		expect(after.titles).toHaveLength(1);
		expect(after.titles[0]).toMatchObject({
			id: 'tmdb-m-4242',
			overview: 'Een klokkenmaker in Wenen…',
			certification: '12',
			originalLang: 'de'
		});
		expect(after.titles[0].variants).toHaveLength(3);
	});

	it('skips titles from skipped sources', async () => {
		const index = emptyIndex();
		const log: string[] = [];
		const before = buildCatalog(
			[
				{
					sourceId: 'sample',
					fetchedAt: NOW,
					movies: [
						{
							kind: 'movie',
							sourceId: 'sample',
							providerId: '1',
							rawTitle: 'EN - The Clockmaker (1980)',
							url: 'u'
						}
					],
					series: [],
					channels: [],
					epg: []
				}
			],
			{ now: NOW }
		);
		await enrichTitles({
			apiKey: 'x',
			lang: 'nl',
			titles: before.titles,
			index,
			client: new TmdbClient('k'.repeat(32), { fetch: fakeFetch(log) }),
			skipSource: (s) => s === 'sample'
		});
		expect(log).toEqual([]);
	});
});
