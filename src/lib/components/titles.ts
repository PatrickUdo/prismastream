// Display title in the profile's language. A merged Title keeps every title it was seen
// under (altTitles, with language); the UI shows the one in the first UI or audio language
// of the active profile that exists, otherwise Title.title (English/original).
// The pure logic lives in #lib/merge/display.ts (shared with the Apple TV core).
import { displayTitleFor, type TitleLangPrefs, type TitleNames } from '#lib/merge/display.ts';
import { user } from '#lib/stores/user.svelte.ts';
import { i18n } from '#lib/i18n/index.svelte.ts';

export {
	displayTitleFor,
	localizedTitle,
	secondaryTitles,
	titleLangs,
	type TitleLangPrefs,
	type TitleNames
} from '#lib/merge/display.ts';

/**
 * Display title for a profile (default: the active profile; reactive in components).
 * Example: "The Last Light" → "Het Laatste Licht" for a Dutch profile.
 */
export function displayTitle(
	title: TitleNames,
	profile: Partial<TitleLangPrefs> | null | undefined = user.active
): string {
	return displayTitleFor(title, profile, i18n.locale);
}
