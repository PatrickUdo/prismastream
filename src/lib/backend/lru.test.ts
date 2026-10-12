import { describe, expect, it } from 'vitest';
import { LruCache, memoryLruStorage } from './lru.ts';

const fixedSize = () => 100;

describe('LruCache', () => {
	it('evicts the least recently used entry beyond maxItems', () => {
		const c = new LruCache<string>({ maxItems: 3, maxBytes: 1e6, sizeOf: fixedSize });
		c.set('a', 'A');
		c.set('b', 'B');
		c.set('c', 'C');
		expect(c.get('a')).toBe('A'); // a becomes most recent
		c.set('d', 'D');
		expect(c.has('b')).toBe(false);
		expect(c.keys()).toEqual(['c', 'a', 'd']);
	});

	it('keeps the byte budget', () => {
		const c = new LruCache<string>({ maxItems: 100, maxBytes: 2000, sizeOf: (v) => v.length });
		for (let i = 0; i < 10; i++) c.set('k' + i, 'x'.repeat(400));
		expect(c.bytes).toBeLessThanOrEqual(2000);
		expect(c.size).toBe(5);
		expect(c.has('k9')).toBe(true);
		expect(c.has('k0')).toBe(false);
	});

	it('does not store an entry larger than a quarter of the budget', () => {
		const c = new LruCache<string>({ maxItems: 10, maxBytes: 4000, sizeOf: (v) => v.length });
		c.set('small', 'x');
		c.set('huge', 'x'.repeat(1500));
		expect(c.has('huge')).toBe(false);
		expect(c.has('small')).toBe(true);
	});

	it('replacing an entry updates the byte count', () => {
		const c = new LruCache<string>({ maxItems: 10, maxBytes: 1e6, sizeOf: (v) => v.length });
		c.set('a', 'xx');
		c.set('a', 'xxxxx');
		expect(c.bytes).toBe(5);
		c.delete('a');
		expect(c.bytes).toBe(0);
	});

	it('persists, restores recency order and applies limits on load', async () => {
		const storage = memoryLruStorage<string>();
		let now = 1000;
		const a = new LruCache<string>({ maxItems: 3, maxBytes: 1e6, storage, now: () => now++ });
		a.set('a', 'A');
		a.set('b', 'B');
		a.set('c', 'C');
		a.get('a');
		await a.flush();
		expect(storage.records.size).toBe(3);

		const b = new LruCache<string>({ maxItems: 2, maxBytes: 1e6, storage, now: () => now++ });
		await b.load();
		// 'b' was least recently used: evicted to fit maxItems 2.
		expect(b.keys()).toEqual(['c', 'a']);
		await b.flush();
		expect([...storage.records.keys()].sort()).toEqual(['a', 'c']);
	});

	it('entries set before load win over stored ones', async () => {
		const storage = memoryLruStorage<string>();
		await storage.save([{ key: 'x', value: 'old', size: 3, at: 1 }]);
		const c = new LruCache<string>({ maxItems: 5, maxBytes: 1e6, storage });
		c.set('x', 'new');
		await c.load();
		expect(c.peek('x')).toBe('new');
	});

	it('clear() empties memory and storage', async () => {
		const storage = memoryLruStorage<string>();
		const c = new LruCache<string>({ maxItems: 5, maxBytes: 1e6, storage });
		c.set('a', 'A');
		await c.flush();
		await c.clear();
		expect(c.size).toBe(0);
		expect(storage.records.size).toBe(0);
	});
});
