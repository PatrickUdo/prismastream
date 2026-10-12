// PrismaCore: the shared TypeScript core for the native Apple TV app (JavaScriptCore).
// Contract: docs/TVOS.md. Built with `npm run build:core` into one IIFE
// (tvos/PrismaStream/Resources/prisma-core.js) that defines the global `PrismaCore`.
//
// Rules for this file:
// - Every argument that carries data is a JSON string (a plain object is accepted too);
//   every return value is a JSON string, except version(), summarizeLanguages() and
//   displayTitle(), which return plain strings.
// - Synchronous only: no promises, timers, fetch, URL, TextDecoder or crypto.
// - Errors are thrown as Error; Swift catches them via JSContext.exceptionHandler.
// - Credentials in xtreamMap's ctx are only used to build stream urls in memory; nothing
//   is logged.
import './polyfills.ts';
import type {
	Catalog,
	Channel,
	EpgProgramme,
	HistoryEntry,
	LangCode,
	RawCatalog,
	RawEpisode,
	RawSeries,
	StreamVariant,
	Title
} from '#lib/types.ts';
import {
	analyzeRaw,
	buildCatalog as buildMergedCatalog,
	groupVariantsByLanguage as groupByLanguage,
	mergeSeasons as mergeEpisodeSeasons,
	normalizeGenres,
	pickVariant as pickBestVariant,
	summarizeLanguages as summarize,
	withSeasons,
	type BuildOptions,
	type LangPrefs
} from '#lib/merge/index.ts';
import type { EpisodeSource } from '#lib/merge/series.ts';
import { displayTitleFor, type TitleLangPrefs } from '#lib/merge/display.ts';
import { M3UParser } from '#lib/providers/m3u.ts';
import { parseXmltvText } from '#lib/providers/xmltv.ts';
import {
	asArray,
	categoryMap,
	mapLiveStream,
	mapSeries,
	mapSeriesInfo,
	mapVodStream,
	normalizeServerUrl,
	parseAccount,
	type XtreamCredentials
} from '#lib/providers/xtream-map.ts';
import { SearchIndex } from '#lib/search/index.ts';
import { recommend as recommendTitles } from '#lib/recommend.ts';
import {
	SAMPLE_EXTRA_SOURCES,
	SAMPLE_SOURCE,
	SAMPLE_SOURCE_NAMES,
	sampleCatalogs as buildSampleCatalogs
} from '#lib/sample/index.ts';

/** Version of the core API (bump on contract changes). */
export const CORE_VERSION = '1.0.0';

// ---- Module state (lives as long as the JSContext) -----------------------------------------

let lastRaws: RawCatalog[] = [];
let lastCatalog: Catalog | null = null;
let lastPreferLang: LangCode = 'nl';
let index: { catalog: Catalog; index: SearchIndex } | null = null;

// ---- Helpers --------------------------------------------------------------------------------

/** JSON string → value; non-strings (already parsed objects) pass through. */
function arg<T>(value: unknown, name: string): T {
	if (typeof value !== 'string') return value as T;
	try {
		return JSON.parse(value) as T;
	} catch {
		throw new Error(`PrismaCore: argument "${name}" is not valid JSON`);
	}
}

/** Optional JSON argument: undefined, null, '' and 'null' all mean "not given". */
function optArg<T>(value: unknown, name: string): T | undefined {
	if (value === undefined || value === null || value === '' || value === 'null') return undefined;
	return arg<T>(value, name) ?? undefined;
}

function out(value: unknown): string {
	return JSON.stringify(value === undefined ? null : value);
}

function requireArray<T>(value: unknown, name: string): T[] {
	if (!Array.isArray(value)) throw new Error(`PrismaCore: "${name}" must be an array`);
	return value as T[];
}

function requireCatalog(value: Catalog | undefined | null, fn: string): Catalog {
	const catalog = value ?? lastCatalog;
	if (!catalog || !Array.isArray(catalog.titles))
		throw new Error(`PrismaCore.${fn}: no catalog given and none built yet`);
	return catalog;
}

