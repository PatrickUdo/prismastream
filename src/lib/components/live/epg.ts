// EPG helpers for the live TV browser and the programme guide. Pure functions only (no stores,
// no Svelte), so they are cheap to call per row and easy to test.
import type { Channel, EpgProgramme, LangCode, StreamVariant } from '#lib/types.ts';
import { qualityRank } from '#lib/lang.ts';

export const MINUTE = 60_000;
export const HALF_HOUR = 30 * MINUTE;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

export type EpgMap = Record<string, EpgProgramme[]>;
/** Either the catalog's EPG map or a lookup function (e.g. catalog EPG plus short EPG). */
export type EpgSource = EpgMap | ((channel: Channel) => readonly EpgProgramme[]);
export type UiLocale = 'nl' | 'en';

const NONE: readonly EpgProgramme[] = Object.freeze([]);

/** Programmes of a channel (sorted by start), or an empty list. */
export function programmesOf(channel: Channel, epg: EpgSource): readonly EpgProgramme[] {
	if (typeof epg === 'function') return epg(channel);
	return (channel.epgId && epg[channel.epgId]) || NONE;
}

/** Index of the first programme that ends after `t` (list sorted by start). */
export function firstEndingAfter(list: readonly EpgProgramme[], t: number): number {
	let lo = 0;
	let hi = list.length;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (list[mid].stop > t) hi = mid;
		else lo = mid + 1;
	}
	return lo;
}

/** Programmes that overlap the window [from, to). */
export function programmesInWindow(
	list: readonly EpgProgramme[],
	from: number,
	to: number
): EpgProgramme[] {
	const out: EpgProgramme[] = [];
	for (let i = firstEndingAfter(list, from); i < list.length && list[i].start < to; i++)
		out.push(list[i]);
	return out;
}

/** The programme running at `at`. */
export function programmeAt(list: readonly EpgProgramme[], at: number): EpgProgramme | undefined {
	const p = list[firstEndingAfter(list, at)];
	return p && p.start <= at ? p : undefined;
}

/** Current and next programme at `at`. */
export function nowNext(
	list: readonly EpgProgramme[],
	at: number
): { now?: EpgProgramme; next?: EpgProgramme } {
	const i = firstEndingAfter(list, at);
	const p = list[i];
	if (!p) return {};
	if (p.start <= at) return { now: p, next: list[i + 1] };
	return { next: p };
}

/** Progress (0..1) of a programme at `at`. */
export function progressAt(p: { start: number; stop: number }, at: number): number {
	if (p.stop <= p.start) return at >= p.stop ? 1 : 0;
	return Math.min(1, Math.max(0, (at - p.start) / (p.stop - p.start)));
}

export function isLiveAt(p: { start: number; stop: number }, at: number): boolean {
	return p.start <= at && at < p.stop;
}

/** Minutes left until `p.stop` (rounded up, never negative). */
export function minutesLeft(p: { stop: number }, at: number): number {
	return Math.max(0, Math.ceil((p.stop - at) / MINUTE));
}

// ---------------------------------------------------------------------------
// Guide slots: programmes plus "no information" fillers
// ---------------------------------------------------------------------------

export interface GuideSlot {
	/** Stable key: `p<start>` for programmes, `g<pieceStart>` for gaps (independent of the window). */
	key: string;
	start: number;
	stop: number;
	/** Undefined for a gap ("Geen programma-informatie"). */
	programme?: EpgProgramme;
}

export interface FillOptions {
	/** Gaps are cut into pieces at multiples of this (epoch-aligned), so long gaps stay navigable. */
	split?: number;
	/** Holes shorter than this between two programmes are not filled. */
	minGap?: number;
}

function pushGap(
	out: GuideSlot[],
	gapStart: number,
	gapEnd: number,
	from: number,
	to: number,
	split: number
) {
	let s = Math.max(gapStart, from);
	const end = Math.min(gapEnd, to);
	while (end > s) {
		const boundary = Math.floor(s / split) * split;
		const pieceStart = Math.max(gapStart, boundary);
		const pieceEnd = Math.min(gapEnd, boundary + split);
		out.push({
			key: `g${pieceStart}`,
			start: Math.max(pieceStart, from),
			stop: Math.min(pieceEnd, to)
		});
		s = pieceEnd;
	}
}

/**
 * Slots covering [from, to): every programme in the window plus filler slots where the guide
 * has no information. Programme slots keep their real start/stop (the renderer clips them);
 * gap slots are clipped to the window. Keys do not depend on the window, so the same slot keeps
 * its identity (and focus) while the guide scrolls.
 */
