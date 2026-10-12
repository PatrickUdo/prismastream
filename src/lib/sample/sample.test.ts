import { describe, expect, it } from 'vitest';
import { buildCatalog } from '#lib/merge/index.ts';
import { matchKey } from '#lib/merge/normalize.ts';
import { pickVariant } from '#lib/merge/pick.ts';
import { sampleCatalog, sampleCatalogs, SAMPLE_SOURCE, SAMPLE_SOURCE_IDS } from './index.ts';
import { CHANNELS } from './data/channels.ts';
import { FILMS } from './data/films.ts';
import { SERIES } from './data/series.ts';
import { generateEpg } from './build.ts';

const NOW = Date.UTC(2026, 9, 9, 12);
const raws = sampleCatalogs(NOW);
const cat = buildCatalog(raws, { now: NOW });
const movies = cat.titles.filter((t) => t.kind === 'movie');
const series = cat.titles.filter((t) => t.kind === 'series');
const ALLOWED_STREAMS = [
	'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
	'https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8',
	'https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_ts/master.m3u8',
	'https://test-streams.mux.dev/test_001/stream.m3u8'
];

function find(kind: 'movie' | 'series', nlTitle: string, year?: number) {
	return cat.titles.filter(
		(t) =>
			t.kind === kind && t.altTitles.some((a) => a.title === nlTitle) && (!year || t.year === year)
	);
}

