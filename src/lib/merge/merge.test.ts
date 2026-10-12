import { describe, expect, it } from 'vitest';
import type { RawCatalog, RawChannel, RawEpisode, RawMovie, RawSeries, Title } from '#lib/types.ts';
import { buildCatalog, mergeSeasons, withSeasons, type BuildOptions } from './index.ts';
import { clusterItems } from './match.ts';
import { parseChannelName } from './channels.ts';
import { tmdbLookupKey } from '#lib/tmdb/types.ts';
import { matchKey } from './normalize.ts';

const NOW = Date.UTC(2026, 9, 9, 12);
let seq = 0;

function movie(rawTitle: string, extra: Partial<RawMovie> = {}): RawMovie {
	seq++;
	return {
		kind: 'movie',
		sourceId: 's1',
		providerId: `p${seq}`,
		rawTitle,
		url: `https://example.test/${seq}.m3u8`,
		...extra
	};
}

function series(rawTitle: string, extra: Partial<RawSeries> = {}): RawSeries {
	seq++;
	return { kind: 'series', sourceId: 's1', providerId: `p${seq}`, rawTitle, ...extra };
}

function ep(season: number, episode: number, extra: Partial<RawEpisode> = {}): RawEpisode {
	seq++;
	return {
		providerId: `e${seq}`,
		season,
		episode,
		url: `https://example.test/e${seq}.m3u8`,
		...extra
	};
}

function chan(rawName: string, extra: Partial<RawChannel> = {}): RawChannel {
	seq++;
	return {
		kind: 'live',
		sourceId: 's1',
		providerId: `c${seq}`,
		rawName,
		url: `https://example.test/c${seq}.m3u8`,
		...extra
	};
}

function catalogOf(
	sourceId: string,
	items: (RawMovie | RawSeries | RawChannel)[],
	epg: RawCatalog['epg'] = []
): RawCatalog {
	const withSource = <T extends { sourceId: string }>(x: T): T => ({ ...x, sourceId });
	return {
		sourceId,
		fetchedAt: NOW,
		movies: items.filter((i): i is RawMovie => i.kind === 'movie').map(withSource),
		series: items.filter((i): i is RawSeries => i.kind === 'series').map(withSource),
		channels: items.filter((i): i is RawChannel => i.kind === 'live').map(withSource),
		epg
	};
}

function build(raws: RawCatalog[], opts: BuildOptions = {}) {
	return buildCatalog(raws, { now: NOW, ...opts });
}

function titles(raws: RawCatalog[], opts?: BuildOptions): Title[] {
	return build(raws, opts).titles;
}

