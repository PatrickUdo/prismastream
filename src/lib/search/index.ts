// Global search over the merged catalog: titles (incl. alternative and translated titles),
// people (cast), live channels and genres.
//
// The index is an inverted index from folded word → postings (document × field). It is built
// once per catalog (see `searchIndexFor`) and answers a query in a few milliseconds even for
// 50.000 titles: every query word is resolved against the sorted word list (exact, prefix and,
// for words of ≥ 5 letters, one typo), then postings are intersected (all words must match).
//
// Ranking (high → low): exact title > title starts with query > all words in the title >
// alternative/translated title > cast > genre/group. Popularity breaks ties.
import type { Channel, Title } from '#lib/types.ts';
import { fold, indexTokens, tokenize } from './fold.ts';

/** Field a posting comes from. */
const F_TITLE = 0;
const F_ALT = 1;
const F_CAST = 2;
const F_GENRE = 3;

const T_TITLE = 0;
const T_CHANNEL = 1;
const T_PERSON = 2;
const T_GENRE = 3;

/** Score tiers (see module docs). */
export const TIER = {
	exact: 60,
	startsWith: 50,
	words: 40,
	altExact: 35,
	altStartsWith: 33,
	alt: 30,
	cast: 20,
	other: 10
} as const;

const Q_EXACT = 1;
const Q_PREFIX = 0.8;
const Q_FUZZY = 0.55;
const Q_FUZZY_PREFIX = 0.45;
const MAX_QUERY_WORDS = 8;
const FUZZY_MIN_LEN = 5;

export interface TitleHit {
	title: Title;
	score: number;
	/** Alternative / translated title that matched (for "Also known as"). */
	aka?: string;
}

export interface ChannelHit {
	channel: Channel;
	score: number;
}

export interface PersonHit {
	name: string;
	profileUrl?: string;
	/** Titles this person appears in, most popular first. */
	titles: Title[];
	score: number;
}

export interface GenreHit {
	genre: string;
	movies: number;
	series: number;
	score: number;
}

export interface SearchResults {
	query: string;
	movies: TitleHit[];
	series: TitleHit[];
	people: PersonHit[];
	channels: ChannelHit[];
	genres: GenreHit[];
	/** Number of matches before limits. */
	total: number;
}

export interface SearchLimits {
	movies?: number;
	series?: number;
	people?: number;
	channels?: number;
	genres?: number;
}

const DEFAULT_LIMITS: Required<SearchLimits> = {
	movies: 48,
	series: 48,
	people: 12,
	channels: 24,
	genres: 8
};

interface Person {
	name: string;
	profileUrl?: string;
	titles: number[];
}

interface GenreInfo {
	genre: string;
	movies: number;
	series: number;
}

interface TokenMatch {
	token: number;
	q: number;
}

export function emptyResults(query = ''): SearchResults {
	return { query, movies: [], series: [], people: [], channels: [], genres: [], total: 0 };
}

export class SearchIndex {
	readonly titles: Title[];
	readonly channels: Channel[];
	#people: Person[] = [];
	#genres: GenreInfo[] = [];

	// Documents (parallel arrays).
	#type: Uint8Array;
	#ref: Int32Array;
	#main: string[] = [];
	#alts: string[][] = [];
	#altLabels: string[][] = [];
	#pop: Float32Array;

	// Dictionary.
	#words: string[] = [];
	#wordIndex = new Map<string, number>();
	#postings: Int32Array[] = [];
	#cache = new Map<string, TokenMatch[]>();

	// Scratch buffers reused across queries.
	#stamp: Int32Array;
	#epoch = 0;
	#masks: Uint32Array[];
	#any: Uint32Array;
	#qual: Float32Array;

