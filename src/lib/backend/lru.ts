// Small LRU cache with an item and a byte budget, optionally persisted (IndexedDB in the app,
// an in-memory storage in tests). Used in remote mode for TitleCards and title details, so the
// device keeps at most a few hundred items (±5 MB) instead of whole catalogs.
//
// Reads are synchronous from memory; writes are batched to the storage (flushMs). Recency is
// kept per entry (`at`), so the order survives a restart.

export interface LruRecord<V> {
	key: string;
	value: V;
	/** Approximate size in bytes. */
	size: number;
	/** Last use (epoch ms). */
	at: number;
}

export interface LruStorage<V> {
	load(): Promise<LruRecord<V>[]>;
	save(records: LruRecord<V>[]): Promise<void>;
	remove(keys: string[]): Promise<void>;
	clear(): Promise<void>;
}

export interface LruOptions<V> {
	maxItems: number;
	maxBytes: number;
	storage?: LruStorage<V>;
	sizeOf?: (value: V) => number;
	/** Delay before dirty entries are written (ms). */
	flushMs?: number;
	now?: () => number;
}

/** Rough byte size of a JSON-able value (UTF-16 code units of its JSON ≈ bytes for ASCII). */
export function jsonSize(value: unknown): number {
	try {
		return JSON.stringify(value)?.length ?? 0;
	} catch {
		return 0;
	}
}

export class LruCache<V> {
	readonly maxItems: number;
	readonly maxBytes: number;
	#map = new Map<string, LruRecord<V>>();
	#bytes = 0;
	#storage?: LruStorage<V>;
	#sizeOf: (v: V) => number;
	#now: () => number;
	#flushMs: number;
	#dirty = new Set<string>();
	#removed = new Set<string>();
	#timer: ReturnType<typeof setTimeout> | undefined;
	#loading: Promise<void> | null = null;
	#writing: Promise<void> = Promise.resolve();

	constructor(o: LruOptions<V>) {
		this.maxItems = Math.max(1, o.maxItems);
		this.maxBytes = Math.max(1024, o.maxBytes);
		this.#storage = o.storage;
		this.#sizeOf = o.sizeOf ?? jsonSize;
		this.#now = o.now ?? Date.now;
		this.#flushMs = o.flushMs ?? 1500;
	}

	get size(): number {
		return this.#map.size;
	}

	get bytes(): number {
		return this.#bytes;
	}