describe('matching: merges the same film', () => {
	it('via tmdbId across translated titles', () => {
		const t = titles([
			catalogOf('a', [movie('NL - Het Laatste Licht (2023)', { tmdbId: 1 })]),
			catalogOf('b', [
				movie('|EN| The Last Light 2023 4K', { tmdbId: 1 }),
				movie('TR ▎Son Işık (2023)', { tmdbId: 1 }),
				movie('AR - الضوء الأخير (2023)', { tmdbId: 1 })
			])
		]);
		expect(t).toHaveLength(1);
		expect(t[0].id).toBe('tmdb-m-1');
		expect(t[0].title).toBe('The Last Light');
		expect(t[0].variants).toHaveLength(4);
		expect(t[0].languages.sort()).toEqual(['ar', 'en', 'nl', 'tr']);
		expect(t[0].sourceIds.sort()).toEqual(['a', 'b']);
		expect(t[0].qualities).toContain('4K');
	});

	it('via imdbId', () => {
		const t = titles([
			catalogOf('a', [
				movie('DE: Das Uhrwerk (2017)', { imdbId: 'tt7654321' }),
				movie('PL - Mechanizm Zegara (2017)', { imdbId: 'https://imdb.com/title/tt7654321/' })
			])
		]);
		expect(t).toHaveLength(1);
		expect(t[0].id).toBe('imdb-tt7654321');
	});

	it('via normalised title + year across notations, languages and sources', () => {
		const t = titles([
			catalogOf('a', [movie('NL - Zoutwater (2021)'), movie('[NL] Zoutwater (2021) [4K]')]),
			catalogOf('b', [
				movie('|NL| ZOUTWATER 2021 FHD'),
				movie('Zoutwater (2021)', { category: 'NL | FILMS' })
			])
		]);
		expect(t).toHaveLength(1);
		expect(t[0].variants).toHaveLength(4);
		expect(t[0].languages).toEqual(['nl']);
		expect(t[0].id).toBe('k-movie-zoutwater-2021');
	});

	it('via original title + year (translated titles without ids)', () => {
		const t = titles([
			catalogOf('a', [
				movie('EN - Paper Birds (2019)', { originalTitle: 'Les Oiseaux de Papier' }),
				movie('NL - Papieren Vogels (2019)', { originalTitle: 'Les Oiseaux de Papier' }),
				movie('FR - Les Oiseaux de Papier (2019)')
			])
		]);
		expect(t).toHaveLength(1);
		expect(t[0].title).toBe('Paper Birds');
		expect(t[0].originalTitle).toBe('Les Oiseaux de Papier');
		expect(t[0].originalLang).toBe('fr');
		expect(t[0].altTitles).toEqual(
			expect.arrayContaining([
				{ title: 'Papieren Vogels', lang: 'nl' },
				{ title: 'Les Oiseaux de Papier', lang: 'fr' }
			])
		);
	});

	it('with ±1 year tolerance', () => {
		const t = titles([
			catalogOf('a', [movie('NL - Koraalkoorts (2022)', { originalTitle: 'Coral Fever' })]),
			catalogOf('b', [movie('|EN| Coral Fever 2023')])
		]);
		expect(t).toHaveLength(1);
	});

	it('diacritics, articles, "&"/"en", Roman numerals, subtitles', () => {
		const t = titles([
			catalogOf('a', [
				movie('FR - La Dernière Lumière (2023)'),
				movie('FR: La Derniere Lumiere (2023) HD'),
				movie('EN - The Glass Garden (2015)'),
				movie('EN - Glass Garden (2015)'),
				movie('NL - Lars & Lotte (2018)'),
				movie('NL: Lars en Lotte (2018)'),
				movie('NL - Stormvogel 2 (2017)'),
				movie('|NL| Stormvogel II 2017'),
				movie('EN - Mission Ares: Red Planet (2019)'),
				movie('|EN| Mission Ares 2019')
			])
		]);
		expect(t).toHaveLength(5);
		for (const x of t) expect(x.variants).toHaveLength(2);
	});

	it('via TMDB enrichment: translated titles resolving to the same tmdb id', () => {
		const raws = [
			catalogOf('a', [
				movie('EN - The Clockmaker (1980)'),
				movie('DE - Der Uhrmacher (1980)'),
				movie("FR - L'Horloger (1980)"),
				movie('NL - De Klokkenmaker (1980)')
			])
		];
		expect(titles(raws)).toHaveLength(4);
		const byKey: Record<string, number> = {};
		for (const name of ['The Clockmaker', 'Der Uhrmacher', "L'Horloger", 'De Klokkenmaker'])
			byKey[tmdbLookupKey('movie', matchKey(name), 1980)] = 4242;
		const merged = titles(raws, {
			tmdb: {
				byKey,
				meta: {
					'movie-4242': {
						id: 4242,
						kind: 'movie',
						title: 'The Clockmaker',
						originalTitle: 'Der Uhrmacher',
						originalLang: 'de',
						overview: 'Een klokkenmaker…',
						genres: ['Drama'],
						cast: [{ name: 'A. Actor', character: 'Klokkenmaker' }],
						certification: '12',
						altTitles: [],
						lang: 'nl',
						fetchedAt: NOW
					}
				}
			}
		});
		expect(merged).toHaveLength(1);
		expect(merged[0]).toMatchObject({
			id: 'tmdb-m-4242',
			overview: 'Een klokkenmaker…',
			originalLang: 'de',
			certification: '12',
			kidsSafe: false
		});
		expect(merged[0].variants).toHaveLength(4);
	});

	it('a title without year joins the only matching title', () => {
		const t = titles([
			catalogOf('a', [movie('NL - Het Zoutpad (2020)', { durationSec: 7200 })]),
			catalogOf('b', [movie('NL - Het Zoutpad')])
		]);
		expect(t).toHaveLength(1);
		expect(t[0].year).toBe(2020);
	});

	it('titles without year and id merge with each other', () => {
		const t = titles([
			catalogOf('a', [movie('NL - Polderkoorts'), movie('[NL] Polderkoorts [4K]')])
		]);
		expect(t).toHaveLength(1);
		expect(t[0].id).toBe('k-movie-polderkoorts');
	});
});

