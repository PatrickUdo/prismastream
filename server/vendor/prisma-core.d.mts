// Type declarations for prisma-core.mjs (built from src/core/node.ts by `npm run build:core:node`
// in the repo root). Hand-written: keep in sync with the exports of src/core/node.ts.
// Only used by `tsc` (npm run typecheck); the runtime image contains just the .mjs.
import type {
	Catalog,
	Channel,
	EpgProgramme,
	HistoryEntry,
	LangCode,
	ProfileData,
	Quality,
	RawCatalog,
	RawChannel,
	RawEpisode,
	RawMovie,
	RawSeries,
	SampleSource,
	StreamVariant,
	Title
} from '../../src/lib/types.ts';

export type {
	Catalog,
	Channel,
	EpgProgramme,
	HistoryEntry,
	LangCode,
	Quality,
	RawCatalog,
	RawChannel,
	RawEpisode,
	RawMovie,
	RawSeries,
	StreamVariant,
	Title
};

export const CORE_NODE_VERSION: string;

// ---- TMDB ---------------------------------------------------------------------------------

export type TmdbKind = 'movie' | 'series';
export interface TmdbMeta {
	id: number;
	kind: TmdbKind;
	title: string;
	lang: LangCode;
	fetchedAt: number;
	altTitles: { title: string; lang?: LangCode }[];
	[k: string]: unknown;
}
export interface TmdbIndex {
	byKey: Record<string, number>;
	meta: Record<string, TmdbMeta>;
}
export interface TmdbCache {
	get(key: string): Promise<{ at: number; v: unknown } | undefined>;
	set(key: string, value: { at: number; v: unknown }): Promise<void>;
}
export class TmdbRateLimiter {
	constructor(max?: number, windowMs?: number);
	take(): Promise<void>;
}
export class TmdbClient {
	constructor(
		apiKey: string,
		opts?: { fetch?: typeof fetch; limiter?: TmdbRateLimiter; cache?: TmdbCache; ttl?: number; missTtl?: number }
	);
	search(kind: TmdbKind, query: string, year?: number, lang?: LangCode): Promise<number | null>;
	details(kind: TmdbKind, id: number, lang?: LangCode): Promise<TmdbMeta>;
}
export class TmdbError extends Error {
	readonly status?: number;
}
export function tmdbLookupKey(kind: TmdbKind, key: string, year?: number): string;
export function tmdbMetaKey(kind: TmdbKind, id: number): string;
export function emptyIndex(): TmdbIndex;
export function indexMeta(index: TmdbIndex, meta: TmdbMeta): void;
export function enrichTitles(opts: {
	apiKey: string;
	lang: LangCode;
	titles: Title[];
	index: TmdbIndex;
	batchSize?: number;
	maxTitles?: number;
	signal?: AbortSignal;
	skipSource?: (sourceId: string) => boolean;
	client?: TmdbClient;
	onBatch?: (index: TmdbIndex, changed: boolean) => void | Promise<void>;
}): Promise<{ searched: number; fetched: number }>;

// ---- Merge engine ---------------------------------------------------------------------------

export interface BuildOptions {
	sourceNames?: Record<string, string>;
	sourceLangs?: Record<string, LangCode>;
	preferLang?: LangCode;
	tmdb?: TmdbIndex;
	now?: number;
}
export interface ParsedTitle {
	cleanTitle: string;
	langs: LangCode[];
	subLangs: LangCode[];
	quality: Quality;
	year?: number;
	[k: string]: unknown;
}
export interface AnalyzedItem {
	raw: RawMovie | RawSeries;
	parsed: ParsedTitle;
	audio: LangCode[];
	subs: LangCode[];
	quality: Quality;
	vo: boolean;
	year?: number;
	tmdbId?: number;
	imdbId?: string;
	keys: string[];
	weakKeys: string[];
}
export interface LangPrefs {
	audioLangs: LangCode[];
	subtitleLangs: LangCode[];
	subtitlesOn: boolean;
}
export interface EpisodeSource {
	sourceId: string;
	audio: LangCode[];
	subs: LangCode[];
	quality: Quality;
	seriesTitle: string;
	episodes: RawEpisode[];
}

