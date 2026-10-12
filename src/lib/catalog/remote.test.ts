import { describe, expect, it, vi } from 'vitest';
import type { TitleCard } from '#lib/types.ts';
import { BackendClient, BackendError, BackendOfflineError } from '#lib/backend/client.ts';
import { LruCache, memoryLruStorage } from '#lib/backend/lru.ts';
import { RemoteProvider, toCard, type CacheEntry, type SnapshotStore } from './remote.ts';

const BASE = 'https://backend.test';

function card(id: string, extra: Partial<TitleCard> = {}): TitleCard {
	return {
		id,
		kind: 'movie',
		title: id.toUpperCase(),
		altTitles: [],
		genres: ['Drama'],
		addedAt: 1,
		popularity: 50,
		languages: ['nl'],
		subtitleLanguages: [],
		qualities: ['HD'],
		kidsSafe: false,
		...extra
	};
}

type Handler = (url: URL, init: RequestInit) => Response | Promise<Response>;

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json', ...headers }
	});
}

function memorySnapshots(): SnapshotStore & { data: Map<string, unknown> } {
	const data = new Map<string, unknown>();
	return {
		data,
		async get<T>(k: string) {
			return data.get(k) as T | undefined;
		},
		async set(k, v) {
			data.set(k, structuredClone(v));
		},
		async clear() {
			data.clear();
		}
	};
}

function setup(handler: Handler, opts: { online?: () => boolean } = {}) {
	const calls: { url: URL; init: RequestInit }[] = [];
	const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
		const url = new URL(String(input));
		calls.push({ url, init });
		return handler(url, init);
	});
	const client = new BackendClient({
		baseUrl: () => BASE,
		getToken: () => 'pst_token',
		fetch: fetchMock as unknown as typeof fetch,
		sleep: async () => {},
		isOnline: opts.online ?? (() => true)
	});
	const storage = memoryLruStorage<CacheEntry>();
	const cache = new LruCache<CacheEntry>({ maxItems: 300, maxBytes: 5 * 1024 * 1024, storage });
	const snapshots = memorySnapshots();
	const provider = new RemoteProvider({ client, cache, snapshots });
	return { provider, client, calls, fetchMock, cache, snapshots, storage };
}