describe('matching: never merges different titles', () => {
	it('remakes with the same title stay separate', () => {
		const t = titles([
			catalogOf('a', [movie('NL - Nachtwacht (1998)'), movie('NL - Nachtwacht (2021)')]),
			catalogOf('b', [movie('|NL| Nachtwacht 1998'), movie('NL: Nachtwacht (2021) 4K')])
		]);
		expect(t).toHaveLength(2);
		expect(t.map((x) => x.id).sort()).toEqual([
			'k-movie-nachtwacht-1998',
			'k-movie-nachtwacht-2021'
		]);
		for (const x of t) expect(x.variants).toHaveLength(2);
	});

	it('a film and a series with the same name stay separate', () => {
		const t = titles([
			catalogOf('a', [
				movie('NL - De Grens (2016)', { tmdbId: 7 }),
				series('NL - De Grens (2016)', { tmdbId: 7 })
			])
		]);
		expect(t.map((x) => x.id).sort()).toEqual(['tmdb-m-7', 'tmdb-s-7']);
	});

	it('different tmdb ids with the same title and year stay separate (unique ids)', () => {
		const t = titles([
			catalogOf('a', [
				movie('EN - Home (2015)', { tmdbId: 1 }),
				movie('EN - Home (2015)', { tmdbId: 2 })
			]),
			catalogOf('b', [movie('EN - Home (2015)')])
		]);
		expect(t).toHaveLength(2);
		expect(new Set(t.map((x) => x.id)).size).toBe(2);
	});

	it('years more than one apart stay separate', () => {
		expect(
			titles([catalogOf('a', [movie('EN - Echo (2010)'), movie('EN - Echo (2012)')])])
		).toHaveLength(2);
	});

	it('a sequel is not its original', () => {
		const t = titles([
			catalogOf('a', [
				movie('NL - Stormvogel (2014)'),
				movie('NL - Stormvogel 2 (2017)'),
				movie('NL - Stormvogel II (2017)')
			])
		]);
		expect(t).toHaveLength(2);
	});

	it('an undated title matching two dated remakes stays separate (ambiguous)', () => {
		const t = titles([
			catalogOf('a', [
				movie('NL - Nachtwacht (1998)'),
				movie('NL - Nachtwacht (2021)'),
				movie('NL - Nachtwacht')
			])
		]);
		expect(t).toHaveLength(3);
	});

	it('an undated title with a very different runtime stays separate', () => {
		const t = titles([
			catalogOf('a', [
				movie('EN - Tides (2019)', { durationSec: 90 * 60 }),
				movie('EN - Tides', { durationSec: 150 * 60 })
			])
		]);
		expect(t).toHaveLength(2);
	});

	it('the same tmdb id with years far apart is split, ids stay unique', () => {
		const t = titles([
			catalogOf('a', [
				movie('EN - Odyssey (1968)', { tmdbId: 9 }),
				movie('EN - Odyssey (2024)', { tmdbId: 9 })
			])
		]);
		expect(t).toHaveLength(2);
		expect(new Set(t.map((x) => x.id)).size).toBe(2);
	});

	it('clusterItems never mixes movies and series', () => {
		const groups = clusterItems([
			{ kind: 'movie', keys: ['x'], weakKeys: [], year: 2000 },
			{ kind: 'series', keys: ['x'], weakKeys: [], year: 2000 }
		]);
		expect(groups).toHaveLength(2);
	});
});