/** Title without seasons (episodes make search payloads heavy; ids are enough to load them). */
function light(t: Title): Title {
	if (t.seasons === undefined) return t;
	const copy = { ...t };
	delete copy.seasons;
	return copy;
}

// ---- Contract -------------------------------------------------------------------------------

/** Core API version, plain string. */
export function version(): string {
	return CORE_VERSION;
}

/** The three fictional demo sources as RawCatalog[] (JSON). */
export function sampleCatalogs(): string {
	return out(buildSampleCatalogs(Date.now()));
}

/** `{ id, name, type: 'sample' }[]` for the demo sources (JSON). */
export function sampleSources(): string {
	return out(
		[SAMPLE_SOURCE, ...SAMPLE_EXTRA_SOURCES].map((s) => ({ id: s.id, name: s.name, type: s.type }))
	);
}

export interface CoreBuildOptions {
	sourceNames?: Record<string, string>;
	sourceLangs?: Record<string, LangCode>;
	preferLang?: LangCode;
	/** Clock (epoch ms) for popularity/recency; default now. */
	now?: number;
}

/** RawCatalog[] + options → merged Catalog (JSON). Remembers raws and catalog for later calls. */
export function buildCatalog(raws: unknown, opts?: unknown): string {
	const list = requireArray<RawCatalog>(arg(raws, 'raws'), 'raws');
	const o = optArg<CoreBuildOptions>(opts, 'opts') ?? {};
	const build: BuildOptions = {
		sourceNames: { ...SAMPLE_SOURCE_NAMES, ...(o.sourceNames ?? {}) },
		sourceLangs: o.sourceLangs,
		preferLang: o.preferLang ?? 'nl',
		now: typeof o.now === 'number' ? o.now : undefined
	};
	const catalog = buildMergedCatalog(list, build);
	lastRaws = list;
	lastCatalog = catalog;
	lastPreferLang = build.preferLang ?? 'nl';
	index = null; // stale: rebuild via searchIndex()
	return out(catalog);
}

/** Episodes of one raw series (one source), as loaded by Swift (Xtream get_series_info). */
export interface CoreEpisodeSource {
	sourceId: string;
	providerId: string;
	/** Audio languages of this version (Title.rawRefs[].langs). */
	langs?: LangCode[];
	episodes: RawEpisode[];
	/** Optional: series metadata from xtreamMap('seriesDetails') to fill gaps in the title. */
	info?: Partial<RawSeries>;
	/** Optional overrides when the raw series is not in the last buildCatalog() input. */
	subtitleLangs?: LangCode[];
	quality?: StreamVariant['quality'];
	seriesTitle?: string;
}

/**
 * Title + episodes per source → Title with merged `seasons` (JSON). Existing seasons are kept
 * and extended; languages/qualities are recomputed. Same logic as the web catalog store.
 */
