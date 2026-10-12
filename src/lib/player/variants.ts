// Pure logic for the "Taal en bron" (language & source) menu and variant selection.
import type { LangCode, StreamVariant } from '#lib/types.ts';
import { languageName, qualityRank } from '#lib/lang.ts';
import { pickVariant, type LangPrefs } from '#lib/merge/pick.ts';
import type { TrackInfo } from './tracks.ts';

export interface LangMenuItem {
	/** Unique key for keyed each-blocks. */
	key: string;
	/** 'variant' = switch to another stream; 'track' = switch audio track inside the current stream. */
	kind: 'variant' | 'track';
	variant: StreamVariant;
	/** Audio language this entry stands for. */
	lang: LangCode;
	/** For kind 'track': hls/native track id. */
	trackId?: number;
	/** For kind 'track': the track label from the stream. */
	trackName?: string;
	sourceName: string;
	isCurrentVariant: boolean;
	active: boolean;
}

export interface LangMenuGroup {
	lang: LangCode;
	label: string;
	items: LangMenuItem[];
}

export interface LangMenuInput {
	variants: StreamVariant[];
	currentId: string | undefined;
	/** Audio tracks found inside the current stream. */
	inStreamAudio: TrackInfo[];
	/** Active in-stream audio track id (-1 = unknown). */
	activeTrackId: number;
	/** Language of the audio currently heard (track language, or the variant's primary). */
	currentLang?: LangCode;
	/** Profile audio languages in order; their groups come first. */
	preferred: LangCode[];
	locale: 'nl' | 'en';
	sourceName: (sourceId: string) => string;
}

/** Primary audio language of a variant ('und' when unknown). */
export function primaryLang(v: StreamVariant | undefined): LangCode {
	return v?.audioLangs[0] ?? 'und';
}

/**
 * Group all variants (plus the in-stream audio tracks of the current stream) per audio
 * language. A multi-audio variant appears in every language group it carries. When the
 * current stream itself has several audio tracks, those tracks replace the current variant's
 * entries, so picking one switches tracks instantly instead of reloading the stream.
 */
export function buildLanguageMenu(input: LangMenuInput): LangMenuGroup[] {
	const groups = new Map<LangCode, LangMenuItem[]>();
	const add = (item: LangMenuItem) => {
		const list = groups.get(item.lang) ?? [];
		list.push(item);
		groups.set(item.lang, list);
	};
	const useTracks = input.inStreamAudio.length > 1;
	const current = input.variants.find((v) => v.id === input.currentId);

	for (const v of input.variants) {
		const isCurrent = v.id === input.currentId;
		if (isCurrent && useTracks) continue;
		const langs = v.audioLangs.length ? [...new Set(v.audioLangs)] : ['und'];
		for (const lang of langs) {
			add({
				key: `v:${v.id}:${lang}`,
				kind: 'variant',
				variant: v,
				lang,
				sourceName: input.sourceName(v.sourceId),
				isCurrentVariant: isCurrent,
				active: isCurrent && lang === (input.currentLang ?? primaryLang(v))
			});
		}
	}
	if (current && useTracks) {
		for (const t of input.inStreamAudio) {
			add({
				key: `t:${current.id}:${t.id}`,
				kind: 'track',
				variant: current,
				lang: t.lang,
				trackId: t.id,
				trackName: t.name,
				sourceName: input.sourceName(current.sourceId),
				isCurrentVariant: true,
				active: t.id === input.activeTrackId
			});
		}
	}

	const prefIndex = (lang: LangCode) => {
		const i = input.preferred.indexOf(lang);
		return i === -1 ? Number.MAX_SAFE_INTEGER : i;
	};
	const label = (lang: LangCode) => languageName(lang, input.locale);
	return [...groups.entries()]
		.map(([lang, items]) => ({
			lang,
			label: label(lang),
			items: items.sort(
				(a, b) =>
					Number(b.isCurrentVariant) - Number(a.isCurrentVariant) ||
					qualityRank(a.variant.quality) - qualityRank(b.variant.quality) ||
					a.sourceName.localeCompare(b.sourceName) ||
					(a.trackId ?? 0) - (b.trackId ?? 0)
			)
		}))
		.sort(
			(a, b) =>
				Number(a.lang === 'und') - Number(b.lang === 'und') ||
				prefIndex(a.lang) - prefIndex(b.lang) ||
				a.label.localeCompare(b.label)
		);
}

/** Start variant: the requested `?v=` id when it exists, else the profile's best match. */
export function chooseStartVariant(
	variants: StreamVariant[],
	requestedId: string | null | undefined,
	prefs: LangPrefs
): StreamVariant | undefined {
	if (requestedId) {
		const hit = variants.find((v) => v.id === requestedId);
		if (hit) return hit;
	}
	return pickVariant(variants, prefs);
}

/**
 * Variant with the given audio language (used for the next episode, so the viewer keeps
 * hearing the same language). Prefers the same source, then the best quality; falls back to
 * the profile's normal choice when the language is not available.
 */
export function pickVariantForLang(
	variants: StreamVariant[],
	lang: LangCode | undefined,
	prefs: LangPrefs,
	preferSourceId?: string
): StreamVariant | undefined {
	if (lang && lang !== 'und') {
		const same = variants.filter((v) => v.audioLangs.includes(lang));
		if (same.length) {
			return [...same].sort(
				(a, b) =>
					Number(b.sourceId === preferSourceId) - Number(a.sourceId === preferSourceId) ||
					a.audioLangs.indexOf(lang) - b.audioLangs.indexOf(lang) ||
					qualityRank(a.quality) - qualityRank(b.quality)
			)[0];
		}
	}
	return pickVariant(variants, {
		...prefs,
		audioLangs: lang ? [lang, ...prefs.audioLangs] : prefs.audioLangs
	});
}

/** Next variant to try after a playback failure (other source first, same language preferred). */
export function fallbackVariant(
	variants: StreamVariant[],
	failedIds: ReadonlySet<string>,
	current: StreamVariant | undefined,
	prefs: LangPrefs
): StreamVariant | undefined {
	const rest = variants.filter((v) => !failedIds.has(v.id) && v.id !== current?.id);
	if (!rest.length) return undefined;
	return pickVariantForLang(rest, primaryLang(current), prefs, undefined);
}
