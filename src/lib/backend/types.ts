// Wire types of the PrismaStream backend catalog API (docs/BACKEND.md, API v1).
import type {
	Channel,
	ChannelCard,
	EpgProgramme,
	LangCode,
	NowNext,
	Title,
	TitleCard
} from '#lib/types.ts';

export type CatalogBuildStatus = 'empty' | 'building' | 'ready' | 'error';

export interface GenreCount {
	slug: string;
	name: string;
	count: number;
}

export interface CatalogMeta {
	builtAt: number;
	status: CatalogBuildStatus;
	/** 0..1 while building (when known). */
	progress?: number;
	error?: string;
	counts: { movies: number; series: number; channels: number; programmes: number };
	genres: GenreCount[];
	languages: { lang: LangCode; count: number }[];
	groups: { name: string; count: number }[];
}

export interface HomeResponse {
	featured: TitleCard[];
	recent: TitleCard[];
	popularMovies: TitleCard[];
	trendingSeries: TitleCard[];
	genres: GenreCount[];
	live: ChannelCard[];
}

export type TitleSort = 'popular' | 'new' | 'az' | 'year';

export interface TitlesQuery {
	kind?: 'movie' | 'series';
	genre?: string;
	lang?: LangCode;
	sort?: TitleSort;
	kids?: boolean;
	limit?: number;
	cursor?: string;
}

export interface TitlesResponse {
	items: TitleCard[];
	nextCursor?: string;
	total: number;
}

export type TitleDetail = Title & { similar?: TitleCard[] };

export interface SearchResponse {
	query: string;
	total: number;
	movies: TitleCard[];
	series: TitleCard[];
	people: { name: string; profileUrl?: string; titles: TitleCard[] }[];
	channels: ChannelCard[];
	genres: { slug: string; name: string; count?: number; movies?: number; series?: number }[];
	/** Title id → the alternative title that matched. */
	akas: Record<string, string>;
}

export interface RecommendRequest {
	history: string[];
	favorites: string[];
	limit?: number;
	kids?: boolean;
}

export type EpgResponse = Record<string, EpgProgramme[]>;
export type NowNextResponse = Record<string, NowNext>;

export interface ChannelsResponse {
	items: Channel[];
}

// ---- sources ---------------------------------------------------------------------

export type RemoteSourceType = 'xtream' | 'm3u' | 'sample';

export interface RemoteSourceStats {
	movies?: number;
	series?: number;
	channels?: number;
	programmes?: number;
}

export interface RemoteSource {
	id: string;
	type: RemoteSourceType;
	name: string;
	enabled: boolean;
	serverUrl?: string;
	username?: string;
	/** Masked by the server (no credentials). */
	playlistUrl?: string;
	epgUrl?: string;
	addedAt: number;
	lastSyncAt?: number;
	lastError?: string;
	stats?: RemoteSourceStats;
	account?: { status?: string; expiresAt?: number; maxConnections?: number; [k: string]: unknown };
}

export interface SourceInputBody {
	type: 'xtream' | 'm3u';
	name?: string;
	serverUrl?: string;
	username?: string;
	password?: string;
	playlistUrl?: string;
	epgUrl?: string;
}

export interface SourcePatchBody {
	name?: string;
	enabled?: boolean;
	serverUrl?: string;
	username?: string;
	password?: string;
	playlistUrl?: string;
	epgUrl?: string;
}

export type SourceTestResponse =
	| {
			ok: true;
			movies: number;
			series: number;
			channels: number;
			expiresAt?: number;
			status?: string;
			warnings?: string[];
	  }
	| { ok: false; code: string; message: string };

export interface RefreshResponse {
	status?: CatalogBuildStatus;
	queued?: boolean;
	[k: string]: unknown;
}
