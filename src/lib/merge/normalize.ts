// Title normalisation for IPTV catalogs.
//
// parseTitle("4K-NL - De Matrix (1999) [HEVC]") →
//   { cleanTitle: 'De Matrix', year: 1999, langs: ['nl'], quality: '4K', flags: ['HEVC'] }
//
// matchKey() turns a clean title into a comparison key: no diacritics or punctuation,
// leading article dropped, "&"/"en"/"und"/"et" → "and", Roman numerals → digits.
import type { LangCode, Quality } from '#lib/types.ts';
import { isRiskyTag, lookupTag, type Tag } from './tags.ts';

export interface ParsedTitle {
	cleanTitle: string;
	year?: number;
	/** Audio languages detected in the title (primary first). */
	langs: LangCode[];
	/** Subtitle languages detected in the title ("NL Subs", "VOSTFR"). */
	subLangs: LangCode[];
	quality: Quality;
	/** Release flags: HEVC, HDR, DV, H264, BluRay, WEB-DL, REMUX, MULTI, DUAL, VO, … */
	flags: string[];
	season?: number;
	episode?: number;
	/** Text after an SxxEyy marker ("Show S01E02 - Pilot" → "Pilot"). */
	episodeTitle?: string;
}

export interface ParseOptions {
	/** Detect a release year (default true). Off for channel names ("Sport 2024"). */
	year?: boolean;
	/** Detect SxxEyy markers (default true). */
	episode?: boolean;
	/** Category mode: language/country names count even when not upper case ("Netherlands VOD"). */
	category?: boolean;
	/** Keep language/country names that end a name ("Sport Polska", "Ritmo Latino"). */
	keepLangNames?: boolean;
}

const MAX_YEAR = new Date().getFullYear() + 2;
const MIN_YEAR = 1900;
const SEP_CLASS = '|:\\-–—»>~•,_/\\\\';
const TRIM_START = new RegExp(`^[\\s${SEP_CLASS}.]+`);
const TRIM_END = new RegExp(`[\\s${SEP_CLASS}]+$`);
const LEADING = /^([^\s|:–—»>~•]+?)\s*(\||:|–|—|»|>|~|•|\s-\s|-)\s*(.*)$/s;
const LEADING_BARE = /^(\S+)\s+(.+)$/s;
const TRAILING = new RegExp(`^(.*?)[\\s${SEP_CLASS}(]+([^\\s${SEP_CLASS}]+)$`, 's');
const BRACKETS = /[[(（{【]([^\])）}】]*)[\])）}】]/g;
const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;
const BAR_LIKE = /[▎▍▌▋▊▉█┃│▏▕｜¦‖]/g;

interface State {
	audio: LangCode[];
	subs: LangCode[];
	quality: Quality;
	flags: Set<string>;
	year?: number;
	multi: boolean;
	dual: boolean;
	vo: boolean;
}

function isYear(s: string): number | undefined {
	if (!/^(19|20)\d{2}$/.test(s)) return undefined;
	const y = Number(s);
	return y >= MIN_YEAR && y <= MAX_YEAR ? y : undefined;
}

function hasLower(s: string): boolean {
	return /\p{Ll}/u.test(s);
}

function hasLetter(s: string): boolean {
	return /[\p{L}\p{N}]/u.test(s);
}

/**
 * Classify a token group ("NL/EN", "4K-NL", "NL Subs", "WEB-DL HEVC") as tags.
 * Returns null when any part is not a known tag (then the group is title text).
 */
function classifyGroup(content: string, allowYear: boolean): Tag[] | null {
	const trimmed = content.trim();
	if (!trimmed) return null;
	const whole = lookupTag(trimmed);
	if (whole) return [whole];
	if (allowYear) {
		const y = isYear(trimmed);
		if (y) return [{ k: 'year', y }];
	}
	const parts = trimmed.split(/[\s,/&|_+.]+|-/).filter(Boolean);
	if (parts.length === 0) return null;
	const out: Tag[] = [];
	for (let i = 0; i < parts.length; i++) {
		if (i + 1 < parts.length) {
			const pair = lookupTag(parts[i] + parts[i + 1]);
			if (pair) {
				out.push(pair);
				i++;
				continue;
			}
		}
		const tag = lookupTag(parts[i]);
		const y = allowYear ? isYear(parts[i]) : undefined;
		if (tag) out.push(tag);
		else if (y) out.push({ k: 'year', y });
		else return null;
	}
	return out;
}

