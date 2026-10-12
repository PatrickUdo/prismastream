// Robust IndexedDB stores for idb-keyval (drop-in for `createStore(db, store)`).
//
// Why: an IndexedDB open can wait forever. Another tab (for example an older version of the
// app) that keeps a connection open blocks a version upgrade or a deleteDatabase, and every
// later open of that database queues behind it. idb-keyval never closes its connections and
// has no timeout, so one blocked database could stall the whole app start.
//
// This store:
// - closes its connection on `versionchange` (so upgrades/deletes elsewhere can proceed) and
//   reopens lazily on the next use;
// - creates a missing object store with a version upgrade (databases made by older versions);
// - gives up after `timeoutMs` (open blocked, browser hiccup): the caller gets an
//   `IdbUnavailableError` and treats the cache as empty instead of hanging.
import type { UseStore } from 'idb-keyval';

export class IdbUnavailableError extends Error {
	readonly reason: 'unsupported' | 'blocked' | 'timeout' | 'error';
	constructor(reason: IdbUnavailableError['reason'], message?: string) {
		super(message ?? `IndexedDB ${reason}`);
		this.name = 'IdbUnavailableError';
		this.reason = reason;
	}
}

export interface SafeStoreOptions {
	timeoutMs?: number;
	/** For tests: the IDBFactory to use (default: globalThis.indexedDB). */
	factory?: IDBFactory;
}

function openDb(
	factory: IDBFactory,
	dbName: string,
	storeName: string,
	timeoutMs: number,
	version?: number
): Promise<IDBDatabase> {
	return new Promise<IDBDatabase>((resolve, reject) => {
		let settled = false;
		const done = (fn: () => void) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			fn();
		};
		const timer = setTimeout(
			() =>
				done(() =>
					reject(new IdbUnavailableError('timeout', `IndexedDB "${dbName}" did not open in time`))
				),
			timeoutMs
		);
		let req: IDBOpenDBRequest;
		try {
			req = version ? factory.open(dbName, version) : factory.open(dbName);
		} catch (err) {
			done(() => reject(new IdbUnavailableError('error', (err as Error)?.message)));
			return;
		}
		req.onupgradeneeded = () => {
			const db = req.result;
			if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName);
		};
		req.onblocked = () => {
			// Another connection (often another tab) holds the database. It may close on our
			// versionchange; otherwise the timeout ends the wait.
		};
		req.onerror = () =>
			done(() => reject(new IdbUnavailableError('error', req.error?.message ?? 'open failed')));
		req.onsuccess = () => {
			const db = req.result;
			if (settled) {
				db.close();
				return;
			}
			if (!db.objectStoreNames.contains(storeName)) {
				// Database from an older version without this store: upgrade once.
				const next = db.version + 1;
				db.close();
				clearTimeout(timer);
				settled = true;
				openDb(factory, dbName, storeName, timeoutMs, next).then(resolve, reject);
				return;
			}
			done(() => resolve(db));
		};
	});
}

/** An idb-keyval `UseStore` that never hangs and never blocks other tabs. */
export function safeStore(dbName: string, storeName: string, o: SafeStoreOptions = {}): UseStore {
	const timeoutMs = o.timeoutMs ?? 4000;
	let dbp: Promise<IDBDatabase> | null = null;

	const open = (): Promise<IDBDatabase> => {
		const factory = o.factory ?? (typeof indexedDB !== 'undefined' ? indexedDB : undefined);
		if (!factory) return Promise.reject(new IdbUnavailableError('unsupported'));
		if (dbp) return dbp;
		const p = openDb(factory, dbName, storeName, timeoutMs).then((db) => {
			const forget = () => {
				if (dbp === p) dbp = null;
			};
			db.onversionchange = () => {
				db.close();
				forget();
			};
			db.onclose = forget;
			return db;
		});
		dbp = p;
		p.catch(() => {
			if (dbp === p) dbp = null;
		});
		return p;
	};

	return async (txMode, callback) => {
		const db = await open();
		try {
			return await callback(db.transaction(storeName, txMode).objectStore(storeName));
		} catch (err) {
			// The connection was closed under us (versionchange): reopen once.
			if ((err as DOMException)?.name === 'InvalidStateError') {
				dbp = null;
				const again = await open();
				return callback(again.transaction(storeName, txMode).objectStore(storeName));
			}
			throw err;
		}
	};
}

/** Race a promise against a timeout (resolves to `fallback` after `ms`). */
export function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
	return new Promise<T>((resolve) => {
		const timer = setTimeout(() => resolve(fallback), ms);
		p.then(
			(v) => {
				clearTimeout(timer);
				resolve(v);
			},
			() => {
				clearTimeout(timer);
				resolve(fallback);
			}
		);
	});
}
