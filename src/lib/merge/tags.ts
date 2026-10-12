// Tag tables for IPTV title/category parsing: language codes and names, quality tags,
// release flags and modifier words. Everything is keyed by `compactToken()`:
// uppercase, diacritics stripped, only letters/digits/'+' kept ("WEB-DL" → "WEBDL").
import type { LangCode, Quality } from '#lib/types.ts';

export type Tag =
	| { k: 'lang'; lang: LangCode; risky: boolean }
	| { k: 'sub'; lang: LangCode; vo?: boolean }
	| { k: 'q'; q: Quality; risky?: boolean }
	| { k: 'flag'; f: string; risky?: boolean }
	| { k: 'multi' }
	| { k: 'dual' }
	| { k: 'multisub' }
	| { k: 'vo'; risky?: boolean }
	| { k: 'noise' }
	| { k: 'modsub' }
	| { k: 'moddub' }
	| { k: 'year'; y: number };

/** Short language codes (2–3 letters). "Risky" because they collide with words ("DE", "IT", "NO"). */
const LANG_CODES: Record<LangCode, string[]> = {
	nl: ['NL', 'NLD', 'NED', 'DUT', 'HOL', 'VL', 'BENL'],
	en: ['EN', 'ENG', 'UK', 'US', 'USA', 'GB'],
	de: ['DE', 'GER', 'DEU', 'GE'],
	fr: ['FR', 'FRE', 'FRA', 'VF', 'VFF', 'VFQ', 'VFI'],
	es: ['ES', 'SPA', 'ESP', 'LAT', 'CAST'],
	it: ['IT', 'ITA'],
	tr: ['TR', 'TUR', 'TRK'],
	ar: ['AR', 'ARA', 'ARB'],
	pl: ['PL', 'POL'],
	pt: ['PT', 'POR', 'PTBR', 'BR', 'PTPT'],
	ru: ['RU', 'RUS'],
	sv: ['SV', 'SE', 'SWE'],
	da: ['DA', 'DK', 'DAN'],
	no: ['NO', 'NOR'],
	fi: ['FI', 'FIN'],
	el: ['EL', 'GR', 'GRE', 'ELL'],
	ro: ['RO', 'ROU', 'ROM', 'RUM'],
	hi: ['HI', 'HIN'],
	ko: ['KO', 'KR', 'KOR'],
	ja: ['JA', 'JP', 'JAP', 'JPN'],
	zh: ['ZH', 'CN', 'CHI', 'CHN', 'ZHO']
};

/** Language and country names (safe: longer than 3 letters or non-Latin). */
const LANG_NAMES: Record<LangCode, string[]> = {
	nl: [
		'DUTCH',
		'NEDERLANDS',
		'NEDERLANDSE',
		'HOLLANDS',
		'VLAAMS',
		'FLEMISH',
		'NETHERLANDS',
		'NEDERLAND',
		'HOLLAND'
	],
	en: ['ENGLISH', 'ENGELS', 'ENGLAND', 'BRITISH', 'AMERICAN', 'ENGLISCH', 'ANGLAIS', 'INGLES'],
	de: ['GERMAN', 'DEUTSCH', 'DEUTSCHE', 'GERMANY', 'DEUTSCHLAND', 'DUITS', 'ALLEMAND', 'ALEMAN'],
	fr: ['FRENCH', 'FRANCAIS', 'FRANCAISE', 'FRANCE', 'FRANS', 'TRUEFRENCH', 'FRANZOSISCH'],
	es: ['SPANISH', 'ESPANOL', 'CASTELLANO', 'LATINO', 'SPAIN', 'ESPANA', 'SPAANS', 'MEXICO'],
	it: ['ITALIAN', 'ITALIANO', 'ITALIA', 'ITALY', 'ITALIAANS'],
	tr: ['TURKISH', 'TURKCE', 'TURKEY', 'TURKIYE', 'TURKS', 'TURK'],
	ar: ['ARABIC', 'ARABISCH', 'ARABE', 'ARAB', 'عربي', 'العربية', 'عربية', 'عرب'],
	pl: ['POLISH', 'POLSKI', 'POLSKA', 'POLAND', 'POOLS', 'LEKTOR', 'DUBBINGPL'],
	pt: ['PORTUGUESE', 'PORTUGUES', 'PORTUGAL', 'BRASIL', 'BRAZIL', 'BRAZILIAN', 'PORTUGEES'],
	ru: ['RUSSIAN', 'RUSSIA', 'RUSSISCH', 'РУССКИЙ'],
	sv: ['SWEDISH', 'SVENSKA', 'SWEDEN', 'SVERIGE', 'ZWEEDS'],
	da: ['DANISH', 'DANSK', 'DENMARK', 'DANMARK', 'DEENS'],
	no: ['NORWEGIAN', 'NORSK', 'NORWAY', 'NORGE', 'NOORS'],
	fi: ['FINNISH', 'SUOMI', 'FINLAND', 'FINS'],
	el: ['GREEK', 'GREECE', 'ELLINIKA', 'GRIEKS'],
	ro: ['ROMANIAN', 'ROMANA', 'ROMANIA', 'ROEMEENS'],
	hi: ['HINDI', 'INDIA', 'INDIAN', 'BOLLYWOOD'],
	ko: ['KOREAN', 'KOREA', 'KOREAANS'],
	ja: ['JAPANESE', 'JAPAN', 'JAPANS'],
	zh: ['CHINESE', 'CHINA', 'MANDARIN', 'CANTONESE', 'CHINEES']
};

