import { describe, expect, it } from 'vitest';
import {
	baseTitle,
	foldText,
	isGenericEpisodeTitle,
	matchKey,
	parseCategory,
	parsePerson,
	parseTitle,
	slugify,
	titleKeys
} from './normalize.ts';
import { genreSlug, normalizeGenre, normalizeGenres } from './genres.ts';

type Row = [raw: string, title: string, year: number | undefined, langs: string[], quality: string];

const TITLES: Row[] = [
	['NL - De Matrix (1999) [4K]', 'De Matrix', 1999, ['nl'], '4K'],
	['NL: De Matrix (1999)', 'De Matrix', 1999, ['nl'], 'unknown'],
	['[NL] De Matrix (1999)', 'De Matrix', 1999, ['nl'], 'unknown'],
	['|NL| De Matrix 1999', 'De Matrix', 1999, ['nl'], 'unknown'],
	['NL| De Matrix (1999) [FHD]', 'De Matrix', 1999, ['nl'], 'FHD'],
	['De Matrix (NL)', 'De Matrix', undefined, ['nl'], 'unknown'],
	['4K-NL - Het Laatste Licht (2023)', 'Het Laatste Licht', 2023, ['nl'], '4K'],
	['|EN| The Last Light 2023 4K', 'The Last Light', 2023, ['en'], '4K'],
	['EN The Last Light (2023)', 'The Last Light', 2023, ['en'], 'unknown'],
	['EN: The Last Light (2023) [UHD]', 'The Last Light', 2023, ['en'], '4K'],
	['ENG | The Last Light - 2023', 'The Last Light', 2023, ['en'], 'unknown'],
	['The Last Light (2023) 2160p HEVC', 'The Last Light', 2023, [], '4K'],
	['DE: Das Letzte Licht (2023) [FHD]', 'Das Letzte Licht', 2023, ['de'], 'FHD'],
	['DE-Das Letzte Licht (2023)', 'Das Letzte Licht', 2023, ['de'], 'unknown'],
	['GER | Das Letzte Licht 2023', 'Das Letzte Licht', 2023, ['de'], 'unknown'],
	['FR - La Dernière Lumière (2023)', 'La Dernière Lumière', 2023, ['fr'], 'unknown'],
	['FR ▎La Dernière Lumière (2023)', 'La Dernière Lumière', 2023, ['fr'], 'unknown'],
	['[FRE] La Dernière Lumière (2023)', 'La Dernière Lumière', 2023, ['fr'], 'unknown'],
	['FRA ▎La Dernière Lumière (2023)', 'La Dernière Lumière', 2023, ['fr'], 'unknown'],
	['ES ▎La Última Luz (2023)', 'La Última Luz', 2023, ['es'], 'unknown'],
	['|ESP| La Última Luz 2023', 'La Última Luz', 2023, ['es'], 'unknown'],
	['SPA: La Última Luz (2023)', 'La Última Luz', 2023, ['es'], 'unknown'],
	['LAT - La Última Luz (2023)', 'La Última Luz', 2023, ['es'], 'unknown'],
	["IT - L'Ultima Luce (2023)", "L'Ultima Luce", 2023, ['it'], 'unknown'],
	["ITA: L'Ultima Luce (2023) 720p", "L'Ultima Luce", 2023, ['it'], 'HD'],
	['TR ▎Son Işık (2023)', 'Son Işık', 2023, ['tr'], 'unknown'],
	['TUR: Son Işık (2023) HD', 'Son Işık', 2023, ['tr'], 'HD'],
	['AR - الضوء الأخير (2023)', 'الضوء الأخير', 2023, ['ar'], 'unknown'],
	['|AR| الضوء الأخير 2023', 'الضوء الأخير', 2023, ['ar'], 'unknown'],
	['PL: Ostatnie Światło (2023) FHD', 'Ostatnie Światło', 2023, ['pl'], 'FHD'],
	['POL ▎Ostatnie Światło (2023)', 'Ostatnie Światło', 2023, ['pl'], 'unknown'],
	['PT-BR - A Última Luz (2023)', 'A Última Luz', 2023, ['pt'], 'unknown'],
	['POR: A Última Luz (2023) [SD]', 'A Última Luz', 2023, ['pt'], 'SD'],
	['BR ▎A Última Luz (2023)', 'A Última Luz', 2023, ['pt'], 'unknown'],
	['RU - Последний свет (2023)', 'Последний свет', 2023, ['ru'], 'unknown'],
	['SE: Det Sista Ljuset (2023)', 'Det Sista Ljuset', 2023, ['sv'], 'unknown'],
	['DK | Det Sidste Lys (2023)', 'Det Sidste Lys', 2023, ['da'], 'unknown'],
	['KR - 유리 도시 (2021)', '유리 도시', 2021, ['ko'], 'unknown'],
	['NL/EN - Film (2020) MULTI', 'Film', 2020, ['nl', 'en'], 'unknown'],
	['EN - Movie (2020) DUAL', 'Movie', 2020, ['en'], 'unknown'],
	['Film MULTI', 'Film', undefined, ['en'], 'unknown'],
	['Film (NL Gesproken)', 'Film', undefined, ['nl'], 'unknown'],
	['Film NL Gesproken', 'Film', undefined, ['nl'], 'unknown'],
	['Ocean’s Eleven - 2001 FHD', 'Ocean’s Eleven', 2001, [], 'FHD'],
	['Spider-Man: Homecoming (2017) 1080p x264', 'Spider-Man: Homecoming', 2017, [], 'FHD'],
	['Blade Runner 2049 (2017)', 'Blade Runner 2049', 2017, [], 'unknown'],
	['1917 (2019)', '1917', 2019, [], 'unknown'],
	['2012', '2012', undefined, [], 'unknown'],
	['De Matrix', 'De Matrix', undefined, [], 'unknown'],
	['It (2017)', 'It', 2017, [], 'unknown'],
	['Us (2019)', 'Us', 2019, [], 'unknown'],
	['DE MATRIX (1999)', 'DE MATRIX', 1999, [], 'unknown'],
	['X-Men (2000) [BluRay] [REMUX]', 'X-Men', 2000, [], 'unknown'],
	["Charlotte's Web (2006)", "Charlotte's Web", 2006, [], 'unknown'],
	['The Movie (2020) [Extended Edition]', 'The Movie', 2020, [], 'unknown'],
	['VOD - NL - Zoutwater (2021)', 'Zoutwater', 2021, ['nl'], 'unknown'],
	['UK: Night Watch (1998) SD', 'Night Watch', 1998, ['en'], 'SD']
];