export function fillGaps(
	list: readonly EpgProgramme[],
	from: number,
	to: number,
	opts: FillOptions = {}
): GuideSlot[] {
	const split = opts.split ?? 2 * HOUR;
	const minGap = opts.minGap ?? MINUTE;
	const out: GuideSlot[] = [];
	if (to <= from) return out;
	const i0 = firstEndingAfter(list, from);
	let prevStop = i0 > 0 ? list[i0 - 1].stop : -Infinity;
	let i = i0;
	for (; i < list.length && list[i].start < to; i++) {
		const p = list[i];
		if (p.stop <= prevStop) continue; // fully overlapped by the previous programme
		if (p.start > prevStop && (prevStop === -Infinity || p.start - prevStop >= minGap))
			pushGap(out, prevStop, p.start, from, to, split);
		out.push({
			key: `p${p.start}`,
			start: Math.max(p.start, prevStop),
			stop: p.stop,
			programme: p
		});
		prevStop = p.stop;
	}
	if (to > prevStop) {
		const next = i < list.length ? list[i].start : Infinity;
		if (next === Infinity || prevStop === -Infinity || next - prevStop >= minGap)
			pushGap(out, prevStop, next, from, to, split);
	}
	return out;
}

/** Index of the slot containing `t`; otherwise the first slot after it, otherwise the last. */
export function slotIndexAt(slots: readonly GuideSlot[], t: number): number {
	if (!slots.length) return -1;
	for (let i = 0; i < slots.length; i++) if (slots[i].stop > t) return i;
	return slots.length - 1;
}

// ---------------------------------------------------------------------------
// Time: alignment, ranges and labels
// ---------------------------------------------------------------------------

/** Floor to the local half hour (xx:00 or xx:30). */
export function floorHalfHour(t: number): number {
	const d = new Date(t);
	d.setMinutes(d.getMinutes() < 30 ? 0 : 30, 0, 0);
	return d.getTime();
}

/** Ceil to the local half hour. */
export function ceilHalfHour(t: number): number {
	const f = floorHalfHour(t);
	return f === t ? t : floorHalfHour(t + HALF_HOUR);
}

/** Local half-hour marks within [from, to]. */
export function halfHourTicks(from: number, to: number): number[] {
	const out: number[] = [];
	for (let t = ceilHalfHour(from); t <= to; t = floorHalfHour(t + HALF_HOUR + MINUTE)) out.push(t);
	return out;
}

/** Local midnight of the day containing `t`. */
export function startOfDay(t: number): number {
	const d = new Date(t);
	d.setHours(0, 0, 0, 0);
	return d.getTime();
}

/** Same local wall-clock time `n` days later (DST-safe). */
export function addDays(t: number, n: number): number {
	const d = new Date(t);
	d.setDate(d.getDate() + n);
	return d.getTime();
}

/** Earliest start and latest stop over the given programme lists. */
export function epgBounds(
	lists: Iterable<readonly EpgProgramme[]>
): { start: number; stop: number } | null {
	let start = Infinity;
	let stop = -Infinity;
	for (const list of lists) {
		if (!list.length) continue;
		start = Math.min(start, list[0].start);
		stop = Math.max(stop, list[list.length - 1].stop);
	}
	return start < stop ? { start, stop } : null;
}

export interface RangeOptions {
	/** Minimum history before now. */
	before?: number;
	/** Minimum future after now. */
	after?: number;
	/** Hard limits around now. */
	maxBack?: number;
	maxAhead?: number;
}