/** Subtitle tags: one token meaning "subtitles in <lang>" (vo = original audio). */
const SUB_TAGS: Record<string, { lang: LangCode; vo?: boolean }> = {
	VOSTFR: { lang: 'fr', vo: true },
	VOSTF: { lang: 'fr', vo: true },
	SUBFRENCH: { lang: 'fr', vo: true },
	STFR: { lang: 'fr' },
	VOSE: { lang: 'es', vo: true },
	VOSI: { lang: 'it', vo: true },
	SUBITA: { lang: 'it', vo: true },
	NLSUB: { lang: 'nl' },
	NLSUBS: { lang: 'nl' },
	NLSUBBED: { lang: 'nl' },
	ENGSUB: { lang: 'en' },
	ENSUB: { lang: 'en' },
	ENGSUBS: { lang: 'en' },
	LEGENDADO: { lang: 'pt', vo: true },
	LEG: { lang: 'pt', vo: true },
	ALTYAZI: { lang: 'tr', vo: true },
	ALTYAZILI: { lang: 'tr', vo: true },
	NAPISY: { lang: 'pl', vo: true },
	PLSUB: { lang: 'pl', vo: true },
	DEUTSCHUT: { lang: 'de' }
};

/** Audio-language words that are not names (dubbing markers). */
const DUB_TAGS: Record<string, LangCode> = {
	DUBLADO: 'pt',
	DUBLAJ: 'tr',
	DUBBING: 'pl',
	MULTIDUB: 'en'
};

const QUALITY_TAGS: Record<string, Quality> = {
	'4K': '4K',
	UHD: '4K',
	'2160P': '4K',
	'4KUHD': '4K',
	UHD4K: '4K',
	ULTRAHD: '4K',
	FHD: 'FHD',
	FULLHD: 'FHD',
	'1080P': 'FHD',
	'1080I': 'FHD',
	HD: 'HD',
	'720P': 'HD',
	HDTV: 'HD',
	HDRIP: 'HD',
	SD: 'SD',
	'480P': 'SD',
	'576P': 'SD',
	'360P': 'SD',
	DVDRIP: 'SD',
	DVD: 'SD',
	LQ: 'SD'
};
/** Quality tags that look like words and need upper case in bare positions. */
const RISKY_QUALITY = new Set(['HD', 'SD', 'LQ', 'DVD']);

const FLAG_TAGS: Record<string, string> = {
	HEVC: 'HEVC',
	H265: 'HEVC',
	X265: 'HEVC',
	H264: 'H264',
	X264: 'H264',
	AVC: 'H264',
	AV1: 'AV1',
	HDR: 'HDR',
	HDR10: 'HDR',
	'HDR10+': 'HDR',
	HLG: 'HDR',
	DV: 'DV',
	DOVI: 'DV',
	DOLBYVISION: 'DV',
	BLURAY: 'BluRay',
	BDRIP: 'BluRay',
	BRRIP: 'BluRay',
	BD: 'BluRay',
	WEBDL: 'WEB-DL',
	WEBRIP: 'WEB-DL',
	WEB: 'WEB-DL',
	REMUX: 'REMUX',
	'3D': '3D',
	ATMOS: 'Atmos',
	DTS: 'DTS',
	DTSHD: 'DTS',
	TRUEHD: 'TrueHD',
	DD51: '5.1',
	'51': '5.1',
	'71': '7.1',
	AAC: 'AAC',
	AC3: 'AC3',
	EAC3: 'AC3',
	DDP: 'AC3',
	'10BIT': '10bit',
	'60FPS': '60fps',
	'50FPS': '50fps',
	IMAX: 'IMAX',
	EXTENDED: 'Extended',
	UNCUT: 'Uncut',
	UNRATED: 'Unrated',
	DIRECTORSCUT: "Director's Cut",
	REMASTERED: 'Remastered',
	THEATRICAL: 'Theatrical',
	CAM: 'CAM',
	HDCAM: 'CAM',
	HDTS: 'CAM',
	TELESYNC: 'CAM',
	BACKUP: 'Backup',
	RAW: 'Raw'
};
/** Flag tags that look like ordinary words. */
const RISKY_FLAGS = new Set([
	'WEB',
	'BD',
	'DV',
	'CAM',
	'RAW',
	'BACKUP',
	'UNCUT',
	'EXTENDED',
	'THEATRICAL',
	'AVC',
	'IMAX',
	'51',
	'71',
	'3D',
	'AAC',
	'DTS',
	'REMASTERED',
	'UNRATED'
]);