describe('parseTitle: titles, years, languages, quality', () => {
	it.each(TITLES)('%s', (raw, title, year, langs, quality) => {
		const p = parseTitle(raw);
		expect(p.cleanTitle).toBe(title);
		expect(p.year).toBe(year);
		expect(p.langs).toEqual(langs);
		expect(p.quality).toBe(quality);
	});
});

describe('parseTitle: subtitles and flags', () => {
	it('VOSTFR = French subtitles, original audio', () => {
		const p = parseTitle('The Last Light (2023) VOSTFR');
		expect(p.subLangs).toEqual(['fr']);
		expect(p.langs).toEqual([]);
		expect(p.flags).toContain('VO');
	});
	it('NL Subs at the end', () => {
		const p = parseTitle('[EN] The Last Light (2023) NL Subs');
		expect(p).toMatchObject({ cleanTitle: 'The Last Light', langs: ['en'], subLangs: ['nl'] });
	});
	it('[NL Subs] in brackets and NLSUB token', () => {
		expect(parseTitle('EN - Film (2020) [NL Subs]').subLangs).toEqual(['nl']);
		expect(parseTitle('Film (2020) NLSUB').subLangs).toEqual(['nl']);
	});
	it('MULTI-SUB is a flag, not an audio language', () => {
		const p = parseTitle('Movie [MULTI-SUB] HEVC HDR');
		expect(p.flags).toEqual(expect.arrayContaining(['MULTISUB', 'HEVC', 'HDR']));
		expect(p.langs).toEqual([]);
	});
	it.each([
		['Film (2020) H.265', 'HEVC'],
		['Film (2020) x265 10bit', 'HEVC'],
		['Film (2020) DV HDR10', 'DV'],
		['Film (2020) [WEB-DL]', 'WEB-DL'],
		['Film (2020) BluRay', 'BluRay'],
		['Film (2020) REMUX', 'REMUX'],
		['Film (2020) x264', 'H264']
	])('%s → flag %s', (raw, flag) => {
		expect(parseTitle(raw).flags).toContain(flag);
	});
	it.each([
		['Film 4K', '4K'],
		['Film UHD', '4K'],
		['Film 2160p', '4K'],
		['Film FHD', 'FHD'],
		['Film 1080p', 'FHD'],
		['Film HD', 'HD'],
		['Film 720p', 'HD'],
		['Film SD', 'SD'],
		['Film 480p', 'SD'],
		['Film [Full HD]', 'FHD']
	])('%s → %s', (raw, q) => {
		expect(parseTitle(raw).quality).toBe(q);
	});
});

