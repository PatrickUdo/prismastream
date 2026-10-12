import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { after, afterEach, before, describe, it } from 'node:test';
import { unseal } from '../src/keys.ts';
import { newAccount, setup } from './helpers.ts';
import { PASS, startMockIptv, USER, type MockIptv } from './mock-iptv.ts';

let ctx: ReturnType<typeof setup> | undefined;
let mock: MockIptv;

before(async () => {
	mock = await startMockIptv({ movies: 30, series: 6, channels: 8 });
});
after(async () => {
	await mock.close();
});
afterEach(async () => {
	await ctx?.dispose();
	ctx = undefined;
});

type Json = Record<string, any>;

async function get(path: string, token: string, init: RequestInit = {}): Promise<Json> {
	const res = await ctx!.call(path, { ...init, token });
	assert.equal(res.status, 200, `${path} → ${res.status} ${await res.clone().text()}`);
	return (await res.json()) as Json;
}

async function withXtream(overrides = {}) {
	ctx = setup({ proxyAllowPrivate: true, demoSource: false, ...overrides });
	const a = await newAccount(ctx.call);
	const res = await ctx.call('/v1/sources', {
		method: 'POST',
		token: a.token,
		json: { type: 'xtream', name: 'Mock', serverUrl: mock.url, username: USER, password: PASS }
	});
	assert.equal(res.status, 201);
	const src = (await res.json()) as Json;
	await ctx.catalog!.queue.idle();
	return { a, src };
}

/** Every file under a directory, gunzipped when needed, as one string. */
function dumpDir(dir: string): string {
	let out = '';
	for (const name of readdirSync(dir)) {
		const p = join(dir, name);
		if (statSync(p).isDirectory()) out += dumpDir(p);
		else {
			const buf = readFileSync(p);
			out += buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf).toString('latin1') : buf.toString('latin1');
		}
	}
	return out;
}

