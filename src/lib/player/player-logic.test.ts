import { describe, expect, it } from 'vitest';
import type { Episode, Season, StreamVariant, WatchProgress } from '#lib/types.ts';
import { streamCandidates, urlExtension, withExtension } from './source.ts';
import {
	chooseAudioTrack,
	chooseSubtitleTrack,
	normalizeLang,
	parseSubtitleParam,
	type TrackInfo
} from './tracks.ts';
import {
	buildLanguageMenu,
	chooseStartVariant,
	fallbackVariant,
	pickVariantForLang
} from './variants.ts';
import { findEpisode, firstEpisode, flattenEpisodes, nextEpisode } from './episodes.ts';
import { resumePosition, shouldSaveProgress, showNextCard } from './resume.ts';
import { keyAction } from './keys.ts';
import { formatTime, heightLabel } from './format.ts';
import { pickNeighbor } from './spatial.ts';

const v = (
	id: string,
	langs: string[],
	quality: StreamVariant['quality'],
	src = 's1'
): StreamVariant => ({
	id,
	sourceId: src,
	url: `https://example.test/${id}.m3u8`,
	audioLangs: langs,
	subtitleLangs: [],
	quality,
	label: id
});

const prefs = { audioLangs: ['nl', 'en'], subtitleLangs: ['nl'], subtitlesOn: false };

describe('source', () => {
	it('detects extensions ignoring query and hash', () => {
		expect(urlExtension('https://a.b/x/y.m3u8?token=1#t')).toBe('m3u8');
		expect(urlExtension('https://a.b/live/u/p/123')).toBe('');
		expect(urlExtension('https://a.b/movie/u/p/9.MKV')).toBe('mkv');
	});

	it('swaps extensions and keeps the query', () => {
		expect(withExtension('http://h/live/u/p/1.ts?x=1', 'm3u8')).toBe(
			'http://h/live/u/p/1.m3u8?x=1'
		);
	});

	it('tries the m3u8 twin first for MPEG-TS', () => {
		expect(streamCandidates('http://h/live/u/p/1.ts')).toEqual([
			{ url: 'http://h/live/u/p/1.m3u8', kind: 'hls' },
			{ url: 'http://h/live/u/p/1.ts', kind: 'progressive' }
		]);
	});

	it('maps hls, progressive and extensionless urls', () => {
		expect(streamCandidates('https://h/a.m3u8')).toEqual([
			{ url: 'https://h/a.m3u8', kind: 'hls' }
		]);
		expect(streamCandidates('https://h/a.mp4')[0].kind).toBe('progressive');
		expect(streamCandidates('https://h/a', 'mkv')).toEqual([
			{ url: 'https://h/a', kind: 'progressive' }
		]);
		expect(streamCandidates('https://h/live/1').map((c) => c.kind)).toEqual(['hls', 'progressive']);
		expect(streamCandidates('https://h/play.php?id=1').map((c) => c.kind)).toEqual([
			'progressive',
			'hls'
		]);
	});
});