describe('BackendClient', () => {
	it('sends the bearer token and builds the query', async () => {
		const { client, calls } = setup(() => json({ items: [], total: 0 }));
		await client.titles({ kind: 'movie', genre: 'drama', kids: true, sort: 'new', limit: 60 });
		const { url, init } = calls[0];
		expect(url.pathname).toBe('/v1/catalog/titles');
		expect(url.searchParams.get('kind')).toBe('movie');
		expect(url.searchParams.get('kids')).toBe('1');
		expect(url.searchParams.get('lang')).toBeNull();
		expect((init.headers as Record<string, string>).authorization).toBe('Bearer pst_token');
	});

	it('answers a 304 from the ETag cache', async () => {
		let n = 0;
		const { client, calls } = setup((_url, init) => {
			n++;
			const inm = (init.headers as Record<string, string>)['if-none-match'];
			if (inm === '"v1"') return new Response(null, { status: 304 });
			return json({ builtAt: 5, status: 'ready' }, 200, { etag: '"v1"' });
		});
		const a = await client.meta();
		const b = await client.meta();
		expect(n).toBe(2);
		expect((calls[1].init.headers as Record<string, string>)['if-none-match']).toBe('"v1"');
		expect(b).toEqual(a);
	});

	it('retries GET on 503 and network errors', async () => {
		let n = 0;
		const { client } = setup(() => {
			n++;
			if (n === 1) return new Response('', { status: 503 });
			if (n === 2) throw new TypeError('Failed to fetch');
			return json({ ok: 1 });
		});
		expect(await client.request('/v1/x')).toEqual({ ok: 1 });
		expect(n).toBe(3);
	});

	it('does not retry POST and maps errors', async () => {
		let n = 0;
		const { client } = setup(() => {
			n++;
			return json({ error: 'auth', message: 'Bad login' }, 400);
		});
		await expect(client.testSource({ type: 'xtream' })).rejects.toMatchObject({
			name: 'BackendError',
			status: 400,
			code: 'auth'
		});
		expect(n).toBe(1);
	});

	it('reports offline without fetching when the device is offline', async () => {
		const { client, fetchMock } = setup(() => json({}), { online: () => false });
		await expect(client.meta()).rejects.toBeInstanceOf(BackendOfflineError);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('drops If-None-Match when the CORS preflight refuses it', async () => {
		let n = 0;
		const { client } = setup((_url, init) => {
			n++;
			if ((init.headers as Record<string, string>)['if-none-match']) throw new TypeError('CORS');
			return json({ v: n }, 200, { etag: '"e"' });
		});
		await client.meta();
		const second = await client.meta();
		expect(second).toEqual({ v: 3 });
		await client.meta();
		expect(n).toBe(4); // no conditional header any more: one request
	});
});

describe('RemoteProvider', () => {
	it('home(): caches cards and a snapshot, and answers offline from the snapshot', async () => {
		let offline = false;
		const home = {
			featured: [card('a')],
			recent: [card('b')],
			popularMovies: [],
			trendingSeries: [],
			genres: [{ slug: 'drama', name: 'Drama', count: 3 }],
			live: []
		};
		const { provider, snapshots } = setup(() => {
			if (offline) throw new TypeError('offline');
			return json(home, 200, { etag: '"h1"' });
		});
		const first = await provider.home({ kids: false });
		expect(first.featured[0].id).toBe('a');
		expect(first.genres[0]).toEqual({ slug: 'drama', name: 'Drama', count: 3 });
		expect(provider.peekCard('a')?.title).toBe('A');
		await new Promise((r) => setTimeout(r, 0));
		expect(snapshots.data.has('home:0')).toBe(true);
		offline = true;
		const again = await provider.home({ kids: false });
		expect(again.recent[0].id).toBe('b');
	});

	it('cards(): cache first, fetches the rest in one call, keeps order, filters kids', async () => {
		const { provider, calls } = setup((url) => {
			const ids = url.searchParams.get('ids')!.split(',');
			return json({
				items: ids.map((id) => card(id, { kidsSafe: id !== 'z' })),
				total: ids.length
			});
		});
		provider.rememberCards([card('b', { kidsSafe: true })]);
		const list = await provider.cards(['c', 'b', 'z', 'c'], { kids: false });
		expect(list.map((c) => c.id)).toEqual(['c', 'b', 'z']);
		expect(calls).toHaveLength(1);
		expect(calls[0].url.searchParams.get('ids')).toBe('c,z');
		const kidsList = await provider.cards(['c', 'b', 'z'], { kids: true });
		expect(kidsList.map((c) => c.id)).toEqual(['c', 'b']);
		expect(calls).toHaveLength(1); // all cached now
	});

	it('title(): returns the detail with similar, caches it, null on 404', async () => {
		const detail = {
			...card('m1'),
			cast: [],
			variants: [
				{
					id: 's:1',
					sourceId: 's',
					url: `${BASE}/v1/play/ppx/s~1`,
					audioLangs: ['nl'],
					subtitleLangs: [],
					quality: 'HD',
					label: 'x'
				}
			],
			sourceIds: ['s'],
			rawRefs: [],
			similar: [card('m2')]
		};
		let n = 0;
		const { provider } = setup((url) => {
			n++;
			if (url.pathname.endsWith('/missing')) return json({ error: 'not_found' }, 404);
			return json(detail);
		});
		const t = await provider.title('m1');
		expect(t?.variants[0].url).toContain('/v1/play/');
		expect(t?.similar.map((s) => s.id)).toEqual(['m2']);
		await provider.title('m1');
		expect(n).toBe(1); // fresh detail from the cache
		expect(await provider.title('missing')).toBeNull();
	});

	it('title(): falls back to a cached (stale) detail when offline', async () => {
		let offline = false;
		let now = 0;
		const calls: string[] = [];
		const client = new BackendClient({
			baseUrl: () => BASE,
			getToken: () => 't',
			sleep: async () => {},
			fetch: (async (u: string) => {
				calls.push(u);
				if (offline) throw new TypeError('offline');
				return json({ ...card('m1'), variants: [], cast: [], sourceIds: [], rawRefs: [] });
			}) as unknown as typeof fetch
		});
		const provider = new RemoteProvider({
			client,
			cache: new LruCache<CacheEntry>({ maxItems: 10, maxBytes: 1e6 }),
			snapshots: memorySnapshots(),
			now: () => now
		});
		await provider.title('m1');
		now = 60 * 60_000; // stale
		offline = true;
		const t = await provider.title('m1');
		expect(t?.id).toBe('m1');
	});

	it('search(): maps groups and akas, kids filter on top of the server', async () => {
		const { provider } = setup(() =>
			json({
				query: 'licht',
				total: 3,
				movies: [card('m1', { kidsSafe: true }), card('m2')],
				series: [],
				people: [{ name: 'Ann', titles: [card('m1', { kidsSafe: true })] }],
				channels: [{ id: 'c1', name: 'Een', group: 'NL', languages: ['nl'] }],
				genres: [{ slug: 'drama', name: 'Drama', count: 4 }],
				akas: { m1: 'Het Laatste Licht' }
			})
		);
		const r = await provider.search('licht', { kids: true });
		expect(r.movies.map((h) => h.title.id)).toEqual(['m1']);
		expect(r.movies[0].aka).toBe('Het Laatste Licht');
		expect(r.people[0].titles).toHaveLength(1);
		expect(r.channels[0].channel.id).toBe('c1');
		expect(r.genres[0]).toMatchObject({ slug: 'drama', genre: 'Drama' });
	});

	it('titles(): passes the cursor through and only caches the first page', async () => {
		const { provider, calls, cache } = setup((url) =>
			json({
				items: [card(url.searchParams.get('cursor') ? 'p2' : 'p1')],
				nextCursor: url.searchParams.get('cursor') ? undefined : 'abc',
				total: 2
			})
		);
		const first = await provider.titles({ kind: 'movie', sort: 'popular' });
		expect(first.nextCursor).toBe('abc');
		const second = await provider.titles({ kind: 'movie', sort: 'popular', cursor: 'abc' });
		expect(second.items[0].id).toBe('p2');
		expect(calls[1].url.searchParams.get('cursor')).toBe('abc');
		expect(cache.has('c:p1')).toBe(true);
		expect(cache.has('c:p2')).toBe(false);
	});

	it('epg(): splits in chunks of 50 channels', async () => {
		const { provider, calls } = setup((url) => {
			const ids = url.searchParams.get('channels')!.split(',');
			return json(
				Object.fromEntries(
					ids.map((id) => [id, [{ channelId: id, start: 1, stop: 2, title: 'x' }]])
				)
			);
		});
		const ids = Array.from({ length: 120 }, (_, i) => 'e' + i);
		const r = await provider.epg(ids, 0, 3_600_000);
		expect(calls).toHaveLength(3);
		expect(Object.keys(r)).toHaveLength(120);
	});

	it('rethrows non-network errors', async () => {
		const { provider } = setup(() => json({ error: 'internal' }, 500));
		await expect(provider.home({ kids: false })).rejects.toBeInstanceOf(BackendError);
	});

	it('toCard() strips variants and seasons', () => {
		const c = toCard({
			...card('s1', { kind: 'series' }),
			cast: [],
			variants: [],
			seasons: [{ number: 1, episodes: [] }],
			sourceIds: [],
			rawRefs: []
		} as never);
		expect('variants' in c).toBe(false);
		expect('seasons' in c).toBe(false);
		expect(c.seasonCount).toBe(1);
	});
});