export function mergeSeasons(title: unknown, rawEpisodesBySource: unknown, opts?: unknown): string {
	const t = arg<Title>(title, 'title');
	if (!t || typeof t !== 'object' || !t.id) throw new Error('PrismaCore.mergeSeasons: no title');
	const sources = requireArray<CoreEpisodeSource>(
		arg(rawEpisodesBySource, 'rawEpisodesBySource'),
		'rawEpisodesBySource'
	);
	const o = optArg<{ preferLang?: LangCode }>(opts, 'opts') ?? {};
	const prefer = o.preferLang ?? lastPreferLang;

	const rawSeries = new Map<string, RawSeries>();
	for (const raw of lastRaws)
		for (const s of raw.series ?? []) rawSeries.set(`${s.sourceId}\u0001${s.providerId}`, s);

	const inputs: EpisodeSource[] = [];
	const info: Partial<RawSeries> = {};
	for (const src of sources) {
		for (const [k, v] of Object.entries(src.info ?? {}))
			if (v != null && v !== '' && info[k as keyof RawSeries] == null)
				(info as Record<string, unknown>)[k] = v;
		const episodes = Array.isArray(src.episodes) ? src.episodes : [];
		if (!episodes.length) continue;
		const raw = rawSeries.get(`${src.sourceId}\u0001${src.providerId}`);
		const analyzed = raw ? analyzeRaw(raw, { preferLang: prefer }) : undefined;
		const ref = t.rawRefs?.find(
			(r) => r.sourceId === src.sourceId && r.providerId === src.providerId
		);
		const langs = src.langs?.length ? src.langs : ref?.langs?.length ? ref.langs : ['und'];
		inputs.push({
			sourceId: src.sourceId,
			audio: analyzed?.audio ?? langs,
			subs: analyzed?.subs ?? src.subtitleLangs ?? [],
			quality: analyzed?.quality ?? src.quality ?? 'unknown',
			seriesTitle: analyzed?.parsed.cleanTitle ?? src.seriesTitle ?? t.title,
			episodes
		});
	}

	const seasons = inputs.length
		? mergeEpisodeSeasons(t.id, inputs, prefer, t.seasons)
		: (t.seasons ?? []);
	const updated: Title = {
		...withSeasons(t, seasons),
		overview: t.overview ?? info.plot,
		posterUrl: t.posterUrl ?? info.posterUrl,
		backdropUrl: t.backdropUrl ?? info.backdropUrl,
		trailerUrl: t.trailerUrl ?? info.trailerUrl,
		rating: t.rating ?? info.rating,
		director: t.director ?? info.director,
		releaseDate: t.releaseDate ?? info.releaseDate,
		genres: t.genres?.length ? t.genres : normalizeGenres(info.genres),
		cast: t.cast?.length ? t.cast : (info.cast ?? []).map((name) => ({ name }))
	};
	if (lastCatalog) {
		const i = lastCatalog.titles.findIndex((x) => x.id === updated.id);
		if (i !== -1) lastCatalog.titles[i] = updated;
	}
	return out(updated);
}

/** M3U text → `{ catalog: RawCatalog, epgUrl?, epgUrls, entryCount }` (JSON). */
export function parseM3U(text: string, sourceId: string): string {
	if (typeof text !== 'string') throw new Error('PrismaCore.parseM3U: text must be a string');
	if (!sourceId) throw new Error('PrismaCore.parseM3U: sourceId is required');
	const p = new M3UParser({ sourceId });
	p.push(text);
	const r = p.end();
	if (!r.entryCount) throw new Error('The playlist contains no entries (is this an M3U file?)');
	const catalog: RawCatalog = {
		sourceId,
		movies: r.movies,
		series: r.series,
		channels: r.channels,
		epg: [],
		fetchedAt: Date.now()
	};
	return out({ catalog, epgUrl: r.epgUrls[0], epgUrls: r.epgUrls, entryCount: r.entryCount });
}

export type XtreamKind =
	| 'vod'
	| 'series'
	| 'live'
	| 'seriesInfo'
	| 'seriesDetails'
	| 'vodCategories'
	| 'seriesCategories'
	| 'liveCategories'
	| 'account';

export interface XtreamContext {
	sourceId: string;
	serverUrl: string;
	username: string;
	password: string;
	/** category_id → name (output of a *Categories call), or the raw category list. */
	categories?: Record<string, string> | unknown[];
	seriesId?: string;
}

function categoriesOf(v: XtreamContext['categories']): Map<string, string> {
	if (!v) return new Map();
	if (Array.isArray(v)) return categoryMap(v);
	const m = new Map<string, string>();
	for (const [k, name] of Object.entries(v)) if (typeof name === 'string') m.set(k, name);
	return m;
}

function present<T>(x: T | undefined): x is T {
	return x !== undefined;
}