describe('sources', () => {
	it('CRUD with encrypted secrets: the password is never stored or returned in clear', async () => {
		ctx = setup({ proxyAllowPrivate: true });
		const a = await newAccount(ctx.call);
		const list0 = (await get('/v1/sources', a.token)) as unknown as Json[];
		assert.deepEqual(
			list0.map((s) => s.id),
			['sample'],
			'demo source present by default (DEMO_SOURCE on in tests)'
		);

		let res = await ctx.call('/v1/sources', {
			method: 'POST',
			token: a.token,
			json: { type: 'xtream', name: 'Mijn IPTV', serverUrl: mock.url, username: USER, password: PASS }
		});
		assert.equal(res.status, 201);
		const text = await res.text();
		assert.ok(!text.includes(PASS));
		const src = JSON.parse(text) as Json;
		assert.match(src.id, /^s_/);
		assert.equal(src.username, USER);
		assert.equal(src.password, undefined);

		const row = ctx.store.db
			.prepare('SELECT * FROM sources WHERE id = ?')
			.get(src.id) as Record<string, string>;
		assert.ok(!JSON.stringify(row).includes(PASS), 'no clear password in the database');
		assert.match(row.secret, /^v1\./);
		const opened = JSON.parse(unseal(ctx.keys.secrets, row.secret, `source:${a.accountId}:${src.id}`));
		assert.equal(opened.password, PASS);
		// Sealed values are bound to their row (AAD): another source id does not open it.
		assert.throws(() => unseal(ctx!.keys.secrets, row.secret, `source:${a.accountId}:other`));

		// M3U: the playlist url (with credentials) is masked in responses.
		res = await ctx.call('/v1/sources', {
			method: 'POST',
			token: a.token,
			json: { type: 'm3u', playlistUrl: `${mock.url}/get.php?username=${USER}&password=${PASS}&type=m3u_plus` }
		});
		const m3u = (await res.json()) as Json;
		assert.equal(res.status, 201);
		assert.ok(!JSON.stringify(m3u).includes(PASS));
		assert.match(m3u.playlistUrl, /password=\*\*\*/);

		res = await ctx.call(`/v1/sources/${src.id}`, {
			method: 'PATCH',
			token: a.token,
			json: { name: 'Hernoemd', enabled: false }
		});
		assert.equal(res.status, 200);
		const patched = (await res.json()) as Json;
		assert.equal(patched.name, 'Hernoemd');
		assert.equal(patched.enabled, false);

		// The demo library can only be switched off.
		res = await ctx.call('/v1/sources/sample', { method: 'DELETE', token: a.token });
		assert.equal((await res.json()).disabled, true);
		const list1 = (await get('/v1/sources', a.token)) as unknown as Json[];
		assert.equal(list1.find((s) => s.id === 'sample')!.enabled, false);

		res = await ctx.call(`/v1/sources/${src.id}`, { method: 'DELETE', token: a.token });
		assert.equal(res.status, 200);
		const list2 = (await get('/v1/sources', a.token)) as unknown as Json[];
		assert.ok(!list2.some((s) => s.id === src.id));

		// Another account cannot see or touch the source.
		const b = await newAccount(ctx.call);
		res = await ctx.call(`/v1/sources/${m3u.id}`, { method: 'DELETE', token: b.token });
		assert.equal(res.status, 404);
		await ctx.catalog!.queue.idle();
		const all = dumpDir(ctx.dataDir);
		assert.ok(!all.includes(PASS), 'no clear password in any data file (cache, catalog.db)');
	});

	it('validates input and blocks private addresses without PROXY_ALLOW_PRIVATE', async () => {
		ctx = setup();
		const a = await newAccount(ctx.call);
		let res = await ctx.call('/v1/sources', {
			method: 'POST',
			token: a.token,
			json: { type: 'xtream', serverUrl: 'http://example.com' }
		});
		assert.equal(res.status, 400);
		res = await ctx.call('/v1/sources', {
			method: 'POST',
			token: a.token,
			json: { type: 'm3u', playlistUrl: 'http://127.0.0.1:1/x.m3u' }
		});
		assert.equal(res.status, 400);
		assert.equal((await res.json()).error, 'blocked_address');
		res = await ctx.call('/v1/sources/test', {
			method: 'POST',
			token: a.token,
			json: { type: 'xtream', serverUrl: 'http://169.254.169.254', username: 'a', password: 'b' }
		});
		assert.equal((await res.json()).code, 'blocked_address');
	});

	it('hides the demo source when DEMO_SOURCE is off', async () => {
		ctx = setup({ demoSource: false });
		const a = await newAccount(ctx.call);
		assert.deepEqual(await get('/v1/sources', a.token), []);
		assert.equal((await ctx.call('/v1/sources/sample', { method: 'DELETE', token: a.token })).status, 404);
		await get('/v1/catalog/meta', a.token);
		await ctx.catalog!.queue.idle();
		const meta = await get('/v1/catalog/meta', a.token);
		assert.equal(meta.counts.movies, 0);
		assert.equal(meta.status, 'ready');
	});

	it('POST /v1/sources/test reports counts and clear error codes', async () => {
		ctx = setup({ proxyAllowPrivate: true });
		const a = await newAccount(ctx.call);
		const test = (json: Json) =>
			ctx!.call('/v1/sources/test', { method: 'POST', token: a.token, json }).then((r) => r.json() as Promise<Json>);
		const ok = await test({ type: 'xtream', serverUrl: mock.url, username: USER, password: PASS });
		assert.equal(ok.ok, true);
		assert.equal(ok.movies, 30);
		assert.equal(ok.series, 6);
		assert.equal(ok.channels, 8);
		assert.equal(ok.status, 'Active');
		// Pasted get.php url with credentials works too.
		const pasted = await test({ type: 'xtream', serverUrl: `${mock.url}/get.php?username=${USER}&password=${PASS}` });
		assert.equal(pasted.ok, true);

		const bad = await test({ type: 'xtream', serverUrl: mock.url, username: USER, password: 'wrong-password' });
		assert.equal(bad.ok, false);
		assert.equal(bad.code, 'auth');
		assert.ok(!JSON.stringify(bad).includes('wrong-password'));

		const m3u = await test({ type: 'm3u', playlistUrl: `${mock.url}/get.php?username=${USER}&password=${PASS}` });
		assert.equal(m3u.ok, true);
		assert.equal(m3u.channels, 8);
		assert.equal(m3u.movies, 4);
		assert.equal(m3u.series, 1);
		assert.ok(!JSON.stringify(m3u).includes(PASS), 'EPG suggestion is masked');

		const banned = await startMockIptv({ apiStatus: 403 });
		const b = await test({ type: 'xtream', serverUrl: banned.url, username: USER, password: PASS });
		await banned.close();
		assert.equal(b.code, 'banned_ip');
		assert.ok(!b.message.includes(PASS));

		const expired = await startMockIptv({ expired: true });
		const e = await test({ type: 'xtream', serverUrl: expired.url, username: USER, password: PASS });
		await expired.close();
		assert.equal(e.code, 'expired');
		assert.ok(e.expiresAt < Date.now());

		const down = await test({ type: 'm3u', playlistUrl: 'http://127.0.0.1:9/none.m3u' });
		assert.equal(down.code, 'unreachable');
		const html = await test({ type: 'm3u', playlistUrl: `${mock.url}/nothing-here` });
		assert.equal(html.code, 'http');
	});
});

