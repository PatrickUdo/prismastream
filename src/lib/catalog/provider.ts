// CatalogProvider: the one API the pages use to read the catalog, in both modes.
//
//   LocalProvider   demo + local sources, merged on the device (#lib/stores/catalog.svelte.ts)
//   RemoteProvider  the PrismaStream backend (docs/BACKEND.md) plus a small LRU cache
//
// Every list is made of TitleCards (a full Title is a valid TitleCard too); only `title(id)`
// returns the full Title with variants (play urls in remote mode) and seasons.
import type {
	Channel,
	ChannelCard,
	EpgProgramme,
	LangCode,
	NowNext,
	Title,
	TitleCard
} from '#lib/types.ts';
import type { TitleSort } from '#lib/backend/types.ts';

export type { TitleSort };

export interface GenreFacet {
	/** Value for the `genre` filter (remote: the server slug; local: the canonical name). */
	slug: string;
	/** Display name (canonical Dutch genre name, as in the local catalog). */
	name: string;
	count?: number;
}

export interface LanguageFacet {
	code: LangCode;
	count?: number;
}

export interface Facets {
	genres: GenreFacet[];
	languages: LanguageFacet[];
}

export interface HomeData {
	featured: TitleCard[];
	recent: TitleCard[];
	popularMovies: TitleCard[];
	trendingSeries: TitleCard[];
	genres: GenreFacet[];
	live: ChannelCard[];
}

export interface TitleQuery {
	kind?: 'movie' | 'series';
	genre?: string;
	lang?: LangCode;
	sort?: TitleSort;
	kids?: boolean;
	limit?: number;
	cursor?: string;
}

export interface TitlePage {
	items: TitleCard[];
	nextCursor?: string;
	total: number;
}

export type TitleDetail = Title & { similar: TitleCard[] };

export interface TitleHitView {
	title: TitleCard;
	score: number;
	aka?: string;
}

export interface SearchView {
	query: string;
	total: number;
	movies: TitleHitView[];
	series: TitleHitView[];
	people: { name: string; profileUrl?: string; titles: TitleCard[]; score: number }[];
	channels: { channel: ChannelCard; score: number }[];
	genres: { genre: string; slug: string; movies: number; series: number; score: number }[];
}

export interface CatalogCounts {
	titles: number;
	movies: number;
	series: number;
	channels: number;
}

export interface CatalogProvider {
	readonly kind: 'local' | 'remote';
	home(opts: { kids: boolean; limit?: number }, signal?: AbortSignal): Promise<HomeData>;
	facets(opts: { kind?: 'movie' | 'series'; kids: boolean }, signal?: AbortSignal): Promise<Facets>;
	titles(q: TitleQuery, signal?: AbortSignal): Promise<TitlePage>;
	/** Cards for ids, in the order of `ids`; unknown ids are left out. */
	cards(ids: string[], opts: { kids: boolean }, signal?: AbortSignal): Promise<TitleCard[]>;
	/** Full title (variants, seasons) plus similar titles; null when it does not exist. */
	title(
		id: string,
		opts?: { similar?: boolean },
		signal?: AbortSignal
	): Promise<TitleDetail | null>;
	search(
		q: string,
		opts: { kids: boolean; limit?: number },
		signal?: AbortSignal
	): Promise<SearchView>;
	recommend(
		input: { history: string[]; favorites: string[]; kids: boolean; limit?: number },
		signal?: AbortSignal
	): Promise<TitleCard[]>;
	channels(opts: { kids: boolean }, signal?: AbortSignal): Promise<Channel[]>;
	epg(
		epgIds: string[],
		from: number,
		to: number,
		signal?: AbortSignal
	): Promise<Record<string, EpgProgramme[]>>;
	nowNext(channelIds: string[], signal?: AbortSignal): Promise<Record<string, NowNext>>;
}

export const emptySearch = (query = ''): SearchView => ({
	query,
	total: 0,
	movies: [],
	series: [],
	people: [],
	channels: [],
	genres: []
});

export const emptyHome = (): HomeData => ({
	featured: [],
	recent: [],
	popularMovies: [],
	trendingSeries: [],
	genres: [],
	live: []
});