/** Raw Xtream API JSON → Raw* shapes, identical to the web sources module (JSON). */
export function xtreamMap(kind: string, json: unknown, ctx?: unknown): string {
	const data = arg<unknown>(json, 'json');
	const c = optArg<XtreamContext>(ctx, 'ctx') ?? ({} as XtreamContext);
	const needCreds =
		kind === 'vod' || kind === 'live' || kind === 'seriesInfo' || kind === 'seriesDetails';
	const needSource = kind === 'vod' || kind === 'live' || kind === 'series';
	if (needSource && !c.sourceId) throw new Error(`PrismaCore.xtreamMap(${kind}): ctx.sourceId`);
	if (needCreds && (!c.serverUrl || c.username == null || c.password == null))
		throw new Error(`PrismaCore.xtreamMap(${kind}): ctx needs serverUrl, username, password`);
	const creds: XtreamCredentials = {
		serverUrl: c.serverUrl ? normalizeServerUrl(String(c.serverUrl)) : '',
		username: String(c.username ?? ''),
		password: String(c.password ?? '')
	};
	switch (kind) {
		case 'vod': {
			const m = { sourceId: c.sourceId, creds, cats: categoriesOf(c.categories) };
			return out(
				asArray(data)
					.map((i) => mapVodStream(i, m))
					.filter(present)
			);
		}
		case 'series': {
			const m = { sourceId: c.sourceId, cats: categoriesOf(c.categories) };
			return out(
				asArray(data)
					.map((i) => mapSeries(i, m))
					.filter(present)
			);
		}
		case 'live': {
			const m = { sourceId: c.sourceId, creds, cats: categoriesOf(c.categories) };
			return out(
				asArray(data)
					.map((i) => mapLiveStream(i, m))
					.filter(present)
			);
		}
		case 'seriesInfo':
			return out(mapSeriesInfo(data, { creds }).episodes);
		case 'seriesDetails':
			return out(mapSeriesInfo(data, { creds }));
		case 'vodCategories':
		case 'seriesCategories':
		case 'liveCategories':
			return out(Object.fromEntries(categoryMap(data)));
		case 'account':
			return out(parseAccount(data));
		default:
			throw new Error(`PrismaCore.xtreamMap: unknown kind "${kind}"`);
	}
}

export interface CoreXmltvOptions {
	/** Keep programmes ending after this (epoch ms). Default: now - 6 h. */
	windowStart?: number;
	/** Keep programmes starting before this (epoch ms). Default: now + 48 h. */
	windowEnd?: number;
	/** Only these XMLTV channel ids (case-sensitive). */
	channelIds?: string[];
}

/** XMLTV text → EpgProgramme[] sorted by channel and start (JSON). Synchronous. */
export function parseXmltv(text: string, opts?: unknown): string {
	if (typeof text !== 'string') throw new Error('PrismaCore.parseXmltv: text must be a string');
	const o = optArg<CoreXmltvOptions>(opts, 'opts') ?? {};
	const r = parseXmltvText(text, {
		from: typeof o.windowStart === 'number' ? o.windowStart : undefined,
		to: typeof o.windowEnd === 'number' ? o.windowEnd : undefined,
		channelIds: o.channelIds?.length ? new Set(o.channelIds) : undefined
	});
	return out(r.programmes satisfies EpgProgramme[]);
}

export interface CorePickPrefs extends LangPrefs {
	lastGoodSourceId?: string;
	failedSourceIds?: string[];
}

/** Best variant for the language preferences, or null (JSON). Title supplies originalLang. */
export function pickVariant(variants: unknown, prefs: unknown, title?: unknown): string {
	const list = requireArray<StreamVariant>(arg(variants, 'variants'), 'variants');
	const p = arg<CorePickPrefs>(prefs, 'prefs') ?? ({} as CorePickPrefs);
	const t = optArg<Partial<Title>>(title, 'title');
	const v = pickBestVariant(
		list,
		{
			audioLangs: p.audioLangs ?? [],
			subtitleLangs: p.subtitleLangs ?? [],
			subtitlesOn: !!p.subtitlesOn
		},
		{
			originalLang: t?.originalLang,
			lastGoodSourceId: p.lastGoodSourceId,
			failedSourceIds: p.failedSourceIds
		}
	);
	return out(v ?? null);
}

/** `{ lang, variants }[]`: preferred languages first, then English, then by count (JSON). */
export function groupVariantsByLanguage(variants: unknown, prefs?: unknown): string {
	const list = requireArray<StreamVariant>(arg(variants, 'variants'), 'variants');
	const p = optArg<Pick<LangPrefs, 'audioLangs'>>(prefs, 'prefs');
	return out(groupByLanguage(list, p?.audioLangs ? { audioLangs: p.audioLangs } : undefined));
}

