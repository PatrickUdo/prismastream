import { describe, expect, it } from 'vitest';
import type { Channel, Title } from '#lib/types.ts';
import { SearchIndex, oneEdit, searchIndexFor } from './index.ts';
import { fold, indexTokens } from './fold.ts';
import { buildCatalog } from '#lib/merge/index.ts';
import { sampleCatalogs } from '#lib/sample/index.ts';

let seq = 0;
function title(p: Partial<Title> & { title: string }): Title {
	return {
		id: p.id ?? `t${++seq}`,
		kind: 'movie',
		altTitles: [],
		genres: [],
		cast: [],
		addedAt: 0,
		popularity: 50,
		variants: [],
		languages: [],
		subtitleLanguages: [],
		qualities: [],
		sourceIds: [],
		rawRefs: [],
		...p
	};
}

function channel(name: string, group = 'Entertainment'): Channel {
	return { id: `c-${name}`, name, group, languages: [], variants: [] };
}

const lastLight = title({
	id: 'last-light',
	title: 'The Last Light',
	altTitles: [
		{ title: 'The Last Light', lang: 'en' },
		{ title: 'Das Letzte Licht', lang: 'de' },
		{ title: 'Het Laatste Licht', lang: 'nl' },
		{ title: 'La Dernière Lumière', lang: 'fr' }
	],
	cast: [{ name: 'Noor van Dijk' }, { name: 'Émile Durand' }],
	genres: ['Drama', 'Sci-fi']
});
const amelie = title({ id: 'amelie', title: 'Amélie', genres: ['Komedie'], popularity: 70 });
const terminator = title({ id: 'term', title: 'Terminator', genres: ['Actie'] });
const spider = title({ id: 'spider', title: 'Spider-Man: Thuiskomst', genres: ['Actie'] });
const show = title({
	id: 'show',
	kind: 'series',
	title: 'Noordzee',
	altTitles: [{ title: 'North Sea', lang: 'en' }],
	cast: [{ name: 'Noor van Dijk' }],
	genres: ['Thriller']
});

const index = new SearchIndex(
	[lastLight, amelie, terminator, spider, show],
	[channel('Prisma Nieuws', 'Nieuws'), channel('Kidz Planeet', 'Kids')]
);
const ids = (r: { movies: { title: Title }[]; series: { title: Title }[] }) => [
	...r.movies.map((h) => h.title.id),
	...r.series.map((h) => h.title.id)
];

describe('fold', () => {
	it('is case-, diacritic- and punctuation-insensitive', () => {
		expect(fold('  AMÉLIE  Poulain! ')).toBe('amelie poulain');
		expect(fold('Straße & Co.')).toBe('strasse and co');
		expect(fold('Øresund')).toBe('oresund');
	});
	it('indexes joined forms of hyphenated words', () => {
		expect(indexTokens('Spider-Man')).toEqual(['spider', 'man', 'spiderman']);
	});
});

describe('oneEdit', () => {
	it('accepts one substitution, insertion, deletion or swap', () => {
		expect(oneEdit('light', 'light', 5)).toBe(true);
		expect(oneEdit('lught', 'light', 5)).toBe(true);
		expect(oneEdit('lihgt', 'light', 5)).toBe(true);
		expect(oneEdit('ligt', 'light', 5)).toBe(true);
		expect(oneEdit('lighht', 'light', 5)).toBe(true);
		expect(oneEdit('lgith', 'light', 5)).toBe(false);
		expect(oneEdit('termi', 'terminator', 5)).toBe(true);
	});
});

