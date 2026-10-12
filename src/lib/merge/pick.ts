// Variant choice for a profile: first preferred audio language that is available, then the
// fallbacks (original language → English → anything), then quality, then the source that last
// played fine. Also small helpers the detail page and player use to present versions.
import type { LangCode, StreamVariant, Title } from '#lib/types.ts';
import { qualityRank } from '#lib/lang.ts';

export interface LangPrefs {
	audioLangs: LangCode[];
	subtitleLangs: LangCode[];
	subtitlesOn: boolean;
}

/** Options for pickVariant; a Title can be passed directly (its originalLang is used). */
export interface PickOptions {
	/** Original language of the title (first fallback after the profile languages). */
	originalLang?: LangCode;
	/** Source that played fine most recently (tie-breaker). */
	lastGoodSourceId?: string;
	/** Sources that failed recently (pushed to the back). */
	failedSourceIds?: string[];
}

/** Language tier of a variant: 0..n-1 preferred, n original, n+1 English, n+2 known, n+3 unknown. */
function languageTier(v: StreamVariant, prefs: LangPrefs, opts: PickOptions): number {
	const pref = prefs.audioLangs;
	let best = Infinity;
	for (const l of v.audioLangs) {
		const i = pref.indexOf(l);
		if (i !== -1 && i < best) best = i;
	}
	if (best !== Infinity) return best;
	const n = pref.length;
	if (opts.originalLang && v.audioLangs.includes(opts.originalLang)) return n;
	if (v.audioLangs.includes('en')) return n + 1;
	if (v.audioLangs.some((l) => l !== 'und')) return n + 2;
	return n + 3;
}

function subtitleBonus(v: StreamVariant, prefs: LangPrefs): number {
	const wanted = prefs.subtitleLangs.length ? prefs.subtitleLangs : prefs.audioLangs;
	return v.subtitleLangs.some((l) => wanted.includes(l)) ? 0 : 1;
}

/** Best variant for the user's language preference (first preferred language available), then quality. */
export function pickVariant(
	variants: StreamVariant[],
	prefs: LangPrefs,
	opts: PickOptions = {}
): StreamVariant | undefined {
	if (!variants.length) return undefined;
	const failed = new Set(opts.failedSourceIds ?? []);
	let best: StreamVariant | undefined;
	let bestScore: number[] = [];
	for (const v of variants) {
		const tier = languageTier(v, prefs, opts);
		// Subtitles matter when the audio isn't the first choice, or when the user wants them.
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

function compare(a: number[], b: number[]): number {
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
	return 0;
}

export interface LanguageGroup {
	lang: LangCode;
	/** Variants with this audio language, best quality first. */
	variants: StreamVariant[];
}

/**
 * Group variants by audio language (a multi-audio variant appears in each of its languages).
 * Order: preferred languages, English, then by number of variants.
 */
export function groupVariantsByLanguage(
	variants: StreamVariant[],
	prefs?: Pick<LangPrefs, 'audioLangs'>
): LanguageGroup[] {
	const map = new Map<LangCode, StreamVariant[]>();
	for (const v of variants) {
		const langs = v.audioLangs.length ? v.audioLangs : ['und'];
		for (const l of langs) {
			const list = map.get(l);
			if (list) list.push(v);
			else map.set(l, [v]);
		}
	}
	const pref = prefs?.audioLangs ?? [];
	const rank = (l: LangCode) => {
		const i = pref.indexOf(l);
		if (i !== -1) return i;
		if (l === 'en') return pref.length;
		if (l === 'und') return pref.length + 2;
		return pref.length + 1;
	};
	return [...map.entries()]
		.map(([lang, list]) => ({
			lang,
			variants: [...list].sort((a, b) => qualityRank(a.quality) - qualityRank(b.quality))
		}))
		.sort(
			(a, b) =>
				rank(a.lang) - rank(b.lang) ||
				b.variants.length - a.variants.length ||
				a.lang.localeCompare(b.lang)
		);
}

/**
 * Subtitle language to switch on for a variant, or undefined for none.
 * On when the user wants subtitles, or when the audio is not in one of their languages.
 */
export function bestSubtitle(variant: StreamVariant, prefs: LangPrefs): LangCode | undefined {
	const understood = variant.audioLangs.some((l) => prefs.audioLangs.includes(l));
	if (!prefs.subtitlesOn && understood) return undefined;
	for (const l of prefs.subtitleLangs) if (variant.subtitleLangs.includes(l)) return l;
	if (!understood) {
		for (const l of prefs.audioLangs) if (variant.subtitleLangs.includes(l)) return l;
		if (variant.subtitleLangs.includes('en')) return 'en';
	}
	return undefined;
}

/**
 * Short language summary for cards and detail pages: "NL · EN · DE +4".
 * Preferred languages first, then English, then the rest in catalog order.
 */
export function summarizeLanguages(
	title: Pick<Title, 'languages'>,
	max = 3,
	prefs?: Pick<LangPrefs, 'audioLangs'>
): string {
	const langs = title.languages.filter((l) => l !== 'und');
	if (!langs.length) return '';
	const pref = prefs?.audioLangs ?? ['nl'];
	const ordered = [
		...pref.filter((l) => langs.includes(l)),
		...(langs.includes('en') && !pref.includes('en') ? ['en'] : []),
		...langs.filter((l) => !pref.includes(l) && l !== 'en')
	];
	const shown = ordered.slice(0, max).map((l) => l.toUpperCase());
	const rest = ordered.length - shown.length;
	return shown.join(' · ') + (rest > 0 ? ` +${rest}` : '');
}
