import { describe, expect, it } from 'vitest';
import type { Title } from '#lib/types.ts';
import { featured, genreCounts, recommend, similarTitles, trending } from './recommend.ts';

function title(id: string, p: Partial<Title> = {}): Title {
	return {
		id,
		kind: 'movie',
		title: id,
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

const empty = { favorites: [], history: [], progress: {} };

describe('recommend', () => {
	const titles = [
		title('a', { genres: ['Sci-fi'], popularity: 10 }),
		title('b', { genres: ['Sci-fi', 'Drama'], popularity: 40 }),
		title('c', { genres: ['Komedie'], popularity: 90 }),
		title('d', { genres: ['Sci-fi'], popularity: 20 })
	];

	it('falls back to popularity without signals', () => {
		expect(recommend(titles, empty).map((t) => t.id)).toEqual(['c', 'b', 'd', 'a']);
	});

	it('prefers genres from history and excludes watched titles', () => {
		const out = recommend(titles, {
			...empty,
			history: [{ titleId: 'a', at: 1 }]
		}).map((t) => t.id);
		expect(out).not.toContain('a');
		expect(out.slice(0, 2).sort()).toEqual(['b', 'd']);
		expect(out[out.length - 1]).toBe('c');
	});

	it('excludes favorites and in-progress titles', () => {
		const out = recommend(titles, {
			favorites: ['b'],
			history: [],
			progress: {
				d: { titleId: 'd', variantId: 'x', positionSec: 60, durationSec: 600, updatedAt: 1 }
			}
		}).map((t) => t.id);
		expect(out).not.toContain('b');
		expect(out).not.toContain('d');
		expect(out[0]).toBe('a');
	});
});

describe('similarTitles', () => {
	it('puts the same kind first, then genre overlap', () => {
		const base = title('x', { genres: ['Sci-fi', 'Drama'] });
		const list = [
			base,
			title('s1', { kind: 'series', genres: ['Sci-fi', 'Drama'] }),
			title('m1', { genres: ['Sci-fi'] }),
			title('m2', { genres: ['Sci-fi', 'Drama'] }),
			title('m3', { genres: ['Horror'] })
		];
		expect(similarTitles(base, list).map((t) => t.id)).toEqual(['m2', 'm1', 's1']);
	});
});

describe('featured / trending / genreCounts', () => {
	it('mixes movies and series', () => {
		const list = [
			title('m1', { popularity: 90 }),
			title('m2', { popularity: 80 }),
			title('m3', { popularity: 70 }),
			title('s1', { kind: 'series', popularity: 10 })
		];
		expect(featured(list, 3).map((t) => t.id)).toEqual(['m1', 'm2', 's1']);
	});

	it('boosts recently added titles', () => {
		const now = 100 * 86_400_000;
		const list = [
			title('old', { kind: 'series', popularity: 60, addedAt: 0 }),
			title('new', { kind: 'series', popularity: 50, addedAt: now })
		];
		expect(trending(list, 'series', 2, now).map((t) => t.id)).toEqual(['new', 'old']);
	});

	it('counts genres per kind', () => {
		const list = [
			title('a', { genres: ['Drama', 'Sci-fi'] }),
			title('b', { genres: ['Drama'] }),
			title('c', { kind: 'series', genres: ['Drama'] })
		];
		expect(genreCounts(list, 'movie')).toEqual([
			{ genre: 'Drama', count: 2 },
			{ genre: 'Sci-fi', count: 1 }
		]);
	});
});
