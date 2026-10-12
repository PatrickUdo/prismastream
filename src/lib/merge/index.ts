// Merge engine: RawCatalog[] (every source, language and quality) → one Catalog in which each
// real-world film or series appears exactly once, with all playable variants kept.
//
//   normalize.ts  title/category parsing, language + quality detection, match keys
//   match.ts      guarded union-find clustering (tmdb → imdb → title+year → …)
//   series.ts     season/episode merging across sources and languages
//   channels.ts   live channel merging and EPG grouping
//   pick.ts       variant choice for a profile (language → quality → last good source)
import type {
	Catalog,
	LangCode,
	Person,
	Quality,
	RawCatalog,
	RawMovie,
	RawSeries,
	StreamVariant,
	Title
} from '#lib/types.ts';
import { QUALITY_ORDER } from '#lib/lang.ts';
import type { TmdbIndex, TmdbMeta } from '#lib/tmdb/types.ts';
import { tmdbLookupKey, tmdbMetaKey } from '#lib/tmdb/types.ts';
import { clusterItems, type MatchItem } from './match.ts';
import {
	foldText,
	parseCategory,
	parsePerson,
	parseTitle,
	slugify,
	titleKeys,
	type ParsedTitle
} from './normalize.ts';
import { normalizeGenres } from './genres.ts';
import { mergeSeasons, type EpisodeSource } from './series.ts';
import { buildChannels, groupEpg } from './channels.ts';

export {
	pickVariant,
	groupVariantsByLanguage,
	bestSubtitle,
	summarizeLanguages,
	type LangPrefs
} from './pick.ts';
export { parseTitle, parseCategory, matchKey, foldText, slugify } from './normalize.ts';
export { normalizeGenre, normalizeGenres, genreSlug } from './genres.ts';
export { mergeSeasons } from './series.ts';
export { parseChannelName } from './channels.ts';

export interface BuildOptions {
	/** Source display names (informational; variant labels keep the raw provider title). */
	sourceNames?: Record<string, string>;
	/** Default audio language per source, used when title and category say nothing. */
	sourceLangs?: Record<string, LangCode>;
	/** Language for overviews and episode titles (profile language). Default 'nl'. */
	preferLang?: LangCode;
	/** TMDB enrichment (ids for translated titles + metadata). */
	tmdb?: TmdbIndex;
	/** Clock for popularity/recency (tests). */
	now?: number;
}

/** One raw movie/series after analysis. */
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

function unique<T>(arr: T[]): T[] {
	return [...new Set(arr)];
}

function yearFromDate(date?: string): number | undefined {
	const m = date ? /^(\d{4})/.exec(date) : null;
	return m ? Number(m[1]) : undefined;
}

/** Audio/subtitle languages of a raw item: title → langHint → category → source default. */
export function deriveLanguages(
	parsed: ParsedTitle,
	raw: { category?: string; langHint?: LangCode; subtitleHint?: LangCode[]; sourceId: string },
	sourceLangs: Record<string, LangCode> = {}
): { audio: LangCode[]; subs: LangCode[]; vo: boolean; categoryQuality: Quality } {
	const cat = parseCategory(raw.category);
	const vo = parsed.flags.includes('VO') || cat.vo;
	const subs = unique([...parsed.subLangs, ...(raw.subtitleHint ?? []), ...cat.subLangs]);
	let audio: LangCode[] = [...parsed.langs];
	if (!audio.length && raw.langHint && raw.langHint !== 'und') audio = [raw.langHint];
	if (!audio.length) audio = cat.langs.filter((l) => !(vo && subs.includes(l)));
	if (!audio.length && !vo && sourceLangs[raw.sourceId]) audio = [sourceLangs[raw.sourceId]];
	if (!audio.length) audio = ['und'];
	return { audio, subs, vo, categoryQuality: cat.quality };
}

