import { describe, expect, it } from 'vitest';
import type { StreamVariant } from '#lib/types.ts';
import { resolveVariant, versionOptions } from './versions.ts';
import { buildScene, layoutTitle } from './art.ts';

function v(id: string, p: Partial<StreamVariant>): StreamVariant {
	return {
		id,
		sourceId: 's1',
		url: 'x',
		audioLangs: ['en'],
		subtitleLangs: [],
		quality: 'HD',
		label: id,
		...p
	};
}

const variants = [
	v('nl-hd', { audioLangs: ['nl'], quality: 'HD' }),
	v('en-4k', { audioLangs: ['en'], quality: '4K', subtitleLangs: ['nl'] }),
	v('en-hd-s2', { audioLangs: ['en'], quality: 'HD', sourceId: 's2' }),
	v('de-fhd', { audioLangs: ['de'], quality: 'FHD' })
];
const prefs = { audioLangs: ['nl', 'en'], subtitleLangs: [], subtitlesOn: false };

describe('resolveVariant', () => {
	it('uses the profile preference without a choice', () => {
		expect(resolveVariant(variants, {}, prefs)?.id).toBe('nl-hd');
	});
	it('honours audio, then quality, then source', () => {
		expect(resolveVariant(variants, { audio: 'en' }, prefs)?.id).toBe('en-4k');
		expect(resolveVariant(variants, { audio: 'en', quality: 'HD' }, prefs)?.id).toBe('en-hd-s2');
		expect(resolveVariant(variants, { audio: 'en', sourceId: 's2' }, prefs)?.id).toBe('en-hd-s2');
	});
	it('falls back when the chosen language is missing', () => {
		expect(resolveVariant(variants, { audio: 'fr' }, prefs)?.id).toBe('nl-hd');
	});
});

describe('versionOptions', () => {
	it('lists qualities and sources for the chosen audio language', () => {
		const o = versionOptions(variants, { audio: 'en', quality: 'HD' });
		expect(o.audio.map((a) => a.lang).sort()).toEqual(['de', 'en', 'nl']);
		expect(o.qualities).toEqual(['4K', 'HD']);
		expect(o.sources).toEqual(['s2']);
		expect(o.subtitles).toEqual(['nl']);
	});
});

describe('generative art', () => {
	it('is deterministic per seed', () => {
		const a = buildScene('k-movie-x', { format: 'poster', genres: ['Horror'] });
		const b = buildScene('k-movie-x', { format: 'poster', genres: ['Horror'] });
		expect(a).toEqual(b);
		expect(a.family).toBe('horror');
	});
	it('fits titles in at most four lines', () => {
		const l = layoutTitle('Het Laatste Licht van de Noordelijke Zee', 168, true);
		expect(l.lines.length).toBeLessThanOrEqual(4);
		expect(l.size).toBeGreaterThanOrEqual(11);
	});
});
