// Small presentation helpers shared by components and pages.
import type { LangCode, Quality, Title, TitleCard } from '#lib/types.ts';
import { qualityRank } from '#lib/lang.ts';
import { i18n, t } from '#lib/i18n/index.svelte.ts';

/** Plural-aware translate: uses `${key}.one` for n === 1, otherwise `${key}.other`. */
export function tn(key: string, n: number, params: Record<string, string | number> = {}): string {
	return t(`${key}.${n === 1 ? 'one' : 'other'}`, { n, ...params });
}

/** "1 u 52 min" / "1h 52m". */
export function formatRuntime(min: number | undefined): string {
	if (!min || min <= 0) return '';
	const h = Math.floor(min / 60);
	const m = Math.round(min % 60);
	if (h === 0) return t('ui.minutes', { m });
	if (m === 0) return t('ui.hours', { h });
	return t('ui.hoursMinutes', { h, m });
}

/** Remaining time for a progress entry, e.g. "Nog 34 min". */
export function formatRemaining(positionSec: number, durationSec: number): string {
	const left = Math.max(0, Math.round((durationSec - positionSec) / 60));
	if (!durationSec) return '';
	return left <= 1 ? t('ui.almostDone') : t('ui.remaining', { time: formatRuntime(left) });
}

export function formatDate(iso: string | undefined): string {
	if (!iso) return '';
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return iso;
	return new Intl.DateTimeFormat(i18n.locale === 'nl' ? 'nl-NL' : 'en-GB', {
		day: 'numeric',
		month: 'long',
		year: 'numeric'
	}).format(d);
}

export function formatClock(epochMs: number): string {
	return new Intl.DateTimeFormat(i18n.locale === 'nl' ? 'nl-NL' : 'en-GB', {
		hour: '2-digit',
		minute: '2-digit'
	}).format(epochMs);
}

/** Languages without 'und', primary order preserved. */
export function knownLangs(langs: LangCode[]): LangCode[] {
	return langs.filter((l) => l && l !== 'und');
}

/** Compact language summary: "NL EN DE +3". */
export function langSummary(langs: LangCode[], max = 3): { shown: string[]; more: number } {
	const known = knownLangs(langs);
	return { shown: known.slice(0, max).map((l) => l.toUpperCase()), more: known.length - max };
}

/** Best quality of a list ('4K' beats 'FHD'...). Undefined when only 'unknown'. */
export function bestQuality(qualities: Quality[]): Quality | undefined {
	const best = [...qualities].sort((a, b) => qualityRank(a) - qualityRank(b))[0];
	return best && best !== 'unknown' ? best : undefined;
}

/** Order languages so the profile's preferred ones come first. */
export function sortLangsByPreference(langs: LangCode[], preferred: LangCode[]): LangCode[] {
	const rank = (l: LangCode) => {
		const i = preferred.indexOf(l);
		return i === -1 ? 100 : i;
	};
	return [...langs].sort((a, b) => rank(a) - rank(b));
}

/** "2023 · 1 u 52 min · Sci-fi" style meta parts for a title. */
export function titleMeta(title: TitleCard | Title, opts: { genres?: number } = {}): string[] {
	const parts: string[] = [];
	if (title.year) parts.push(String(title.year));
	if (title.kind === 'movie') {
		const rt = formatRuntime(title.runtimeMin);
		if (rt) parts.push(rt);
	} else if ('seasons' in title && title.seasons?.length) {
		parts.push(tn('ui.seasons', title.seasons.length));
	} else if ('seasonCount' in title && title.seasonCount) {
		parts.push(tn('ui.seasons', title.seasonCount));
	} else {
		parts.push(t('common.series'));
	}
	parts.push(...title.genres.slice(0, opts.genres ?? 1));
	return parts;
}

export function initials(name: string): string {
	const parts = name.trim().split(/\s+/).filter(Boolean);
	if (parts.length === 0) return '?';
	const first = parts[0][0] ?? '';
	const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : '';
	return (first + last).toUpperCase();
}