export function analyzeRaw(raw: RawMovie | RawSeries, opts: BuildOptions = {}): AnalyzedItem {
	const parsed = parseTitle(raw.rawTitle ?? '');
	const { audio, subs, vo, categoryQuality } = deriveLanguages(parsed, raw, opts.sourceLangs);
	const year = raw.year || parsed.year || yearFromDate(raw.releaseDate);

	const keys: string[] = [];
	const weakKeys: string[] = [];
	const addKeys = (title: string | undefined) => {
		if (!title) return;
		const k = titleKeys(title);
		if (k.key && !keys.includes(k.key)) keys.push(k.key);
		if (k.weak && !weakKeys.includes(k.weak)) weakKeys.push(k.weak);
	};
	addKeys(parsed.cleanTitle);
	if (raw.originalTitle) addKeys(parseTitle(raw.originalTitle).cleanTitle);

	let tmdbId = raw.tmdbId && raw.tmdbId > 0 ? Number(raw.tmdbId) : undefined;
	if (!tmdbId && opts.tmdb) {
		for (const key of keys) {
			tmdbId =
				opts.tmdb.byKey[tmdbLookupKey(raw.kind, key, year)] ??
				(year ? undefined : opts.tmdb.byKey[tmdbLookupKey(raw.kind, key)]);
			if (tmdbId) break;
		}
	}
	const imdbId = raw.imdbId ? /tt\d{5,}/i.exec(raw.imdbId)?.[0].toLowerCase() : undefined;

	return {
		raw,
		parsed,
		audio,
		subs,
		quality: parsed.quality !== 'unknown' ? parsed.quality : categoryQuality,
		vo,
		year,
		tmdbId,
		imdbId,
		keys,
		weakKeys
	};
}

function mostCommon<T>(values: (T | undefined | null)[]): T | undefined {
	const counts = new Map<T, number>();
	let best: T | undefined;
	let bestN = 0;
	for (const v of values) {
		if (v === undefined || v === null || v === '') continue;
		const n = (counts.get(v) ?? 0) + 1;
		counts.set(v, n);
		if (n > bestN) {
			best = v;
			bestN = n;
		}
	}
	return best;
}

function isAllCaps(s: string): boolean {
	return !/\p{Ll}/u.test(s) && /\p{Lu}/u.test(s);
}

function nicest(titles: string[]): string | undefined {
	return mostCommon(titles.filter((t) => !isAllCaps(t))) ?? mostCommon(titles);
}

function median(nums: number[]): number | undefined {
	if (!nums.length) return undefined;
	const s = [...nums].sort((a, b) => a - b);
	return s[Math.floor(s.length / 2)];
}

/** Languages ordered by frequency, 'und' dropped when anything else is known. */
function langUnion(lists: LangCode[][]): LangCode[] {
	const counts = new Map<LangCode, number>();
	for (const list of lists) for (const l of list) counts.set(l, (counts.get(l) ?? 0) + 1);
	const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([l]) => l);
	return sorted.length > 1 ? sorted.filter((l) => l !== 'und') : sorted;
}

function qualityUnion(qs: Quality[]): Quality[] {
	const set = new Set(qs);
	const out = QUALITY_ORDER.filter((q) => set.has(q));
	return out.length > 1 ? out.filter((q) => q !== 'unknown') : out;
}

function variantFor(item: AnalyzedItem): StreamVariant {
	const raw = item.raw as RawMovie;
	return {
		id: `${raw.sourceId}:${raw.providerId}`,
		sourceId: raw.sourceId,
		url: raw.url,
		audioLangs: item.audio,
		subtitleLangs: item.subs,
		quality: item.quality,
		label: raw.rawTitle,
		containerExt: raw.containerExt
	};
}

const DAY = 86_400_000;

/** 0..100 from rating, number of sources, languages, versions and recency. */
export function popularityScore(
	t: Pick<Title, 'rating' | 'sourceIds' | 'languages' | 'addedAt' | 'year'>,
	versions: number,
	now: number
): number {
	const rating = t.rating ? Math.min(1, Math.max(0, t.rating / 10)) : 0.55;
	const sources = Math.min(t.sourceIds.length, 3) / 3;
	const langs = Math.min(t.languages.filter((l) => l !== 'und').length, 6) / 6;
	const vers = Math.min(versions, 8) / 8;
	const added = Math.max(0, 1 - (now - t.addedAt) / (90 * DAY));
	const nowYear = new Date(now).getFullYear();
	const fresh = t.year ? Math.min(1, Math.max(0, 1 - (nowYear - t.year) / 30)) : 0.3;
	const score = rating * 35 + sources * 15 + langs * 20 + vers * 5 + added * 15 + fresh * 10;
	return Math.round(Math.min(100, Math.max(0, score)));
}

