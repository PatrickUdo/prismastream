// Lightweight, explainable recommendations. Pure functions over the merged catalog and
// the active profile's data; cheap enough for catalogs with 10.000+ titles.
import type { HistoryEntry, MediaKind, ProfileData, Title } from '#lib/types.ts';

type Signals = Pick<ProfileData, 'favorites' | 'history' | 'progress'>;

const byPopularity = (a: Title, b: Title) => b.popularity - a.popularity;

/** Genre affinity from watch history (recency-weighted) and favorites. */
export function genreAffinity(
	titlesById: Map<string, Title>,
	favorites: string[],
	history: HistoryEntry[]
): Map<string, number> {
	const scores = new Map<string, number>();
	const add = (title: Title | undefined, weight: number) => {
		if (!title || title.genres.length === 0) return;
		const w = weight / Math.sqrt(title.genres.length);
		for (const g of title.genres) scores.set(g, (scores.get(g) ?? 0) + w);
	};
	const seen = new Set<string>();
	let i = 0;
	for (const h of history) {
		if (seen.has(h.titleId)) continue;
		seen.add(h.titleId);
		add(titlesById.get(h.titleId), Math.pow(0.94, i++));
	}
	for (const id of favorites) add(titlesById.get(id), 1.4);
	return scores;
}

/** Titles the profile has started or finished. */
export function watchedIds(signals: Signals): Set<string> {
	const ids = new Set<string>();
	for (const h of signals.history) ids.add(h.titleId);
	for (const p of Object.values(signals.progress)) ids.add(p.titleId);
	return ids;
}

/**
 * Recommended titles: genre affinity from history and favorites, blended with popularity.
 * Excludes watched titles and favorites. Falls back to popularity without signals.
 */
export function recommend(titles: Title[], signals: Signals, limit = 24): Title[] {
	const byId = new Map(titles.map((t) => [t.id, t]));
	const exclude = watchedIds(signals);
	for (const f of signals.favorites) exclude.add(f);
	const candidates = titles.filter((t) => !exclude.has(t.id));

	const affinity = genreAffinity(byId, signals.favorites, signals.history);
	if (affinity.size === 0) return [...candidates].sort(byPopularity).slice(0, limit);

	const max = Math.max(...affinity.values());
	const scored: { t: Title; s: number }[] = [];
	for (const t of candidates) {
		let a = 0;
		for (const g of t.genres) a += affinity.get(g) ?? 0;
		if (a > 0) scored.push({ t, s: a / max + 0.35 * (t.popularity / 100) });
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
export function similarTitles(title: Title, titles: Title[], limit = 18): Title[] {
	const genres = new Set(title.genres);
	if (genres.size === 0) return [];
	const scored: { t: Title; same: number; overlap: number }[] = [];
	for (const t of titles) {
		if (t.id === title.id) continue;
		let shared = 0;
		for (const g of t.genres) if (genres.has(g)) shared++;
		if (shared === 0) continue;
		const union = genres.size + t.genres.length - shared;
		scored.push({ t, same: t.kind === title.kind ? 1 : 0, overlap: shared / union });
	}
	scored.sort((a, b) => b.same - a.same || b.overlap - a.overlap || byPopularity(a.t, b.t));
	return scored.slice(0, limit).map((x) => x.t);
}

/** Titles of one kind by popularity. */
export function popular(titles: Title[], kind: Exclude<MediaKind, 'live'>, limit = 24): Title[] {
	return titles
		.filter((t) => t.kind === kind)
		.sort(byPopularity)
		.slice(0, limit);
}

/** Trending: popularity boosted for recently added titles (half-life ~30 days). */
export function trending(
	titles: Title[],
	kind: Exclude<MediaKind, 'live'>,
	limit = 24,
	now = Date.now()
): Title[] {
	const day = 86_400_000;
	const score = (t: Title) => {
		const age = Math.max(0, (now - t.addedAt) / day);
		return t.popularity * (0.6 + 0.4 * Math.pow(0.5, age / 30));
	};
	return titles
		.filter((t) => t.kind === kind)
		.map((t) => ({ t, s: score(t) }))
		.sort((a, b) => b.s - a.s)
		.slice(0, limit)
		.map((x) => x.t);
}

/** Recently added (newest addedAt first). */
export function recent(titles: Title[], limit = 24): Title[] {
	return [...titles].sort((a, b) => b.addedAt - a.addedAt).slice(0, limit);
}

/** Featured titles for the hero: popular, preferably with an overview, mixed kinds. */
export function featured(titles: Title[], n = 5): Title[] {
	const ranked = [...titles].sort(
		(a, b) => Number(!!b.overview) - Number(!!a.overview) || byPopularity(a, b)
	);
	const movies = ranked.filter((t) => t.kind === 'movie');
	const series = ranked.filter((t) => t.kind === 'series');
	const out: Title[] = [];
	// Interleave 2 movies : 1 series so the banner shows both.
	let m = 0;
	let s = 0;
	while (out.length < n && (m < movies.length || s < series.length)) {
		const takeSeries = out.length % 3 === 2;
		if (takeSeries && s < series.length) out.push(series[s++]);
		else if (m < movies.length) out.push(movies[m++]);
		else if (s < series.length) out.push(series[s++]);
	}
	return out;
}

/** Genres with their title counts, most common first. */
export function genreCounts(
	titles: Title[],
	kind?: Exclude<MediaKind, 'live'>
): { genre: string; count: number }[] {
	const counts = new Map<string, number>();
	for (const t of titles) {
		if (kind && t.kind !== kind) continue;
		for (const g of t.genres) counts.set(g, (counts.get(g) ?? 0) + 1);
	}
	return [...counts]
		.map(([genre, count]) => ({ genre, count }))
		.sort((a, b) => b.count - a.count || a.genre.localeCompare(b.genre));
}

/** Audio languages with their title counts ('und' excluded), most common first. */
export function languageCounts(titles: Title[]): { code: string; count: number }[] {
	const counts = new Map<string, number>();
	for (const t of titles)
		for (const l of t.languages) if (l !== 'und') counts.set(l, (counts.get(l) ?? 0) + 1);
	return [...counts]
		.map(([code, count]) => ({ code, count }))
		.sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
}

/** Drop undefined entries and duplicate ids, keeping the first occurrence. */
export function uniqueTitles(list: (Title | undefined)[]): Title[] {
	const seen = new Set<string>();
	const out: Title[] = [];
	for (const t of list) {
		if (!t || seen.has(t.id)) continue;
		seen.add(t.id);
		out.push(t);
	}
	return out;
}
