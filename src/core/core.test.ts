// Proves that the BUILT core bundle (vite.core.config.ts) works in a bare JavaScript context,
// like JavaScriptCore on Apple TV: no window, document, console, URL, TextDecoder, fetch,
// structuredClone or timers. The bundle is built in memory with the Vite API (nothing is
// written; `npm run build:core` writes tvos/PrismaStream/Resources/prisma-core.js).
import { beforeAll, describe, expect, it } from 'vitest';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import type {
	Catalog,
	EpgProgramme,
	RawCatalog,
	RawChannel,
	RawEpisode,
	RawMovie,
	RawSeries,
	StreamVariant,
	Title
} from '#lib/types.ts';
import { splitUrlPure } from '#lib/providers/util.ts';

/** The PrismaCore global, as Swift sees it: strings in, strings out. */
interface Core {
	version(): string;
	sampleCatalogs(): string;
	sampleSources(): string;
	buildCatalog(raws: string, opts?: string): string;
	mergeSeasons(title: string, sources: string, opts?: string): string;
	parseM3U(text: string, sourceId: string): string;
	xtreamMap(kind: string, json: string, ctx?: string): string;
	parseXmltv(text: string, opts?: string): string;
	pickVariant(variants: string, prefs: string, title?: string): string;
	groupVariantsByLanguage(variants: string, prefs?: string): string;
	summarizeLanguages(title: string, prefs?: string): string;
	displayTitle(title: string, prefs: string): string;
	searchIndex(catalog?: string): string;
	search(query: string, limit?: number): string;
	recommend(catalog: string | null, history: string, favorites: string, limit?: number): string;
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const J = JSON.stringify;

let code = '';
let core: Core;
let context: vm.Context;

async function buildBundle(): Promise<string> {
	const result = await build({
		root,
		configFile: path.join(root, 'vite.core.config.ts'),
		logLevel: 'silent',
		build: { write: false }
	});
	const outputs = Array.isArray(result) ? result : [result];
	const chunks = outputs.flatMap((o) =>
		'output' in o ? o.output.filter((c) => c.type === 'chunk') : []
	);
	expect(chunks).toHaveLength(1);
	return (chunks[0] as { code: string }).code;
}

beforeAll(async () => {
	code = await buildBundle();
	// A bare context: only the ECMAScript built-ins (what JavaScriptCore guarantees).
	context = vm.createContext({});
	vm.runInContext(code, context, { filename: 'prisma-core.js' });
	core = vm.runInContext('PrismaCore', context) as Core;
}, 120_000);

describe('bundle', () => {
	it('is one IIFE with the PrismaCore global and no imports', () => {
		expect(code.startsWith('var PrismaCore=')).toBe(true);
		expect(code).not.toMatch(/\bimport\s*\(|\brequire\(|^\s*import\s/m);
		expect(code.length).toBeLessThan(500 * 1024);
	});

	it('runs in a context without browser or Node globals', () => {
		for (const g of ['window', 'document', 'fetch', 'URL', 'TextDecoder', 'setTimeout'])
			expect(vm.runInContext(`typeof ${g}`, context)).toBe('undefined');
		// Polyfilled by the bundle itself.
		expect(vm.runInContext('typeof structuredClone', context)).toBe('function');
		expect(vm.runInContext('typeof console.log', context)).toBe('function');
	});

	it('contains no Svelte runtime', () => {
		expect(code).not.toMatch(/\$state|svelte/i);
	});

	it('version() is a plain x.y.z string', () => {
		expect(core.version()).toMatch(/^\d+\.\d+\.\d+$/);
	});
});

describe('sample data and catalog', () => {
	let raws: RawCatalog[];
	let catalog: Catalog;
	let lastLight: Title;

	beforeAll(() => {
		raws = JSON.parse(core.sampleCatalogs());
		catalog = JSON.parse(core.buildCatalog(J(raws), J({ preferLang: 'nl' })));
		lastLight = catalog.titles.find((t) => t.id === 'tmdb-m-910001')!;
	});

	it('sampleSources() lists the 3 demo sources', () => {
		const sources = JSON.parse(core.sampleSources());
		expect(sources).toHaveLength(3);
		for (const s of sources) expect(s.type).toBe('sample');
		expect(sources.map((s: { id: string }) => s.id)).toContain('sample');
	});

	it('buildCatalog merges the 3 demo sources into 61+ titles', () => {
		expect(raws).toHaveLength(3);
		expect(catalog.titles.length).toBeGreaterThanOrEqual(61);
		expect(catalog.channels.length).toBeGreaterThan(0);
		expect(Object.keys(catalog.epg).length).toBeGreaterThan(0);
	});

	it('"The Last Light" is one title with 10 languages', () => {
		expect(lastLight).toBeDefined();
		expect(lastLight.title).toBe('The Last Light');
		expect(lastLight.languages).toHaveLength(10);
	});

	it('displayTitle gives the Dutch title for uiLang nl', () => {
		expect(core.displayTitle(J(lastLight), J({ uiLang: 'nl', audioLangs: ['nl', 'en'] }))).toBe(
			'Het Laatste Licht'
		);
		expect(core.displayTitle(J(lastLight), J({ uiLang: 'en', audioLangs: ['en'] }))).toBe(
			'The Last Light'
		);
	});

	it('pickVariant picks a Dutch version for a Dutch profile', () => {
		const prefs = { audioLangs: ['nl', 'en'], subtitleLangs: ['nl'], subtitlesOn: false };
		const v: StreamVariant = JSON.parse(
			core.pickVariant(J(lastLight.variants), J(prefs), J(lastLight))
		);
		expect(v.audioLangs).toContain('nl');
		expect(lastLight.variants.map((x) => x.id)).toContain(v.id);
		expect(core.pickVariant('[]', J(prefs))).toBe('null');
	});

	it('groupVariantsByLanguage groups per audio language', () => {
		const groups: { lang: string; variants: StreamVariant[] }[] = JSON.parse(
			core.groupVariantsByLanguage(J(lastLight.variants), J({ audioLangs: ['nl'] }))
		);
		expect(groups[0].lang).toBe('nl');
		expect(groups.length).toBeGreaterThanOrEqual(10);
	});

	it('summarizeLanguages returns a plain summary string', () => {
		expect(core.summarizeLanguages(J(lastLight))).toMatch(/^NL · EN · [A-Z]{2} \+7$/);
		expect(core.summarizeLanguages(J({ languages: ['und'] }))).toBe('');
	});

	it('search finds exactly one film for "Das Letzte Licht"', () => {
		expect(core.searchIndex(J(catalog))).toBe('true');
		const r = JSON.parse(core.search('Das Letzte Licht'));
		expect(r.movies).toHaveLength(1);
		expect(r.movies[0].id).toBe('tmdb-m-910001');
		expect(r.akas['tmdb-m-910001']).toBe('Das Letzte Licht');
		expect(Array.isArray(r.series)).toBe(true);
		expect(Array.isArray(r.people)).toBe(true);
		expect(Array.isArray(r.channels)).toBe(true);
		expect(Array.isArray(r.genres)).toBe(true);
		const limited = JSON.parse(core.search('the', 2));
		expect(limited.movies.length).toBeLessThanOrEqual(2);
	});

	it('recommend returns title ids, without favorites and watched titles', () => {
		const ids: string[] = JSON.parse(
			core.recommend(null, J(['tmdb-m-910001']), J([catalog.titles[1].id]), 10)
		);
		expect(ids.length).toBe(10);
		expect(ids).not.toContain('tmdb-m-910001');
		expect(ids).not.toContain(catalog.titles[1].id);
		for (const id of ids) expect(catalog.titles.some((t) => t.id === id)).toBe(true);
	});

	it('mergeSeasons adds lazily loaded episodes to a series', () => {
		const series = catalog.titles.find((t) => t.kind === 'series')!;
		const before = series.seasons?.length ?? 0;
		const episodes: RawEpisode[] = [
			{ providerId: 'e1', season: 90, episode: 1, title: 'Pilot', url: 'https://x.test/1.mp4' },
			{ providerId: 'e2', season: 90, episode: 2, url: 'https://x.test/2.mp4' }
		];
		const updated: Title = JSON.parse(
			core.mergeSeasons(
				J(series),
				J([{ sourceId: 'xt', providerId: '77', langs: ['de'], episodes }]),
				J({ preferLang: 'nl' })
			)
		);
		expect(updated.id).toBe(series.id);
		expect(updated.seasons).toHaveLength(before + 1);
		const s90 = updated.seasons!.find((s) => s.number === 90)!;
		expect(s90.episodes.map((e) => e.title)).toEqual(['Pilot', 'Aflevering 2']);
		expect(s90.episodes[0].id).toBe(`${series.id}/s90e1`);
		expect(s90.episodes[0].variants[0]).toMatchObject({ id: 'xt:e1', audioLangs: ['de'] });
		expect(updated.languages).toContain('de');
	});
});

describe('parsers', () => {
	it('parseM3U parses live, movie and series entries', () => {
		const text = [
			'#EXTM3U url-tvg="https://epg.test/guide.xml"',
			'#EXTINF:-1 tvg-id="prisma1.nl" tvg-logo="https://img.test/p1.png" group-title="NL | Algemeen",NL: Prisma 1 HD',
			'http://iptv.test/live/u/p/101.ts',
			'#EXTINF:-1 group-title="NL | Films",NL - Het Laatste Licht (2023)',
			'http://iptv.test/movie/u/p/201.mp4',
			'#EXTINF:-1 group-title="Series | EN",Harbour Lights S01E01',
			'http://iptv.test/series/u/p/301.mkv',
			'#EXTINF:-1 group-title="Series | EN",Harbour Lights S01E02',
			'http://iptv.test/series/u/p/302.mkv'
		].join('\r\n');
		const r: { catalog: RawCatalog; epgUrl?: string; epgUrls: string[] } = JSON.parse(
			core.parseM3U(text, 'm3u-1')
		);
		expect(r.epgUrl).toBe('https://epg.test/guide.xml');
		expect(r.catalog.sourceId).toBe('m3u-1');
		expect(r.catalog.channels).toHaveLength(1);
		expect(r.catalog.channels[0]).toMatchObject({ kind: 'live', tvgId: 'prisma1.nl' });
		expect(r.catalog.movies).toHaveLength(1);
		expect(r.catalog.movies[0]).toMatchObject({ kind: 'movie', year: 2023, containerExt: 'mp4' });
		expect(r.catalog.series).toHaveLength(1);
		expect(r.catalog.series[0].episodes).toHaveLength(2);
		expect(r.catalog.epg).toEqual([]);
		expect(() => core.parseM3U('#EXTM3U\n', 'm3u-1')).toThrow(/no entries/);
	});

	it('parseXmltv parses synchronously with window and channel filter', () => {
		const now = Date.UTC(2026, 9, 9, 12);
		const t = (ms: number) => {
			const d = new Date(ms);
			const p = (n: number) => String(n).padStart(2, '0');
			return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}00 +0000`;
		};
		const H = 3_600_000;
		const xml = `<?xml version="1.0" encoding="UTF-8"?>
<tv>
  <channel id="a.nl"><display-name>A</display-name></channel>
  <programme channel="b.nl" start="${t(now)}" stop="${t(now + H)}"><title>B now</title></programme>
  <programme channel="a.nl" start="${t(now + H)}" stop="${t(now + 2 * H)}"><title lang="nl">Later &amp; meer</title><desc>Twee</desc></programme>
  <programme channel="a.nl" start="${t(now)}" stop="${t(now + H)}"><title>Nu</title><category>Nieuws</category></programme>
  <programme channel="a.nl" start="${t(now - 30 * H)}" stop="${t(now - 29 * H)}"><title>Oud</title></programme>
</tv>`;
		const all: EpgProgramme[] = JSON.parse(
			core.parseXmltv(xml, J({ windowStart: now - 6 * H, windowEnd: now + 48 * H }))
		);
		expect(all.map((p) => p.title)).toEqual(['Nu', 'Later & meer', 'B now']);
		expect(all[0]).toMatchObject({
			channelId: 'a.nl',
			start: now,
			stop: now + H,
			category: 'Nieuws'
		});
		const onlyA: EpgProgramme[] = JSON.parse(
			core.parseXmltv(
				xml,
				J({ windowStart: now - 6 * H, windowEnd: now + 48 * H, channelIds: ['a.nl'] })
			)
		);
		expect(onlyA.every((p) => p.channelId === 'a.nl')).toBe(true);
		expect(onlyA).toHaveLength(2);
	});
});

describe('xtreamMap', () => {
	const ctx = {
		sourceId: 'xt',
		serverUrl: 'Panel.Test:8080/player_api.php',
		username: 'user',
		password: 'p@ss',
		categories: { '1': 'NL | Films', '2': 'Series NL', '3': 'NL | Nieuws' }
	};

	it('maps category lists to a map', () => {
		const cats = JSON.parse(
			core.xtreamMap(
				'vodCategories',
				J([
					{ category_id: '1', category_name: 'NL | Films' },
					{ category_id: 2, category_name: 'EN | Movies' }
				])
			)
		);
		expect(cats).toEqual({ '1': 'NL | Films', '2': 'EN | Movies' });
		for (const k of ['seriesCategories', 'liveCategories'])
			expect(JSON.parse(core.xtreamMap(k, J([{ category_id: '3', category_name: 'X' }])))).toEqual({
				'3': 'X'
			});
	});

	it('vod → RawMovie[] with credential stream urls', () => {
		const movies: RawMovie[] = JSON.parse(
			core.xtreamMap(
				'vod',
				J([
					{
						stream_id: 201,
						name: 'NL - Het Laatste Licht (2023)',
						category_id: '1',
						container_extension: 'mkv',
						tmdb: '910001',
						rating: '7.9',
						added: '1700000000'
					},
					{ stream_id: '', name: 'broken' }
				]),
				J(ctx)
			)
		);
		expect(movies).toHaveLength(1);
		expect(movies[0]).toMatchObject({
			kind: 'movie',
			sourceId: 'xt',
			providerId: '201',
			category: 'NL | Films',
			tmdbId: 910001,
			rating: 7.9,
			addedAt: 1_700_000_000_000,
			containerExt: 'mkv',
			url: 'http://panel.test:8080/movie/user/p%40ss/201.mkv'
		});
	});

	it('series → RawSeries[]', () => {
		const series: RawSeries[] = JSON.parse(
			core.xtreamMap(
				'series',
				J([{ series_id: '77', name: 'Harbour Lights', category_id: '2', year: '2021' }]),
				J(ctx)
			)
		);
		expect(series).toEqual([
			{
				kind: 'series',
				sourceId: 'xt',
				providerId: '77',
				rawTitle: 'Harbour Lights',
				category: 'Series NL',
				year: 2021
			}
		]);
	});

	it('live → RawChannel[]', () => {
		const channels: RawChannel[] = JSON.parse(
			core.xtreamMap(
				'live',
				J([
					{
						stream_id: '101',
						name: 'NL: Prisma 1 HD',
						num: 1,
						epg_channel_id: 'prisma1.nl',
						category_id: '3',
						tv_archive: 1,
						tv_archive_duration: '3'
					}
				]),
				J(ctx)
			)
		);
		expect(channels[0]).toMatchObject({
			kind: 'live',
			providerId: '101',
			tvgId: 'prisma1.nl',
			group: 'NL | Nieuws',
			number: 1,
			catchupDays: 3,
			url: 'http://panel.test:8080/live/user/p%40ss/101.m3u8'
		});
	});

	it('seriesInfo → RawEpisode[] and seriesDetails → { info, episodes }', () => {
		const info = {
			info: { plot: 'Een haven.', genre: 'Drama' },
			episodes: {
				'2': [{ id: '502', episode_num: '1', container_extension: 'mp4', title: 'S2E1' }],
				'1': [
					{ id: '501', episode_num: 2, info: { duration_secs: 2700 } },
					{ id: '500', episode_num: 1 }
				]
			}
		};
		const eps: RawEpisode[] = JSON.parse(
			core.xtreamMap('seriesInfo', J(info), J({ ...ctx, seriesId: '77' }))
		);
		expect(eps.map((e) => [e.season, e.episode, e.providerId])).toEqual([
			[1, 1, '500'],
			[1, 2, '501'],
			[2, 1, '502']
		]);
		expect(eps[1].durationSec).toBe(2700);
		expect(eps[0].url).toBe('http://panel.test:8080/series/user/p%40ss/500.mp4');
		const details = JSON.parse(core.xtreamMap('seriesDetails', J(info), J(ctx)));
		expect(details.info).toEqual({ plot: 'Een haven.', genres: ['Drama'] });
		expect(details.episodes).toHaveLength(3);
	});

	it('account → account info; rejected login throws', () => {
		const acc = JSON.parse(
			core.xtreamMap(
				'account',
				J({
					user_info: { auth: 1, status: 'Active', exp_date: null, max_connections: '2' },
					server_info: { timezone: 'Europe/Amsterdam' }
				})
			)
		);
		expect(acc).toMatchObject({ status: 'Active', maxConnections: 2, isTrial: false });
		expect(acc.timezone).toBe('Europe/Amsterdam');
		expect(() => core.xtreamMap('account', J({ user_info: { auth: 0 } }))).toThrow(/rejected/);
		expect(() => core.xtreamMap('nope', '[]', J(ctx))).toThrow(/unknown kind/);
	});
});

describe('splitUrlPure (URL replacement for JavaScriptCore)', () => {
	it.each([
		'http://panel.test',
		'http://Panel.TEST:8080/player_api.php',
		'https://host.test:443/a/b/',
		'http://host.test:80',
		'http://user:pw@host.test:8000/x?y=1#z',
		'https://10.0.0.1:25461/get.php?username=a&password=b',
		'http://[::1]:8080/',
		'http://host.test/a b'
	])('matches WHATWG URL for %s', (input) => {
		const u = new URL(input);
		expect(splitUrlPure(input)).toEqual({
			protocol: u.protocol,
			host: u.host,
			pathname: u.pathname
		});
	});

	it('rejects what URL rejects', () => {
		for (const input of ['http://', 'http://host:99999', 'not a url'])
			expect(splitUrlPure(input)).toBeUndefined();
	});
});