describe('tracks', () => {
	it('normalises language tags and names', () => {
		expect(normalizeLang('en-US')).toBe('en');
		expect(normalizeLang('dut')).toBe('nl');
		expect(normalizeLang('ger')).toBe('de');
		expect(normalizeLang('', 'Français')).toBe('fr');
		expect(normalizeLang(undefined, 'English')).toBe('en');
		expect(normalizeLang(undefined, 'Commentary')).toBe('und');
		expect(normalizeLang('nb')).toBe('no');
	});

	const tracks: TrackInfo[] = [
		{ id: 0, lang: 'en', name: 'English', isDefault: true },
		{ id: 1, lang: 'fr', name: 'Français' },
		{ id: 2, lang: 'nl', name: 'Nederlands' }
	];

	it('chooses the preferred audio track, else the default', () => {
		expect(chooseAudioTrack(tracks, ['de', 'fr'])).toBe(1);
		expect(chooseAudioTrack(tracks, ['de'])).toBe(0);
		expect(chooseAudioTrack([], ['nl'])).toBe(-1);
	});

	const base = {
		subtitlesOn: true,
		subtitleLangs: ['de', 'nl'],
		audioLangs: ['nl', 'en'],
		uiLang: 'nl'
	};

	it('follows subtitle preferences with fallback', () => {
		expect(chooseSubtitleTrack(tracks, base)).toBe(2);
		expect(chooseSubtitleTrack(tracks, { ...base, subtitleLangs: ['de'], uiLang: 'de' })).toBe(0);
		expect(chooseSubtitleTrack([tracks[1]], { ...base, subtitleLangs: ['de'], uiLang: 'de' })).toBe(
			-1
		);
	});

	it('keeps subtitles off unless the audio is foreign', () => {
		const off = { ...base, subtitlesOn: false };
		expect(chooseSubtitleTrack(tracks, off, 'en')).toBe(-1);
		expect(chooseSubtitleTrack(tracks, off, 'fr')).toBe(2);
		expect(chooseSubtitleTrack(tracks, off, 'und')).toBe(-1);
	});

	it('respects an explicit session choice', () => {
		expect(chooseSubtitleTrack(tracks, { ...base, sessionChoice: null })).toBe(-1);
		expect(chooseSubtitleTrack(tracks, { ...base, sessionChoice: 'fr' })).toBe(1);
		expect(chooseSubtitleTrack(tracks, { ...base, sessionChoice: 'ja' })).toBe(-1);
	});

	it('respects ?s= from the detail page, with a silent fallback to the profile rule', () => {
		const off = { ...base, subtitlesOn: false };
		expect(chooseSubtitleTrack(tracks, { ...base, requested: null })).toBe(-1);
		expect(chooseSubtitleTrack(tracks, { ...off, requested: 'fr' }, 'en')).toBe(1);
		// Not in the stream: the profile rule applies (on → nl; off + understood audio → off).
		expect(chooseSubtitleTrack(tracks, { ...base, requested: 'ja' })).toBe(2);
		expect(chooseSubtitleTrack(tracks, { ...off, requested: 'ja' }, 'en')).toBe(-1);
		// A choice made in the player during the session wins over ?s=.
		expect(chooseSubtitleTrack(tracks, { ...base, requested: 'fr', sessionChoice: null })).toBe(-1);
		expect(chooseSubtitleTrack(tracks, { ...base, requested: null, sessionChoice: 'en' })).toBe(0);
	});

	it('parses the ?s= parameter', () => {
		expect(parseSubtitleParam('off')).toBeNull();
		expect(parseSubtitleParam('NL')).toBe('nl');
		expect(parseSubtitleParam('eng')).toBe('en');
		expect(parseSubtitleParam(null)).toBeUndefined();
		expect(parseSubtitleParam('')).toBeUndefined();
		expect(parseSubtitleParam('<script>')).toBeUndefined();
	});
});