export function buildCatalog(raws: RawCatalog[], opts?: BuildOptions): Catalog;
export function analyzeRaw(raw: RawMovie | RawSeries, opts?: BuildOptions): AnalyzedItem;
export function withSeasons(title: Title, seasons: Title['seasons']): Title;
export function isKidsSafe(genres: string[], certification?: string): boolean;
export function popularityScore(
	t: Pick<Title, 'rating' | 'sourceIds' | 'languages' | 'addedAt' | 'year'>,
	versions: number,
	now: number
): number;
export function pickVariant(
	variants: StreamVariant[],
	prefs: LangPrefs,
	opts?: { originalLang?: LangCode; lastGoodSourceId?: string; failedSourceIds?: string[] }
): StreamVariant | undefined;
export function groupVariantsByLanguage(
	variants: StreamVariant[],
	prefs?: Pick<LangPrefs, 'audioLangs'>
): { lang: LangCode; variants: StreamVariant[] }[];
export function summarizeLanguages(
	title: Pick<Title, 'languages'>,
	max?: number,
	prefs?: Pick<LangPrefs, 'audioLangs'>
): string;
export function normalizeGenres(list: string[] | undefined): string[];
export function genreSlug(name: string): string | undefined;
export function slugify(s: string): string;
export function foldText(s: string): string;
export function parseTitle(raw: string): ParsedTitle;
export function mergeSeasons(
	titleId: string,
	sources: EpisodeSource[],
	prefer: LangCode,
	existing?: Title['seasons']
): NonNullable<Title['seasons']>;
export function buildChannels(
	raws: RawCatalog[],
	epg: Record<string, EpgProgramme[]>,
	sourceLangs?: Record<string, LangCode>
): Channel[];
export function groupEpg(raws: RawCatalog[]): Record<string, EpgProgramme[]>;
export function displayTitleFor(
	title: Pick<Title, 'title' | 'originalTitle'> & { altTitles?: Title['altTitles'] },
	prefs?: { uiLang?: 'nl' | 'en'; audioLangs?: LangCode[] } | null,
	locale?: LangCode
): string;
export function localizedTitle(
	title: Pick<Title, 'title' | 'originalTitle'> & { altTitles?: Title['altTitles'] },
	langs: readonly LangCode[]
): string;

// ---- Providers ------------------------------------------------------------------------------

export interface M3UResult {
	epgUrls: string[];
	movies: RawMovie[];
	series: RawSeries[];
	channels: RawChannel[];
	entryCount: number;
}
export class M3UParser {
	constructor(opts: { sourceId: string });
	push(chunk: string): void;
	end(): M3UResult;
}
export function parseM3U(text: string, opts: { sourceId: string }): M3UResult;
export function looksLikeM3U(text: string): boolean;

export interface XmltvOptions {
	from?: number;
	to?: number;
	channelIds?: Set<string>;
}
export interface XmltvResult {
	programmes: EpgProgramme[];
	channels: { id: string; displayName?: string; icon?: string }[];
	errors: number;
}
export function createXmltvCollector(opts?: XmltvOptions): {
	write(chunk: string): void;
	finish(): XmltvResult;
};
export function parseXmltvText(text: string, opts?: XmltvOptions): XmltvResult;
export function parseXmltvTime(v: string | undefined): number;
export function isGzip(bytes: Uint8Array): boolean;

export interface XtreamCredentials {
	serverUrl: string;
	username: string;
	password: string;
}
export interface XtreamAccount {
	status: string;
	expiresAt?: number;
	maxConnections?: number;
	activeConnections?: number;
	isTrial: boolean;
	createdAt?: number;
	timezone?: string;
	allowedFormats?: string[];
}
type Json = Record<string, unknown>;
export function asArray(v: unknown): Json[];
export function categoryMap(cats: unknown): Map<string, string>;
export function mapVodStream(
	item: Json,
	ctx: { sourceId: string; creds: XtreamCredentials; cats: Map<string, string> }
): RawMovie | undefined;
export function mapSeries(
	item: Json,
	ctx: { sourceId: string; cats: Map<string, string> }
): RawSeries | undefined;
export function mapLiveStream(
	item: Json,
	ctx: { sourceId: string; creds: XtreamCredentials; cats: Map<string, string> }
): RawChannel | undefined;
export function mapSeriesInfo(
	data: unknown,
	ctx: { creds: XtreamCredentials }
): { info: Partial<RawSeries>; episodes: RawEpisode[] };
export function mapShortEpg(item: Json, channelId: string): EpgProgramme | undefined;
export function parseAccount(data: unknown): XtreamAccount;
export function normalizeServerUrl(input: string): string;
export function xmltvUrl(c: XtreamCredentials): string;
export function liveTsUrl(url: string): string | undefined;