describe('parseTitle: seasons and episodes', () => {
	it.each([
		['Show S01E02 - Pilot', 'Show', 1, 2, 'Pilot'],
		['NL - De Grens S2 E5', 'De Grens', 2, 5, undefined],
		['The Border 1x03', 'The Border', 1, 3, undefined],
		['Kantoor 13 - Seizoen 2 Aflevering 3', 'Kantoor 13', 2, 3, undefined],
		['Das Archiv Staffel 3 Folge 4', 'Das Archiv', 3, 4, undefined],
		['DE - Die Grenze S03', 'Die Grenze', 3, undefined, undefined]
	])('%s', (raw, title, season, episode, epTitle) => {
		const p = parseTitle(raw);
		expect(p.cleanTitle).toBe(title);
		expect(p.season).toBe(season);
		expect(p.episode).toBe(episode);
		expect(p.episodeTitle).toBe(epTitle);
	});
});

describe('parseCategory', () => {
	it.each([
		['NL | FILMS', ['nl'], 'FILMS'],
		['Netherlands VOD', ['nl'], ''],
		['FR - Films', ['fr'], 'Films'],
		['VOD | ENGLISH', ['en'], ''],
		['Germany VOD', ['de'], ''],
		['TR | FİLMLER', ['tr'], 'FİLMLER'],
		['AR | أفلام', ['ar'], 'أفلام'],
		['Arabic Movies', ['ar'], 'Movies'],
		['Italia Serie TV', ['it'], 'Serie TV'],
		['PT-BR | FILMES', ['pt'], 'FILMES'],
		['4K NL', ['nl'], ''],
		['NL | Nieuws', ['nl'], 'Nieuws'],
		['Nieuws (NL)', ['nl'], 'Nieuws'],
		['|NL| Sport', ['nl'], 'Sport'],
		['Kids en Familie', [], 'Kids en Familie'],
		['Films 2024', [], 'Films 2024']
	])('%s', (cat, langs, label) => {
		const p = parseCategory(cat);
		expect(p.langs).toEqual(langs);
		expect(p.label).toBe(label);
	});
	it('detects quality and VOSTFR in categories', () => {
		expect(parseCategory('EN | MOVIES 4K').quality).toBe('4K');
		const v = parseCategory('FR | VOSTFR');
		expect(v.vo).toBe(true);
		expect(v.subLangs).toEqual(['fr']);
	});
});