function pickOverview(items: AnalyzedItem[], prefer: LangCode): string | undefined {
	let best: { text: string; rank: number } | undefined;
	for (const it of items) {
		const plot = it.raw.plot?.trim();
		if (!plot) continue;
		const lang = it.audio[0];
		const rank = lang === prefer ? 0 : lang === 'en' ? 1 : 2;
		if (!best || rank < best.rank || (rank === best.rank && plot.length > best.text.length))
			best = { text: plot, rank };
	}
	return best?.text;
}

function buildTitle(
	items: AnalyzedItem[],
	opts: BuildOptions,
	usedIds: Set<string>,
	now: number
): Title {
	const kind = items[0].raw.kind;
	const prefer = opts.preferLang ?? 'nl';
	const tmdbId = mostCommon(items.map((i) => i.tmdbId));
	const meta: TmdbMeta | undefined = tmdbId
		? opts.tmdb?.meta[tmdbMetaKey(kind, tmdbId)]
		: undefined;
	const imdbId = mostCommon(items.map((i) => i.imdbId)) ?? meta?.imdbId;
	const year = mostCommon(items.map((i) => i.year)) ?? meta?.year;

	const originalTitle =
		nicest(
			items
				.map((i) => i.raw.originalTitle && parseTitle(i.raw.originalTitle).cleanTitle)
				.filter((t): t is string => !!t)
		) ?? meta?.originalTitle;
	// Original language: TMDB, else the language of the version whose title is the original title.
	let originalLang = meta?.originalLang;
	if (!originalLang && originalTitle) {
		const ok = titleKeys(originalTitle).key;
		originalLang = mostCommon(
			items.filter((i) => !i.vo && i.audio[0] !== 'und' && i.keys[0] === ok).map((i) => i.audio[0])
		);
	}
	const certification =
		mostCommon(items.map((i) => rawCertification(i.raw))) ?? meta?.certification;

	const english = nicest(
		items.filter((i) => i.audio[0] === 'en' && !i.vo).map((i) => i.parsed.cleanTitle)
	);
	const display =
		english ?? originalTitle ?? meta?.title ?? nicest(items.map((i) => i.parsed.cleanTitle)) ?? '';

	// Stable id: tmdb → imdb → kind + slug of the most language-neutral title + year.
	const prefix = kind === 'movie' ? 'm' : 's';
	let id = tmdbId
		? `tmdb-${prefix}-${tmdbId}`
		: imdbId
			? `imdb-${imdbId}`
			: `k-${kind}-${slugify(originalTitle ?? display)}${year ? '-' + year : ''}`;
	if (usedIds.has(id)) {
		const base = year && !id.endsWith(`-${year}`) ? `${id}-${year}` : id;
		id = base;
		let n = 2;
		while (usedIds.has(id)) id = `${base}-${n++}`;
	}
	usedIds.add(id);

	// Every distinct title, with its language.
	const altTitles: Title['altTitles'] = [];
	const seenAlt = new Set<string>();
	const addAlt = (title: string | undefined, lang?: LangCode) => {
		if (!title) return;
		const k = `${foldText(title)}|${lang ?? ''}`;
		if (seenAlt.has(k)) return;
		seenAlt.add(k);
		altTitles.push(lang && lang !== 'und' ? { title, lang } : { title });
	};
	for (const it of items) addAlt(it.parsed.cleanTitle, it.vo ? undefined : it.audio[0]);
	addAlt(originalTitle, meta?.originalTitle === originalTitle ? meta?.originalLang : undefined);
	if (meta) for (const a of meta.altTitles) if (a.lang === prefer) addAlt(a.title, a.lang);

	// Genres: normalised to Dutch, ordered by how many entries mention them.
	const genreCounts = new Map<string, number>();
	for (const it of items)
		for (const g of normalizeGenres(it.raw.genres))
			genreCounts.set(g, (genreCounts.get(g) ?? 0) + 1);
	if (meta)
		for (const g of normalizeGenres(meta.genres)) genreCounts.set(g, (genreCounts.get(g) ?? 0) + 2);
	const genres = [...genreCounts.entries()].sort((a, b) => b[1] - a[1]).map(([g]) => g);

	// Cast: the longest list wins (TMDB if longer).
	let cast: Person[] = [];
	for (const it of items) {
		const list = it.raw.cast?.filter(Boolean) ?? [];
		if (list.length > cast.length) cast = list.map(parsePerson);
	}
	if (meta && meta.cast.length > cast.length) cast = meta.cast;

	const ratings = items.map((i) => i.raw.rating).filter((r): r is number => !!r && r > 0);
	const rating =
		meta?.rating ??
		(ratings.length
			? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10
			: undefined);
	const runtimeSec = median(
		items.map((i) => i.raw.durationSec).filter((d): d is number => !!d && d > 0)
	);
	const releaseDates = items.map((i) => i.raw.releaseDate).filter((d): d is string => !!d);
	const richest = [...items].sort((a, b) => metaScore(b.raw) - metaScore(a.raw));

	const addedAt = Math.max(...items.map((i) => i.raw.addedAt ?? 0)) || now;
	const sourceIds = unique(items.map((i) => i.raw.sourceId));

	let variants: StreamVariant[] = [];
	let seasons: Title['seasons'];
	let rawRefs: Title['rawRefs'] = [];
	let audioLists: LangCode[][];
	let subLists: LangCode[][];
	let qualities: Quality[];
	if (kind === 'movie') {
		const seen = new Set<string>();
		for (const it of items) {
			const v = variantFor(it);
			if (seen.has(v.id)) continue;
			seen.add(v.id);
			variants.push(v);
		}
		variants = sortVariants(variants);
		audioLists = variants.map((v) => v.audioLangs);
		subLists = variants.map((v) => v.subtitleLangs);
		qualities = variants.map((v) => v.quality);
	} else {
		const withEpisodes = items.filter((i) => (i.raw as RawSeries).episodes !== undefined);
		rawRefs = items.map((i) => ({
			sourceId: i.raw.sourceId,
			providerId: i.raw.providerId,
			langs: i.audio
		}));
		if (withEpisodes.length) {
			seasons = mergeSeasons(
				id,
				withEpisodes.map((i) => episodeSource(i)),
				prefer
			);
		}
		const epVariants = seasons?.flatMap((s) => s.episodes.flatMap((e) => e.variants)) ?? [];
		audioLists = [...epVariants.map((v) => v.audioLangs), ...items.map((i) => i.audio)];
		subLists = [...epVariants.map((v) => v.subtitleLangs), ...items.map((i) => i.subs)];
		qualities = [...epVariants.map((v) => v.quality), ...items.map((i) => i.quality)];
	}

	const title: Title = {
		id,
		kind,
		title: display,
		originalTitle,
		altTitles,
		year,
		tmdbId,
		imdbId,
		overview:
			(meta?.lang === prefer ? meta?.overview : undefined) ??
			pickOverview(items, prefer) ??
			meta?.overview,
		genres,
		runtimeMin: runtimeSec ? Math.round(runtimeSec / 60) : meta?.runtimeMin,
		releaseDate: releaseDates.sort()[0] ?? meta?.releaseDate,
		rating,
		cast,
		director: mostCommon(items.map((i) => i.raw.director)) ?? meta?.director,
		trailerUrl: richest.find((i) => i.raw.trailerUrl)?.raw.trailerUrl ?? meta?.trailerUrl,
		posterUrl: richest.find((i) => i.raw.posterUrl)?.raw.posterUrl ?? meta?.posterUrl,
		backdropUrl: richest.find((i) => i.raw.backdropUrl)?.raw.backdropUrl ?? meta?.backdropUrl,
		originalLang,
		certification,
		kidsSafe: isKidsSafe(genres, certification),
		addedAt,
		popularity: 0,
		variants,
		seasons,
		languages: langUnion(audioLists),
		subtitleLanguages: langUnion(subLists).filter((l) => l !== 'und'),
		qualities: qualityUnion(qualities),
		sourceIds,
		rawRefs
	};
	const versions = kind === 'movie' ? variants.length : items.length;
	title.popularity = popularityScore(title, versions, now);
	return title;
}

