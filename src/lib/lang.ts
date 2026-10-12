import type { LangCode, Quality } from './types';

/** Display names in Dutch and English, keyed by ISO 639-1. */
const NAMES: Record<LangCode, { nl: string; en: string; native: string }> = {
	nl: { nl: 'Nederlands', en: 'Dutch', native: 'Nederlands' },
	en: { nl: 'Engels', en: 'English', native: 'English' },
	de: { nl: 'Duits', en: 'German', native: 'Deutsch' },
	fr: { nl: 'Frans', en: 'French', native: 'Français' },
	es: { nl: 'Spaans', en: 'Spanish', native: 'Español' },
	it: { nl: 'Italiaans', en: 'Italian', native: 'Italiano' },
	tr: { nl: 'Turks', en: 'Turkish', native: 'Türkçe' },
	ar: { nl: 'Arabisch', en: 'Arabic', native: 'العربية' },
	pl: { nl: 'Pools', en: 'Polish', native: 'Polski' },
	pt: { nl: 'Portugees', en: 'Portuguese', native: 'Português' },
	ru: { nl: 'Russisch', en: 'Russian', native: 'Русский' },
	ja: { nl: 'Japans', en: 'Japanese', native: '日本語' },
	ko: { nl: 'Koreaans', en: 'Korean', native: '한국어' },
	zh: { nl: 'Chinees', en: 'Chinese', native: '中文' },
	hi: { nl: 'Hindi', en: 'Hindi', native: 'हिन्दी' },
	sv: { nl: 'Zweeds', en: 'Swedish', native: 'Svenska' },
	da: { nl: 'Deens', en: 'Danish', native: 'Dansk' },
	no: { nl: 'Noors', en: 'Norwegian', native: 'Norsk' },
	fi: { nl: 'Fins', en: 'Finnish', native: 'Suomi' },
	el: { nl: 'Grieks', en: 'Greek', native: 'Ελληνικά' },
	ro: { nl: 'Roemeens', en: 'Romanian', native: 'Română' },
	und: { nl: 'Onbekend', en: 'Unknown', native: '—' }
};

export const KNOWN_LANGS = Object.keys(NAMES).filter((c) => c !== 'und');

export function languageName(code: LangCode, ui: 'nl' | 'en' = 'nl'): string {
	return NAMES[code]?.[ui] ?? code.toUpperCase();
}

export function nativeLanguageName(code: LangCode): string {
	return NAMES[code]?.native ?? code.toUpperCase();
}

export const QUALITY_ORDER: Quality[] = ['4K', 'FHD', 'HD', 'SD', 'unknown'];

export function qualityRank(q: Quality): number {
	const i = QUALITY_ORDER.indexOf(q);
	return i === -1 ? QUALITY_ORDER.length : i;
}
