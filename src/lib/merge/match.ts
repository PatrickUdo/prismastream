// Clustering of raw movies/series into real-world titles.
//
// Guarded union-find. Keys are applied from strong to weak:
//   1. tmdbId (+ kind)            4. title + year ±1 (alt/original titles included)
//   2. imdbId (+ kind)            5. weak key (title without subtitle) + exact year
//   3. title + exact year         6. title without year: only when exactly one candidate cluster
// Every union is refused when it would put a conflict into one cluster: two different
// tmdb/imdb ids, years more than 1 apart (2 for id matches), or — for the looser
// matches (±1 year, subtitle-less, no year) — runtimes more than 25% apart. Movies and series are never compared.
// Everything is Map-indexed: O(n · keys), no pairwise comparison.

export interface MatchItem {
	kind: 'movie' | 'series';
	/** Strong title keys (matchKey of title, original title, alt titles). */
	keys: string[];
	/** Weak keys (subtitle-less variants); they only match other items' strong keys. */
	weakKeys: string[];
	year?: number;
	tmdbId?: number;
	imdbId?: string;
	durationSec?: number;
}

interface Agg {
	tmdb?: number;
	imdb?: string;
	minYear?: number;
	maxYear?: number;
	minDur?: number;
	maxDur?: number;
	size: number;
}

type Mode = 'id' | 'title' | 'loose';

export class ClusterSet {
	parent: Int32Array;
	agg: Agg[];

	constructor(items: MatchItem[]) {
		this.parent = new Int32Array(items.length);
		this.agg = items.map((it, i) => {
			this.parent[i] = i;
			return {
				tmdb: it.tmdbId,
				imdb: it.imdbId,
				minYear: it.year,
				maxYear: it.year,
				minDur: it.durationSec || undefined,
				maxDur: it.durationSec || undefined,
				size: 1
			};
		});
	}

	find(i: number): number {
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
	compatible(ra: number, rb: number, mode: Mode): boolean {
		const a = this.agg[ra];
		const b = this.agg[rb];
		if (a.tmdb !== undefined && b.tmdb !== undefined && a.tmdb !== b.tmdb) return false;
		if (a.imdb !== undefined && b.imdb !== undefined && a.imdb !== b.imdb) return false;
		if (a.minYear !== undefined && b.minYear !== undefined) {
			const span = Math.max(a.maxYear!, b.maxYear!) - Math.min(a.minYear, b.minYear);
			if (span > (mode === 'id' ? 2 : 1)) return false;
		}
		if (mode === 'loose' && a.minDur !== undefined && b.minDur !== undefined) {
			const lo = Math.min(a.minDur, b.minDur);
			const hi = Math.max(a.maxDur!, b.maxDur!);
			if (hi > lo * 1.25) return false;
		}
		return true;
	}

	union(i: number, j: number, mode: Mode): boolean {
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
		if (b.minYear !== undefined) {
			a.minYear = a.minYear === undefined ? b.minYear : Math.min(a.minYear, b.minYear);
			a.maxYear = a.maxYear === undefined ? b.maxYear : Math.max(a.maxYear, b.maxYear!);
		}
		if (b.minDur !== undefined) {
			a.minDur = a.minDur === undefined ? b.minDur : Math.min(a.minDur, b.minDur);
			a.maxDur = a.maxDur === undefined ? b.maxDur : Math.max(a.maxDur, b.maxDur!);
		}
		a.size += b.size;
		return true;
	}

	groups(): number[][] {
		const map = new Map<number, number[]>();
		for (let i = 0; i < this.parent.length; i++) {
			const r = this.find(i);
			const g = map.get(r);
			if (g) g.push(i);
			else map.set(r, [i]);
		}
		return [...map.values()];
	}
}

function push<K>(map: Map<K, number[]>, key: K, i: number) {
	const list = map.get(key);
	if (list) list.push(i);
	else map.set(key, [i]);
}

/** Union every member of each bucket with the bucket's first compatible member. */
function unionBuckets(cs: ClusterSet, buckets: Map<string, number[]>, mode: Mode) {
	for (const list of buckets.values()) {
		if (list.length < 2) continue;
		for (let k = 1; k < list.length; k++) {
			// Try the anchors already merged, so one conflicting member doesn't block the rest.
			if (!cs.union(list[0], list[k], mode)) {
				for (let m = 1; m < k; m++) if (cs.union(list[m], list[k], mode)) break;
			}
		}
	}
}

/** Cluster items; returns groups of item indexes (each group = one Title). */
export function clusterItems(items: MatchItem[]): number[][] {
	const cs = new ClusterSet(items);
	const byTmdb = new Map<string, number[]>();
	const byImdb = new Map<string, number[]>();
	const byKeyYear = new Map<string, number[]>();
	const byKey = new Map<string, number[]>();

	items.forEach((it, i) => {
		if (it.tmdbId) push(byTmdb, `${it.kind}|${it.tmdbId}`, i);
		if (it.imdbId) push(byImdb, `${it.kind}|${it.imdbId}`, i);
		for (const key of it.keys) {
			if (!key) continue;
			push(byKey, `${it.kind}|${key}`, i);
			if (it.year) push(byKeyYear, `${it.kind}|${key}|${it.year}`, i);
		}
	});

	// 1–2. Ids
	unionBuckets(cs, byTmdb, 'id');
	unionBuckets(cs, byImdb, 'id');

	// 3. Exact title + year
	unionBuckets(cs, byKeyYear, 'title');

	// 4. Title + year ±1 (only next year to visit each pair once)
	items.forEach((it, i) => {
		if (!it.year) return;
		for (const key of it.keys) {
			const other = byKeyYear.get(`${it.kind}|${key}|${it.year + 1}`);
			if (other) for (const j of other) cs.union(i, j, 'loose');
		}
	});

	// 5. Weak keys (title without subtitle) against strong keys, same year
	items.forEach((it, i) => {
		if (!it.year) return;
		for (const weak of it.weakKeys) {
			const other = byKeyYear.get(`${it.kind}|${weak}|${it.year}`);
			if (other) for (const j of other) cs.union(i, j, 'loose');
		}
	});

	// 6. Items whose cluster has no year: merge only when the title points to exactly one
	//    dated cluster (or only to other undated items) and nothing conflicts.
	items.forEach((it, i) => {
		const root = cs.find(i);
		if (cs.agg[root].minYear !== undefined) return;
		const dated = new Set<number>();
		const undated: number[] = [];
		for (const key of it.keys) {
			for (const j of byKey.get(`${it.kind}|${key}`) ?? []) {
				const rj = cs.find(j);
				if (rj === root) continue;
				if (cs.agg[rj].minYear !== undefined) dated.add(rj);
				else undated.push(j);
			}
		}
		if (dated.size === 1) cs.union(i, [...dated][0], 'loose');
		else if (dated.size === 0) for (const j of undated) cs.union(i, j, 'loose');
	});

	return cs.groups();
}