const KIDS_GENRES = new Set(['Animatie', 'Kinderen', 'Familie']);
const ADULT_GENRES = new Set(['Horror', 'Thriller', 'Misdaad', 'Oorlog']);
const KIDS_CERTS = new Set(['AL', '0', '6']);

/**
 * Suitable for kids mode? An explicit certification decides (AL/6 = yes); without one only
 * animation/kids/family titles without horror, thriller, crime or war genres qualify.
 */
export function isKidsSafe(genres: string[], certification?: string): boolean {
	if (certification) return KIDS_CERTS.has(certification.toUpperCase());
	return genres.some((g) => KIDS_GENRES.has(g)) && !genres.some((g) => ADULT_GENRES.has(g));
}

/** Certification from a raw item when the provider supplies one (field `certification`). */
function rawCertification(raw: RawMovie | RawSeries): string | undefined {
	const c = (raw as { certification?: unknown }).certification;
	return typeof c === 'string' && c.trim() ? c.trim().toUpperCase() : undefined;
}

function metaScore(raw: RawMovie | RawSeries): number {
	return (
		(raw.plot?.length ?? 0) / 100 +
		(raw.posterUrl ? 3 : 0) +
		(raw.backdropUrl ? 2 : 0) +
		(raw.cast?.length ?? 0) * 0.3 +
		(raw.rating ? 1 : 0)
	);
}

