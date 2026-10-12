// IndexedDB cache for raw catalogs, EPG, lazy series info and local playlist files.
// Keys: `<sourceId>:<kind>[:<sub>]`. Urls are masked before writing (see mask.ts).
import { createStore, get, set, del, delMany, keys, type UseStore } from 'idb-keyval';

/** Bump when the cached shape changes; older entries are ignored. */
export const CACHE_VERSION = 2;

export const TTL = {
	catalog: 12 * 3600_000,
	epg: 6 * 3600_000,
	series: 12 * 3600_000
} as const;

export interface CacheEntry<T> {
	v: number;
	savedAt: number;
	data: T;
}

let db: UseStore | undefined;
const available = () => typeof indexedDB !== 'undefined';
function store(): UseStore {
	db ??= createStore('prismastream-cache', 'cache');
	return db;
}

export const cacheKey = (sourceId: string, kind: string, sub?: string) =>
	sub ? `${sourceId}:${kind}:${sub}` : `${sourceId}:${kind}`;

export async function cacheGet<T>(key: string): Promise<CacheEntry<T> | undefined> {
	if (!available()) return undefined;
	try {
		const e = await get<CacheEntry<T>>(key, store());
		return e && e.v === CACHE_VERSION ? e : undefined;
	} catch {
		return undefined;
	}
}

export async function cacheSet<T>(key: string, data: T): Promise<void> {
	if (!available()) return;
	try {
		await set(
			key,
			{ v: CACHE_VERSION, savedAt: Date.now(), data } satisfies CacheEntry<T>,
			store()
		);
	} catch (err) {
		// Quota exceeded or private mode: the app still works, just without cache.
		console.warn('[sources] cache write failed', key, err instanceof Error ? err.name : '');
	}
}

export function isFresh(
	e: CacheEntry<unknown> | undefined,
	ttl: number,
	now = Date.now()
): boolean {
	return !!e && now - e.savedAt < ttl && e.savedAt <= now;
}

/** Delete every cache key of a source (optionally only some kinds). */
export async function cacheClear(sourceId: string, kinds?: string[]): Promise<void> {
	if (!available()) return;
	try {
		const all = (await keys(store())) as string[];
		const prefix = `${sourceId}:`;
		const doomed = all.filter(
			(k) =>
				typeof k === 'string' &&
				k.startsWith(prefix) &&
				(!kinds || kinds.includes(k.slice(prefix.length).split(':')[0]))
		);
		if (doomed.length) await delMany(doomed, store());
	} catch {
		// ignore
	}
}

/** Local playlist file contents (not subject to TTL). */
export async function fileGet(sourceId: string): Promise<string | undefined> {
	if (!available()) return undefined;
	try {
		return await get<string>(cacheKey(sourceId, 'file'), store());
	} catch {
		return undefined;
	}
}
export async function fileSet(sourceId: string, text: string): Promise<void> {
	if (!available()) throw new Error('IndexedDB unavailable');
	await set(cacheKey(sourceId, 'file'), text, store());
}
export async function fileDel(sourceId: string): Promise<void> {
	if (!available()) return;
	await del(cacheKey(sourceId, 'file'), store()).catch(() => {});
}
