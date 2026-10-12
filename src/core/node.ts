// PrismaCore for Node: the shared TypeScript core as a plain OBJECT API for the backend
// (server/). Same engine as the web app and the Apple TV bundle (src/core/index.ts), but
// without JSON strings: every function takes and returns plain objects.
//
//   npm run build:core:node   → server/vendor/prisma-core.mjs (ESM, target node24, deps inlined)
//
// The server imports only that bundle at runtime (never ../src). Its type declarations live
// in server/vendor/prisma-core.d.mts (hand-written; keep in sync with the exports below).
// Rules: no Svelte, no Capacitor, no browser globals (IndexedDB, window). Pure functions only;
// networking, caching and persistence are the server's job.
import type { Channel, LangCode, RawEpisode, RawSeries, StreamVariant, Title } from '#lib/types.ts';
import {
	mergeSeasons as mergeEpisodeSeasons,
	normalizeGenres,
	withSeasons
} from '#lib/merge/index.ts';
import type { EpisodeSource } from '#lib/merge/series.ts';

/** Version of the Node core API (bump on breaking changes). */
export const CORE_NODE_VERSION = '1.0.0';

// ---- Merge engine ------------------------------------------------------------------------

export {
	buildCatalog,
	analyzeRaw,
	withSeasons,
	isKidsSafe,
	popularityScore,
	pickVariant,
	groupVariantsByLanguage,
	summarizeLanguages,
	normalizeGenres,
	genreSlug,
	slugify,
	foldText,
	parseTitle
} from '#lib/merge/index.ts';
export { mergeSeasons } from '#lib/merge/series.ts';
export { buildChannels, groupEpg } from '#lib/merge/channels.ts';
export { displayTitleFor, localizedTitle } from '#lib/merge/display.ts';

// ---- Providers (pure parsers and mappers) ------------------------------------------------

export { M3UParser, parseM3U, looksLikeM3U } from '#lib/providers/m3u.ts';
export {
	createXmltvCollector,
	parseXmltvText,
	parseXmltvTime,
	isGzip
} from '#lib/providers/xmltv.ts';
export {
	asArray,
	categoryMap,
	mapVodStream,
	mapSeries,
	mapLiveStream,
	mapSeriesInfo,
	mapShortEpg,
	parseAccount,
	normalizeServerUrl,
	xmltvUrl,
	liveTsUrl
} from '#lib/providers/xtream-map.ts';
export { HttpError } from '#lib/providers/errors.ts';
export {
	redactUrl,
	redactText,
	redactSecrets,
	secretsFromUrl,
	urlHasSecrets
} from '#lib/providers/redact.ts';
export { createMasker } from '#lib/sources/mask.ts';

// ---- Search, recommendations, demo data, TMDB ----------------------------------------------

export { SearchIndex } from '#lib/search/index.ts';
export { fold, tokenize } from '#lib/search/fold.ts';
export {
	recommend,
	similarTitles,
	popular,
	trending,
	recent,
	featured,
	genreCounts,
	languageCounts
} from '#lib/recommend.ts';
export {
	sampleCatalogs,
	SAMPLE_SOURCE,
	SAMPLE_EXTRA_SOURCES,
	SAMPLE_SOURCE_IDS,
	SAMPLE_SOURCE_NAMES,
	isSampleSourceId
} from '#lib/sample/index.ts';
export { TmdbClient, TmdbError, RateLimiter as TmdbRateLimiter } from '#lib/tmdb/client.ts';
export { tmdbLookupKey, tmdbMetaKey } from '#lib/tmdb/types.ts';
export { enrichTitles, indexMeta, emptyIndex } from '#lib/tmdb/index.ts';

// ---- Server helpers (stateless versions of web-store logic) --------------------------------

/** Light title for lists (docs/BACKEND.md): no variants, no seasons. */
export type TitleCard = Pick<
	Title,
	| 'id'
	| 'kind'
	| 'title'
	| 'originalTitle'
	| 'year'
	| 'genres'
	| 'rating'
	| 'runtimeMin'
	| 'posterUrl'
	| 'backdropUrl'
	| 'logoUrl'
	| 'addedAt'
	| 'popularity'
	| 'languages'
	| 'subtitleLanguages'
	| 'qualities'
	| 'certification'
	| 'kidsSafe'
	| 'originalLang'
> & {
	altTitles: { title: string; lang?: LangCode }[];
	overview?: string;
	seasonCount?: number;
};

export type ChannelCard = Omit<Channel, 'variants'> & { variantCount: number };

export const CARD_MAX_ALT_TITLES = 12;
export const CARD_MAX_OVERVIEW = 280;