describe('catalog build and API', () => {
	it('builds from a mock Xtream source and serves meta, home, titles and details', async () => {
		const { a, src } = await withXtream();
		const meta = await get('/v1/catalog/meta', a.token);
		assert.equal(meta.status, 'ready');
		assert.equal(meta.counts.movies, 15, '30 entries in two languages → 15 merged films');
		assert.equal(meta.counts.series, 6);
		assert.equal(meta.counts.channels, 8);
		assert.ok(meta.counts.programmes > 0);
		assert.ok(meta.genres.some((g: Json) => g.slug === 'action' && g.name === 'Actie'));
		assert.ok(meta.languages.some((l: Json) => l.lang === 'nl'));
		assert.ok(meta.groups.length >= 1);

		const sources = (await get('/v1/sources', a.token)) as unknown as Json[];
		const s = sources.find((x) => x.id === src.id)!;
		assert.ok(s.lastSyncAt > 0);
		assert.equal(s.stats.movies, 30);
		assert.equal(s.account.status, 'Active');
		assert.equal(s.lastError, undefined);

		const home = await get('/v1/catalog/home?limit=5', a.token);
		assert.equal(home.recent.length, 5);
		assert.ok(home.featured.length > 0);
		assert.ok(home.popularMovies.every((t: Json) => t.kind === 'movie'));
		assert.ok(home.trendingSeries.every((t: Json) => t.kind === 'series'));
		assert.ok(home.live.length > 0 && home.live[0].variantCount >= 1 && !home.live[0].variants);
		// Cards are light: no variants, no seasons.
		for (const t of home.recent) {
			assert.equal(t.variants, undefined);
			assert.equal(t.seasons, undefined);
			assert.ok(Array.isArray(t.altTitles) && t.altTitles.length <= 12);
		}

		const movie = home.popularMovies[0];
		const d = await get(`/v1/catalog/titles/${encodeURIComponent(movie.id)}`, a.token);
		assert.equal(d.variants.length, 2, 'both language versions are variants');
		for (const v of d.variants) {
			assert.match(v.url, /^http:\/\/sync\.test\/v1\/play\/pt_[A-Za-z0-9_-]{43}\/[A-Za-z0-9_-]+\.mkv$/);
			assert.equal(v.upstreamHttp, true);
		}
		assert.ok(Array.isArray(d.similar));
		assert.ok(!JSON.stringify(d).includes(PASS));
		assert.ok(!JSON.stringify(d).includes(USER), 'no username in play urls either');

		// Lazy series: episodes are loaded server-side on first detail request and cached.
		const series = await get('/v1/catalog/titles?kind=series&limit=1', a.token);
		const before = mock.requests.filter((r) => r.includes('get_series_info')).length;
		const sd = await get(`/v1/catalog/titles/${encodeURIComponent(series.items[0].id)}`, a.token);
		assert.equal(sd.seasons.length, 2);
		assert.equal(sd.seasons[0].episodes.length, 3);
		assert.match(sd.seasons[0].episodes[0].variants[0].url, /\/v1\/play\/pt_/);
		assert.ok(sd.cast.length >= 2, 'series info fills metadata');
		await get(`/v1/catalog/titles/${encodeURIComponent(series.items[0].id)}`, a.token);
		assert.equal(mock.requests.filter((r) => r.includes('get_series_info')).length, before + 1);
		const card = await get(`/v1/catalog/titles?ids=${encodeURIComponent(series.items[0].id)}`, a.token);
		assert.equal(card.items[0].seasonCount, 2);

		// A rebuild keeps the loaded seasons (cat_series).
		ctx!.catalog!.refresh(a.accountId);
		await ctx!.catalog!.queue.idle();
		const again = await get(`/v1/catalog/titles/${encodeURIComponent(series.items[0].id)}`, a.token);
		assert.equal(again.seasons.length, 2);
		assert.equal(mock.requests.filter((r) => r.includes('get_series_info')).length, before + 1);

		// Unknown title, other account.
		assert.equal((await ctx!.call('/v1/catalog/titles/nope', { token: a.token })).status, 404);
		const b = await newAccount(ctx!.call);
		assert.equal(
			(await ctx!.call(`/v1/catalog/titles/${encodeURIComponent(movie.id)}`, { token: b.token })).status,
			404
		);
	});

	it('builds from an M3U source with a gzip XMLTV from the header', async () => {
		ctx = setup({ proxyAllowPrivate: true, demoSource: false });
		const a = await newAccount(ctx.call);
		const gz = await startMockIptv({ gzipEpg: true, channels: 4 });
		const res = await ctx.call('/v1/sources', {
			method: 'POST',
			token: a.token,
			json: { type: 'm3u', playlistUrl: `${gz.url}/get.php?username=${USER}&password=${PASS}` }
		});
		assert.equal(res.status, 201);
		await ctx.catalog!.queue.idle();
		await gz.close();
		const meta = await get('/v1/catalog/meta', a.token);
		assert.equal(meta.counts.channels, 4);
		assert.equal(meta.counts.movies, 4);
		assert.equal(meta.counts.series, 1);
		assert.ok(meta.counts.programmes > 0, 'EPG from the url-tvg header (gzip) loaded');
		const ch = await get('/v1/catalog/channels', a.token);
		assert.equal(ch.items.length, 4);
		assert.match(ch.items[0].variants[0].url, /\/v1\/play\/pt_.+\.ts$/);
	});

	it('paginates with cursors, sorts and filters', async () => {
		const { a } = await withXtream({ demoSource: true });
		const all = await get('/v1/catalog/titles?limit=500', a.token);
		const total = all.total;
		assert.equal(all.items.length, total);
		assert.equal(all.nextCursor, undefined);
		for (const sort of ['popular', 'new', 'az', 'year']) {
			const seen: string[] = [];
			let cursor: string | undefined;
			let pages = 0;
			do {
				const page = await get(
					`/v1/catalog/titles?sort=${sort}&limit=17${cursor ? `&cursor=${cursor}` : ''}`,
					a.token
				);
				assert.equal(page.total, total);
				seen.push(...page.items.map((t: Json) => t.id));
				cursor = page.nextCursor;
				pages++;
			} while (cursor && pages < 100);
			assert.equal(seen.length, total, `${sort}: every title once`);
			assert.equal(new Set(seen).size, total, `${sort}: no duplicates`);
		}
		const az = await get('/v1/catalog/titles?sort=az&limit=40', a.token);
		const names: string[] = az.items.map((t: Json) => t.title.toLowerCase());
		for (let i = 1; i < names.length; i++)
			if (/^[a-z0-9 ]+$/.test(names[i - 1] + names[i])) assert.ok(names[i - 1] <= names[i], `${names[i - 1]} <= ${names[i]}`);
		const pop = await get('/v1/catalog/titles?sort=popular&limit=20', a.token);
		for (let i = 1; i < pop.items.length; i++)
			assert.ok(pop.items[i - 1].popularity >= pop.items[i].popularity);
		const newest = await get('/v1/catalog/titles?sort=new&limit=20', a.token);
		for (let i = 1; i < newest.items.length; i++)
			assert.ok(newest.items[i - 1].addedAt >= newest.items[i].addedAt);

		const movies = await get('/v1/catalog/titles?kind=movie&limit=500', a.token);
		assert.ok(movies.items.every((t: Json) => t.kind === 'movie'));
		const action = await get('/v1/catalog/titles?genre=action&limit=500', a.token);
		assert.ok(action.total > 0);
		assert.ok(action.items.every((t: Json) => t.genres.includes('Actie')));
		const de = await get('/v1/catalog/titles?lang=de&limit=500', a.token);
		assert.ok(de.total > 0);
		assert.ok(de.items.every((t: Json) => t.languages.includes('de')));
		const ids = await get(`/v1/catalog/titles?ids=${movies.items[2].id},nope,${movies.items[0].id}`, a.token);
		assert.deepEqual(
			ids.items.map((t: Json) => t.id),
			[movies.items[2].id, movies.items[0].id]
		);
		assert.equal((await ctx!.call('/v1/catalog/titles?genre=../x', { token: a.token })).status, 400);
		// A garbage cursor is ignored (first page).
		const garbage = await get('/v1/catalog/titles?limit=3&cursor=%%%', a.token);
		assert.equal(garbage.items.length, 3);
	});

	it('kids filter on titles, home, search, channels and details', async () => {
		const { a } = await withXtream({ demoSource: true });
		const kidsTitles = await get('/v1/catalog/titles?kids=1&limit=500', a.token);
		const allTitles = await get('/v1/catalog/titles?limit=500', a.token);
		assert.ok(kidsTitles.total > 0 && kidsTitles.total < allTitles.total);
		assert.ok(kidsTitles.items.every((t: Json) => t.kidsSafe === true));
		const home = await get('/v1/catalog/home?kids=1', a.token);
		for (const row of ['featured', 'recent', 'popularMovies', 'trendingSeries'])
			assert.ok(home[row].every((t: Json) => t.kidsSafe === true), row);
		assert.ok(home.live.every((c: Json) => /kid|kind|jeugd|famil|anima|cartoon|toon/i.test(c.group)));
		const ch = await get('/v1/catalog/channels?kids=1', a.token);
		assert.ok(ch.items.length > 0);
		assert.ok(ch.items.every((c: Json) => /kid|kind|jeugd|famil|anima|cartoon|toon/i.test(c.group)));
		const adult = allTitles.items.find((t: Json) => t.kidsSafe !== true);
		const r = await ctx!.call(`/v1/catalog/titles/${encodeURIComponent(adult.id)}?kids=1`, { token: a.token });
		assert.equal(r.status, 403);
		const s = await get('/v1/catalog/search?q=mock&kids=1', a.token);
		assert.ok([...s.movies, ...s.series].every((t: Json) => t.kidsSafe === true));
		const meta = await get('/v1/catalog/meta?kids=1', a.token);
		assert.equal(meta.counts.movies + meta.counts.series, kidsTitles.total);
	});

	it('search: titles, alternative titles, people, channels and genres', async () => {
		const { a } = await withXtream({ demoSource: true });
		const r = await get('/v1/catalog/search?q=mock%20film%203', a.token);
		assert.equal(r.query, 'mock film 3');
		assert.ok(r.movies.length > 0);
		assert.equal(r.movies[0].title, 'Mock Film 3');
		assert.equal(r.movies[0].variants, undefined);
		const demo = await get('/v1/catalog/search?q=laatste%20licht', a.token);
		assert.ok(demo.movies.some((t: Json) => demo.akas[t.id]), 'match on a translated title → aka');
		const ch = await get('/v1/catalog/search?q=zender', a.token);
		assert.ok(ch.channels.length > 0 && ch.channels[0].variantCount >= 1);
		assert.equal(ch.channels[0].variants, undefined);
		const g = await get('/v1/catalog/search?q=actie', a.token);
		assert.ok(g.genres.some((x: Json) => x.slug === 'action'));
		const empty = await get('/v1/catalog/search?q=', a.token);
		assert.equal(empty.total, 0);
		const rec = await ctx!.call('/v1/catalog/recommend', {
			method: 'POST',
			token: a.token,
			json: { history: [r.movies[0].id], favorites: [], limit: 5 }
		});
		const recBody = (await rec.json()) as Json;
		assert.equal(recBody.items.length, 5);
		assert.ok(!recBody.items.some((t: Json) => t.id === r.movies[0].id), 'watched titles excluded');
	});

	it('EPG window, max 48 hours, and now/next', async () => {
		const { a } = await withXtream();
		const ch = await get('/v1/catalog/channels', a.token);
		const c = ch.items.find((x: Json) => x.epgId);
		assert.ok(c, 'channel with epgId');
		const now = Date.now();
		const epg = await get(
			`/v1/catalog/epg?channels=${encodeURIComponent(c.epgId)}&from=${now - 3600_000}&to=${now + 3 * 3600_000}`,
			a.token
		);
		const list = epg[c.epgId];
		assert.ok(list.length >= 3 && list.length <= 5);
		for (const p of list) {
			assert.ok(p.stop > now - 3600_000 && p.start < now + 3 * 3600_000);
			assert.equal(p.channelId, c.epgId);
		}
		assert.equal(list[0].desc, 'Omschrijving & meer');
		// The window is capped at 48 h, and the source window keeps -6 h .. +48 h.
		const wide = await get(
			`/v1/catalog/epg?channels=${encodeURIComponent(c.epgId)}&from=${now - 24 * 3600_000}&to=${now + 30 * 24 * 3600_000}`,
			a.token
		);
		const w = wide[c.epgId];
		assert.ok(w.every((p: Json) => p.start < now - 24 * 3600_000 + 48 * 3600_000));
		assert.ok(w.every((p: Json) => p.stop > now - 6 * 3600_000 - 1000), 'nothing older than 6 h kept');
		const nn = await get(`/v1/catalog/nownext?channels=${c.id},nope`, a.token);
		assert.ok(nn[c.id].now.start <= now && nn[c.id].now.stop > now);
		assert.ok(nn[c.id].next.start >= nn[c.id].now.stop);
		assert.deepEqual(nn.nope, {});
	});

	it('ETag and 304 Not Modified', async () => {
		const { a } = await withXtream();
		for (const path of ['/v1/catalog/meta', '/v1/catalog/home', '/v1/catalog/titles?limit=5', '/v1/catalog/search?q=mock']) {
			const r1 = await ctx!.call(path, { token: a.token });
			const etag = r1.headers.get('etag');
			assert.ok(etag, path);
			assert.match(r1.headers.get('cache-control') ?? '', /private/);
			const r2 = await ctx!.call(path, { token: a.token, headers: { 'if-none-match': etag! } });
			assert.equal(r2.status, 304, path);
			assert.equal(await r2.text(), '');
			const r3 = await ctx!.call(path, { token: a.token, headers: { 'if-none-match': 'W/"other"' } });
			assert.equal(r3.status, 200);
		}
		// CORS lets browsers send If-None-Match and PATCH.
		const pre = await ctx!.call('/v1/catalog/meta', {
			method: 'OPTIONS',
			headers: {
				origin: 'capacitor://localhost',
				'access-control-request-method': 'PATCH',
				'access-control-request-headers': 'authorization,if-none-match'
			}
		});
		assert.match(pre.headers.get('access-control-allow-headers') ?? '', /If-None-Match/i);
		assert.match(pre.headers.get('access-control-allow-methods') ?? '', /PATCH/);
	});

	it('refresh endpoint queues a build (202) and reports the status', async () => {
		const { a } = await withXtream();
		const r = await ctx!.call('/v1/catalog/refresh', { method: 'POST', token: a.token, json: { force: true } });
		assert.equal(r.status, 202);
		const meta = await get('/v1/catalog/meta', a.token);
		assert.equal(meta.status, 'building');
		await ctx!.catalog!.queue.idle();
		assert.equal((await get('/v1/catalog/meta', a.token)).status, 'ready');
	});

	it('scheduler refreshes accounts with real sources after the period (spread)', async () => {
		const { a } = await withXtream({ catalogRefreshHours: 12 });
		const cat = ctx!.catalog!;
		cat.tick();
		assert.equal(cat.queue.status(a.accountId).state, 'idle', 'fresh build: nothing to do');
		cat.tick(Date.now() + 14 * 3600_000);
		assert.equal(cat.queue.status(a.accountId).state, 'queued');
		await cat.queue.idle();
		// Inactive accounts (no device seen for 30 days) are skipped.
		ctx!.store.db.prepare('UPDATE devices SET last_seen_at = 0').run();
		cat.tick(Date.now() + 14 * 3600_000);
		assert.equal(cat.queue.status(a.accountId).state, 'idle');
	});

	it('deleting the account removes catalog rows and caches', async () => {
		const { a } = await withXtream();
		const db = ctx!.catalog!.db;
		const n = () =>
			Number((db.prepare('SELECT COUNT(*) AS n FROM cat_titles WHERE account_id = ?').get(a.accountId) as Json).n);
		assert.ok(n() > 0);
		assert.equal((await ctx!.call('/v1/account', { method: 'DELETE', token: a.token })).status, 204);
		assert.equal(n(), 0);
		assert.throws(() => statSync(join(ctx!.dataDir, 'cache', a.accountId)));
	});
});

