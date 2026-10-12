// Display title in a profile's language, as pure functions (no stores), so the web UI and the
// Apple TV core share them. A merged Title keeps every title it was seen under (altTitles, with
// language); the UI shows the one in the first UI or audio language of the profile that exists,
// otherwise Title.title (English/original). `#lib/components/titles.ts` adds the store-aware
// `displayTitle` on top of this.
import type { LangCode, Profile, Title } from '#lib/types.ts';
import { foldText } from '#lib/merge/normalize.ts';

/** The parts of a title needed to pick a display name (Title, or a poster source). */
export interface TitleNames {
	title: string;
	originalTitle?: string;
	altTitles?: Title['altTitles'];
}

export type TitleLangPrefs = Pick<Profile, 'uiLang' | 'audioLangs'>;

/** Languages to try, in order: UI language, then the audio languages (unique, no 'und'). */
export function titleLangs(
	prefs: Partial<TitleLangPrefs> | undefined,
	locale?: LangCode
): LangCode[] {
	const out: LangCode[] = [];
	for (const l of [prefs?.uiLang ?? locale, ...(prefs?.audioLangs ?? [])])
		if (l && l !== 'und' && !out.includes(l)) out.push(l);
	return out;
}

const isAllCaps = (s: string) => s === s.toUpperCase() && s !== s.toLowerCase();

/**
 * Title in the first language of `langs` that has an alternative title, else `title.title`.
 * Several titles in one language (e.g. a dubbed version that kept the English name): a
 * localised one (differs from the main/original title) wins, then one that is not ALL CAPS.
 */
export function localizedTitle(title: TitleNames, langs: readonly LangCode[]): string {
	const alts = title.altTitles ?? [];
	if (!alts.length) return title.title;
	const main = new Set([title.title, title.originalTitle].filter(Boolean).map((s) => foldText(s!)));
	for (const lang of langs) {
		const hits = alts.filter((a) => a.lang === lang && a.title.trim());
		if (!hits.length) continue;
		if (hits.length === 1) return hits[0].title;
		// The main title itself is in this language: keep it.
		if (hits.some((h) => h.title === title.title)) return title.title;
		const rank = (s: string) => (main.has(foldText(s)) ? 2 : 0) + (isAllCaps(s) ? 1 : 0);
		return [...hits].sort((a, b) => rank(a.title) - rank(b.title))[0].title;
	}
	return title.title;
}

/**
 * Secondary titles for a detail page: the original title and the main (usually English)
 * title, when they differ from what is displayed. `original` is true when the first entry
 * is the original title.
 */
export function secondaryTitles(
	title: TitleNames,
	shown: string
): { titles: string[]; original: boolean } {
	const seen = new Set([foldText(shown)]);
	const titles: string[] = [];
	let original = false;
	for (const [s, isOriginal] of [
		[title.originalTitle, true],
		[title.title, false]
	] as const) {
		if (!s || seen.has(foldText(s))) continue;
		seen.add(foldText(s));
		if (isOriginal) original = true;
		titles.push(s);
	}
	return { titles, original };
}

/**
 * Display title for explicit preferences (no store access).
 * Example: "The Last Light" → "Het Laatste Licht" for `{ uiLang: 'nl' }`.
 */
export function displayTitleFor(
	title: TitleNames,
	prefs: Partial<TitleLangPrefs> | null | undefined,
	locale?: LangCode
): string {
	return localizedTitle(title, titleLangs(prefs ?? undefined, locale));
}