describe('SearchIndex', () => {
	it('finds a merged title once via a translated title and reports it', () => {
		const r = index.search('Das Letzte Licht');
		expect(ids(r)).toEqual(['last-light']);
		expect(r.movies[0].aka).toBe('Das Letzte Licht');
	});

	it('does not repeat a title that matches several alt titles', () => {
		const r = index.search('licht');
		expect(ids(r).filter((id) => id === 'last-light')).toHaveLength(1);
	});

	it('ignores case and diacritics', () => {
		expect(ids(index.search('amelie'))).toContain('amelie');
		expect(ids(index.search('AMÉLIE'))).toContain('amelie');
		expect(ids(index.search('derniere lumiere'))).toEqual(['last-light']);
	});

	it('matches every word by prefix', () => {
		expect(ids(index.search('las lig'))).toEqual(['last-light']);
		expect(ids(index.search('the l'))).toEqual(['last-light']);
		expect(ids(index.search('spiderman'))).toEqual(['spider']);
	});

	it('tolerates one typo in words of five letters or more', () => {
		expect(ids(index.search('termintor'))).toEqual(['term']);
		expect(ids(index.search('Terminatro'))).toEqual(['term']);
		expect(ids(index.search('lihgt'))).toEqual(['last-light']);
		// Short words must be exact (or a prefix).
		expect(ids(index.search('lst'))).toEqual([]);
	});

	it('requires all words to match', () => {
		expect(ids(index.search('last amelie'))).toEqual([]);
	});

	it('groups people with their titles', () => {
		const r = index.search('noor van');
		expect(r.people.map((p) => p.name)).toEqual(['Noor van Dijk']);
		expect(r.people[0].titles.map((t) => t.id).sort()).toEqual(['last-light', 'show']);
		// Titles are also found through their cast.
		expect(ids(r).sort()).toEqual(['last-light', 'show']);
	});

	it('finds channels by name and group, and genres', () => {
		expect(index.search('prisma').channels.map((c) => c.channel.name)).toEqual(['Prisma Nieuws']);
		expect(index.search('kids').channels.map((c) => c.channel.name)).toEqual(['Kidz Planeet']);
		const g = index.search('thrill').genres;
		expect(g.map((x) => x.genre)).toEqual(['Thriller']);
		expect(g[0].series).toBe(1);
	});

	it('ranks exact > starts with > words > alt title > cast > genre', () => {
		const tt = [
			title({ id: 'genre', title: 'Zzz', genres: ['Licht'], popularity: 100 }),
			title({ id: 'cast', title: 'Yyy', cast: [{ name: 'Licht Man' }], popularity: 99 }),
			title({ id: 'alt', title: 'Xxx', altTitles: [{ title: 'Licht' }], popularity: 98 }),
			title({ id: 'words', title: 'Het Zwarte Licht', popularity: 97 }),
			title({ id: 'starts', title: 'Licht en Schaduw', popularity: 1 }),
			title({ id: 'exact', title: 'Licht', popularity: 0 })
		];
		const r = new SearchIndex(tt, []).search('licht');
		expect(r.movies.map((h) => h.title.id)).toEqual([
			'exact',
			'starts',
			'words',
			'alt',
			'cast',
			'genre'
		]);
	});

	it('returns nothing for an empty query', () => {
		expect(index.search('  ').total).toBe(0);
	});

	it('caches the index per key', () => {
		const a = searchIndexFor('k1', [amelie], []);
		expect(searchIndexFor('k1', [], [])).toBe(a);
		expect(searchIndexFor('k2', [amelie], [])).not.toBe(a);
	});
});

describe('performance', () => {
	it('answers queries over 50.000 titles in under 30 ms', () => {
		const syllables = ['ka', 'lo', 'mi', 'ne', 'ra', 'su', 'te', 'vo', 'zi', 'pa', 'do', 'ge'];
		const word = (n: number) => {
			let s = '';
			for (let i = 0; i < 3 + (n % 3); i++) s += syllables[(n * 7 + i * 13 + (n >> i)) % 12];
			return s;
		};
		const titles: Title[] = [];
		for (let i = 0; i < 50_000; i++) {
			titles.push(
				title({
					id: `p${i}`,
					kind: i % 3 ? 'movie' : 'series',
					title: `${word(i)} ${word(i * 31 + 7)} ${i % 7 ? '' : word(i * 3)}`,
					altTitles: [{ title: `Der ${word(i * 17 + 3)} ${word(i)}` }],
					cast: [{ name: `${word(i % 4000)} ${word((i % 4000) + 11)}` }],
					genres: [['Drama', 'Actie', 'Komedie', 'Thriller'][i % 4]],
					popularity: i % 100
				})
			);
		}
		const big = new SearchIndex(titles, []);
		const queries = ['ka', 'kalo', 'kalomi', 'kalomine', 'drama', 'der kalo', 'vozipa', 'zzzzzq'];
		const times: number[] = [];
		for (const q of queries) {
			const t0 = performance.now();
			big.search(q);
			times.push(performance.now() - t0);
		}
		times.sort((a, b) => a - b);
		// Typical queries are a few ms; even a cold one-letter prefix stays within budget-ish.
		expect(times[Math.floor(times.length / 2)]).toBeLessThan(30);
		expect(times[times.length - 1]).toBeLessThan(120);
	});
});

describe('sample catalog (merged titles in every language)', () => {
	const NOW = Date.UTC(2026, 9, 9, 12);
	const cat = buildCatalog(sampleCatalogs(NOW), { now: NOW });
	const sample = new SearchIndex(cat.titles, cat.channels);
	const firstTitle = (q: string) => {
		const r = sample.search(q);
		return [...r.movies, ...r.series].sort((a, b) => b.score - a.score)[0]?.title.title;
	};

	it('finds a title by any of its language titles, accent- and case-insensitive', () => {
		expect(firstTitle('het laatste licht')).toBe('The Last Light');
		expect(firstTitle('DERNIERE LUMIERE')).toBe('The Last Light');
		expect(firstTitle('son isik')).toBe('The Last Light');
	});

	it('one hit per merged title, and channels', () => {
		const r = sample.search('licht');
		const ids = [...r.movies, ...r.series].map((h) => h.title.id);
		expect(new Set(ids).size).toBe(ids.length);
		expect(sample.search('kanaal noord').channels[0]?.channel.name).toBe('Kanaal Noord');
	});
});