describe('play urls', () => {
	it('302 to the real url, never logging credentials; tokens are per device and revocable', async () => {
		const logs: string[] = [];
		const orig = { log: console.log, warn: console.warn, error: console.error };
		const capture = (...args: unknown[]) => logs.push(args.map(String).join(' '));
		console.log = console.warn = console.error = capture;
		try {
			const { a } = await withXtream({ log: true });
			const movies = await get('/v1/catalog/titles?kind=movie&limit=1', a.token);
			const d = await get(`/v1/catalog/titles/${encodeURIComponent(movies.items[0].id)}`, a.token);
			const playPath = new URL(d.variants[0].url).pathname;
			const r = await ctx!.call(playPath, { redirect: 'manual' });
			assert.equal(r.status, 302);
			const loc = r.headers.get('location')!;
			assert.ok(loc.startsWith(`${mock.url}/movie/${USER}/${PASS}/`));
			assert.equal(r.headers.get('cache-control'), 'no-store');

			// Live: the .ts fallback is an alt url.
			const ch = await get('/v1/catalog/channels', a.token);
			const v = ch.items[0].variants[0];
			assert.match(v.url, /\.m3u8$/);
			assert.equal(v.altUrls.length, 1);
			const alt = await ctx!.call(new URL(v.altUrls[0]).pathname, { redirect: 'manual' });
			assert.match(alt.headers.get('location')!, /\.ts$/);

			// via=proxy: HLS is rewritten so segments and keys go through /v1/play (no credentials).
			const hls = await ctx!.call(new URL(v.url).pathname + '?via=proxy');
			assert.equal(hls.status, 200);
			assert.equal(hls.headers.get('x-accel-buffering'), 'no');
			const playlist = await hls.text();
			assert.ok(!playlist.includes(PASS) && !playlist.includes(USER), 'no credentials in the playlist');
			const segs = playlist.split('\n').filter((l) => l.startsWith('http'));
			assert.equal(segs.length, 2);
			assert.ok(segs.every((s) => s.includes('/v1/play/pt_') && s.includes('/s/')));
			assert.match(playlist, /URI="http:\/\/sync\.test\/v1\/play\/pt_[^"]+\/s\/[^"]+"/);
			const seg = await ctx!.call(new URL(segs[0]).pathname);
			assert.equal(seg.status, 200);
			assert.equal((await seg.arrayBuffer()).byteLength, 4096);

			// via=proxy for VOD: Range requests pass through.
			const ranged = await ctx!.call(playPath + '?via=proxy', { headers: { range: 'bytes=100-199' } });
			assert.equal(ranged.status, 206);
			assert.equal(ranged.headers.get('content-range'), 'bytes 100-199/4096');
			assert.equal((await ranged.arrayBuffer()).byteLength, 100);

			// A tampered segment or unknown variant → 404; a wrong token → 401.
			const tokenPart = playPath.split('/')[3];
			assert.equal((await ctx!.call(`/v1/play/${tokenPart}/s/AAAA`)).status, 404);
			assert.equal((await ctx!.call(`/v1/play/${tokenPart}/bm9wZQ`)).status, 404);
			assert.equal((await ctx!.call(`/v1/play/pt_${'x'.repeat(43)}/bm9wZQ`)).status, 401);
			// The API token is not a play token.
			assert.equal((await ctx!.call(`/v1/play/${a.token}/bm9wZQ`)).status, 401);

			// Rotating the token revokes the old play urls.
			const rot = await ctx!.call('/v1/play-token', { method: 'POST', token: a.token });
			const { playToken, prefix } = (await rot.json()) as Json;
			assert.notEqual(playToken, tokenPart);
			assert.equal(prefix, `http://sync.test/v1/play/${playToken}/`);
			assert.equal((await ctx!.call(playPath, { redirect: 'manual' })).status, 401);
			const fresh = await ctx!.call(playPath.replace(tokenPart, playToken), { redirect: 'manual' });
			assert.equal(fresh.status, 302);
			const cur = (await get('/v1/play-token', a.token)) as Json;
			assert.equal(cur.playToken, playToken);
		} finally {
			Object.assign(console, orig);
		}
		const all = logs.join('\n');
		assert.ok(all.includes('/v1/play/***'), 'play requests are logged redacted');
		assert.ok(!all.includes(PASS), 'no password in logs');
		assert.ok(!all.includes('pt_'), 'no play token in logs');
	});
});

