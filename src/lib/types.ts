// Shared domain types. Every module codes against these; change them only in coordination.

/** ISO 639-1 language code, lowercase ('nl', 'en', 'de', ...). 'und' = unknown. */
export type LangCode = string;

export type Quality = '4K' | 'FHD' | 'HD' | 'SD' | 'unknown';

export type MediaKind = 'movie' | 'series' | 'live';

// ---------------------------------------------------------------------------
// Sources (user-configured IPTV accounts). Secrets (passwords) are NOT stored
// on these objects; they live in secure storage keyed by source id.
// ---------------------------------------------------------------------------

interface SourceBase {
	id: string;
	name: string;
	enabled: boolean;
	addedAt: number;
	/** Last successful refresh (epoch ms). */
	lastSyncAt?: number;
	lastError?: string;
}

export interface XtreamSource extends SourceBase {
	type: 'xtream';
	serverUrl: string;
	username: string;
	/** Optional XMLTV override; otherwise `${serverUrl}/xmltv.php` is used. */
	epgUrl?: string;
}

export interface M3USource extends SourceBase {
	type: 'm3u';
	playlistUrl: string;
	epgUrl?: string;
}

/** Built-in fictional demo content. */
export interface SampleSource extends SourceBase {
	type: 'sample';
}

export type SourceConfig = XtreamSource | M3USource | SampleSource;

// ---------------------------------------------------------------------------
// Raw provider output (before merging). Providers fill in what they know;
// the merge engine does normalisation, language detection and matching.
// ---------------------------------------------------------------------------

interface RawMeta {
	/** Title exactly as delivered, e.g. "NL - De Matrix (1999) [4K]". */
	rawTitle: string;
	/** Provider category / group name, e.g. "NL | Films 2024". Useful for language hints. */
	category?: string;
	originalTitle?: string;
	year?: number;
	tmdbId?: number;
	imdbId?: string;
	posterUrl?: string;
	backdropUrl?: string;
	plot?: string;
	genres?: string[];
	cast?: string[];
	director?: string;
	releaseDate?: string;
	rating?: number;
	durationSec?: number;
	trailerUrl?: string;
	/** Epoch ms the provider added the item. */
	addedAt?: number;
	/** Explicit language if the provider exposes it. */
	langHint?: LangCode;
	/** Explicit subtitle languages if known. */
	subtitleHint?: LangCode[];
	/** Age certification as delivered, e.g. 'AL', '12', 'PG-13'. */
	certification?: string;
}

export interface RawMovie extends RawMeta {
	kind: 'movie';
	sourceId: string;
	/** Item id inside the source (Xtream stream_id, or a hash of the M3U url). */
	providerId: string;
	url: string;
	containerExt?: string;
}

export interface RawEpisode {
	providerId: string;
	season: number;
	episode: number;
	title?: string;
	plot?: string;
	durationSec?: number;
	stillUrl?: string;
	airDate?: string;
	url: string;
	containerExt?: string;
}

export interface RawSeries extends RawMeta {
	kind: 'series';
	sourceId: string;
	providerId: string;
	/** Present for M3U/sample; for Xtream loaded lazily via loadSeriesEpisodes(). */
	episodes?: RawEpisode[];
}

export interface RawChannel {
	kind: 'live';
	sourceId: string;
	providerId: string;
	rawName: string;
	tvgId?: string;
	tvgName?: string;
	logoUrl?: string;
	group?: string;
	number?: number;
	url: string;
	/** Fallback urls (e.g. the .ts variant of an Xtream .m3u8 live stream). */
	altUrls?: string[];
	langHint?: LangCode;
	catchupDays?: number;
}

export interface EpgProgramme {
	/** XMLTV channel id (matches RawChannel.tvgId / Channel.epgId). */
	channelId: string;
	start: number;
	stop: number;
	title: string;
	desc?: string;
	category?: string;
	icon?: string;
}

/** Everything one source produced in one refresh. */
export interface RawCatalog {
	sourceId: string;
	movies: RawMovie[];
	series: RawSeries[];
	channels: RawChannel[];
	epg: EpgProgramme[];
	fetchedAt: number;
}

// ---------------------------------------------------------------------------
// Merged catalog (what the UI renders). One Title per real-world film/series,
// regardless of how many languages/sources/qualities exist.
// ---------------------------------------------------------------------------

/** One concrete playable stream of a title/episode/channel. */
export interface StreamVariant {
	/** `${sourceId}:${providerId}` (unique). */
	id: string;
	sourceId: string;
	url: string;
	/** Audio languages of this stream (from title prefix / category / hint). Primary first. */
	audioLangs: LangCode[];
	subtitleLangs: LangCode[];
	quality: Quality;
	/** The original provider title, kept for transparency/debugging. */
	label: string;
	containerExt?: string;
	/** Fallback urls for the same stream (e.g. .ts variant of a live .m3u8). */
	altUrls?: string[];
}

