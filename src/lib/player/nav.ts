// Navigation helpers for the player routes. In-player navigations (variant switch, next
// episode, zapping) replace the history entry, so "back" always leaves the player.
import { goto } from '$app/navigation';
import type { ResolvedPathname } from '$app/types';
import { liveHref, path, watchHref, type SubtitleParam } from '#lib/components/links.ts';

/** Player url; `subtitle` keeps the `?s=` choice from the detail page across episodes/versions. */
export function watchPath(
	titleId: string,
	episodeId?: string,
	variantId?: string,
	subtitle?: SubtitleParam
) {
	return watchHref(titleId, { episodeId, variantId, subtitle });
}

export function livePath(channelId: string, variantId?: string) {
	return liveHref(channelId, variantId);
}

/** Swap the player state in place (same route component, same engine). */
export function replaceIn(url: ResolvedPathname) {
	return goto(url, { replace: true, reset: false });
}

let cameFromApp = false;

/** Record whether the player was reached by in-app navigation (first afterNavigate only). */
export function markEntry(from: unknown) {
	cameFromApp = !!from;
}

/** Leave the player: history back when we came from inside the app, else to `fallback`. */
export function leave(fallback: string) {
	if (cameFromApp && history.length > 1) {
		cameFromApp = false;
		history.back();
	} else void goto(path(fallback), { replace: true });
}