describe('merged title content', () => {
	const raws = [
		catalogOf('a', [
			movie('NL - Het Laatste Licht (2023)', {
				tmdbId: 1,
				plot: 'Lange Nederlandse plot met veel details over de kolonie Eos en haar commandant.',
				genres: ['Sciencefiction', 'Drama'],
				cast: ['Mila Verhoef (Iris Vos)', 'Sven Bakker (Daan Kepler)', 'Noor Visser (WACHTER)'],
				director: 'Imke Brandsma',
				rating: 8,
				durationSec: 128 * 60,
				addedAt: NOW - 5 * 86_400_000,
				containerExt: 'mp4'
			})
		]),
		catalogOf('b', [
			movie('|EN| The Last Light 2023 4K', {
				tmdbId: 1,
				plot: 'Short English plot.',
				genres: ['Science Fiction', 'Action & Adventure'],
				cast: ['Mila Verhoef'],
				rating: 8.4,
				addedAt: NOW - 86_400_000
			}),
			movie('The Last Light (2023) VOSTFR', { tmdbId: 1, langHint: 'en' }),
			movie('[EN] The Last Light (2023) NL Subs', { tmdbId: 1 })
		])
	];
	const t = titles(raws)[0];

	it('one variant per raw item with id, languages, quality and label', () => {
		expect(t.variants).toHaveLength(4);
		const nl = t.variants.find((v) => v.id === 'a:' + raws[0].movies[0].providerId)!;
		expect(nl).toMatchObject({
			sourceId: 'a',
			audioLangs: ['nl'],
			label: 'NL - Het Laatste Licht (2023)',
			containerExt: 'mp4'
		});
		const vost = t.variants.find((v) => v.label.includes('VOSTFR'))!;
		expect(vost.audioLangs).toEqual(['en']);
		expect(vost.subtitleLangs).toEqual(['fr']);
		const subs = t.variants.find((v) => v.label.includes('NL Subs'))!;
		expect(subs.subtitleLangs).toEqual(['nl']);
		expect(t.variants[0].quality).toBe('4K');
		expect(t.subtitleLanguages.sort()).toEqual(['fr', 'nl']);
	});

	it('best metadata: plot in the preferred language, longest cast, merged Dutch genres', () => {
		expect(t.overview).toMatch(/^Lange Nederlandse plot/);
		expect(t.cast).toHaveLength(3);
		expect(t.cast[0]).toEqual({ name: 'Mila Verhoef', character: 'Iris Vos' });
		expect(t.genres).toEqual(['Sciencefiction', 'Drama', 'Actie', 'Avontuur']);
		expect(t.rating).toBe(8.2);
		expect(t.runtimeMin).toBe(128);
		expect(t.director).toBe('Imke Brandsma');
		expect(t.addedAt).toBe(NOW - 86_400_000);
		expect(t.popularity).toBeGreaterThan(0);
		expect(t.popularity).toBeLessThanOrEqual(100);
	});

	it('English overview when the profile language is English', () => {
		expect(titles(raws, { preferLang: 'en' })[0].overview).toBe('Short English plot.');
	});

	it('kidsSafe for family animation without certification', () => {
		const k = titles([
			catalogOf('a', [movie('NL - Pip (2008)', { genres: ['Animation', 'Family'] })])
		])[0];
		expect(k.kidsSafe).toBe(true);
		const h = titles([
			catalogOf('a', [movie('NL - Boo (2008)', { genres: ['Animation', 'Horror'] })])
		])[0];
		expect(h.kidsSafe).toBe(false);
	});
});

describe('stable ids', () => {
	const a = catalogOf('a', [
		movie('NL - Zoutwater (2021)'),
		movie('NL - De Bakkerij van Bas (2023)', { tmdbId: 55 }),
		series('NL - Kantoor 13 (2018)', { episodes: [ep(1, 1)] })
	]);
	const b = catalogOf('b', [movie('|EN| Saltwater 2021', { originalTitle: 'Zoutwater' })]);

	it('the same input gives the same ids, independent of source order', () => {
		const ids1 = titles([a, b])
			.map((t) => t.id)
			.sort();
		const ids2 = titles([b, a])
			.map((t) => t.id)
			.sort();
		expect(ids1).toEqual(ids2);
		expect(ids1).toEqual(['k-movie-zoutwater-2021', 'k-series-kantoor-13-2018', 'tmdb-m-55']);
	});

	it('adding a source keeps existing ids', () => {
		const before = titles([a])
			.map((t) => t.id)
			.sort();
		const after = titles([
			a,
			b,
			catalogOf('c', [movie('DE - Salzwasser (2021)', { originalTitle: 'Zoutwater' })])
		])
			.map((t) => t.id)
			.sort();
		expect(after).toEqual(before);
	});
});

