// Pure helpers for series playback: episode lookup and "next episode".
import type { Episode, Season } from '#lib/types.ts';

/** All episodes in viewing order (season, then episode number). Season 0 (specials) goes last. */
export function flattenEpisodes(seasons: Season[] | undefined): Episode[] {
	if (!seasons) return [];
	const order = (n: number) => (n === 0 ? Number.MAX_SAFE_INTEGER : n);
	return [...seasons]
		.sort((a, b) => order(a.number) - order(b.number))
		.flatMap((s) => [...s.episodes].sort((a, b) => a.episode - b.episode));
}

export function findEpisode(seasons: Season[] | undefined, id: string | null | undefined) {
	if (!id) return undefined;
	return flattenEpisodes(seasons).find((e) => e.id === id);
}

/** First playable episode (used when /watch/<series> is opened without ?e=). */
export function firstEpisode(seasons: Season[] | undefined): Episode | undefined {
	return flattenEpisodes(seasons).find((e) => e.variants.length > 0);
}

/** Next playable episode after `currentId` (crosses season boundaries, skips unplayable ones). */
export function nextEpisode(
	seasons: Season[] | undefined,
	currentId: string | undefined
): Episode | undefined {
	const list = flattenEpisodes(seasons);
	const i = list.findIndex((e) => e.id === currentId);
	if (i === -1) return undefined;
	return list.slice(i + 1).find((e) => e.variants.length > 0);
}
