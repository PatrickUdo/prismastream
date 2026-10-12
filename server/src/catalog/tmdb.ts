// Shared TMDB cache for server-side enrichment. Metadata is public, so it is shared by all
// accounts (no account id). The TmdbIndex the merge engine reads (`byKey`, `meta`) is backed
// by SQLite through proxies: lookups are point queries, so the index never has to be loaded
// into memory as a whole.
import type { DatabaseSync } from 'node:sqlite';
import type { TmdbCache, TmdbIndex, TmdbMeta } from './core.ts';

export function sqliteTmdbIndex(db: DatabaseSync): TmdbIndex {
	const getKey = db.prepare('SELECT tmdb_id FROM tmdb_keys WHERE key = ?');
	const setKey = db.prepare('INSERT OR REPLACE INTO tmdb_keys (key, tmdb_id) VALUES (?, ?)');
	const getMeta = db.prepare('SELECT data FROM tmdb_meta WHERE key = ?');
	const setMeta = db.prepare('INSERT OR REPLACE INTO tmdb_meta (key, data) VALUES (?, ?)');
	const metaCache = new Map<string, TmdbMeta | undefined>();
	const byKey = new Proxy({} as Record<string, number>, {
		get(_t, k) {
			if (typeof k !== 'string') return undefined;
			const r = getKey.get(k) as { tmdb_id: number } | undefined;
			return r ? Number(r.tmdb_id) : undefined;
		},
		set(_t, k, v) {
			if (typeof k === 'string' && typeof v === 'number') setKey.run(k, v);
			return true;
		},
		has(_t, k) {
			return typeof k === 'string' && !!getKey.get(k);
		}
	});
	const meta = new Proxy({} as Record<string, TmdbMeta>, {
		get(_t, k) {
			if (typeof k !== 'string') return undefined;
			if (metaCache.has(k)) return metaCache.get(k);
			const r = getMeta.get(k) as { data: string } | undefined;
			const v = r ? (JSON.parse(r.data) as TmdbMeta) : undefined;
			if (metaCache.size > 5000) metaCache.clear();
			metaCache.set(k, v);
			return v;
		},
		set(_t, k, v) {
			if (typeof k === 'string' && v && typeof v === 'object') {
				setMeta.run(k, JSON.stringify(v));
				metaCache.set(k, v as TmdbMeta);
			}
			return true;
		},
		has(_t, k) {
			return typeof k === 'string' && !!getMeta.get(k);
		}
	});
	return { byKey, meta };
}

/** Response cache for TmdbClient (search/details), shared, in SQLite. */
export function sqliteTmdbCache(db: DatabaseSync): TmdbCache {
	const get = db.prepare('SELECT at, v FROM tmdb_cache WHERE key = ?');
	const set = db.prepare('INSERT OR REPLACE INTO tmdb_cache (key, at, v) VALUES (?, ?, ?)');
	return {
		async get(key) {
			const r = get.get(key) as { at: number; v: string | null } | undefined;
			return r ? { at: Number(r.at), v: r.v == null ? null : JSON.parse(r.v) } : undefined;
		},
		async set(key, value) {
			set.run(key, value.at, value.v == null ? null : JSON.stringify(value.v));
		}
	};
}

/** True when there is any TMDB data (otherwise the build skips the lookups). */
export function hasTmdbData(db: DatabaseSync): boolean {
	return !!db.prepare('SELECT 1 FROM tmdb_keys LIMIT 1').get();
}
