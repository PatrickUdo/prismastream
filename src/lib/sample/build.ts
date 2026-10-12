// Turns the fictional seeds into realistic, messy IPTV raw catalogs from three sources:
//   A  'sample'        Dutch-oriented provider: full metadata, tmdb ids, Dutch genres, EPG
//   B  'sample-world'  international provider: English genres, no ids, original titles only
//   C  'sample-plus'   TR/AR/PL/PT/ES provider: localised genres, sparse metadata
// Titles use every common notation ("NL - ", "|EN| ", "DE: … [FHD]", "TR ▎", "4K-NL - ", …).
import type {
	EpgProgramme,
	LangCode,
	Quality,
	RawCatalog,
	RawChannel,
	RawEpisode,
	RawMovie,
	RawSeries
} from '#lib/types.ts';
import { localizedGenre } from '#lib/merge/genres.ts';
import { FILMS, type FilmSeed } from './data/films.ts';
import { SERIES, type SeriesSeed } from './data/series.ts';
import { CHANNELS, type ChannelSeed } from './data/channels.ts';
import {
	EPISODE_PLOTS,
	EPISODE_TITLES,
	FIRST_NAMES,
	GENERIC_EPISODE,
	LAST_NAMES,
	PROGRAMMES,
	SUPPORTING_ROLES
} from './data/pools.ts';

export type Src = 'A' | 'B' | 'C';
export const SOURCE_IDS: Record<Src, string> = {
	A: 'sample',
	B: 'sample-world',
	C: 'sample-plus'
};

/** Public test streams only. */
export const STREAMS = {
	mux: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
	appleMultiAudio:
		'https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8',
	// Was Bitmovin's Sintel demo, which now returns 403; Apple's TS bipbop has multi-audio + subtitles.
	sintel: 'https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_ts/master.m3u8',
	mux2: 'https://test-streams.mux.dev/test_001/stream.m3u8'
};
const VOD_STREAMS = [STREAMS.mux, STREAMS.sintel, STREAMS.mux2, STREAMS.appleMultiAudio];
const LIVE_STREAMS = [STREAMS.mux, STREAMS.mux2, STREAMS.mux, STREAMS.appleMultiAudio];

const DAY = 86_400_000;
const HOUR = 3_600_000;
const MIN = 60_000;

export function hash(s: string): number {
	let h = 2166136261;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
}