describe('match keys', () => {
	it.each([
		['The Matrix', 'Matrix'],
		['De Matrix', 'Matrix'],
		['Lars & Lotte', 'Lars en Lotte'],
		['Lars & Lotte', 'Lars und Lotte'],
		['Lars & Lotte', 'Lars and Lotte'],
		['Stormvogel II', 'Stormvogel 2'],
		['Rocky IV', 'Rocky 4'],
		['La Dernière Lumière', 'La Derniere Lumiere'],
		['Son Işık', 'SON IŞIK'],
		["L'Ultima Luce", 'L’Ultima Luce'],
		['Dune: Part Two', 'Dune 2'],
		['Spider-Man', 'Spider Man'],
		['Straße der Träume', 'Strasse der Traume']
	])('%s == %s', (a, b) => {
		expect(matchKey(a)).toBe(matchKey(b));
	});
	it.each([
		['Stormvogel', 'Stormvogel 2'],
		['Nachtwacht', 'Nachtwache'],
		['Mission Ares', 'Mission Ares: Red Planet']
	])('%s != %s', (a, b) => {
		expect(matchKey(a)).not.toBe(matchKey(b));
	});
	it('keeps a single article as title', () => {
		expect(matchKey('It')).toBe('it');
		expect(matchKey('The')).toBe('the');
	});
	it('weak keys drop the subtitle after ":" or " - "', () => {
		expect(titleKeys('Mission Ares: Red Planet')).toEqual({
			key: 'mission ares red planet',
			weak: 'mission ares'
		});
		expect(baseTitle('Star Saga - The Return')).toBe('Star Saga');
		expect(titleKeys('Zoutwater').weak).toBeUndefined();
	});
	it('foldText strips diacritics and punctuation', () => {
		expect(foldText('Çay Bahçesi!')).toBe('cay bahcesi');
		expect(foldText('Ocean’s Eleven')).toBe('oceans eleven');
	});
	it('slugify is ASCII and stable, with a hash for non-Latin titles', () => {
		expect(slugify('Het Laatste Licht')).toBe('het-laatste-licht');
		expect(slugify('Pip & de Maan')).toBe('pip-and-de-maan');
		const ar = slugify('الضوء الأخير');
		expect(ar).toMatch(/^x[0-9a-z]+$/);
		expect(slugify('الضوء الأخير')).toBe(ar);
	});
});

describe('helpers', () => {
	it('parsePerson', () => {
		expect(parsePerson('Mila Verhoef (Iris Vos)')).toEqual({
			name: 'Mila Verhoef',
			character: 'Iris Vos'
		});
		expect(parsePerson('Sam Okoro as The Voice')).toEqual({
			name: 'Sam Okoro',
			character: 'The Voice'
		});
		expect(parsePerson('Jan Jansen')).toEqual({ name: 'Jan Jansen' });
	});
	it('generic episode titles', () => {
		for (const t of ['Episode 3', 'Aflevering 3', 'Folge 3', 'Bölüm 3', 'S01E03', '3', 'الحلقة 3'])
			expect(isGenericEpisodeTitle(t)).toBe(true);
		expect(isGenericEpisodeTitle('Onder Water')).toBe(false);
		expect(isGenericEpisodeTitle('De Grens', 'De Grens')).toBe(true);
	});
});

describe('genres', () => {
	it.each([
		['Action', ['Actie']],
		['Acción', ['Actie']],
		['Aksiyon', ['Actie']],
		['أكشن', ['Actie']],
		['Science Fiction', ['Sciencefiction']],
		['Sci-Fi & Fantasy', ['Sciencefiction', 'Fantasy']],
		['Action & Adventure', ['Actie', 'Avontuur']],
		['Krimi', ['Misdaad']],
		['Bilim Kurgu', ['Sciencefiction']],
		['Comédie', ['Komedie']],
		['Kids & Family', ['Kinderen', 'Familie']],
		['Politics', ['Politics']]
	])('%s → %j', (g, out) => {
		expect(normalizeGenre(g)).toEqual(out);
	});
	it('dedupes across languages', () => {
		expect(normalizeGenres(['Action', 'Actie', 'Acción', 'Drama', 'Drame'])).toEqual([
			'Actie',
			'Drama'
		]);
	});
	it('slug', () => {
		expect(genreSlug('Sciencefiction')).toBe('scifi');
		expect(genreSlug('Onbekend')).toBeUndefined();
	});
});