describe('variants', () => {
	const variants = [
		v('nl-hd', ['nl'], 'HD'),
		v('en-4k', ['en'], '4K', 's2'),
		v('en-sd', ['en'], 'SD'),
		v('multi', ['de', 'en'], 'FHD'),
		v('x', [], 'unknown')
	];
	const sourceName = (id: string) => ({ s1: 'Bron A', s2: 'Bron B' })[id] ?? id;

	it('groups variants per audio language, preferred languages first', () => {
		const groups = buildLanguageMenu({
			variants,
			currentId: 'nl-hd',
			inStreamAudio: [],
			activeTrackId: -1,
			preferred: ['nl', 'en'],
			locale: 'nl',
			sourceName
		});
		expect(groups.map((g) => g.lang)).toEqual(['nl', 'en', 'de', 'und']);
		expect(groups[0].label).toBe('Nederlands');
		expect(groups[0].items[0].active).toBe(true);
		// Multi-audio variant appears in both its languages; quality order within a group.
		expect(groups[1].items.map((i) => i.variant.id)).toEqual(['en-4k', 'multi', 'en-sd']);
		expect(groups[2].items.map((i) => i.variant.id)).toEqual(['multi']);
		expect(groups[1].items[0].sourceName).toBe('Bron B');
	});

	it('replaces the current variant by its in-stream audio tracks', () => {
		const groups = buildLanguageMenu({
			variants,
			currentId: 'multi',
			inStreamAudio: [
				{ id: 0, lang: 'de', name: 'Deutsch' },
				{ id: 1, lang: 'en', name: 'English' }
			],
			activeTrackId: 1,
			preferred: ['nl', 'en'],
			locale: 'en',
			sourceName
		});
		const en = groups.find((g) => g.lang === 'en')!;
		expect(en.items[0]).toMatchObject({ kind: 'track', trackId: 1, active: true });
		expect(en.items.filter((i) => i.kind === 'variant' && i.variant.id === 'multi')).toHaveLength(
			0
		);
		const de = groups.find((g) => g.lang === 'de')!;
		expect(de.items).toHaveLength(1);
		expect(de.items[0]).toMatchObject({ kind: 'track', trackId: 0, active: false });
	});

	it('marks the active language of a multi-audio current variant', () => {
		const groups = buildLanguageMenu({
			variants,
			currentId: 'multi',
			inStreamAudio: [],
			activeTrackId: -1,
			currentLang: 'en',
			preferred: [],
			locale: 'nl',
			sourceName
		});
		const active = groups.flatMap((g) => g.items).filter((i) => i.active);
		expect(active).toHaveLength(1);
		expect(active[0].lang).toBe('en');
	});

	it('chooses the start variant from ?v= or preferences', () => {
		expect(chooseStartVariant(variants, 'en-sd', prefs)?.id).toBe('en-sd');
		expect(chooseStartVariant(variants, 'missing', prefs)?.id).toBe('nl-hd');
		expect(chooseStartVariant(variants, null, { ...prefs, audioLangs: ['en'] })?.id).toBe('en-4k');
		expect(chooseStartVariant([], null, prefs)).toBeUndefined();
	});

	it('keeps the audio language for the next episode', () => {
		const next = [
			v('n-nl', ['nl'], '4K'),
			v('n-en-a', ['en'], 'HD', 's1'),
			v('n-en-b', ['en'], 'FHD', 's2')
		];
		expect(pickVariantForLang(next, 'en', prefs, 's1')?.id).toBe('n-en-a');
		expect(pickVariantForLang(next, 'en', prefs)?.id).toBe('n-en-b');
		expect(pickVariantForLang(next, 'fr', prefs)?.id).toBe('n-nl');
		expect(pickVariantForLang(next, undefined, prefs)?.id).toBe('n-nl');
	});

	it('suggests a fallback variant after failures', () => {
		const failed = new Set(['nl-hd']);
		expect(fallbackVariant(variants, failed, variants[0], prefs)).toBeDefined();
		expect(fallbackVariant([variants[0]], failed, variants[0], prefs)).toBeUndefined();
	});
});

describe('episodes', () => {
	const ep = (s: number, e: number, playable = true): Episode => ({
		id: `t/s${s}e${e}`,
		season: s,
		episode: e,
		title: `E${e}`,
		variants: playable ? [v(`v${s}${e}`, ['nl'], 'HD')] : []
	});
	const seasons: Season[] = [
		{ number: 2, episodes: [ep(2, 2), ep(2, 1)] },
		{ number: 0, episodes: [ep(0, 1)] },
		{ number: 1, episodes: [ep(1, 1), ep(1, 2), ep(1, 3, false)] }
	];

	it('flattens in viewing order with specials last', () => {
		expect(flattenEpisodes(seasons).map((e) => e.id)).toEqual([
			't/s1e1',
			't/s1e2',
			't/s1e3',
			't/s2e1',
			't/s2e2',
			't/s0e1'
		]);
	});

	it('finds the next playable episode across seasons', () => {
		expect(nextEpisode(seasons, 't/s1e1')?.id).toBe('t/s1e2');
		expect(nextEpisode(seasons, 't/s1e2')?.id).toBe('t/s2e1');
		expect(nextEpisode(seasons, 't/s0e1')).toBeUndefined();
		expect(nextEpisode(seasons, 'nope')).toBeUndefined();
		expect(firstEpisode(seasons)?.id).toBe('t/s1e1');
		expect(findEpisode(seasons, 't/s2e2')?.episode).toBe(2);
	});
});