/** Deterministic PRNG (mulberry32) seeded by a string. */
export function rng(seed: string): () => number {
	let a = hash(seed);
	return () => {
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const CODE: Record<LangCode, string> = {
	nl: 'NL',
	en: 'EN',
	de: 'DE',
	fr: 'FR',
	es: 'ES',
	it: 'IT',
	tr: 'TR',
	ar: 'AR',
	pl: 'PL',
	pt: 'PT',
	ko: 'KR'
};

const TEMPLATES: Record<LangCode, string[]> = {
	nl: [
		'NL - {t} ({y})',
		'NL: {t} ({y}) {q}',
		'[NL] {t} ({y})',
		'|NL| {t} {y}',
		'NL| {t} ({y}) [{q}]'
	],
	en: [
		'EN - {t} ({y})',
		'|EN| {t} {y} {q}',
		'EN: {t} ({y}) [{q}]',
		'ENG | {t} - {y}',
		'[EN] {t} ({y})',
		'{t} ({y}) {q}'
	],
	de: ['DE: {t} ({y}) [{q}]', 'DE - {t} ({y})', '|DE| {t} ({y})', 'GER | {t} {y}', 'DE-{t} ({y})'],
	fr: ['FR - {t} ({y})', 'FR: {t} ({y}) {q}', '|FR| {t} {y}', '[FRE] {t} ({y})', 'FRA ▎{t} ({y})'],
	es: ['ES - {t} ({y})', 'ES ▎{t} ({y})', '|ESP| {t} {y}', 'SPA: {t} ({y})', 'LAT - {t} ({y})'],
	it: ['IT - {t} ({y})', 'ITA: {t} ({y}) {q}', '|IT| {t} {y}', '[ITA] {t} ({y})'],
	tr: ['TR ▎{t} ({y})', 'TR - {t} ({y})', '|TR| {t} {y}', 'TUR: {t} ({y}) {q}'],
	ar: ['AR - {t} ({y})', '|AR| {t} {y}', 'ARA ▎{t} ({y})', 'AR: {t} ({y}) [{q}]'],
	pl: ['PL - {t} ({y})', 'PL: {t} ({y}) {q}', '|PL| {t} {y}', 'POL ▎{t} ({y})'],
	pt: [
		'PT - {t} ({y})',
		'PT-BR - {t} ({y})',
		'|PT| {t} {y}',
		'POR: {t} ({y}) [{q}]',
		'BR ▎{t} ({y})'
	],
	ko: ['KR - {t} ({y})', '|KO| {t} {y}']
};

const Q_TEXT: Record<Quality, string[]> = {
	'4K': ['4K', 'UHD', '2160p'],
	FHD: ['FHD', '1080p'],
	HD: ['HD', '720p'],
	SD: ['SD', '480p'],
	unknown: ['']
};
const Q_CHAR: Record<string, Quality> = { '4': '4K', F: 'FHD', H: 'HD', S: 'SD' };
const DEFAULT_Q: Record<Src, Quality> = { A: 'FHD', B: 'HD', C: 'HD' };

const MOVIE_CATS: Record<Src, (lang: LangCode) => string> = {
	A: (l) => `${CODE[l]} | ${l === 'en' ? 'MOVIES' : 'FILMS'}`,
	B: (l) =>
		({
			nl: 'Netherlands VOD',
			en: 'English Movies',
			de: 'Germany VOD',
			fr: 'FR - Films',
			es: 'Spain Movies',
			it: 'Italia Film',
			pt: 'Portugal VOD',
			tr: 'Turkey VOD',
			ar: 'Arabic Movies',
			pl: 'Poland VOD',
			ko: 'Korea VOD'
		})[l] ?? 'Movies',
	C: (l) =>
		({
			nl: 'NL | FILMS',
			en: 'VOD | ENGLISH',
			de: 'DE | KINO',
			fr: 'FR | FILMS',
			es: 'ES | PELÍCULAS',
			it: 'IT | FILM',
			tr: 'TR | FİLMLER',
			ar: 'AR | أفلام',
			pl: 'PL | FILMY',
			pt: 'PT-BR | FILMES',
			ko: 'KR | 영화'
		})[l] ?? 'VOD'
};

const SERIES_CATS: Record<Src, (lang: LangCode) => string> = {
	A: (l) => `${CODE[l]} | SERIES`,
	B: (l) =>
		({
			nl: 'Netherlands Series',
			en: 'English TV Shows',
			de: 'Germany Series',
			fr: 'FR - Séries',
			es: 'Spain Series',
			it: 'Italia Serie TV',
			pt: 'Portugal Series',
			tr: 'Turkey Series',
			ar: 'Arabic Series',
			pl: 'Poland Series'
		})[l] ?? 'Series',
	C: (l) =>
		({
			nl: 'NL | SERIES',
			en: 'SERIES | ENGLISH',
			de: 'DE | SERIEN',
			fr: 'FR | SÉRIES',
			es: 'ES | SERIES',
			it: 'IT | SERIE TV',
			tr: 'TR | DİZİLER',
			ar: 'AR | مسلسلات',
			pl: 'PL | SERIALE',
			pt: 'PT-BR | SÉRIES'
		})[l] ?? 'SERIES'
};

interface Avail {
	lang: LangCode;
	src: Src;
	q?: Quality;
}

/** "nl:A4C en:BF" → [{nl,A,4K},{nl,C},{en,B,FHD}] */
export function parseAvail(v: string): Avail[] {
	const out: Avail[] = [];
	for (const part of v.split(/\s+/).filter(Boolean)) {
		const [lang, spec] = part.split(':');
		for (const m of spec.matchAll(/([ABC])([4FHS]?)/g))
			out.push({ lang, src: m[1] as Src, q: m[2] ? Q_CHAR[m[2]] : undefined });
	}
	return out;
}

function fill(tpl: string, title: string, year: number | undefined, q: string): string {
	return tpl
		.replace('{t}', title)
		.replace('{y}', year ? String(year) : '')
		.replace('{q}', q)
		.replace(/\(\)|\[\]/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

function rawTitleFor(
	lang: LangCode,
	src: Src,
	title: string,
	year: number,
	quality: Quality,
	salt: string
): { rawTitle: string; qualityInTitle: boolean; qText: string } {
	const h = hash(salt);
	const qText = Q_TEXT[quality][h % Q_TEXT[quality].length];
	if (lang === 'nl' && quality === '4K' && src === 'C')
		return { rawTitle: `4K-NL - ${title} (${year})`, qualityInTitle: true, qText };
	const list = TEMPLATES[lang] ?? [`${CODE[lang] ?? lang.toUpperCase()} - {t} ({y})`];
	const tpl = list[(h >>> 3) % list.length];
	return { rawTitle: fill(tpl, title, year, qText), qualityInTitle: tpl.includes('{q}'), qText };
}

function personName(seed: string, used: Set<string>): string {
	for (let k = 0; k < 20; k++) {
		const h = hash(seed + k);
		const name = `${FIRST_NAMES[h % FIRST_NAMES.length]} ${LAST_NAMES[(h >>> 8) % LAST_NAMES.length]}`;
		if (!used.has(name)) {
			used.add(name);
			return name;
		}
	}
	return `${FIRST_NAMES[0]} ${LAST_NAMES[0]}`;
}

/** "Actor (Role)" strings; documentaries only get a narrator. */
function castFor(seed: FilmSeed | SeriesSeed, key: string): string[] {
	const used = new Set<string>([seed.d]);
	const roles = [...seed.c];
	if (!(roles.length === 1 && roles[0] === 'Verteller')) {
		const h = hash(key + 'support');
		roles.push(SUPPORTING_ROLES[h % SUPPORTING_ROLES.length]);
		roles.push(SUPPORTING_ROLES[(h >>> 5) % SUPPORTING_ROLES.length]);
	}
	return [...new Set(roles)].map((role) => `${personName(key + role, used)} (${role})`);
}

function releaseDate(year: number, key: string): string {
	const h = hash(key + 'release');
	const mm = String(1 + (h % 12)).padStart(2, '0');
	const dd = String(1 + ((h >>> 4) % 28)).padStart(2, '0');
	return `${year}-${mm}-${dd}`;
}

/** Titles with a (test-stream) trailer, to exercise the trailer modal. */
const TRAILERS: Record<string, string> = {
	'movie-0': STREAMS.mux,
	'movie-20': STREAMS.sintel,
	'movie-21': STREAMS.mux,
	'movie-44': STREAMS.mux2,
	'series-2': STREAMS.mux
};

/** Kijkwijzer-style age rating from the genres (deterministic variation per title). */
export function certificationFor(genres: string[], key: string): string {
	const h = hash(key + 'cert');
	if (genres.includes('Animatie') || genres.includes('Kinderen')) return 'AL';
	if (genres.includes('Horror')) return '16';
	if (genres.includes('Documentaire')) return h % 2 ? 'AL' : '6';
	if (genres.includes('Familie')) return '6';
	if (genres.includes('Oorlog')) return '14';
	if (genres.some((g) => g === 'Thriller' || g === 'Misdaad')) return h % 3 ? '12' : '16';
	if (genres.includes('Actie')) return '12';
	if (genres.includes('Komedie') || genres.includes('Romantiek')) return h % 2 ? '6' : 'AL';
	return h % 2 ? '12' : '9';
}

interface Bucket {
	movies: RawMovie[];
	series: RawSeries[];
	channels: RawChannel[];
	epg: EpgProgramme[];
}

function emptyBuckets(): Record<Src, Bucket> {
	return {
		A: { movies: [], series: [], channels: [], epg: [] },
		B: { movies: [], series: [], channels: [], epg: [] },
		C: { movies: [], series: [], channels: [], epg: [] }
	};
}

/** Shared metadata per source (A rich, B partial, C sparse). */
function metaFor(
	seed: FilmSeed | SeriesSeed,
	index: number,
	kind: 'movie' | 'series',
	src: Src,
	lang: LangCode,
	key: string,
	now: number,
	k: number
): Partial<Omit<RawMovie, 'kind' | 'url' | 'sourceId' | 'providerId' | 'containerExt'>> {
	const origTitle = seed.t[seed.o] ?? seed.t.en ?? '';
	const title = seed.t[lang] ?? origTitle;
	const translated = title !== origTitle;
	const noId = 'noId' in seed && seed.noId;
	const tmdbId = (kind === 'movie' ? 910_000 : 920_000) + index + 1;
	const added = (extra: number) => now - (seed.a + extra) * DAY - k * 37 * MIN;
	if (src === 'A') {
		const trailerUrl = TRAILERS[`${kind}-${index}`];
		return {
			trailerUrl,
			tmdbId: noId ? undefined : tmdbId,
			originalTitle: translated ? origTitle : undefined,
			year: seed.y,
			plot: seed.p,
			genres: seed.g,
			cast: castFor(seed, key),
			director: seed.d,
			rating: seed.r,
			durationSec: kind === 'movie' ? seed.m * 60 : undefined,
			releaseDate: releaseDate(seed.y, key),
			addedAt: added(0)
		};
	}
	if (src === 'B') {
		return {
			originalTitle: translated ? origTitle : undefined,
			genres: seed.g.map((g) => localizedGenre(g, 'en')),
			cast: castFor(seed, key)
				.slice(0, 3)
				.map((c) => c.replace(/\s*\(.*\)$/, '')),
			director: seed.d,
			rating: Math.round((seed.r + ((hash(key + 'r') % 5) - 2) / 10) * 10) / 10,
			durationSec: kind === 'movie' ? seed.m * 60 + 40 : undefined,
			addedAt: added(2)
		};
	}
	return {
		tmdbId: translated && !noId ? tmdbId : undefined,
		originalTitle: translated && noId ? origTitle : undefined,
		year: seed.y,
		genres: seed.g.map((g) => localizedGenre(g, lang)),
		addedAt: added(5)
	};
}

function buildMovies(b: Record<Src, Bucket>, now: number) {
	FILMS.forEach((f, i) => {
		const key = `film-${i}-${f.t[f.o]}`;
		parseAvail(f.v).forEach((av, k) => {
			const quality = av.q ?? DEFAULT_Q[av.src];
			const title = f.t[av.lang]!;
			const r = rawTitleFor(
				av.lang,
				av.src,
				title,
				f.y,
				quality,
				`${key}-${av.lang}-${av.src}-${k}`
			);
			const category =
				MOVIE_CATS[av.src](av.lang) + (r.qualityInTitle ? '' : ` ${r.qText}`.trimEnd());
			const movie: RawMovie = {
				kind: 'movie',
				sourceId: SOURCE_IDS[av.src],
				providerId: `m${i + 1}-${av.lang}-${k}`,
				rawTitle: r.rawTitle,
				category,
				url: VOD_STREAMS[hash(key + k) % VOD_STREAMS.length],
				containerExt: 'm3u8',
				...metaFor(f, i, 'movie', av.src, av.lang, key, now, k)
			};
			// Not yet a RawMeta field: providers that know it pass `certification` along.
			if (av.src !== 'C') Object.assign(movie, { certification: certificationFor(f.g, key) });
			b[av.src].movies.push(movie);
		});
		(f.x ?? []).forEach(([src, rawTitle, lang], k) => {
			b[src].movies.push({
				kind: 'movie',
				sourceId: SOURCE_IDS[src],
				providerId: `m${i + 1}-x${k}`,
				rawTitle,
				category: src === 'A' ? 'VOD' : src === 'B' ? 'Movies' : 'VOD | MIX',
				url: /MULTI/.test(rawTitle) ? STREAMS.appleMultiAudio : STREAMS.mux,
				containerExt: 'm3u8',
				langHint: lang,
				addedAt: now - (f.a + 1) * DAY - k * HOUR
			});
		});
	});
}

function shuffled<T>(arr: T[], seed: string): T[] {
	const r = rng(seed);
	const out = [...arr];
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(r() * (i + 1));
		[out[i], out[j]] = [out[j], out[i]];
	}
	return out;
}

function pad(n: number): string {
	return String(n).padStart(2, '0');
}

/** Capitalise sentence starts (character names like "meester Orrin" can open a sentence). */
function sentenceCase(text: string): string {
	return text.replace(
		/(^|[.!?]\s+)(\p{Ll})/gu,
		(_, pre: string, ch: string) => pre + ch.toUpperCase()
	);
}

function buildSeries(b: Record<Src, Bucket>, now: number) {
	SERIES.forEach((s, i) => {
		const key = `series-${i}-${s.t[s.o]}`;
		const titles = shuffled(EPISODE_TITLES, key);
		const chars = [...s.c, s.c[0], s.c[0]];
		parseAvail(s.v).forEach((av, k) => {
			const quality = av.q ?? DEFAULT_Q[av.src];
			const seriesTitle = s.t[av.lang]!;
			const r = rawTitleFor(
				av.lang,
				av.src,
				seriesTitle,
				s.y,
				quality,
				`${key}-${av.lang}-${av.src}-${k}`
			);
			const full = av.lang === s.o || av.lang === 'nl' || av.lang === 'en';
			const episodes: RawEpisode[] = [];
			let g = 0;
			s.s.forEach((count, si) => {
				const season = si + 1;
				const available = full || season === 1 ? count : Math.ceil(count * 0.6);
				for (let e = 1; e <= count; e++, g++) {
					if (e > available) continue;
					const h = hash(`${key}-${av.lang}-${av.src}-${season}-${e}`);
					if (av.src === 'C' && !(season === 1 && e === 1) && h % 9 === 0) continue;
					const [nlTitle, enTitle] = titles[g % titles.length];
					const named = av.lang === 'nl' ? nlTitle : av.lang === 'en' ? enTitle : undefined;
					const generic = (GENERIC_EPISODE[av.lang] ?? ((n: number) => `Episode ${n}`))(e);
					const code = `S${pad(season)}E${pad(e)}`;
					const epTitle =
						av.src === 'A'
							? (named ?? generic)
							: av.src === 'B'
								? named
									? `${seriesTitle} ${code} - ${named}`
									: `${seriesTitle} ${code}`
								: `${CODE[av.lang]} - ${seriesTitle} ${code}`;
					const plotTpl = EPISODE_PLOTS[h % EPISODE_PLOTS.length];
					const airDate = new Date(Date.UTC(s.y + si, 8, 1) + (e - 1) * 7 * DAY)
						.toISOString()
						.slice(0, 10);
					episodes.push({
						providerId: `s${i + 1}-${av.lang}-${av.src}-${season}-${e}`,
						season,
						episode: e,
						title: epTitle,
						plot:
							av.src === 'A' && av.lang === 'nl'
								? sentenceCase(
										plotTpl
											.replace('{a}', chars[0])
											.replace('{b}', chars[1])
											.replace('{c}', chars[2])
									)
								: undefined,
						durationSec: (s.m + ((h >>> 4) % 5) - 2) * 60,
						airDate,
						url: VOD_STREAMS[(h >>> 2) % VOD_STREAMS.length],
						containerExt: 'm3u8'
					});
				}
			});
			const category =
				SERIES_CATS[av.src](av.lang) + (r.qualityInTitle ? '' : ` ${r.qText}`.trimEnd());
			const meta = metaFor(s, i, 'series', av.src, av.lang, key, now, k);
			delete meta.durationSec;
			const series: RawSeries = {
				kind: 'series',
				sourceId: SOURCE_IDS[av.src],
				providerId: `s${i + 1}-${av.lang}-${k}`,
				rawTitle: r.rawTitle,
				category,
				episodes,
				...meta
			};
			if (av.src !== 'C') Object.assign(series, { certification: certificationFor(s.g, key) });
			b[av.src].series.push(series);
		});
	});
}

const LIVE_Q: Record<Src, Partial<Record<Quality, string>>> = {
	A: { '4K': '4K', FHD: 'FHD', HD: 'HD', SD: 'SD' },
	B: { '4K': 'UHD', FHD: 'FHD', HD: 'HD', SD: 'SD' },
	C: { '4K': '4K', FHD: 'FHD', HD: 'ᴴᴰ', SD: 'SD' }
};

function buildChannels(b: Record<Src, Bucket>) {
	for (const ch of CHANNELS) {
		const code = CODE[ch.lang];
		// Only feeds that also exist elsewhere get the sloppy treatment (CAPS, no tvg-id).
		const shared = /[AB]/.test(ch.feeds);
		for (const m of ch.feeds.matchAll(/([ABC])([4FHS])/g)) {
			const src = m[1] as Src;
			const q = LIVE_Q[src][Q_CHAR[m[2]]] ?? '';
			const rawName =
				src === 'A'
					? `${code}: ${ch.name} ${q}`
					: src === 'B'
						? `|${code}| ${ch.name} ${q}`
						: `${code} ▎${shared ? ch.name.toUpperCase() : ch.name} ${q}`;
			const group =
				src === 'A'
					? `${code} | ${ch.group}`
					: src === 'B'
						? `${ch.group} (${code})`
						: `|${code}| ${ch.group}`;
			const tvgId =
				src === 'A'
					? ch.tvg
					: src === 'B'
						? ch.tvg.charAt(0).toUpperCase() + ch.tvg.slice(1)
						: ch.reuseTvg?.includes('C') && ch.shiftOf
							? ch.shiftOf
							: ch.num % 2 === 0 || !shared
								? ch.tvg
								: undefined;
			b[src].channels.push({
				kind: 'live',
				sourceId: SOURCE_IDS[src],
				providerId: `ch${ch.num}-${src}`,
				rawName: rawName.trim(),
				tvgId,
				tvgName: ch.name,
				group,
				number: src === 'A' ? ch.num : src === 'B' ? ch.num + 100 : undefined,
				url: LIVE_STREAMS[hash(ch.tvg + src) % LIVE_STREAMS.length]
			});
		}
	}
}

function localMidnight(t: number): number {
	const d = new Date(t);
	return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * Deterministic guide per channel per day; covers now − 6 h … now + 24 h.
 * Channels marked noEpg get no programmes (the guide shows "no programme information").
 */
export function generateEpg(now: number, channels: ChannelSeed[] = CHANNELS): EpgProgramme[] {
	const from = now - 6 * HOUR;
	const to = now + 24 * HOUR;
	const byTvg = new Map<string, EpgProgramme[]>();
	const durations = [30, 45, 60, 60, 60, 90, 120];
	for (const ch of channels) {
		if (ch.shiftOf || ch.noEpg) continue;
		const pool = PROGRAMMES[ch.group];
		const list: EpgProgramme[] = [];
		for (let day = localMidnight(from - HOUR); day < to + DAY;) {
			const next = localMidnight(day + 26 * HOUR);
			const d = new Date(day);
			const r = rng(`${ch.tvg}|${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`);
			let t = day;
			let n = 0;
			while (t < next) {
				const dur = durations[Math.floor(r() * durations.length)] * MIN;
				const [title, desc] = pool[Math.floor(r() * pool.length)];
				const stop = Math.min(t + dur, next);
				list.push({
					channelId: ch.tvg,
					start: t,
					stop,
					title:
						ch.group === 'Entertainment' && n % 3 === 1 ? `${title} (afl. ${1 + (n % 12)})` : title,
					desc,
					category: ch.group
				});
				t = stop;
				n++;
			}
			day = next;
		}
		byTvg.set(ch.tvg, list);
	}
	for (const ch of channels) {
		if (!ch.shiftOf) continue;
		const base = byTvg.get(ch.shiftOf) ?? [];
		byTvg.set(
			ch.tvg,
			base.map((p) => ({ ...p, channelId: ch.tvg, start: p.start + HOUR, stop: p.stop + HOUR }))
		);
	}
	const out: EpgProgramme[] = [];
	for (const list of byTvg.values())
		for (const p of list) if (p.stop > from && p.start < to) out.push(p);
	return out;
}

/** All three demo sources as raw catalogs. */
export function buildSampleCatalogs(now = Date.now()): RawCatalog[] {
	const b = emptyBuckets();
	buildMovies(b, now);
	buildSeries(b, now);
	buildChannels(b);
	b.A.epg = generateEpg(now);
	return (Object.keys(SOURCE_IDS) as Src[]).map((src) => ({
		sourceId: SOURCE_IDS[src],
		fetchedAt: now,
		...b[src]
	}));
}