function clip(text: string | undefined, max: number): string | undefined {
	if (!text) return undefined;
	if (text.length <= max) return text;
	const cut = text.slice(0, max - 1);
	const space = cut.lastIndexOf(' ');
	return (space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd() + '…';
}

/** Title → TitleCard (undefined fields are dropped, so the JSON stays compact). */
export function toTitleCard(t: Title): TitleCard {
	const card: TitleCard = {
		id: t.id,
		kind: t.kind,
		title: t.title,
		originalTitle: t.originalTitle,
		altTitles: t.altTitles.slice(0, CARD_MAX_ALT_TITLES),
		year: t.year,
		overview: clip(t.overview, CARD_MAX_OVERVIEW),
		genres: t.genres,
		rating: t.rating,
		runtimeMin: t.runtimeMin,
		posterUrl: t.posterUrl,
		backdropUrl: t.backdropUrl,
		logoUrl: t.logoUrl,
		addedAt: t.addedAt,
		popularity: t.popularity,
		languages: t.languages,
		subtitleLanguages: t.subtitleLanguages,
		qualities: t.qualities,
		certification: t.certification,
		kidsSafe: t.kidsSafe,
		originalLang: t.originalLang,
		seasonCount: t.kind === 'series' && t.seasons ? t.seasons.length : undefined
	};
	for (const k of Object.keys(card) as (keyof TitleCard)[])
		if (card[k] === undefined) delete card[k];
	return card;
}

/** Channel → ChannelCard (variants replaced by their count). */
export function toChannelCard(c: Channel): ChannelCard {
	const { variants, ...rest } = c;
	const card: ChannelCard = { ...rest, variantCount: variants.length };
	for (const k of Object.keys(card) as (keyof ChannelCard)[])
		if (card[k] === undefined) delete card[k];
	return card;
}

/**
 * Words (folded, lowercase) in a channel group that mark it as kids-friendly. Same rule as
 * `isKidsChannel` in src/lib/stores/kids.svelte.ts (that file is a Svelte store and cannot be
 * bundled here; keep both in sync).
 */
const KIDS_GROUP =
	/(^|[^\p{L}])(kids?|kinder(en)?|kind|jeugd|junior|family|familie|famille|familia|animati(e|on)|cartoons?|toons?|enfants?|jeunesse|ninos|infantil|bambini|cocuk)([^\p{L}]|$)/u;

export function isKidsChannelGroup(group: string | undefined): boolean {
	return KIDS_GROUP.test((group ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase());
}

/** Episodes of one raw series that were loaded lazily (Xtream get_series_info). */
export interface SeriesEpisodeInput {
	sourceId: string;
	/** Audio/subtitle languages, quality and clean title of the raw series (analyzeRaw). */
	audio: LangCode[];
	subs: LangCode[];
	quality: StreamVariant['quality'];
	seriesTitle: string;
	episodes: RawEpisode[];
	/** Series metadata (mapSeriesInfo().info) to fill gaps in the title. */
	info?: Partial<RawSeries>;
}

/**
 * Merge lazily loaded episodes into a series title, exactly like the web catalog store's
 * ensureSeasons(): existing seasons are kept and extended, languages/qualities recomputed and
 * missing metadata filled from the series info.
 */
export function mergeSeriesEpisodes(
	title: Title,
	inputs: SeriesEpisodeInput[],
	preferLang: LangCode = 'nl'
): Title {
	const info: Partial<RawSeries> = {};
	const sources: EpisodeSource[] = [];
	for (const input of inputs) {
		for (const [k, v] of Object.entries(input.info ?? {}))
			if (v != null && v !== '' && info[k as keyof RawSeries] == null)
				(info as Record<string, unknown>)[k] = v;
		if (!input.episodes.length) continue;
		sources.push({
			sourceId: input.sourceId,
			audio: input.audio,
			subs: input.subs,
			quality: input.quality,
			seriesTitle: input.seriesTitle,
			episodes: input.episodes
		});
	}
	const seasons = sources.length
		? mergeEpisodeSeasons(title.id, sources, preferLang, title.seasons)
		: (title.seasons ?? []);
	return {
		...withSeasons(title, seasons),
		overview: title.overview ?? info.plot,
		posterUrl: title.posterUrl ?? info.posterUrl,
		backdropUrl: title.backdropUrl ?? info.backdropUrl,
		trailerUrl: title.trailerUrl ?? info.trailerUrl,
		rating: title.rating ?? info.rating,
		director: title.director ?? info.director,
		releaseDate: title.releaseDate ?? info.releaseDate,
		genres: title.genres.length ? title.genres : normalizeGenres(info.genres),
		cast: title.cast.length ? title.cast : (info.cast ?? []).map((name) => ({ name }))
	};
}