	/** Keys from least to most recently used. */
	keys(): string[] {
		return [...this.#map.keys()];
	}

	/** Load the persisted entries (once). Entries set before loading win over stored ones. */
	load(): Promise<void> {
		this.#loading ??= (async () => {
			if (!this.#storage) return;
			const records = await this.#storage.load().catch(() => null);
			if (!records) return;
			records.sort((a, b) => a.at - b.at);
			const fresh = [...this.#map.values()];
			this.#map.clear();
			this.#bytes = 0;
			for (const r of records) {
				if (!r || typeof r.key !== 'string' || this.#removed.has(r.key)) continue;
				this.#map.set(r.key, r);
				this.#bytes += r.size;
			}
			for (const r of fresh) this.#insert(r);
			this.#evict();
		})();
		return this.#loading;
	}

	has(key: string): boolean {
		return this.#map.has(key);
	}

	/** Value without touching recency. */
	peek(key: string): V | undefined {
		return this.#map.get(key)?.value;
	}

	/** Value, marked as most recently used. */
	get(key: string): V | undefined {
		const r = this.#map.get(key);
		if (!r) return undefined;
		this.#map.delete(key);
		r.at = Math.max(r.at, this.#now());
		this.#map.set(key, r);
		this.#markDirty(key);
		return r.value;
	}

	set(key: string, value: V): void {
		const size = this.#sizeOf(value);
		// One huge entry must not wipe the whole cache.
		if (size > this.maxBytes / 4) {
			this.delete(key);
			return;
		}
		this.#removed.delete(key);
		this.#insert({ key, value, size, at: this.#now() });
		this.#markDirty(key);
		this.#evict();
	}

	delete(key: string): void {
		const r = this.#map.get(key);
		if (!r) return;
		this.#map.delete(key);
		this.#bytes -= r.size;
		this.#dirty.delete(key);
		this.#removed.add(key);
		this.#schedule();
	}

	/** Drop everything, also from the storage. */
	async clear(): Promise<void> {
		clearTimeout(this.#timer);
		this.#timer = undefined;
		this.#map.clear();
		this.#bytes = 0;
		this.#dirty.clear();
		this.#removed.clear();
		await this.#writing.catch(() => undefined);
		await this.#storage?.clear().catch(() => undefined);
	}

	/** Write pending changes now. */
	flush(): Promise<void> {
		clearTimeout(this.#timer);
		this.#timer = undefined;
		const storage = this.#storage;
		if (!storage || (!this.#dirty.size && !this.#removed.size)) return this.#writing;
		const save = [...this.#dirty]
			.map((k) => this.#map.get(k))
			.filter((r): r is LruRecord<V> => !!r);
		const remove = [...this.#removed];
		this.#dirty.clear();
		this.#removed.clear();
		this.#writing = this.#writing
			.catch(() => undefined)
			.then(async () => {
				if (remove.length) await storage.remove(remove);
				if (save.length) await storage.save(save);
			})
			.catch(() => {
				// Quota or a closed database: the cache is only an optimisation.
			});
		return this.#writing;
	}

	#insert(r: LruRecord<V>) {
		const old = this.#map.get(r.key);
		if (old) {
			this.#bytes -= old.size;
			this.#map.delete(r.key);
		}
		this.#map.set(r.key, r);
		this.#bytes += r.size;
	}

	#evict() {
		while (this.#map.size > 0 && (this.#map.size > this.maxItems || this.#bytes > this.maxBytes)) {
			const oldest = this.#map.keys().next().value!;
			const r = this.#map.get(oldest)!;
			this.#map.delete(oldest);
			this.#bytes -= r.size;
			this.#dirty.delete(oldest);
			this.#removed.add(oldest);
		}
		this.#schedule();
	}

	#markDirty(key: string) {
		this.#dirty.add(key);
		this.#schedule();
	}

	#schedule() {
		if (!this.#storage || this.#timer) return;
		if (!this.#dirty.size && !this.#removed.size) return;
		this.#timer = setTimeout(() => void this.flush(), this.#flushMs);
	}
}

/** In-memory LruStorage (tests, and when IndexedDB is unavailable). */
export function memoryLruStorage<V>(): LruStorage<V> & { records: Map<string, LruRecord<V>> } {
	const records = new Map<string, LruRecord<V>>();
	return {
		records,
		async load() {
			return [...records.values()].map((r) => ({ ...r }));
		},
		async save(list) {
			for (const r of list) records.set(r.key, { ...r });
		},
		async remove(keys) {
			for (const k of keys) records.delete(k);
		},
		async clear() {
			records.clear();
		}
	};
}

/** LruStorage on an idb-keyval store (one database per cache). */
export function idbLruStorage<V>(dbName: string): LruStorage<V> {
	type Idb = typeof import('idb-keyval');
	let p: Promise<{ m: Idb; s: ReturnType<Idb['createStore']> }> | null = null;
	const open = () =>
		(p ??= import('idb-keyval').then((m) => ({ m, s: m.createStore(dbName, 'lru') })));
	const available = () => typeof indexedDB !== 'undefined';
	return {
		async load() {
			if (!available()) return [];
			const { m, s } = await open();
			const entries = await m.entries<string, LruRecord<V>>(s);
			return entries.map(([, r]) => r).filter((r) => r && typeof r.key === 'string');
		},
		async save(list) {
			if (!available() || !list.length) return;
			const { m, s } = await open();
			await m.setMany(
				list.map((r) => [r.key, r]),
				s
			);
		},
		async remove(keys) {
			if (!available() || !keys.length) return;
			const { m, s } = await open();
			await m.delMany(keys, s);
		},
		async clear() {
			if (!available()) return;
			const { m, s } = await open();
			await m.clear(s);
		}
	};
}