describe('signup', () => {
	it('closed signup accepts only the invitation code (timing-safe)', async () => {
		ctx = setup({ allowSignup: false, signupCode: 'uitnodiging-2026' });
		const post = (json: Json) => ctx!.call('/v1/accounts', { method: 'POST', json });
		assert.equal((await post({ deviceName: 'x' })).status, 403);
		assert.equal((await post({ signupCode: 'fout' })).status, 403);
		assert.equal((await post({ signupCode: 'uitnodiging-2026' })).status, 201);
		ctx.limiter.dispose();
	});

	it('production defaults: no open signup, and a SERVER_KEY is required', async () => {
		const { loadConfig } = await import('../src/config.ts');
		const { loadMasterKey } = await import('../src/keys.ts');
		const c = loadConfig({ NODE_ENV: 'production', DATA_DIR: '/nonexistent' });
		assert.equal(c.allowSignup, false);
		assert.equal(c.demoSource, false);
		assert.throws(() => loadMasterKey(c), /SERVER_KEY/);
		const k = Buffer.alloc(32, 7).toString('base64');
		assert.equal(loadMasterKey(loadConfig({ NODE_ENV: 'production', SERVER_KEY: k })).length, 32);
		assert.throws(() => loadMasterKey(loadConfig({ SERVER_KEY: 'dG9vIHNob3J0' })), /32 bytes/);
	});
});