describe('series', () => {
	it('merges seasons and episodes across sources and languages', () => {
		const raws = [
			catalogOf('a', [
				series('NL - De Grens (2016)', {
					tmdbId: 3,
					episodes: [
						ep(1, 1, { title: 'Het Begin', plot: 'NL plot' }),
						ep(1, 2, { title: 'Onder Water' }),
						ep(2, 1, { title: 'Grensgebied' })
					]
				})
			]),
			catalogOf('b', [
				series('|EN| The Border 2016', {
					tmdbId: 3,
					episodes: [
						ep(1, 1, { title: 'The Border S01E01 - The Beginning' }),
						ep(1, 2, { title: 'The Border S01E02 - Under Water' })
					]
				}),
				series('TR ▎Sınır (2016)', {
					tmdbId: 3,
					episodes: [ep(1, 1, { title: 'TR - Sınır S01E01' }), ep(1, 3)]
				})
			])
		];
		const t = titles(raws)[0];
		expect(t.id).toBe('tmdb-s-3');
		expect(t.seasons?.map((s) => s.number)).toEqual([1, 2]);
		const s1 = t.seasons![0].episodes;
		expect(s1.map((e) => e.episode)).toEqual([1, 2, 3]);
		expect(s1[0].id).toBe('tmdb-s-3/s1e1');
		expect(s1[0].title).toBe('Het Begin');
		expect(s1[0].overview).toBe('NL plot');
		expect(s1[0].variants.map((v) => v.audioLangs[0]).sort()).toEqual(['en', 'nl', 'tr']);
		expect(s1[2].title).toBe('Aflevering 3');
		expect(t.languages.sort()).toEqual(['en', 'nl', 'tr']);
		expect(t.rawRefs).toHaveLength(3);
		expect(titles(raws, { preferLang: 'en' })[0].seasons![0].episodes[1].title).toBe('Under Water');
	});

	it('lazy series (no episodes) keep rawRefs and no seasons', () => {
		const t = titles([
			catalogOf('a', [series('NL - Havenstad (2021)')]),
			catalogOf('b', [series('EN - Harbour City (2021)', { originalTitle: 'Havenstad' })])
		])[0];
		expect(t.seasons).toBeUndefined();
		expect(t.rawRefs.map((r) => [r.sourceId, r.langs[0]]).sort()).toEqual([
			['a', 'nl'],
			['b', 'en']
		]);
	});

	it('mergeSeasons extends existing seasons (lazy load) with the same logic', () => {
		const base = mergeSeasons(
			'x',
			[
				{
					sourceId: 'a',
					audio: ['nl'],
					subs: [],
					quality: 'HD',
					seriesTitle: 'X',
					episodes: [ep(1, 1, { title: 'Eén' })]
				}
			],
			'nl'
		);
		const more = mergeSeasons(
			'x',
			[
				{
					sourceId: 'b',
					audio: ['de'],
					subs: ['nl'],
					quality: 'FHD',
					seriesTitle: 'X',
					episodes: [ep(1, 1, { title: 'Folge 1' }), ep(1, 2)]
				}
			],
			'nl',
			base
		);
		expect(more[0].episodes).toHaveLength(2);
		expect(more[0].episodes[0].title).toBe('Eén');
		expect(more[0].episodes[0].variants).toHaveLength(2);
		const title = withSeasons({ ...titles([catalogOf('a', [series('NL - X (2020)')])])[0] }, more);
		expect(title.languages.sort()).toEqual(['de', 'nl']);
		expect(title.subtitleLanguages).toEqual(['nl']);
	});
});