export type HttpErrorCode =
	| 'auth'
	| 'expired'
	| 'unreachable'
	| 'timeout'
	| 'invalid'
	| 'http'
	| 'aborted';
export class HttpError extends Error {
	readonly code: HttpErrorCode;
	readonly status?: number;
	readonly url?: string;
	constructor(code: HttpErrorCode, message: string, opts?: { status?: number; url?: string });
}
export function redactUrl(url: string, secrets?: (string | undefined | null)[]): string;
export function redactText(text: string, secrets?: (string | undefined | null)[]): string;
export function redactSecrets(text: string, secrets?: (string | undefined | null)[]): string;
export function secretsFromUrl(url: string): string[];
export function urlHasSecrets(url: string): boolean;
export interface Masker {
	mask(s: string): string;
	unmask(s: string): string;
	readonly noop: boolean;
}
export function createMasker(secrets: (string | undefined | null)[]): Masker;

// ---- Search, recommendations, demo data ------------------------------------------------------

export interface SearchLimits {
	movies?: number;
	series?: number;
	people?: number;
	channels?: number;
	genres?: number;
}
export interface SearchResults {
	query: string;
	movies: { title: Title; score: number; aka?: string }[];
	series: { title: Title; score: number; aka?: string }[];
	people: { name: string; profileUrl?: string; titles: Title[]; score: number }[];
	channels: { channel: Channel; score: number }[];
	genres: { genre: string; movies: number; series: number; score: number }[];
	total: number;
}
export class SearchIndex {
	constructor(titles: Title[], channels: Channel[]);
	readonly titles: Title[];
	readonly channels: Channel[];
	readonly size: number;
	search(query: string, limits?: SearchLimits): SearchResults;
}
export function fold(s: string): string;
export function tokenize(s: string): string[];

type Signals = Pick<ProfileData, 'favorites' | 'history' | 'progress'>;
export function recommend(titles: Title[], signals: Signals, limit?: number): Title[];
export function similarTitles(title: Title, titles: Title[], limit?: number): Title[];
export function popular(titles: Title[], kind: 'movie' | 'series', limit?: number): Title[];
export function trending(
	titles: Title[],
	kind: 'movie' | 'series',
	limit?: number,
	now?: number
): Title[];
export function recent(titles: Title[], limit?: number): Title[];
export function featured(titles: Title[], n?: number): Title[];
export function genreCounts(
	titles: Title[],
	kind?: 'movie' | 'series'
): { genre: string; count: number }[];
export function languageCounts(titles: Title[]): { code: string; count: number }[];

export function sampleCatalogs(now?: number): RawCatalog[];
export const SAMPLE_SOURCE: SampleSource;
export const SAMPLE_EXTRA_SOURCES: SampleSource[];
export const SAMPLE_SOURCE_IDS: string[];
export const SAMPLE_SOURCE_NAMES: Record<string, string>;
export function isSampleSourceId(id: string): boolean;

// ---- Server helpers -------------------------------------------------------------------------

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
export const CARD_MAX_ALT_TITLES: number;
export const CARD_MAX_OVERVIEW: number;
export function toTitleCard(t: Title): TitleCard;
export function toChannelCard(c: Channel): ChannelCard;
export function isKidsChannelGroup(group: string | undefined): boolean;
export interface SeriesEpisodeInput {
	sourceId: string;
	audio: LangCode[];
	subs: LangCode[];
	quality: Quality;
	seriesTitle: string;
	episodes: RawEpisode[];
	info?: Partial<RawSeries>;
}
export function mergeSeriesEpisodes(
	title: Title,
	inputs: SeriesEpisodeInput[],
	preferLang?: LangCode
): Title;