const NOISE = ['VOD', 'NEW', 'NIEUW', 'EDITION', 'VERSION', 'VERSIE', 'DL', 'RIP', 'HQ', 'TOP'];
const MOD_SUB = [
	'SUB',
	'SUBS',
	'SUBBED',
	'SUBTITLE',
	'SUBTITLES',
	'SUBTITLED',
	'ONDERTITELD',
	'ONDERTITELS',
	'ONDERTITELING',
	'OT',
	'UNTERTITEL',
	'SOUSTITRES',
	'SUBTITULADO',
	'SOTTOTITOLI'
];
const MOD_DUB = ['GESPROKEN', 'DUB', 'DUBBED', 'AUDIO', 'SPOKEN', 'SYNCHRO', 'SYNCHRONISIERT'];

export const TAGS = new Map<string, Tag>();
for (const [lang, codes] of Object.entries(LANG_CODES))
	for (const c of codes) TAGS.set(c, { k: 'lang', lang, risky: true });
for (const [lang, names] of Object.entries(LANG_NAMES))
	for (const n of names) TAGS.set(compactToken(n), { k: 'lang', lang, risky: false });
for (const [tok, lang] of Object.entries(DUB_TAGS))
	TAGS.set(tok, { k: 'lang', lang, risky: false });
for (const [tok, v] of Object.entries(SUB_TAGS)) TAGS.set(tok, { k: 'sub', ...v });
for (const [tok, q] of Object.entries(QUALITY_TAGS))
	TAGS.set(tok, { k: 'q', q, risky: RISKY_QUALITY.has(tok) });
for (const [tok, f] of Object.entries(FLAG_TAGS))
	TAGS.set(tok, { k: 'flag', f, risky: RISKY_FLAGS.has(tok) });
for (const tok of ['MULTI', 'MULTIAUDIO', 'MULTILANG', 'MULTILANGUAGE', 'MULTIDUB'])
	TAGS.set(tok, { k: 'multi' });
for (const tok of ['DUAL', 'DUALAUDIO', 'DUALAUDIOS']) TAGS.set(tok, { k: 'dual' });
for (const tok of ['MULTISUB', 'MULTISUBS', 'MULTISUBTITLES']) TAGS.set(tok, { k: 'multisub' });
TAGS.set('VO', { k: 'vo', risky: true });
TAGS.set('VOST', { k: 'vo' });
TAGS.set('ORIGINAL', { k: 'vo' });
for (const tok of NOISE) TAGS.set(tok, { k: 'noise' });
for (const tok of MOD_SUB) TAGS.set(tok, { k: 'modsub' });
for (const tok of MOD_DUB) TAGS.set(tok, { k: 'moddub' });

/** Uppercase, strip diacritics, keep only letters, digits and '+'. */
export function compactToken(s: string): string {
	return s
		.normalize('NFKD')
		.replace(/\p{M}/gu, '')
		.replace(/ı/g, 'i')
		.toUpperCase()
		.replace(/[^\p{L}\p{N}+]/gu, '');
}

export function lookupTag(token: string): Tag | undefined {
	return TAGS.get(compactToken(token));
}

/** True when the tag is only trustworthy as an upper-case token outside brackets. */
export function isRiskyTag(tag: Tag): boolean {
	return (
		((tag.k === 'lang' || tag.k === 'q' || tag.k === 'flag' || tag.k === 'vo') &&
			'risky' in tag &&
			tag.risky === true) ||
		tag.k === 'modsub' ||
		tag.k === 'moddub' ||
		tag.k === 'noise'
	);
}

/** All language codes this module can detect. */
export const DETECTABLE_LANGS: LangCode[] = Object.keys(LANG_CODES);
