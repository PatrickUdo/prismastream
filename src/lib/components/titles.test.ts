import { describe, expect, it } from 'vitest';
import { buildCatalog } from '#lib/merge/index.ts';
import { sampleCatalogs } from '#lib/sample/index.ts';
import { displayTitle, localizedTitle, secondaryTitles, titleLangs } from './titles.ts';

const lastLight = {
	title: 'The Last Light',
	originalTitle: 'The Last Light',
	altTitles: [
		{ title: 'Het Laatste Licht', lang: 'nl' },
		{ title: 'The Last Light', lang: 'en' },
		{ title: 'Das Letzte Licht', lang: 'de' },
		{ title: 'The Last Light' }
	]
};

describe('titleLangs', () => {
	it('UI language first, then audio languages, unique', () => {
		expect(titleLangs({ uiLang: 'nl', audioLangs: ['nl', 'en', 'und'] })).toEqual(['nl', 'en']);
		expect(titleLangs({ uiLang: 'en', audioLangs: ['de'] })).toEqual(['en', 'de']);
		expect(titleLangs(undefined, 'nl')).toEqual(['nl']);
	});
});

describe('localizedTitle / displayTitle', () => {
	it('picks the title in the first profile language that exists', () => {
		expect(localizedTitle(lastLight, ['nl', 'en'])).toBe('Het Laatste Licht');
		expect(localizedTitle(lastLight, ['en', 'nl'])).toBe('The Last Light');
		expect(localizedTitle(lastLight, ['fr', 'de'])).toBe('Das Letzte Licht');
		expect(displayTitle(lastLight, { uiLang: 'nl', audioLangs: ['nl', 'en'] })).toBe(
			'Het Laatste Licht'
		);
	});

	it('falls back to Title.title when no language matches', () => {
		expect(localizedTitle(lastLight, ['ja'])).toBe('The Last Light');
		expect(localizedTitle({ title: 'Solo' }, ['nl'])).toBe('Solo');
		expect(displayTitle({ title: 'Solo', altTitles: [] }, { uiLang: 'nl' })).toBe('Solo');
	});

	it('several titles in one language: the localised, nicely cased one wins', () => {
		const t = {
			title: 'Saltwater',
			altTitles: [
				{ title: 'Saltwater', lang: 'nl' },
				{ title: 'ZOUTWATER', lang: 'nl' },
				{ title: 'Zoutwater', lang: 'nl' }
			]
		};
		// The main title is itself tagged Dutch (dub kept the name): keep it.
		expect(localizedTitle(t, ['nl'])).toBe('Saltwater');
		const u = { title: 'Saltwater', altTitles: t.altTitles.slice(1) };
		expect(localizedTitle(u, ['nl'])).toBe('Zoutwater');
	});

	it('works on the sample catalog', () => {
		const cat = buildCatalog(sampleCatalogs(Date.UTC(2026, 9, 9, 12)), {});
		const t = cat.titles.find((x) => x.title === 'The Last Light')!;
		expect(displayTitle(t, { uiLang: 'nl', audioLangs: ['nl'] })).toBe('Het Laatste Licht');
		expect(displayTitle(t, { uiLang: 'en', audioLangs: ['nl'] })).toBe('The Last Light');
	});
});

describe('secondaryTitles', () => {
	it('original and main title when they differ from what is shown', () => {
		expect(secondaryTitles(lastLight, 'Het Laatste Licht')).toEqual({
			titles: ['The Last Light'],
			original: true
		});
		expect(secondaryTitles(lastLight, 'The Last Light')).toEqual({ titles: [], original: false });
		expect(
			secondaryTitles(
				{ title: 'Glass City', originalTitle: '유리 도시', altTitles: [] },
				'Glazen Stad'
			)
		).toEqual({ titles: ['유리 도시', 'Glass City'], original: true });
		expect(
			secondaryTitles(
				{ title: 'Saltwater', originalTitle: 'Zoutwater', altTitles: [] },
				'Zoutwater'
			)
		).toEqual({ titles: ['Saltwater'], original: false });
	});
});
