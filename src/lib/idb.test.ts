import { describe, expect, it } from 'vitest';
import { IdbUnavailableError, safeStore, withTimeout } from './idb.ts';

// Minimal IndexedDB fakes: enough for open/upgrade/versionchange behaviour.
type Req = {
	result?: FakeDb;
	error?: Error | null;
	onsuccess?: () => void;
	onerror?: () => void;
	onblocked?: () => void;
	onupgradeneeded?: () => void;
};

class FakeDb {
	version: number;
	stores: Set<string>;
	closed = false;
	onversionchange: (() => void) | null = null;
	onclose: (() => void) | null = null;
	constructor(version: number, stores: string[]) {
		this.version = version;
		this.stores = new Set(stores);
	}
	get objectStoreNames() {
		return { contains: (n: string) => this.stores.has(n) };
	}
	createObjectStore(n: string) {
		this.stores.add(n);
	}
	close() {
		this.closed = true;
	}
	transaction() {
		if (this.closed) throw Object.assign(new Error('closed'), { name: 'InvalidStateError' });
		return { objectStore: () => ({ kind: 'store' }) };
	}
}

function factory(mode: 'ok' | 'blocked' | 'nostore') {
	const opened: FakeDb[] = [];
	let stores: string[] = mode === 'nostore' ? [] : ['kv'];
	let version = 1;
	const f = {
		opened,
		open(_name: string, v?: number) {
			const req: Req = {};
			setTimeout(() => {
				if (mode === 'blocked') {
					req.onblocked?.(); // never succeeds
					return;
				}
				const upgrade = v !== undefined && v > version;
				if (upgrade) version = v!;
				const db = new FakeDb(version, stores);
				req.result = db;
				if (upgrade) {
					req.onupgradeneeded?.();
					stores = [...db.stores];
				}
				opened.push(db);
				req.onsuccess?.();
			}, 0);
			return req;
		}
	};
	return f as unknown as IDBFactory & { opened: FakeDb[] };
}

describe('safeStore', () => {
	it('gives up on a blocked open instead of hanging', async () => {
		const store = safeStore('db', 'kv', { factory: factory('blocked'), timeoutMs: 30 });
		const err = await store('readonly', () => 1).catch((e: unknown) => e);
		expect(err).toBeInstanceOf(IdbUnavailableError);
		expect((err as IdbUnavailableError).reason).toBe('timeout');
	});

	it('closes its connection on versionchange and reopens on the next use', async () => {
		const f = factory('ok');
		const store = safeStore('db', 'kv', { factory: f, timeoutMs: 200 });
		expect(await store('readonly', () => 'a')).toBe('a');
		const first = f.opened[0];
		first.onversionchange?.(); // another tab upgrades or deletes the database
		expect(first.closed).toBe(true);
		expect(await store('readonly', () => 'b')).toBe('b');
		expect(f.opened).toHaveLength(2);
	});

	it('creates a missing object store in a database from an older version', async () => {
		const f = factory('nostore');
		const store = safeStore('db', 'kv', { factory: f, timeoutMs: 200 });
		expect(await store('readonly', () => 'ok')).toBe('ok');
		expect(f.opened.at(-1)?.stores.has('kv')).toBe(true);
	});

	it('reports a missing IndexedDB as unavailable', async () => {
		const store = safeStore('db', 'kv', { factory: undefined, timeoutMs: 10 });
		const hadIdb = 'indexedDB' in globalThis;
		if (!hadIdb) {
			const err = await store('readonly', () => 1).catch((e: unknown) => e);
			expect((err as IdbUnavailableError).reason).toBe('unsupported');
		}
	});
});

describe('withTimeout', () => {
	it('falls back when the promise hangs or fails', async () => {
		expect(await withTimeout(new Promise(() => {}), 10, 'fallback')).toBe('fallback');
		expect(await withTimeout(Promise.reject(new Error('x')), 10, 'fb')).toBe('fb');
		expect(await withTimeout(Promise.resolve('v'), 10, 'fb')).toBe('v');
	});
});
