// Version choice for merged titles: which audio language, quality and source to play.
// Defaults come from pickVariant (profile language preference with fallback).
import type { Episode, LangCode, Quality, StreamVariant, Title } from '#lib/types.ts';
import { pickVariant, type LangPrefs } from '#lib/merge/pick.ts';
import { qualityRank } from '#lib/lang.ts';

export interface VersionChoice {
	audio?: LangCode;
	quality?: Quality;
	sourceId?: string;
}

export const DEFAULT_PREFS: LangPrefs = {
	audioLangs: ['nl', 'en'],
	subtitleLangs: [],
	subtitlesOn: false
};

export function choiceFromVariant(v: StreamVariant | undefined): VersionChoice {
	if (!v) return {};
	return { audio: v.audioLangs[0], quality: v.quality, sourceId: v.sourceId };
}

/**
 * Best variant for an explicit choice. Each criterion narrows the candidates only when
 * something matches (audio > quality > source), so a choice made for one episode still
 * resolves sensibly for an episode that lacks that exact version.
 */
export function resolveVariant(
	variants: StreamVariant[],
	choice: VersionChoice,
	prefs: LangPrefs = DEFAULT_PREFS
): StreamVariant | undefined {
	if (variants.length === 0) return undefined;
	let c = variants;
	const narrow = (pred: (v: StreamVariant) => boolean) => {
		const next = c.filter(pred);
		if (next.length) c = next;
	};
	if (choice.audio) narrow((v) => v.audioLangs.includes(choice.audio as LangCode));
	if (choice.quality) narrow((v) => v.quality === choice.quality);
	if (choice.sourceId) narrow((v) => v.sourceId === choice.sourceId);
	const audioLangs = choice.audio
		? [choice.audio, ...prefs.audioLangs.filter((l) => l !== choice.audio)]
		: prefs.audioLangs;
	return pickVariant(c, { ...prefs, audioLangs });
}

export interface VersionOptions {
	/** Audio languages with the number of versions each. */
	audio: { lang: LangCode; count: number }[];
	/** Qualities available for the chosen audio language, best first. */
	qualities: Quality[];
	/** Sources available for the chosen audio + quality. */
	sources: string[];
	/** Subtitle languages across the candidates of the chosen audio language. */
	subtitles: LangCode[];
}

export function versionOptions(variants: StreamVariant[], choice: VersionChoice): VersionOptions {
	const audioCount = new Map<LangCode, number>();
	for (const v of variants)
		for (const l of new Set(v.audioLangs)) audioCount.set(l, (audioCount.get(l) ?? 0) + 1);

	const byAudio = choice.audio
		? variants.filter((v) => v.audioLangs.includes(choice.audio as LangCode))
		: variants;
	const pool = byAudio.length ? byAudio : variants;
	const qualities = [...new Set(pool.map((v) => v.quality))].sort(
		(a, b) => qualityRank(a) - qualityRank(b)
	);
	const byQuality = choice.quality ? pool.filter((v) => v.quality === choice.quality) : pool;
	const sources = [...new Set((byQuality.length ? byQuality : pool).map((v) => v.sourceId))];
	const subtitles = [...new Set(pool.flatMap((v) => v.subtitleLangs))];

	return {
		audio: [...audioCount].map(([lang, count]) => ({ lang, count })),
		qualities,
		sources,
		subtitles
	};
}

// ---------------------------------------------------------------------------
// Series helpers
// ---------------------------------------------------------------------------

export function allEpisodes(title: Title): Episode[] {
	return (title.seasons ?? []).flatMap((s) => s.episodes);
}

/** Every playable variant of a title (movie variants, or all episode variants). */
export function allVariants(title: Title): StreamVariant[] {
	return title.kind === 'movie' ? title.variants : allEpisodes(title).flatMap((e) => e.variants);
}

export function findEpisode(title: Title, episodeId: string | undefined): Episode | undefined {
	if (!episodeId) return undefined;
	return allEpisodes(title).find((e) => e.id === episodeId);
}

export function firstEpisode(title: Title): Episode | undefined {
	const seasons = [...(title.seasons ?? [])].sort((a, b) => a.number - b.number);
	const regular = seasons.find((s) => s.number > 0 && s.episodes.length) ?? seasons[0];
	return regular ? [...regular.episodes].sort((a, b) => a.episode - b.episode)[0] : undefined;
}

/** Union of audio languages of one episode's variants. */
export function episodeLanguages(ep: Episode): LangCode[] {
	return [...new Set(ep.variants.flatMap((v) => v.audioLangs))];
}
