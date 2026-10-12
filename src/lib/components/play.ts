// "Nu kijken" / "Verder kijken" target for a title, based on the active profile's
// progress and language preference.
import type { Episode, Title } from '#lib/types.ts';
import type { ResolvedPathname } from '$app/types';
import { pickVariant, type LangPrefs } from '#lib/merge/pick.ts';
import { user } from '#lib/stores/user.svelte.ts';
import { titleHref, watchHref } from './links.ts';
import { allEpisodes, DEFAULT_PREFS, findEpisode, firstEpisode } from './versions.ts';

/** Language preferences of the active profile. */
export function profilePrefs(): LangPrefs {
	const p = user.active;
	return p
		? { audioLangs: p.audioLangs, subtitleLangs: p.subtitleLangs, subtitlesOn: p.subtitlesOn }
		: DEFAULT_PREFS;
}

export interface PlayAction {
	href: ResolvedPathname;
	/** True when continuing an in-progress item. */
	resume: boolean;
	/** 0..1 progress of the item being resumed. */
	ratio: number;
	episode?: Episode;
	/** False when nothing is playable yet (e.g. series episodes not loaded). */
	playable: boolean;
}

function nextEpisode(title: Title, ep: Episode): Episode | undefined {
	const list = allEpisodes(title).sort((a, b) => a.season - b.season || a.episode - b.episode);
	const i = list.findIndex((e) => e.id === ep.id);
	return i >= 0 ? list[i + 1] : undefined;
}

export function playAction(title: Title): PlayAction {
	const prefs = profilePrefs();
	const p = user.latestProgress(title.id);
	const ratio = p && p.durationSec > 0 ? p.positionSec / p.durationSec : 0;

	if (title.kind === 'movie') {
		if (p && p.positionSec >= 30 && ratio < 0.95)
			return {
				href: watchHref(title.id, { variantId: p.variantId }),
				resume: true,
				ratio,
				playable: true
			};
		const v = pickVariant(title.variants, prefs);
		return {
			href: watchHref(title.id, { variantId: v?.id }),
			resume: false,
			ratio: 0,
			playable: !!v
		};
	}

	const watched = findEpisode(title, p?.episodeId);
	if (p && watched && p.positionSec >= 30 && ratio < 0.95)
		return {
			href: watchHref(title.id, { episodeId: watched.id, variantId: p.variantId }),
			resume: true,
			ratio,
			episode: watched,
			playable: true
		};
	const ep = (watched && nextEpisode(title, watched)) ?? firstEpisode(title);
	if (!ep) return { href: titleHref(title.id), resume: false, ratio: 0, playable: false };
	const v = pickVariant(ep.variants, prefs);
	return {
		href: watchHref(title.id, { episodeId: ep.id, variantId: v?.id }),
		resume: !!watched,
		ratio: 0,
		episode: ep,
		playable: true
	};
}