describe('sample library', () => {
	it('three sources; the primary keeps the SAMPLE_SOURCE id', () => {
		expect(raws.map((r) => r.sourceId)).toEqual(SAMPLE_SOURCE_IDS);
		expect(sampleCatalog(NOW).sourceId).toBe(SAMPLE_SOURCE.id);
	});

	it('is big enough: ≥45 films, ≥12 series, ~30 channels', () => {
		expect(FILMS.length).toBeGreaterThanOrEqual(45);
		expect(SERIES.length).toBeGreaterThanOrEqual(12);
		expect(CHANNELS.length).toBeGreaterThanOrEqual(30);
	});

	it('merges every film and series exactly once', () => {
		expect(movies).toHaveLength(FILMS.length);
		expect(series).toHaveLength(SERIES.length);
		expect(new Set(cat.titles.map((t) => t.id)).size).toBe(cat.titles.length);
		const rawCount = raws.reduce((n, r) => n + r.movies.length + r.series.length, 0);
		expect(rawCount).toBeGreaterThan(cat.titles.length * 4);
	});

	it('no duplicate titles (same kind, key and year)', () => {
		const seen = new Set<string>();
		for (const t of cat.titles) {
			const k = `${t.kind}|${matchKey(t.title)}|${t.year}`;
			expect(seen.has(k), k).toBe(false);
			seen.add(k);
		}
	});

	it('all 10 languages are present', () => {
		const langs = new Set(cat.titles.flatMap((t) => t.languages));
		for (const l of ['nl', 'en', 'de', 'fr', 'es', 'it', 'tr', 'ar', 'pl', 'pt'])
			expect(langs.has(l), l).toBe(true);
		const flagship = find('movie', 'Het Laatste Licht')[0];
		expect(flagship.languages).toHaveLength(10);
		expect(flagship.subtitleLanguages.sort()).toEqual(['fr', 'nl']);
		expect(flagship.qualities).toEqual(['4K', 'FHD', 'HD']);
	});

	it('trap: remakes with the same title stay apart', () => {
		const nw = cat.titles.filter(
			(t) => t.kind === 'movie' && t.altTitles.some((a) => a.title === 'Nachtwacht')
		);
		expect(nw.map((t) => t.year).sort()).toEqual([1998, 2021]);
	});

	it('trap: a film and a series with the same name', () => {
		expect(find('movie', 'De Grens')).toHaveLength(1);
		expect(find('series', 'De Grens')).toHaveLength(1);
	});

	it('trap: "2" and "II" merge, the original stays apart', () => {
		const sequel = find('movie', 'Stormvogel 2');
		expect(sequel).toHaveLength(1);
		expect(sequel[0].variants.some((v) => v.label.includes('Stormvogel II'))).toBe(true);
		expect(find('movie', 'Stormvogel')[0].id).not.toBe(sequel[0].id);
	});

	it('trap: a title without year joins its film', () => {
		const t = find('movie', 'Het Zoutpad');
		expect(t).toHaveLength(1);
		expect(t[0].variants.some((v) => v.label === 'NL - Het Zoutpad')).toBe(true);
	});

	it('trap: ±1 year, subtitle-less, diacritic-less and "&"/"en" spellings merge', () => {
		expect(
			find('movie', 'Koraalkoorts')[0].variants.some((v) => v.label.includes('Coral Fever 2023'))
		).toBe(true);
		expect(
			find('movie', 'Missie Ares: Rode Planeet')[0].variants.some((v) =>
				v.label.includes('Mission Ares 2019')
			)
		).toBe(true);
		expect(
			find('movie', 'Het Laatste Licht')[0].variants.some((v) =>
				v.label.includes('Derniere Lumiere')
			)
		).toBe(true);
		expect(
			find('movie', 'Lars & Lotte')[0].variants.some((v) => v.label.includes('Lars en Lotte'))
		).toBe(true);
	});

	it('trap: "+1" channels stay separate', () => {
		const ids = cat.channels.map((c) => c.id);
		expect(ids).toContain('ch-prisma-cinema-nl');
		expect(ids).toContain('ch-prisma-cinema-plus1-nl');
		expect(ids).toContain('ch-kanaal-noord-plus1-nl');
		expect(cat.channels.find((c) => c.id === 'ch-prisma-cinema-plus1-nl')!.epgId).toBe(
			'prismacinemaplus1.nl'
		);
		expect(cat.channels).toHaveLength(CHANNELS.length);
	});

	it('series: seasons, episodes, languages with gaps', () => {
		for (const s of series) {
			expect(s.seasons!.length).toBeGreaterThanOrEqual(2);
			for (const season of s.seasons!) {
				expect(season.episodes.length).toBeGreaterThanOrEqual(4);
				expect(season.episodes.length).toBeLessThanOrEqual(10);
			}
			expect(s.languages.length).toBeGreaterThanOrEqual(2);
		}
		const grens = find('series', 'De Grens')[0];
		const s1e1 = grens.seasons![0].episodes[0];
		expect(new Set(s1e1.variants.flatMap((v) => v.audioLangs))).toEqual(
			new Set(['nl', 'en', 'de', 'tr'])
		);
		const last = grens.seasons!.at(-1)!.episodes.at(-1)!;
		expect(last.variants.flatMap((v) => v.audioLangs)).not.toContain('tr');
		expect(s1e1.title).not.toMatch(/^Aflevering/);
	});

	it('metadata: plots, cast with roles, genres in Dutch, certification, kidsSafe, trailers', () => {
		for (const t of cat.titles) {
			expect(t.overview, t.title).toBeTruthy();
			expect(t.cast.length).toBeGreaterThan(0);
			expect(t.genres.length).toBeGreaterThan(0);
			expect(t.certification).toBeTruthy();
			expect(t.posterUrl).toBeUndefined();
		}
		expect(cat.titles.some((t) => t.cast.some((p) => p.character))).toBe(true);
		const pip = find('movie', 'Pip en de Papieren Maan')[0];
		expect(pip.kidsSafe).toBe(true);
		expect(find('movie', 'Het Huis op de Heideheuvel')[0].kidsSafe).toBe(false);
		expect(cat.titles.filter((t) => t.trailerUrl).length).toBeGreaterThanOrEqual(3);
		const genres = new Set(cat.titles.flatMap((t) => t.genres));
		for (const g of [
			'Sciencefiction',
			'Thriller',
			'Drama',
			'Komedie',
			'Actie',
			'Avontuur',
			'Animatie',
			'Horror',
			'Documentaire',
			'Romantiek',
			'Misdaad',
			'Fantasy'
		])
			expect(genres.has(g), g).toBe(true);
	});

	it('original language is known for translated titles', () => {
		expect(find('movie', 'Papieren Vogels')[0].originalLang).toBe('fr');
		expect(find('movie', "Stad van Echo's")[0].originalLang).toBe('tr');
	});

	it('only public test streams', () => {
		const urls = new Set<string>();
		for (const r of raws) {
			for (const m of r.movies) urls.add(m.url);
			for (const s of r.series) for (const e of s.episodes ?? []) urls.add(e.url);
			for (const c of r.channels) urls.add(c.url);
			for (const m of r.movies) if (m.trailerUrl) urls.add(m.trailerUrl);
		}
		for (const u of urls) expect(ALLOWED_STREAMS).toContain(u);
	});

	it('pickVariant picks Dutch for a Dutch profile and falls back to the original language', () => {
		const t = find('movie', 'Papieren Vogels')[0];
		expect(
			pickVariant(t.variants, { audioLangs: ['nl'], subtitleLangs: [], subtitlesOn: false })
				?.audioLangs
		).toContain('nl');
		expect(
			pickVariant(t.variants, { audioLangs: ['ja'], subtitleLangs: [], subtitlesOn: false }, t)
				?.audioLangs
		).toContain('fr');
	});

	it('addedAt spread over the last 60 days', () => {
		for (const t of cat.titles) {
			expect(t.addedAt).toBeLessThanOrEqual(NOW);
			expect(NOW - t.addedAt).toBeLessThan(61 * 86_400_000);
		}
	});

	it('EPG: "now" and "next" are filled for every channel with a guide', () => {
		const noEpg = new Set(CHANNELS.filter((c) => c.noEpg).map((c) => c.name));
		for (const c of cat.channels) {
			if (noEpg.has(c.name)) continue;
			const list = cat.epg[c.epgId!];
			expect(list?.length, c.name).toBeGreaterThan(0);
			const i = list.findIndex((p) => p.start <= NOW && p.stop > NOW);
			expect(i, c.name).toBeGreaterThanOrEqual(0);
			expect(list[i + 1], c.name).toBeDefined();
			expect(list[0].start).toBeLessThanOrEqual(NOW - 5 * 3600_000);
			expect(list.at(-1)!.stop).toBeGreaterThanOrEqual(NOW + 23 * 3600_000);
			for (const p of list) expect(p.stop - p.start).toBeLessThanOrEqual(120 * 60_000);
		}
	});

	it('two demo channels have no EPG (the "no programme information" state)', () => {
		const without = cat.channels.filter((c) => !cat.epg[c.epgId ?? '']?.length);
		expect(without.map((c) => c.name).sort()).toEqual(['Neon Hits TV', 'Omroep Lindeburg']);
		expect(CHANNELS.filter((c) => c.noEpg)).toHaveLength(2);
		expect(cat.channels).toHaveLength(34);
	});

	it('EPG is deterministic per day and the +1 feed is shifted one hour', () => {
		const a = generateEpg(NOW);
		const b = generateEpg(NOW + 60_000);
		const pick = (l: typeof a, id: string) =>
			l.filter((p) => p.channelId === id && p.start > NOW && p.start < NOW + 6 * 3600_000);
		expect(pick(a, 'prisma1.nl').map((p) => p.title)).toEqual(
			pick(b, 'prisma1.nl').map((p) => p.title)
		);
		const base = a.find((p) => p.channelId === 'prismacinema.nl' && p.start > NOW)!;
		expect(
			a.find((p) => p.channelId === 'prismacinemaplus1.nl' && p.start === base.start + 3600_000)
				?.title
		).toBe(base.title);
	});
});