export interface Person {
	name: string;
	character?: string;
	profileUrl?: string;
}

export interface Episode {
	/** `${titleId}/s${season}e${episode}` */
	id: string;
	season: number;
	episode: number;
	title: string;
	overview?: string;
	runtimeMin?: number;
	stillUrl?: string;
	airDate?: string;
	variants: StreamVariant[];
}

export interface Season {
	number: number;
	episodes: Episode[];
}

export interface Title {
	/** Stable merged id: 'tmdb-m-603', 'tmdb-s-1399', 'imdb-tt0133093' or 'k-movie-the-matrix-1999'. */
	id: string;
	kind: 'movie' | 'series';
	/** Display title (best available; UI may localise via altTitles). */
	title: string;
	originalTitle?: string;
	/** Every distinct title seen across sources/languages, with its language when known. */
	altTitles: { title: string; lang?: LangCode }[];
	year?: number;
	tmdbId?: number;
	imdbId?: string;
	overview?: string;
	genres: string[];
	runtimeMin?: number;
	releaseDate?: string;
	rating?: number;
	cast: Person[];
	director?: string;
	trailerUrl?: string;
	posterUrl?: string;
	backdropUrl?: string;
	/** Title logo artwork (transparent), e.g. from TMDB /images. */
	logoUrl?: string;
	/** Original spoken language (passed to pickVariant as fallback). */
	originalLang?: LangCode;
	/** Age certification as shown to users, e.g. 'AL', '6', '12', '16'. */
	certification?: string;
	/** Suitable for kids profiles. Undefined = unknown (treated as not kids-safe). */
	kidsSafe?: boolean;
	/** Newest addedAt across merged entries (epoch ms). */
	addedAt: number;
	/** 0..100 popularity used for "Populair"/"Trending" rows. */
	popularity: number;
	/** Movies: all playable versions. Series: empty (see seasons). */
	variants: StreamVariant[];
	/** Series only. Undefined = not loaded yet (Xtream lazy load). */
	seasons?: Season[];
	/** Union of audio languages across all variants/episodes. */
	languages: LangCode[];
	subtitleLanguages: LangCode[];
	qualities: Quality[];
	sourceIds: string[];
	/** For lazy series: which raw series were merged (to load episodes per source). */
	rawRefs: { sourceId: string; providerId: string; langs: LangCode[] }[];
}

export interface Channel {
	id: string;
	name: string;
	logoUrl?: string;
	group: string;
	number?: number;
	/** XMLTV id used to look up programmes. */
	epgId?: string;
	languages: LangCode[];
	variants: StreamVariant[];
}

export interface Catalog {
	titles: Title[];
	channels: Channel[];
	/** Programmes grouped by EpgProgramme.channelId, sorted by start. */
	epg: Record<string, EpgProgramme[]>;
	builtAt: number;
}

// ---------------------------------------------------------------------------
// Profiles & personal data
// ---------------------------------------------------------------------------

export type HomeRowId =
	| 'continue'
	| 'favorites'
	| 'recommended'
	| 'recent'
	| 'popular-movies'
	| 'trending-series'
	| 'live'
	| 'genres';

export interface HomeRowConfig {
	id: HomeRowId;
	visible: boolean;
}

export interface Profile {
	id: string;
	name: string;
	/** Avatar preset id (see components/Avatar). */
	avatar: string;
	isKids: boolean;
	/** SHA-256 hex of the PIN (required to leave kids mode / open a locked profile). */
	pinHash?: string;
	/** Preferred audio languages in order; first available wins. */
	audioLangs: LangCode[];
	subtitleLangs: LangCode[];
	/** Show subtitles by default. */
	subtitlesOn: boolean;
	uiLang: 'nl' | 'en';
	createdAt: number;
}

export interface WatchProgress {
	titleId: string;
	episodeId?: string;
	variantId: string;
	positionSec: number;
	durationSec: number;
	updatedAt: number;
}

export interface HistoryEntry {
	titleId: string;
	episodeId?: string;
	at: number;
}

export interface ProfileData {
	favorites: string[];
	favoriteChannels: string[];
	/** Keyed by progressKey(titleId, episodeId). */
	progress: Record<string, WatchProgress>;
	history: HistoryEntry[];
	homeRows: HomeRowConfig[];
	lastChannelId?: string;
	updatedAt: number;
}

export interface AppSettings {
	/** CSS color for the accent. */
	accent: string;
	tmdbApiKey?: string;
	syncServerUrl?: string;
	syncToken?: string;
	autoplayNext: boolean;
	reduceMotion: boolean;
	updatedAt: number;
}
