// Typed href helpers. All in-app links go through these so they get the base path
// (via resolve) and are typed as ResolvedPathname (required by the eslint rule
// svelte/no-navigation-without-resolve). Routes that do not exist yet (round 2)
// are still linkable through `path()`.
import { resolve } from '$app/paths';
import type { ResolvedPathname } from '$app/types';
import type { LangCode } from '#lib/types.ts';

const resolvePathname = resolve as unknown as (pathname: string) => string;

/** Resolve an absolute in-app path such as "/movies?genre=Drama". */
export function path(p: string): ResolvedPathname {
	return resolvePathname(p.replace(/^\/+/, '')) as ResolvedPathname;
}

function query(params: Record<string, string | undefined | null>): string {
	const q = new URLSearchParams();
	for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
	const s = q.toString();
	return s ? `?${s}` : '';
}

export function titleHref(titleId: string): ResolvedPathname {
	return path(`/title/${encodeURIComponent(titleId)}`);
}

/** Subtitle choice passed to the player: a language, or 'off'. */
export type SubtitleParam = LangCode | 'off';

/**
 * Player link: `?e=` episode, `?v=` variant, `?s=` subtitle choice (language or 'off';
 * omitted = the profile's default rule).
 */
export function watchHref(
	titleId: string,
	opts: { episodeId?: string; variantId?: string; subtitle?: SubtitleParam } = {}
): ResolvedPathname {
	return path(
		`/watch/${encodeURIComponent(titleId)}${query({ e: opts.episodeId, v: opts.variantId, s: opts.subtitle })}`
	);
}

/** Live player link, optionally with a specific variant (`?v=`). */
export function liveHref(channelId: string, variantId?: string): ResolvedPathname {
	return path(`/watch/live/${encodeURIComponent(channelId)}${query({ v: variantId })}`);
}

export function libraryHref(
	kind: 'movie' | 'series',
	params: { genre?: string; sort?: string; lang?: string } = {}
): ResolvedPathname {
	return path(`/${kind === 'movie' ? 'movies' : 'series'}${query(params)}`);
}
