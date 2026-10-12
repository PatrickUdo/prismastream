// Pure helpers around in-stream audio and subtitle tracks: language normalisation and
// default-track selection according to the profile's preferences.
import type { LangCode } from '#lib/types.ts';
import { KNOWN_LANGS, languageName, nativeLanguageName } from '#lib/lang.ts';

export interface TrackInfo {
	/** hls.js track id, or index in the native track list. */
	id: number;
	lang: LangCode;
	/** Label from the stream (may be empty). */
	name: string;
	isDefault?: boolean;
}

const ISO3: Record<string, LangCode> = {
	eng: 'en',
	dut: 'nl',
	nld: 'nl',
	vla: 'nl',
	ger: 'de',
	deu: 'de',
	fre: 'fr',
	fra: 'fr',
	spa: 'es',
	esl: 'es',
	ita: 'it',
	tur: 'tr',
	ara: 'ar',
	pol: 'pl',
	por: 'pt',
	rus: 'ru',
	jpn: 'ja',
	kor: 'ko',
	chi: 'zh',
	zho: 'zh',
	hin: 'hi',
	swe: 'sv',
	dan: 'da',
	nor: 'no',
	nob: 'no',
	nno: 'no',
	fin: 'fi',
	gre: 'el',
	ell: 'el',
	rum: 'ro',
	ron: 'ro'
};

/** Normalise a stream language tag ('en-US', 'eng', 'English', 'nl_BE') to ISO 639-1. */
export function normalizeLang(raw?: string | null, name?: string | null): LangCode {
	const tag = (raw ?? '').trim().toLowerCase();
	if (tag) {
		const base = tag.split(/[-_\s]/)[0];
		if (base.length === 2) return base === 'nb' || base === 'nn' ? 'no' : base;
		if (ISO3[base]) return ISO3[base];
		const byName = langFromName(tag);
		if (byName) return byName;
	}
	if (name) return langFromName(name.trim().toLowerCase()) ?? 'und';
	return 'und';
}

function langFromName(n: string): LangCode | undefined {
	for (const code of KNOWN_LANGS) {
		if (
			n === languageName(code, 'en').toLowerCase() ||
			n === languageName(code, 'nl').toLowerCase() ||
			n === nativeLanguageName(code).toLowerCase()
		)
			return code;
	}
	return undefined;
}

/** Best audio track for an ordered list of preferred languages; falls back to the stream default. */
export function chooseAudioTrack(tracks: TrackInfo[], preferred: LangCode[]): number {
	if (tracks.length === 0) return -1;
	for (const lang of preferred) {
		const hit = tracks.find((t) => t.lang === lang);
		if (hit) return hit.id;
	}
	return (tracks.find((t) => t.isDefault) ?? tracks[0]).id;
}

export interface SubtitlePrefs {
	subtitlesOn: boolean;
	subtitleLangs: LangCode[];
	/** Audio languages the viewer understands (profile.audioLangs). */
	audioLangs: LangCode[];
	uiLang: LangCode;
	/**
	 * Explicit choice made earlier in this session: a language, or null for "off".
	 * Undefined = no explicit choice, use the profile defaults.
	 */
	sessionChoice?: LangCode | null;
	/**
	 * Choice passed in from the detail page (`?s=`): a language, or null for "off".
	 * Like sessionChoice, but a language the stream does not have falls back silently to
	 * the profile rule instead of switching subtitles off.
	 */
	requested?: LangCode | null;
}

/** Parse the `?s=` parameter: 'off' → null, a language code → the code, else undefined. */
export function parseSubtitleParam(raw: string | null | undefined): LangCode | null | undefined {
	const v = raw?.trim().toLowerCase();
	if (!v) return undefined;
	if (v === 'off') return null;
	return /^[a-z]{2,3}$/.test(v) ? normalizeLang(v) : undefined;
}

/**
 * Default subtitle track (-1 = off).
 * - An explicit session choice wins (same language, or off).
 * - Then the requested choice from the detail page (`?s=`): off, or that language when the
 *   stream has it (otherwise the profile rule below applies).
 * - subtitlesOn: preferred subtitle languages, then the UI language, then English.
 * - subtitlesOff, but the audio is in a language the viewer did not list: switch on a
 *   subtitle in a preferred language if one exists (like "forced" subtitles).
 */
export function chooseSubtitleTrack(
	tracks: TrackInfo[],
	prefs: SubtitlePrefs,
	audioLang?: LangCode
): number {
	if (tracks.length === 0) return -1;
	const find = (lang: LangCode) => tracks.find((t) => t.lang === lang)?.id;
	if (prefs.sessionChoice === null) return -1;
	if (prefs.sessionChoice) return find(prefs.sessionChoice) ?? -1;
	if (prefs.sessionChoice === undefined) {
		if (prefs.requested === null) return -1;
		if (prefs.requested) {
			const id = find(prefs.requested);
			if (id !== undefined) return id;
		}
	}
	const preferred = [...prefs.subtitleLangs, prefs.uiLang];
	if (prefs.subtitlesOn) {
		for (const lang of [...preferred, 'en']) {
			const id = find(lang);
			if (id !== undefined) return id;
		}
		return -1;
	}
	const foreign =
		audioLang !== undefined && audioLang !== 'und' && !prefs.audioLangs.includes(audioLang);
	if (foreign) {
		for (const lang of preferred) {
			if (lang === audioLang) continue;
			const id = find(lang);
			if (id !== undefined) return id;
		}
	}
	return -1;
}