function applyTags(st: State, tags: Tag[]) {
	let prev: Tag | undefined;
	for (const tag of tags) {
		switch (tag.k) {
			case 'lang':
				st.audio.push(tag.lang);
				break;
			case 'sub':
				st.subs.push(tag.lang);
				if (tag.vo) st.vo = true;
				break;
			case 'modsub':
				if (prev?.k === 'lang') {
					const i = st.audio.lastIndexOf(prev.lang);
					if (i !== -1) st.audio.splice(i, 1);
					st.subs.push(prev.lang);
				} else if (prev?.k === 'multi') {
					st.multi = false;
					st.flags.add('MULTISUB');
				}
				break;
			case 'q':
				if (st.quality === 'unknown') st.quality = tag.q;
				break;
			case 'flag':
				st.flags.add(tag.f);
				break;
			case 'multi':
				st.multi = true;
				break;
			case 'dual':
				st.dual = true;
				break;
			case 'multisub':
				st.flags.add('MULTISUB');
				break;
			case 'vo':
				st.vo = true;
				break;
			case 'year':
				st.year ??= tag.y;
				break;
		}
		prev = tag;
	}
}

/**
 * May `token` (classified as `tags`) be stripped outside brackets?
 * Upper-case tokens are fine; mixed-case tokens only when no tag is word-like ("De", "Web", "It").
 */
function bareOk(token: string, tags: Tag[], rest: string, opts: ParseOptions): boolean {
	const upper = !hasLower(token);
	for (const tag of tags) {
		if (tag.k === 'year' || tag.k === 'noise') return false;
		if (opts.keepLangNames && tag.k === 'lang' && !tag.risky) return false;
		if (upper) {
			// In an ALL CAPS title a two-letter code ("DE", "IT") is too ambiguous without separator.
			if (tag.k === 'lang' && tag.risky && token.length <= 3 && !hasLower(rest)) return false;
			continue;
		}
		if (tag.k === 'lang' && !tag.risky && opts.category) continue;
		if (isRiskyTag(tag) || tag.k === 'lang') return false;
	}
	return true;
}

/** Prefix token followed by a separator ("NL - ", "|EN| ", "4K-NL - "): lowercase codes ok, "De" not. */
function prefixOk(token: string, tags: Tag[]): boolean {
	const capitalised = /^\p{Lu}\p{Ll}+$/u.test(token) && token.length <= 3;
	for (const tag of tags) {
		if (tag.k === 'year') return false;
		if (capitalised && isRiskyTag(tag)) return false;
	}
	return true;
}

