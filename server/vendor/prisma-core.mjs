//#region \0rolldown/runtime.js
var __defProp = Object.defineProperty;
var __esmMin = (fn, res, err) => () => {
	if (err) throw err[0];
	try {
		return fn && (res = fn(fn = 0)), res;
	} catch (e) {
		throw err = [e], e;
	}
};
var __commonJSMin = (cb, mod) => () => (mod || (cb((mod = { exports: {} }).exports, mod), cb = null), mod.exports);
var __exportAll = (all, no_symbols) => {
	let target = {};
	for (var name in all) __defProp(target, name, {
		get: all[name],
		enumerable: true
	});
	if (!no_symbols) __defProp(target, Symbol.toStringTag, { value: "Module" });
	return target;
};
Object.keys({
	nl: {
		nl: "Nederlands",
		en: "Dutch",
		native: "Nederlands"
	},
	en: {
		nl: "Engels",
		en: "English",
		native: "English"
	},
	de: {
		nl: "Duits",
		en: "German",
		native: "Deutsch"
	},
	fr: {
		nl: "Frans",
		en: "French",
		native: "Français"
	},
	es: {
		nl: "Spaans",
		en: "Spanish",
		native: "Español"
	},
	it: {
		nl: "Italiaans",
		en: "Italian",
		native: "Italiano"
	},
	tr: {
		nl: "Turks",
		en: "Turkish",
		native: "Türkçe"
	},
	ar: {
		nl: "Arabisch",
		en: "Arabic",
		native: "العربية"
	},
	pl: {
		nl: "Pools",
		en: "Polish",
		native: "Polski"
	},
	pt: {
		nl: "Portugees",
		en: "Portuguese",
		native: "Português"
	},
	ru: {
		nl: "Russisch",
		en: "Russian",
		native: "Русский"
	},
	ja: {
		nl: "Japans",
		en: "Japanese",
		native: "日本語"
	},
	ko: {
		nl: "Koreaans",
		en: "Korean",
		native: "한국어"
	},
	zh: {
		nl: "Chinees",
		en: "Chinese",
		native: "中文"
	},
	hi: {
		nl: "Hindi",
		en: "Hindi",
		native: "हिन्दी"
	},
	sv: {
		nl: "Zweeds",
		en: "Swedish",
		native: "Svenska"
	},
	da: {
		nl: "Deens",
		en: "Danish",
		native: "Dansk"
	},
	no: {
		nl: "Noors",
		en: "Norwegian",
		native: "Norsk"
	},
	fi: {
		nl: "Fins",
		en: "Finnish",
		native: "Suomi"
	},
	el: {
		nl: "Grieks",
		en: "Greek",
		native: "Ελληνικά"
	},
	ro: {
		nl: "Roemeens",
		en: "Romanian",
		native: "Română"
	},
	und: {
		nl: "Onbekend",
		en: "Unknown",
		native: "—"
	}
}).filter((c) => c !== "und");
var QUALITY_ORDER = [
	"4K",
	"FHD",
	"HD",
	"SD",
	"unknown"
];
function qualityRank(q) {
	const i = QUALITY_ORDER.indexOf(q);
	return i === -1 ? QUALITY_ORDER.length : i;
}
//#endregion
//#region src/lib/tmdb/types.ts
function tmdbLookupKey(kind, key, year) {
	return `${kind}|${key}|${year ?? ""}`;
}
function tmdbMetaKey(kind, id) {
	return `${kind}-${id}`;
}
//#endregion
//#region src/lib/merge/match.ts
var ClusterSet = class {
	parent;
	agg;
	constructor(items) {
		this.parent = new Int32Array(items.length);
		this.agg = items.map((it, i) => {
			this.parent[i] = i;
			return {
				tmdb: it.tmdbId,
				imdb: it.imdbId,
				minYear: it.year,
				maxYear: it.year,
				minDur: it.durationSec || void 0,
				maxDur: it.durationSec || void 0,
				size: 1
			};
		});
	}
	find(i) {
		let r = i;
		while (this.parent[r] !== r) r = this.parent[r];
		while (this.parent[i] !== r) {
			const next = this.parent[i];
			this.parent[i] = r;
			i = next;
		}
		return r;
	}
	/** Would merging the clusters of a and b create a conflict? */
	compatible(ra, rb, mode) {
		const a = this.agg[ra];
		const b = this.agg[rb];
		if (a.tmdb !== void 0 && b.tmdb !== void 0 && a.tmdb !== b.tmdb) return false;
		if (a.imdb !== void 0 && b.imdb !== void 0 && a.imdb !== b.imdb) return false;
		if (a.minYear !== void 0 && b.minYear !== void 0) {
			if (Math.max(a.maxYear, b.maxYear) - Math.min(a.minYear, b.minYear) > (mode === "id" ? 2 : 1)) return false;
		}
		if (mode === "loose" && a.minDur !== void 0 && b.minDur !== void 0) {
			const lo = Math.min(a.minDur, b.minDur);
			if (Math.max(a.maxDur, b.maxDur) > lo * 1.25) return false;
		}
		return true;
	}
	union(i, j, mode) {
		let ra = this.find(i);
		let rb = this.find(j);
		if (ra === rb) return true;
		if (!this.compatible(ra, rb, mode)) return false;
		if (this.agg[ra].size < this.agg[rb].size) [ra, rb] = [rb, ra];
		const a = this.agg[ra];
		const b = this.agg[rb];
		this.parent[rb] = ra;
		a.tmdb ??= b.tmdb;
		a.imdb ??= b.imdb;
		if (b.minYear !== void 0) {
			a.minYear = a.minYear === void 0 ? b.minYear : Math.min(a.minYear, b.minYear);
			a.maxYear = a.maxYear === void 0 ? b.maxYear : Math.max(a.maxYear, b.maxYear);
		}
		if (b.minDur !== void 0) {
			a.minDur = a.minDur === void 0 ? b.minDur : Math.min(a.minDur, b.minDur);
			a.maxDur = a.maxDur === void 0 ? b.maxDur : Math.max(a.maxDur, b.maxDur);
		}
		a.size += b.size;
		return true;
	}
	groups() {
		const map = /* @__PURE__ */ new Map();
		for (let i = 0; i < this.parent.length; i++) {
			const r = this.find(i);
			const g = map.get(r);
			if (g) g.push(i);
			else map.set(r, [i]);
		}
		return [...map.values()];
	}
};
function push(map, key, i) {
	const list = map.get(key);
	if (list) list.push(i);
	else map.set(key, [i]);
}
/** Union every member of each bucket with the bucket's first compatible member. */
function unionBuckets(cs, buckets, mode) {
	for (const list of buckets.values()) {
		if (list.length < 2) continue;
		for (let k = 1; k < list.length; k++) if (!cs.union(list[0], list[k], mode)) {
			for (let m = 1; m < k; m++) if (cs.union(list[m], list[k], mode)) break;
		}
	}
}
/** Cluster items; returns groups of item indexes (each group = one Title). */
function clusterItems(items) {
	const cs = new ClusterSet(items);
	const byTmdb = /* @__PURE__ */ new Map();
	const byImdb = /* @__PURE__ */ new Map();
	const byKeyYear = /* @__PURE__ */ new Map();
	const byKey = /* @__PURE__ */ new Map();
	items.forEach((it, i) => {
		if (it.tmdbId) push(byTmdb, `${it.kind}|${it.tmdbId}`, i);
		if (it.imdbId) push(byImdb, `${it.kind}|${it.imdbId}`, i);
		for (const key of it.keys) {
			if (!key) continue;
			push(byKey, `${it.kind}|${key}`, i);
			if (it.year) push(byKeyYear, `${it.kind}|${key}|${it.year}`, i);
		}
	});
	unionBuckets(cs, byTmdb, "id");
	unionBuckets(cs, byImdb, "id");
	unionBuckets(cs, byKeyYear, "title");
	items.forEach((it, i) => {
		if (!it.year) return;
		for (const key of it.keys) {
			const other = byKeyYear.get(`${it.kind}|${key}|${it.year + 1}`);
			if (other) for (const j of other) cs.union(i, j, "loose");
		}
	});
	items.forEach((it, i) => {
		if (!it.year) return;
		for (const weak of it.weakKeys) {
			const other = byKeyYear.get(`${it.kind}|${weak}|${it.year}`);
			if (other) for (const j of other) cs.union(i, j, "loose");
		}
	});
	items.forEach((it, i) => {
		const root = cs.find(i);
		if (cs.agg[root].minYear !== void 0) return;
		const dated = /* @__PURE__ */ new Set();
		const undated = [];
		for (const key of it.keys) for (const j of byKey.get(`${it.kind}|${key}`) ?? []) {
			const rj = cs.find(j);
			if (rj === root) continue;
			if (cs.agg[rj].minYear !== void 0) dated.add(rj);
			else undated.push(j);
		}
		if (dated.size === 1) cs.union(i, [...dated][0], "loose");
		else if (dated.size === 0) for (const j of undated) cs.union(i, j, "loose");
	});
	return cs.groups();
}
//#endregion
//#region src/lib/merge/tags.ts
/** Short language codes (2–3 letters). "Risky" because they collide with words ("DE", "IT", "NO"). */
var LANG_CODES = {
	nl: [
		"NL",
		"NLD",
		"NED",
		"DUT",
		"HOL",
		"VL",
		"BENL"
	],
	en: [
		"EN",
		"ENG",
		"UK",
		"US",
		"USA",
		"GB"
	],
	de: [
		"DE",
		"GER",
		"DEU",
		"GE"
	],
	fr: [
		"FR",
		"FRE",
		"FRA",
		"VF",
		"VFF",
		"VFQ",
		"VFI"
	],
	es: [
		"ES",
		"SPA",
		"ESP",
		"LAT",
		"CAST"
	],
	it: ["IT", "ITA"],
	tr: [
		"TR",
		"TUR",
		"TRK"
	],
	ar: [
		"AR",
		"ARA",
		"ARB"
	],
	pl: ["PL", "POL"],
	pt: [
		"PT",
		"POR",
		"PTBR",
		"BR",
		"PTPT"
	],
	ru: ["RU", "RUS"],
	sv: [
		"SV",
		"SE",
		"SWE"
	],
	da: [
		"DA",
		"DK",
		"DAN"
	],
	no: ["NO", "NOR"],
	fi: ["FI", "FIN"],
	el: [
		"EL",
		"GR",
		"GRE",
		"ELL"
	],
	ro: [
		"RO",
		"ROU",
		"ROM",
		"RUM"
	],
	hi: ["HI", "HIN"],
	ko: [
		"KO",
		"KR",
		"KOR"
	],
	ja: [
		"JA",
		"JP",
		"JAP",
		"JPN"
	],
	zh: [
		"ZH",
		"CN",
		"CHI",
		"CHN",
		"ZHO"
	]
};
/** Language and country names (safe: longer than 3 letters or non-Latin). */
var LANG_NAMES = {
	nl: [
		"DUTCH",
		"NEDERLANDS",
		"NEDERLANDSE",
		"HOLLANDS",
		"VLAAMS",
		"FLEMISH",
		"NETHERLANDS",
		"NEDERLAND",
		"HOLLAND"
	],
	en: [
		"ENGLISH",
		"ENGELS",
		"ENGLAND",
		"BRITISH",
		"AMERICAN",
		"ENGLISCH",
		"ANGLAIS",
		"INGLES"
	],
	de: [
		"GERMAN",
		"DEUTSCH",
		"DEUTSCHE",
		"GERMANY",
		"DEUTSCHLAND",
		"DUITS",
		"ALLEMAND",
		"ALEMAN"
	],
	fr: [
		"FRENCH",
		"FRANCAIS",
		"FRANCAISE",
		"FRANCE",
		"FRANS",
		"TRUEFRENCH",
		"FRANZOSISCH"
	],
	es: [
		"SPANISH",
		"ESPANOL",
		"CASTELLANO",
		"LATINO",
		"SPAIN",
		"ESPANA",
		"SPAANS",
		"MEXICO"
	],
	it: [
		"ITALIAN",
		"ITALIANO",
		"ITALIA",
		"ITALY",
		"ITALIAANS"
	],
	tr: [
		"TURKISH",
		"TURKCE",
		"TURKEY",
		"TURKIYE",
		"TURKS",
		"TURK"
	],
	ar: [
		"ARABIC",
		"ARABISCH",
		"ARABE",
		"ARAB",
		"عربي",
		"العربية",
		"عربية",
		"عرب"
	],
	pl: [
		"POLISH",
		"POLSKI",
		"POLSKA",
		"POLAND",
		"POOLS",
		"LEKTOR",
		"DUBBINGPL"
	],
	pt: [
		"PORTUGUESE",
		"PORTUGUES",
		"PORTUGAL",
		"BRASIL",
		"BRAZIL",
		"BRAZILIAN",
		"PORTUGEES"
	],
	ru: [
		"RUSSIAN",
		"RUSSIA",
		"RUSSISCH",
		"РУССКИЙ"
	],
	sv: [
		"SWEDISH",
		"SVENSKA",
		"SWEDEN",
		"SVERIGE",
		"ZWEEDS"
	],
	da: [
		"DANISH",
		"DANSK",
		"DENMARK",
		"DANMARK",
		"DEENS"
	],
	no: [
		"NORWEGIAN",
		"NORSK",
		"NORWAY",
		"NORGE",
		"NOORS"
	],
	fi: [
		"FINNISH",
		"SUOMI",
		"FINLAND",
		"FINS"
	],
	el: [
		"GREEK",
		"GREECE",
		"ELLINIKA",
		"GRIEKS"
	],
	ro: [
		"ROMANIAN",
		"ROMANA",
		"ROMANIA",
		"ROEMEENS"
	],
	hi: [
		"HINDI",
		"INDIA",
		"INDIAN",
		"BOLLYWOOD"
	],
	ko: [
		"KOREAN",
		"KOREA",
		"KOREAANS"
	],
	ja: [
		"JAPANESE",
		"JAPAN",
		"JAPANS"
	],
	zh: [
		"CHINESE",
		"CHINA",
		"MANDARIN",
		"CANTONESE",
		"CHINEES"
	]
};
/** Subtitle tags: one token meaning "subtitles in <lang>" (vo = original audio). */
var SUB_TAGS = {
	VOSTFR: {
		lang: "fr",
		vo: true
	},
	VOSTF: {
		lang: "fr",
		vo: true
	},
	SUBFRENCH: {
		lang: "fr",
		vo: true
	},
	STFR: { lang: "fr" },
	VOSE: {
		lang: "es",
		vo: true
	},
	VOSI: {
		lang: "it",
		vo: true
	},
	SUBITA: {
		lang: "it",
		vo: true
	},
	NLSUB: { lang: "nl" },
	NLSUBS: { lang: "nl" },
	NLSUBBED: { lang: "nl" },
	ENGSUB: { lang: "en" },
	ENSUB: { lang: "en" },
	ENGSUBS: { lang: "en" },
	LEGENDADO: {
		lang: "pt",
		vo: true
	},
	LEG: {
		lang: "pt",
		vo: true
	},
	ALTYAZI: {
		lang: "tr",
		vo: true
	},
	ALTYAZILI: {
		lang: "tr",
		vo: true
	},
	NAPISY: {
		lang: "pl",
		vo: true
	},
	PLSUB: {
		lang: "pl",
		vo: true
	},
	DEUTSCHUT: { lang: "de" }
};
/** Audio-language words that are not names (dubbing markers). */
var DUB_TAGS = {
	DUBLADO: "pt",
	DUBLAJ: "tr",
	DUBBING: "pl",
	MULTIDUB: "en"
};
var QUALITY_TAGS = {
	"4K": "4K",
	UHD: "4K",
	"2160P": "4K",
	"4KUHD": "4K",
	UHD4K: "4K",
	ULTRAHD: "4K",
	FHD: "FHD",
	FULLHD: "FHD",
	"1080P": "FHD",
	"1080I": "FHD",
	HD: "HD",
	"720P": "HD",
	HDTV: "HD",
	HDRIP: "HD",
	SD: "SD",
	"480P": "SD",
	"576P": "SD",
	"360P": "SD",
	DVDRIP: "SD",
	DVD: "SD",
	LQ: "SD"
};
/** Quality tags that look like words and need upper case in bare positions. */
var RISKY_QUALITY = /* @__PURE__ */ new Set([
	"HD",
	"SD",
	"LQ",
	"DVD"
]);
var FLAG_TAGS = {
	HEVC: "HEVC",
	H265: "HEVC",
	X265: "HEVC",
	H264: "H264",
	X264: "H264",
	AVC: "H264",
	AV1: "AV1",
	HDR: "HDR",
	HDR10: "HDR",
	"HDR10+": "HDR",
	HLG: "HDR",
	DV: "DV",
	DOVI: "DV",
	DOLBYVISION: "DV",
	BLURAY: "BluRay",
	BDRIP: "BluRay",
	BRRIP: "BluRay",
	BD: "BluRay",
	WEBDL: "WEB-DL",
	WEBRIP: "WEB-DL",
	WEB: "WEB-DL",
	REMUX: "REMUX",
	"3D": "3D",
	ATMOS: "Atmos",
	DTS: "DTS",
	DTSHD: "DTS",
	TRUEHD: "TrueHD",
	DD51: "5.1",
	"51": "5.1",
	"71": "7.1",
	AAC: "AAC",
	AC3: "AC3",
	EAC3: "AC3",
	DDP: "AC3",
	"10BIT": "10bit",
	"60FPS": "60fps",
	"50FPS": "50fps",
	IMAX: "IMAX",
	EXTENDED: "Extended",
	UNCUT: "Uncut",
	UNRATED: "Unrated",
	DIRECTORSCUT: "Director's Cut",
	REMASTERED: "Remastered",
	THEATRICAL: "Theatrical",
	CAM: "CAM",
	HDCAM: "CAM",
	HDTS: "CAM",
	TELESYNC: "CAM",
	BACKUP: "Backup",
	RAW: "Raw"
};
/** Flag tags that look like ordinary words. */
var RISKY_FLAGS = /* @__PURE__ */ new Set([
	"WEB",
	"BD",
	"DV",
	"CAM",
	"RAW",
	"BACKUP",
	"UNCUT",
	"EXTENDED",
	"THEATRICAL",
	"AVC",
	"IMAX",
	"51",
	"71",
	"3D",
	"AAC",
	"DTS",
	"REMASTERED",
	"UNRATED"
]);
var NOISE = [
	"VOD",
	"NEW",
	"NIEUW",
	"EDITION",
	"VERSION",
	"VERSIE",
	"DL",
	"RIP",
	"HQ",
	"TOP"
];
var MOD_SUB = [
	"SUB",
	"SUBS",
	"SUBBED",
	"SUBTITLE",
	"SUBTITLES",
	"SUBTITLED",
	"ONDERTITELD",
	"ONDERTITELS",
	"ONDERTITELING",
	"OT",
	"UNTERTITEL",
	"SOUSTITRES",
	"SUBTITULADO",
	"SOTTOTITOLI"
];
var MOD_DUB = [
	"GESPROKEN",
	"DUB",
	"DUBBED",
	"AUDIO",
	"SPOKEN",
	"SYNCHRO",
	"SYNCHRONISIERT"
];
var TAGS = /* @__PURE__ */ new Map();
for (const [lang, codes] of Object.entries(LANG_CODES)) for (const c of codes) TAGS.set(c, {
	k: "lang",
	lang,
	risky: true
});
for (const [lang, names] of Object.entries(LANG_NAMES)) for (const n of names) TAGS.set(compactToken(n), {
	k: "lang",
	lang,
	risky: false
});
for (const [tok, lang] of Object.entries(DUB_TAGS)) TAGS.set(tok, {
	k: "lang",
	lang,
	risky: false
});
for (const [tok, v] of Object.entries(SUB_TAGS)) TAGS.set(tok, {
	k: "sub",
	...v
});
for (const [tok, q] of Object.entries(QUALITY_TAGS)) TAGS.set(tok, {
	k: "q",
	q,
	risky: RISKY_QUALITY.has(tok)
});
for (const [tok, f] of Object.entries(FLAG_TAGS)) TAGS.set(tok, {
	k: "flag",
	f,
	risky: RISKY_FLAGS.has(tok)
});
for (const tok of [
	"MULTI",
	"MULTIAUDIO",
	"MULTILANG",
	"MULTILANGUAGE",
	"MULTIDUB"
]) TAGS.set(tok, { k: "multi" });
for (const tok of [
	"DUAL",
	"DUALAUDIO",
	"DUALAUDIOS"
]) TAGS.set(tok, { k: "dual" });
for (const tok of [
	"MULTISUB",
	"MULTISUBS",
	"MULTISUBTITLES"
]) TAGS.set(tok, { k: "multisub" });
TAGS.set("VO", {
	k: "vo",
	risky: true
});
TAGS.set("VOST", { k: "vo" });
TAGS.set("ORIGINAL", { k: "vo" });
for (const tok of NOISE) TAGS.set(tok, { k: "noise" });
for (const tok of MOD_SUB) TAGS.set(tok, { k: "modsub" });
for (const tok of MOD_DUB) TAGS.set(tok, { k: "moddub" });
/** Uppercase, strip diacritics, keep only letters, digits and '+'. */
function compactToken(s) {
	return s.normalize("NFKD").replace(/\p{M}/gu, "").replace(/ı/g, "i").toUpperCase().replace(/[^\p{L}\p{N}+]/gu, "");
}
function lookupTag(token) {
	return TAGS.get(compactToken(token));
}
/** True when the tag is only trustworthy as an upper-case token outside brackets. */
function isRiskyTag(tag) {
	return (tag.k === "lang" || tag.k === "q" || tag.k === "flag" || tag.k === "vo") && "risky" in tag && tag.risky === true || tag.k === "modsub" || tag.k === "moddub" || tag.k === "noise";
}
Object.keys(LANG_CODES);
//#endregion
//#region src/lib/merge/normalize.ts
var MAX_YEAR = (/* @__PURE__ */ new Date()).getFullYear() + 2;
var MIN_YEAR = 1900;
var SEP_CLASS = "|:\\-–—»>~•,_/\\\\";
var TRIM_START = new RegExp(`^[\\s${SEP_CLASS}.]+`);
var TRIM_END = new RegExp(`[\\s${SEP_CLASS}]+$`);
var LEADING = /^([^\s|:–—»>~•]+?)\s*(\||:|–|—|»|>|~|•|\s-\s|-)\s*(.*)$/s;
var LEADING_BARE = /^(\S+)\s+(.+)$/s;
var TRAILING = new RegExp(`^(.*?)[\\s${SEP_CLASS}(]+([^\\s${SEP_CLASS}]+)$`, "s");
var BRACKETS = /[[(（{【]([^\])）}】]*)[\])）}】]/g;
var INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;
var BAR_LIKE = /[▎▍▌▋▊▉█┃│▏▕｜¦‖]/g;
function isYear(s) {
	if (!/^(19|20)\d{2}$/.test(s)) return void 0;
	const y = Number(s);
	return y >= MIN_YEAR && y <= MAX_YEAR ? y : void 0;
}
function hasLower(s) {
	return /\p{Ll}/u.test(s);
}
function hasLetter(s) {
	return /[\p{L}\p{N}]/u.test(s);
}
/**
* Classify a token group ("NL/EN", "4K-NL", "NL Subs", "WEB-DL HEVC") as tags.
* Returns null when any part is not a known tag (then the group is title text).
*/
function classifyGroup(content, allowYear) {
	const trimmed = content.trim();
	if (!trimmed) return null;
	const whole = lookupTag(trimmed);
	if (whole) return [whole];
	if (allowYear) {
		const y = isYear(trimmed);
		if (y) return [{
			k: "year",
			y
		}];
	}
	const parts = trimmed.split(/[\s,/&|_+.]+|-/).filter(Boolean);
	if (parts.length === 0) return null;
	const out = [];
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
		const y = allowYear ? isYear(parts[i]) : void 0;
		if (tag) out.push(tag);
		else if (y) out.push({
			k: "year",
			y
		});
		else return null;
	}
	return out;
}
function applyTags(st, tags) {
	let prev;
	for (const tag of tags) {
		switch (tag.k) {
			case "lang":
				st.audio.push(tag.lang);
				break;
			case "sub":
				st.subs.push(tag.lang);
				if (tag.vo) st.vo = true;
				break;
			case "modsub":
				if (prev?.k === "lang") {
					const i = st.audio.lastIndexOf(prev.lang);
					if (i !== -1) st.audio.splice(i, 1);
					st.subs.push(prev.lang);
				} else if (prev?.k === "multi") {
					st.multi = false;
					st.flags.add("MULTISUB");
				}
				break;
			case "q":
				if (st.quality === "unknown") st.quality = tag.q;
				break;
			case "flag":
				st.flags.add(tag.f);
				break;
			case "multi":
				st.multi = true;
				break;
			case "dual":
				st.dual = true;
				break;
			case "multisub":
				st.flags.add("MULTISUB");
				break;
			case "vo":
				st.vo = true;
				break;
			case "year": st.year ??= tag.y;
		}
		prev = tag;
	}
}
/**
* May `token` (classified as `tags`) be stripped outside brackets?
* Upper-case tokens are fine; mixed-case tokens only when no tag is word-like ("De", "Web", "It").
*/
function bareOk(token, tags, rest, opts) {
	const upper = !hasLower(token);
	for (const tag of tags) {
		if (tag.k === "year" || tag.k === "noise") return false;
		if (opts.keepLangNames && tag.k === "lang" && !tag.risky) return false;
		if (upper) {
			if (tag.k === "lang" && tag.risky && token.length <= 3 && !hasLower(rest)) return false;
			continue;
		}
		if (tag.k === "lang" && !tag.risky && opts.category) continue;
		if (isRiskyTag(tag) || tag.k === "lang") return false;
	}
	return true;
}
/** Prefix token followed by a separator ("NL - ", "|EN| ", "4K-NL - "): lowercase codes ok, "De" not. */
function prefixOk(token, tags) {
	const capitalised = /^\p{Lu}\p{Ll}+$/u.test(token) && token.length <= 3;
	for (const tag of tags) {
		if (tag.k === "year") return false;
		if (capitalised && isRiskyTag(tag)) return false;
	}
	return true;
}
var PHRASE_TRAILING = /^(.*?)[\s|:\-–—,(]+(\S+)[\s.\-_]+(subs?|subbed|subtitles?|subtitled|ondertiteld|ondertitels|ondertiteling|gesproken|dubbed|dub|audio|spoken|untertitel)\s*$/is;
var SEASON_PATTERNS = [
	/(?:^|[\s|:\-–—._(])[Ss](\d{1,2})[\s._-]*[EeXx](\d{1,3})(?=$|[^\d])/,
	/(?:^|[\s|:\-–—._(])(\d{1,2})x(\d{2,3})(?=$|[^\d])/,
	/(?:^|[\s|:\-–—(])(?:season|seizoen|staffel|saison|temporada|stagione|sezon|sezonu)\s*(\d{1,2})(?:[\s,:\-–—]*(?:episode|aflevering|afl\.?|folge|episodio|épisode|episode|bölüm|bolum|odcinek|ep\.?)\s*(\d{1,3}))?/i,
	/(?:^|[\s|:\-–—._(])[Ss](\d{1,2})(?=\s*$)/
];
/** Parse a provider title into a clean title plus language/quality/year/episode info. */
function parseTitle(raw, opts = {}) {
	const p = parseCore(raw, opts);
	if (!p.cleanTitle) p.cleanTitle = (raw ?? "").replace(INVISIBLE, "").trim();
	return p;
}
function parseCore(raw, opts) {
	const allowYear = opts.year !== false;
	const st = {
		audio: [],
		subs: [],
		quality: "unknown",
		flags: /* @__PURE__ */ new Set(),
		multi: false,
		dual: false,
		vo: false
	};
	let s = (raw ?? "").normalize("NFKC").replace(INVISIBLE, "").replace(BAR_LIKE, "|");
	s = s.replace(BRACKETS, (match, content) => {
		const tags = classifyGroup(content, allowYear);
		if (!tags) return match;
		applyTags(st, tags);
		return " ";
	});
	for (let guard = 0; guard < 8; guard++) {
		s = s.replace(TRIM_START, "");
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
	let season;
	let episode;
	let episodeTitle;
	if (opts.episode !== false) for (const re of SEASON_PATTERNS) {
		const m = re.exec(s);
		if (!m) continue;
		season = Number(m[1]);
		if (m[2] !== void 0) episode = Number(m[2]);
		const after = s.slice(m.index + m[0].length).replace(TRIM_START, "").trim();
		s = s.slice(0, m.index);
		if (after) episodeTitle = stripTrailing(after, st, false, opts);
		break;
	}
	s = stripTrailing(s, st, allowYear, opts);
	const cleanTitle = s.replace(/\s+/g, " ").replace(TRIM_START, "").replace(TRIM_END, "").trim();
	const audio = unique$1(st.audio);
	const subs = unique$1(st.subs);
	if (st.multi) st.flags.add("MULTI");
	if (st.dual) st.flags.add("DUAL");
	if (st.vo) st.flags.add("VO");
	if ((st.multi || st.dual) && audio.length < 2 && !audio.includes("en")) audio.push("en");
	return {
		cleanTitle,
		year: st.year,
		langs: audio,
		subLangs: subs,
		quality: st.quality,
		flags: [...st.flags],
		season,
		episode,
		episodeTitle: episodeTitle || void 0
	};
}
function stripTrailing(input, st, allowYear, opts) {
	let s = input;
	for (let guard = 0; guard < 12; guard++) {
		s = s.replace(TRIM_END, "");
		const ph = PHRASE_TRAILING.exec(s);
		if (ph && hasLetter(ph[1])) {
			const langTag = lookupTag(ph[2]);
			const mod = lookupTag(ph[3]);
			if (langTag?.k === "lang" && (mod?.k === "modsub" || mod?.k === "moddub")) {
				applyTags(st, [langTag, mod]);
				s = ph[1];
				continue;
			}
		}
		const m = TRAILING.exec(s);
		if (!m || !hasLetter(m[1])) break;
		const token = m[2];
		if (allowYear && st.year === void 0) {
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
function unique$1(arr) {
	return [...new Set(arr)];
}
var categoryCache = /* @__PURE__ */ new Map();
function parseCategory(category) {
	if (!category) return {
		langs: [],
		subLangs: [],
		quality: "unknown",
		vo: false,
		label: ""
	};
	const cached = categoryCache.get(category);
	if (cached) return cached;
	const p = parseCore(category, {
		year: false,
		episode: false,
		category: true
	});
	const langs = [...p.langs];
	if (langs.length === 0) for (const word of p.cleanTitle.split(/[\s|:\-–—/,()[\]]+/)) {
		const tag = word.length >= 4 ? lookupTag(word) : void 0;
		if (tag?.k === "lang" && !tag.risky) {
			langs.push(tag.lang);
			break;
		}
	}
	const words = p.cleanTitle.split(/\s+/).filter(Boolean);
	const subLangs = [...p.subLangs];
	let quality = p.quality;
	let vo = p.flags.includes("VO");
	if (words.length === 1) {
		const tag = lookupTag(words[0]);
		if (tag?.k === "lang" && langs.length === 0) langs.push(tag.lang);
		else if (tag?.k === "sub") {
			subLangs.push(tag.lang);
			vo ||= !!tag.vo;
		} else if (tag?.k === "q" && quality === "unknown") quality = tag.q;
		else if (tag?.k === "vo") vo = true;
	}
	const label = words.filter((w) => {
		const tag = lookupTag(w);
		if (!tag) return true;
		if (tag.k === "lang") return tag.risky && hasLower(w);
		if (tag.k === "sub" || tag.k === "vo") return false;
		return !(tag.k === "noise" || tag.k === "q") || hasLower(w);
	}).join(" ").replace(TRIM_START, "").replace(TRIM_END, "");
	const out = {
		langs: unique$1(langs),
		subLangs: unique$1(subLangs),
		quality,
		vo,
		label
	};
	if (categoryCache.size > 5e3) categoryCache.clear();
	categoryCache.set(category, out);
	return out;
}
var ARTICLES = /* @__PURE__ */ new Set([
	"the",
	"a",
	"an",
	"de",
	"het",
	"een",
	"der",
	"die",
	"das",
	"ein",
	"eine",
	"le",
	"la",
	"les",
	"l",
	"un",
	"une",
	"el",
	"los",
	"las",
	"il",
	"lo",
	"gli",
	"o",
	"os",
	"as"
]);
var CONNECTORS = /* @__PURE__ */ new Set([
	"and",
	"en",
	"und",
	"et"
]);
var PART_WORDS = /* @__PURE__ */ new Set([
	"part",
	"deel",
	"teil",
	"partie",
	"parte",
	"chapter",
	"hoofdstuk",
	"kapitel",
	"chapitre",
	"capitulo",
	"capitolo",
	"vol",
	"volume",
	"episode",
	"bolum"
]);
var NUMBER_WORDS = {
	one: "1",
	two: "2",
	three: "3",
	four: "4",
	five: "5",
	een: "1",
	twee: "2",
	drie: "3",
	vier: "4",
	vijf: "5",
	eins: "1",
	zwei: "2",
	drei: "3",
	un: "1",
	deux: "2",
	trois: "3",
	uno: "1",
	dos: "2",
	tres: "3",
	due: "2",
	tre: "3"
};
var ROMAN = /^(x{0,2})(ix|iv|v?i{0,3})$/;
var ROMAN_VALUES = {
	i: 1,
	v: 5,
	x: 10
};
function romanToInt(tok) {
	if (tok.length < 2 || !ROMAN.test(tok)) return void 0;
	let total = 0;
	for (let i = 0; i < tok.length; i++) {
		const v = ROMAN_VALUES[tok[i]];
		const next = ROMAN_VALUES[tok[i + 1]] ?? 0;
		total += v < next ? -v : v;
	}
	return total >= 2 && total <= 29 ? total : void 0;
}
var SPECIAL_LETTERS$1 = {
	ß: "ss",
	æ: "ae",
	œ: "oe",
	ø: "o",
	ł: "l",
	đ: "d",
	ð: "d",
	ı: "i",
	þ: "th",
	ħ: "h"
};
/** Lowercase, strip diacritics and punctuation; "&" → " and ". Used for keys and search. */
function foldText(s) {
	return s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[ßæœøłđðıþħ]/g, (c) => SPECIAL_LETTERS$1[c] ?? c).replace(/['’`´ʼ]s\b/g, "s").replace(/&/g, " and ").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
var keyCache = /* @__PURE__ */ new Map();
/** Comparison key for a clean title (see module docs). */
function matchKey(title) {
	const cached = keyCache.get(title);
	if (cached !== void 0) return cached;
	const tokens = foldText(title).split(" ").filter(Boolean);
	const out = [];
	for (let i = 0; i < tokens.length; i++) {
		let tok = tokens[i];
		const r = romanToInt(tok);
		if (r !== void 0) tok = String(r);
		else if (CONNECTORS.has(tok) && i > 0) tok = "and";
		if (PART_WORDS.has(tok) && i + 1 < tokens.length) {
			const next = tokens[i + 1];
			const n = NUMBER_WORDS[next] ?? romanToInt(next)?.toString() ?? next;
			if (/^\d+$/.test(n) || next === "i") {
				out.push(next === "i" ? "1" : n);
				i++;
				continue;
			}
		}
		out.push(tok);
	}
	if (out.length > 1 && ARTICLES.has(out[0])) out.shift();
	const key = out.join(" ");
	if (keyCache.size > 2e5) keyCache.clear();
	keyCache.set(title, key);
	return key;
}
/** Base title before a subtitle (": " or " - "), when there is one. */
function baseTitle(title) {
	const m = /^(.+?)(?:\s*:\s+|\s+[-–—]\s+)\S/.exec(title);
	if (!m) return void 0;
	const base = m[1].trim();
	return foldText(base).length >= 2 ? base : void 0;
}
/** Strong key plus weak (subtitle-less) keys for a title. */
function titleKeys(title) {
	const key = matchKey(title);
	const base = baseTitle(title);
	const weak = base ? matchKey(base) : void 0;
	return {
		key,
		weak: weak && weak !== key ? weak : void 0
	};
}
/** URL-safe ASCII slug ('Het Laatste Licht' → 'het-laatste-licht'); hash fallback for non-Latin. */
function slugify(title) {
	const folded = foldText(title);
	const ascii = folded.replace(/[^a-z0-9 ]+/g, " ").trim().replace(/\s+/g, "-").slice(0, 60).replace(/-+$/, "");
	if (ascii.length >= 2 && ascii.length * 2 >= folded.replace(/\s/g, "").length) return ascii;
	return (ascii ? ascii + "-" : "") + "x" + hash36(folded);
}
function hash36(s) {
	let h = 2166136261;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return (h >>> 0).toString(36);
}
/** "Name (Character)" / "Name as Character" / "Name als Character" → { name, character }. */
function parsePerson(s) {
	const trimmed = s.trim();
	const paren = /^(.+?)\s*\((.+)\)$/.exec(trimmed);
	if (paren) return {
		name: paren[1].trim(),
		character: paren[2].trim()
	};
	const as = /^(.+?)\s+(?:as|als|als:|comme|como|come)\s+(.+)$/i.exec(trimmed);
	if (as) return {
		name: as[1].trim(),
		character: as[2].trim()
	};
	return { name: trimmed };
}
/** Episode titles that carry no information ("Episode 3", "Aflevering 3", "S01E03"). */
function isGenericEpisodeTitle(title, seriesTitle) {
	if (!title) return true;
	const f = foldText(title);
	if (!f) return true;
	if (/^(episode|aflevering|afl|folge|episodio|bolum|odcinek|avsnitt|afsnit|jakso|epizod|серия|эпизод|الحلقة|حلقة|ep|e|s\s*\d+\s*e)\s*\d+$/.test(f)) return true;
	if (/^s\d+\s*e\d+$/.test(f) || /^\d+$/.test(f)) return true;
	return seriesTitle ? matchKey(title) === matchKey(seriesTitle) : false;
}
//#endregion
//#region src/lib/merge/genres.ts
var GENRES = [
	{
		slug: "action",
		nl: "Actie",
		en: "Action",
		loc: {
			de: "Action",
			fr: "Action",
			es: "Acción",
			it: "Azione",
			tr: "Aksiyon",
			ar: "أكشن",
			pl: "Akcja",
			pt: "Ação"
		},
		syn: [
			"اكشن",
			"боевик",
			"toiminta",
			"actiefilm"
		]
	},
	{
		slug: "adventure",
		nl: "Avontuur",
		en: "Adventure",
		loc: {
			de: "Abenteuer",
			fr: "Aventure",
			es: "Aventura",
			it: "Avventura",
			tr: "Macera",
			ar: "مغامرة",
			pl: "Przygodowy",
			pt: "Aventura"
		},
		syn: [
			"przygoda",
			"приключения",
			"avonturenfilm"
		]
	},
	{
		slug: "animation",
		nl: "Animatie",
		en: "Animation",
		loc: {
			de: "Animation",
			fr: "Animation",
			es: "Animación",
			it: "Animazione",
			tr: "Animasyon",
			ar: "رسوم متحركة",
			pl: "Animacja",
			pt: "Animação"
		},
		syn: [
			"animated",
			"cartoon",
			"tekenfilm",
			"zeichentrick",
			"анимация",
			"мультфильм"
		]
	},
	{
		slug: "comedy",
		nl: "Komedie",
		en: "Comedy",
		loc: {
			de: "Komödie",
			fr: "Comédie",
			es: "Comedia",
			it: "Commedia",
			tr: "Komedi",
			ar: "كوميديا",
			pl: "Komedia",
			pt: "Comédia"
		},
		syn: [
			"humor",
			"комедия",
			"comedy drama"
		]
	},
	{
		slug: "crime",
		nl: "Misdaad",
		en: "Crime",
		loc: {
			de: "Krimi",
			fr: "Policier",
			es: "Crimen",
			it: "Crimine",
			tr: "Suç",
			ar: "جريمة",
			pl: "Kryminał",
			pt: "Crime"
		},
		syn: [
			"poliziesco",
			"policial",
			"криминал",
			"misdaadfilm",
			"krimi drama"
		]
	},
	{
		slug: "documentary",
		nl: "Documentaire",
		en: "Documentary",
		loc: {
			de: "Dokumentarfilm",
			fr: "Documentaire",
			es: "Documental",
			it: "Documentario",
			tr: "Belgesel",
			ar: "وثائقي",
			pl: "Dokumentalny",
			pt: "Documentário"
		},
		syn: [
			"dokumentation",
			"docu",
			"documentaires",
			"документальный",
			"doku"
		]
	},
	{
		slug: "drama",
		nl: "Drama",
		en: "Drama",
		loc: {
			de: "Drama",
			fr: "Drame",
			es: "Drama",
			it: "Dramma",
			tr: "Dram",
			ar: "دراما",
			pl: "Dramat",
			pt: "Drama"
		},
		syn: ["драма", "dramafilm"]
	},
	{
		slug: "family",
		nl: "Familie",
		en: "Family",
		loc: {
			de: "Familie",
			fr: "Familial",
			es: "Familia",
			it: "Famiglia",
			tr: "Aile",
			ar: "عائلي",
			pl: "Familijny",
			pt: "Família"
		},
		syn: [
			"familiefilm",
			"семейный",
			"family film"
		]
	},
	{
		slug: "fantasy",
		nl: "Fantasy",
		en: "Fantasy",
		loc: {
			de: "Fantasy",
			fr: "Fantastique",
			es: "Fantasía",
			it: "Fantasy",
			tr: "Fantastik",
			ar: "فانتازيا",
			pl: "Fantasy",
			pt: "Fantasia"
		},
		syn: ["фэнтези"]
	},
	{
		slug: "history",
		nl: "Geschiedenis",
		en: "History",
		loc: {
			de: "Historie",
			fr: "Histoire",
			es: "Historia",
			it: "Storia",
			tr: "Tarih",
			ar: "تاريخ",
			pl: "Historyczny",
			pt: "História"
		},
		syn: [
			"historisch",
			"historical",
			"historique",
			"storico",
			"история",
			"period drama"
		]
	},
	{
		slug: "horror",
		nl: "Horror",
		en: "Horror",
		loc: {
			de: "Horror",
			fr: "Horreur",
			es: "Terror",
			it: "Horror",
			tr: "Korku",
			ar: "رعب",
			pl: "Horror",
			pt: "Terror"
		},
		syn: [
			"epouvante",
			"epouvante horreur",
			"orrore",
			"ужасы",
			"griezel"
		]
	},
	{
		slug: "music",
		nl: "Muziek",
		en: "Music",
		loc: {
			de: "Musik",
			fr: "Musique",
			es: "Música",
			it: "Musica",
			tr: "Müzik",
			ar: "موسيقى",
			pl: "Muzyczny",
			pt: "Música"
		},
		syn: ["музыка", "muziekfilm"]
	},
	{
		slug: "musical",
		nl: "Musical",
		en: "Musical",
		loc: {
			fr: "Comédie musicale",
			es: "Musical",
			it: "Musical",
			tr: "Müzikal",
			pl: "Musical"
		}
	},
	{
		slug: "mystery",
		nl: "Mysterie",
		en: "Mystery",
		loc: {
			de: "Mystery",
			fr: "Mystère",
			es: "Misterio",
			it: "Mistero",
			tr: "Gizem",
			ar: "غموض",
			pl: "Tajemnica",
			pt: "Mistério"
		},
		syn: [
			"детектив",
			"mysteriefilm",
			"giallo"
		]
	},
	{
		slug: "romance",
		nl: "Romantiek",
		en: "Romance",
		loc: {
			de: "Liebesfilm",
			fr: "Romance",
			es: "Romance",
			it: "Sentimentale",
			tr: "Romantik",
			ar: "رومانسي",
			pl: "Romans",
			pt: "Romance"
		},
		syn: [
			"romantisch",
			"romantic",
			"romantique",
			"romantico",
			"romantiek",
			"мелодрама",
			"romcom"
		]
	},
	{
		slug: "scifi",
		nl: "Sciencefiction",
		en: "Science Fiction",
		loc: {
			de: "Science-Fiction",
			fr: "Science-fiction",
			es: "Ciencia ficción",
			it: "Fantascienza",
			tr: "Bilim Kurgu",
			ar: "خيال علمي",
			pl: "Sci-Fi",
			pt: "Ficção científica"
		},
		syn: [
			"sci-fi",
			"scifi",
			"sf",
			"fantastyka naukowa",
			"фантастика",
			"science fiction film"
		]
	},
	{
		slug: "thriller",
		nl: "Thriller",
		en: "Thriller",
		loc: {
			de: "Thriller",
			fr: "Thriller",
			es: "Suspense",
			it: "Thriller",
			tr: "Gerilim",
			ar: "إثارة",
			pl: "Thriller",
			pt: "Suspense"
		},
		syn: [
			"suspenso",
			"dreszczowiec",
			"триллер",
			"spanning"
		]
	},
	{
		slug: "war",
		nl: "Oorlog",
		en: "War",
		loc: {
			de: "Kriegsfilm",
			fr: "Guerre",
			es: "Bélica",
			it: "Guerra",
			tr: "Savaş",
			ar: "حرب",
			pl: "Wojenny",
			pt: "Guerra"
		},
		syn: [
			"krieg",
			"военный",
			"oorlogsfilm",
			"war politics"
		]
	},
	{
		slug: "western",
		nl: "Western",
		en: "Western",
		loc: {
			es: "Western",
			it: "Western",
			tr: "Kovboy",
			pl: "Western",
			pt: "Faroeste"
		}
	},
	{
		slug: "kids",
		nl: "Kinderen",
		en: "Kids",
		loc: {
			de: "Kinder",
			fr: "Enfants",
			es: "Infantil",
			it: "Bambini",
			tr: "Çocuk",
			ar: "أطفال",
			pl: "Dla dzieci",
			pt: "Infantil"
		},
		syn: [
			"kinder",
			"children",
			"jeugd",
			"детский",
			"kids family",
			"kinderfilm"
		]
	},
	{
		slug: "reality",
		nl: "Reality",
		en: "Reality",
		loc: {},
		syn: [
			"reality tv",
			"realityshow",
			"reality show"
		]
	},
	{
		slug: "talk",
		nl: "Talkshow",
		en: "Talk",
		loc: {},
		syn: ["talk show"]
	},
	{
		slug: "news",
		nl: "Nieuws",
		en: "News",
		loc: {
			de: "Nachrichten",
			fr: "Actualités",
			es: "Noticias",
			it: "Notizie",
			tr: "Haber",
			ar: "أخبار",
			pl: "Wiadomości",
			pt: "Notícias"
		}
	},
	{
		slug: "sport",
		nl: "Sport",
		en: "Sports",
		loc: {
			es: "Deportes",
			it: "Sport",
			tr: "Spor",
			ar: "رياضة",
			pt: "Esportes"
		},
		syn: ["sport"]
	},
	{
		slug: "biography",
		nl: "Biografie",
		en: "Biography",
		loc: {
			de: "Biografie",
			fr: "Biographie",
			es: "Biografía",
			it: "Biografico",
			tr: "Biyografi",
			pl: "Biograficzny",
			pt: "Biografia"
		},
		syn: ["biopic"]
	},
	{
		slug: "tvmovie",
		nl: "Tv-film",
		en: "TV Movie",
		loc: {
			de: "TV-Film",
			fr: "Téléfilm",
			it: "Film TV"
		},
		syn: ["telefilm", "fernsehfilm"]
	},
	{
		slug: "anime",
		nl: "Anime",
		en: "Anime",
		loc: {}
	},
	{
		slug: "soap",
		nl: "Soap",
		en: "Soap",
		loc: {},
		syn: ["telenovela"]
	}
];
function fold$1(s) {
	return foldText(s).replace(/\s+/g, "");
}
var LOOKUP = /* @__PURE__ */ new Map();
for (const g of GENRES) for (const name of [
	g.nl,
	g.en,
	g.slug,
	...Object.values(g.loc),
	...g.syn ?? []
]) {
	if (!name) continue;
	const key = fold$1(name);
	if (key && !LOOKUP.has(key)) LOOKUP.set(key, g);
}
var BY_NL = new Map(GENRES.map((g) => [g.nl, g]));
var SPLIT = /\s*(?:&|,|\/|\||;|\+|\band\b|\ben\b|\bund\b|\bet\b|\by\b|\be\b)\s*/i;
var cache = /* @__PURE__ */ new Map();
/** Normalise one provider genre string into zero or more canonical (Dutch) genre names. */
function normalizeGenre(raw) {
	const cached = cache.get(raw);
	if (cached) return cached;
	const out = [];
	const whole = LOOKUP.get(fold$1(raw));
	if (whole) out.push(whole.nl);
	else for (const part of raw.split(SPLIT)) {
		const p = part.trim();
		if (!p) continue;
		const def = LOOKUP.get(fold$1(p));
		if (def) out.push(def.nl);
		else if (p.length > 1 && p.length < 30) out.push(p.charAt(0).toUpperCase() + p.slice(1));
	}
	const result = [...new Set(out)];
	cache.set(raw, result);
	return result;
}
/** Normalise and de-duplicate a list of genres (order of first appearance). */
function normalizeGenres(list) {
	if (!list?.length) return [];
	const out = /* @__PURE__ */ new Set();
	for (const g of list) for (const n of normalizeGenre(g)) out.add(n);
	return [...out];
}
/** i18n slug for a canonical genre name ('Sciencefiction' → 'scifi'); undefined for unknown genres. */
function genreSlug(name) {
	return (BY_NL.get(name) ?? LOOKUP.get(fold$1(name)))?.slug;
}
/** Localised genre name (used for sample data and display fallbacks). */
function localizedGenre(nlName, lang) {
	const def = BY_NL.get(nlName);
	if (!def) return nlName;
	if (lang === "nl") return def.nl;
	if (lang === "en") return def.en;
	return def.loc[lang] ?? def.en;
}
//#endregion
//#region src/lib/merge/series.ts
function langRank(lang, prefer) {
	if (lang === prefer) return 0;
	if (lang === "en") return 1;
	return 2;
}
function episodeFallbackTitle(episode, prefer) {
	return prefer === "nl" ? `Aflevering ${episode}` : `Episode ${episode}`;
}
function pad$1(n) {
	return String(n).padStart(2, "0");
}
/**
* Merge episode lists into seasons. `existing` (already merged seasons) is kept and extended,
* so lazily loaded sources can be added later with the same logic.
*/
function mergeSeasons(titleId, sources, prefer, existing) {
	const map = /* @__PURE__ */ new Map();
	const get = (season, episode) => {
		const key = `${season}x${episode}`;
		let acc = map.get(key);
		if (!acc) {
			acc = {
				season,
				episode,
				durations: [],
				variants: /* @__PURE__ */ new Map()
			};
			map.set(key, acc);
		}
		return acc;
	};
	for (const season of existing ?? []) for (const ep of season.episodes) {
		const acc = get(ep.season, ep.episode);
		const generic = isGenericEpisodeTitle(ep.title);
		acc.title = {
			text: ep.title,
			rank: generic ? 9 : .5
		};
		if (ep.overview) acc.overview = {
			text: ep.overview,
			rank: .5
		};
		if (ep.runtimeMin) acc.durations.push(ep.runtimeMin * 60);
		acc.airDate = ep.airDate;
		acc.stillUrl = ep.stillUrl;
		for (const v of ep.variants) acc.variants.set(v.id, v);
	}
	for (const src of sources) for (const ep of src.episodes) {
		if (!Number.isFinite(ep.season) || !Number.isFinite(ep.episode)) continue;
		const acc = get(ep.season, ep.episode);
		let audio = src.audio;
		let quality = src.quality;
		let text;
		if (ep.title) {
			const p = parseTitle(ep.title);
			if (p.langs.length) audio = p.langs;
			if (p.quality !== "unknown") quality = p.quality;
			text = p.season !== void 0 ? p.episodeTitle : p.cleanTitle;
		}
		const generic = isGenericEpisodeTitle(text, src.seriesTitle);
		const lang = audio[0];
		if (text && !generic) {
			const rank = langRank(lang, prefer);
			if (!acc.title || rank < acc.title.rank) acc.title = {
				text,
				rank
			};
		}
		if (ep.plot) {
			const rank = langRank(lang, prefer);
			if (!acc.overview || rank < acc.overview.rank || rank === acc.overview.rank && ep.plot.length > acc.overview.text.length) acc.overview = {
				text: ep.plot,
				rank
			};
		}
		if (ep.durationSec) acc.durations.push(ep.durationSec);
		if (ep.airDate && (!acc.airDate || ep.airDate < acc.airDate)) acc.airDate = ep.airDate;
		acc.stillUrl ??= ep.stillUrl;
		const id = `${src.sourceId}:${ep.providerId}`;
		if (!acc.variants.has(id)) acc.variants.set(id, {
			id,
			sourceId: src.sourceId,
			url: ep.url,
			audioLangs: audio,
			subtitleLangs: src.subs,
			quality,
			label: ep.title || `${src.seriesTitle} S${pad$1(ep.season)}E${pad$1(ep.episode)}`,
			containerExt: ep.containerExt
		});
	}
	const seasons = /* @__PURE__ */ new Map();
	for (const acc of map.values()) {
		const durations = acc.durations.sort((a, b) => a - b);
		const median = durations.length ? durations[Math.floor(durations.length / 2)] : void 0;
		const episode = {
			id: `${titleId}/s${acc.season}e${acc.episode}`,
			season: acc.season,
			episode: acc.episode,
			title: acc.title && acc.title.rank < 9 ? acc.title.text : episodeFallbackTitle(acc.episode, prefer),
			overview: acc.overview?.text,
			runtimeMin: median ? Math.round(median / 60) : void 0,
			stillUrl: acc.stillUrl,
			airDate: acc.airDate,
			variants: [...acc.variants.values()]
		};
		const list = seasons.get(acc.season);
		if (list) list.push(episode);
		else seasons.set(acc.season, [episode]);
	}
	return [...seasons.entries()].sort((a, b) => a[0] - b[0]).map(([number, episodes]) => ({
		number,
		episodes: episodes.sort((a, b) => a.episode - b.episode)
	}));
}
//#endregion
//#region src/lib/merge/channels.ts
function extOf(url) {
	const m = /\.([a-z0-9]{2,4})(?:[?#]|$)/i.exec(url);
	return m ? m[1].toLowerCase() : void 0;
}
var TIMESHIFT = /\+\s*(\d{1,2})\b/;
function parseChannelName(rawName) {
	const p = parseTitle(rawName, {
		year: false,
		episode: false,
		keepLangNames: true
	});
	const name = p.cleanTitle.replace(/\s+\+\s*(\d)/, " +$1");
	const ts = TIMESHIFT.exec(name);
	return {
		name,
		key: foldText(name.replace(/\+\s*(\d{1,2})\b/g, " plus$1 ")),
		langs: p.langs,
		quality: p.quality,
		timeshift: ts ? Number(ts[1]) : 0
	};
}
function mostCommon$1(values) {
	const counts = /* @__PURE__ */ new Map();
	let best;
	let bestN = 0;
	for (const v of values) {
		const n = (counts.get(v) ?? 0) + 1;
		counts.set(v, n);
		if (n > bestN) {
			best = v;
			bestN = n;
		}
	}
	return best;
}
function isAllCaps$2(s) {
	return !/\p{Ll}/u.test(s) && /\p{Lu}/u.test(s);
}
function buildChannels(raws, epg, sourceLangs = {}) {
	const entries = [];
	for (const raw of raws) for (const ch of raw.channels ?? []) {
		const parsed = parseChannelName(ch.rawName || ch.tvgName || "");
		const cat = parseCategory(ch.group);
		const lang = parsed.langs[0] ?? (ch.langHint && ch.langHint !== "und" ? ch.langHint : void 0) ?? cat.langs[0] ?? sourceLangs[ch.sourceId] ?? "und";
		if (parsed.quality === "unknown" && cat.quality !== "unknown") parsed.quality = cat.quality;
		entries.push({
			raw: ch,
			parsed,
			lang,
			group: cat.label
		});
	}
	const parent = entries.map((_, i) => i);
	const shift = entries.map((e) => e.parsed.timeshift);
	const find = (i) => {
		while (parent[i] !== i) {
			parent[i] = parent[parent[i]];
			i = parent[i];
		}
		return i;
	};
	const union = (a, b) => {
		const ra = find(a);
		const rb = find(b);
		if (ra === rb || shift[ra] !== shift[rb]) return;
		parent[rb] = ra;
	};
	const byTvg = /* @__PURE__ */ new Map();
	const byName = /* @__PURE__ */ new Map();
	entries.forEach((e, i) => {
		const tvg = e.raw.tvgId?.trim().toLowerCase();
		if (tvg) {
			const j = byTvg.get(`${tvg}|${e.parsed.timeshift}`);
			if (j === void 0) byTvg.set(`${tvg}|${e.parsed.timeshift}`, i);
			else union(j, i);
		}
		if (e.parsed.key) {
			const nk = `${e.lang}|${e.parsed.key}`;
			const j = byName.get(nk);
			if (j === void 0) byName.set(nk, i);
			else union(j, i);
		}
	});
	const groups = /* @__PURE__ */ new Map();
	entries.forEach((e, i) => {
		const r = find(i);
		const g = groups.get(r);
		if (g) g.push(e);
		else groups.set(r, [e]);
	});
	const liveTvg = new Set(entries.filter((e) => e.parsed.timeshift === 0 && e.raw.tvgId).map((e) => e.raw.tvgId.trim().toLowerCase()));
	const epgLower = /* @__PURE__ */ new Map();
	for (const id of Object.keys(epg)) epgLower.set(id.toLowerCase(), id);
	const usedIds = /* @__PURE__ */ new Set();
	const channels = [];
	for (const members of groups.values()) {
		const names = members.map((m) => m.parsed.name);
		const name = mostCommon$1(names.filter((n) => !isAllCaps$2(n))) ?? mostCommon$1(names) ?? "";
		const lang = mostCommon$1(members.map((m) => m.lang).filter((l) => l !== "und")) ?? "und";
		let id = `ch-${slugify((mostCommon$1(members.map((m) => m.parsed.key)) ?? foldText(name)) || name)}${lang !== "und" ? "-" + lang : ""}`;
		if (usedIds.has(id)) {
			let n = 2;
			while (usedIds.has(`${id}-${n}`)) n++;
			id = `${id}-${n}`;
		}
		usedIds.add(id);
		let tvgIds = members.map((m) => m.raw.tvgId?.trim()).filter((t) => !!t);
		if (members[0].parsed.timeshift > 0) {
			const own = tvgIds.filter((t) => !liveTvg.has(t.toLowerCase()));
			if (own.length) tvgIds = own;
		}
		const tvgCount = /* @__PURE__ */ new Map();
		for (const t of tvgIds) tvgCount.set(t, (tvgCount.get(t) ?? 0) + 1);
		let epgId;
		let bestRank = [-1, -1];
		for (const [t, count] of tvgCount) {
			const actual = epg[t] ? t : epgLower.get(t.toLowerCase());
			if (!actual) continue;
			const rank = [count, epg[actual].length];
			if (rank[0] > bestRank[0] || rank[0] === bestRank[0] && rank[1] > bestRank[1]) {
				bestRank = rank;
				epgId = actual;
			}
		}
		epgId ??= mostCommon$1(tvgIds);
		const variants = [];
		const seen = /* @__PURE__ */ new Set();
		for (const m of members) {
			const vid = `${m.raw.sourceId}:${m.raw.providerId}`;
			if (seen.has(vid)) continue;
			seen.add(vid);
			variants.push({
				id: vid,
				sourceId: m.raw.sourceId,
				url: m.raw.url,
				audioLangs: m.parsed.langs.length ? m.parsed.langs : [m.lang],
				subtitleLangs: [],
				quality: m.parsed.quality,
				label: m.raw.rawName,
				containerExt: extOf(m.raw.url),
				...m.raw.altUrls?.length ? { altUrls: [...m.raw.altUrls] } : {}
			});
		}
		variants.sort((a, b) => qualityRank(a.quality) - qualityRank(b.quality));
		const numbers = members.map((m) => m.raw.number).filter((n) => n != null);
		const languages = [...new Set(variants.flatMap((v) => v.audioLangs))];
		channels.push({
			id,
			name,
			logoUrl: members.find((m) => m.raw.logoUrl)?.raw.logoUrl,
			group: mostCommon$1(members.map((m) => m.group).filter(Boolean)) ?? "Overig",
			number: numbers.length ? Math.min(...numbers) : void 0,
			epgId,
			languages: languages.length > 1 ? languages.filter((l) => l !== "und") : languages,
			variants
		});
	}
	return channels.sort((a, b) => {
		if (a.number != null && b.number != null && a.number !== b.number) return a.number - b.number;
		if (a.number != null && b.number == null) return -1;
		if (a.number == null && b.number != null) return 1;
		return a.name.localeCompare(b.name);
	});
}
/** Group programmes per channel id, de-duplicated (start + title) and sorted by start. */
function groupEpg(raws) {
	const out = {};
	const seen = /* @__PURE__ */ new Map();
	for (const raw of raws) for (const p of raw.epg ?? []) {
		if (!p.channelId || !(p.stop > p.start)) continue;
		let s = seen.get(p.channelId);
		if (!s) {
			s = /* @__PURE__ */ new Set();
			seen.set(p.channelId, s);
			out[p.channelId] = [];
		}
		const k = `${p.start}|${p.title}`;
		if (s.has(k)) continue;
		s.add(k);
		out[p.channelId].push(p);
	}
	for (const list of Object.values(out)) list.sort((a, b) => a.start - b.start);
	return out;
}
//#endregion
//#region src/lib/merge/pick.ts
/** Language tier of a variant: 0..n-1 preferred, n original, n+1 English, n+2 known, n+3 unknown. */
function languageTier(v, prefs, opts) {
	const pref = prefs.audioLangs;
	let best = Infinity;
	for (const l of v.audioLangs) {
		const i = pref.indexOf(l);
		if (i !== -1 && i < best) best = i;
	}
	if (best !== Infinity) return best;
	const n = pref.length;
	if (opts.originalLang && v.audioLangs.includes(opts.originalLang)) return n;
	if (v.audioLangs.includes("en")) return n + 1;
	if (v.audioLangs.some((l) => l !== "und")) return n + 2;
	return n + 3;
}
function subtitleBonus(v, prefs) {
	const wanted = prefs.subtitleLangs.length ? prefs.subtitleLangs : prefs.audioLangs;
	return v.subtitleLangs.some((l) => wanted.includes(l)) ? 0 : 1;
}
/** Best variant for the user's language preference (first preferred language available), then quality. */
function pickVariant(variants, prefs, opts = {}) {
	if (!variants.length) return void 0;
	const failed = new Set(opts.failedSourceIds ?? []);
	let best;
	let bestScore = [];
	for (const v of variants) {
		const tier = languageTier(v, prefs, opts);
		const subs = tier > 0 || prefs.subtitlesOn ? subtitleBonus(v, prefs) : 0;
		const score = [
			failed.has(v.sourceId) ? 1 : 0,
			tier,
			subs,
			qualityRank(v.quality),
			opts.lastGoodSourceId && v.sourceId === opts.lastGoodSourceId ? 0 : 1
		];
		if (!best || compare(score, bestScore) < 0) {
			best = v;
			bestScore = score;
		}
	}
	return best;
}
function compare(a, b) {
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
	return 0;
}
/**
* Group variants by audio language (a multi-audio variant appears in each of its languages).
* Order: preferred languages, English, then by number of variants.
*/
function groupVariantsByLanguage(variants, prefs) {
	const map = /* @__PURE__ */ new Map();
	for (const v of variants) {
		const langs = v.audioLangs.length ? v.audioLangs : ["und"];
		for (const l of langs) {
			const list = map.get(l);
			if (list) list.push(v);
			else map.set(l, [v]);
		}
	}
	const pref = prefs?.audioLangs ?? [];
	const rank = (l) => {
		const i = pref.indexOf(l);
		if (i !== -1) return i;
		if (l === "en") return pref.length;
		if (l === "und") return pref.length + 2;
		return pref.length + 1;
	};
	return [...map.entries()].map(([lang, list]) => ({
		lang,
		variants: [...list].sort((a, b) => qualityRank(a.quality) - qualityRank(b.quality))
	})).sort((a, b) => rank(a.lang) - rank(b.lang) || b.variants.length - a.variants.length || a.lang.localeCompare(b.lang));
}
/**
* Short language summary for cards and detail pages: "NL · EN · DE +4".
* Preferred languages first, then English, then the rest in catalog order.
*/
function summarizeLanguages(title, max = 3, prefs) {
	const langs = title.languages.filter((l) => l !== "und");
	if (!langs.length) return "";
	const pref = prefs?.audioLangs ?? ["nl"];
	const ordered = [
		...pref.filter((l) => langs.includes(l)),
		...langs.includes("en") && !pref.includes("en") ? ["en"] : [],
		...langs.filter((l) => !pref.includes(l) && l !== "en")
	];
	const shown = ordered.slice(0, max).map((l) => l.toUpperCase());
	const rest = ordered.length - shown.length;
	return shown.join(" · ") + (rest > 0 ? ` +${rest}` : "");
}
//#endregion
//#region src/lib/merge/index.ts
function unique(arr) {
	return [...new Set(arr)];
}
function yearFromDate(date) {
	const m = date ? /^(\d{4})/.exec(date) : null;
	return m ? Number(m[1]) : void 0;
}
/** Audio/subtitle languages of a raw item: title → langHint → category → source default. */
function deriveLanguages(parsed, raw, sourceLangs = {}) {
	const cat = parseCategory(raw.category);
	const vo = parsed.flags.includes("VO") || cat.vo;
	const subs = unique([
		...parsed.subLangs,
		...raw.subtitleHint ?? [],
		...cat.subLangs
	]);
	let audio = [...parsed.langs];
	if (!audio.length && raw.langHint && raw.langHint !== "und") audio = [raw.langHint];
	if (!audio.length) audio = cat.langs.filter((l) => !(vo && subs.includes(l)));
	if (!audio.length && !vo && sourceLangs[raw.sourceId]) audio = [sourceLangs[raw.sourceId]];
	if (!audio.length) audio = ["und"];
	return {
		audio,
		subs,
		vo,
		categoryQuality: cat.quality
	};
}
function analyzeRaw(raw, opts = {}) {
	const parsed = parseTitle(raw.rawTitle ?? "");
	const { audio, subs, vo, categoryQuality } = deriveLanguages(parsed, raw, opts.sourceLangs);
	const year = raw.year || parsed.year || yearFromDate(raw.releaseDate);
	const keys = [];
	const weakKeys = [];
	const addKeys = (title) => {
		if (!title) return;
		const k = titleKeys(title);
		if (k.key && !keys.includes(k.key)) keys.push(k.key);
		if (k.weak && !weakKeys.includes(k.weak)) weakKeys.push(k.weak);
	};
	addKeys(parsed.cleanTitle);
	if (raw.originalTitle) addKeys(parseTitle(raw.originalTitle).cleanTitle);
	let tmdbId = raw.tmdbId && raw.tmdbId > 0 ? Number(raw.tmdbId) : void 0;
	if (!tmdbId && opts.tmdb) for (const key of keys) {
		tmdbId = opts.tmdb.byKey[tmdbLookupKey(raw.kind, key, year)] ?? (year ? void 0 : opts.tmdb.byKey[tmdbLookupKey(raw.kind, key)]);
		if (tmdbId) break;
	}
	const imdbId = raw.imdbId ? /tt\d{5,}/i.exec(raw.imdbId)?.[0].toLowerCase() : void 0;
	return {
		raw,
		parsed,
		audio,
		subs,
		quality: parsed.quality !== "unknown" ? parsed.quality : categoryQuality,
		vo,
		year,
		tmdbId,
		imdbId,
		keys,
		weakKeys
	};
}
function mostCommon(values) {
	const counts = /* @__PURE__ */ new Map();
	let best;
	let bestN = 0;
	for (const v of values) {
		if (v === void 0 || v === null || v === "") continue;
		const n = (counts.get(v) ?? 0) + 1;
		counts.set(v, n);
		if (n > bestN) {
			best = v;
			bestN = n;
		}
	}
	return best;
}
function isAllCaps$1(s) {
	return !/\p{Ll}/u.test(s) && /\p{Lu}/u.test(s);
}
function nicest(titles) {
	return mostCommon(titles.filter((t) => !isAllCaps$1(t))) ?? mostCommon(titles);
}
function median(nums) {
	if (!nums.length) return void 0;
	const s = [...nums].sort((a, b) => a - b);
	return s[Math.floor(s.length / 2)];
}
/** Languages ordered by frequency, 'und' dropped when anything else is known. */
function langUnion(lists) {
	const counts = /* @__PURE__ */ new Map();
	for (const list of lists) for (const l of list) counts.set(l, (counts.get(l) ?? 0) + 1);
	const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([l]) => l);
	return sorted.length > 1 ? sorted.filter((l) => l !== "und") : sorted;
}
function qualityUnion(qs) {
	const set = new Set(qs);
	const out = QUALITY_ORDER.filter((q) => set.has(q));
	return out.length > 1 ? out.filter((q) => q !== "unknown") : out;
}
function variantFor(item) {
	const raw = item.raw;
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
var DAY$2 = 864e5;
/** 0..100 from rating, number of sources, languages, versions and recency. */
function popularityScore(t, versions, now) {
	const rating = t.rating ? Math.min(1, Math.max(0, t.rating / 10)) : .55;
	const sources = Math.min(t.sourceIds.length, 3) / 3;
	const langs = Math.min(t.languages.filter((l) => l !== "und").length, 6) / 6;
	const vers = Math.min(versions, 8) / 8;
	const added = Math.max(0, 1 - (now - t.addedAt) / (90 * DAY$2));
	const nowYear = new Date(now).getFullYear();
	const fresh = t.year ? Math.min(1, Math.max(0, 1 - (nowYear - t.year) / 30)) : .3;
	const score = rating * 35 + sources * 15 + langs * 20 + vers * 5 + added * 15 + fresh * 10;
	return Math.round(Math.min(100, Math.max(0, score)));
}
function pickOverview(items, prefer) {
	let best;
	for (const it of items) {
		const plot = it.raw.plot?.trim();
		if (!plot) continue;
		const lang = it.audio[0];
		const rank = lang === prefer ? 0 : lang === "en" ? 1 : 2;
		if (!best || rank < best.rank || rank === best.rank && plot.length > best.text.length) best = {
			text: plot,
			rank
		};
	}
	return best?.text;
}
function buildTitle(items, opts, usedIds, now) {
	const kind = items[0].raw.kind;
	const prefer = opts.preferLang ?? "nl";
	const tmdbId = mostCommon(items.map((i) => i.tmdbId));
	const meta = tmdbId ? opts.tmdb?.meta[tmdbMetaKey(kind, tmdbId)] : void 0;
	const imdbId = mostCommon(items.map((i) => i.imdbId)) ?? meta?.imdbId;
	const year = mostCommon(items.map((i) => i.year)) ?? meta?.year;
	const originalTitle = nicest(items.map((i) => i.raw.originalTitle && parseTitle(i.raw.originalTitle).cleanTitle).filter((t) => !!t)) ?? meta?.originalTitle;
	let originalLang = meta?.originalLang;
	if (!originalLang && originalTitle) {
		const ok = titleKeys(originalTitle).key;
		originalLang = mostCommon(items.filter((i) => !i.vo && i.audio[0] !== "und" && i.keys[0] === ok).map((i) => i.audio[0]));
	}
	const certification = mostCommon(items.map((i) => rawCertification(i.raw))) ?? meta?.certification;
	const display = nicest(items.filter((i) => i.audio[0] === "en" && !i.vo).map((i) => i.parsed.cleanTitle)) ?? originalTitle ?? meta?.title ?? nicest(items.map((i) => i.parsed.cleanTitle)) ?? "";
	let id = tmdbId ? `tmdb-${kind === "movie" ? "m" : "s"}-${tmdbId}` : imdbId ? `imdb-${imdbId}` : `k-${kind}-${slugify(originalTitle ?? display)}${year ? "-" + year : ""}`;
	if (usedIds.has(id)) {
		const base = year && !id.endsWith(`-${year}`) ? `${id}-${year}` : id;
		id = base;
		let n = 2;
		while (usedIds.has(id)) id = `${base}-${n++}`;
	}
	usedIds.add(id);
	const altTitles = [];
	const seenAlt = /* @__PURE__ */ new Set();
	const addAlt = (title, lang) => {
		if (!title) return;
		const k = `${foldText(title)}|${lang ?? ""}`;
		if (seenAlt.has(k)) return;
		seenAlt.add(k);
		altTitles.push(lang && lang !== "und" ? {
			title,
			lang
		} : { title });
	};
	for (const it of items) addAlt(it.parsed.cleanTitle, it.vo ? void 0 : it.audio[0]);
	addAlt(originalTitle, meta?.originalTitle === originalTitle ? meta?.originalLang : void 0);
	if (meta) {
		for (const a of meta.altTitles) if (a.lang === prefer) addAlt(a.title, a.lang);
	}
	const genreCounts = /* @__PURE__ */ new Map();
	for (const it of items) for (const g of normalizeGenres(it.raw.genres)) genreCounts.set(g, (genreCounts.get(g) ?? 0) + 1);
	if (meta) for (const g of normalizeGenres(meta.genres)) genreCounts.set(g, (genreCounts.get(g) ?? 0) + 2);
	const genres = [...genreCounts.entries()].sort((a, b) => b[1] - a[1]).map(([g]) => g);
	let cast = [];
	for (const it of items) {
		const list = it.raw.cast?.filter(Boolean) ?? [];
		if (list.length > cast.length) cast = list.map(parsePerson);
	}
	if (meta && meta.cast.length > cast.length) cast = meta.cast;
	const ratings = items.map((i) => i.raw.rating).filter((r) => !!r && r > 0);
	const rating = meta?.rating ?? (ratings.length ? Math.round(ratings.reduce((a, b) => a + b, 0) / ratings.length * 10) / 10 : void 0);
	const runtimeSec = median(items.map((i) => i.raw.durationSec).filter((d) => !!d && d > 0));
	const releaseDates = items.map((i) => i.raw.releaseDate).filter((d) => !!d);
	const richest = [...items].sort((a, b) => metaScore(b.raw) - metaScore(a.raw));
	const addedAt = Math.max(...items.map((i) => i.raw.addedAt ?? 0)) || now;
	const sourceIds = unique(items.map((i) => i.raw.sourceId));
	let variants = [];
	let seasons;
	let rawRefs = [];
	let audioLists;
	let subLists;
	let qualities;
	if (kind === "movie") {
		const seen = /* @__PURE__ */ new Set();
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
		const withEpisodes = items.filter((i) => i.raw.episodes !== void 0);
		rawRefs = items.map((i) => ({
			sourceId: i.raw.sourceId,
			providerId: i.raw.providerId,
			langs: i.audio
		}));
		if (withEpisodes.length) seasons = mergeSeasons(id, withEpisodes.map((i) => episodeSource(i)), prefer);
		const epVariants = seasons?.flatMap((s) => s.episodes.flatMap((e) => e.variants)) ?? [];
		audioLists = [...epVariants.map((v) => v.audioLangs), ...items.map((i) => i.audio)];
		subLists = [...epVariants.map((v) => v.subtitleLangs), ...items.map((i) => i.subs)];
		qualities = [...epVariants.map((v) => v.quality), ...items.map((i) => i.quality)];
	}
	const title = {
		id,
		kind,
		title: display,
		originalTitle,
		altTitles,
		year,
		tmdbId,
		imdbId,
		overview: (meta?.lang === prefer ? meta?.overview : void 0) ?? pickOverview(items, prefer) ?? meta?.overview,
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
		subtitleLanguages: langUnion(subLists).filter((l) => l !== "und"),
		qualities: qualityUnion(qualities),
		sourceIds,
		rawRefs
	};
	title.popularity = popularityScore(title, kind === "movie" ? variants.length : items.length, now);
	return title;
}
var KIDS_GENRES = /* @__PURE__ */ new Set([
	"Animatie",
	"Kinderen",
	"Familie"
]);
var ADULT_GENRES = /* @__PURE__ */ new Set([
	"Horror",
	"Thriller",
	"Misdaad",
	"Oorlog"
]);
var KIDS_CERTS = /* @__PURE__ */ new Set([
	"AL",
	"0",
	"6"
]);
/**
* Suitable for kids mode? An explicit certification decides (AL/6 = yes); without one only
* animation/kids/family titles without horror, thriller, crime or war genres qualify.
*/
function isKidsSafe(genres, certification) {
	if (certification) return KIDS_CERTS.has(certification.toUpperCase());
	return genres.some((g) => KIDS_GENRES.has(g)) && !genres.some((g) => ADULT_GENRES.has(g));
}
/** Certification from a raw item when the provider supplies one (field `certification`). */
function rawCertification(raw) {
	const c = raw.certification;
	return typeof c === "string" && c.trim() ? c.trim().toUpperCase() : void 0;
}
function metaScore(raw) {
	return (raw.plot?.length ?? 0) / 100 + (raw.posterUrl ? 3 : 0) + (raw.backdropUrl ? 2 : 0) + (raw.cast?.length ?? 0) * .3 + (raw.rating ? 1 : 0);
}
function sortVariants(variants) {
	return variants.sort((a, b) => QUALITY_ORDER.indexOf(a.quality) - QUALITY_ORDER.indexOf(b.quality) || a.id.localeCompare(b.id));
}
function episodeSource(item) {
	return {
		sourceId: item.raw.sourceId,
		audio: item.audio,
		subs: item.subs,
		quality: item.quality,
		seriesTitle: item.parsed.cleanTitle,
		episodes: item.raw.episodes ?? []
	};
}
/** Build the merged catalog from every source's raw catalog. Pure and deterministic. */
function buildCatalog(raws, opts = {}) {
	const now = opts.now ?? Date.now();
	const items = [];
	for (const raw of raws) {
		for (const m of raw.movies ?? []) items.push(analyzeRaw(m, opts));
		for (const s of raw.series ?? []) items.push(analyzeRaw(s, opts));
	}
	const groups = clusterItems(items.map((it) => ({
		kind: it.raw.kind,
		keys: it.keys,
		weakKeys: it.weakKeys,
		year: it.year,
		tmdbId: it.tmdbId,
		imdbId: it.imdbId,
		durationSec: it.raw.kind === "movie" ? it.raw.durationSec : void 0
	})));
	const rank = (g) => g.some((i) => items[i].tmdbId) ? 0 : 1;
	groups.sort((a, b) => rank(a) - rank(b) || a[0] - b[0]);
	const usedIds = /* @__PURE__ */ new Set();
	const titles = groups.map((g) => buildTitle(g.map((i) => items[i]), opts, usedIds, now));
	titles.sort((a, b) => b.addedAt - a.addedAt || a.id.localeCompare(b.id));
	const epg = groupEpg(raws);
	return {
		titles,
		channels: buildChannels(raws, epg, opts.sourceLangs),
		epg,
		builtAt: now
	};
}
/**
* Title with (new) seasons; languages, subtitle languages and qualities are recomputed from the
* episodes and the raw refs. Used by the catalog store after lazily loading episodes.
*/
function withSeasons(title, seasons) {
	const variants = seasons?.flatMap((s) => s.episodes.flatMap((e) => e.variants)) ?? [];
	return {
		...title,
		seasons,
		languages: langUnion([
			...variants.map((v) => v.audioLangs),
			...title.rawRefs.map((r) => r.langs),
			title.languages
		]),
		subtitleLanguages: langUnion([...variants.map((v) => v.subtitleLangs), title.subtitleLanguages]).filter((l) => l !== "und"),
		qualities: qualityUnion([...variants.map((v) => v.quality), ...title.qualities])
	};
}
//#endregion
//#region src/lib/merge/display.ts
/** Languages to try, in order: UI language, then the audio languages (unique, no 'und'). */
function titleLangs(prefs, locale) {
	const out = [];
	for (const l of [prefs?.uiLang ?? locale, ...prefs?.audioLangs ?? []]) if (l && l !== "und" && !out.includes(l)) out.push(l);
	return out;
}
var isAllCaps = (s) => s === s.toUpperCase() && s !== s.toLowerCase();
/**
* Title in the first language of `langs` that has an alternative title, else `title.title`.
* Several titles in one language (e.g. a dubbed version that kept the English name): a
* localised one (differs from the main/original title) wins, then one that is not ALL CAPS.
*/
function localizedTitle(title, langs) {
	const alts = title.altTitles ?? [];
	if (!alts.length) return title.title;
	const main = new Set([title.title, title.originalTitle].filter(Boolean).map((s) => foldText(s)));
	for (const lang of langs) {
		const hits = alts.filter((a) => a.lang === lang && a.title.trim());
		if (!hits.length) continue;
		if (hits.length === 1) return hits[0].title;
		if (hits.some((h) => h.title === title.title)) return title.title;
		const rank = (s) => (main.has(foldText(s)) ? 2 : 0) + (isAllCaps(s) ? 1 : 0);
		return [...hits].sort((a, b) => rank(a.title) - rank(b.title))[0].title;
	}
	return title.title;
}
/**
* Display title for explicit preferences (no store access).
* Example: "The Last Light" → "Het Laatste Licht" for `{ uiLang: 'nl' }`.
*/
function displayTitleFor(title, prefs, locale) {
	return localizedTitle(title, titleLangs(prefs ?? void 0, locale));
}
//#endregion
//#region src/lib/providers/util.ts
/** Stable, fast 53-bit string hash (cyrb53), base36. Used for M3U providerIds. */
function hashString(str, seed = 0) {
	let h1 = 3735928559 ^ seed;
	let h2 = 1103547991 ^ seed;
	for (let i = 0; i < str.length; i++) {
		const ch = str.charCodeAt(i);
		h1 = Math.imul(h1 ^ ch, 2654435761);
		h2 = Math.imul(h2 ^ ch, 1597334677);
	}
	h1 = Math.imul(h1 ^ h1 >>> 16, 2246822507);
	h1 ^= Math.imul(h2 ^ h2 >>> 13, 3266489909);
	h2 = Math.imul(h2 ^ h2 >>> 16, 2246822507);
	h2 ^= Math.imul(h1 ^ h1 >>> 13, 3266489909);
	return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
/** Trimmed non-empty string, or undefined. Accepts numbers. */
function str$1(v) {
	if (v == null) return void 0;
	if (typeof v === "number") return Number.isFinite(v) ? String(v) : void 0;
	if (typeof v !== "string") return void 0;
	const s = v.trim();
	if (!s || s === "null" || s === "undefined" || s === "N/A") return void 0;
	return s;
}
/** Finite number from number or numeric string, else undefined. */
function num$1(v) {
	if (typeof v === "number") return Number.isFinite(v) ? v : void 0;
	const s = str$1(v);
	if (!s) return void 0;
	const n = Number(s.replace(",", "."));
	return Number.isFinite(n) ? n : void 0;
}
/** Positive integer (ids such as tmdb), else undefined. */
function posInt(v) {
	const n = num$1(v);
	if (n === void 0) return void 0;
	const i = Math.trunc(n);
	return i > 0 ? i : void 0;
}
/** Comma/pipe/slash separated list → trimmed unique entries. */
function list(v) {
	if (Array.isArray(v)) {
		const out = v.map((x) => str$1(x)).filter((x) => !!x);
		return out.length ? [...new Set(out)] : void 0;
	}
	const s = str$1(v);
	if (!s) return void 0;
	const out = s.split(/\s*[,|/]\s*/).map((x) => x.trim()).filter(Boolean);
	return out.length ? [...new Set(out)] : void 0;
}
/** Plausible release year (1880..next year) from a number or a date-ish string. */
function year(v) {
	const s = str$1(v);
	if (!s) return void 0;
	const m = /(18[89]\d|19\d\d|20\d\d)/.exec(s);
	if (!m) return void 0;
	const y = Number(m[1]);
	return y <= (/* @__PURE__ */ new Date()).getFullYear() + 1 ? y : void 0;
}
/** Unix seconds (number or string) → epoch ms. */
function unixToMs(v) {
	const n = num$1(v);
	if (!n || n <= 0) return void 0;
	return n > 0xe8d4a51000 ? Math.trunc(n) : Math.trunc(n * 1e3);
}
/** "01:45:00" | "105 min" | "105" (minutes) → seconds. */
function durationToSec(v, plainUnit = "min") {
	if (typeof v === "number") {
		if (!Number.isFinite(v) || v <= 0) return void 0;
		return Math.round(plainUnit === "min" ? v * 60 : v);
	}
	const s = str$1(v);
	if (!s) return void 0;
	const hms = /^(\d{1,3}):(\d{1,2})(?::(\d{1,2}))?$/.exec(s);
	if (hms) {
		const sec = hms[3] !== void 0 ? Number(hms[1]) * 3600 + Number(hms[2]) * 60 + Number(hms[3]) : Number(hms[1]) * 60 + Number(hms[2]);
		return sec > 0 ? sec : void 0;
	}
	const n = num$1(s.replace(/\s*(min|mins|minutes|m)\.?$/i, ""));
	if (n === void 0 || n <= 0) return void 0;
	return Math.round(plainUnit === "min" ? n * 60 : n);
}
/** YouTube id or url → canonical watch url. */
function youtubeUrl(v) {
	const s = str$1(v);
	if (!s) return void 0;
	if (/^https?:\/\//i.test(s)) return s;
	return /^[\w-]{6,20}$/.test(s) ? `https://www.youtube.com/watch?v=${s}` : void 0;
}
/** http(s) url or undefined. */
function httpUrl(v) {
	const s = str$1(v);
	return s && /^https?:\/\//i.test(s) ? s : void 0;
}
var LANG_ALIASES = {};
var add = (code, ...names) => {
	for (const n of [code, ...names]) LANG_ALIASES[n.toLowerCase()] = code;
};
add("nl", "nld", "dut", "dutch", "nederlands", "netherlands", "holland", "flemish", "vlaams", "be-nl");
add("en", "eng", "english", "engels");
add("de", "deu", "ger", "german", "deutsch", "duits");
add("fr", "fra", "fre", "french", "français", "francais", "frans");
add("es", "spa", "spanish", "español", "espanol", "castellano", "spaans");
add("it", "ita", "italian", "italiano", "italiaans");
add("tr", "tur", "turkish", "türkçe", "turkce", "turks");
add("ar", "ara", "arabic", "العربية", "عربي", "arabisch");
add("pl", "pol", "polish", "polski", "pools");
add("pt", "por", "portuguese", "português", "portugues", "portugees");
add("ru", "rus", "russian", "русский", "russisch");
add("ja", "jpn", "japanese", "日本語", "japans");
add("ko", "kor", "korean", "한국어", "koreaans");
add("zh", "zho", "chi", "chinese", "mandarin", "中文", "chinees");
add("hi", "hin", "hindi");
add("sv", "swe", "swedish", "svenska", "zweeds");
add("da", "dan", "danish", "dansk", "deens");
add("no", "nor", "nob", "nb", "norwegian", "norsk", "noors");
add("fi", "fin", "finnish", "suomi", "fins");
add("el", "ell", "gre", "greek", "ελληνικά", "grieks");
add("ro", "ron", "rum", "romanian", "română", "romana", "roemeens");
/**
* Map a free-form language label ("Dutch", "Nederlands", "NL", "nld", "Dutch;English")
* to an ISO 639-1 code. Returns the first recognised language, or undefined.
*/
function toLangCode(v) {
	const s = str$1(v);
	if (!s) return void 0;
	for (const part of s.split(/[;,|/]/)) {
		const k = part.trim().toLowerCase();
		if (!k) continue;
		const hit = LANG_ALIASES[k] ?? LANG_ALIASES[k.split(/[-_]/)[0]];
		if (hit) return hit;
	}
}
/** Decode base64 (as used by Xtream short_epg) to a UTF-8 string; returns input on failure. */
function decodeBase64Utf8(v) {
	const s = str$1(v);
	if (!s) return void 0;
	if (!/^[A-Za-z0-9+/=\s]+$/.test(s) || s.replace(/\s/g, "").length % 4 !== 0) return s;
	try {
		const bin = atob(s.replace(/\s/g, ""));
		const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
		return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch {
		return s;
	}
}
/** File extension of a url path, lowercase without dot (ignores query/hash). */
function urlExt(url) {
	let end = url.length;
	const q = url.indexOf("?");
	if (q !== -1) end = q;
	const h = url.indexOf("#");
	if (h !== -1 && h < end) end = h;
	const slash = url.lastIndexOf("/", end - 1);
	const dot = url.lastIndexOf(".", end - 1);
	if (dot <= slash || end - dot > 6) return void 0;
	const ext = url.slice(dot + 1, end).toLowerCase();
	return /^[a-z0-9]{2,5}$/.test(ext) ? ext : void 0;
}
var DEFAULT_PORTS = {
	"http:": "80",
	"https:": "443",
	"ws:": "80",
	"wss:": "443",
	"ftp:": "21"
};
/**
* protocol/host/pathname of an absolute url, as WHATWG `URL` reports them, or undefined when
* invalid. Uses `URL` when the platform has it; JavaScriptCore (Apple TV core) has none, so
* there the pure `splitUrlPure` is used.
*/
function splitUrl(input) {
	if (typeof URL !== "function") return splitUrlPure(input);
	try {
		const u = new URL(input);
		return {
			protocol: u.protocol,
			host: u.host,
			pathname: u.pathname
		};
	} catch {
		return;
	}
}
/** Dependency-free equivalent of `splitUrl` for the common http(s) cases. */
function splitUrlPure(input) {
	const m = /^([a-z][a-z0-9+.-]*:)\/\/(?:[^@/?#\\]*@)?([^/?#\\]*)([^?#]*)/i.exec(input.trim());
	if (!m) return void 0;
	const protocol = m[1].toLowerCase();
	const hm = /^(\[[0-9a-f:.]+\]|[^:[\]\s<>^|%"`{}]+)(?::(\d*))?$/i.exec(m[2].toLowerCase());
	if (!hm) return void 0;
	let port = hm[2] ?? "";
	if (port) {
		const n = Number(port);
		if (n > 65535) return void 0;
		port = String(n);
	}
	const host = hm[1] + (port && port !== DEFAULT_PORTS[protocol] ? ":" + port : "");
	let pathname = m[3].replace(/\\/g, "/").replace(/ /g, "%20");
	if (!pathname.startsWith("/")) pathname = "/" + pathname;
	return {
		protocol,
		host,
		pathname
	};
}
//#endregion
//#region src/lib/providers/m3u.ts
var VOD_EXT = /* @__PURE__ */ new Set([
	"mp4",
	"mkv",
	"avi",
	"mov",
	"wmv",
	"m4v",
	"flv",
	"webm",
	"mpg",
	"mpeg",
	"divx",
	"xvid",
	"3gp",
	"ogv",
	"vob"
]);
var LIVE_EXT = /* @__PURE__ */ new Set(["ts", "m2ts"]);
var SERIES_GROUP = /\b(series|séries|serie|serien|seriale|dizi|tv[ -]?shows?|shows)\b/i;
var MOVIE_GROUP = /\b(vod|movies?|films?|filme|filmes|películas|peliculas|cinema|kino)\b/i;
var EP_PATTERNS = [
	/\bS(\d{1,3})\s?[-._]?\s?E(\d{1,4})\b/i,
	/\b(\d{1,2})x(\d{2,3})\b/,
	/\b(?:season|seizoen|saison|staffel|temporada)\s?(\d{1,3})\s?[-.,:]?\s?(?:episode|ep|aflevering|afl|épisode|folge|episodio|capitulo|capítulo)\.?\s?(\d{1,4})\b/i
];
/** Detect "Show S01E02 Title" / "Show 1x02" / "Show Season 1 Episode 2". */
function parseEpisodeName(name) {
	for (const re of EP_PATTERNS) {
		const m = re.exec(name);
		if (!m) continue;
		const series = name.slice(0, m.index).replace(/[\s\-–—:|.,_([]+$/u, "").trim();
		const rest = name.slice(m.index + m[0].length).replace(/^[\s\-–—:|.,_)\]]+/u, "").trim();
		if (!series) continue;
		return {
			series,
			season: Number(m[1]),
			episode: Number(m[2]),
			title: rest || void 0
		};
	}
}
/** Decide what an entry is, using (in order) explicit type, url path, name, extension, group. */
function classify(e) {
	const type = (e.attrs["tvg-type"] ?? e.attrs["type"] ?? "").toLowerCase();
	if (type === "live" || type === "channel") return "live";
	if (type === "movie" || type === "movies" || type === "vod") return "movie";
	if (type === "series" || type === "episode") return "episode";
	const path = pathOf(e.url).toLowerCase();
	if (path.includes("/movie/") || path.includes("/movies/")) return "movie";
	if (path.includes("/series/")) return "episode";
	if (path.includes("/live/")) return "live";
	const ext = urlExt(e.url);
	if (ext && LIVE_EXT.has(ext)) return "live";
	const vodExt = !!ext && VOD_EXT.has(ext);
	const group = e.group ?? "";
	if (parseEpisodeName(e.name) && (ext !== "m3u8" || SERIES_GROUP.test(group))) return "episode";
	if (vodExt) return "movie";
	if (e.duration > 0) return "movie";
	if (ext === "m3u8" || !ext) {
		if (/\bvod\b/i.test(group)) return "movie";
		return "live";
	}
	if (MOVIE_GROUP.test(group) || SERIES_GROUP.test(group)) return "movie";
	return "live";
}
function pathOf(url) {
	const scheme = url.indexOf("://");
	const start = scheme === -1 ? 0 : url.indexOf("/", scheme + 3);
	if (start === -1) return "/";
	let end = url.length;
	const q = url.indexOf("?", start);
	if (q !== -1) end = q;
	return url.slice(start, end);
}
/**
* Parse an attribute list: `key="value" key2='v' key3=bare`, stopping at the first
* unquoted comma. Returns the index after that comma (or -1 if none).
*/
function parseAttrs(line, from, attrs) {
	const n = line.length;
	let i = from;
	while (i < n) {
		let c = line.charCodeAt(i);
		while (i < n && (c === 32 || c === 9)) c = line.charCodeAt(++i);
		if (i >= n) return -1;
		if (c === 44) return i + 1;
		const ks = i;
		while (i < n) {
			c = line.charCodeAt(i);
			if (c === 61 || c === 32 || c === 9 || c === 44) break;
			i++;
		}
		const key = line.slice(ks, i).toLowerCase();
		if (c !== 61) {
			if (i === ks) i++;
			continue;
		}
		i++;
		let value;
		const q = line.charCodeAt(i);
		if (q === 34 || q === 39) {
			const close = line.indexOf(q === 34 ? "\"" : "'", i + 1);
			if (close === -1) {
				const lastComma = line.lastIndexOf(",");
				const end = lastComma > i ? lastComma : n;
				value = line.slice(i + 1, end);
				if (key) attrs[key] = value.trim();
				return lastComma > i ? lastComma + 1 : -1;
			}
			value = line.slice(i + 1, close);
			i = close + 1;
		} else {
			const vs = i;
			while (i < n) {
				c = line.charCodeAt(i);
				if (c === 32 || c === 9 || c === 44) break;
				i++;
			}
			value = line.slice(vs, i);
		}
		if (key) attrs[key] = value.trim();
	}
	return -1;
}
/** Parse one `#EXTINF:` line into duration, attributes and display name. */
function parseExtinf(line) {
	const attrs = {};
	let i = 8;
	const n = line.length;
	while (i < n && line.charCodeAt(i) === 32) i++;
	const ds = i;
	while (i < n) {
		const c = line.charCodeAt(i);
		if (c === 32 || c === 44 || c === 9) break;
		i++;
	}
	const duration = Number(line.slice(ds, i));
	let name = "";
	const after = parseAttrs(line, i, attrs);
	if (after !== -1) name = line.slice(after).trim();
	else {
		const lastComma = line.lastIndexOf(",");
		if (lastComma !== -1) name = line.slice(lastComma + 1).trim();
	}
	return {
		duration: Number.isFinite(duration) ? duration : -1,
		attrs,
		name
	};
}
/** Incremental M3U parser. Call push() with chunks, then end(). */
var M3UParser = class {
	sourceId;
	epgUrls = [];
	entryCount = 0;
	#rest = "";
	#pending = null;
	#pendingGroup;
	#first = true;
	movies = [];
	channels = [];
	#series = /* @__PURE__ */ new Map();
	#autoEpisode = /* @__PURE__ */ new Map();
	constructor(opts) {
		this.sourceId = opts.sourceId;
	}
	push(chunk) {
		const text = this.#rest ? this.#rest + chunk : chunk;
		let start = 0;
		for (;;) {
			const nl = text.indexOf("\n", start);
			if (nl === -1) break;
			this.#line(text, start, nl);
			start = nl + 1;
		}
		this.#rest = start < text.length ? text.slice(start) : "";
	}
	end() {
		if (this.#rest) {
			const r = this.#rest;
			this.#rest = "";
			this.#line(r, 0, r.length);
		}
		return {
			epgUrls: this.epgUrls,
			movies: this.movies,
			series: [...this.#series.values()],
			channels: this.channels,
			entryCount: this.entryCount
		};
	}
	#line(text, s, e) {
		while (s < e && text.charCodeAt(s) <= 32) s++;
		while (e > s && text.charCodeAt(e - 1) <= 32) e--;
		if (s === e) return;
		let line = text.slice(s, e);
		if (this.#first) {
			this.#first = false;
			if (line.charCodeAt(0) === 65279) line = line.slice(1);
		}
		if (line.charCodeAt(0) === 35) {
			if (line.startsWith("#EXTINF:") || line.startsWith("#extinf:")) {
				if (this.#pending) this.entryCount++;
				this.#pending = parseExtinf(line);
				return;
			}
			if (/^#EXTM3U/i.test(line)) {
				const attrs = {};
				parseAttrs(line, 7, attrs);
				for (const k of [
					"url-tvg",
					"x-tvg-url",
					"tvg-url"
				]) {
					const v = attrs[k];
					if (!v) continue;
					for (const u of v.split(/[,\s]+/)) {
						const t = u.trim();
						if (/^https?:\/\//i.test(t) && !this.epgUrls.includes(t)) this.epgUrls.push(t);
					}
				}
				return;
			}
			if (/^#EXTGRP:/i.test(line)) {
				this.#pendingGroup = line.slice(8).trim() || void 0;
				return;
			}
			return;
		}
		const info = this.#pending ?? {
			duration: -1,
			attrs: {},
			name: ""
		};
		this.#pending = null;
		const group = str$1(info.attrs["group-title"]) ?? str$1(info.attrs["tvg-group"]) ?? this.#pendingGroup;
		this.#pendingGroup = void 0;
		this.entryCount++;
		const url = line;
		if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) return;
		const name = info.name || str$1(info.attrs["tvg-name"]) || nameFromUrl(url);
		this.#add({
			name,
			url,
			duration: info.duration,
			attrs: info.attrs,
			group
		});
	}
	#add(e) {
		const kind = classify(e);
		const a = e.attrs;
		const langHint = toLangCode(a["tvg-language"]);
		const providerId = hashString(e.url);
		const ext = urlExt(e.url);
		if (kind === "live") {
			const chno = Number(a["tvg-chno"] ?? a["channel-number"] ?? a["tvg-num"]);
			const catchup = Number(a["catchup-days"] ?? a["timeshift"] ?? a["tvg-rec"]);
			this.channels.push({
				kind: "live",
				sourceId: this.sourceId,
				providerId,
				rawName: e.name,
				tvgId: str$1(a["tvg-id"]),
				tvgName: str$1(a["tvg-name"]),
				logoUrl: str$1(a["tvg-logo"]) ?? str$1(a["logo"]),
				group: e.group,
				number: Number.isFinite(chno) && chno > 0 ? chno : void 0,
				url: e.url,
				langHint,
				catchupDays: Number.isFinite(catchup) && catchup > 0 ? catchup : void 0
			});
			return;
		}
		if (kind === "movie") {
			this.movies.push({
				kind: "movie",
				sourceId: this.sourceId,
				providerId,
				rawTitle: e.name,
				category: e.group,
				year: yearFromName(e.name),
				posterUrl: str$1(a["tvg-logo"]) ?? str$1(a["logo"]),
				durationSec: e.duration > 0 ? Math.round(e.duration) : void 0,
				langHint,
				url: e.url,
				containerExt: ext
			});
			return;
		}
		const ep = parseEpisodeName(e.name);
		const seriesName = ep?.series ?? stripTrailingNumber(e.name);
		const key = `${e.group ?? ""}\u0001${seriesName.toLowerCase()}`;
		let series = this.#series.get(key);
		if (!series) {
			series = {
				kind: "series",
				sourceId: this.sourceId,
				providerId: "s" + hashString(key),
				rawTitle: seriesName,
				category: e.group,
				year: yearFromName(seriesName),
				posterUrl: str$1(a["tvg-logo"]) ?? str$1(a["logo"]),
				langHint,
				episodes: []
			};
			this.#series.set(key, series);
		}
		const season = ep?.season ?? 1;
		let episode = ep?.episode;
		if (episode === void 0) {
			episode = (this.#autoEpisode.get(key) ?? 0) + 1;
			this.#autoEpisode.set(key, episode);
		}
		const raw = {
			providerId,
			season,
			episode,
			title: ep?.title,
			durationSec: e.duration > 0 ? Math.round(e.duration) : void 0,
			stillUrl: str$1(a["tvg-logo"]) ?? str$1(a["logo"]),
			url: e.url,
			containerExt: ext
		};
		series.episodes.push(raw);
		if (!series.langHint && langHint) series.langHint = langHint;
	}
};
function yearFromName(name) {
	const m = /[([](\d{4})[)\]]/.exec(name);
	return m ? year(m[1]) : void 0;
}
function stripTrailingNumber(name) {
	return name.replace(/[\s\-–:#.]*\d{1,4}\s*$/u, "").trim() || name;
}
function nameFromUrl(url) {
	const p = pathOf(url);
	const last = p.slice(p.lastIndexOf("/") + 1);
	try {
		return decodeURIComponent(last).replace(/\.[a-z0-9]{2,5}$/i, "") || url;
	} catch {
		return last || url;
	}
}
/** Parse a complete playlist string. */
function parseM3U(text, opts) {
	const p = new M3UParser(opts);
	p.push(text);
	return p.end();
}
/** Quick sanity check used before parsing user-supplied files. */
function looksLikeM3U(text) {
	const head = text.slice(0, 2048).replace(/^\uFEFF/, "").trimStart();
	return /^#EXTM3U/i.test(head) || /#EXTINF:/i.test(head) || /^[a-z]+:\/\//i.test(head);
}
//#endregion
//#region node_modules/xmlchars/xml/1.0/ed5.js
var require_ed5 = /* @__PURE__ */ __commonJSMin(((exports) => {
	/**
	* Character classes and associated utilities for the 5th edition of XML 1.0.
	*
	* @author Louis-Dominique Dubeau
	* @license MIT
	* @copyright Louis-Dominique Dubeau
	*/
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.CHAR = "	\n\r -퟿-�𐀀-􏿿";
	exports.S = " 	\r\n";
	exports.NAME_START_CHAR = ":A-Z_a-zÀ-ÖØ-öø-˿Ͱ-ͽͿ-῿‌‍⁰-↏Ⰰ-⿯、-퟿豈-﷏ﷰ-�𐀀-󯿿";
	exports.NAME_CHAR = "-" + exports.NAME_START_CHAR + ".0-9·̀-ͯ‿-⁀";
	exports.CHAR_RE = new RegExp("^[" + exports.CHAR + "]$", "u");
	exports.S_RE = new RegExp("^[" + exports.S + "]+$", "u");
	exports.NAME_START_CHAR_RE = new RegExp("^[" + exports.NAME_START_CHAR + "]$", "u");
	exports.NAME_CHAR_RE = new RegExp("^[" + exports.NAME_CHAR + "]$", "u");
	exports.NAME_RE = new RegExp("^[" + exports.NAME_START_CHAR + "][" + exports.NAME_CHAR + "]*$", "u");
	exports.NMTOKEN_RE = new RegExp("^[" + exports.NAME_CHAR + "]+$", "u");
	var TAB = 9;
	var NL = 10;
	var CR = 13;
	var SPACE = 32;
	/** All characters in the ``S`` production. */
	exports.S_LIST = [
		SPACE,
		NL,
		CR,
		TAB
	];
	/**
	* Determines whether a codepoint matches the ``CHAR`` production.
	*
	* @param c The code point.
	*
	* @returns ``true`` if the codepoint matches ``CHAR``.
	*/
	function isChar(c) {
		return c >= SPACE && c <= 55295 || c === NL || c === CR || c === TAB || c >= 57344 && c <= 65533 || c >= 65536 && c <= 1114111;
	}
	exports.isChar = isChar;
	/**
	* Determines whether a codepoint matches the ``S`` (space) production.
	*
	* @param c The code point.
	*
	* @returns ``true`` if the codepoint matches ``S``.
	*/
	function isS(c) {
		return c === SPACE || c === NL || c === CR || c === TAB;
	}
	exports.isS = isS;
	/**
	* Determines whether a codepoint matches the ``NAME_START_CHAR`` production.
	*
	* @param c The code point.
	*
	* @returns ``true`` if the codepoint matches ``NAME_START_CHAR``.
	*/
	function isNameStartChar(c) {
		return c >= 65 && c <= 90 || c >= 97 && c <= 122 || c === 58 || c === 95 || c === 8204 || c === 8205 || c >= 192 && c <= 214 || c >= 216 && c <= 246 || c >= 248 && c <= 767 || c >= 880 && c <= 893 || c >= 895 && c <= 8191 || c >= 8304 && c <= 8591 || c >= 11264 && c <= 12271 || c >= 12289 && c <= 55295 || c >= 63744 && c <= 64975 || c >= 65008 && c <= 65533 || c >= 65536 && c <= 983039;
	}
	exports.isNameStartChar = isNameStartChar;
	/**
	* Determines whether a codepoint matches the ``NAME_CHAR`` production.
	*
	* @param c The code point.
	*
	* @returns ``true`` if the codepoint matches ``NAME_CHAR``.
	*/
	function isNameChar(c) {
		return isNameStartChar(c) || c >= 48 && c <= 57 || c === 45 || c === 46 || c === 183 || c >= 768 && c <= 879 || c >= 8255 && c <= 8256;
	}
	exports.isNameChar = isNameChar;
}));
//#endregion
//#region node_modules/xmlchars/xml/1.1/ed2.js
var require_ed2 = /* @__PURE__ */ __commonJSMin(((exports) => {
	/**
	* Character classes and associated utilities for the 2nd edition of XML 1.1.
	*
	* @author Louis-Dominique Dubeau
	* @license MIT
	* @copyright Louis-Dominique Dubeau
	*/
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.CHAR = "-퟿-�𐀀-􏿿";
	exports.RESTRICTED_CHAR = "-\b\v\f---";
	exports.S = " 	\r\n";
	exports.NAME_START_CHAR = ":A-Z_a-zÀ-ÖØ-öø-˿Ͱ-ͽͿ-῿‌‍⁰-↏Ⰰ-⿯、-퟿豈-﷏ﷰ-�𐀀-󯿿";
	exports.NAME_CHAR = "-" + exports.NAME_START_CHAR + ".0-9·̀-ͯ‿-⁀";
	exports.CHAR_RE = new RegExp("^[" + exports.CHAR + "]$", "u");
	exports.RESTRICTED_CHAR_RE = new RegExp("^[" + exports.RESTRICTED_CHAR + "]$", "u");
	exports.S_RE = new RegExp("^[" + exports.S + "]+$", "u");
	exports.NAME_START_CHAR_RE = new RegExp("^[" + exports.NAME_START_CHAR + "]$", "u");
	exports.NAME_CHAR_RE = new RegExp("^[" + exports.NAME_CHAR + "]$", "u");
	exports.NAME_RE = new RegExp("^[" + exports.NAME_START_CHAR + "][" + exports.NAME_CHAR + "]*$", "u");
	exports.NMTOKEN_RE = new RegExp("^[" + exports.NAME_CHAR + "]+$", "u");
	var TAB = 9;
	var NL = 10;
	var CR = 13;
	var SPACE = 32;
	/** All characters in the ``S`` production. */
	exports.S_LIST = [
		SPACE,
		NL,
		CR,
		TAB
	];
	/**
	* Determines whether a codepoint matches the ``CHAR`` production.
	*
	* @param c The code point.
	*
	* @returns ``true`` if the codepoint matches ``CHAR``.
	*/
	function isChar(c) {
		return c >= 1 && c <= 55295 || c >= 57344 && c <= 65533 || c >= 65536 && c <= 1114111;
	}
	exports.isChar = isChar;
	/**
	* Determines whether a codepoint matches the ``RESTRICTED_CHAR`` production.
	*
	* @param c The code point.
	*
	* @returns ``true`` if the codepoint matches ``RESTRICTED_CHAR``.
	*/
	function isRestrictedChar(c) {
		return c >= 1 && c <= 8 || c === 11 || c === 12 || c >= 14 && c <= 31 || c >= 127 && c <= 132 || c >= 134 && c <= 159;
	}
	exports.isRestrictedChar = isRestrictedChar;
	/**
	* Determines whether a codepoint matches the ``CHAR`` production and does not
	* match the ``RESTRICTED_CHAR`` production. ``isCharAndNotRestricted(x)`` is
	* equivalent to ``isChar(x) && !isRestrictedChar(x)``. This function is faster
	* than running the two-call equivalent.
	*
	* @param c The code point.
	*
	* @returns ``true`` if the codepoint matches ``CHAR`` and does not match
	* ``RESTRICTED_CHAR``.
	*/
	function isCharAndNotRestricted(c) {
		return c === 9 || c === 10 || c === 13 || c > 31 && c < 127 || c === 133 || c > 159 && c <= 55295 || c >= 57344 && c <= 65533 || c >= 65536 && c <= 1114111;
	}
	exports.isCharAndNotRestricted = isCharAndNotRestricted;
	/**
	* Determines whether a codepoint matches the ``S`` (space) production.
	*
	* @param c The code point.
	*
	* @returns ``true`` if the codepoint matches ``S``.
	*/
	function isS(c) {
		return c === SPACE || c === NL || c === CR || c === TAB;
	}
	exports.isS = isS;
	/**
	* Determines whether a codepoint matches the ``NAME_START_CHAR`` production.
	*
	* @param c The code point.
	*
	* @returns ``true`` if the codepoint matches ``NAME_START_CHAR``.
	*/
	function isNameStartChar(c) {
		return c >= 65 && c <= 90 || c >= 97 && c <= 122 || c === 58 || c === 95 || c === 8204 || c === 8205 || c >= 192 && c <= 214 || c >= 216 && c <= 246 || c >= 248 && c <= 767 || c >= 880 && c <= 893 || c >= 895 && c <= 8191 || c >= 8304 && c <= 8591 || c >= 11264 && c <= 12271 || c >= 12289 && c <= 55295 || c >= 63744 && c <= 64975 || c >= 65008 && c <= 65533 || c >= 65536 && c <= 983039;
	}
	exports.isNameStartChar = isNameStartChar;
	/**
	* Determines whether a codepoint matches the ``NAME_CHAR`` production.
	*
	* @param c The code point.
	*
	* @returns ``true`` if the codepoint matches ``NAME_CHAR``.
	*/
	function isNameChar(c) {
		return isNameStartChar(c) || c >= 48 && c <= 57 || c === 45 || c === 46 || c === 183 || c >= 768 && c <= 879 || c >= 8255 && c <= 8256;
	}
	exports.isNameChar = isNameChar;
}));
//#endregion
//#region node_modules/xmlchars/xmlns/1.0/ed3.js
var require_ed3 = /* @__PURE__ */ __commonJSMin(((exports) => {
	/**
	* Character class utilities for XML NS 1.0 edition 3.
	*
	* @author Louis-Dominique Dubeau
	* @license MIT
	* @copyright Louis-Dominique Dubeau
	*/
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.NC_NAME_START_CHAR = "A-Z_a-zÀ-ÖØ-öø-˿Ͱ-ͽͿ-῿‌-‍⁰-↏Ⰰ-⿯、-퟿豈-﷏ﷰ-�𐀀-󯿿";
	exports.NC_NAME_CHAR = "-" + exports.NC_NAME_START_CHAR + ".0-9·̀-ͯ‿-⁀";
	exports.NC_NAME_START_CHAR_RE = new RegExp("^[" + exports.NC_NAME_START_CHAR + "]$", "u");
	exports.NC_NAME_CHAR_RE = new RegExp("^[" + exports.NC_NAME_CHAR + "]$", "u");
	exports.NC_NAME_RE = new RegExp("^[" + exports.NC_NAME_START_CHAR + "][" + exports.NC_NAME_CHAR + "]*$", "u");
	/**
	* Determines whether a codepoint matches [[NC_NAME_START_CHAR]].
	*
	* @param c The code point.
	*
	* @returns ``true`` if the codepoint matches.
	*/
	function isNCNameStartChar(c) {
		return c >= 65 && c <= 90 || c === 95 || c >= 97 && c <= 122 || c >= 192 && c <= 214 || c >= 216 && c <= 246 || c >= 248 && c <= 767 || c >= 880 && c <= 893 || c >= 895 && c <= 8191 || c >= 8204 && c <= 8205 || c >= 8304 && c <= 8591 || c >= 11264 && c <= 12271 || c >= 12289 && c <= 55295 || c >= 63744 && c <= 64975 || c >= 65008 && c <= 65533 || c >= 65536 && c <= 983039;
	}
	exports.isNCNameStartChar = isNCNameStartChar;
	/**
	* Determines whether a codepoint matches [[NC_NAME_CHAR]].
	*
	* @param c The code point.
	*
	* @returns ``true`` if the codepoint matches.
	*/
	function isNCNameChar(c) {
		return isNCNameStartChar(c) || c === 45 || c === 46 || c >= 48 && c <= 57 || c === 183 || c >= 768 && c <= 879 || c >= 8255 && c <= 8256;
	}
	exports.isNCNameChar = isNCNameChar;
}));
//#endregion
//#region src/lib/providers/xmltv.ts
var import_saxes = (/* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.SaxesParser = exports.EVENTS = void 0;
	var ed5 = require_ed5();
	var ed2 = require_ed2();
	var NSed3 = require_ed3();
	var isS = ed5.isS;
	var isChar10 = ed5.isChar;
	var isNameStartChar = ed5.isNameStartChar;
	var isNameChar = ed5.isNameChar;
	var S_LIST = ed5.S_LIST;
	var NAME_RE = ed5.NAME_RE;
	var isChar11 = ed2.isChar;
	var isNCNameStartChar = NSed3.isNCNameStartChar;
	var isNCNameChar = NSed3.isNCNameChar;
	var NC_NAME_RE = NSed3.NC_NAME_RE;
	var XML_NAMESPACE = "http://www.w3.org/XML/1998/namespace";
	var XMLNS_NAMESPACE = "http://www.w3.org/2000/xmlns/";
	var rootNS = {
		__proto__: null,
		xml: XML_NAMESPACE,
		xmlns: XMLNS_NAMESPACE
	};
	var XML_ENTITIES = {
		__proto__: null,
		amp: "&",
		gt: ">",
		lt: "<",
		quot: "\"",
		apos: "'"
	};
	var EOC = -1;
	var NL_LIKE = -2;
	var S_BEGIN = 0;
	var S_BEGIN_WHITESPACE = 1;
	var S_DOCTYPE = 2;
	var S_DOCTYPE_QUOTE = 3;
	var S_DTD = 4;
	var S_DTD_QUOTED = 5;
	var S_DTD_OPEN_WAKA = 6;
	var S_DTD_OPEN_WAKA_BANG = 7;
	var S_DTD_COMMENT = 8;
	var S_DTD_COMMENT_ENDING = 9;
	var S_DTD_COMMENT_ENDED = 10;
	var S_DTD_PI = 11;
	var S_DTD_PI_ENDING = 12;
	var S_TEXT = 13;
	var S_ENTITY = 14;
	var S_OPEN_WAKA = 15;
	var S_OPEN_WAKA_BANG = 16;
	var S_COMMENT = 17;
	var S_COMMENT_ENDING = 18;
	var S_COMMENT_ENDED = 19;
	var S_CDATA = 20;
	var S_CDATA_ENDING = 21;
	var S_CDATA_ENDING_2 = 22;
	var S_PI_FIRST_CHAR = 23;
	var S_PI_REST = 24;
	var S_PI_BODY = 25;
	var S_PI_ENDING = 26;
	var S_XML_DECL_NAME_START = 27;
	var S_XML_DECL_NAME = 28;
	var S_XML_DECL_EQ = 29;
	var S_XML_DECL_VALUE_START = 30;
	var S_XML_DECL_VALUE = 31;
	var S_XML_DECL_SEPARATOR = 32;
	var S_XML_DECL_ENDING = 33;
	var S_OPEN_TAG = 34;
	var S_OPEN_TAG_SLASH = 35;
	var S_ATTRIB = 36;
	var S_ATTRIB_NAME = 37;
	var S_ATTRIB_NAME_SAW_WHITE = 38;
	var S_ATTRIB_VALUE = 39;
	var S_ATTRIB_VALUE_QUOTED = 40;
	var S_ATTRIB_VALUE_CLOSED = 41;
	var S_ATTRIB_VALUE_UNQUOTED = 42;
	var S_CLOSE_TAG = 43;
	var S_CLOSE_TAG_SAW_WHITE = 44;
	var TAB = 9;
	var NL = 10;
	var CR = 13;
	var SPACE = 32;
	var BANG = 33;
	var DQUOTE = 34;
	var AMP = 38;
	var SQUOTE = 39;
	var MINUS = 45;
	var FORWARD_SLASH = 47;
	var SEMICOLON = 59;
	var LESS = 60;
	var EQUAL = 61;
	var GREATER = 62;
	var QUESTION = 63;
	var OPEN_BRACKET = 91;
	var CLOSE_BRACKET = 93;
	var NEL = 133;
	var LS = 8232;
	var isQuote = (c) => c === DQUOTE || c === SQUOTE;
	var QUOTES = [DQUOTE, SQUOTE];
	var DOCTYPE_TERMINATOR = [
		...QUOTES,
		OPEN_BRACKET,
		GREATER
	];
	var DTD_TERMINATOR = [
		...QUOTES,
		LESS,
		CLOSE_BRACKET
	];
	var XML_DECL_NAME_TERMINATOR = [
		EQUAL,
		QUESTION,
		...S_LIST
	];
	var ATTRIB_VALUE_UNQUOTED_TERMINATOR = [
		...S_LIST,
		GREATER,
		AMP,
		LESS
	];
	function nsPairCheck(parser, prefix, uri) {
		switch (prefix) {
			case "xml":
				if (uri !== XML_NAMESPACE) parser.fail(`xml prefix must be bound to ${XML_NAMESPACE}.`);
				break;
			case "xmlns": if (uri !== XMLNS_NAMESPACE) parser.fail(`xmlns prefix must be bound to ${XMLNS_NAMESPACE}.`);
		}
		switch (uri) {
			case XMLNS_NAMESPACE:
				parser.fail(prefix === "" ? `the default namespace may not be set to ${uri}.` : `may not assign a prefix (even "xmlns") to the URI \
${XMLNS_NAMESPACE}.`);
				break;
			case XML_NAMESPACE: switch (prefix) {
				case "xml": break;
				case "":
					parser.fail(`the default namespace may not be set to ${uri}.`);
					break;
				default: parser.fail("may not assign the xml namespace to another prefix.");
			}
		}
	}
	function nsMappingCheck(parser, mapping) {
		for (const local of Object.keys(mapping)) nsPairCheck(parser, local, mapping[local]);
	}
	var isNCName = (name) => NC_NAME_RE.test(name);
	var isName = (name) => NAME_RE.test(name);
	var FORBIDDEN_START = 0;
	var FORBIDDEN_BRACKET = 1;
	var FORBIDDEN_BRACKET_BRACKET = 2;
	/**
	* The list of supported events.
	*/
	exports.EVENTS = [
		"xmldecl",
		"text",
		"processinginstruction",
		"doctype",
		"comment",
		"opentagstart",
		"attribute",
		"opentag",
		"closetag",
		"cdata",
		"error",
		"end",
		"ready"
	];
	var EVENT_NAME_TO_HANDLER_NAME = {
		xmldecl: "xmldeclHandler",
		text: "textHandler",
		processinginstruction: "piHandler",
		doctype: "doctypeHandler",
		comment: "commentHandler",
		opentagstart: "openTagStartHandler",
		attribute: "attributeHandler",
		opentag: "openTagHandler",
		closetag: "closeTagHandler",
		cdata: "cdataHandler",
		error: "errorHandler",
		end: "endHandler",
		ready: "readyHandler"
	};
	var SaxesParser = class {
		/**
		* @param opt The parser options.
		*/
		constructor(opt) {
			this.opt = opt !== null && opt !== void 0 ? opt : {};
			this.fragmentOpt = !!this.opt.fragment;
			const xmlnsOpt = this.xmlnsOpt = !!this.opt.xmlns;
			this.trackPosition = this.opt.position !== false;
			this.fileName = this.opt.fileName;
			if (xmlnsOpt) {
				this.nameStartCheck = isNCNameStartChar;
				this.nameCheck = isNCNameChar;
				this.isName = isNCName;
				this.processAttribs = this.processAttribsNS;
				this.pushAttrib = this.pushAttribNS;
				this.ns = Object.assign({ __proto__: null }, rootNS);
				const additional = this.opt.additionalNamespaces;
				if (additional != null) {
					nsMappingCheck(this, additional);
					Object.assign(this.ns, additional);
				}
			} else {
				this.nameStartCheck = isNameStartChar;
				this.nameCheck = isNameChar;
				this.isName = isName;
				this.processAttribs = this.processAttribsPlain;
				this.pushAttrib = this.pushAttribPlain;
			}
			this.stateTable = [
				this.sBegin,
				this.sBeginWhitespace,
				this.sDoctype,
				this.sDoctypeQuote,
				this.sDTD,
				this.sDTDQuoted,
				this.sDTDOpenWaka,
				this.sDTDOpenWakaBang,
				this.sDTDComment,
				this.sDTDCommentEnding,
				this.sDTDCommentEnded,
				this.sDTDPI,
				this.sDTDPIEnding,
				this.sText,
				this.sEntity,
				this.sOpenWaka,
				this.sOpenWakaBang,
				this.sComment,
				this.sCommentEnding,
				this.sCommentEnded,
				this.sCData,
				this.sCDataEnding,
				this.sCDataEnding2,
				this.sPIFirstChar,
				this.sPIRest,
				this.sPIBody,
				this.sPIEnding,
				this.sXMLDeclNameStart,
				this.sXMLDeclName,
				this.sXMLDeclEq,
				this.sXMLDeclValueStart,
				this.sXMLDeclValue,
				this.sXMLDeclSeparator,
				this.sXMLDeclEnding,
				this.sOpenTag,
				this.sOpenTagSlash,
				this.sAttrib,
				this.sAttribName,
				this.sAttribNameSawWhite,
				this.sAttribValue,
				this.sAttribValueQuoted,
				this.sAttribValueClosed,
				this.sAttribValueUnquoted,
				this.sCloseTag,
				this.sCloseTagSawWhite
			];
			this._init();
		}
		/**
		* Indicates whether or not the parser is closed. If ``true``, wait for
		* the ``ready`` event to write again.
		*/
		get closed() {
			return this._closed;
		}
		_init() {
			var _a;
			this.openWakaBang = "";
			this.text = "";
			this.name = "";
			this.piTarget = "";
			this.entity = "";
			this.q = null;
			this.tags = [];
			this.tag = null;
			this.topNS = null;
			this.chunk = "";
			this.chunkPosition = 0;
			this.i = 0;
			this.prevI = 0;
			this.carriedFromPrevious = void 0;
			this.forbiddenState = FORBIDDEN_START;
			this.attribList = [];
			const { fragmentOpt } = this;
			this.state = fragmentOpt ? S_TEXT : S_BEGIN;
			this.reportedTextBeforeRoot = this.reportedTextAfterRoot = this.closedRoot = this.sawRoot = fragmentOpt;
			this.xmlDeclPossible = !fragmentOpt;
			this.xmlDeclExpects = ["version"];
			this.entityReturnState = void 0;
			let { defaultXMLVersion } = this.opt;
			if (defaultXMLVersion === void 0) {
				if (this.opt.forceXMLVersion === true) throw new Error("forceXMLVersion set but defaultXMLVersion is not set");
				defaultXMLVersion = "1.0";
			}
			this.setXMLVersion(defaultXMLVersion);
			this.positionAtNewLine = 0;
			this.doctype = false;
			this._closed = false;
			this.xmlDecl = {
				version: void 0,
				encoding: void 0,
				standalone: void 0
			};
			this.line = 1;
			this.column = 0;
			this.ENTITIES = Object.create(XML_ENTITIES);
			(_a = this.readyHandler) === null || _a === void 0 || _a.call(this);
		}
		/**
		* The stream position the parser is currently looking at. This field is
		* zero-based.
		*
		* This field is not based on counting Unicode characters but is to be
		* interpreted as a plain index into a JavaScript string.
		*/
		get position() {
			return this.chunkPosition + this.i;
		}
		/**
		* The column number of the next character to be read by the parser.  *
		* This field is zero-based. (The first column in a line is 0.)
		*
		* This field reports the index at which the next character would be in the
		* line if the line were represented as a JavaScript string.  Note that this
		* *can* be different to a count based on the number of *Unicode characters*
		* due to how JavaScript handles astral plane characters.
		*
		* See [[column]] for a number that corresponds to a count of Unicode
		* characters.
		*/
		get columnIndex() {
			return this.position - this.positionAtNewLine;
		}
		/**
		* Set an event listener on an event. The parser supports one handler per
		* event type. If you try to set an event handler over an existing handler,
		* the old handler is silently overwritten.
		*
		* @param name The event to listen to.
		*
		* @param handler The handler to set.
		*/
		on(name, handler) {
			this[EVENT_NAME_TO_HANDLER_NAME[name]] = handler;
		}
		/**
		* Unset an event handler.
		*
		* @parma name The event to stop listening to.
		*/
		off(name) {
			this[EVENT_NAME_TO_HANDLER_NAME[name]] = void 0;
		}
		/**
		* Make an error object. The error object will have a message that contains
		* the ``fileName`` option passed at the creation of the parser. If position
		* tracking was turned on, it will also have line and column number
		* information.
		*
		* @param message The message describing the error to report.
		*
		* @returns An error object with a properly formatted message.
		*/
		makeError(message) {
			var _a;
			let msg = (_a = this.fileName) !== null && _a !== void 0 ? _a : "";
			if (this.trackPosition) {
				if (msg.length > 0) msg += ":";
				msg += `${this.line}:${this.column}`;
			}
			if (msg.length > 0) msg += ": ";
			return new Error(msg + message);
		}
		/**
		* Report a parsing error. This method is made public so that client code may
		* check for issues that are outside the scope of this project and can report
		* errors.
		*
		* @param message The error to report.
		*
		* @returns this
		*/
		fail(message) {
			const err = this.makeError(message);
			const handler = this.errorHandler;
			if (handler === void 0) throw err;
			else handler(err);
			return this;
		}
		/**
		* Write a XML data to the parser.
		*
		* @param chunk The XML data to write.
		*
		* @returns this
		*/
		write(chunk) {
			if (this.closed) return this.fail("cannot write after close; assign an onready handler.");
			let end = false;
			if (chunk === null) {
				end = true;
				chunk = "";
			} else if (typeof chunk === "object") chunk = chunk.toString();
			if (this.carriedFromPrevious !== void 0) {
				chunk = `${this.carriedFromPrevious}${chunk}`;
				this.carriedFromPrevious = void 0;
			}
			let limit = chunk.length;
			const lastCode = chunk.charCodeAt(limit - 1);
			if (!end && (lastCode === CR || lastCode >= 55296 && lastCode <= 56319)) {
				this.carriedFromPrevious = chunk[limit - 1];
				limit--;
				chunk = chunk.slice(0, limit);
			}
			const { stateTable } = this;
			this.chunk = chunk;
			this.i = 0;
			while (this.i < limit) stateTable[this.state].call(this);
			this.chunkPosition += limit;
			return end ? this.end() : this;
		}
		/**
		* Close the current stream. Perform final well-formedness checks and reset
		* the parser tstate.
		*
		* @returns this
		*/
		close() {
			return this.write(null);
		}
		/**
		* Get a single code point out of the current chunk. This updates the current
		* position if we do position tracking.
		*
		* This is the algorithm to use for XML 1.0.
		*
		* @returns The character read.
		*/
		getCode10() {
			const { chunk, i } = this;
			this.prevI = i;
			this.i = i + 1;
			if (i >= chunk.length) return EOC;
			const code = chunk.charCodeAt(i);
			this.column++;
			if (code < 55296) {
				if (code >= SPACE || code === TAB) return code;
				switch (code) {
					case NL:
						this.line++;
						this.column = 0;
						this.positionAtNewLine = this.position;
						return NL;
					case CR:
						if (chunk.charCodeAt(i + 1) === NL) this.i = i + 2;
						this.line++;
						this.column = 0;
						this.positionAtNewLine = this.position;
						return NL_LIKE;
					default:
						this.fail("disallowed character.");
						return code;
				}
			}
			if (code > 56319) {
				if (!(code >= 57344 && code <= 65533)) this.fail("disallowed character.");
				return code;
			}
			const final = 65536 + (code - 55296) * 1024 + (chunk.charCodeAt(i + 1) - 56320);
			this.i = i + 2;
			if (final > 1114111) this.fail("disallowed character.");
			return final;
		}
		/**
		* Get a single code point out of the current chunk. This updates the current
		* position if we do position tracking.
		*
		* This is the algorithm to use for XML 1.1.
		*
		* @returns {number} The character read.
		*/
		getCode11() {
			const { chunk, i } = this;
			this.prevI = i;
			this.i = i + 1;
			if (i >= chunk.length) return EOC;
			const code = chunk.charCodeAt(i);
			this.column++;
			if (code < 55296) {
				if (code > 31 && code < 127 || code > 159 && code !== LS || code === TAB) return code;
				switch (code) {
					case NL:
						this.line++;
						this.column = 0;
						this.positionAtNewLine = this.position;
						return NL;
					case CR: {
						const next = chunk.charCodeAt(i + 1);
						if (next === NL || next === NEL) this.i = i + 2;
					}
					case NEL:
					case LS:
						this.line++;
						this.column = 0;
						this.positionAtNewLine = this.position;
						return NL_LIKE;
					default:
						this.fail("disallowed character.");
						return code;
				}
			}
			if (code > 56319) {
				if (!(code >= 57344 && code <= 65533)) this.fail("disallowed character.");
				return code;
			}
			const final = 65536 + (code - 55296) * 1024 + (chunk.charCodeAt(i + 1) - 56320);
			this.i = i + 2;
			if (final > 1114111) this.fail("disallowed character.");
			return final;
		}
		/**
		* Like ``getCode`` but with the return value normalized so that ``NL`` is
		* returned for ``NL_LIKE``.
		*/
		getCodeNorm() {
			const c = this.getCode();
			return c === NL_LIKE ? NL : c;
		}
		unget() {
			this.i = this.prevI;
			this.column--;
		}
		/**
		* Capture characters into a buffer until encountering one of a set of
		* characters.
		*
		* @param chars An array of codepoints. Encountering a character in the array
		* ends the capture. (``chars`` may safely contain ``NL``.)
		*
		* @return The character code that made the capture end, or ``EOC`` if we hit
		* the end of the chunk. The return value cannot be NL_LIKE: NL is returned
		* instead.
		*/
		captureTo(chars) {
			let { i: start } = this;
			const { chunk } = this;
			while (true) {
				const c = this.getCode();
				const isNLLike = c === NL_LIKE;
				const final = isNLLike ? NL : c;
				if (final === EOC || chars.includes(final)) {
					this.text += chunk.slice(start, this.prevI);
					return final;
				}
				if (isNLLike) {
					this.text += `${chunk.slice(start, this.prevI)}\n`;
					start = this.i;
				}
			}
		}
		/**
		* Capture characters into a buffer until encountering a character.
		*
		* @param char The codepoint that ends the capture. **NOTE ``char`` MAY NOT
		* CONTAIN ``NL``.** Passing ``NL`` will result in buggy behavior.
		*
		* @return ``true`` if we ran into the character. Otherwise, we ran into the
		* end of the current chunk.
		*/
		captureToChar(char) {
			let { i: start } = this;
			const { chunk } = this;
			while (true) {
				let c = this.getCode();
				switch (c) {
					case NL_LIKE:
						this.text += `${chunk.slice(start, this.prevI)}\n`;
						start = this.i;
						c = NL;
						break;
					case EOC:
						this.text += chunk.slice(start);
						return false;
				}
				if (c === char) {
					this.text += chunk.slice(start, this.prevI);
					return true;
				}
			}
		}
		/**
		* Capture characters that satisfy ``isNameChar`` into the ``name`` field of
		* this parser.
		*
		* @return The character code that made the test fail, or ``EOC`` if we hit
		* the end of the chunk. The return value cannot be NL_LIKE: NL is returned
		* instead.
		*/
		captureNameChars() {
			const { chunk, i: start } = this;
			while (true) {
				const c = this.getCode();
				if (c === EOC) {
					this.name += chunk.slice(start);
					return EOC;
				}
				if (!isNameChar(c)) {
					this.name += chunk.slice(start, this.prevI);
					return c === NL_LIKE ? NL : c;
				}
			}
		}
		/**
		* Skip white spaces.
		*
		* @return The character that ended the skip, or ``EOC`` if we hit
		* the end of the chunk. The return value cannot be NL_LIKE: NL is returned
		* instead.
		*/
		skipSpaces() {
			while (true) {
				const c = this.getCodeNorm();
				if (c === EOC || !isS(c)) return c;
			}
		}
		setXMLVersion(version) {
			this.currentXMLVersion = version;
			if (version === "1.0") {
				this.isChar = isChar10;
				this.getCode = this.getCode10;
			} else {
				this.isChar = isChar11;
				this.getCode = this.getCode11;
			}
		}
		sBegin() {
			if (this.chunk.charCodeAt(0) === 65279) {
				this.i++;
				this.column++;
			}
			this.state = S_BEGIN_WHITESPACE;
		}
		sBeginWhitespace() {
			const iBefore = this.i;
			const c = this.skipSpaces();
			if (this.prevI !== iBefore) this.xmlDeclPossible = false;
			switch (c) {
				case LESS:
					this.state = S_OPEN_WAKA;
					if (this.text.length !== 0) throw new Error("no-empty text at start");
					break;
				case EOC: break;
				default:
					this.unget();
					this.state = S_TEXT;
					this.xmlDeclPossible = false;
			}
		}
		sDoctype() {
			var _a;
			const c = this.captureTo(DOCTYPE_TERMINATOR);
			switch (c) {
				case GREATER:
					(_a = this.doctypeHandler) === null || _a === void 0 || _a.call(this, this.text);
					this.text = "";
					this.state = S_TEXT;
					this.doctype = true;
					break;
				case EOC: break;
				default:
					this.text += String.fromCodePoint(c);
					if (c === OPEN_BRACKET) this.state = S_DTD;
					else if (isQuote(c)) {
						this.state = S_DOCTYPE_QUOTE;
						this.q = c;
					}
			}
		}
		sDoctypeQuote() {
			const q = this.q;
			if (this.captureToChar(q)) {
				this.text += String.fromCodePoint(q);
				this.q = null;
				this.state = S_DOCTYPE;
			}
		}
		sDTD() {
			const c = this.captureTo(DTD_TERMINATOR);
			if (c === EOC) return;
			this.text += String.fromCodePoint(c);
			if (c === CLOSE_BRACKET) this.state = S_DOCTYPE;
			else if (c === LESS) this.state = S_DTD_OPEN_WAKA;
			else if (isQuote(c)) {
				this.state = S_DTD_QUOTED;
				this.q = c;
			}
		}
		sDTDQuoted() {
			const q = this.q;
			if (this.captureToChar(q)) {
				this.text += String.fromCodePoint(q);
				this.state = S_DTD;
				this.q = null;
			}
		}
		sDTDOpenWaka() {
			const c = this.getCodeNorm();
			this.text += String.fromCodePoint(c);
			switch (c) {
				case BANG:
					this.state = S_DTD_OPEN_WAKA_BANG;
					this.openWakaBang = "";
					break;
				case QUESTION:
					this.state = S_DTD_PI;
					break;
				default: this.state = S_DTD;
			}
		}
		sDTDOpenWakaBang() {
			const char = String.fromCodePoint(this.getCodeNorm());
			const owb = this.openWakaBang += char;
			this.text += char;
			if (owb !== "-") {
				this.state = owb === "--" ? S_DTD_COMMENT : S_DTD;
				this.openWakaBang = "";
			}
		}
		sDTDComment() {
			if (this.captureToChar(MINUS)) {
				this.text += "-";
				this.state = S_DTD_COMMENT_ENDING;
			}
		}
		sDTDCommentEnding() {
			const c = this.getCodeNorm();
			this.text += String.fromCodePoint(c);
			this.state = c === MINUS ? S_DTD_COMMENT_ENDED : S_DTD_COMMENT;
		}
		sDTDCommentEnded() {
			const c = this.getCodeNorm();
			this.text += String.fromCodePoint(c);
			if (c === GREATER) this.state = S_DTD;
			else {
				this.fail("malformed comment.");
				this.state = S_DTD_COMMENT;
			}
		}
		sDTDPI() {
			if (this.captureToChar(QUESTION)) {
				this.text += "?";
				this.state = S_DTD_PI_ENDING;
			}
		}
		sDTDPIEnding() {
			const c = this.getCodeNorm();
			this.text += String.fromCodePoint(c);
			if (c === GREATER) this.state = S_DTD;
		}
		sText() {
			if (this.tags.length !== 0) this.handleTextInRoot();
			else this.handleTextOutsideRoot();
		}
		sEntity() {
			let { i: start } = this;
			const { chunk } = this;
			loop: while (true) switch (this.getCode()) {
				case NL_LIKE:
					this.entity += `${chunk.slice(start, this.prevI)}\n`;
					start = this.i;
					break;
				case SEMICOLON: {
					const { entityReturnState } = this;
					const entity = this.entity + chunk.slice(start, this.prevI);
					this.state = entityReturnState;
					let parsed;
					if (entity === "") {
						this.fail("empty entity name.");
						parsed = "&;";
					} else {
						parsed = this.parseEntity(entity);
						this.entity = "";
					}
					if (entityReturnState !== S_TEXT || this.textHandler !== void 0) this.text += parsed;
					break loop;
				}
				case EOC:
					this.entity += chunk.slice(start);
					break loop;
			}
		}
		sOpenWaka() {
			const c = this.getCode();
			if (isNameStartChar(c)) {
				this.state = S_OPEN_TAG;
				this.unget();
				this.xmlDeclPossible = false;
			} else switch (c) {
				case FORWARD_SLASH:
					this.state = S_CLOSE_TAG;
					this.xmlDeclPossible = false;
					break;
				case BANG:
					this.state = S_OPEN_WAKA_BANG;
					this.openWakaBang = "";
					this.xmlDeclPossible = false;
					break;
				case QUESTION:
					this.state = S_PI_FIRST_CHAR;
					break;
				default:
					this.fail("disallowed character in tag name");
					this.state = S_TEXT;
					this.xmlDeclPossible = false;
			}
		}
		sOpenWakaBang() {
			this.openWakaBang += String.fromCodePoint(this.getCodeNorm());
			switch (this.openWakaBang) {
				case "[CDATA[":
					if (!this.sawRoot && !this.reportedTextBeforeRoot) {
						this.fail("text data outside of root node.");
						this.reportedTextBeforeRoot = true;
					}
					if (this.closedRoot && !this.reportedTextAfterRoot) {
						this.fail("text data outside of root node.");
						this.reportedTextAfterRoot = true;
					}
					this.state = S_CDATA;
					this.openWakaBang = "";
					break;
				case "--":
					this.state = S_COMMENT;
					this.openWakaBang = "";
					break;
				case "DOCTYPE":
					this.state = S_DOCTYPE;
					if (this.doctype || this.sawRoot) this.fail("inappropriately located doctype declaration.");
					this.openWakaBang = "";
					break;
				default: if (this.openWakaBang.length >= 7) this.fail("incorrect syntax.");
			}
		}
		sComment() {
			if (this.captureToChar(MINUS)) this.state = S_COMMENT_ENDING;
		}
		sCommentEnding() {
			var _a;
			const c = this.getCodeNorm();
			if (c === MINUS) {
				this.state = S_COMMENT_ENDED;
				(_a = this.commentHandler) === null || _a === void 0 || _a.call(this, this.text);
				this.text = "";
			} else {
				this.text += `-${String.fromCodePoint(c)}`;
				this.state = S_COMMENT;
			}
		}
		sCommentEnded() {
			const c = this.getCodeNorm();
			if (c !== GREATER) {
				this.fail("malformed comment.");
				this.text += `--${String.fromCodePoint(c)}`;
				this.state = S_COMMENT;
			} else this.state = S_TEXT;
		}
		sCData() {
			if (this.captureToChar(CLOSE_BRACKET)) this.state = S_CDATA_ENDING;
		}
		sCDataEnding() {
			const c = this.getCodeNorm();
			if (c === CLOSE_BRACKET) this.state = S_CDATA_ENDING_2;
			else {
				this.text += `]${String.fromCodePoint(c)}`;
				this.state = S_CDATA;
			}
		}
		sCDataEnding2() {
			var _a;
			const c = this.getCodeNorm();
			switch (c) {
				case GREATER:
					(_a = this.cdataHandler) === null || _a === void 0 || _a.call(this, this.text);
					this.text = "";
					this.state = S_TEXT;
					break;
				case CLOSE_BRACKET:
					this.text += "]";
					break;
				default:
					this.text += `]]${String.fromCodePoint(c)}`;
					this.state = S_CDATA;
			}
		}
		sPIFirstChar() {
			const c = this.getCodeNorm();
			if (this.nameStartCheck(c)) {
				this.piTarget += String.fromCodePoint(c);
				this.state = S_PI_REST;
			} else if (c === QUESTION || isS(c)) {
				this.fail("processing instruction without a target.");
				this.state = c === QUESTION ? S_PI_ENDING : S_PI_BODY;
			} else {
				this.fail("disallowed character in processing instruction name.");
				this.piTarget += String.fromCodePoint(c);
				this.state = S_PI_REST;
			}
		}
		sPIRest() {
			const { chunk, i: start } = this;
			while (true) {
				const c = this.getCodeNorm();
				if (c === EOC) {
					this.piTarget += chunk.slice(start);
					return;
				}
				if (!this.nameCheck(c)) {
					this.piTarget += chunk.slice(start, this.prevI);
					const isQuestion = c === QUESTION;
					if (isQuestion || isS(c)) {
						if (this.piTarget === "xml") {
							if (!this.xmlDeclPossible) this.fail("an XML declaration must be at the start of the document.");
							this.state = isQuestion ? S_XML_DECL_ENDING : S_XML_DECL_NAME_START;
						} else this.state = isQuestion ? S_PI_ENDING : S_PI_BODY;
					} else {
						this.fail("disallowed character in processing instruction name.");
						this.piTarget += String.fromCodePoint(c);
					}
					break;
				}
			}
		}
		sPIBody() {
			if (this.text.length === 0) {
				const c = this.getCodeNorm();
				if (c === QUESTION) this.state = S_PI_ENDING;
				else if (!isS(c)) this.text = String.fromCodePoint(c);
			} else if (this.captureToChar(QUESTION)) this.state = S_PI_ENDING;
		}
		sPIEnding() {
			var _a;
			const c = this.getCodeNorm();
			if (c === GREATER) {
				const { piTarget } = this;
				if (piTarget.toLowerCase() === "xml") this.fail("the XML declaration must appear at the start of the document.");
				(_a = this.piHandler) === null || _a === void 0 || _a.call(this, {
					target: piTarget,
					body: this.text
				});
				this.piTarget = this.text = "";
				this.state = S_TEXT;
			} else if (c === QUESTION) this.text += "?";
			else {
				this.text += `?${String.fromCodePoint(c)}`;
				this.state = S_PI_BODY;
			}
			this.xmlDeclPossible = false;
		}
		sXMLDeclNameStart() {
			const c = this.skipSpaces();
			if (c === QUESTION) {
				this.state = S_XML_DECL_ENDING;
				return;
			}
			if (c !== EOC) {
				this.state = S_XML_DECL_NAME;
				this.name = String.fromCodePoint(c);
			}
		}
		sXMLDeclName() {
			const c = this.captureTo(XML_DECL_NAME_TERMINATOR);
			if (c === QUESTION) {
				this.state = S_XML_DECL_ENDING;
				this.name += this.text;
				this.text = "";
				this.fail("XML declaration is incomplete.");
				return;
			}
			if (!(isS(c) || c === EQUAL)) return;
			this.name += this.text;
			this.text = "";
			if (!this.xmlDeclExpects.includes(this.name)) switch (this.name.length) {
				case 0:
					this.fail("did not expect any more name/value pairs.");
					break;
				case 1:
					this.fail(`expected the name ${this.xmlDeclExpects[0]}.`);
					break;
				default: this.fail(`expected one of ${this.xmlDeclExpects.join(", ")}`);
			}
			this.state = c === EQUAL ? S_XML_DECL_VALUE_START : S_XML_DECL_EQ;
		}
		sXMLDeclEq() {
			const c = this.getCodeNorm();
			if (c === QUESTION) {
				this.state = S_XML_DECL_ENDING;
				this.fail("XML declaration is incomplete.");
				return;
			}
			if (isS(c)) return;
			if (c !== EQUAL) this.fail("value required.");
			this.state = S_XML_DECL_VALUE_START;
		}
		sXMLDeclValueStart() {
			const c = this.getCodeNorm();
			if (c === QUESTION) {
				this.state = S_XML_DECL_ENDING;
				this.fail("XML declaration is incomplete.");
				return;
			}
			if (isS(c)) return;
			if (!isQuote(c)) {
				this.fail("value must be quoted.");
				this.q = SPACE;
			} else this.q = c;
			this.state = S_XML_DECL_VALUE;
		}
		sXMLDeclValue() {
			const c = this.captureTo([this.q, QUESTION]);
			if (c === QUESTION) {
				this.state = S_XML_DECL_ENDING;
				this.text = "";
				this.fail("XML declaration is incomplete.");
				return;
			}
			if (c === EOC) return;
			const value = this.text;
			this.text = "";
			switch (this.name) {
				case "version": {
					this.xmlDeclExpects = ["encoding", "standalone"];
					const version = value;
					this.xmlDecl.version = version;
					if (!/^1\.[0-9]+$/.test(version)) this.fail("version number must match /^1\\.[0-9]+$/.");
					else if (!this.opt.forceXMLVersion) this.setXMLVersion(version);
					break;
				}
				case "encoding":
					if (!/^[A-Za-z][A-Za-z0-9._-]*$/.test(value)) this.fail("encoding value must match /^[A-Za-z0-9][A-Za-z0-9._-]*$/.");
					this.xmlDeclExpects = ["standalone"];
					this.xmlDecl.encoding = value;
					break;
				case "standalone":
					if (value !== "yes" && value !== "no") this.fail("standalone value must match \"yes\" or \"no\".");
					this.xmlDeclExpects = [];
					this.xmlDecl.standalone = value;
			}
			this.name = "";
			this.state = S_XML_DECL_SEPARATOR;
		}
		sXMLDeclSeparator() {
			const c = this.getCodeNorm();
			if (c === QUESTION) {
				this.state = S_XML_DECL_ENDING;
				return;
			}
			if (!isS(c)) {
				this.fail("whitespace required.");
				this.unget();
			}
			this.state = S_XML_DECL_NAME_START;
		}
		sXMLDeclEnding() {
			var _a;
			if (this.getCodeNorm() === GREATER) {
				if (this.piTarget !== "xml") this.fail("processing instructions are not allowed before root.");
				else if (this.name !== "version" && this.xmlDeclExpects.includes("version")) this.fail("XML declaration must contain a version.");
				(_a = this.xmldeclHandler) === null || _a === void 0 || _a.call(this, this.xmlDecl);
				this.name = "";
				this.piTarget = this.text = "";
				this.state = S_TEXT;
			} else this.fail("The character ? is disallowed anywhere in XML declarations.");
			this.xmlDeclPossible = false;
		}
		sOpenTag() {
			var _a;
			const c = this.captureNameChars();
			if (c === EOC) return;
			const tag = this.tag = {
				name: this.name,
				attributes: Object.create(null)
			};
			this.name = "";
			if (this.xmlnsOpt) this.topNS = tag.ns = Object.create(null);
			(_a = this.openTagStartHandler) === null || _a === void 0 || _a.call(this, tag);
			this.sawRoot = true;
			if (!this.fragmentOpt && this.closedRoot) this.fail("documents may contain only one root.");
			switch (c) {
				case GREATER:
					this.openTag();
					break;
				case FORWARD_SLASH:
					this.state = S_OPEN_TAG_SLASH;
					break;
				default:
					if (!isS(c)) this.fail("disallowed character in tag name.");
					this.state = S_ATTRIB;
			}
		}
		sOpenTagSlash() {
			if (this.getCode() === GREATER) this.openSelfClosingTag();
			else {
				this.fail("forward-slash in opening tag not followed by >.");
				this.state = S_ATTRIB;
			}
		}
		sAttrib() {
			const c = this.skipSpaces();
			if (c === EOC) return;
			if (isNameStartChar(c)) {
				this.unget();
				this.state = S_ATTRIB_NAME;
			} else if (c === GREATER) this.openTag();
			else if (c === FORWARD_SLASH) this.state = S_OPEN_TAG_SLASH;
			else this.fail("disallowed character in attribute name.");
		}
		sAttribName() {
			const c = this.captureNameChars();
			if (c === EQUAL) this.state = S_ATTRIB_VALUE;
			else if (isS(c)) this.state = S_ATTRIB_NAME_SAW_WHITE;
			else if (c === GREATER) {
				this.fail("attribute without value.");
				this.pushAttrib(this.name, this.name);
				this.name = this.text = "";
				this.openTag();
			} else if (c !== EOC) this.fail("disallowed character in attribute name.");
		}
		sAttribNameSawWhite() {
			const c = this.skipSpaces();
			switch (c) {
				case EOC: return;
				case EQUAL:
					this.state = S_ATTRIB_VALUE;
					break;
				default:
					this.fail("attribute without value.");
					this.text = "";
					this.name = "";
					if (c === GREATER) this.openTag();
					else if (isNameStartChar(c)) {
						this.unget();
						this.state = S_ATTRIB_NAME;
					} else {
						this.fail("disallowed character in attribute name.");
						this.state = S_ATTRIB;
					}
			}
		}
		sAttribValue() {
			const c = this.getCodeNorm();
			if (isQuote(c)) {
				this.q = c;
				this.state = S_ATTRIB_VALUE_QUOTED;
			} else if (!isS(c)) {
				this.fail("unquoted attribute value.");
				this.state = S_ATTRIB_VALUE_UNQUOTED;
				this.unget();
			}
		}
		sAttribValueQuoted() {
			const { q, chunk } = this;
			let { i: start } = this;
			while (true) switch (this.getCode()) {
				case q:
					this.pushAttrib(this.name, this.text + chunk.slice(start, this.prevI));
					this.name = this.text = "";
					this.q = null;
					this.state = S_ATTRIB_VALUE_CLOSED;
					return;
				case AMP:
					this.text += chunk.slice(start, this.prevI);
					this.state = S_ENTITY;
					this.entityReturnState = S_ATTRIB_VALUE_QUOTED;
					return;
				case NL:
				case NL_LIKE:
				case TAB:
					this.text += `${chunk.slice(start, this.prevI)} `;
					start = this.i;
					break;
				case LESS:
					this.text += chunk.slice(start, this.prevI);
					this.fail("disallowed character.");
					return;
				case EOC:
					this.text += chunk.slice(start);
					return;
			}
		}
		sAttribValueClosed() {
			const c = this.getCodeNorm();
			if (isS(c)) this.state = S_ATTRIB;
			else if (c === GREATER) this.openTag();
			else if (c === FORWARD_SLASH) this.state = S_OPEN_TAG_SLASH;
			else if (isNameStartChar(c)) {
				this.fail("no whitespace between attributes.");
				this.unget();
				this.state = S_ATTRIB_NAME;
			} else this.fail("disallowed character in attribute name.");
		}
		sAttribValueUnquoted() {
			const c = this.captureTo(ATTRIB_VALUE_UNQUOTED_TERMINATOR);
			switch (c) {
				case AMP:
					this.state = S_ENTITY;
					this.entityReturnState = S_ATTRIB_VALUE_UNQUOTED;
					break;
				case LESS:
					this.fail("disallowed character.");
					break;
				case EOC: break;
				default:
					if (this.text.includes("]]>")) this.fail("the string \"]]>\" is disallowed in char data.");
					this.pushAttrib(this.name, this.text);
					this.name = this.text = "";
					if (c === GREATER) this.openTag();
					else this.state = S_ATTRIB;
			}
		}
		sCloseTag() {
			const c = this.captureNameChars();
			if (c === GREATER) this.closeTag();
			else if (isS(c)) this.state = S_CLOSE_TAG_SAW_WHITE;
			else if (c !== EOC) this.fail("disallowed character in closing tag.");
		}
		sCloseTagSawWhite() {
			switch (this.skipSpaces()) {
				case GREATER:
					this.closeTag();
					break;
				case EOC: break;
				default: this.fail("disallowed character in closing tag.");
			}
		}
		handleTextInRoot() {
			let { i: start, forbiddenState } = this;
			const { chunk, textHandler: handler } = this;
			scanLoop: while (true) switch (this.getCode()) {
				case LESS:
					this.state = S_OPEN_WAKA;
					if (handler !== void 0) {
						const { text } = this;
						const slice = chunk.slice(start, this.prevI);
						if (text.length !== 0) {
							handler(text + slice);
							this.text = "";
						} else if (slice.length !== 0) handler(slice);
					}
					forbiddenState = FORBIDDEN_START;
					break scanLoop;
				case AMP:
					this.state = S_ENTITY;
					this.entityReturnState = S_TEXT;
					if (handler !== void 0) this.text += chunk.slice(start, this.prevI);
					forbiddenState = FORBIDDEN_START;
					break scanLoop;
				case CLOSE_BRACKET:
					switch (forbiddenState) {
						case FORBIDDEN_START:
							forbiddenState = FORBIDDEN_BRACKET;
							break;
						case FORBIDDEN_BRACKET:
							forbiddenState = FORBIDDEN_BRACKET_BRACKET;
							break;
						case FORBIDDEN_BRACKET_BRACKET: break;
						default: throw new Error("impossible state");
					}
					break;
				case GREATER:
					if (forbiddenState === FORBIDDEN_BRACKET_BRACKET) this.fail("the string \"]]>\" is disallowed in char data.");
					forbiddenState = FORBIDDEN_START;
					break;
				case NL_LIKE:
					if (handler !== void 0) this.text += `${chunk.slice(start, this.prevI)}\n`;
					start = this.i;
					forbiddenState = FORBIDDEN_START;
					break;
				case EOC:
					if (handler !== void 0) this.text += chunk.slice(start);
					break scanLoop;
				default: forbiddenState = FORBIDDEN_START;
			}
			this.forbiddenState = forbiddenState;
		}
		handleTextOutsideRoot() {
			let { i: start } = this;
			const { chunk, textHandler: handler } = this;
			let nonSpace = false;
			outRootLoop: while (true) {
				const code = this.getCode();
				switch (code) {
					case LESS:
						this.state = S_OPEN_WAKA;
						if (handler !== void 0) {
							const { text } = this;
							const slice = chunk.slice(start, this.prevI);
							if (text.length !== 0) {
								handler(text + slice);
								this.text = "";
							} else if (slice.length !== 0) handler(slice);
						}
						break outRootLoop;
					case AMP:
						this.state = S_ENTITY;
						this.entityReturnState = S_TEXT;
						if (handler !== void 0) this.text += chunk.slice(start, this.prevI);
						nonSpace = true;
						break outRootLoop;
					case NL_LIKE:
						if (handler !== void 0) this.text += `${chunk.slice(start, this.prevI)}\n`;
						start = this.i;
						break;
					case EOC:
						if (handler !== void 0) this.text += chunk.slice(start);
						break outRootLoop;
					default: if (!isS(code)) nonSpace = true;
				}
			}
			if (!nonSpace) return;
			if (!this.sawRoot && !this.reportedTextBeforeRoot) {
				this.fail("text data outside of root node.");
				this.reportedTextBeforeRoot = true;
			}
			if (this.closedRoot && !this.reportedTextAfterRoot) {
				this.fail("text data outside of root node.");
				this.reportedTextAfterRoot = true;
			}
		}
		pushAttribNS(name, value) {
			var _a;
			const { prefix, local } = this.qname(name);
			const attr = {
				name,
				prefix,
				local,
				value
			};
			this.attribList.push(attr);
			(_a = this.attributeHandler) === null || _a === void 0 || _a.call(this, attr);
			if (prefix === "xmlns") {
				const trimmed = value.trim();
				if (this.currentXMLVersion === "1.0" && trimmed === "") this.fail("invalid attempt to undefine prefix in XML 1.0");
				this.topNS[local] = trimmed;
				nsPairCheck(this, local, trimmed);
			} else if (name === "xmlns") {
				const trimmed = value.trim();
				this.topNS[""] = trimmed;
				nsPairCheck(this, "", trimmed);
			}
		}
		pushAttribPlain(name, value) {
			var _a;
			const attr = {
				name,
				value
			};
			this.attribList.push(attr);
			(_a = this.attributeHandler) === null || _a === void 0 || _a.call(this, attr);
		}
		/**
		* End parsing. This performs final well-formedness checks and resets the
		* parser to a clean state.
		*
		* @returns this
		*/
		end() {
			var _a, _b;
			if (!this.sawRoot) this.fail("document must contain a root element.");
			const { tags } = this;
			while (tags.length > 0) {
				const tag = tags.pop();
				this.fail(`unclosed tag: ${tag.name}`);
			}
			if (this.state !== S_BEGIN && this.state !== S_TEXT) this.fail("unexpected end.");
			const { text } = this;
			if (text.length !== 0) {
				(_a = this.textHandler) === null || _a === void 0 || _a.call(this, text);
				this.text = "";
			}
			this._closed = true;
			(_b = this.endHandler) === null || _b === void 0 || _b.call(this);
			this._init();
			return this;
		}
		/**
		* Resolve a namespace prefix.
		*
		* @param prefix The prefix to resolve.
		*
		* @returns The namespace URI or ``undefined`` if the prefix is not defined.
		*/
		resolve(prefix) {
			var _a, _b;
			let uri = this.topNS[prefix];
			if (uri !== void 0) return uri;
			const { tags } = this;
			for (let index = tags.length - 1; index >= 0; index--) {
				uri = tags[index].ns[prefix];
				if (uri !== void 0) return uri;
			}
			uri = this.ns[prefix];
			if (uri !== void 0) return uri;
			return (_b = (_a = this.opt).resolvePrefix) === null || _b === void 0 ? void 0 : _b.call(_a, prefix);
		}
		/**
		* Parse a qname into its prefix and local name parts.
		*
		* @param name The name to parse
		*
		* @returns
		*/
		qname(name) {
			const colon = name.indexOf(":");
			if (colon === -1) return {
				prefix: "",
				local: name
			};
			const local = name.slice(colon + 1);
			const prefix = name.slice(0, colon);
			if (prefix === "" || local === "" || local.includes(":")) this.fail(`malformed name: ${name}.`);
			return {
				prefix,
				local
			};
		}
		processAttribsNS() {
			var _a;
			const { attribList } = this;
			const tag = this.tag;
			{
				const { prefix, local } = this.qname(tag.name);
				tag.prefix = prefix;
				tag.local = local;
				const uri = tag.uri = (_a = this.resolve(prefix)) !== null && _a !== void 0 ? _a : "";
				if (prefix !== "") {
					if (prefix === "xmlns") this.fail("tags may not have \"xmlns\" as prefix.");
					if (uri === "") {
						this.fail(`unbound namespace prefix: ${JSON.stringify(prefix)}.`);
						tag.uri = prefix;
					}
				}
			}
			if (attribList.length === 0) return;
			const { attributes } = tag;
			const seen = /* @__PURE__ */ new Set();
			for (const attr of attribList) {
				const { name, prefix, local } = attr;
				let uri;
				let eqname;
				if (prefix === "") {
					uri = name === "xmlns" ? XMLNS_NAMESPACE : "";
					eqname = name;
				} else {
					uri = this.resolve(prefix);
					if (uri === void 0) {
						this.fail(`unbound namespace prefix: ${JSON.stringify(prefix)}.`);
						uri = prefix;
					}
					eqname = `{${uri}}${local}`;
				}
				if (seen.has(eqname)) this.fail(`duplicate attribute: ${eqname}.`);
				seen.add(eqname);
				attr.uri = uri;
				attributes[name] = attr;
			}
			this.attribList = [];
		}
		processAttribsPlain() {
			const { attribList } = this;
			const attributes = this.tag.attributes;
			for (const { name, value } of attribList) {
				if (attributes[name] !== void 0) this.fail(`duplicate attribute: ${name}.`);
				attributes[name] = value;
			}
			this.attribList = [];
		}
		/**
		* Handle a complete open tag. This parser code calls this once it has seen
		* the whole tag. This method checks for well-formeness and then emits
		* ``onopentag``.
		*/
		openTag() {
			var _a;
			this.processAttribs();
			const { tags } = this;
			const tag = this.tag;
			tag.isSelfClosing = false;
			(_a = this.openTagHandler) === null || _a === void 0 || _a.call(this, tag);
			tags.push(tag);
			this.state = S_TEXT;
			this.name = "";
		}
		/**
		* Handle a complete self-closing tag. This parser code calls this once it has
		* seen the whole tag. This method checks for well-formeness and then emits
		* ``onopentag`` and ``onclosetag``.
		*/
		openSelfClosingTag() {
			var _a, _b, _c;
			this.processAttribs();
			const { tags } = this;
			const tag = this.tag;
			tag.isSelfClosing = true;
			(_a = this.openTagHandler) === null || _a === void 0 || _a.call(this, tag);
			(_b = this.closeTagHandler) === null || _b === void 0 || _b.call(this, tag);
			if ((this.tag = (_c = tags[tags.length - 1]) !== null && _c !== void 0 ? _c : null) === null) this.closedRoot = true;
			this.state = S_TEXT;
			this.name = "";
		}
		/**
		* Handle a complete close tag. This parser code calls this once it has seen
		* the whole tag. This method checks for well-formeness and then emits
		* ``onclosetag``.
		*/
		closeTag() {
			const { tags, name } = this;
			this.state = S_TEXT;
			this.name = "";
			if (name === "") {
				this.fail("weird empty close tag.");
				this.text += "</>";
				return;
			}
			const handler = this.closeTagHandler;
			let l = tags.length;
			while (l-- > 0) {
				const tag = this.tag = tags.pop();
				this.topNS = tag.ns;
				handler === null || handler === void 0 || handler(tag);
				if (tag.name === name) break;
				this.fail("unexpected close tag.");
			}
			if (l === 0) this.closedRoot = true;
			else if (l < 0) {
				this.fail(`unmatched closing tag: ${name}.`);
				this.text += `</${name}>`;
			}
		}
		/**
		* Resolves an entity. Makes any necessary well-formedness checks.
		*
		* @param entity The entity to resolve.
		*
		* @returns The parsed entity.
		*/
		parseEntity(entity) {
			if (entity[0] !== "#") {
				const defined = this.ENTITIES[entity];
				if (defined !== void 0) return defined;
				this.fail(this.isName(entity) ? "undefined entity." : "disallowed character in entity name.");
				return `&${entity};`;
			}
			let num = NaN;
			if (entity[1] === "x" && /^#x[0-9a-f]+$/i.test(entity)) num = parseInt(entity.slice(2), 16);
			else if (/^#[0-9]+$/.test(entity)) num = parseInt(entity.slice(1), 10);
			if (!this.isChar(num)) {
				this.fail("malformed character entity.");
				return `&${entity};`;
			}
			return String.fromCodePoint(num);
		}
	};
	exports.SaxesParser = SaxesParser;
})))();
/**
* XMLTV time → epoch ms. Accepts "20240101120000 +0100", "20240101120000+0100",
* "202401011200", "20240101120000 Z" and no offset (= UTC). Returns NaN if invalid.
*/
function parseXmltvTime(v) {
	if (!v) return NaN;
	const s = v.trim();
	if (s.length < 12) return NaN;
	const d = (a, b) => {
		let n = 0;
		for (let i = a; i < b; i++) {
			const c = s.charCodeAt(i) - 48;
			if (c < 0 || c > 9) return NaN;
			n = n * 10 + c;
		}
		return n;
	};
	const Y = d(0, 4);
	const M = d(4, 6);
	const D = d(6, 8);
	const h = d(8, 10);
	const m = d(10, 12);
	let i = 12;
	let sec = 0;
	if (s.length >= 14 && /\d\d/.test(s.slice(12, 14))) {
		sec = d(12, 14);
		i = 14;
	}
	let ms = Date.UTC(Y, M - 1, D, h, m, sec);
	if (Number.isNaN(ms)) return NaN;
	const tz = s.slice(i).trim();
	const om = /^([+-])(\d{2}):?(\d{2})$/.exec(tz);
	if (om) {
		const off = (Number(om[2]) * 60 + Number(om[3])) * 6e4;
		ms -= om[1] === "+" ? off : -off;
	}
	return ms;
}
/** True if the bytes start with the gzip magic number. */
function isGzip(bytes) {
	return bytes.length >= 2 && bytes[0] === 31 && bytes[1] === 139;
}
function createXmltvCollector(opts = {}) {
	const now = Date.now();
	const from = opts.from ?? now - 216e5;
	const to = opts.to ?? now + 1728e5;
	const filter = opts.channelIds && opts.channelIds.size ? opts.channelIds : void 0;
	const programmes = [];
	const channels = [];
	let errors = 0;
	let prog = null;
	let chan = null;
	let field = null;
	let text = "";
	const parser = new import_saxes.SaxesParser({
		xmlns: false,
		position: false
	});
	parser.on("error", () => {
		errors++;
		if (errors > 1e4) throw new Error("XMLTV: too many XML errors, giving up");
	});
	parser.on("opentag", (tag) => {
		const a = tag.attributes;
		switch (tag.name) {
			case "programme": {
				const channelId = a.channel?.trim();
				if (!channelId || filter && !filter.has(channelId)) {
					prog = null;
					return;
				}
				const start = parseXmltvTime(a.start);
				let stop = parseXmltvTime(a.stop);
				if (Number.isNaN(start)) {
					prog = null;
					return;
				}
				if (Number.isNaN(stop)) stop = start + 36e5;
				if (stop <= from || start >= to) {
					prog = null;
					return;
				}
				prog = {
					channelId,
					start,
					stop,
					title: ""
				};
				return;
			}
			case "channel":
				chan = a.id ? { id: a.id.trim() } : null;
				return;
			case "title":
			case "desc":
			case "category":
				if (prog) {
					field = tag.name;
					text = "";
				}
				return;
			case "display-name":
				if (chan && !chan.displayName) {
					field = "display-name";
					text = "";
				}
				return;
			case "icon":
				if (prog && !prog.icon && a.src) prog.icon = a.src;
				else if (chan && !chan.icon && a.src) chan.icon = a.src;
				return;
		}
	});
	parser.on("text", (t) => {
		if (field) text += t;
	});
	parser.on("cdata", (t) => {
		if (field) text += t;
	});
	parser.on("closetag", (tag) => {
		switch (tag.name) {
			case "title":
			case "desc":
			case "category":
				if (prog && field === tag.name) {
					const v = text.trim();
					if (v && !prog[field]) prog[field] = v;
				}
				field = null;
				return;
			case "display-name":
				if (chan && field === "display-name") chan.displayName = text.trim() || void 0;
				field = null;
				return;
			case "programme":
				if (prog) {
					if (!prog.title) prog.title = "—";
					programmes.push(prog);
				}
				prog = null;
				return;
			case "channel":
				if (chan) channels.push(chan);
				chan = null;
				return;
		}
	});
	return {
		write(chunk) {
			parser.write(chunk);
		},
		finish() {
			parser.close();
			programmes.sort((a, b) => a.channelId < b.channelId ? -1 : a.channelId > b.channelId ? 1 : a.start - b.start);
			return {
				programmes,
				channels,
				errors
			};
		}
	};
}
/** Parse a complete XMLTV string synchronously (no streams; used by the Apple TV core). */
function parseXmltvText(text, opts = {}) {
	const c = createXmltvCollector(opts);
	const step = 1 << 20;
	for (let i = 0; i < text.length; i += step) {
		if (opts.signal?.aborted) throw new Error("aborted");
		c.write(text.slice(i, i + step));
	}
	return c.finish();
}
//#endregion
//#region src/lib/providers/errors.ts
var HttpError = class extends Error {
	code;
	status;
	/** The request url with credentials masked. */
	url;
	constructor(code, message, opts = {}) {
		super(message);
		this.name = "HttpError";
		this.code = code;
		this.status = opts.status;
		this.url = opts.url;
	}
};
//#endregion
//#region src/lib/providers/xtream-map.ts
/**
* Normalise what users type as server: add http://, strip trailing slashes and
* known endpoint paths (player_api.php, get.php, xmltv.php, panel_api.php).
*/
function normalizeServerUrl(input) {
	let s = input.trim();
	if (!s) return s;
	if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = "http://" + s;
	const u = splitUrl(s);
	if (!u) return s.replace(/\/+$/, "");
	let path = u.pathname.replace(/\/(player_api|get|xmltv|panel_api)\.php$/i, "");
	path = path.replace(/\/+$/, "");
	return `${u.protocol}//${u.host}${path}`;
}
var enc = encodeURIComponent;
function movieUrl(c, streamId, ext = "mp4") {
	return `${normalizeServerUrl(c.serverUrl)}/movie/${enc(c.username)}/${enc(c.password)}/${streamId}.${ext}`;
}
function episodeUrl(c, episodeId, ext = "mp4") {
	return `${normalizeServerUrl(c.serverUrl)}/series/${enc(c.username)}/${enc(c.password)}/${episodeId}.${ext}`;
}
function liveUrl(c, streamId, ext = "m3u8") {
	return `${normalizeServerUrl(c.serverUrl)}/live/${enc(c.username)}/${enc(c.password)}/${streamId}.${ext}`;
}
/** MPEG-TS alternative for an Xtream live url (some panels only serve .ts). */
function liveTsUrl(url) {
	return /\/live\/[^/]+\/[^/]+\/[^/]+\.m3u8(\?|$)/.test(url) ? url.replace(/\.m3u8(\?|$)/, ".ts$1") : void 0;
}
function xmltvUrl(c) {
	return `${normalizeServerUrl(c.serverUrl)}/xmltv.php?username=${enc(c.username)}&password=${enc(c.password)}`;
}
function cleanExt(v, fallback) {
	const s = str$1(v)?.replace(/^\./, "").toLowerCase();
	return s && /^[a-z0-9]{2,5}$/.test(s) ? s : fallback;
}
function asArray(v) {
	if (Array.isArray(v)) return v.filter((x) => !!x && typeof x === "object");
	if (v && typeof v === "object") return Object.values(v).filter((x) => !!x && typeof x === "object");
	return [];
}
/** Map of category_id → category_name. */
function categoryMap(cats) {
	const m = /* @__PURE__ */ new Map();
	for (const c of asArray(cats)) {
		const id = str$1(c.category_id);
		const name = str$1(c.category_name);
		if (id && name) m.set(id, name);
	}
	return m;
}
function category(item, cats) {
	const id = str$1(item.category_id) ?? str$1(asStrList(item.category_ids)[0]);
	return id ? cats.get(id) : void 0;
}
function asStrList(v) {
	return Array.isArray(v) ? v.map((x) => str$1(x)).filter((x) => !!x) : [];
}
function rating(item) {
	const r = num$1(item.rating);
	if (r !== void 0 && r > 0 && r <= 10) return r;
	const r5 = num$1(item.rating_5based);
	if (r5 !== void 0 && r5 > 0 && r5 <= 5) return Math.round(r5 * 20) / 10;
}
function firstUrl(v) {
	if (Array.isArray(v)) {
		for (const x of v) {
			const u = httpUrl(x);
			if (u) return u;
		}
		return;
	}
	return httpUrl(v);
}
function releaseDate$1(item) {
	return str$1(item.releasedate) ?? str$1(item.releaseDate) ?? str$1(item.release_date) ?? str$1(item.air_date);
}
function imdb(v) {
	const s = str$1(v);
	return s && /^tt\d{5,}$/.test(s) ? s : void 0;
}
/** get_vod_streams item → RawMovie. */
function mapVodStream(item, ctx) {
	const id = str$1(item.stream_id);
	const rawTitle = str$1(item.name) ?? str$1(item.title);
	if (!id || !rawTitle) return void 0;
	const ext = cleanExt(item.container_extension, "mp4");
	const rd = releaseDate$1(item);
	return {
		kind: "movie",
		sourceId: ctx.sourceId,
		providerId: id,
		rawTitle,
		category: category(item, ctx.cats),
		originalTitle: str$1(item.o_name) ?? str$1(item.original_name),
		year: year(item.year) ?? year(rd),
		tmdbId: posInt(item.tmdb) ?? posInt(item.tmdb_id),
		imdbId: imdb(item.imdb) ?? imdb(item.imdb_id),
		posterUrl: httpUrl(item.stream_icon) ?? httpUrl(item.cover) ?? httpUrl(item.cover_big),
		backdropUrl: firstUrl(item.backdrop_path),
		plot: str$1(item.plot) ?? str$1(item.description),
		genres: list(item.genre),
		cast: list(item.cast) ?? list(item.actors),
		director: str$1(item.director),
		releaseDate: rd,
		rating: rating(item),
		durationSec: num$1(item.duration_secs) || durationToSec(item.episode_run_time) || durationToSec(item.duration, "min"),
		trailerUrl: youtubeUrl(item.youtube_trailer) ?? youtubeUrl(item.trailer),
		addedAt: unixToMs(item.added),
		url: movieUrl(ctx.creds, id, ext),
		containerExt: ext
	};
}
/** get_series item → RawSeries (episodes are loaded lazily via get_series_info). */
function mapSeries(item, ctx) {
	const id = str$1(item.series_id);
	const rawTitle = str$1(item.name) ?? str$1(item.title);
	if (!id || !rawTitle) return void 0;
	const rd = releaseDate$1(item);
	return {
		kind: "series",
		sourceId: ctx.sourceId,
		providerId: id,
		rawTitle,
		category: category(item, ctx.cats),
		year: year(item.year) ?? year(rd),
		tmdbId: posInt(item.tmdb) ?? posInt(item.tmdb_id),
		imdbId: imdb(item.imdb) ?? imdb(item.imdb_id),
		posterUrl: httpUrl(item.cover) ?? httpUrl(item.stream_icon),
		backdropUrl: firstUrl(item.backdrop_path),
		plot: str$1(item.plot) ?? str$1(item.description),
		genres: list(item.genre),
		cast: list(item.cast),
		director: str$1(item.director),
		releaseDate: rd,
		rating: rating(item),
		durationSec: durationToSec(item.episode_run_time),
		trailerUrl: youtubeUrl(item.youtube_trailer),
		addedAt: unixToMs(item.last_modified) ?? unixToMs(item.added)
	};
}
/** get_live_streams item → RawChannel. */
function mapLiveStream(item, ctx) {
	const id = str$1(item.stream_id);
	const rawName = str$1(item.name);
	if (!id || !rawName) return void 0;
	const archive = num$1(item.tv_archive);
	const archiveDays = num$1(item.tv_archive_duration);
	const n = posInt(item.num);
	return {
		kind: "live",
		sourceId: ctx.sourceId,
		providerId: id,
		rawName,
		tvgId: str$1(item.epg_channel_id),
		logoUrl: httpUrl(item.stream_icon),
		group: category(item, ctx.cats),
		number: n,
		url: liveUrl(ctx.creds, id),
		catchupDays: archive && archiveDays && archiveDays > 0 ? archiveDays : void 0
	};
}
/** get_series_info → { series metadata patch, episodes }. */
function mapSeriesInfo(data, ctx) {
	const d = data && typeof data === "object" ? data : {};
	const info = d.info && typeof d.info === "object" ? d.info : {};
	const episodes = [];
	const groups = [];
	if (Array.isArray(d.episodes)) for (const g of d.episodes) groups.push([void 0, Array.isArray(g) ? g : [g]]);
	else if (d.episodes && typeof d.episodes === "object") for (const [k, v] of Object.entries(d.episodes)) groups.push([k, v]);
	const seen = /* @__PURE__ */ new Set();
	for (const [seasonKey, eps] of groups) for (const ep of asArray(eps)) {
		const id = str$1(ep.id) ?? str$1(ep.stream_id);
		if (!id || seen.has(id)) continue;
		seen.add(id);
		const epInfo = ep.info && typeof ep.info === "object" && !Array.isArray(ep.info) ? ep.info : {};
		const season = num$1(ep.season) ?? num$1(epInfo.season) ?? num$1(seasonKey) ?? 1;
		const episodeNum = num$1(ep.episode_num) ?? num$1(epInfo.episode_num) ?? episodes.length + 1;
		const ext = cleanExt(ep.container_extension, "mp4");
		episodes.push({
			providerId: id,
			season: Math.max(0, Math.trunc(season)),
			episode: Math.max(0, Math.trunc(episodeNum)),
			title: str$1(ep.title) ?? str$1(epInfo.name),
			plot: str$1(epInfo.plot) ?? str$1(epInfo.overview),
			durationSec: num$1(epInfo.duration_secs) || durationToSec(epInfo.duration, "min"),
			stillUrl: httpUrl(epInfo.movie_image) ?? httpUrl(epInfo.cover_big) ?? httpUrl(epInfo.still_path),
			airDate: str$1(epInfo.releasedate) ?? str$1(epInfo.release_date) ?? str$1(epInfo.air_date),
			url: episodeUrl(ctx.creds, id, ext),
			containerExt: ext
		});
	}
	episodes.sort((a, b) => a.season - b.season || a.episode - b.episode);
	const rd = releaseDate$1(info);
	const patch = {
		plot: str$1(info.plot),
		genres: list(info.genre),
		cast: list(info.cast),
		director: str$1(info.director),
		releaseDate: rd,
		year: year(rd),
		rating: rating(info),
		backdropUrl: firstUrl(info.backdrop_path),
		posterUrl: httpUrl(info.cover),
		trailerUrl: youtubeUrl(info.youtube_trailer),
		tmdbId: posInt(info.tmdb) ?? posInt(info.tmdb_id),
		durationSec: durationToSec(info.episode_run_time)
	};
	for (const k of Object.keys(patch)) if (patch[k] === void 0) delete patch[k];
	return {
		info: patch,
		episodes
	};
}
/** user_info block → XtreamAccount; throws HttpError('auth'|'expired'|'invalid'). */
function parseAccount(data) {
	const d = data && typeof data === "object" ? data : {};
	const u = d.user_info;
	if (!u || typeof u !== "object") throw new HttpError("invalid", "No user_info in Xtream response (is this an Xtream Codes server?)");
	if (num$1(u.auth) === 0) throw new HttpError("auth", "Xtream login rejected (auth: 0)");
	const status = str$1(u.status) ?? "Unknown";
	const expiresAt = unixToMs(u.exp_date);
	if (/^(expired|banned|disabled)$/i.test(status) || expiresAt && expiresAt < Date.now()) throw new HttpError("expired", `Xtream account status: ${status}`);
	const server = d.server_info ?? {};
	return {
		status,
		expiresAt,
		maxConnections: num$1(u.max_connections),
		activeConnections: num$1(u.active_cons),
		isTrial: num$1(u.is_trial) === 1,
		createdAt: unixToMs(u.created_at),
		timezone: str$1(server.timezone),
		allowedFormats: asStrList(u.allowed_output_formats)
	};
}
/** short_epg item → EpgProgramme (base64 titles/descriptions decoded). */
function mapShortEpg(item, channelId) {
	const start = unixToMs(item.start_timestamp) ?? Date.parse(String(item.start ?? "").replace(" ", "T") + "Z");
	const stop = unixToMs(item.stop_timestamp) ?? Date.parse(String(item.end ?? item.stop ?? "").replace(" ", "T") + "Z");
	if (!Number.isFinite(start) || !Number.isFinite(stop)) return void 0;
	return {
		channelId: str$1(item.epg_id) ?? str$1(item.channel_id) ?? channelId,
		start,
		stop,
		title: decodeBase64Utf8(item.title) ?? "—",
		desc: decodeBase64Utf8(item.description)
	};
}
//#endregion
//#region src/lib/providers/redact.ts
var MASK = "***";
/** Query parameter names whose values are treated as secret. */
var SECRET_PARAMS = /* @__PURE__ */ new Set([
	"username",
	"password",
	"user",
	"pass",
	"pwd",
	"passwd",
	"token",
	"auth",
	"key",
	"apikey",
	"api_key",
	"access_token",
	"signature",
	"sig"
]);
/** Path prefixes of Xtream stream urls: /<kind>/<user>/<pass>/<id>.<ext>. */
var XTREAM_PATH = /\/(live|movie|series|timeshift|hls|play)\/([^/?#]+)\/([^/?#]+)\//i;
function escapeRegExp$1(s) {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
/**
* Replace every occurrence of the given secret strings in `text` with `***`.
* Also tries the url-encoded form. Secrets shorter than 3 characters are ignored
* (masking them would garble the whole message without adding protection).
*/
function redactSecrets(text, secrets = []) {
	const list = /* @__PURE__ */ new Set();
	for (const s of secrets) {
		if (!s || s.length < 3) continue;
		list.add(s);
		const enc = encodeURIComponent(s);
		if (enc !== s) list.add(enc);
	}
	if (!list.size) return text;
	const re = new RegExp([...list].sort((a, b) => b.length - a.length).map(escapeRegExp$1).join("|"), "g");
	return text.replace(re, MASK);
}
/**
* Mask credentials in a url: userinfo, secret query parameters and the user/pass
* segments of Xtream-style stream paths. Extra known secrets are masked too.
* Works on anything (returns the input with secrets masked if it is not a url).
*/
function redactUrl(url, secrets = []) {
	if (!url) return url;
	let out = url;
	try {
		const u = new URL(url);
		let changed = false;
		if (u.username || u.password) {
			if (u.username) u.username = MASK;
			if (u.password) u.password = MASK;
			changed = true;
		}
		for (const name of [...u.searchParams.keys()]) if (SECRET_PARAMS.has(name.toLowerCase()) && u.searchParams.get(name)) {
			u.searchParams.set(name, MASK);
			changed = true;
		}
		const m = XTREAM_PATH.exec(u.pathname);
		if (m) {
			u.pathname = u.pathname.replace(XTREAM_PATH, `/${m[1]}/${MASK}/${MASK}/`);
			changed = true;
		}
		if (changed) out = u.toString().replaceAll("%2A", "*");
	} catch {
		out = out.replace(/([?&](?:username|password|user|pass|pwd|token|auth|key)=)[^&#\s]*/gi, `$1${MASK}`);
	}
	return redactSecrets(out, secrets);
}
/** Mask every url inside a free-form message (e.g. an error from fetch). */
function redactText(text, secrets = []) {
	return redactSecrets(text.replace(/\b(?:https?|rtmp|rtsp):\/\/[^\s"'<>]+/gi, (u) => redactUrl(u)), secrets);
}
/** Extract credential-like values from a url (query params, userinfo, Xtream path). */
function secretsFromUrl(url) {
	const out = [];
	try {
		const u = new URL(url);
		if (u.username) out.push(decodeURIComponent(u.username));
		if (u.password) out.push(decodeURIComponent(u.password));
		for (const [k, v] of u.searchParams) if (v && SECRET_PARAMS.has(k.toLowerCase())) out.push(v);
		const m = XTREAM_PATH.exec(u.pathname);
		if (m) out.push(decodeURIComponent(m[2]), decodeURIComponent(m[3]));
	} catch {}
	return [...new Set(out.filter(Boolean))];
}
/** True when the url contains something `redactUrl` would mask. */
function urlHasSecrets(url) {
	return redactUrl(url) !== url;
}
//#endregion
//#region src/lib/sources/mask.ts
function escapeRegExp(s) {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
/**
* Build a masker for the given secrets. The ORDER of `secrets` defines the
* placeholder indices, so callers must pass them in a stable order
* (e.g. [password, username, ...extracted]); encoded variants are added automatically.
*/
function createMasker(secrets) {
	const values = [];
	for (const s of secrets) {
		if (!s) continue;
		values.push(s);
		const enc = encodeURIComponent(s);
		values.push(enc !== s ? enc : "");
	}
	const indexed = values.map((v, i) => [v, i]).filter(([v]) => v.length > 0);
	if (!indexed.length) return {
		mask: (s) => s,
		unmask: (s) => s,
		noop: true
	};
	const lookup = /* @__PURE__ */ new Map();
	for (const [v, i] of indexed) if (!lookup.has(v)) lookup.set(v, i);
	const re = new RegExp([...lookup.keys()].sort((a, b) => b.length - a.length).map(escapeRegExp).join("|"), "g");
	const back = /\uE000(\d+)\uE000/g;
	return {
		noop: false,
		mask: (s) => s ? s.replace(re, (m) => `\uE000${lookup.get(m)}\uE000`) : s,
		unmask: (s) => s && s.includes("") ? s.replace(back, (_, i) => values[Number(i)] ?? "") : s
	};
}
//#endregion
//#region src/lib/search/fold.ts
var SPECIAL_LETTERS = {
	ß: "ss",
	æ: "ae",
	œ: "oe",
	ø: "o",
	ł: "l",
	đ: "d",
	ð: "d",
	ı: "i",
	þ: "th",
	ħ: "h"
};
/** Lowercase, strip diacritics and punctuation, collapse whitespace. "&" becomes "and". */
function fold(s) {
	return s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[ßæœøłđðıþħ]/g, (c) => SPECIAL_LETTERS[c] ?? c).replace(/&/g, " and ").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
/** Folded words of `s`. */
function tokenize(s) {
	const f = fold(s);
	return f ? f.split(" ") : [];
}
/**
* Words for indexing: the folded words plus joined forms for words glued by hyphens or
* apostrophes ("Spider-Man" also yields "spiderman", "Ocean's" also "oceans").
*/
function indexTokens(s) {
	const out = tokenize(s);
	if (/[-'’`´ʼ.]/.test(s)) {
		for (const w of tokenize(s.replace(/[-'’`´ʼ.]/g, ""))) if (!out.includes(w)) out.push(w);
	}
	return out;
}
//#endregion
//#region src/lib/search/index.ts
/** Field a posting comes from. */
var F_TITLE = 0;
var F_ALT = 1;
var F_CAST = 2;
var F_GENRE = 3;
var T_TITLE = 0;
var T_CHANNEL = 1;
var T_PERSON = 2;
var T_GENRE = 3;
/** Score tiers (see module docs). */
var TIER = {
	exact: 60,
	startsWith: 50,
	words: 40,
	altExact: 35,
	altStartsWith: 33,
	alt: 30,
	cast: 20,
	other: 10
};
var Q_EXACT = 1;
var Q_PREFIX = .8;
var Q_FUZZY = .55;
var Q_FUZZY_PREFIX = .45;
var MAX_QUERY_WORDS = 8;
var FUZZY_MIN_LEN = 5;
var DEFAULT_LIMITS = {
	movies: 48,
	series: 48,
	people: 12,
	channels: 24,
	genres: 8
};
function emptyResults(query = "") {
	return {
		query,
		movies: [],
		series: [],
		people: [],
		channels: [],
		genres: [],
		total: 0
	};
}
var SearchIndex = class {
	titles;
	channels;
	#people = [];
	#genres = [];
	#type;
	#ref;
	#main = [];
	#alts = [];
	#altLabels = [];
	#pop;
	#words = [];
	#wordIndex = /* @__PURE__ */ new Map();
	#postings = [];
	#cache = /* @__PURE__ */ new Map();
	#stamp;
	#epoch = 0;
	#masks;
	#any;
	#qual;
	constructor(titles, channels) {
		this.titles = titles;
		this.channels = channels;
		const people = /* @__PURE__ */ new Map();
		const genres = /* @__PURE__ */ new Map();
		titles.forEach((t, i) => {
			for (const p of t.cast) {
				const key = fold(p.name);
				if (!key) continue;
				let person = people.get(key);
				if (!person) people.set(key, person = {
					name: p.name,
					titles: []
				});
				if (!person.profileUrl && p.profileUrl) person.profileUrl = p.profileUrl;
				if (person.titles[person.titles.length - 1] !== i) person.titles.push(i);
			}
			for (const g of t.genres) {
				let info = genres.get(g);
				if (!info) genres.set(g, info = {
					genre: g,
					movies: 0,
					series: 0
				});
				if (t.kind === "movie") info.movies++;
				else info.series++;
			}
		});
		this.#people = [...people.values()];
		for (const p of this.#people) p.titles.sort((a, b) => titles[b].popularity - titles[a].popularity);
		this.#genres = [...genres.values()];
		const n = titles.length + channels.length + this.#people.length + this.#genres.length;
		this.#type = new Uint8Array(n);
		this.#ref = new Int32Array(n);
		this.#pop = new Float32Array(n);
		this.#stamp = new Int32Array(n);
		this.#masks = [
			0,
			1,
			2,
			3
		].map(() => new Uint32Array(n));
		this.#any = new Uint32Array(n);
		this.#qual = new Float32Array(n);
		const dict = /* @__PURE__ */ new Map();
		let doc = 0;
		const add = (text, field) => {
			if (!text) return;
			const code = doc * 4 + field;
			for (const w of indexTokens(text)) {
				let list = dict.get(w);
				if (!list) dict.set(w, list = []);
				if (list[list.length - 1] !== code) list.push(code);
			}
		};
		const begin = (type, ref, main, pop) => {
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
			const seen = /* @__PURE__ */ new Set([this.#main[doc]]);
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
			begin(T_PERSON, i, p.name, Math.min(1, best * .6 + Math.min(p.titles.length, 20) / 50));
			doc++;
		});
		this.#genres.forEach((g, i) => {
			begin(T_GENRE, i, g.genre, Math.min(1, (g.movies + g.series) / 500));
			doc++;
		});
		this.#words = [...dict.keys()].sort();
		this.#postings = this.#words.map((w) => Int32Array.from(dict.get(w)));
		this.#words.forEach((w, i) => this.#wordIndex.set(w, i));
	}
	/** Number of indexed documents (titles, channels, people, genres). */
	get size() {
		return this.#type.length;
	}
	/** All dictionary words matching query word `q`, best first. Cached per word. */
	#match(q) {
		const cached = this.#cache.get(q);
		if (cached) return cached;
		const out = [];
		const taken = /* @__PURE__ */ new Set();
		const exact = this.#wordIndex.get(q);
		if (exact !== void 0) {
			out.push({
				token: exact,
				q: Q_EXACT
			});
			taken.add(exact);
		}
		const words = this.#words;
		let lo = 0;
		let hi = words.length;
		while (lo < hi) {
			const mid = lo + hi >> 1;
			if (words[mid] < q) lo = mid + 1;
			else hi = mid;
		}
		for (let j = lo; j < words.length && words[j].startsWith(q); j++) {
			if (taken.has(j)) continue;
			taken.add(j);
			out.push({
				token: j,
				q: Q_PREFIX - Math.min(.2, (words[j].length - q.length) * .02)
			});
		}
		if (q.length >= FUZZY_MIN_LEN) {
			const L = q.length;
			for (let j = 0; j < words.length; j++) {
				const w = words[j];
				if (w.length < L - 1 || taken.has(j)) continue;
				if (w.length <= L + 1 && oneEdit(q, w, w.length)) {
					out.push({
						token: j,
						q: Q_FUZZY
					});
					taken.add(j);
				} else if (w.length > L && (oneEdit(q, w, L) || oneEdit(q, w, L + 1) || oneEdit(q, w, L - 1))) {
					out.push({
						token: j,
						q: Q_FUZZY_PREFIX
					});
					taken.add(j);
				}
			}
		}
		out.sort((a, b) => b.q - a.q);
		if (this.#cache.size > 400) this.#cache.clear();
		this.#cache.set(q, out);
		return out;
	}
	search(query, limits = {}) {
		const lim = {
			...DEFAULT_LIMITS,
			...limits
		};
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
		let cand = [];
		const matchSets = [];
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
			let tier;
			if (main === qText) tier = TIER.exact;
			else if (main.startsWith(qText)) tier = TIER.startsWith;
			else if (mTitle === full) tier = TIER.words;
			else {
				const alts = this.#alts[doc];
				const mAlt = masks[F_ALT][doc];
				if (alts.includes(qText)) tier = TIER.altExact;
				else if (alts.some((a) => a.startsWith(qText))) tier = TIER.altStartsWith;
				else if (mAlt && (mTitle | mAlt) === full) tier = TIER.alt;
				else if (masks[F_CAST][doc] && (mTitle | mAlt | masks[F_CAST][doc]) === full) tier = TIER.cast;
				else tier = TIER.other;
			}
			const score = tier + 2 * qual[doc] / n + this.#pop[doc];
			res.total++;
			switch (this.#type[doc]) {
				case T_TITLE:
					(this.titles[this.#ref[doc]].kind === "movie" ? movieTop : seriesTop).add(doc, score);
					break;
				case T_CHANNEL:
					channelTop.add(doc, score);
					break;
				case T_PERSON:
					personTop.add(doc, score);
					break;
				default: genreTop.add(doc, score);
			}
		}
		const titleHit = (h) => {
			const hit = {
				title: this.titles[this.#ref[h.doc]],
				score: h.score
			};
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
	#aka(doc, qText, matchSets) {
		const alts = this.#alts[doc];
		if (alts.length === 0) return void 0;
		let best = -1;
		let bestCover = 0;
		for (let i = 0; i < alts.length; i++) {
			if (alts[i] === qText || alts[i].startsWith(qText)) return this.#altLabels[doc][i];
			const words = alts[i].split(" ");
			let cover = 0;
			for (const set of matchSets) if (words.some((w) => set.has(w))) cover++;
			if (cover > bestCover) {
				bestCover = cover;
				best = i;
			}
		}
		return best >= 0 ? this.#altLabels[doc][best] : void 0;
	}
};
/** Keeps the k best-scoring documents (sorted, best first) without sorting everything. */
var TopK = class {
	items = [];
	#k;
	constructor(k) {
		this.#k = Math.max(0, k);
	}
	add(doc, score) {
		const items = this.items;
		if (items.length >= this.#k && (this.#k === 0 || score <= items[items.length - 1].score)) return;
		let i = items.length;
		while (i > 0 && items[i - 1].score < score) i--;
		items.splice(i, 0, {
			doc,
			score
		});
		if (items.length > this.#k) items.pop();
	}
};
/**
* True when `a` is within one edit (insert, delete, substitute, adjacent swap) of the first
* `lb` characters of `b`. No allocations.
*/
function oneEdit(a, b, lb) {
	const la = a.length;
	if (lb > b.length || lb < 0 || Math.abs(la - lb) > 1) return false;
	let i = 0;
	while (i < la && i < lb && a.charCodeAt(i) === b.charCodeAt(i)) i++;
	if (la === lb) {
		if (i === la) return true;
		if (eq(a, i + 1, b, i + 1, la - i - 1)) return true;
		return i + 1 < la && a.charCodeAt(i) === b.charCodeAt(i + 1) && a.charCodeAt(i + 1) === b.charCodeAt(i) && eq(a, i + 2, b, i + 2, la - i - 2);
	}
	if (la < lb) return eq(a, i, b, i + 1, la - i);
	return eq(a, i + 1, b, i, lb - i);
}
function eq(a, ai, b, bi, n) {
	for (let k = 0; k < n; k++) if (a.charCodeAt(ai + k) !== b.charCodeAt(bi + k)) return false;
	return true;
}
//#endregion
//#region src/lib/recommend.ts
var byPopularity = (a, b) => b.popularity - a.popularity;
/** Genre affinity from watch history (recency-weighted) and favorites. */
function genreAffinity(titlesById, favorites, history) {
	const scores = /* @__PURE__ */ new Map();
	const add = (title, weight) => {
		if (!title || title.genres.length === 0) return;
		const w = weight / Math.sqrt(title.genres.length);
		for (const g of title.genres) scores.set(g, (scores.get(g) ?? 0) + w);
	};
	const seen = /* @__PURE__ */ new Set();
	let i = 0;
	for (const h of history) {
		if (seen.has(h.titleId)) continue;
		seen.add(h.titleId);
		add(titlesById.get(h.titleId), Math.pow(.94, i++));
	}
	for (const id of favorites) add(titlesById.get(id), 1.4);
	return scores;
}
/** Titles the profile has started or finished. */
function watchedIds(signals) {
	const ids = /* @__PURE__ */ new Set();
	for (const h of signals.history) ids.add(h.titleId);
	for (const p of Object.values(signals.progress)) ids.add(p.titleId);
	return ids;
}
/**
* Recommended titles: genre affinity from history and favorites, blended with popularity.
* Excludes watched titles and favorites. Falls back to popularity without signals.
*/
function recommend(titles, signals, limit = 24) {
	const byId = new Map(titles.map((t) => [t.id, t]));
	const exclude = watchedIds(signals);
	for (const f of signals.favorites) exclude.add(f);
	const candidates = titles.filter((t) => !exclude.has(t.id));
	const affinity = genreAffinity(byId, signals.favorites, signals.history);
	if (affinity.size === 0) return [...candidates].sort(byPopularity).slice(0, limit);
	const max = Math.max(...affinity.values());
	const scored = [];
	for (const t of candidates) {
		let a = 0;
		for (const g of t.genres) a += affinity.get(g) ?? 0;
		if (a > 0) scored.push({
			t,
			s: a / max + .35 * (t.popularity / 100)
		});
	}
	scored.sort((x, y) => y.s - x.s || byPopularity(x.t, y.t));
	const picked = scored.slice(0, limit).map((x) => x.t);
	if (picked.length < limit) {
		const have = new Set(picked.map((t) => t.id));
		for (const t of [...candidates].sort(byPopularity)) {
			if (picked.length >= limit) break;
			if (!have.has(t.id)) picked.push(t);
		}
	}
	return picked;
}
/** Similar titles: same kind first, then genre overlap (Jaccard), then popularity. */
function similarTitles(title, titles, limit = 18) {
	const genres = new Set(title.genres);
	if (genres.size === 0) return [];
	const scored = [];
	for (const t of titles) {
		if (t.id === title.id) continue;
		let shared = 0;
		for (const g of t.genres) if (genres.has(g)) shared++;
		if (shared === 0) continue;
		const union = genres.size + t.genres.length - shared;
		scored.push({
			t,
			same: t.kind === title.kind ? 1 : 0,
			overlap: shared / union
		});
	}
	scored.sort((a, b) => b.same - a.same || b.overlap - a.overlap || byPopularity(a.t, b.t));
	return scored.slice(0, limit).map((x) => x.t);
}
/** Titles of one kind by popularity. */
function popular(titles, kind, limit = 24) {
	return titles.filter((t) => t.kind === kind).sort(byPopularity).slice(0, limit);
}
/** Trending: popularity boosted for recently added titles (half-life ~30 days). */
function trending(titles, kind, limit = 24, now = Date.now()) {
	const day = 864e5;
	const score = (t) => {
		const age = Math.max(0, (now - t.addedAt) / day);
		return t.popularity * (.6 + .4 * Math.pow(.5, age / 30));
	};
	return titles.filter((t) => t.kind === kind).map((t) => ({
		t,
		s: score(t)
	})).sort((a, b) => b.s - a.s).slice(0, limit).map((x) => x.t);
}
/** Recently added (newest addedAt first). */
function recent(titles, limit = 24) {
	return [...titles].sort((a, b) => b.addedAt - a.addedAt).slice(0, limit);
}
/** Featured titles for the hero: popular, preferably with an overview, mixed kinds. */
function featured(titles, n = 5) {
	const ranked = [...titles].sort((a, b) => Number(!!b.overview) - Number(!!a.overview) || byPopularity(a, b));
	const movies = ranked.filter((t) => t.kind === "movie");
	const series = ranked.filter((t) => t.kind === "series");
	const out = [];
	let m = 0;
	let s = 0;
	while (out.length < n && (m < movies.length || s < series.length)) if (out.length % 3 === 2 && s < series.length) out.push(series[s++]);
	else if (m < movies.length) out.push(movies[m++]);
	else if (s < series.length) out.push(series[s++]);
	return out;
}
/** Genres with their title counts, most common first. */
function genreCounts(titles, kind) {
	const counts = /* @__PURE__ */ new Map();
	for (const t of titles) {
		if (kind && t.kind !== kind) continue;
		for (const g of t.genres) counts.set(g, (counts.get(g) ?? 0) + 1);
	}
	return [...counts].map(([genre, count]) => ({
		genre,
		count
	})).sort((a, b) => b.count - a.count || a.genre.localeCompare(b.genre));
}
/** Audio languages with their title counts ('und' excluded), most common first. */
function languageCounts(titles) {
	const counts = /* @__PURE__ */ new Map();
	for (const t of titles) for (const l of t.languages) if (l !== "und") counts.set(l, (counts.get(l) ?? 0) + 1);
	return [...counts].map(([code, count]) => ({
		code,
		count
	})).sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
}
//#endregion
//#region src/lib/sample/data/films.ts
var FILMS = [
	{
		y: 2023,
		o: "en",
		t: {
			nl: "Het Laatste Licht",
			en: "The Last Light",
			de: "Das Letzte Licht",
			fr: "La Dernière Lumière",
			es: "La Última Luz",
			it: "L'Ultima Luce",
			tr: "Son Işık",
			ar: "الضوء الأخير",
			pl: "Ostatnie Światło",
			pt: "A Última Luz"
		},
		g: ["Sciencefiction", "Drama"],
		d: "Imke Brandsma",
		r: 8.1,
		m: 128,
		c: [
			"Commandant Iris Vos",
			"Daan Kepler",
			"WACHTER"
		],
		a: 2,
		p: "Wanneer de zon van de kolonie Eos onverwacht begint te doven, krijgt commandant Iris Vos twaalf dagen om een uitweg te vinden. Met een haperende scheeps-AI en een bemanning die steeds meer twijfelt, moet ze kiezen tussen haar missie en de mensen die ze liefheeft.",
		v: "nl:A4C en:A4BF de:BF fr:B es:C it:B tr:C ar:C pl:C pt:C",
		x: [
			[
				"C",
				"The Last Light (2023) VOSTFR",
				"en"
			],
			["B", "[EN] The Last Light (2023) NL Subs"],
			["C", "NL/EN - Het Laatste Licht (2023) MULTI"],
			["C", "FR: La Derniere Lumiere (2023) HD"]
		]
	},
	{
		y: 2021,
		o: "nl",
		t: {
			nl: "Zoutwater",
			en: "Saltwater",
			de: "Salzwasser"
		},
		g: ["Drama", "Thriller"],
		d: "Joris Ammerlaan",
		r: 7.4,
		m: 112,
		c: [
			"Femke Dijkhuis",
			"Ruben Dijkhuis",
			"inspecteur Mol"
		],
		a: 5,
		p: "Als de kotter van haar broer Ruben spoorloos verdwijnt voor de Zeeuwse kust, keert Femke na tien jaar terug naar het dorp dat ze ontvluchtte. Terwijl een storm het eiland afsluit, ontdekt ze dat het zwijgen van de dorpelingen dieper gaat dan schaamte.",
		v: "nl:AF en:B de:B"
	},
	{
		y: 1998,
		o: "nl",
		t: {
			nl: "Nachtwacht",
			en: "Night Watch"
		},
		g: ["Thriller", "Misdaad"],
		d: "Hendrik Vermeulen",
		r: 7,
		m: 104,
		c: [
			"Bram Kools",
			"Sanne Ritsema",
			"Victor Lenz"
		],
		a: 40,
		p: "Nachtwaker Bram Kools ziet op een regenachtige nacht in het stadsarchief een inbraak die volgens de politie nooit heeft plaatsgevonden. Samen met journaliste Sanne Ritsema volgt hij een spoor van verdwenen dossiers tot in het stadhuis.",
		v: "nl:AC en:B",
		noId: true
	},
	{
		y: 2021,
		o: "nl",
		t: {
			nl: "Nachtwacht",
			en: "Night Watch",
			de: "Nachtwache",
			fr: "Veille de Nuit"
		},
		g: ["Drama", "Mysterie"],
		d: "Lotte Zandbergen",
		r: 7.8,
		m: 118,
		c: [
			"Eva Brink",
			"Ward Hoogland",
			"Mira"
		],
		a: 12,
		p: "Op een afgelegen vuurtoren in de Waddenzee neemt Eva Brink de nachtdienst over van haar overleden vader. Elke nacht vangt de marifoon berichten op van een schip dat al veertig jaar vermist is.",
		v: "nl:AC en:AB de:C fr:B"
	},
	{
		y: 2014,
		o: "nl",
		t: {
			nl: "Stormvogel",
			en: "Stormbird",
			de: "Sturmvogel"
		},
		g: ["Avontuur", "Familie"],
		d: "Mees van Dalen",
		r: 6.9,
		m: 97,
		c: [
			"Jip Wolters",
			"opa Kees",
			"Storm"
		],
		a: 55,
		p: "De elfjarige Jip vindt na een zware storm op Terschelling een gewonde jan-van-gent die ze Storm noemt. Wanneer een projectontwikkelaar het vogelduin wil volbouwen, bedenkt ze samen met haar eigenzinnige opa een plan dat het hele eiland op zijn kop zet.",
		v: "nl:A en:B de:B"
	},
	{
		y: 2017,
		o: "nl",
		t: {
			nl: "Stormvogel 2",
			en: "Stormbird II",
			de: "Sturmvogel 2"
		},
		g: ["Avontuur", "Familie"],
		d: "Mees van Dalen",
		r: 6.6,
		m: 94,
		c: [
			"Jip Wolters",
			"opa Kees",
			"Storm",
			"Ilse Bakker"
		],
		a: 50,
		p: "Jip is dertien en Storm is terug, maar dit keer met een hele zwerm vogels die het eiland niet meer kunnen vinden. Een mysterieuze zendmast op de Noordzee lijkt hun kompas te verstoren.",
		v: "nl:A en:B de:C",
		x: [["C", "|NL| Stormvogel II 2017"]],
		noId: true
	},
	{
		y: 2016,
		o: "nl",
		t: {
			nl: "De Grens",
			en: "The Border",
			tr: "Sınır"
		},
		g: ["Thriller", "Drama"],
		d: "Ayla Demir",
		r: 7.3,
		m: 109,
		c: [
			"Kemal Arslan",
			"Noor Visser",
			"Hans de Wit"
		],
		a: 33,
		p: "Douanier Kemal Arslan houdt bij de Belgische grens een vrachtwagen aan en vindt een meisje dat geen woord zegt. In één nacht moet hij kiezen tussen de regels die hij twintig jaar heeft gevolgd en het enige juiste dat hij nog kan doen.",
		v: "nl:AC en:B tr:C"
	},
	{
		y: 2020,
		o: "nl",
		t: {
			nl: "Het Zoutpad",
			en: "The Salt Road",
			fr: "La Route du Sel"
		},
		g: ["Avontuur", "Drama"],
		d: "Pieter Holleman",
		r: 7.1,
		m: 121,
		c: [
			"Joost Mertens",
			"Amira Haddad",
			"Yusuf"
		],
		a: 20,
		p: "Een Nederlandse fotograaf en een Marokkaanse gids volgen een eeuwenoude zoutroute dwars door de Sahara. Wat begint als een opdracht voor een reisblad, wordt een tocht die hen allebei dwingt hun verleden onder ogen te zien.",
		v: "nl:A en:B fr:B",
		x: [["C", "NL - Het Zoutpad"]]
	},
	{
		y: 2019,
		o: "en",
		t: {
			nl: "Missie Ares: Rode Planeet",
			en: "Mission Ares: Red Planet",
			de: "Mission Ares: Roter Planet",
			es: "Misión Ares: Planeta Rojo"
		},
		g: ["Sciencefiction", "Actie"],
		d: "Carter Lindqvist",
		r: 7.2,
		m: 131,
		c: [
			"kapitein Lena Okafor",
			"Tomasz Wierzbicki",
			"ORCA"
		],
		a: 26,
		p: "Wanneer de eerste bemande Marsbasis het contact verliest, wordt een reddingsteam onder leiding van kapitein Lena Okafor in allerijl gelanceerd. Op de rode planeet blijkt de stilte geen technisch mankement, maar een bewuste keuze.",
		v: "nl:A en:A4 de:B es:C",
		x: [["B", "|EN| Mission Ares 2019 FHD"]]
	},
	{
		y: 2018,
		o: "nl",
		t: {
			nl: "Lars & Lotte",
			en: "Lars & Lotte",
			de: "Lars und Lotte"
		},
		g: ["Komedie", "Romantiek"],
		d: "Sophie Kranenburg",
		r: 6.8,
		m: 99,
		c: [
			"Lars Brouwer",
			"Lotte de Haan",
			"tante Joke"
		],
		a: 44,
		p: "Lars is weddingplanner en gelooft niet in de liefde; Lotte is scheidingsadvocaat en gelooft er juist heilig in. Als ze per ongeluk dezelfde villa in Toscane boeken, staat er een zomer vol misverstanden op het menu.",
		v: "nl:A en:B de:B",
		x: [["C", "NL: Lars en Lotte (2018) HD"]]
	},
	{
		y: 2015,
		o: "en",
		t: {
			nl: "De Glazen Tuin",
			en: "The Glass Garden",
			fr: "Le Jardin de Verre",
			it: "Il Giardino di Vetro"
		},
		g: ["Drama", "Romantiek"],
		d: "Eleanor Whitcombe",
		r: 7.6,
		m: 115,
		c: [
			"Edith Marlow",
			"Thomas Avery",
			"Lily"
		],
		a: 58,
		p: "Een weduwe in het Engeland van 1952 erft een vervallen kas vol zeldzame orchideeën. De jonge botanicus die haar komt helpen, brengt niet alleen de planten weer tot leven.",
		v: "nl:A en:AB fr:B it:BC",
		x: [["B", "EN - Glass Garden (2015)"]]
	},
	{
		y: 2022,
		o: "en",
		t: {
			nl: "Koraalkoorts",
			en: "Coral Fever",
			es: "Fiebre de Coral",
			pt: "Febre de Coral"
		},
		g: ["Avontuur", "Thriller"],
		d: "Mara Quintero",
		r: 6.7,
		m: 103,
		c: [
			"Nadia Cole",
			"Jonah Reyes",
			"kapitein Duarte"
		],
		a: 9,
		p: "Twee duikinstructeurs ontdekken bij een afgelegen rif in de Caraïben een wrak vol gesmokkelde kunstschatten. Al snel blijken ze niet de enigen die weten wat er op de bodem ligt.",
		v: "nl:A es:C pt:C",
		x: [["B", "|EN| Coral Fever 2023"]]
	},
	{
		y: 2019,
		o: "fr",
		t: {
			fr: "Les Oiseaux de Papier",
			en: "Paper Birds",
			nl: "Papieren Vogels",
			de: "Papiervögel"
		},
		g: ["Drama", "Familie"],
		d: "Camille Aubertin",
		r: 7.5,
		m: 106,
		c: [
			"Henri Delmas",
			"Zoé Delmas",
			"madame Ferrand"
		],
		a: 17,
		p: "Een weduwnaar in Lyon die origamiles geeft, krijgt onverwacht de zorg over zijn kleindochter Zoé. Vouw voor vouw leren ze elkaar kennen, terwijl een oud familiegeheim zich langzaam ontvouwt.",
		v: "fr:BC nl:A en:B de:C"
	},
	{
		y: 2017,
		o: "de",
		t: {
			de: "Das Uhrwerk",
			en: "The Clockwork",
			nl: "Het Uurwerk",
			pl: "Mechanizm Zegara"
		},
		g: ["Thriller", "Mysterie"],
		d: "Friedrich Albers",
		r: 7.3,
		m: 117,
		c: [
			"Konrad Weiß",
			"Hanna Stein",
			"commissaris Brandt"
		],
		a: 31,
		p: "Een Berlijnse klokkenmaker ontvangt een eeuwenoud uurwerk dat precies twaalf uur voor een reeks inbraken stilvalt. Rechercheur Hanna Stein vermoedt dat de klokkenmaker meer weet dan hij zegt.",
		v: "de:B nl:A en:B pl:C"
	},
	{
		y: 2020,
		o: "es",
		t: {
			es: "El Jardín de las Lunas",
			en: "The Garden of Moons",
			nl: "De Tuin van de Manen",
			pt: "O Jardim das Luas"
		},
		g: ["Fantasy", "Drama"],
		d: "Lucía Ferrer",
		r: 7.9,
		m: 124,
		c: [
			"Inés Navarro",
			"abuela Rosario",
			"Mateo"
		],
		a: 14,
		p: "In de tuin van haar grootmoeder in Andalusië bloeien bloemen die alleen bij volle maan opengaan. Wanneer Inés ontdekt dat elke bloem een herinnering bewaart, moet ze kiezen welke ze wil vergeten.",
		v: "es:C en:B nl:A pt:C"
	},
	{
		y: 2016,
		o: "it",
		t: {
			it: "La Strada del Ritorno",
			en: "The Road Back",
			nl: "De Weg Terug",
			de: "Der Weg Zurück"
		},
		g: ["Drama", "Komedie"],
		d: "Marco Bellandi",
		r: 7,
		m: 101,
		c: [
			"Giorgio Ruffo",
			"Luca Ruffo",
			"nonna Pia"
		],
		a: 47,
		p: "Een vader en zijn volwassen zoon, die al jaren niet meer praten, moeten samen een oude Fiat van Turijn naar Apulië rijden. Onderweg sputtert de motor, en hun zwijgen ook.",
		v: "it:BC nl:A en:B de:B"
	},
	{
		y: 2021,
		o: "tr",
		t: {
			tr: "Yankılar Şehri",
			en: "City of Echoes",
			nl: "Stad van Echo's",
			ar: "مدينة الأصداء"
		},
		g: ["Avontuur", "Mysterie"],
		d: "Elif Kaya",
		r: 7.2,
		m: 119,
		c: [
			"Deniz Aydın",
			"professor Selim",
			"Leyla"
		],
		a: 22,
		p: "Een jonge archeologe vindt in Cappadocië een ondergrondse stad waar elk woord drie keer terugkomt, maar steeds een beetje anders. De echo’s lijken haar de weg te wijzen naar iets wat beter verborgen had kunnen blijven.",
		v: "tr:C ar:C en:B nl:A"
	},
	{
		y: 2018,
		o: "ar",
		t: {
			ar: "ظل النخيل",
			en: "Shadow of the Palms",
			nl: "Schaduw van de Palmen",
			fr: "L'Ombre des Palmiers"
		},
		g: ["Drama", "Romantiek"],
		d: "Karim Mansour",
		r: 7.4,
		m: 112,
		c: [
			"Salma",
			"Youssef",
			"hadj Ibrahim"
		],
		a: 36,
		p: "In een oase aan de rand van de woestijn wordt Salma uitgehuwelijkt aan de zoon van de rijkste dadelkweker. Op de avond voor de bruiloft keert Youssef, haar jeugdliefde, terug uit Marseille.",
		v: "ar:C fr:B en:B nl:A"
	},
	{
		y: 2022,
		o: "pl",
		t: {
			pl: "Zimowy Pociąg",
			en: "The Winter Train",
			nl: "De Wintertrein",
			de: "Der Winterzug"
		},
		g: ["Drama", "Geschiedenis"],
		d: "Agnieszka Wróbel",
		r: 7.7,
		m: 126,
		c: [
			"Marek Nowicki",
			"Ewa Nowicka",
			"korporaal Zieliński"
		],
		a: 19,
		p: "Polen, december 1981: een trein vol reizigers strandt in de sneeuw wanneer de grenzen plotseling sluiten. In drie dagen worden vreemden bondgenoten, en bondgenoten verraders.",
		v: "pl:C en:B nl:A de:B"
	},
	{
		y: 2019,
		o: "pt",
		t: {
			pt: "Maré Alta",
			en: "High Tide",
			nl: "Hoog Water",
			es: "Marea Alta"
		},
		g: ["Thriller", "Drama"],
		d: "João Carvalho",
		r: 6.9,
		m: 102,
		c: [
			"Rita Sousa",
			"Tiago Mendes",
			"senhor Abreu"
		],
		a: 28,
		p: "Een big-wave-surfster in Nazaré ziet tijdens de grootste swell van het jaar iets wat ze niet had mogen zien. Op het land blijkt de stroming nog verraderlijker dan op zee.",
		v: "pt:C es:C en:B nl:A"
	},
	{
		y: 2024,
		o: "en",
		t: {
			nl: "Neon Saints",
			en: "Neon Saints",
			de: "Neon Saints",
			es: "Santos de Neón",
			it: "Santi al Neon",
			tr: "Neon Azizler"
		},
		g: ["Actie", "Misdaad"],
		d: "Darius Kell",
		r: 7,
		m: 116,
		c: [
			"Vic Moreno",
			"rechercheur Ana Ruiz",
			"de Bisschop"
		],
		a: 4,
		p: "In een stad die nooit slaapt, steelt een groep ex-agenten uitsluitend van criminelen. Wanneer hun nieuwste doelwit een kerk blijkt die drugsgeld witwast, komen ze oog in oog te staan met hun eigen verleden.",
		v: "nl:A en:A4BF de:B es:C it:C tr:C"
	},
	{
		y: 2025,
		o: "en",
		t: {
			nl: "Baan van Stilte",
			en: "Orbit of Silence",
			de: "Umlaufbahn der Stille",
			fr: "L'Orbite du Silence",
			pl: "Orbita Ciszy"
		},
		g: ["Sciencefiction", "Thriller"],
		d: "Hiro Tanabe",
		r: 7.8,
		m: 134,
		c: [
			"astronaut Mae Lindgren",
			"dr. Okon",
			"CALLA"
		],
		a: 1,
		p: "Na een zonnestorm zit astronaut Mae Lindgren alleen in een ruimtestation zonder contact met de aarde. Dan begint de boordcomputer te antwoorden op vragen die ze nog niet heeft gesteld.",
		v: "nl:A4 en:A4B de:B fr:B pl:C"
	},
	{
		y: 2023,
		o: "nl",
		t: {
			nl: "De Bakkerij van Bas",
			en: "Bas's Bakery",
			de: "Die Bäckerei von Bas"
		},
		g: ["Komedie", "Familie"],
		d: "Ilse Groen",
		r: 6.5,
		m: 95,
		c: [
			"Bas Verbeek",
			"Ans",
			"burgemeester Van Dijk"
		],
		a: 11,
		p: "Bas erft de noodlijdende bakkerij van zijn tante in een Gelders dorp, maar kan zelf nog geen ei bakken. Met hulp van de strenge Ans en een geheim receptenboek wil hij de dorpsbakwedstrijd winnen.",
		v: "nl:AC en:B de:B"
	},
	{
		y: 2012,
		o: "en",
		t: {
			nl: "Het Holle Koor",
			en: "The Hollow Choir",
			de: "Der Hohle Chor",
			es: "El Coro Hueco",
			tr: "Boş Koro"
		},
		g: ["Horror", "Mysterie"],
		d: "Graham Pell",
		r: 6.4,
		m: 97,
		c: [
			"pastoor Dunmore",
			"Claire Ashby",
			"Tobias"
		],
		a: 39,
		p: "In een verlaten kerk in Yorkshire zingt elke nacht om drie uur een koor dat niemand kan zien. Muziekdocente Claire Ashby neemt het geluid op, en hoort op de band een stem die haar naam noemt.",
		v: "en:AB nl:A de:B es:C tr:C"
	},
	{
		y: 2008,
		o: "en",
		t: {
			nl: "Pip en de Papieren Maan",
			en: "Pip and the Paper Moon",
			de: "Pip und der Papiermond",
			fr: "Pip et la Lune de Papier",
			es: "Pip y la Luna de Papel",
			it: "Pip e la Luna di Carta",
			pt: "Pip e a Lua de Papel",
			pl: "Pip i Papierowy Księżyc",
			tr: "Pip ve Kağıt Ay",
			ar: "بيب والقمر الورقي"
		},
		g: [
			"Animatie",
			"Familie",
			"Avontuur"
		],
		d: "Rosalind Fay",
		r: 7.9,
		m: 88,
		c: [
			"Pip",
			"meneer Uil",
			"de Maanwachter"
		],
		a: 6,
		p: "Als de maan op een nacht van papier blijkt te zijn en scheurt, gaat het muisje Pip met een vlieger op weg om hem te repareren. Samen met de mopperende meneer Uil reist ze langs sterren, wolken en een heel slaperige komeet.",
		v: "nl:A en:AB de:B fr:B es:C it:C pt:C pl:C tr:C ar:C"
	},
	{
		y: 1987,
		o: "nl",
		t: {
			nl: "Het Verdronken Dorp",
			en: "The Drowned Village"
		},
		g: ["Drama", "Geschiedenis"],
		d: "Cor Hoekstra",
		r: 7.5,
		m: 128,
		c: [
			"Geertje Kloet",
			"dominee Ramaker",
			"Jan Kloet"
		],
		a: 59,
		p: "Februari 1953: in een Zeeuws dorp breekt in de nacht de dijk door. Het aangrijpende verhaal van een familie die in één nacht alles verliest en weer moet leren leven met het water.",
		v: "nl:A en:B"
	},
	{
		y: 1994,
		o: "en",
		t: {
			nl: "Crimson Harbor",
			en: "Crimson Harbor",
			de: "Hafen in Rot",
			it: "Porto Cremisi"
		},
		g: ["Actie", "Thriller"],
		d: "Walt Brennan",
		r: 6.8,
		m: 110,
		c: [
			"Jack Hollis",
			"Marla Quinn",
			"senator Voss"
		],
		a: 37,
		p: "Een havenrechercheur in Baltimore ontdekt dat de containers die hij moet bewaken iets vervoeren wat officieel niet bestaat. Zijn enige bondgenoot is een journaliste die al eens is ontslagen omdat ze te veel wist.",
		v: "nl:A en:AB de:B it:C"
	},
	{
		y: 2014,
		o: "fr",
		t: {
			fr: "Le Grand Déménagement",
			en: "The Big Move",
			nl: "De Grote Verhuizing",
			de: "Der Große Umzug"
		},
		g: ["Komedie"],
		d: "Bastien Rocher",
		r: 6.6,
		m: 93,
		c: [
			"Gilles Martin",
			"Sophie Martin",
			"buurman Paulo"
		],
		a: 52,
		p: "Een gezin uit Parijs verhuist naar een dorp in de Provence, met een verhuiswagen die onderweg verdwijnt. Wat volgt is een week vol geleende meubels, nieuwsgierige buren en een geit die niet meer weggaat.",
		v: "fr:BC nl:A en:B de:C"
	},
	{
		y: 2021,
		o: "ko",
		t: {
			ko: "유리 도시",
			en: "Glass City",
			nl: "Glazen Stad",
			fr: "La Cité de Verre"
		},
		g: ["Thriller", "Misdaad"],
		d: "Seo Min-jae",
		r: 7.9,
		m: 125,
		c: [
			"rechercheur Han",
			"Yuna",
			"directeur Baek"
		],
		a: 15,
		p: "In een futuristische wijk van Seoul, waar alle muren van glas zijn, wordt een moord gepleegd die niemand heeft gezien. Rechercheur Han ontdekt dat transparantie de perfecte schuilplaats is.",
		v: "ko:B en:B nl:A fr:C"
	},
	{
		y: 2016,
		o: "en",
		t: {
			nl: "Rijk van IJs",
			en: "Kingdom of Ice",
			de: "Königreich aus Eis",
			fr: "Royaume de Glace",
			pt: "Reino de Gelo"
		},
		g: ["Documentaire"],
		d: "Nora Fieldstone",
		r: 8.3,
		m: 92,
		c: ["Verteller"],
		a: 45,
		p: "Een jaar lang volgt een cameraploeg het leven op en onder het pakijs van Antarctica. Van keizerspinguïns tot luipaardrobben: een adembenemend portret van een wereld die snel verandert.",
		v: "nl:A en:AB de:B fr:B pt:C"
	},
	{
		y: 2023,
		o: "en",
		t: {
			nl: "De Laatste Imkers",
			en: "The Last Beekeepers",
			es: "Los Últimos Apicultores",
			it: "Gli Ultimi Apicoltori"
		},
		g: ["Documentaire"],
		d: "Hannah Riis",
		r: 7.9,
		m: 84,
		c: ["Verteller"],
		a: 23,
		p: "Drie imkers op drie continenten vechten voor het voortbestaan van hun bijenvolken. Een hoopvolle en urgente documentaire over het kleinste werkpaard van onze voedselvoorziening.",
		v: "nl:A en:B es:C it:C"
	},
	{
		y: 2010,
		o: "nl",
		t: {
			nl: "Zomer in Zeeland",
			en: "Summer in Zeeland",
			de: "Sommer in Zeeland"
		},
		g: ["Romantiek", "Komedie"],
		d: "Marieke Oosting",
		r: 6.3,
		m: 98,
		c: [
			"Lisa van Toor",
			"Sem Kramer",
			"oma Door"
		],
		a: 57,
		p: "Een Amsterdamse marketeer moet een zomer lang de camping van haar oma runnen. Tussen de caravans, de mosselfeesten en de koppige strandwacht Sem raakt haar zorgvuldig geplande leven heerlijk in de war.",
		v: "nl:A en:B de:B"
	},
	{
		y: 2018,
		o: "en",
		t: {
			nl: "De Gloeiende Kroon",
			en: "The Ember Crown",
			de: "Die Glutkrone",
			fr: "La Couronne de Braise",
			es: "La Corona de Brasas",
			pl: "Żarząca Korona",
			tr: "Kor Taç"
		},
		g: ["Fantasy", "Avontuur"],
		d: "Aldous Wren",
		r: 7.4,
		m: 141,
		c: [
			"prinses Aveline",
			"Corvin de smid",
			"koningin Morwen"
		],
		a: 27,
		p: "Een prinses die de troon niet wil en een smid die haar wil ontvoeren, moeten samen een kroon terugvinden die het land in vuur zet. Een epische fantasy over macht, lot en de vrijheid om nee te zeggen.",
		v: "nl:A en:A4B de:B fr:C es:C pl:C tr:C"
	},
	{
		y: 2011,
		o: "en",
		t: {
			nl: "Het Negende District",
			en: "The Ninth Precinct",
			de: "Das Neunte Revier",
			it: "Il Nono Distretto"
		},
		g: ["Misdaad", "Drama"],
		d: "Ray Calloway",
		r: 7.1,
		m: 118,
		c: [
			"rechercheur Frank Mulroney",
			"Rosa Delgado",
			"kapitein Haines"
		],
		a: 49,
		p: "Een uitgebluste rechercheur krijgt één week om een reeks overvallen op te lossen voordat zijn bureau wordt gesloten. Zijn nieuwe partner heeft haar eigen redenen om de zaak niet te sluiten.",
		v: "en:AB nl:A de:B it:C"
	},
	{
		y: 2024,
		o: "nl",
		t: {
			nl: "Het Zevende Uur",
			en: "The Seventh Hour",
			de: "Die Siebte Stunde",
			fr: "La Septième Heure",
			tr: "Yedinci Saat"
		},
		g: ["Thriller", "Misdaad"],
		d: "Daan Roozendaal",
		r: 7.6,
		m: 108,
		c: [
			"officier Lieke Brandt",
			"Tarik El Amrani",
			"de notaris"
		],
		a: 3,
		p: "Om zeven uur ’s ochtends wordt een notaris dood aangetroffen in zijn Utrechtse kantoor, met zeven testamenten op zijn bureau. Officier van justitie Lieke Brandt heeft zeven uur voordat de erfgenamen het land uit zijn.",
		v: "nl:A4C en:B de:B fr:C tr:C"
	},
	{
		y: 2015,
		o: "es",
		t: {
			es: "Mi Tío el Astronauta",
			en: "My Uncle the Astronaut",
			nl: "Mijn Oom de Astronaut",
			pt: "Meu Tio, o Astronauta",
			it: "Mio Zio Astronauta"
		},
		g: ["Komedie", "Familie"],
		d: "Pablo Ortega",
		r: 6.9,
		m: 96,
		c: [
			"tío Ramón",
			"Nico",
			"doña Carmen"
		],
		a: 41,
		p: "De tienjarige Nico vertelt op school dat zijn oom astronaut is. Dat klopt niet helemaal: oom Ramón is conciërge bij het ruimtevaartcentrum. Maar dan staat er een schoolbezoek op het programma.",
		v: "es:C en:B nl:A pt:C it:B"
	},
	{
		y: 2020,
		o: "en",
		t: {
			nl: "Velden van As",
			en: "Fields of Ash",
			de: "Felder aus Asche",
			fr: "Champs de Cendres",
			pl: "Pola Popiołu"
		},
		g: [
			"Oorlog",
			"Drama",
			"Geschiedenis"
		],
		d: "Simon Hartwell",
		r: 7.7,
		m: 137,
		c: [
			"sergeant Arthur Penn",
			"soldaat Eli Rook",
			"Marthe"
		],
		a: 30,
		p: "Vlaanderen, 1917: twee Britse soldaten raken achter de linies verdwaald en vinden onderdak bij een Belgische boerin. Een ingetogen oorlogsdrama over de kleine menselijkheid te midden van de grote verwoesting.",
		v: "nl:A en:AB de:B fr:B pl:C"
	},
	{
		y: 2019,
		o: "tr",
		t: {
			tr: "Çay Bahçesi",
			en: "The Tea Garden",
			nl: "De Theetuin",
			de: "Der Teegarten",
			ar: "حديقة الشاي"
		},
		g: ["Komedie", "Drama"],
		d: "Murat Öztürk",
		r: 7.3,
		m: 104,
		c: [
			"oom Hasan",
			"Zeynep",
			"Emre"
		],
		a: 25,
		p: "Oom Hasan runt al veertig jaar een theetuin aan de Bosporus en weigert elk bod van projectontwikkelaars. Wanneer zijn nicht Zeynep uit Duitsland komt om hem op andere gedachten te brengen, wordt ze zelf verleid door de stad.",
		v: "tr:C ar:C en:B nl:A de:B"
	},
	{
		y: 2022,
		o: "ar",
		t: {
			ar: "الرمال المتحركة",
			en: "Shifting Sands",
			nl: "Verschuivend Zand",
			fr: "Sables Mouvants",
			tr: "Kayan Kumlar"
		},
		g: ["Thriller", "Avontuur"],
		d: "Nadia El-Sayed",
		r: 7,
		m: 113,
		c: [
			"Omar",
			"Rania",
			"de kolonel"
		],
		a: 18,
		p: "Een woestijngids en een geologe raken tijdens een zandstorm het spoor kwijt van hun expeditie. Wanneer het zand gaat liggen, staan ze voor een verlaten onderzoeksbasis die op geen enkele kaart voorkomt.",
		v: "ar:C fr:B en:B nl:A tr:C"
	},
	{
		y: 2018,
		o: "pl",
		t: {
			pl: "Dom na Wrzosowym Wzgórzu",
			en: "The House on Heather Hill",
			nl: "Het Huis op de Heideheuvel",
			de: "Das Haus auf dem Heidehügel"
		},
		g: ["Horror"],
		d: "Paweł Krajewski",
		r: 6.6,
		m: 99,
		c: [
			"Ola Malinowska",
			"oom Stefan",
			"het kind in het raam"
		],
		a: 34,
		p: "Ola erft het huis van een oom die ze nooit heeft gekend, hoog op een heuvel in de Poolse bergen. In het dorp wil niemand haar de weg wijzen, en in het huis brandt al licht als ze aankomt.",
		v: "pl:C en:B nl:A de:B"
	},
	{
		y: 2021,
		o: "pt",
		t: {
			pt: "Cartas de Lisboa",
			en: "Letters from Lisbon",
			nl: "Brieven uit Lissabon",
			es: "Cartas desde Lisboa",
			fr: "Lettres de Lisbonne"
		},
		g: ["Romantiek", "Drama"],
		d: "Beatriz Lobo",
		r: 7.2,
		m: 110,
		c: [
			"Inês",
			"Daniel",
			"dona Amália"
		],
		a: 16,
		p: "Een Nederlandse vertaler vindt in een antiquariaat in Lissabon een stapel nooit verstuurde liefdesbrieven. Op zoek naar de geadresseerde ontmoet hij Inês, die meer met de brieven te maken heeft dan ze laat merken.",
		v: "pt:C nl:A en:B es:C fr:B"
	},
	{
		y: 2023,
		o: "it",
		t: {
			it: "Il Silenzio di Napoli",
			en: "The Silence of Naples",
			nl: "De Stilte van Napels",
			de: "Die Stille von Neapel",
			tr: "Napoli Sessizliği"
		},
		g: ["Misdaad", "Thriller"],
		d: "Fabrizio Conti",
		r: 7.5,
		m: 122,
		c: [
			"commissaris Rocco Esposito",
			"Giulia Mancini",
			"don Arturo"
		],
		a: 8,
		p: "In een Napolitaanse wijk waar iedereen alles weet, zegt niemand iets over de verdwijning van een jonge advocate. Commissaris Esposito moet een stilte doorbreken die al drie generaties duurt.",
		v: "it:BC nl:A en:B de:B tr:C"
	},
	{
		y: 1999,
		o: "en",
		t: {
			nl: "Signaal van Vega",
			en: "Signal from Vega",
			de: "Signal von Wega",
			fr: "Signal de Véga",
			es: "Señal desde Vega"
		},
		g: ["Sciencefiction", "Mysterie"],
		d: "Lionel Marsh",
		r: 7.3,
		m: 112,
		c: [
			"dr. Ellen Hart",
			"Sam Okoro",
			"de Stem"
		],
		a: 53,
		p: "Een radioastronome vangt een signaal op dat precies klinkt als de stem van haar overleden vader. Terwijl de wereldpers zich op haar stort, probeert ze te ontcijferen wat de boodschap werkelijk betekent.",
		v: "nl:A en:ABF de:B fr:C es:C"
	},
	{
		y: 2025,
		o: "nl",
		t: {
			nl: "De Wonderlijke Reis van Kiki",
			en: "The Wondrous Voyage of Kiki",
			de: "Kikis Wundersame Reise",
			fr: "Le Merveilleux Voyage de Kiki"
		},
		g: [
			"Animatie",
			"Familie",
			"Avontuur"
		],
		d: "Femke Lammers",
		r: 7.1,
		m: 86,
		c: [
			"Kiki",
			"kapitein Snor",
			"Wim de walvis"
		],
		a: 2,
		p: "Het eigenwijze zeehondje Kiki raakt haar familie kwijt en zwemt dwars over de Noordzee om ze terug te vinden. Onderweg sluit ze vriendschap met een brombeer van een walvis en een kapitein met een heel grote snor.",
		v: "nl:A4C en:B de:B fr:B"
	},
	{
		y: 2026,
		o: "en",
		t: {
			nl: "Velocity Zero",
			en: "Velocity Zero",
			de: "Velocity Zero",
			es: "Velocidad Cero",
			it: "Velocità Zero",
			pt: "Velocidade Zero",
			ar: "السرعة صفر"
		},
		g: ["Actie", "Sciencefiction"],
		d: "Reese Tolland",
		r: 6.9,
		m: 119,
		c: [
			"Kai Mercer",
			"dr. Sela Grant",
			"Vortex"
		],
		a: 0,
		p: "Een testpiloot overleeft als enige een experimentele vlucht op tien keer de geluidssnelheid, en komt terug met een vertraging van drie seconden ten opzichte van de rest van de wereld. Die drie seconden blijken goud waard.",
		v: "nl:A en:A4B4 de:B es:C it:C pt:C ar:C"
	},
	{
		y: 2001,
		o: "fr",
		t: {
			fr: "Les Enfants du Phare",
			en: "Children of the Lighthouse",
			nl: "De Kinderen van de Vuurtoren"
		},
		g: ["Drama", "Familie"],
		d: "Hélène Marchais",
		r: 7.6,
		m: 108,
		c: [
			"Yann",
			"Maëlle",
			"vuurtorenwachter Corentin"
		],
		a: 48,
		p: "Twee kinderen brengen na de scheiding van hun ouders een zomer door bij hun zwijgzame grootvader, de laatste vuurtorenwachter van Bretagne. Als de vuurtoren wordt geautomatiseerd, besluiten ze dat te voorkomen.",
		v: "fr:B nl:A en:B"
	},
	{
		y: 1989,
		o: "en",
		t: {
			nl: "De Toevallige Detective",
			en: "The Accidental Detective",
			de: "Der Zufallsdetektiv",
			es: "El Detective Accidental"
		},
		g: ["Komedie", "Misdaad"],
		d: "Marty Gold",
		r: 6.7,
		m: 101,
		c: [
			"Harvey Pinch",
			"Lola Vance",
			"inspecteur Graves"
		],
		a: 56,
		p: "Een verstrooide boekhouder wordt door een misverstand aangezien voor de beroemdste privédetective van Chicago. Om zijn huid te redden, moet hij een zaak oplossen waar hij niets van begrijpt.",
		v: "en:AB nl:A de:B es:C"
	},
	{
		y: 2020,
		o: "de",
		t: {
			de: "Der Wald der Wölfe",
			en: "Forest of Wolves",
			nl: "Het Wolvenwoud",
			pl: "Las Wilków"
		},
		g: ["Documentaire"],
		d: "Jana Hofmeister",
		r: 8,
		m: 90,
		c: ["Verteller"],
		a: 21,
		p: "Na honderdvijftig jaar keren wolven terug in de bossen van Midden-Europa. Een jaar lang volgen we een roedel in de grensstreek tussen Duitsland en Polen, en de mensen die met ze moeten leren leven.",
		v: "de:B nl:A en:B pl:C"
	}
];
//#endregion
//#region src/lib/sample/data/series.ts
var SERIES = [
	{
		y: 2016,
		o: "nl",
		t: {
			nl: "De Grens",
			en: "The Border",
			de: "Die Grenze",
			tr: "Sınır"
		},
		g: ["Misdaad", "Drama"],
		d: "Bart Schouten",
		r: 8,
		m: 48,
		c: [
			"rechercheur Ilse Maas",
			"Yusuf Kaya",
			"commissaris Dekker"
		],
		a: 10,
		p: "In het grensgebied tussen Limburg en België verdwijnt een jonge douanier. Rechercheur Ilse Maas stuit op een smokkelnetwerk dat beide landen liever onzichtbaar houden.",
		v: "nl:AC en:B de:C tr:C",
		s: [
			8,
			8,
			6
		]
	},
	{
		y: 2019,
		o: "nl",
		t: {
			nl: "Polderlicht",
			en: "Polder Light",
			de: "Polderlicht"
		},
		g: ["Drama"],
		d: "Mirjam Kooistra",
		r: 7.6,
		m: 45,
		c: [
			"Anke Hoogeveen",
			"Gerrit Hoogeveen",
			"Sjoerd"
		],
		a: 29,
		p: "Een boerenfamilie in de Noordoostpolder vecht voor het voortbestaan van haar bedrijf. Dan keert de jongste dochter terug uit de stad, met plannen die niemand wil horen.",
		v: "nl:A en:AB de:B",
		s: [6, 6]
	},
	{
		y: 2022,
		o: "en",
		t: {
			nl: "Het Signaal",
			en: "The Signal",
			fr: "Le Signal",
			es: "La Señal",
			pl: "Sygnał"
		},
		g: ["Sciencefiction", "Mysterie"],
		d: "Owen Achterberg",
		r: 8.2,
		m: 52,
		c: [
			"dr. Maya Collins",
			"Theo Brandt",
			"agent Kessler"
		],
		a: 3,
		p: "Een radiotelescoop in de Atacamawoestijn vangt een signaal op dat elke nacht een minuut eerder komt. Astronome Maya Collins ontdekt dat de boodschap gaat over gebeurtenissen die nog moeten plaatsvinden.",
		v: "nl:A en:A4B fr:B es:C pl:C",
		s: [8, 8]
	},
	{
		y: 2018,
		o: "nl",
		t: {
			nl: "Kantoor 13",
			en: "Office 13"
		},
		g: ["Komedie"],
		d: "Thijs Rademaker",
		r: 7.4,
		m: 25,
		c: [
			"Ronald Smit",
			"Fatima Bouzid",
			"Henk van Facilitair"
		],
		a: 38,
		p: "Op de dertiende verdieping van een gemeentekantoor in Almere draait niets zoals het hoort. Teamleider Ronald probeert met een ploeg eigenwijze ambtenaren de zoveelste reorganisatie te overleven.",
		v: "nl:AC en:B",
		s: [
			6,
			6,
			6,
			6
		]
	},
	{
		y: 2020,
		o: "de",
		t: {
			de: "Das Archiv",
			en: "The Archive",
			nl: "Het Archief",
			it: "L'Archivio"
		},
		g: ["Thriller", "Geschiedenis"],
		d: "Katrin Vogel",
		r: 8,
		m: 50,
		c: [
			"Lena Hartmann",
			"Paul Richter",
			"dr. Seidel"
		],
		a: 24,
		p: "Archivaris Lena Hartmann vindt in een vergeten kelder in Leipzig dossiers die nooit vernietigd hadden mogen worden. Elke map die ze opent, brengt iemand in de huidige regering in gevaar.",
		v: "de:B nl:A en:B it:C",
		s: [
			6,
			6,
			6
		]
	},
	{
		y: 2017,
		o: "tr",
		t: {
			tr: "Denizin Sultanı",
			en: "Sultan of the Sea",
			nl: "Sultan van de Zee",
			ar: "سلطان البحر"
		},
		g: [
			"Avontuur",
			"Drama",
			"Geschiedenis"
		],
		d: "Serkan Yıldız",
		r: 7.7,
		m: 55,
		c: [
			"kapitein Barış",
			"Nilüfer",
			"vizier Ahmet"
		],
		a: 42,
		p: "In de zestiende eeuw groeit een vissersjongen uit Izmir uit tot de meest gevreesde kapitein van de Middellandse Zee. Maar aan het hof in Istanbul wachten vijanden die gevaarlijker zijn dan elke storm.",
		v: "tr:C ar:C en:B nl:A",
		s: [10, 10]
	},
	{
		y: 2021,
		o: "nl",
		t: {
			nl: "Havenstad",
			en: "Harbour City",
			pl: "Miasto Portowe",
			pt: "Cidade Portuária"
		},
		g: ["Misdaad", "Thriller"],
		d: "Rachid Benali",
		r: 8.1,
		m: 47,
		c: [
			"douanier Sanne Kroes",
			"Mo Benali",
			"de Admiraal"
		],
		a: 7,
		p: "In de Rotterdamse haven verdwijnen elke week containers zonder een spoor achter te laten. Douanier Sanne Kroes raakt verstrikt in een netwerk waarin haar eigen broer een sleutelrol speelt.",
		v: "nl:A4C en:B pl:C pt:C",
		s: [
			8,
			8,
			8
		]
	},
	{
		y: 2023,
		o: "nl",
		t: {
			nl: "De Uitvinders",
			en: "The Inventors",
			fr: "Les Inventeurs",
			es: "Los Inventores",
			it: "Gli Inventori"
		},
		g: [
			"Animatie",
			"Familie",
			"Kinderen"
		],
		d: "Noor Huisman",
		r: 7.5,
		m: 22,
		c: [
			"Fien",
			"Bolt de robot",
			"professor Klok"
		],
		a: 5,
		p: "Fien en haar robot Bolt bouwen in een schuurtje de gekste uitvindingen, van een wolkenstofzuiger tot een vertaalmachine voor katten. En elke aflevering loopt er iets heerlijk mis.",
		v: "nl:A en:A fr:B es:C it:B",
		s: [10, 10]
	},
	{
		y: 2019,
		o: "ar",
		t: {
			ar: "وردة الصحراء",
			en: "Desert Rose",
			nl: "Woestijnroos",
			fr: "Rose des Sables"
		},
		g: ["Romantiek", "Drama"],
		d: "Laila Haddad",
		r: 7.3,
		m: 46,
		c: [
			"Noor",
			"Tariq",
			"oum Khaled"
		],
		a: 32,
		p: "Een jonge architecte keert terug naar haar geboortestad aan de rand van de woestijn om het hotel van haar grootmoeder te redden. Daar ontmoet ze de man die het wil slopen.",
		v: "ar:C fr:B en:B nl:A",
		s: [8, 8]
	},
	{
		y: 2021,
		o: "en",
		t: {
			nl: "De Holle Hoeve",
			en: "Hollow Farm",
			de: "Der Hohle Hof"
		},
		g: ["Horror", "Mysterie"],
		d: "Callum Rhys",
		r: 7,
		m: 44,
		c: [
			"Beth Harlow",
			"oude Jeb",
			"dominee Wynn"
		],
		a: 35,
		p: "Als de familie Harlow een oude boerderij in Wales koopt, vinden ze in de kelder een deur die van binnenuit op slot zit. Elke nacht klinkt er geklop, en elke ochtend is iemand een herinnering kwijt.",
		v: "en:B nl:A de:B",
		s: [6, 6]
	},
	{
		y: 2024,
		o: "en",
		t: {
			nl: "Oceaan Diep",
			en: "Deep Ocean",
			fr: "Océan Profond",
			pt: "Oceano Profundo"
		},
		g: ["Documentaire"],
		d: "Nora Fieldstone",
		r: 8.6,
		m: 50,
		c: ["Verteller"],
		a: 13,
		p: "Een documentairereeks naar de diepste, donkerste en vreemdste plekken van onze planeet. Met nieuwe duikrobots komen beelden boven die nog niemand eerder zag.",
		v: "en:A nl:A fr:B pt:C",
		s: [5, 5]
	},
	{
		y: 2025,
		o: "en",
		t: {
			nl: "De Tijdbewakers",
			en: "The Time Keepers",
			de: "Die Zeitwächter",
			es: "Los Guardianes del Tiempo",
			it: "I Guardiani del Tempo"
		},
		g: ["Fantasy", "Avontuur"],
		d: "Aria Monroe",
		r: 7.9,
		m: 49,
		c: [
			"Juno Blake",
			"meester Orrin",
			"de Holle Koning"
		],
		a: 1,
		p: "Een tienermeisje uit Bristol erft een zakhorloge waarmee ze tussen eeuwen kan reizen. Ze ontdekt dat een geheim genootschap al eeuwen de geschiedenis bijstuurt, en dat zij de volgende in de rij is.",
		v: "en:AB nl:A de:B es:C it:C",
		s: [8, 8]
	},
	{
		y: 2020,
		o: "es",
		t: {
			es: "Hermanas del Sur",
			en: "Sisters of the South",
			nl: "Zussen van het Zuiden",
			pt: "Irmãs do Sul"
		},
		g: ["Drama", "Romantiek"],
		d: "Verónica Saldaña",
		r: 7.1,
		m: 42,
		c: [
			"Lucía Montero",
			"Paloma Montero",
			"don Esteban"
		],
		a: 26,
		p: "Na de dood van hun vader erven drie zussen een noodlijdende wijngaard in Andalusië. Oude rivaliteit, een verdwenen testament en een charmante buurman maken van de oogst een slagveld.",
		v: "es:C pt:C en:B nl:A",
		s: [
			10,
			10,
			8
		]
	}
];
//#endregion
//#region src/lib/sample/data/channels.ts
var CHANNELS = [
	{
		name: "Prisma 1",
		tvg: "prisma1.nl",
		group: "Entertainment",
		lang: "nl",
		num: 1,
		feeds: "AH BF C4"
	},
	{
		name: "Prisma 2",
		tvg: "prisma2.nl",
		group: "Entertainment",
		lang: "nl",
		num: 2,
		feeds: "AH CF"
	},
	{
		name: "Prisma Nieuws",
		tvg: "prismanieuws.nl",
		group: "Nieuws",
		lang: "nl",
		num: 3,
		feeds: "AF BH"
	},
	{
		name: "Kanaal Noord",
		tvg: "kanaalnoord.nl",
		group: "Entertainment",
		lang: "nl",
		num: 4,
		feeds: "AH C4"
	},
	{
		name: "Kanaal Noord +1",
		tvg: "kanaalnoordplus1.nl",
		group: "Entertainment",
		lang: "nl",
		num: 5,
		feeds: "AH",
		shiftOf: "kanaalnoord.nl"
	},
	{
		name: "Prisma Sport 1",
		tvg: "prismasport1.nl",
		group: "Sport",
		lang: "nl",
		num: 6,
		feeds: "AF B4 CH"
	},
	{
		name: "Prisma Sport 2",
		tvg: "prismasport2.nl",
		group: "Sport",
		lang: "nl",
		num: 7,
		feeds: "AF"
	},
	{
		name: "Prisma Cinema",
		tvg: "prismacinema.nl",
		group: "Films",
		lang: "nl",
		num: 8,
		feeds: "AF CF"
	},
	{
		name: "Prisma Cinema +1",
		tvg: "prismacinemaplus1.nl",
		group: "Films",
		lang: "nl",
		num: 9,
		feeds: "AH CH",
		shiftOf: "prismacinema.nl",
		reuseTvg: "C"
	},
	{
		name: "Kidz Planeet",
		tvg: "kidzplaneet.nl",
		group: "Kids",
		lang: "nl",
		num: 10,
		feeds: "AH BH"
	},
	{
		name: "Wereld Docu",
		tvg: "wereldocu.nl",
		group: "Documentaire",
		lang: "nl",
		num: 11,
		feeds: "AF"
	},
	{
		name: "Polder FM TV",
		tvg: "polderfm.nl",
		group: "Muziek",
		lang: "nl",
		num: 12,
		feeds: "AH"
	},
	{
		name: "Omroep Lindeburg",
		tvg: "omroeplindeburg.nl",
		group: "Regionaal",
		lang: "nl",
		num: 13,
		feeds: "AH",
		noEpg: true
	},
	{
		name: "Neon Hits TV",
		tvg: "neonhits.uk",
		group: "Muziek",
		lang: "en",
		num: 26,
		feeds: "BH",
		noEpg: true
	},
	{
		name: "Globe 24",
		tvg: "globe24.uk",
		group: "Nieuws",
		lang: "en",
		num: 20,
		feeds: "AH BF"
	},
	{
		name: "Arena Sports",
		tvg: "arenasports.uk",
		group: "Sport",
		lang: "en",
		num: 21,
		feeds: "B4 CF"
	},
	{
		name: "Toontown TV",
		tvg: "toontown.us",
		group: "Kids",
		lang: "en",
		num: 22,
		feeds: "BH"
	},
	{
		name: "Discover Earth",
		tvg: "discoverearth.uk",
		group: "Documentaire",
		lang: "en",
		num: 23,
		feeds: "AF BF"
	},
	{
		name: "Pulse Music",
		tvg: "pulsemusic.uk",
		group: "Muziek",
		lang: "en",
		num: 24,
		feeds: "BH"
	},
	{
		name: "Bright TV",
		tvg: "brighttv.uk",
		group: "Entertainment",
		lang: "en",
		num: 25,
		feeds: "BH CH"
	},
	{
		name: "Nachrichten Eins",
		tvg: "nachrichten1.de",
		group: "Nieuws",
		lang: "de",
		num: 30,
		feeds: "BH"
	},
	{
		name: "Kino Klassik",
		tvg: "kinoklassik.de",
		group: "Films",
		lang: "de",
		num: 31,
		feeds: "BF"
	},
	{
		name: "Info Monde",
		tvg: "infomonde.fr",
		group: "Nieuws",
		lang: "fr",
		num: 40,
		feeds: "BH"
	},
	{
		name: "Histoire Plus",
		tvg: "histoireplus.fr",
		group: "Documentaire",
		lang: "fr",
		num: 41,
		feeds: "BH"
	},
	{
		name: "Deportes Uno",
		tvg: "deportes1.es",
		group: "Sport",
		lang: "es",
		num: 50,
		feeds: "CF"
	},
	{
		name: "Ritmo Latino",
		tvg: "ritmolatino.es",
		group: "Muziek",
		lang: "es",
		num: 51,
		feeds: "CH"
	},
	{
		name: "Cinema Italia",
		tvg: "cinemaitalia.it",
		group: "Films",
		lang: "it",
		num: 60,
		feeds: "BH CH"
	},
	{
		name: "Divertimento",
		tvg: "divertimento.it",
		group: "Entertainment",
		lang: "it",
		num: 61,
		feeds: "CH"
	},
	{
		name: "Haber Merkez",
		tvg: "habermerkez.tr",
		group: "Nieuws",
		lang: "tr",
		num: 70,
		feeds: "CH"
	},
	{
		name: "Çocuk Dünyası",
		tvg: "cocukdunyasi.tr",
		group: "Kids",
		lang: "tr",
		num: 71,
		feeds: "CH"
	},
	{
		name: "Al Ufuq News",
		tvg: "alufuq.ar",
		group: "Nieuws",
		lang: "ar",
		num: 80,
		feeds: "CH"
	},
	{
		name: "Saba Drama",
		tvg: "sabadrama.ar",
		group: "Entertainment",
		lang: "ar",
		num: 81,
		feeds: "CF"
	},
	{
		name: "Sport Polska",
		tvg: "sportpolska.pl",
		group: "Sport",
		lang: "pl",
		num: 90,
		feeds: "CF"
	},
	{
		name: "Cine Lusa",
		tvg: "cinelusa.pt",
		group: "Films",
		lang: "pt",
		num: 95,
		feeds: "CH"
	}
];
//#endregion
//#region src/lib/sample/data/pools.ts
var FIRST_NAMES = [
	"Mila",
	"Sven",
	"Noor",
	"Daan",
	"Lieke",
	"Bram",
	"Yara",
	"Joris",
	"Fenna",
	"Ruben",
	"Amara",
	"Thijs",
	"Elif",
	"Mats",
	"Sara",
	"Jesse",
	"Ilse",
	"Omar",
	"Roos",
	"Teun",
	"Hanna",
	"Kees",
	"Zoë",
	"Wouter",
	"Layla",
	"Floris",
	"Inge",
	"Milan",
	"Nadia",
	"Gijs",
	"Esmee",
	"Ravi",
	"Lotte",
	"Stijn",
	"Aylin",
	"Pim",
	"Iris",
	"Koen",
	"Mara",
	"Luuk",
	"Selin",
	"Hugo",
	"Nina",
	"Tobias",
	"Clara",
	"Matteo",
	"Leila",
	"Julien",
	"Ana",
	"Felix"
];
var LAST_NAMES = [
	"Verhoef",
	"Brandsma",
	"de Wit",
	"Kuipers",
	"Haddad",
	"van Leeuwen",
	"Okafor",
	"Brouwer",
	"Demir",
	"Lindqvist",
	"Mertens",
	"Rossetti",
	"Nowacki",
	"Ferreira",
	"Moreau",
	"Schäfer",
	"Yıldırım",
	"Kowalczyk",
	"Santana",
	"Galvão",
	"Bakker",
	"Visser",
	"Dekker",
	"Janssen",
	"Hendriks",
	"Peeters",
	"Smits",
	"Willems",
	"Mulder",
	"Bosman",
	"Vos",
	"Hoekstra",
	"Postma",
	"Ammerlaan",
	"Sterk",
	"van Dam",
	"Koster",
	"Prins",
	"Blom",
	"Scholten"
];
var SUPPORTING_ROLES = [
	"Buurvrouw",
	"Barman",
	"Journalist",
	"Agent",
	"Dokter",
	"Taxichauffeur",
	"Professor",
	"Burgemeester",
	"Verpleegkundige",
	"Advocaat",
	"Havenmeester",
	"Bibliothecaris"
];
/** Episode titles [nl, en]. */
var EPISODE_TITLES = [
	["Het Begin", "The Beginning"],
	["Onder Water", "Under Water"],
	["De Sleutel", "The Key"],
	["Laatste Kans", "Last Chance"],
	["Stille Getuige", "Silent Witness"],
	["Tegenwind", "Headwind"],
	["De Ruil", "The Trade"],
	["Nachtvlucht", "Night Flight"],
	["Oude Wonden", "Old Wounds"],
	["Het Verraad", "The Betrayal"],
	["Over de Rand", "Over the Edge"],
	["Vuur en Ijs", "Fire and Ice"],
	["De Kaart", "The Map"],
	["Verloren Zoon", "Lost Son"],
	["Het Masker", "The Mask"],
	["Thuiskomst", "Homecoming"],
	["Stormnacht", "Night of the Storm"],
	["Grensgebied", "Borderland"],
	["De Vierde Man", "The Fourth Man"],
	["Lege Handen", "Empty Hands"],
	["Schaduwspel", "Shadow Play"],
	["Het Archief", "The Records"],
	["Valse Start", "False Start"],
	["Eb en Vloed", "Ebb and Flow"],
	["De Belofte", "The Promise"],
	["Rode Draad", "Common Thread"],
	["Spiegelbeeld", "Mirror Image"],
	["Zonder Spoor", "Without a Trace"],
	["De Overkant", "The Other Side"],
	["Kat en Muis", "Cat and Mouse"],
	["Het Signaal", "The Signal"],
	["Middernacht", "Midnight"],
	["Breekpunt", "Breaking Point"],
	["De Erfenis", "The Inheritance"],
	["Op Drift", "Adrift"],
	["Gebroken Glas", "Broken Glass"],
	["De Wachter", "The Watcher"],
	["Bloedband", "Blood Ties"],
	["Noorderlicht", "Northern Lights"],
	["Tweede Natuur", "Second Nature"],
	["Het Offer", "The Sacrifice"],
	["Dageraad", "Daybreak"],
	["Open Zee", "Open Sea"],
	["De Val", "The Fall"],
	["Witte Leugens", "White Lies"],
	["Echo", "Echo"],
	["Vrije Val", "Free Fall"],
	["De Ontmoeting", "The Encounter"],
	["Kantelpunt", "Tipping Point"],
	["Het Laatste Woord", "The Final Word"],
	["Koude Oorlog", "Cold War"],
	["Zandloper", "Hourglass"],
	["Verborgen Kamer", "Hidden Room"],
	["De Oversteek", "The Crossing"],
	["Alles of Niets", "All or Nothing"],
	["Nieuwe Maan", "New Moon"],
	["Het Testament", "The Will"],
	["Tij", "Tide"],
	["De Uitnodiging", "The Invitation"],
	["Finale", "Finale"]
];
/** Generic episode titles per language (what many providers deliver). */
var GENERIC_EPISODE = {
	de: (n) => `Folge ${n}`,
	fr: (n) => `Épisode ${n}`,
	es: (n) => `Episodio ${n}`,
	it: (n) => `Episodio ${n}`,
	tr: (n) => `Bölüm ${n}`,
	ar: (n) => `الحلقة ${n}`,
	pl: (n) => `Odcinek ${n}`,
	pt: (n) => `Episódio ${n}`,
	ko: (n) => `${n}화`
};
/** Dutch episode synopsis templates: {a} {b} {c} are character names. */
var EPISODE_PLOTS = [
	"{a} vindt een aanwijzing die alles wat {b} beweerde op losse schroeven zet.",
	"Een onverwachte bezoeker dwingt {a} en {b} om een oude belofte na te komen.",
	"Terwijl {c} de druk opvoert, moet {a} kiezen wie ze nog kan vertrouwen.",
	"{b} neemt een gevaarlijk besluit; {a} ontdekt pas achteraf wat het heeft gekost.",
	"Een storm legt alles plat, en in het donker komen geheimen boven.",
	"{a} volgt een spoor naar het verleden van {c}, maar iemand is haar steeds een stap voor.",
	"Een feest loopt volledig uit de hand wanneer {b} de waarheid vertelt.",
	"{c} biedt {a} een deal aan die te mooi lijkt om waar te zijn.",
	"Een verloren brief brengt {a} en {b} weer bij elkaar, maar niet voor lang.",
	"Alles komt samen: {a} zet alles op het spel om {b} te redden.",
	"{b} krijgt een tweede kans, maar {c} heeft andere plannen.",
	"Een routineklus wordt een race tegen de klok voor {a}."
];
/** EPG programme pools per channel group: [title, description]. */
var PROGRAMMES = {
	Nieuws: [
		["Journaal", "Het laatste nieuws uit binnen- en buitenland."],
		["Ochtendeditie", "Nieuws, verkeer en weer om de dag mee te beginnen."],
		["Wereldbeeld", "Achtergronden bij het internationale nieuws."],
		["Het Weer", "Het weerbericht voor de komende dagen."],
		["Economie Vandaag", "Beurzen, bedrijven en de portemonnee van Nederland."],
		["Debat Live", "Politici en experts in gesprek over de kwestie van de dag."],
		["Nieuwsnacht", "Het nieuws van de dag, rustig samengevat."],
		["Regio Kort", "Nieuws uit de provincies in tien minuten."],
		["Persconferentie", "Live verslag van een aangekondigde persconferentie."]
	],
	Sport: [
		["Sportjournaal", "Uitslagen, samenvattingen en interviews."],
		["Live: Eredivisie Zaalvoetbal", "Topduel in de fictieve zaalcompetitie."],
		["Wielerronde Live", "Rechtstreeks verslag van een etappe door de heuvels."],
		["Studio Sport Extra", "Analyse met oud-profs aan tafel."],
		["Tennis: Kustkampioenschap", "Kwartfinales op gravel aan zee."],
		["Formule E-Sport", "Elektrische racers strijden in een stadscircuit."],
		["Atletiek Gala", "Wereldtoppers op de baan en in het veld."],
		["Doelpunten van de Week", "Alle mooiste goals op een rij."],
		["Schaatsmagazine", "Nieuws van de ijsbaan en de natuurijsplannen."]
	],
	Films: [
		["Avondfilm: De Laatste Trein", "Een conducteur ontdekt dat de nachttrein een passagier te veel heeft."],
		["Klassieker: Zomer van 1972", "Een nostalgisch drama over een vriendschap aan zee."],
		["Actiefilm: Kaapstad Connectie", "Een douanier raakt verwikkeld in een internationale smokkelzaak."],
		["Komedie: Bruiloft in Brabant", "Twee families, één feesttent en heel veel misverstanden."],
		["Thriller: Code Grijs", "Een hacker heeft 24 uur om haar naam te zuiveren."],
		["Familiefilm: Het Geheime Bos", "Drie kinderen vinden een pad dat niet op de kaart staat."],
		["Romantiek: Brieven aan Rome", "Een liefde die via ansichtkaarten opbloeit."],
		["Sciencefiction: Baan 7", "Een onderhoudsmonteur in een ruimtestation hoort stemmen in de leidingen."],
		["Filmpraat", "Recensies en nieuws uit de filmwereld."]
	],
	Kids: [
		["Bolt & Fien", "Een robot en een meisje bouwen de gekste uitvindingen."],
		["De Wolkenbende", "Vrolijke wolkjes beleven avonturen boven de stad."],
		["Dino Dokter", "Dokter Rex helpt zieke dinosaurussen beter."],
		["Ridder Kaasbol", "De dapperste ridder van het koninkrijk is bang voor muizen."],
		["Knutselklub", "Elke dag iets nieuws maken van wat je thuis hebt."],
		["Ruimtepiraten", "Een bemanning van piraten zoekt de schat van Saturnus."],
		["Slaapliedjes", "Rustige liedjes om mee in slaap te vallen."],
		["Het Grote Dierenquiz", "Kinderen strijden om de titel dierenkenner."]
	],
	Documentaire: [
		["Wilde Delta", "Het verborgen leven in de grootste rivierdelta van Europa."],
		["Bouwwerken van de Toekomst", "Ingenieurs bouwen aan steden op zee."],
		["Het Geheim van de Bijen", "Waarom bijen onmisbaar zijn voor ons voedsel."],
		["Verloren Steden", "Archeologen zoeken naar sporen van vergeten beschavingen."],
		["IJskappen", "Een jaar lang op een onderzoeksstation op Groenland."],
		["Microwerelden", "Een reis door de wereld van het allerkleinste."],
		["Treinen van de Wereld", "De mooiste spoorlijnen, van de Alpen tot de Andes."],
		["Diepzee", "Robots duiken naar plekken waar nog nooit licht kwam."]
	],
	Muziek: [
		["Hitlijst", "De veertig grootste hits van deze week."],
		["Live Sessies", "Bands spelen live in een kleine studio."],
		["Classics Nonstop", "De grootste hits van vroeger, zonder onderbreking."],
		["Dansnacht", "Elektronische muziek tot in de kleine uurtjes."],
		["Festivalzomer", "De beste optredens van de festivals van dit jaar."],
		["Akoestisch", "Bekende nummers, uitgekleed tot de essentie."],
		["Clipmix", "Een mix van nieuwe en bekende videoclips."]
	],
	Entertainment: [
		["De Grote Bakwedstrijd", "Amateurbakkers strijden om de gouden garde."],
		["Huis Ruil", "Twee gezinnen ruilen een week van huis."],
		["Quiz van de Eeuw", "Wie weet het meest over de afgelopen honderd jaar?"],
		["Late Night Live", "Gasten, muziek en de actualiteit met een knipoog."],
		["Verbouwd!", "Een team knapt in vijf dagen een vervallen woning op."],
		["Dierenpraat", "Over huisdieren en hun bijzondere baasjes."],
		["Weekendshow", "Spelletjes, verrassingen en muziek voor het hele gezin."],
		["Herhaling: De Grens", "De misdaadserie die iedereen bespreekt."],
		["Reisgenoten", "Twee onbekenden reizen samen door Zuid-Amerika."]
	]
};
//#endregion
//#region src/lib/sample/build.ts
var SOURCE_IDS = {
	A: "sample",
	B: "sample-world",
	C: "sample-plus"
};
/** Public test streams only. */
var STREAMS = {
	mux: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8",
	appleMultiAudio: "https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8",
	sintel: "https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_ts/master.m3u8",
	mux2: "https://test-streams.mux.dev/test_001/stream.m3u8"
};
var VOD_STREAMS = [
	STREAMS.mux,
	STREAMS.sintel,
	STREAMS.mux2,
	STREAMS.appleMultiAudio
];
var LIVE_STREAMS = [
	STREAMS.mux,
	STREAMS.mux2,
	STREAMS.mux,
	STREAMS.appleMultiAudio
];
var DAY$1 = 864e5;
var HOUR = 36e5;
var MIN = 6e4;
function hash(s) {
	let h = 2166136261;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
}
/** Deterministic PRNG (mulberry32) seeded by a string. */
function rng(seed) {
	let a = hash(seed);
	return () => {
		a = a + 1831565813 | 0;
		let t = Math.imul(a ^ a >>> 15, 1 | a);
		t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
		return ((t ^ t >>> 14) >>> 0) / 4294967296;
	};
}
var CODE = {
	nl: "NL",
	en: "EN",
	de: "DE",
	fr: "FR",
	es: "ES",
	it: "IT",
	tr: "TR",
	ar: "AR",
	pl: "PL",
	pt: "PT",
	ko: "KR"
};
var TEMPLATES = {
	nl: [
		"NL - {t} ({y})",
		"NL: {t} ({y}) {q}",
		"[NL] {t} ({y})",
		"|NL| {t} {y}",
		"NL| {t} ({y}) [{q}]"
	],
	en: [
		"EN - {t} ({y})",
		"|EN| {t} {y} {q}",
		"EN: {t} ({y}) [{q}]",
		"ENG | {t} - {y}",
		"[EN] {t} ({y})",
		"{t} ({y}) {q}"
	],
	de: [
		"DE: {t} ({y}) [{q}]",
		"DE - {t} ({y})",
		"|DE| {t} ({y})",
		"GER | {t} {y}",
		"DE-{t} ({y})"
	],
	fr: [
		"FR - {t} ({y})",
		"FR: {t} ({y}) {q}",
		"|FR| {t} {y}",
		"[FRE] {t} ({y})",
		"FRA ▎{t} ({y})"
	],
	es: [
		"ES - {t} ({y})",
		"ES ▎{t} ({y})",
		"|ESP| {t} {y}",
		"SPA: {t} ({y})",
		"LAT - {t} ({y})"
	],
	it: [
		"IT - {t} ({y})",
		"ITA: {t} ({y}) {q}",
		"|IT| {t} {y}",
		"[ITA] {t} ({y})"
	],
	tr: [
		"TR ▎{t} ({y})",
		"TR - {t} ({y})",
		"|TR| {t} {y}",
		"TUR: {t} ({y}) {q}"
	],
	ar: [
		"AR - {t} ({y})",
		"|AR| {t} {y}",
		"ARA ▎{t} ({y})",
		"AR: {t} ({y}) [{q}]"
	],
	pl: [
		"PL - {t} ({y})",
		"PL: {t} ({y}) {q}",
		"|PL| {t} {y}",
		"POL ▎{t} ({y})"
	],
	pt: [
		"PT - {t} ({y})",
		"PT-BR - {t} ({y})",
		"|PT| {t} {y}",
		"POR: {t} ({y}) [{q}]",
		"BR ▎{t} ({y})"
	],
	ko: ["KR - {t} ({y})", "|KO| {t} {y}"]
};
var Q_TEXT = {
	"4K": [
		"4K",
		"UHD",
		"2160p"
	],
	FHD: ["FHD", "1080p"],
	HD: ["HD", "720p"],
	SD: ["SD", "480p"],
	unknown: [""]
};
var Q_CHAR = {
	"4": "4K",
	F: "FHD",
	H: "HD",
	S: "SD"
};
var DEFAULT_Q = {
	A: "FHD",
	B: "HD",
	C: "HD"
};
var MOVIE_CATS = {
	A: (l) => `${CODE[l]} | ${l === "en" ? "MOVIES" : "FILMS"}`,
	B: (l) => ({
		nl: "Netherlands VOD",
		en: "English Movies",
		de: "Germany VOD",
		fr: "FR - Films",
		es: "Spain Movies",
		it: "Italia Film",
		pt: "Portugal VOD",
		tr: "Turkey VOD",
		ar: "Arabic Movies",
		pl: "Poland VOD",
		ko: "Korea VOD"
	})[l] ?? "Movies",
	C: (l) => ({
		nl: "NL | FILMS",
		en: "VOD | ENGLISH",
		de: "DE | KINO",
		fr: "FR | FILMS",
		es: "ES | PELÍCULAS",
		it: "IT | FILM",
		tr: "TR | FİLMLER",
		ar: "AR | أفلام",
		pl: "PL | FILMY",
		pt: "PT-BR | FILMES",
		ko: "KR | 영화"
	})[l] ?? "VOD"
};
var SERIES_CATS = {
	A: (l) => `${CODE[l]} | SERIES`,
	B: (l) => ({
		nl: "Netherlands Series",
		en: "English TV Shows",
		de: "Germany Series",
		fr: "FR - Séries",
		es: "Spain Series",
		it: "Italia Serie TV",
		pt: "Portugal Series",
		tr: "Turkey Series",
		ar: "Arabic Series",
		pl: "Poland Series"
	})[l] ?? "Series",
	C: (l) => ({
		nl: "NL | SERIES",
		en: "SERIES | ENGLISH",
		de: "DE | SERIEN",
		fr: "FR | SÉRIES",
		es: "ES | SERIES",
		it: "IT | SERIE TV",
		tr: "TR | DİZİLER",
		ar: "AR | مسلسلات",
		pl: "PL | SERIALE",
		pt: "PT-BR | SÉRIES"
	})[l] ?? "SERIES"
};
/** "nl:A4C en:BF" → [{nl,A,4K},{nl,C},{en,B,FHD}] */
function parseAvail(v) {
	const out = [];
	for (const part of v.split(/\s+/).filter(Boolean)) {
		const [lang, spec] = part.split(":");
		for (const m of spec.matchAll(/([ABC])([4FHS]?)/g)) out.push({
			lang,
			src: m[1],
			q: m[2] ? Q_CHAR[m[2]] : void 0
		});
	}
	return out;
}
function fill(tpl, title, year, q) {
	return tpl.replace("{t}", title).replace("{y}", year ? String(year) : "").replace("{q}", q).replace(/\(\)|\[\]/g, "").replace(/\s+/g, " ").trim();
}
function rawTitleFor(lang, src, title, year, quality, salt) {
	const h = hash(salt);
	const qText = Q_TEXT[quality][h % Q_TEXT[quality].length];
	if (lang === "nl" && quality === "4K" && src === "C") return {
		rawTitle: `4K-NL - ${title} (${year})`,
		qualityInTitle: true,
		qText
	};
	const list = TEMPLATES[lang] ?? [`${CODE[lang] ?? lang.toUpperCase()} - {t} ({y})`];
	const tpl = list[(h >>> 3) % list.length];
	return {
		rawTitle: fill(tpl, title, year, qText),
		qualityInTitle: tpl.includes("{q}"),
		qText
	};
}
function personName(seed, used) {
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
function castFor(seed, key) {
	const used = /* @__PURE__ */ new Set([seed.d]);
	const roles = [...seed.c];
	if (!(roles.length === 1 && roles[0] === "Verteller")) {
		const h = hash(key + "support");
		roles.push(SUPPORTING_ROLES[h % SUPPORTING_ROLES.length]);
		roles.push(SUPPORTING_ROLES[(h >>> 5) % SUPPORTING_ROLES.length]);
	}
	return [...new Set(roles)].map((role) => `${personName(key + role, used)} (${role})`);
}
function releaseDate(year, key) {
	const h = hash(key + "release");
	return `${year}-${String(1 + h % 12).padStart(2, "0")}-${String(1 + (h >>> 4) % 28).padStart(2, "0")}`;
}
/** Titles with a (test-stream) trailer, to exercise the trailer modal. */
var TRAILERS = {
	"movie-0": STREAMS.mux,
	"movie-20": STREAMS.sintel,
	"movie-21": STREAMS.mux,
	"movie-44": STREAMS.mux2,
	"series-2": STREAMS.mux
};
/** Kijkwijzer-style age rating from the genres (deterministic variation per title). */
function certificationFor(genres, key) {
	const h = hash(key + "cert");
	if (genres.includes("Animatie") || genres.includes("Kinderen")) return "AL";
	if (genres.includes("Horror")) return "16";
	if (genres.includes("Documentaire")) return h % 2 ? "AL" : "6";
	if (genres.includes("Familie")) return "6";
	if (genres.includes("Oorlog")) return "14";
	if (genres.some((g) => g === "Thriller" || g === "Misdaad")) return h % 3 ? "12" : "16";
	if (genres.includes("Actie")) return "12";
	if (genres.includes("Komedie") || genres.includes("Romantiek")) return h % 2 ? "6" : "AL";
	return h % 2 ? "12" : "9";
}
function emptyBuckets() {
	return {
		A: {
			movies: [],
			series: [],
			channels: [],
			epg: []
		},
		B: {
			movies: [],
			series: [],
			channels: [],
			epg: []
		},
		C: {
			movies: [],
			series: [],
			channels: [],
			epg: []
		}
	};
}
/** Shared metadata per source (A rich, B partial, C sparse). */
function metaFor(seed, index, kind, src, lang, key, now, k) {
	const origTitle = seed.t[seed.o] ?? seed.t.en ?? "";
	const translated = (seed.t[lang] ?? origTitle) !== origTitle;
	const noId = "noId" in seed && seed.noId;
	const tmdbId = (kind === "movie" ? 91e4 : 92e4) + index + 1;
	const added = (extra) => now - (seed.a + extra) * DAY$1 - k * 37 * MIN;
	if (src === "A") return {
		trailerUrl: TRAILERS[`${kind}-${index}`],
		tmdbId: noId ? void 0 : tmdbId,
		originalTitle: translated ? origTitle : void 0,
		year: seed.y,
		plot: seed.p,
		genres: seed.g,
		cast: castFor(seed, key),
		director: seed.d,
		rating: seed.r,
		durationSec: kind === "movie" ? seed.m * 60 : void 0,
		releaseDate: releaseDate(seed.y, key),
		addedAt: added(0)
	};
	if (src === "B") return {
		originalTitle: translated ? origTitle : void 0,
		genres: seed.g.map((g) => localizedGenre(g, "en")),
		cast: castFor(seed, key).slice(0, 3).map((c) => c.replace(/\s*\(.*\)$/, "")),
		director: seed.d,
		rating: Math.round((seed.r + (hash(key + "r") % 5 - 2) / 10) * 10) / 10,
		durationSec: kind === "movie" ? seed.m * 60 + 40 : void 0,
		addedAt: added(2)
	};
	return {
		tmdbId: translated && !noId ? tmdbId : void 0,
		originalTitle: translated && noId ? origTitle : void 0,
		year: seed.y,
		genres: seed.g.map((g) => localizedGenre(g, lang)),
		addedAt: added(5)
	};
}
function buildMovies(b, now) {
	FILMS.forEach((f, i) => {
		const key = `film-${i}-${f.t[f.o]}`;
		parseAvail(f.v).forEach((av, k) => {
			const quality = av.q ?? DEFAULT_Q[av.src];
			const title = f.t[av.lang];
			const r = rawTitleFor(av.lang, av.src, title, f.y, quality, `${key}-${av.lang}-${av.src}-${k}`);
			const category = MOVIE_CATS[av.src](av.lang) + (r.qualityInTitle ? "" : ` ${r.qText}`.trimEnd());
			const movie = {
				kind: "movie",
				sourceId: SOURCE_IDS[av.src],
				providerId: `m${i + 1}-${av.lang}-${k}`,
				rawTitle: r.rawTitle,
				category,
				url: VOD_STREAMS[hash(key + k) % VOD_STREAMS.length],
				containerExt: "m3u8",
				...metaFor(f, i, "movie", av.src, av.lang, key, now, k)
			};
			if (av.src !== "C") Object.assign(movie, { certification: certificationFor(f.g, key) });
			b[av.src].movies.push(movie);
		});
		(f.x ?? []).forEach(([src, rawTitle, lang], k) => {
			b[src].movies.push({
				kind: "movie",
				sourceId: SOURCE_IDS[src],
				providerId: `m${i + 1}-x${k}`,
				rawTitle,
				category: src === "A" ? "VOD" : src === "B" ? "Movies" : "VOD | MIX",
				url: /MULTI/.test(rawTitle) ? STREAMS.appleMultiAudio : STREAMS.mux,
				containerExt: "m3u8",
				langHint: lang,
				addedAt: now - (f.a + 1) * DAY$1 - k * HOUR
			});
		});
	});
}
function shuffled(arr, seed) {
	const r = rng(seed);
	const out = [...arr];
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(r() * (i + 1));
		[out[i], out[j]] = [out[j], out[i]];
	}
	return out;
}
function pad(n) {
	return String(n).padStart(2, "0");
}
/** Capitalise sentence starts (character names like "meester Orrin" can open a sentence). */
function sentenceCase(text) {
	return text.replace(/(^|[.!?]\s+)(\p{Ll})/gu, (_, pre, ch) => pre + ch.toUpperCase());
}
function buildSeries(b, now) {
	SERIES.forEach((s, i) => {
		const key = `series-${i}-${s.t[s.o]}`;
		const titles = shuffled(EPISODE_TITLES, key);
		const chars = [
			...s.c,
			s.c[0],
			s.c[0]
		];
		parseAvail(s.v).forEach((av, k) => {
			const quality = av.q ?? DEFAULT_Q[av.src];
			const seriesTitle = s.t[av.lang];
			const r = rawTitleFor(av.lang, av.src, seriesTitle, s.y, quality, `${key}-${av.lang}-${av.src}-${k}`);
			const full = av.lang === s.o || av.lang === "nl" || av.lang === "en";
			const episodes = [];
			let g = 0;
			s.s.forEach((count, si) => {
				const season = si + 1;
				const available = full || season === 1 ? count : Math.ceil(count * .6);
				for (let e = 1; e <= count; e++, g++) {
					if (e > available) continue;
					const h = hash(`${key}-${av.lang}-${av.src}-${season}-${e}`);
					if (av.src === "C" && !(season === 1 && e === 1) && h % 9 === 0) continue;
					const [nlTitle, enTitle] = titles[g % titles.length];
					const named = av.lang === "nl" ? nlTitle : av.lang === "en" ? enTitle : void 0;
					const generic = (GENERIC_EPISODE[av.lang] ?? ((n) => `Episode ${n}`))(e);
					const code = `S${pad(season)}E${pad(e)}`;
					const epTitle = av.src === "A" ? named ?? generic : av.src === "B" ? named ? `${seriesTitle} ${code} - ${named}` : `${seriesTitle} ${code}` : `${CODE[av.lang]} - ${seriesTitle} ${code}`;
					const plotTpl = EPISODE_PLOTS[h % EPISODE_PLOTS.length];
					const airDate = new Date(Date.UTC(s.y + si, 8, 1) + (e - 1) * 7 * DAY$1).toISOString().slice(0, 10);
					episodes.push({
						providerId: `s${i + 1}-${av.lang}-${av.src}-${season}-${e}`,
						season,
						episode: e,
						title: epTitle,
						plot: av.src === "A" && av.lang === "nl" ? sentenceCase(plotTpl.replace("{a}", chars[0]).replace("{b}", chars[1]).replace("{c}", chars[2])) : void 0,
						durationSec: (s.m + (h >>> 4) % 5 - 2) * 60,
						airDate,
						url: VOD_STREAMS[(h >>> 2) % VOD_STREAMS.length],
						containerExt: "m3u8"
					});
				}
			});
			const category = SERIES_CATS[av.src](av.lang) + (r.qualityInTitle ? "" : ` ${r.qText}`.trimEnd());
			const meta = metaFor(s, i, "series", av.src, av.lang, key, now, k);
			delete meta.durationSec;
			const series = {
				kind: "series",
				sourceId: SOURCE_IDS[av.src],
				providerId: `s${i + 1}-${av.lang}-${k}`,
				rawTitle: r.rawTitle,
				category,
				episodes,
				...meta
			};
			if (av.src !== "C") Object.assign(series, { certification: certificationFor(s.g, key) });
			b[av.src].series.push(series);
		});
	});
}
var LIVE_Q = {
	A: {
		"4K": "4K",
		FHD: "FHD",
		HD: "HD",
		SD: "SD"
	},
	B: {
		"4K": "UHD",
		FHD: "FHD",
		HD: "HD",
		SD: "SD"
	},
	C: {
		"4K": "4K",
		FHD: "FHD",
		HD: "ᴴᴰ",
		SD: "SD"
	}
};
function buildChannels$1(b) {
	for (const ch of CHANNELS) {
		const code = CODE[ch.lang];
		const shared = /[AB]/.test(ch.feeds);
		for (const m of ch.feeds.matchAll(/([ABC])([4FHS])/g)) {
			const src = m[1];
			const q = LIVE_Q[src][Q_CHAR[m[2]]] ?? "";
			const rawName = src === "A" ? `${code}: ${ch.name} ${q}` : src === "B" ? `|${code}| ${ch.name} ${q}` : `${code} ▎${shared ? ch.name.toUpperCase() : ch.name} ${q}`;
			const group = src === "A" ? `${code} | ${ch.group}` : src === "B" ? `${ch.group} (${code})` : `|${code}| ${ch.group}`;
			const tvgId = src === "A" ? ch.tvg : src === "B" ? ch.tvg.charAt(0).toUpperCase() + ch.tvg.slice(1) : ch.reuseTvg?.includes("C") && ch.shiftOf ? ch.shiftOf : ch.num % 2 === 0 || !shared ? ch.tvg : void 0;
			b[src].channels.push({
				kind: "live",
				sourceId: SOURCE_IDS[src],
				providerId: `ch${ch.num}-${src}`,
				rawName: rawName.trim(),
				tvgId,
				tvgName: ch.name,
				group,
				number: src === "A" ? ch.num : src === "B" ? ch.num + 100 : void 0,
				url: LIVE_STREAMS[hash(ch.tvg + src) % LIVE_STREAMS.length]
			});
		}
	}
}
function localMidnight(t) {
	const d = new Date(t);
	return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}
/**
* Deterministic guide per channel per day; covers now − 6 h … now + 24 h.
* Channels marked noEpg get no programmes (the guide shows "no programme information").
*/
function generateEpg(now, channels = CHANNELS) {
	const from = now - 6 * HOUR;
	const to = now + 24 * HOUR;
	const byTvg = /* @__PURE__ */ new Map();
	const durations = [
		30,
		45,
		60,
		60,
		60,
		90,
		120
	];
	for (const ch of channels) {
		if (ch.shiftOf || ch.noEpg) continue;
		const pool = PROGRAMMES[ch.group];
		const list = [];
		for (let day = localMidnight(from - HOUR); day < to + DAY$1;) {
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
					title: ch.group === "Entertainment" && n % 3 === 1 ? `${title} (afl. ${1 + n % 12})` : title,
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
		byTvg.set(ch.tvg, base.map((p) => ({
			...p,
			channelId: ch.tvg,
			start: p.start + HOUR,
			stop: p.stop + HOUR
		})));
	}
	const out = [];
	for (const list of byTvg.values()) for (const p of list) if (p.stop > from && p.start < to) out.push(p);
	return out;
}
/** All three demo sources as raw catalogs. */
function buildSampleCatalogs(now = Date.now()) {
	const b = emptyBuckets();
	buildMovies(b, now);
	buildSeries(b, now);
	buildChannels$1(b);
	b.A.epg = generateEpg(now);
	return Object.keys(SOURCE_IDS).map((src) => ({
		sourceId: SOURCE_IDS[src],
		fetchedAt: now,
		...b[src]
	}));
}
//#endregion
//#region src/lib/sample/meta.ts
var SAMPLE_SOURCE = {
	id: "sample",
	name: "Demo-bibliotheek",
	type: "sample",
	enabled: true,
	addedAt: 0
};
/** Extra demo sources that come along with SAMPLE_SOURCE (same 'sample' type). */
var SAMPLE_EXTRA_SOURCES = [{
	id: "sample-world",
	name: "Demo World",
	type: "sample",
	enabled: true,
	addedAt: 0
}, {
	id: "sample-plus",
	name: "Demo Plus",
	type: "sample",
	enabled: true,
	addedAt: 0
}];
var SAMPLE_SOURCE_IDS = [SAMPLE_SOURCE.id, ...SAMPLE_EXTRA_SOURCES.map((s) => s.id)];
var SAMPLE_SOURCE_NAMES = Object.fromEntries([SAMPLE_SOURCE, ...SAMPLE_EXTRA_SOURCES].map((s) => [s.id, s.name]));
function isSampleSourceId(id) {
	return SAMPLE_SOURCE_IDS.includes(id);
}
//#endregion
//#region src/lib/sample/index.ts
/** Every demo source (primary + extras) as raw catalogs. Use this for the 'sample' source type. */
function sampleCatalogs(now = Date.now()) {
	return buildSampleCatalogs(now);
}
//#endregion
//#region src/lib/tmdb/client.ts
var BASE = "https://api.themoviedb.org/3";
var IMG = "https://image.tmdb.org/t/p/";
var DAY = 864e5;
/** In-memory cache (tests, or when IndexedDB is unavailable). */
function memoryCache() {
	const map = /* @__PURE__ */ new Map();
	return {
		get: async (k) => map.get(k),
		set: async (k, v) => {
			map.set(k, v);
		}
	};
}
/** Sliding-window limiter: at most `max` calls per `windowMs`. */
var RateLimiter = class {
	max;
	windowMs;
	now;
	sleep;
	#stamps = [];
	constructor(max = 40, windowMs = 1e4, now = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms))) {
		this.max = max;
		this.windowMs = windowMs;
		this.now = now;
		this.sleep = sleep;
	}
	async take() {
		for (;;) {
			const t = this.now();
			while (this.#stamps.length && t - this.#stamps[0] >= this.windowMs) this.#stamps.shift();
			if (this.#stamps.length < this.max) {
				this.#stamps.push(t);
				return;
			}
			await this.sleep(this.windowMs - (t - this.#stamps[0]) + 5);
		}
	}
};
var TmdbError = class extends Error {
	status;
	constructor(message, status) {
		super(message);
		this.status = status;
	}
};
function str(v) {
	return typeof v === "string" && v.trim() ? v : void 0;
}
function num(v) {
	return typeof v === "number" && Number.isFinite(v) ? v : void 0;
}
function arr(v) {
	return Array.isArray(v) ? v : [];
}
var US_RATINGS = {
	G: "AL",
	"TV-Y": "AL",
	"TV-G": "AL",
	"TV-Y7": "6",
	PG: "6",
	"TV-PG": "9",
	"PG-13": "12",
	"TV-14": "14",
	R: "16",
	"TV-MA": "16",
	"NC-17": "18"
};
/** Normalise a certification to Kijkwijzer-style ages ('AL', '6', '9', '12', '14', '16', '18'). */
function normalizeCertification(country, value) {
	const v = value?.trim().toUpperCase();
	if (!v) return void 0;
	if (country === "US") return US_RATINGS[v];
	if (v === "AL" || v === "0" || v === "U" || v === "TOUS PUBLICS") return "AL";
	const n = /^(\d{1,2})/.exec(v);
	return n ? String(Number(n[1])) : void 0;
}
function certificationOf(kind, d) {
	const order = [
		"NL",
		"BE",
		"DE",
		"GB",
		"US"
	];
	const found = /* @__PURE__ */ new Map();
	if (kind === "movie") for (const r of arr(d.release_dates?.results)) {
		const c = str(r.iso_3166_1);
		const cert = arr(r.release_dates).map((x) => str(x.certification)).find(Boolean);
		if (c && cert) found.set(c, cert);
	}
	else for (const r of arr(d.content_ratings?.results)) {
		const c = str(r.iso_3166_1);
		const cert = str(r.rating);
		if (c && cert) found.set(c, cert);
	}
	for (const c of order) {
		const n = normalizeCertification(c, found.get(c));
		if (n) return n;
	}
}
function yearOf(date) {
	const m = date ? /^(\d{4})/.exec(date) : null;
	return m ? Number(m[1]) : void 0;
}
var TmdbClient = class {
	#key;
	#bearer;
	#fetch;
	#limiter;
	#cache;
	#ttl;
	#missTtl;
	constructor(apiKey, opts = {}) {
		this.#key = apiKey.trim();
		this.#bearer = this.#key.startsWith("eyJ") || this.#key.length > 40;
		this.#fetch = opts.fetch ?? ((...args) => fetch(...args));
		this.#limiter = opts.limiter ?? new RateLimiter();
		this.#cache = opts.cache ?? memoryCache();
		this.#ttl = opts.ttl ?? 30 * DAY;
		this.#missTtl = opts.missTtl ?? 7 * DAY;
	}
	async #get(path, params) {
		const qs = new URLSearchParams();
		for (const [k, v] of Object.entries(params)) if (v !== void 0 && v !== "") qs.set(k, String(v));
		const cacheKey = `${path}?${qs}`;
		const cached = await this.#cache.get(cacheKey).catch(() => void 0);
		const now = Date.now();
		if (cached && now - cached.at < (cached.v ? this.#ttl : this.#missTtl)) {
			if (!cached.v) throw new TmdbError("not found", 404);
			return cached.v;
		}
		if (!this.#bearer) qs.set("api_key", this.#key);
		await this.#limiter.take();
		const res = await this.#fetch(`${BASE}${path}?${qs}`, { headers: this.#bearer ? {
			Authorization: `Bearer ${this.#key}`,
			Accept: "application/json"
		} : { Accept: "application/json" } });
		if (res.status === 404) {
			await this.#cache.set(cacheKey, {
				at: now,
				v: null
			}).catch(() => {});
			throw new TmdbError("not found", 404);
		}
		if (!res.ok) throw new TmdbError(`TMDB ${res.status}`, res.status);
		const json = await res.json();
		await this.#cache.set(cacheKey, {
			at: now,
			v: json
		}).catch(() => {});
		return json;
	}
	/** Find a TMDB id by title (+ year, ±1 tolerated). */
	async search(kind, query, year, lang = "en") {
		const path = kind === "movie" ? "/search/movie" : "/search/tv";
		const yearParam = kind === "movie" ? "year" : "first_air_date_year";
		const run = async (y) => arr((await this.#get(path, {
			query,
			[yearParam]: y,
			language: lang,
			include_adult: "false"
		})).results);
		let results = await run(year);
		if (!results.length && year) results = (await run()).filter((r) => {
			const ry = yearOf(str(r.release_date) ?? str(r.first_air_date));
			return ry !== void 0 && Math.abs(ry - year) <= 1;
		});
		const first = results[0];
		return first ? num(first.id) ?? null : null;
	}
	/** Full metadata for one title, overview/genres in `lang`. */
	async details(kind, id, lang = "en") {
		const path = kind === "movie" ? `/movie/${id}` : `/tv/${id}`;
		const d = await this.#get(path, {
			language: lang,
			append_to_response: `credits,videos,alternative_titles,translations,external_ids,${kind === "movie" ? "release_dates" : "content_ratings"}`,
			include_video_language: `${lang},en,null`
		});
		const credits = d.credits ?? {};
		const cast = arr(credits.cast).slice(0, 15).map((c) => ({
			name: str(c.name) ?? "",
			character: str(c.character),
			profileUrl: str(c.profile_path) ? `${IMG}w185${c.profile_path}` : void 0
		})).filter((p) => p.name);
		const director = kind === "movie" ? str(arr(credits.crew).find((c) => c.job === "Director")?.name) : str(arr(d.created_by)[0]?.name);
		const video = arr(d.videos?.results).find((v) => v.site === "YouTube" && (v.type === "Trailer" || v.type === "Teaser"));
		const altTitles = [];
		for (const t of arr(d.translations?.translations)) {
			const data = t.data ?? {};
			const title = str(data.title) ?? str(data.name);
			const l = str(t.iso_639_1);
			if (title) altTitles.push({
				title,
				lang: l
			});
		}
		const alt = d.alternative_titles ?? {};
		for (const t of arr(alt.titles ?? alt.results)) {
			const title = str(t.title);
			if (title) altTitles.push({ title });
		}
		const releaseDate = str(d.release_date) ?? str(d.first_air_date);
		const runtime = num(d.runtime) ?? num(arr(d.episode_run_time)[0]);
		return {
			id,
			kind,
			title: str(d.title) ?? str(d.name) ?? "",
			originalTitle: str(d.original_title) ?? str(d.original_name),
			originalLang: str(d.original_language),
			overview: str(d.overview),
			genres: arr(d.genres).map((g) => str(g.name)).filter((g) => !!g),
			runtimeMin: runtime || void 0,
			releaseDate,
			year: yearOf(releaseDate),
			rating: num(d.vote_average) ? Math.round(num(d.vote_average) * 10) / 10 : void 0,
			cast,
			director,
			posterUrl: str(d.poster_path) ? `${IMG}w500${d.poster_path}` : void 0,
			backdropUrl: str(d.backdrop_path) ? `${IMG}w1280${d.backdrop_path}` : void 0,
			trailerUrl: video ? `https://www.youtube.com/watch?v=${video.key}` : void 0,
			imdbId: str(d.imdb_id) ?? str(d.external_ids?.imdb_id),
			certification: certificationOf(kind, d),
			altTitles,
			lang,
			fetchedAt: Date.now()
		};
	}
};
//#endregion
//#region node_modules/idb-keyval/dist/index.js
var dist_exports = /* @__PURE__ */ __exportAll({
	clear: () => clear,
	createStore: () => createStore,
	del: () => del,
	delMany: () => delMany,
	entries: () => entries,
	get: () => get,
	getMany: () => getMany,
	keys: () => keys,
	promisifyRequest: () => promisifyRequest,
	set: () => set,
	setMany: () => setMany,
	update: () => update,
	values: () => values
});
function promisifyRequest(request) {
	return new Promise((resolve, reject) => {
		request.oncomplete = request.onsuccess = () => resolve(request.result);
		request.onabort = request.onerror = () => reject(request.error);
	});
}
function createStore(dbName, storeName) {
	let dbp;
	const getDB = () => {
		if (dbp) return dbp;
		const request = indexedDB.open(dbName);
		request.onupgradeneeded = () => request.result.createObjectStore(storeName);
		dbp = promisifyRequest(request);
		dbp.then((db) => {
			db.onclose = () => dbp = void 0;
		}, () => {
			dbp = void 0;
		});
		return dbp;
	};
	return (txMode, callback) => getDB().then((db) => callback(db.transaction(storeName, txMode).objectStore(storeName)));
}
function defaultGetStore() {
	if (!defaultGetStoreFunc) defaultGetStoreFunc = createStore("keyval-store", "keyval");
	return defaultGetStoreFunc;
}
/**
* Get a value by its key.
*
* @param key
* @param customStore Method to get a custom store. Use with caution (see the docs).
*/
function get(key, customStore = defaultGetStore()) {
	return customStore("readonly", (store) => promisifyRequest(store.get(key)));
}
/**
* Set a value with a key.
*
* @param key
* @param value
* @param customStore Method to get a custom store. Use with caution (see the docs).
*/
function set(key, value, customStore = defaultGetStore()) {
	return customStore("readwrite", (store) => {
		store.put(value, key);
		return promisifyRequest(store.transaction);
	});
}
/**
* Set multiple values at once. This is faster than calling set() multiple times.
* It's also atomic – if one of the pairs can't be added, none will be added.
*
* @param entries Array of entries, where each entry is an array of `[key, value]`.
* @param customStore Method to get a custom store. Use with caution (see the docs).
*/
function setMany(entries, customStore = defaultGetStore()) {
	return customStore("readwrite", (store) => {
		entries.forEach((entry) => store.put(entry[1], entry[0]));
		return promisifyRequest(store.transaction);
	});
}
/**
* Get multiple values by their keys
*
* @param keys
* @param customStore Method to get a custom store. Use with caution (see the docs).
*/
function getMany(keys, customStore = defaultGetStore()) {
	return customStore("readonly", (store) => Promise.all(keys.map((key) => promisifyRequest(store.get(key)))));
}
/**
* Update a value. This lets you see the old value and update it as an atomic operation.
*
* @param key
* @param updater A callback that takes the old value and returns a new value.
* @param customStore Method to get a custom store. Use with caution (see the docs).
*/
function update(key, updater, customStore = defaultGetStore()) {
	return customStore("readwrite", (store) => new Promise((resolve, reject) => {
		const req = store.get(key);
		req.onsuccess = function() {
			try {
				store.put(updater(req.result), key);
				resolve(promisifyRequest(store.transaction));
			} catch (err) {
				reject(err);
			}
		};
		req.onerror = () => reject(req.error);
	}));
}
/**
* Delete a particular key from the store.
*
* @param key
* @param customStore Method to get a custom store. Use with caution (see the docs).
*/
function del(key, customStore = defaultGetStore()) {
	return customStore("readwrite", (store) => {
		store.delete(key);
		return promisifyRequest(store.transaction);
	});
}
/**
* Delete multiple keys at once.
*
* @param keys List of keys to delete.
* @param customStore Method to get a custom store. Use with caution (see the docs).
*/
function delMany(keys, customStore = defaultGetStore()) {
	return customStore("readwrite", (store) => {
		keys.forEach((key) => store.delete(key));
		return promisifyRequest(store.transaction);
	});
}
/**
* Clear all values in the store.
*
* @param customStore Method to get a custom store. Use with caution (see the docs).
*/
function clear(customStore = defaultGetStore()) {
	return customStore("readwrite", (store) => {
		store.clear();
		return promisifyRequest(store.transaction);
	});
}
function eachCursor(store, callback) {
	store.openCursor().onsuccess = function() {
		if (!this.result) return;
		callback(this.result);
		this.result.continue();
	};
	return promisifyRequest(store.transaction);
}
/**
* Get all keys in the store.
*
* @param customStore Method to get a custom store. Use with caution (see the docs).
*/
function keys(customStore = defaultGetStore()) {
	return customStore("readonly", (store) => {
		if (store.getAllKeys) return promisifyRequest(store.getAllKeys());
		const items = [];
		return eachCursor(store, (cursor) => items.push(cursor.key)).then(() => items);
	});
}
/**
* Get all values in the store.
*
* @param customStore Method to get a custom store. Use with caution (see the docs).
*/
function values(customStore = defaultGetStore()) {
	return customStore("readonly", (store) => {
		if (store.getAll) return promisifyRequest(store.getAll());
		const items = [];
		return eachCursor(store, (cursor) => items.push(cursor.value)).then(() => items);
	});
}
/**
* Get all entries in the store. Each entry is an array of `[key, value]`.
*
* @param customStore Method to get a custom store. Use with caution (see the docs).
*/
function entries(customStore = defaultGetStore()) {
	return customStore("readonly", (store) => {
		if (store.getAll && store.getAllKeys) return Promise.all([promisifyRequest(store.getAllKeys()), promisifyRequest(store.getAll())]).then(([keys, values]) => keys.map((key, i) => [key, values[i]]));
		const items = [];
		return eachCursor(store, (cursor) => items.push([cursor.key, cursor.value])).then(() => items);
	});
}
var defaultGetStoreFunc;
var init_dist = __esmMin((() => {}));
//#endregion
//#region src/lib/tmdb/index.ts
var META_TTL = 2592e6;
var idb = null;
function db() {
	idb ??= Promise.resolve().then(() => (init_dist(), dist_exports)).then((mod) => ({
		mod,
		store: mod.createStore("ps-tmdb", "kv")
	}));
	return idb;
}
/** IndexedDB-backed response cache (falls back to nothing when IndexedDB is unavailable). */
function idbCache() {
	return {
		async get(key) {
			if (typeof indexedDB === "undefined") return void 0;
			const { mod, store } = await db();
			return mod.get(key, store);
		},
		async set(key, value) {
			if (typeof indexedDB === "undefined") return;
			const { mod, store } = await db();
			await mod.set(key, value, store);
		}
	};
}
function emptyIndex() {
	return {
		byKey: {},
		meta: {}
	};
}
/** Record every known title of a TMDB entry as a lookup key for its id. */
function indexMeta(index, meta) {
	index.meta[tmdbMetaKey(meta.kind, meta.id)] = meta;
	const titles = [
		meta.title,
		meta.originalTitle,
		...meta.altTitles.map((a) => a.title)
	];
	for (const t of titles) {
		if (!t) continue;
		const key = matchKey(t);
		if (!key) continue;
		if (meta.year) for (const y of [
			meta.year - 1,
			meta.year,
			meta.year + 1
		]) {
			const k = tmdbLookupKey(meta.kind, key, y);
			if (y === meta.year || index.byKey[k] === void 0) index.byKey[k] = meta.id;
		}
		const loose = tmdbLookupKey(meta.kind, key);
		index.byKey[loose] ??= meta.id;
	}
}
/** Queries to try for a title: original, English/display, then other language titles. */
function queriesFor(t) {
	const out = [];
	const add = (q) => {
		if (q && !out.some((o) => matchKey(o) === matchKey(q))) out.push(q);
	};
	add(t.originalTitle);
	add(t.altTitles.find((a) => a.lang === "en")?.title);
	add(t.title);
	for (const a of t.altTitles) add(a.title);
	return out.slice(0, 3);
}
/**
* Enrich titles via TMDB. Mutates and returns `index`. Network errors stop the run quietly
* (401 = bad key → throws so the UI can tell the user).
*/
async function enrichTitles(opts) {
	const client = opts.client ?? new TmdbClient(opts.apiKey, { cache: idbCache() });
	const { index, lang } = opts;
	const batchSize = opts.batchSize ?? 20;
	const candidates = opts.titles.filter((t) => !opts.skipSource || t.sourceIds.some((s) => !opts.skipSource(s))).filter((t) => {
		if (!t.tmdbId) return true;
		const meta = index.meta[tmdbMetaKey(t.kind, t.tmdbId)];
		return !meta || meta.lang !== lang || Date.now() - meta.fetchedAt > META_TTL;
	}).sort((a, b) => b.popularity - a.popularity).slice(0, opts.maxTitles ?? 400);
	let searched = 0;
	let fetched = 0;
	for (let i = 0; i < candidates.length; i += batchSize) {
		if (opts.signal?.aborted) break;
		let changed = false;
		for (const t of candidates.slice(i, i + batchSize)) {
			if (opts.signal?.aborted) break;
			try {
				let id = t.tmdbId;
				if (!id) {
					for (const q of queriesFor(t)) {
						searched++;
						id = await client.search(t.kind, q, t.year, lang) ?? void 0;
						if (id) break;
					}
					if (!id) continue;
					for (const a of [
						t.title,
						t.originalTitle,
						...t.altTitles.map((x) => x.title)
					]) {
						if (!a) continue;
						index.byKey[tmdbLookupKey(t.kind, matchKey(a), t.year)] = id;
					}
					changed = true;
				}
				const mk = tmdbMetaKey(t.kind, id);
				const existing = index.meta[mk];
				if (!existing || existing.lang !== lang || Date.now() - existing.fetchedAt > META_TTL) {
					indexMeta(index, await client.details(t.kind, id, lang));
					fetched++;
					changed = true;
				}
			} catch (err) {
				const status = err.status;
				if (status === 401) throw err;
				if (status && status !== 404) return {
					searched,
					fetched
				};
			}
		}
		await opts.onBatch?.(index, changed);
	}
	return {
		searched,
		fetched
	};
}
//#endregion
//#region src/core/node.ts
/** Version of the Node core API (bump on breaking changes). */
var CORE_NODE_VERSION = "1.0.0";
var CARD_MAX_ALT_TITLES = 12;
var CARD_MAX_OVERVIEW = 280;
function clip(text, max) {
	if (!text) return void 0;
	if (text.length <= max) return text;
	const cut = text.slice(0, max - 1);
	const space = cut.lastIndexOf(" ");
	return (space > max * .6 ? cut.slice(0, space) : cut).trimEnd() + "…";
}
/** Title → TitleCard (undefined fields are dropped, so the JSON stays compact). */
function toTitleCard(t) {
	const card = {
		id: t.id,
		kind: t.kind,
		title: t.title,
		originalTitle: t.originalTitle,
		altTitles: t.altTitles.slice(0, 12),
		year: t.year,
		overview: clip(t.overview, 280),
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
		seasonCount: t.kind === "series" && t.seasons ? t.seasons.length : void 0
	};
	for (const k of Object.keys(card)) if (card[k] === void 0) delete card[k];
	return card;
}
/** Channel → ChannelCard (variants replaced by their count). */
function toChannelCard(c) {
	const { variants, ...rest } = c;
	const card = {
		...rest,
		variantCount: variants.length
	};
	for (const k of Object.keys(card)) if (card[k] === void 0) delete card[k];
	return card;
}
/**
* Words (folded, lowercase) in a channel group that mark it as kids-friendly. Same rule as
* `isKidsChannel` in src/lib/stores/kids.svelte.ts (that file is a Svelte store and cannot be
* bundled here; keep both in sync).
*/
var KIDS_GROUP = /(^|[^\p{L}])(kids?|kinder(en)?|kind|jeugd|junior|family|familie|famille|familia|animati(e|on)|cartoons?|toons?|enfants?|jeunesse|ninos|infantil|bambini|cocuk)([^\p{L}]|$)/u;
function isKidsChannelGroup(group) {
	return KIDS_GROUP.test((group ?? "").normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase());
}
/**
* Merge lazily loaded episodes into a series title, exactly like the web catalog store's
* ensureSeasons(): existing seasons are kept and extended, languages/qualities recomputed and
* missing metadata filled from the series info.
*/
function mergeSeriesEpisodes(title, inputs, preferLang = "nl") {
	const info = {};
	const sources = [];
	for (const input of inputs) {
		for (const [k, v] of Object.entries(input.info ?? {})) if (v != null && v !== "" && info[k] == null) info[k] = v;
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
	return {
		...withSeasons(title, sources.length ? mergeSeasons(title.id, sources, preferLang, title.seasons) : title.seasons ?? []),
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
//#endregion
export { CARD_MAX_ALT_TITLES, CARD_MAX_OVERVIEW, CORE_NODE_VERSION, HttpError, M3UParser, SAMPLE_EXTRA_SOURCES, SAMPLE_SOURCE, SAMPLE_SOURCE_IDS, SAMPLE_SOURCE_NAMES, SearchIndex, TmdbClient, TmdbError, RateLimiter as TmdbRateLimiter, analyzeRaw, asArray, buildCatalog, buildChannels, categoryMap, createMasker, createXmltvCollector, displayTitleFor, emptyIndex, enrichTitles, featured, fold, foldText, genreCounts, genreSlug, groupEpg, groupVariantsByLanguage, indexMeta, isGzip, isKidsChannelGroup, isKidsSafe, isSampleSourceId, languageCounts, liveTsUrl, localizedTitle, looksLikeM3U, mapLiveStream, mapSeries, mapSeriesInfo, mapShortEpg, mapVodStream, mergeSeasons, mergeSeriesEpisodes, normalizeGenres, normalizeServerUrl, parseAccount, parseM3U, parseTitle, parseXmltvText, parseXmltvTime, pickVariant, popular, popularityScore, recent, recommend, redactSecrets, redactText, redactUrl, sampleCatalogs, secretsFromUrl, similarTitles, slugify, summarizeLanguages, tmdbLookupKey, tmdbMetaKey, toChannelCard, toTitleCard, tokenize, trending, urlHasSecrets, withSeasons, xmltvUrl };