function sortVariants(variants: StreamVariant[]): StreamVariant[] {
	return variants.sort(
		(a, b) =>
			QUALITY_ORDER.indexOf(a.quality) - QUALITY_ORDER.indexOf(b.quality) ||
			a.id.localeCompare(b.id)
	);
}

export function episodeSource(item: AnalyzedItem): EpisodeSource {
	return {
		sourceId: item.raw.sourceId,
		audio: item.audio,
		subs: item.subs,
		quality: item.quality,
		seriesTitle: item.parsed.cleanTitle,
		episodes: (item.raw as RawSeries).episodes ?? []
	};
}

/** Build the merged catalog from every source's raw catalog. Pure and deterministic. */
export function buildCatalog(raws: RawCatalog[], opts: BuildOptions = {}): Catalog {
	const now = opts.now ?? Date.now();
	const items: AnalyzedItem[] = [];
	for (const raw of raws) {
		for (const m of raw.movies ?? []) items.push(analyzeRaw(m, opts));
		for (const s of raw.series ?? []) items.push(analyzeRaw(s, opts));
	}

	const matchItems: MatchItem[] = items.map((it) => ({
		kind: it.raw.kind,
		keys: it.keys,
		weakKeys: it.weakKeys,
		year: it.year,
		tmdbId: it.tmdbId,
		imdbId: it.imdbId,
		durationSec: it.raw.kind === 'movie' ? it.raw.durationSec : undefined
	}));
	const groups = clusterItems(matchItems);

	// Deterministic order: clusters with tmdb ids first claim their id.
	const rank = (g: number[]) => (g.some((i) => items[i].tmdbId) ? 0 : 1);
	groups.sort((a, b) => rank(a) - rank(b) || a[0] - b[0]);
	const usedIds = new Set<string>();
	const titles = groups.map((g) =>
		buildTitle(
			g.map((i) => items[i]),
			opts,
			usedIds,
			now
		)
	);
	titles.sort((a, b) => b.addedAt - a.addedAt || a.id.localeCompare(b.id));

	const epg = groupEpg(raws);
	const channels = buildChannels(raws, epg, opts.sourceLangs);
	return { titles, channels, epg, builtAt: now };
}

/** Number of raw entries in a set of catalogs (used to decide on a worker build). */
export function rawSize(raws: RawCatalog[]): number {
	let n = 0;
	for (const r of raws)
		n += (r.movies?.length ?? 0) + (r.series?.length ?? 0) + (r.channels?.length ?? 0);
	return n;
}

/**
 * Title with (new) seasons; languages, subtitle languages and qualities are recomputed from the
 * episodes and the raw refs. Used by the catalog store after lazily loading episodes.
 */
export function withSeasons(title: Title, seasons: Title['seasons']): Title {
	const variants = seasons?.flatMap((s) => s.episodes.flatMap((e) => e.variants)) ?? [];
	return {
		...title,
		seasons,
		languages: langUnion([
			...variants.map((v) => v.audioLangs),
			...title.rawRefs.map((r) => r.langs),
			title.languages
		]),
		subtitleLanguages: langUnion([
			...variants.map((v) => v.subtitleLangs),
			title.subtitleLanguages
		]).filter((l) => l !== 'und'),
		qualities: qualityUnion([...variants.map((v) => v.quality), ...title.qualities])
	};
}
