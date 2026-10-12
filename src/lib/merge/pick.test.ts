import { describe, expect, it } from 'vitest';
import type { StreamVariant } from '#lib/types.ts';
import {
	bestSubtitle,
	groupVariantsByLanguage,
	pickVariant,
	summarizeLanguages,
	type LangPrefs
} from './pick.ts';

function v(
	id: string,
	audio: string[],
	quality: StreamVariant['quality'],
	subs: string[] = [],
	sourceId = 's1'
): StreamVariant {
	return {
		id,
		sourceId,
		url: `https://example.test/${id}`,
		audioLangs: audio,
		subtitleLangs: subs,
		quality,
		label: id
	};
}

const NL: LangPrefs = { audioLangs: ['nl', 'en'], subtitleLangs: ['nl'], subtitlesOn: false };

describe('pickVariant', () => {
	const variants = [
		v('en-4k', ['en'], '4K'),
		v('nl-hd', ['nl'], 'HD'),
		v('nl-fhd', ['nl'], 'FHD'),
		v('de-4k', ['de'], '4K'),
		v('fr-sd', ['fr'], 'SD')
	];

	it('first preferred language wins over quality', () => {
		expect(pickVariant(variants, NL)?.id).toBe('nl-fhd');
	});
	it('then the next preferred language', () => {
		expect(
			pickVariant(
				variants.filter((x) => !x.audioLangs.includes('nl')),
				NL
			)?.id
		).toBe('en-4k');
	});
	it('falls back to the original language, then English, then anything', () => {
		const prefs: LangPrefs = { audioLangs: ['tr'], subtitleLangs: [], subtitlesOn: false };
		expect(pickVariant(variants, prefs, { originalLang: 'fr' })?.id).toBe('fr-sd');
		expect(pickVariant(variants, prefs)?.id).toBe('en-4k');
		expect(pickVariant([v('de', ['de'], 'HD'), v('und', ['und'], '4K')], prefs)?.id).toBe('de');
	});
	it('accepts a Title-like object for originalLang', () => {
		const prefs: LangPrefs = { audioLangs: ['tr'], subtitleLangs: [], subtitlesOn: false };
		expect(pickVariant(variants, prefs, { originalLang: 'de' })?.id).toBe('de-4k');
	});
	it('prefers matching subtitles when the audio is a fallback', () => {
		const list = [v('en-4k', ['en'], '4K'), v('en-hd-nlsub', ['en'], 'HD', ['nl'])];
		expect(
			pickVariant(list, { audioLangs: ['nl'], subtitleLangs: ['nl'], subtitlesOn: false })?.id
		).toBe('en-hd-nlsub');
	});
	it('multi-audio variants count for each language', () => {
		const list = [v('multi', ['de', 'nl'], 'HD'), v('en', ['en'], '4K')];
		expect(pickVariant(list, NL)?.id).toBe('multi');
	});
	it('uses the last good source as tie-breaker and avoids failed sources', () => {
		const list = [v('a', ['nl'], 'FHD', [], 'src-a'), v('b', ['nl'], 'FHD', [], 'src-b')];
		expect(pickVariant(list, NL, { lastGoodSourceId: 'src-b' })?.id).toBe('b');
		expect(pickVariant(list, NL, { failedSourceIds: ['src-a'] })?.id).toBe('b');
	});
	it('returns undefined for no variants', () => {
		expect(pickVariant([], NL)).toBeUndefined();
	});
});

describe('groupVariantsByLanguage', () => {
	it('groups by audio language, preferred first, best quality first', () => {
		const groups = groupVariantsByLanguage(
			[
				v('de', ['de'], 'HD'),
				v('nl-hd', ['nl'], 'HD'),
				v('en', ['en'], 'FHD'),
				v('nl-4k', ['nl'], '4K'),
				v('multi', ['nl', 'en'], 'SD')
			],
			NL
		);
		expect(groups.map((g) => g.lang)).toEqual(['nl', 'en', 'de']);
		expect(groups[0].variants.map((x) => x.id)).toEqual(['nl-4k', 'nl-hd', 'multi']);
		expect(groups[1].variants.map((x) => x.id)).toEqual(['en', 'multi']);
	});
});

describe('bestSubtitle', () => {
	it('none when the audio is understood and subtitles are off', () => {
		expect(bestSubtitle(v('x', ['nl'], 'HD', ['nl']), NL)).toBeUndefined();
	});
	it('the preferred subtitle language when subtitles are on', () => {
		expect(bestSubtitle(v('x', ['en'], 'HD', ['fr', 'nl']), { ...NL, subtitlesOn: true })).toBe(
			'nl'
		);
	});
	it('switches subtitles on for foreign audio', () => {
		expect(bestSubtitle(v('x', ['fr'], 'HD', ['nl']), NL)).toBe('nl');
		expect(
			bestSubtitle(v('x', ['fr'], 'HD', ['en']), {
				audioLangs: ['nl'],
				subtitleLangs: [],
				subtitlesOn: false
			})
		).toBe('en');
	});
});

describe('summarizeLanguages', () => {
	it('"NL · EN · DE +4"', () => {
		expect(
			summarizeLanguages({ languages: ['de', 'en', 'fr', 'nl', 'tr', 'ar', 'pl'] }, 3, {
				audioLangs: ['nl']
			})
		).toBe('NL · EN · DE +4');
	});
	it('handles few or unknown languages', () => {
		expect(summarizeLanguages({ languages: ['en'] })).toBe('EN');
		expect(summarizeLanguages({ languages: ['und'] })).toBe('');
	});
});
