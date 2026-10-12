// Optional TMDB enrichment. Runs in the background, in batches, only when the user set an API
// key. It produces a TmdbIndex: tmdb ids for (translated) titles plus metadata. The next
// buildCatalog() uses it, so "Der Pate", "Le Parrain" and "De Peetvader" end up as one title.
import type { LangCode, Title } from '#lib/types.ts';
import { matchKey } from '#lib/merge/normalize.ts';
import { TmdbClient, type TmdbCache } from './client.ts';
import { tmdbLookupKey, tmdbMetaKey, type TmdbIndex, type TmdbMeta } from './types.ts';

export * from './types.ts';
export { TmdbClient, RateLimiter, TmdbError, memoryCache, type TmdbCache } from './client.ts';

const INDEX_KEY = 'tmdb:index:v1';
const META_TTL = 30 * 86_400_000;

type IdbModule = typeof import('idb-keyval');
let idb: Promise<{ mod: IdbModule; store: ReturnType<IdbModule['createStore']> }> | null = null;
function db() {
	idb ??= import('idb-keyval').then((mod) => ({ mod, store: mod.createStore('ps-tmdb', 'kv') }));
	return idb;
}

/** IndexedDB-backed response cache (falls back to nothing when IndexedDB is unavailable). */
export function idbCache(): TmdbCache {
	return {
		async get(key) {
			if (typeof indexedDB === 'undefined') return undefined;
			const { mod, store } = await db();
			return mod.get(key, store);
		},
		async set(key, value) {
			if (typeof indexedDB === 'undefined') return;
			const { mod, store } = await db();
			await mod.set(key, value, store);
		}
	};
}

export function emptyIndex(): TmdbIndex {
	return { byKey: {}, meta: {} };
}

export async function loadTmdbIndex(): Promise<TmdbIndex> {
	if (typeof indexedDB === 'undefined') return emptyIndex();
	try {
		const { mod, store } = await db();
		return ((await mod.get(INDEX_KEY, store)) as TmdbIndex | undefined) ?? emptyIndex();
	} catch {
		return emptyIndex();
	}
}

export async function saveTmdbIndex(index: TmdbIndex): Promise<void> {
	if (typeof indexedDB === 'undefined') return;
	try {
		const { mod, store } = await db();
		await mod.set(INDEX_KEY, index, store);
	} catch {
		// ignore quota errors; enrichment is best-effort
	}
}

/** Record every known title of a TMDB entry as a lookup key for its id. */
export function indexMeta(index: TmdbIndex, meta: TmdbMeta) {
	index.meta[tmdbMetaKey(meta.kind, meta.id)] = meta;
	const titles = [meta.title, meta.originalTitle, ...meta.altTitles.map((a) => a.title)];
	for (const t of titles) {
		if (!t) continue;
		const key = matchKey(t);
		if (!key) continue;
		if (meta.year) {
			for (const y of [meta.year - 1, meta.year, meta.year + 1]) {
				const k = tmdbLookupKey(meta.kind, key, y);
				if (y === meta.year || index.byKey[k] === undefined) index.byKey[k] = meta.id;
			}
		}
		const loose = tmdbLookupKey(meta.kind, key);
		index.byKey[loose] ??= meta.id;
	}
}

export interface EnrichOptions {
	apiKey: string;
	/** Language for overviews and genres (profile language). */
	lang: LangCode;
	titles: Title[];
	index: TmdbIndex;
	/** Titles per batch; onBatch runs after each. */
	batchSize?: number;
	/** Upper bound per run (the rest follows in the next refresh). */
	maxTitles?: number;
	signal?: AbortSignal;
	/** Skip titles that only come from these sources (e.g. the fictional demo library). */
	skipSource?: (sourceId: string) => boolean;
	client?: TmdbClient;
	onBatch?: (index: TmdbIndex, changed: boolean) => void | Promise<void>;
}

/** Queries to try for a title: original, English/display, then other language titles. */
function queriesFor(t: Title): string[] {
	const out: string[] = [];
	const add = (q?: string) => {
		if (q && !out.some((o) => matchKey(o) === matchKey(q))) out.push(q);
	};
	add(t.originalTitle);
	add(t.altTitles.find((a) => a.lang === 'en')?.title);
	add(t.title);
	for (const a of t.altTitles) add(a.title);
	return out.slice(0, 3);
}

/**
 * Enrich titles via TMDB. Mutates and returns `index`. Network errors stop the run quietly
 * (401 = bad key → throws so the UI can tell the user).
 */
export async function enrichTitles(
	opts: EnrichOptions
): Promise<{ searched: number; fetched: number }> {
	const client = opts.client ?? new TmdbClient(opts.apiKey, { cache: idbCache() });
	const { index, lang } = opts;
	const batchSize = opts.batchSize ?? 20;
	const candidates = opts.titles
		.filter((t) => !opts.skipSource || t.sourceIds.some((s) => !opts.skipSource!(s)))
		.filter((t) => {
			if (!t.tmdbId) return true;
			const meta = index.meta[tmdbMetaKey(t.kind, t.tmdbId)];
			return !meta || meta.lang !== lang || Date.now() - meta.fetchedAt > META_TTL;
		})
		.sort((a, b) => b.popularity - a.popularity)
		.slice(0, opts.maxTitles ?? 400);

	let searched = 0;
	let fetched = 0;
	for (let i = 0; i < candidates.length; i += batchSize) {
		if (opts.signal?.aborted) break;
		let changed = false;
		for (const t of candidates.slice(i, i + batchSize)) {
			if (opts.signal?.aborted) break;
			try {
				let id = t.tmdbId;
				if (!id) {
					for (const q of queriesFor(t)) {
						searched++;
						id = (await client.search(t.kind, q, t.year, lang)) ?? undefined;
						if (id) break;
					}
					if (!id) continue;
					// Every title of this cluster now points to the id.
					for (const a of [t.title, t.originalTitle, ...t.altTitles.map((x) => x.title)]) {
						if (!a) continue;
						index.byKey[tmdbLookupKey(t.kind, matchKey(a), t.year)] = id;
					}
					changed = true;
				}
				const mk = tmdbMetaKey(t.kind, id);
				const existing = index.meta[mk];
				if (!existing || existing.lang !== lang || Date.now() - existing.fetchedAt > META_TTL) {
					indexMeta(index, await client.details(t.kind, id, lang));
					fetched++;
					changed = true;
				}
			} catch (err) {
				const status = (err as { status?: number }).status;
				if (status === 401) throw err;
				if (status && status !== 404) return { searched, fetched };
			}
		}
		await opts.onBatch?.(index, changed);
	}
	return { searched, fetched };
}