	constructor(titles: Title[], channels: Channel[]) {
		this.titles = titles;
		this.channels = channels;

		const people = new Map<string, Person>();
		const genres = new Map<string, GenreInfo>();
		titles.forEach((t, i) => {
			for (const p of t.cast) {
				const key = fold(p.name);
				if (!key) continue;
				let person = people.get(key);
				if (!person) people.set(key, (person = { name: p.name, titles: [] }));
				if (!person.profileUrl && p.profileUrl) person.profileUrl = p.profileUrl;
				if (person.titles[person.titles.length - 1] !== i) person.titles.push(i);
			}
			for (const g of t.genres) {
				let info = genres.get(g);
				if (!info) genres.set(g, (info = { genre: g, movies: 0, series: 0 }));
				if (t.kind === 'movie') info.movies++;
				else info.series++;
			}
		});
		this.#people = [...people.values()];
		for (const p of this.#people)
			p.titles.sort((a, b) => titles[b].popularity - titles[a].popularity);
		this.#genres = [...genres.values()];

		const n = titles.length + channels.length + this.#people.length + this.#genres.length;
		this.#type = new Uint8Array(n);
		this.#ref = new Int32Array(n);
		this.#pop = new Float32Array(n);
		this.#stamp = new Int32Array(n);
		this.#masks = [0, 1, 2, 3].map(() => new Uint32Array(n));
		this.#any = new Uint32Array(n);
		this.#qual = new Float32Array(n);

		const dict = new Map<string, number[]>();
		let doc = 0;
		const add = (text: string | undefined, field: number) => {
			if (!text) return;
			const code = doc * 4 + field;
			for (const w of indexTokens(text)) {
				let list = dict.get(w);
				if (!list) dict.set(w, (list = []));
				if (list[list.length - 1] !== code) list.push(code);
			}
		};
		const begin = (type: number, ref: number, main: string, pop: number) => {
			this.#type[doc] = type;
			this.#ref[doc] = ref;
			this.#main[doc] = fold(main);
			this.#pop[doc] = pop;
			this.#alts[doc] = [];
			this.#altLabels[doc] = [];
			add(main, F_TITLE);
		};

		titles.forEach((t, i) => {
			begin(T_TITLE, i, t.title, Math.max(0, Math.min(1, t.popularity / 100)));
			const seen = new Set([this.#main[doc]]);
			for (const alt of [t.originalTitle, ...t.altTitles.map((a) => a.title)]) {
				if (!alt) continue;
				const f = fold(alt);
				if (!f || seen.has(f)) continue;
				seen.add(f);
				this.#alts[doc].push(f);
				this.#altLabels[doc].push(alt);
				add(alt, F_ALT);
			}
			for (const p of t.cast.slice(0, 15)) add(p.name, F_CAST);
			add(t.director, F_CAST);
			for (const g of t.genres) add(g, F_GENRE);
			doc++;
		});
		channels.forEach((c, i) => {
			begin(T_CHANNEL, i, c.name, 0);
			add(c.group, F_GENRE);
			doc++;
		});
		this.#people.forEach((p, i) => {
			const best = p.titles.length ? titles[p.titles[0]].popularity / 100 : 0;
			begin(T_PERSON, i, p.name, Math.min(1, best * 0.6 + Math.min(p.titles.length, 20) / 50));
			doc++;
		});
		this.#genres.forEach((g, i) => {
			begin(T_GENRE, i, g.genre, Math.min(1, (g.movies + g.series) / 500));
			doc++;
		});

