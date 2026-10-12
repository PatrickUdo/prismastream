// Shared TMDB enrichment types. The merge engine only depends on these (serialisable, so the
// index can be passed to the build worker).
import type { LangCode, Person } from '#lib/types.ts';

export type TmdbKind = 'movie' | 'series';

/** Metadata fetched from TMDB for one title, in the profile language. */
export interface TmdbMeta {
	id: number;
	kind: TmdbKind;
	title: string;
	originalTitle?: string;
	originalLang?: LangCode;
	overview?: string;
	genres: string[];
	runtimeMin?: number;
	releaseDate?: string;
	year?: number;
	rating?: number;
	cast: Person[];
	director?: string;
	posterUrl?: string;
	backdropUrl?: string;
	trailerUrl?: string;
	imdbId?: string;
	/** Age certification normalised to Kijkwijzer-style ages: 'AL', '6', '9', '12', '14', '16', '18'. */
	certification?: string;
	/** Alternative and translated titles (used for matching). */
	altTitles: { title: string; lang?: LangCode }[];
	/** Language the overview/genres were requested in. */
	lang: LangCode;
	fetchedAt: number;
}

/**
 * Enrichment index consumed by buildCatalog():
 *  - byKey: `${kind}|${matchKey}|${year ?? ''}` → tmdbId (from searches and alternative titles)
 *  - meta:  `${kind}-${tmdbId}` → metadata
 */
export interface TmdbIndex {
	byKey: Record<string, number>;
	meta: Record<string, TmdbMeta>;
}

export function tmdbLookupKey(kind: TmdbKind, key: string, year?: number): string {
	return `${kind}|${key}|${year ?? ''}`;
}

export function tmdbMetaKey(kind: TmdbKind, id: number): string {
	return `${kind}-${id}`;
}