describe('resume', () => {
	const p = (positionSec: number, durationSec: number): WatchProgress => ({
		titleId: 't',
		variantId: 'v',
		positionSec,
		durationSec,
		updatedAt: 0
	});

	it('resumes between 30 s and 95 %', () => {
		expect(resumePosition(undefined)).toBeNull();
		expect(resumePosition(p(29, 1000))).toBeNull();
		expect(resumePosition(p(754, 3000))).toBe(754);
		expect(resumePosition(p(960, 1000))).toBeNull();
		expect(resumePosition(p(120, 0))).toBe(120);
	});

	it('decides when progress is worth saving', () => {
		expect(shouldSaveProgress(3, 100)).toBe(false);
		expect(shouldSaveProgress(50, 100)).toBe(true);
		expect(shouldSaveProgress(50, 0)).toBe(true);
		expect(shouldSaveProgress(Number.NaN, 100)).toBe(false);
	});

	it('shows the next card in the last 20 s or at the end', () => {
		expect(showNextCard(100, 2400, false)).toBe(false);
		expect(showNextCard(2385, 2400, false)).toBe(true);
		expect(showNextCard(10, 30, false)).toBe(false);
		expect(showNextCard(0, 0, true)).toBe(true);
	});
});

describe('keys', () => {
	it('maps arrows to volume for VOD and zapping for live', () => {
		expect(keyAction('ArrowUp', false)).toBe('volumeUp');
		expect(keyAction('ArrowUp', true)).toBe('channelUp');
		expect(keyAction('ArrowDown', true)).toBe('channelDown');
		expect(keyAction('ChannelUp', false)).toBe('channelUp');
		expect(keyAction('PageDown', true)).toBe('channelDown');
	});

	it('maps the remaining shortcuts', () => {
		expect(keyAction(' ', false)).toBe('toggle');
		expect(keyAction('Enter', false)).toBe('toggle');
		expect(keyAction('ArrowLeft', false)).toBe('back10');
		expect(keyAction('f', false)).toBe('fullscreen');
		expect(keyAction('M', false)).toBe('mute');
		expect(keyAction('c', false)).toBe('subtitles');
		expect(keyAction('GoBack', false)).toBe('back');
		expect(keyAction('BrowserBack', false)).toBe('back');
		expect(keyAction('x', false)).toBeNull();
	});
});

describe('format', () => {
	it('formats times', () => {
		expect(formatTime(0)).toBe('0:00');
		expect(formatTime(754)).toBe('12:34');
		expect(formatTime(3723)).toBe('1:02:03');
		expect(formatTime(-5)).toBe('0:00');
		expect(formatTime(Infinity)).toBe('0:00');
	});

	it('labels heights', () => {
		expect(heightLabel(2160)).toBe('4K');
		expect(heightLabel(1080)).toBe('1080p');
		expect(heightLabel(0)).toBe('');
	});
});

describe('spatial', () => {
	const r = (left: number, top: number) => ({ left, top, width: 40, height: 40 });

	it('picks the nearest neighbour in a direction', () => {
		const from = r(100, 100);
		const cands = [r(160, 100), r(300, 100), r(100, 20), r(40, 300)];
		expect(pickNeighbor(from, cands, 'right')).toBe(0);
		expect(pickNeighbor(from, cands, 'up')).toBe(2);
		expect(pickNeighbor(from, cands, 'down')).toBe(3);
		expect(pickNeighbor(from, [r(300, 100)], 'left')).toBe(-1);
	});
});