		this.#words = [...dict.keys()].sort();
		this.#postings = this.#words.map((w) => Int32Array.from(dict.get(w)!));
		this.#words.forEach((w, i) => this.#wordIndex.set(w, i));
	}

	/** Number of indexed documents (titles, channels, people, genres). */
	get size(): number {
		return this.#type.length;
	}

	/** All dictionary words matching query word `q`, best first. Cached per word. */
	#match(q: string): TokenMatch[] {
		const cached = this.#cache.get(q);
		if (cached) return cached;
		const out: TokenMatch[] = [];
		const taken = new Set<number>();
		const exact = this.#wordIndex.get(q);
		if (exact !== undefined) {
			out.push({ token: exact, q: Q_EXACT });
			taken.add(exact);
		}
		// Prefix range in the sorted word list.
		const words = this.#words;
		let lo = 0;
		let hi = words.length;
		while (lo < hi) {
			const mid = (lo + hi) >> 1;
			if (words[mid] < q) lo = mid + 1;
			else hi = mid;
		}
		for (let j = lo; j < words.length && words[j].startsWith(q); j++) {
			if (taken.has(j)) continue;
			taken.add(j);
			out.push({ token: j, q: Q_PREFIX - Math.min(0.2, (words[j].length - q.length) * 0.02) });
		}
		// One typo for longer words: whole word, or as a prefix of a longer word.
		if (q.length >= FUZZY_MIN_LEN) {
			const L = q.length;
			for (let j = 0; j < words.length; j++) {
				const w = words[j];
				if (w.length < L - 1 || taken.has(j)) continue;
				if (w.length <= L + 1 && oneEdit(q, w, w.length)) {
					out.push({ token: j, q: Q_FUZZY });
					taken.add(j);
				} else if (
					w.length > L &&
					(oneEdit(q, w, L) || oneEdit(q, w, L + 1) || oneEdit(q, w, L - 1))
				) {
					out.push({ token: j, q: Q_FUZZY_PREFIX });
					taken.add(j);
				}
			}
		}
		out.sort((a, b) => b.q - a.q);
		if (this.#cache.size > 400) this.#cache.clear();
		this.#cache.set(q, out);
		return out;
	}

	search(query: string, limits: SearchLimits = {}): SearchResults {
		const lim = { ...DEFAULT_LIMITS, ...limits };
		const qWords = [...new Set(tokenize(query))].slice(0, MAX_QUERY_WORDS);
		if (qWords.length === 0) return emptyResults(query);
		const qText = fold(query);
		const n = qWords.length;
		const full = (1 << n) - 1;

		const epoch = ++this.#epoch;
		const stamp = this.#stamp;
		const masks = this.#masks;
		const any = this.#any;
		const qual = this.#qual;
		let cand: number[] = [];
		const matchSets: Set<string>[] = [];

		for (let i = 0; i < n; i++) {
			const bit = 1 << i;
			const prev = bit - 1;
			const matches = this.#match(qWords[i]);
			matchSets.push(new Set(matches.map((m) => this.#words[m.token])));
			if (matches.length === 0) return { ...emptyResults(query) };
			for (const m of matches) {
				const post = this.#postings[m.token];
				for (let k = 0; k < post.length; k++) {
					const code = post[k];
					const doc = code >> 2;
					if (stamp[doc] !== epoch) {
						if (i > 0) continue;
						stamp[doc] = epoch;
						masks[0][doc] = masks[1][doc] = masks[2][doc] = masks[3][doc] = 0;
						any[doc] = 0;
						qual[doc] = 0;
						cand.push(doc);
					} else if ((any[doc] & prev) !== prev) continue;
					masks[code & 3][doc] |= bit;
					if ((any[doc] & bit) === 0) {
						any[doc] |= bit;
						qual[doc] += m.q;
					}
				}
			}
			if (i > 0) cand = cand.filter((d) => (any[d] & (bit | prev)) === (bit | prev));
		}

		const res = emptyResults(query);
		const movieTop = new TopK(lim.movies);
		const seriesTop = new TopK(lim.series);
		const channelTop = new TopK(lim.channels);
		const personTop = new TopK(lim.people);
		const genreTop = new TopK(lim.genres);

		for (const doc of cand) {
			if (any[doc] !== full) continue;
			const main = this.#main[doc];
			const mTitle = masks[F_TITLE][doc];
			let tier: number;
			if (main === qText) tier = TIER.exact;
			else if (main.startsWith(qText)) tier = TIER.startsWith;
			else if (mTitle === full) tier = TIER.words;
			else {
				const alts = this.#alts[doc];
				const mAlt = masks[F_ALT][doc];
				if (alts.includes(qText)) tier = TIER.altExact;
				else if (alts.some((a) => a.startsWith(qText))) tier = TIER.altStartsWith;
				else if (mAlt && (mTitle | mAlt) === full) tier = TIER.alt;
				else if (masks[F_CAST][doc] && (mTitle | mAlt | masks[F_CAST][doc]) === full)
					tier = TIER.cast;
				else tier = TIER.other;
			}
			const score = tier + (2 * qual[doc]) / n + this.#pop[doc];
			res.total++;
			switch (this.#type[doc]) {
				case T_TITLE:
					(this.titles[this.#ref[doc]].kind === 'movie' ? movieTop : seriesTop).add(doc, score);
					break;
				case T_CHANNEL:
					channelTop.add(doc, score);
					break;
				case T_PERSON:
					personTop.add(doc, score);
					break;
				default:
					genreTop.add(doc, score);
			}
		}

		const titleHit = (h: Ranked): TitleHit => {
			const hit: TitleHit = { title: this.titles[this.#ref[h.doc]], score: h.score };
			if (h.score < TIER.words) {
				const aka = this.#aka(h.doc, qText, matchSets);
				if (aka) hit.aka = aka;
			}
			return hit;
		};
		res.movies = movieTop.items.map(titleHit);
		res.series = seriesTop.items.map(titleHit);
		res.channels = channelTop.items.map((h) => ({
			channel: this.channels[this.#ref[h.doc]],
			score: h.score
		}));
		res.people = personTop.items.map((h) => {
			const p = this.#people[this.#ref[h.doc]];
			return {
				name: p.name,
				profileUrl: p.profileUrl,
				titles: p.titles.slice(0, 12).map((i) => this.titles[i]),
				score: h.score
			};
		});
		res.genres = genreTop.items.map((h) => ({
			...this.#genres[this.#ref[h.doc]],
			score: h.score
		}));
		return res;
	}

	/** The alternative title that best explains a match (shown as "Also known as"). */
	#aka(doc: number, qText: string, matchSets: Set<string>[]): string | undefined {
		const alts = this.#alts[doc];
		if (alts.length === 0) return undefined;
		let best = -1;
		let bestCover = 0;
		for (let i = 0; i < alts.length; i++) {
			if (alts[i] === qText || alts[i].startsWith(qText)) return this.#altLabels[doc][i];
			const words = alts[i].split(' ');
			let cover = 0;
			for (const set of matchSets) if (words.some((w) => set.has(w))) cover++;
			if (cover > bestCover) {
				bestCover = cover;
				best = i;
			}
		}
		return best >= 0 ? this.#altLabels[doc][best] : undefined;
	}
}

interface Ranked {
	doc: number;
	score: number;
}

/** Keeps the k best-scoring documents (sorted, best first) without sorting everything. */
class TopK {
	items: Ranked[] = [];
	#k: number;
	constructor(k: number) {
		this.#k = Math.max(0, k);
	}
	add(doc: number, score: number) {
		const items = this.items;
		if (items.length >= this.#k && (this.#k === 0 || score <= items[items.length - 1].score))
			return;
		let i = items.length;
		while (i > 0 && items[i - 1].score < score) i--;
		items.splice(i, 0, { doc, score });
		if (items.length > this.#k) items.pop();
	}
}

/**
 * True when `a` is within one edit (insert, delete, substitute, adjacent swap) of the first
 * `lb` characters of `b`. No allocations.
 */
export function oneEdit(a: string, b: string, lb: number): boolean {
	const la = a.length;
	if (lb > b.length || lb < 0 || Math.abs(la - lb) > 1) return false;
	let i = 0;
	while (i < la && i < lb && a.charCodeAt(i) === b.charCodeAt(i)) i++;
	if (la === lb) {
		if (i === la) return true;
		if (eq(a, i + 1, b, i + 1, la - i - 1)) return true;
		return (
			i + 1 < la &&
			a.charCodeAt(i) === b.charCodeAt(i + 1) &&
			a.charCodeAt(i + 1) === b.charCodeAt(i) &&
			eq(a, i + 2, b, i + 2, la - i - 2)
		);
	}
	if (la < lb) return eq(a, i, b, i + 1, la - i);
	return eq(a, i + 1, b, i, lb - i);
}

function eq(a: string, ai: number, b: string, bi: number, n: number): boolean {
	for (let k = 0; k < n; k++) if (a.charCodeAt(ai + k) !== b.charCodeAt(bi + k)) return false;
	return true;
}

// ---- Shared instance per catalog ---------------------------------------------------------

let cached: { key: string; index: SearchIndex } | null = null;

/**
 * The search index for this catalog, built once per `key` (e.g. `${catalog.builtAt}:kids`).
 * Rebuilding only happens when the key changes, never per keystroke.
 */
export function searchIndexFor(key: string, titles: Title[], channels: Channel[]): SearchIndex {
	if (cached?.key !== key) cached = { key, index: new SearchIndex(titles, channels) };
	return cached.index;
}