describe('channels', () => {
	const epg = [
		{ channelId: 'prisma1.nl', start: NOW, stop: NOW + 3600_000, title: 'Journaal' },
		{ channelId: 'prisma1.nl', start: NOW - 3600_000, stop: NOW, title: 'Ochtend' },
		{ channelId: 'prisma1.nl', start: NOW, stop: NOW + 3600_000, title: 'Journaal' },
		{ channelId: 'prismacinema.nl', start: NOW, stop: NOW + 7200_000, title: 'Film' },
		{
			channelId: 'prismacinemaplus1.nl',
			start: NOW + 3600_000,
			stop: NOW + 10800_000,
			title: 'Film'
		}
	];
	const cat = build([
		catalogOf(
			'a',
			[
				chan('NL: Prisma 1 HD', { tvgId: 'prisma1.nl', group: 'NL | Entertainment', number: 1 }),
				chan('NL: Prisma Cinema FHD', { tvgId: 'prismacinema.nl', group: 'NL | Films' }),
				chan('NL: Prisma Cinema +1 HD', { tvgId: 'prismacinemaplus1.nl', group: 'NL | Films' })
			],
			epg
		),
		catalogOf('b', [
			chan('|NL| Prisma 1 FHD', {
				tvgId: 'Prisma1.nl',
				group: 'Entertainment (NL)',
				altUrls: ['https://example.test/p1.ts']
			}),
			chan('NL ▎PRISMA 1 ᴴᴰ', { group: '|NL| Entertainment' }),
			chan('NL ▎PRISMA CINEMA +1 ᴴᴰ', { tvgId: 'prismacinema.nl' }),
			chan('UK: Prisma 1 HD', { group: 'UK | Entertainment' })
		])
	]);

	it('merges feeds by tvg-id and name; quality suffixes stripped', () => {
		const p1 = cat.channels.find((c) => c.id === 'ch-prisma-1-nl')!;
		expect(p1.name).toBe('Prisma 1');
		expect(p1.variants.map((v) => v.quality)).toEqual(['FHD', 'HD', 'HD']);
		expect(p1.group).toBe('Entertainment');
		expect(p1.epgId).toBe('prisma1.nl');
		expect(p1.number).toBe(1);
		expect(
			(p1.variants.find((v) => v.sourceId === 'b' && v.quality === 'FHD') as { altUrls?: string[] })
				.altUrls
		).toEqual(['https://example.test/p1.ts']);
	});

	it('"+1" is a different channel, even with a reused tvg-id', () => {
		const main = cat.channels.find((c) => c.id === 'ch-prisma-cinema-nl')!;
		const plus = cat.channels.find((c) => c.id === 'ch-prisma-cinema-plus1-nl')!;
		expect(main.variants).toHaveLength(1);
		expect(plus.variants).toHaveLength(2);
		expect(plus.name).toBe('Prisma Cinema +1');
		expect(plus.epgId).toBe('prismacinemaplus1.nl');
		expect(parseChannelName('Prisma Cinema+1').timeshift).toBe(1);
	});

	it('the same name in another language is another channel', () => {
		expect(cat.channels.find((c) => c.id === 'ch-prisma-1-en')).toBeDefined();
	});

	it('EPG grouped per channel, de-duplicated and sorted', () => {
		expect(cat.epg['prisma1.nl'].map((p) => p.title)).toEqual(['Ochtend', 'Journaal']);
	});
});

describe('performance', () => {
	it('builds 50,000 raw items in under 1.5 s', () => {
		const langs = ['NL', 'EN', 'DE', 'FR', 'TR', 'AR', 'PL', 'PT', 'ES', 'IT'];
		const movies: RawMovie[] = [];
		const seriesList: RawSeries[] = [];
		for (let i = 0; i < 50_000; i++) {
			const film = i % 12_000;
			const lang = langs[i % langs.length];
			const year = 1980 + (film % 45);
			const name = `Titel ${film} Verhaal ${film % 97}`;
			if (i % 10 === 9)
				seriesList.push({
					kind: 'series',
					sourceId: `s${i % 3}`,
					providerId: `x${i}`,
					rawTitle: `${lang} - ${name} (${year})`
				});
			else
				movies.push({
					kind: 'movie',
					sourceId: `s${i % 3}`,
					providerId: `m${i}`,
					rawTitle: i % 2 ? `${lang} - ${name} (${year}) [FHD]` : `|${lang}| ${name} ${year} 4K`,
					url: 'https://example.test/x.m3u8',
					tmdbId: i % 5 === 0 ? 100_000 + film : undefined,
					category: `${lang} | FILMS`
				});
		}
		const raws: RawCatalog[] = [
			{ sourceId: 'mix', fetchedAt: NOW, movies, series: seriesList, channels: [], epg: [] }
		];
		const t0 = performance.now();
		const cat = buildCatalog(raws, { now: NOW });
		const ms = performance.now() - t0;
		expect(cat.titles.length).toBeLessThan(25_000);
		expect(ms).toBeLessThan(1500);
	});
});
