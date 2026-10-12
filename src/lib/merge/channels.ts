// Live channels: merged on tvg-id and/or normalised name (+ language). Quality suffixes
// ("HD", "FHD", "4K", "ᴴᴰ") are stripped from the name; time-shift suffixes ("+1", "+24") are
// NOT, because "Prisma 1 +1" is a different channel than "Prisma 1".
import type {
	Channel,
	EpgProgramme,
	LangCode,
	RawCatalog,
	RawChannel,
	StreamVariant
} from '#lib/types.ts';
import { qualityRank } from '#lib/lang.ts';
import { foldText, parseCategory, parseTitle, slugify } from './normalize.ts';

/** Live variant with fallback urls (e.g. the .ts variant of an Xtream .m3u8 stream). */
export type LiveStreamVariant = StreamVariant & { altUrls?: string[] };

function extOf(url: string): string | undefined {
	const m = /\.([a-z0-9]{2,4})(?:[?#]|$)/i.exec(url);
	return m ? m[1].toLowerCase() : undefined;
}

export interface ParsedChannelName {
	name: string;
	key: string;
	langs: LangCode[];
	quality: ReturnType<typeof parseTitle>['quality'];
	/** Time-shift in hours ("+1" → 1), 0 for the live feed. */
	timeshift: number;
}

const TIMESHIFT = /\+\s*(\d{1,2})\b/;

export function parseChannelName(rawName: string): ParsedChannelName {
	const p = parseTitle(rawName, { year: false, episode: false, keepLangNames: true });
	const name = p.cleanTitle.replace(/\s+\+\s*(\d)/, ' +$1');
	const ts = TIMESHIFT.exec(name);
	const key = foldText(name.replace(/\+\s*(\d{1,2})\b/g, ' plus$1 '));
	return {
		name,
		key,
		langs: p.langs,
		quality: p.quality,
		timeshift: ts ? Number(ts[1]) : 0
	};
}

interface ChanEntry {
	raw: RawChannel;
	parsed: ParsedChannelName;
	lang: LangCode;
	group: string;
}

function mostCommon<T>(values: T[]): T | undefined {
	const counts = new Map<T, number>();
	let best: T | undefined;
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

function isAllCaps(s: string): boolean {
	return !/\p{Ll}/u.test(s) && /\p{Lu}/u.test(s);
}

export function buildChannels(
	raws: RawCatalog[],
	epg: Record<string, EpgProgramme[]>,
	sourceLangs: Record<string, LangCode> = {}
): Channel[] {
	const entries: ChanEntry[] = [];
	for (const raw of raws) {
		for (const ch of raw.channels ?? []) {
			const parsed = parseChannelName(ch.rawName || ch.tvgName || '');
			const cat = parseCategory(ch.group);
			const lang =
				parsed.langs[0] ??
				(ch.langHint && ch.langHint !== 'und' ? ch.langHint : undefined) ??
				cat.langs[0] ??
				sourceLangs[ch.sourceId] ??
				'und';
			if (parsed.quality === 'unknown' && cat.quality !== 'unknown') parsed.quality = cat.quality;
			entries.push({ raw: ch, parsed, lang, group: cat.label });
		}
	}

	// Union-find over entries.
	const parent = entries.map((_, i) => i);
	const shift = entries.map((e) => e.parsed.timeshift);
	const find = (i: number): number => {
		while (parent[i] !== i) {
			parent[i] = parent[parent[i]];
			i = parent[i];
		}
		return i;
	};
	const union = (a: number, b: number) => {
		const ra = find(a);
		const rb = find(b);
		if (ra === rb || shift[ra] !== shift[rb]) return;
		parent[rb] = ra;
	};
	const byTvg = new Map<string, number>();
	const byName = new Map<string, number>();
	entries.forEach((e, i) => {
		const tvg = e.raw.tvgId?.trim().toLowerCase();
		if (tvg) {
			const j = byTvg.get(`${tvg}|${e.parsed.timeshift}`);
			if (j === undefined) byTvg.set(`${tvg}|${e.parsed.timeshift}`, i);
			else union(j, i);
		}
		if (e.parsed.key) {
			const nk = `${e.lang}|${e.parsed.key}`;
			const j = byName.get(nk);
			if (j === undefined) byName.set(nk, i);
			else union(j, i);
		}
	});

	const groups = new Map<number, ChanEntry[]>();
	entries.forEach((e, i) => {
		const r = find(i);
		const g = groups.get(r);
		if (g) g.push(e);
		else groups.set(r, [e]);
	});

	const liveTvg = new Set(
		entries
			.filter((e) => e.parsed.timeshift === 0 && e.raw.tvgId)
			.map((e) => e.raw.tvgId!.trim().toLowerCase())
	);
	const epgLower = new Map<string, string>();
	for (const id of Object.keys(epg)) epgLower.set(id.toLowerCase(), id);

	const usedIds = new Set<string>();
	const channels: Channel[] = [];
	for (const members of groups.values()) {
		const names = members.map((m) => m.parsed.name);
		const name = mostCommon(names.filter((n) => !isAllCaps(n))) ?? mostCommon(names) ?? '';
		const lang = mostCommon(members.map((m) => m.lang).filter((l) => l !== 'und')) ?? 'und';
		const key = mostCommon(members.map((m) => m.parsed.key)) ?? foldText(name);
		let id = `ch-${slugify(key || name)}${lang !== 'und' ? '-' + lang : ''}`;
		if (usedIds.has(id)) {
			let n = 2;
			while (usedIds.has(`${id}-${n}`)) n++;
			id = `${id}-${n}`;
		}
		usedIds.add(id);

		// EPG id: the most common tvg-id that has programmes (then the one with most programmes).
		// A "+1" feed never takes a tvg-id that also belongs to a live (non-shifted) feed.
		let tvgIds = members.map((m) => m.raw.tvgId?.trim()).filter((t): t is string => !!t);
		if (members[0].parsed.timeshift > 0) {
			const own = tvgIds.filter((t) => !liveTvg.has(t.toLowerCase()));
			if (own.length) tvgIds = own;
		}
		const tvgCount = new Map<string, number>();
		for (const t of tvgIds) tvgCount.set(t, (tvgCount.get(t) ?? 0) + 1);
		let epgId: string | undefined;
		let bestRank = [-1, -1];
		for (const [t, count] of tvgCount) {
			const actual = epg[t] ? t : epgLower.get(t.toLowerCase());
			if (!actual) continue;
			const rank = [count, epg[actual].length];
			if (rank[0] > bestRank[0] || (rank[0] === bestRank[0] && rank[1] > bestRank[1])) {
				bestRank = rank;
				epgId = actual;
			}
		}
		epgId ??= mostCommon(tvgIds);

		const variants: LiveStreamVariant[] = [];
		const seen = new Set<string>();
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
				...(m.raw.altUrls?.length ? { altUrls: [...m.raw.altUrls] } : {})
			});
		}
		variants.sort((a, b) => qualityRank(a.quality) - qualityRank(b.quality));

		const numbers = members.map((m) => m.raw.number).filter((n): n is number => n != null);
		const languages = [...new Set(variants.flatMap((v) => v.audioLangs))];
		channels.push({
			id,
			name,
			logoUrl: members.find((m) => m.raw.logoUrl)?.raw.logoUrl,
			group: mostCommon(members.map((m) => m.group).filter(Boolean)) ?? 'Overig',
			number: numbers.length ? Math.min(...numbers) : undefined,
			epgId,
			languages: languages.length > 1 ? languages.filter((l) => l !== 'und') : languages,
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
export function groupEpg(raws: RawCatalog[]): Record<string, EpgProgramme[]> {
	const out: Record<string, EpgProgramme[]> = {};
	const seen = new Map<string, Set<string>>();
	for (const raw of raws) {
		for (const p of raw.epg ?? []) {
			if (!p.channelId || !(p.stop > p.start)) continue;
			let s = seen.get(p.channelId);
			if (!s) {
				s = new Set();
				seen.set(p.channelId, s);
				out[p.channelId] = [];
			}
			const k = `${p.start}|${p.title}`;
			if (s.has(k)) continue;
			s.add(k);
			out[p.channelId].push(p);
		}
	}
	for (const list of Object.values(out)) list.sort((a, b) => a.start - b.start);
	return out;
}