const PHRASE_TRAILING =
	/^(.*?)[\s|:\-–—,(]+(\S+)[\s.\-_]+(subs?|subbed|subtitles?|subtitled|ondertiteld|ondertitels|ondertiteling|gesproken|dubbed|dub|audio|spoken|untertitel)\s*$/is;

const SEASON_PATTERNS: RegExp[] = [
	/(?:^|[\s|:\-–—._(])[Ss](\d{1,2})[\s._-]*[EeXx](\d{1,3})(?=$|[^\d])/,
	/(?:^|[\s|:\-–—._(])(\d{1,2})x(\d{2,3})(?=$|[^\d])/,
	/(?:^|[\s|:\-–—(])(?:season|seizoen|staffel|saison|temporada|stagione|sezon|sezonu)\s*(\d{1,2})(?:[\s,:\-–—]*(?:episode|aflevering|afl\.?|folge|episodio|épisode|episode|bölüm|bolum|odcinek|ep\.?)\s*(\d{1,3}))?/i,
	/(?:^|[\s|:\-–—._(])[Ss](\d{1,2})(?=\s*$)/
];

/** Parse a provider title into a clean title plus language/quality/year/episode info. */
export function parseTitle(raw: string, opts: ParseOptions = {}): ParsedTitle {
	const p = parseCore(raw, opts);
	if (!p.cleanTitle) p.cleanTitle = (raw ?? '').replace(INVISIBLE, '').trim();
	return p;
}

function parseCore(raw: string, opts: ParseOptions): ParsedTitle {
	const allowYear = opts.year !== false;
	const st: State = {
		audio: [],
		subs: [],
		quality: 'unknown',
		flags: new Set(),
		multi: false,
		dual: false,
		vo: false
	};
	let s = (raw ?? '').normalize('NFKC').replace(INVISIBLE, '').replace(BAR_LIKE, '|');

	// 1. Bracket groups anywhere: [4K], (NL), (1999), [NL Subs], (Director's Cut)
	s = s.replace(BRACKETS, (match, content: string) => {
		const tags = classifyGroup(content, allowYear);
		if (!tags) return match;
		applyTags(st, tags);
		return ' ';
	});

	// 2. Leading prefixes: "NL - ", "|EN| ", "4K-NL - ", "FR ▎", "DE-", "EN " (bare)
	for (let guard = 0; guard < 8; guard++) {
		s = s.replace(TRIM_START, '');
		const m = LEADING.exec(s);
		if (m && hasLetter(m[3])) {
			const tags = classifyGroup(m[1], false);
			if (tags && prefixOk(m[1], tags)) {
				applyTags(st, tags);
				s = m[3];
				continue;
			}
		}
		const b = LEADING_BARE.exec(s);
		if (b && hasLetter(b[2])) {
			const tags = classifyGroup(b[1], false);
			if (tags && bareOk(b[1], tags, b[2], opts)) {
				applyTags(st, tags);
				s = b[2];
				continue;
			}
		}
		break;
	}

	// 3. Season / episode markers split the title from an episode title.
	let season: number | undefined;
	let episode: number | undefined;
	let episodeTitle: string | undefined;
	if (opts.episode !== false) {
		for (const re of SEASON_PATTERNS) {
			const m = re.exec(s);
			if (!m) continue;
			season = Number(m[1]);
			if (m[2] !== undefined) episode = Number(m[2]);
			const after = s
				.slice(m.index + m[0].length)
				.replace(TRIM_START, '')
				.trim();
			s = s.slice(0, m.index);
			if (after) episodeTitle = stripTrailing(after, st, false, opts);
			break;
		}
	}

	// 4. Trailing tags and year: "… 2023 4K", "… - 1999", "… NL Subs", "… |EN|"
	s = stripTrailing(s, st, allowYear, opts);

	const cleanTitle = s.replace(/\s+/g, ' ').replace(TRIM_START, '').replace(TRIM_END, '').trim();
	const audio = unique(st.audio);
	const subs = unique(st.subs);
	if (st.multi) st.flags.add('MULTI');
	if (st.dual) st.flags.add('DUAL');
	if (st.vo) st.flags.add('VO');
	if ((st.multi || st.dual) && audio.length < 2 && !audio.includes('en')) audio.push('en');

	return {
		cleanTitle,
		year: st.year,
		langs: audio,
		subLangs: subs,
		quality: st.quality,
		flags: [...st.flags],
		season,
		episode,
		episodeTitle: episodeTitle || undefined
	};
}

function stripTrailing(input: string, st: State, allowYear: boolean, opts: ParseOptions): string {
	let s = input;
	for (let guard = 0; guard < 12; guard++) {
		s = s.replace(TRIM_END, '');
		// "… NL Subs", "… NL Gesproken"
		const ph = PHRASE_TRAILING.exec(s);
		if (ph && hasLetter(ph[1])) {
			const langTag = lookupTag(ph[2]);
			const mod = lookupTag(ph[3]);
			if (langTag?.k === 'lang' && (mod?.k === 'modsub' || mod?.k === 'moddub')) {
				applyTags(st, [langTag, mod]);
				s = ph[1];
				continue;
			}
		}
		const m = TRAILING.exec(s);
		if (!m || !hasLetter(m[1])) break;
		const token = m[2];
		if (allowYear && st.year === undefined) {
			const y = isYear(token);
			if (y) {
				st.year = y;
				s = m[1];
				continue;
			}
		}
		const tags = classifyGroup(token, false);
		if (tags && bareOk(token, tags, m[1], opts)) {
			applyTags(st, tags);
			s = m[1];
			continue;
		}
		break;
	}
	return s;
}

function unique<T>(arr: T[]): T[] {
	return [...new Set(arr)];
}

// ---------------------------------------------------------------------------
// Categories ("NL | FILMS", "Netherlands VOD", "FR - Films", "VOD | ENGLISH 4K")
// ---------------------------------------------------------------------------

export interface ParsedCategory {
	langs: LangCode[];
	subLangs: LangCode[];
	quality: Quality;
	vo: boolean;
	/** Category without language/quality tags ("NL | Sport" → "Sport"). */
	label: string;
}

const categoryCache = new Map<string, ParsedCategory>();

export function parseCategory(category: string | undefined): ParsedCategory {
	if (!category) return { langs: [], subLangs: [], quality: 'unknown', vo: false, label: '' };
	const cached = categoryCache.get(category);
	if (cached) return cached;
	const p = parseCore(category, { year: false, episode: false, category: true });
	const langs = [...p.langs];
	// Names anywhere in the label: "Films uit Nederland", "Movies Arabic HD"
	if (langs.length === 0) {
		for (const word of p.cleanTitle.split(/[\s|:\-–—/,()[\]]+/)) {
			const tag = word.length >= 4 ? lookupTag(word) : undefined;
			if (tag?.k === 'lang' && !tag.risky) {
				langs.push(tag.lang);
				break;
			}
		}
	}
	const words = p.cleanTitle.split(/\s+/).filter(Boolean);
	const subLangs = [...p.subLangs];
	let quality = p.quality;
	let vo = p.flags.includes('VO');
	if (words.length === 1) {
		// A lone tag left over: "FR | VOSTFR", "4K NL", "EN | UHD"
		const tag = lookupTag(words[0]);
		if (tag?.k === 'lang' && langs.length === 0) langs.push(tag.lang);
		else if (tag?.k === 'sub') {
			subLangs.push(tag.lang);
			vo ||= !!tag.vo;
		} else if (tag?.k === 'q' && quality === 'unknown') quality = tag.q;
		else if (tag?.k === 'vo') vo = true;
	}
	// Label without leftover language/quality words ("VOD | ENGLISH" → "", "4K NL" → "").
	const label = words
		.filter((w) => {
			const tag = lookupTag(w);
			if (!tag) return true;
			if (tag.k === 'lang') return tag.risky && hasLower(w);
			if (tag.k === 'sub' || tag.k === 'vo') return false;
			return !(tag.k === 'noise' || tag.k === 'q') || hasLower(w);
		})
		.join(' ')
		.replace(TRIM_START, '')
		.replace(TRIM_END, '');
	const out: ParsedCategory = {
		langs: unique(langs),
		subLangs: unique(subLangs),
		quality,
		vo,
		label
	};
	if (categoryCache.size > 5000) categoryCache.clear();
	categoryCache.set(category, out);
	return out;
}

// ---------------------------------------------------------------------------
// Match keys
// ---------------------------------------------------------------------------

const ARTICLES = new Set([
	'the',
	'a',
	'an',
	'de',
	'het',
	'een',
	'der',
	'die',
	'das',
	'ein',
	'eine',
	'le',
	'la',
	'les',
	'l',
	'un',
	'une',
	'el',
	'los',
	'las',
	'il',
	'lo',
	'gli',
	'o',
	'os',
	'as'
]);
const CONNECTORS = new Set(['and', 'en', 'und', 'et']);
const PART_WORDS = new Set([
	'part',
	'deel',
	'teil',
	'partie',
	'parte',
	'chapter',
	'hoofdstuk',
	'kapitel',
	'chapitre',
	'capitulo',
	'capitolo',
	'vol',
	'volume',
	'episode',
	'bolum'
]);
const NUMBER_WORDS: Record<string, string> = {
	one: '1',
	two: '2',
	three: '3',
	four: '4',
	five: '5',
	een: '1',
	twee: '2',
	drie: '3',
	vier: '4',
	vijf: '5',
	eins: '1',
	zwei: '2',
	drei: '3',
	un: '1',
	deux: '2',
	trois: '3',
	uno: '1',
	dos: '2',
	tres: '3',
	due: '2',
	tre: '3'
};
const ROMAN = /^(x{0,2})(ix|iv|v?i{0,3})$/;
const ROMAN_VALUES: Record<string, number> = { i: 1, v: 5, x: 10 };

function romanToInt(tok: string): number | undefined {
	if (tok.length < 2 || !ROMAN.test(tok)) return undefined;
	let total = 0;
	for (let i = 0; i < tok.length; i++) {
		const v = ROMAN_VALUES[tok[i]];
		const next = ROMAN_VALUES[tok[i + 1]] ?? 0;
		total += v < next ? -v : v;
	}
	return total >= 2 && total <= 29 ? total : undefined;
}

const SPECIAL_LETTERS: Record<string, string> = {
	ß: 'ss',
	æ: 'ae',
	œ: 'oe',
	ø: 'o',
	ł: 'l',
	đ: 'd',
	ð: 'd',
	ı: 'i',
	þ: 'th',
	ħ: 'h'
};

/** Lowercase, strip diacritics and punctuation; "&" → " and ". Used for keys and search. */
export function foldText(s: string): string {
	return s
		.normalize('NFKD')
		.replace(/\p{M}/gu, '')
		.toLowerCase()
		.replace(/[ßæœøłđðıþħ]/g, (c) => SPECIAL_LETTERS[c] ?? c)
		.replace(/['’`´ʼ]s\b/g, 's')
		.replace(/&/g, ' and ')
		.replace(/[^\p{L}\p{N}]+/gu, ' ')
		.trim();
}

const keyCache = new Map<string, string>();

/** Comparison key for a clean title (see module docs). */
export function matchKey(title: string): string {
	const cached = keyCache.get(title);
	if (cached !== undefined) return cached;
	const tokens = foldText(title).split(' ').filter(Boolean);
	const out: string[] = [];
	for (let i = 0; i < tokens.length; i++) {
		let tok = tokens[i];
		const r = romanToInt(tok);
		if (r !== undefined) tok = String(r);
		else if (CONNECTORS.has(tok) && i > 0) tok = 'and';
		if (PART_WORDS.has(tok) && i + 1 < tokens.length) {
			const next = tokens[i + 1];
			const n = NUMBER_WORDS[next] ?? romanToInt(next)?.toString() ?? next;
			if (/^\d+$/.test(n) || next === 'i') {
				out.push(next === 'i' ? '1' : n);
				i++;
				continue;
			}
		}
		out.push(tok);
	}
	if (out.length > 1 && ARTICLES.has(out[0])) out.shift();
	const key = out.join(' ');
	if (keyCache.size > 200_000) keyCache.clear();
	keyCache.set(title, key);
	return key;
}

/** Base title before a subtitle (": " or " - "), when there is one. */
export function baseTitle(title: string): string | undefined {
	const m = /^(.+?)(?:\s*:\s+|\s+[-–—]\s+)\S/.exec(title);
	if (!m) return undefined;
	const base = m[1].trim();
	return foldText(base).length >= 2 ? base : undefined;
}

/** Strong key plus weak (subtitle-less) keys for a title. */
export function titleKeys(title: string): { key: string; weak?: string } {
	const key = matchKey(title);
	const base = baseTitle(title);
	const weak = base ? matchKey(base) : undefined;
	return { key, weak: weak && weak !== key ? weak : undefined };
}

/** URL-safe ASCII slug ('Het Laatste Licht' → 'het-laatste-licht'); hash fallback for non-Latin. */
export function slugify(title: string): string {
	const folded = foldText(title);
	const ascii = folded
		.replace(/[^a-z0-9 ]+/g, ' ')
		.trim()
		.replace(/\s+/g, '-')
		.slice(0, 60)
		.replace(/-+$/, '');
	if (ascii.length >= 2 && ascii.length * 2 >= folded.replace(/\s/g, '').length) return ascii;
	return (ascii ? ascii + '-' : '') + 'x' + hash36(folded);
}

export function hash36(s: string): string {
	let h = 2166136261;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return (h >>> 0).toString(36);
}

/** "Name (Character)" / "Name as Character" / "Name als Character" → { name, character }. */
export function parsePerson(s: string): { name: string; character?: string } {
	const trimmed = s.trim();
	const paren = /^(.+?)\s*\((.+)\)$/.exec(trimmed);
	if (paren) return { name: paren[1].trim(), character: paren[2].trim() };
	const as = /^(.+?)\s+(?:as|als|als:|comme|como|come)\s+(.+)$/i.exec(trimmed);
	if (as) return { name: as[1].trim(), character: as[2].trim() };
	return { name: trimmed };
}

/** Episode titles that carry no information ("Episode 3", "Aflevering 3", "S01E03"). */
export function isGenericEpisodeTitle(title: string | undefined, seriesTitle?: string): boolean {
	if (!title) return true;
	const f = foldText(title);
	if (!f) return true;
	if (
		/^(episode|aflevering|afl|folge|episodio|bolum|odcinek|avsnitt|afsnit|jakso|epizod|серия|эпизод|الحلقة|حلقة|ep|e|s\s*\d+\s*e)\s*\d+$/.test(
			f
		)
	)
		return true;
	if (/^s\d+\s*e\d+$/.test(f) || /^\d+$/.test(f)) return true;
	return seriesTitle ? matchKey(title) === matchKey(seriesTitle) : false;
}