/** Timeline range of the guide: the available EPG, at least around now, aligned to half hours. */
export function guideRange(
	bounds: { start: number; stop: number } | null,
	now: number,
	opts: RangeOptions = {}
): { from: number; to: number } {
	const before = opts.before ?? 2 * HOUR;
	const after = opts.after ?? 6 * HOUR;
	const maxBack = opts.maxBack ?? DAY;
	const maxAhead = opts.maxAhead ?? 7 * DAY;
	const from = Math.max(Math.min(bounds?.start ?? now, now - before), now - maxBack);
	const to = Math.min(Math.max(bounds?.stop ?? now, now + after), now + maxAhead);
	return { from: floorHalfHour(from), to: ceilHalfHour(to) };
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function dtf(locale: UiLocale, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
	const key = locale + JSON.stringify(opts);
	let f = formatters.get(key);
	if (!f) {
		f = new Intl.DateTimeFormat(locale === 'nl' ? 'nl-NL' : 'en-GB', opts);
		formatters.set(key, f);
	}
	return f;
}

/** "21:30" (24-hour clock in both languages, like the rest of the app). */
export function formatTime(t: number, locale: UiLocale = 'nl'): string {
	return dtf(locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(t);
}

/** "20:00 – 21:30" */
export function formatTimeRange(start: number, stop: number, locale: UiLocale = 'nl'): string {
	return `${formatTime(start, locale)} – ${formatTime(stop, locale)}`;
}

function capitalize(s: string): string {
	return s.charAt(0).toLocaleUpperCase() + s.slice(1);
}

/** "Vandaag" / "Morgen" / "Gisteren", otherwise "Za 10 okt" ("Sat 10 Oct"). */
export function formatDay(t: number, now: number, locale: UiLocale = 'nl'): string {
	const diff = Math.round((startOfDay(t) - startOfDay(now)) / DAY);
	if (Math.abs(diff) <= 1) {
		const rtf = new Intl.RelativeTimeFormat(locale === 'nl' ? 'nl-NL' : 'en-GB', {
			numeric: 'auto'
		});
		return capitalize(rtf.format(diff, 'day'));
	}
	return capitalize(dtf(locale, { weekday: 'short', day: 'numeric', month: 'short' }).format(t));
}

// ---------------------------------------------------------------------------
// Search and filters
// ---------------------------------------------------------------------------

/** Lowercase, without diacritics and with collapsed whitespace. */
export function fold(s: string): string {
	return s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Every word of the query occurs in one of the (already folded) fields. */
export function matchesQuery(fields: readonly string[], query: string): boolean {
	const words = fold(query).split(' ').filter(Boolean);
	if (!words.length) return true;
	const hay = fields.join('\n');
	return words.every((w) => hay.includes(w));
}

/**
 * Channels whose name, number or current programme matches the query
 * (case- and diacritic-insensitive).
 */
export function filterChannels(
	channels: readonly Channel[],
	query: string,
	epg: EpgSource,
	at: number
): Channel[] {
	if (!fold(query)) return [...channels];
	return channels.filter((c) => {
		const now = programmeAt(programmesOf(c, epg), at);
		const fields = [fold(c.name)];
		if (c.number != null) fields.push(String(c.number));
		if (now) fields.push(fold(now.title));
		return matchesQuery(fields, query);
	});
}

export interface ProgrammeHit {
	channel: Channel;
	programme: EpgProgramme;
}

/** Programmes in [from, to) whose title or category matches the query, by start time. */
export function searchProgrammes(
	channels: readonly Channel[],
	epg: EpgSource,
	query: string,
	from: number,
	to: number,
	limit = 50
): ProgrammeHit[] {
	if (!fold(query)) return [];
	const hits: ProgrammeHit[] = [];
	for (const channel of channels)
		for (const programme of programmesInWindow(programmesOf(channel, epg), from, to)) {
			const fields = [fold(programme.title)];
			if (programme.category) fields.push(fold(programme.category));
			if (matchesQuery(fields, query)) hits.push({ channel, programme });
		}
	return hits.sort((a, b) => a.programme.start - b.programme.start).slice(0, limit);
}

/** Channel groups with counts, in order of first appearance. */
export function groupCounts(channels: readonly Channel[]): { group: string; count: number }[] {
	const counts = new Map<string, number>();
	for (const c of channels) if (c.group) counts.set(c.group, (counts.get(c.group) ?? 0) + 1);
	return [...counts].map(([group, count]) => ({ group, count }));
}

/** Known languages with channel counts, most common first. */
export function languageCounts(channels: readonly Channel[]): { lang: LangCode; count: number }[] {
	const counts = new Map<LangCode, number>();
	for (const c of channels)
		for (const l of new Set(c.languages))
			if (l && l !== 'und') counts.set(l, (counts.get(l) ?? 0) + 1);
	return [...counts]
		.map(([lang, count]) => ({ lang, count }))
		.sort((a, b) => b.count - a.count || a.lang.localeCompare(b.lang));
}

// ---------------------------------------------------------------------------
// Variants (merged channels)
// ---------------------------------------------------------------------------

export interface VariantGroup {
	lang: LangCode;
	variants: StreamVariant[];
}

/** Variants grouped by primary audio language (preferred languages first), best quality first. */
export function groupVariantsByLanguage(
	variants: readonly StreamVariant[],
	preferred: readonly LangCode[] = []
): VariantGroup[] {
	const groups = new Map<LangCode, StreamVariant[]>();
	for (const v of variants) {
		const lang = v.audioLangs.find((l) => l && l !== 'und') ?? 'und';
		const list = groups.get(lang);
		if (list) list.push(v);
		else groups.set(lang, [v]);
	}
	const order = [...groups.keys()];
	const rank = (l: LangCode) => {
		if (l === 'und') return 1000;
		const i = preferred.indexOf(l);
		return i === -1 ? 100 + order.indexOf(l) : i;
	};
	return order
		.sort((a, b) => rank(a) - rank(b))
		.map((lang) => ({
			lang,
			variants: [...(groups.get(lang) ?? [])].sort(
				(a, b) => qualityRank(a.quality) - qualityRank(b.quality)
			)
		}));
}

/** Number of distinct sources a channel is available from. */
export function sourceCount(channel: Pick<Channel, 'variants'>): number {
	return new Set(channel.variants.map((v) => v.sourceId)).size;
}

// ---------------------------------------------------------------------------
// Virtualisation
// ---------------------------------------------------------------------------

/** Rows [start, end) to render for a vertical scroll position, with overscan. */
export function visibleRows(
	scrollTop: number,
	viewportHeight: number,
	rowHeight: number,
	total: number,
	overscan = 4
): { start: number; end: number } {
	if (total <= 0 || rowHeight <= 0) return { start: 0, end: 0 };
	const first = Math.floor(Math.max(0, scrollTop) / rowHeight);
	const last = Math.ceil((Math.max(0, scrollTop) + Math.max(0, viewportHeight)) / rowHeight);
	return {
		start: Math.max(0, Math.min(total, first - overscan)),
		end: Math.max(0, Math.min(total, last + overscan))
	};
}