/** "NL · EN · DE +4" (plain string). Optional prefs `{ audioLangs }` and `max` (default 3). */
export function summarizeLanguages(title: unknown, prefs?: unknown, max?: number): string {
	const t = arg<Pick<Title, 'languages'>>(title, 'title');
	const p = optArg<Pick<LangPrefs, 'audioLangs'>>(prefs, 'prefs');
	return summarize(
		{ languages: Array.isArray(t?.languages) ? t.languages : [] },
		typeof max === 'number' && max > 0 ? max : 3,
		p?.audioLangs?.length ? { audioLangs: p.audioLangs } : undefined
	);
}

/** Title in the profile language (plain string), e.g. "Het Laatste Licht" for uiLang 'nl'. */
export function displayTitle(title: unknown, prefs?: unknown): string {
	const t = arg<Title>(title, 'title');
	if (!t || typeof t.title !== 'string') throw new Error('PrismaCore.displayTitle: no title');
	return displayTitleFor(t, optArg<Partial<TitleLangPrefs>>(prefs, 'prefs'));
}

/** Build the search index for a catalog (default: the last built one). Returns 'true'. */
export function searchIndex(catalog?: unknown): string {
	const c = requireCatalog(optArg<Catalog>(catalog, 'catalog'), 'searchIndex');
	index = { catalog: c, index: new SearchIndex(c.titles, c.channels ?? []) };
	return out(true);
}

export interface CoreSearchResults {
	query: string;
	total: number;
	movies: Title[];
	series: Title[];
	people: { name: string; profileUrl?: string; titles: Title[] }[];
	channels: Channel[];
	genres: string[];
	/** titleId → alternative title that matched ("Also known as"). */
	akas: Record<string, string>;
}

/** Search the indexed catalog. `limit` caps movies, series and channels (default 48/48/24). */
export function search(query: string, limit?: number): string {
	if (!index) {
		if (!lastCatalog) throw new Error('PrismaCore.search: call searchIndex(catalog) first');
		searchIndex();
	}
	const lim = typeof limit === 'number' && limit > 0 ? Math.floor(limit) : undefined;
	const r = index!.index.search(String(query ?? ''), {
		movies: lim,
		series: lim,
		channels: lim,
		people: lim ? Math.min(lim, 12) : undefined,
		genres: lim ? Math.min(lim, 8) : undefined
	});
	const akas: Record<string, string> = {};
	for (const h of [...r.movies, ...r.series]) if (h.aka) akas[h.title.id] = h.aka;
	const res: CoreSearchResults = {
		query: r.query,
		total: r.total,
		movies: r.movies.map((h) => light(h.title)),
		series: r.series.map((h) => light(h.title)),
		people: r.people.map((p) => ({
			name: p.name,
			...(p.profileUrl ? { profileUrl: p.profileUrl } : {}),
			titles: p.titles.map(light)
		})),
		channels: r.channels.map((h) => h.channel),
		genres: r.genres.map((g) => g.genre),
		akas
	};
	return out(res);
}

/**
 * Recommended title ids. `catalog` may be null (= last built catalog); `history` is
 * HistoryEntry[] or title ids (most recent first); `favorites` are title ids.
 */
export function recommend(
	catalog: unknown,
	history?: unknown,
	favorites?: unknown,
	limit?: number
): string {
	const c = requireCatalog(optArg<Catalog>(catalog, 'catalog'), 'recommend');
	const h = optArg<(HistoryEntry | string)[]>(history, 'history') ?? [];
	const f = optArg<string[]>(favorites, 'favorites') ?? [];
	const entries: HistoryEntry[] = (Array.isArray(h) ? h : [])
		.map((x, i) => (typeof x === 'string' ? { titleId: x, at: -i } : x))
		.filter((x): x is HistoryEntry => !!x && typeof x.titleId === 'string');
	const picked = recommendTitles(
		c.titles,
		{ favorites: Array.isArray(f) ? f : [], history: entries, progress: {} },
		typeof limit === 'number' && limit > 0 ? Math.floor(limit) : 24
	);
	return out(picked.map((t) => t.id));
}
