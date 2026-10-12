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
			// Direct upstream url, credentials filled in for this account (device streams itself).
			assert.ok(v.url.startsWith(`${mock.url}/movie/${USER}/${PASS}/`), v.url);
			assert.match(v.url, /\.mkv$/);
			assert.equal(v.upstreamHttp, true);
		}
		assert.ok(Array.isArray(d.similar));
		assert.ok(!JSON.stringify(d.similar).includes(PASS), 'cards never contain stream urls');

		// Lazy series: episodes are loaded server-side on first detail request and cached.
		const series = await get('/v1/catalog/titles?kind=series&limit=1', a.token);
		const before = mock.requests.filter((r) => r.includes('get_series_info')).length;
		const sd = await get(`/v1/catalog/titles/${encodeURIComponent(series.items[0].id)}`, a.token);
		assert.equal(sd.seasons.length, 2);
		assert.equal(sd.seasons[0].episodes.length, 3);
		assert.ok(sd.seasons[0].episodes[0].variants[0].url.startsWith(`${mock.url}/series/${USER}/${PASS}/`));
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
		assert.ok(ch.items[0].variants[0].url.startsWith(`${gz.url}/live/${USER}/${PASS}/`));
		assert.match(ch.items[0].variants[0].url, /\.ts$/);
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
			Number((db.prepare('SELECT COUNT(*) AS n FROM cat_titles WHERE account_id GLOB ?').get(`${a.accountId}@*`) as Json).n);
		assert.ok(n() > 0);
		assert.equal((await ctx!.call('/v1/account', { method: 'DELETE', token: a.token })).status, 204);
		assert.equal(n(), 0);
		assert.throws(() => statSync(join(ctx!.dataDir, 'cache', a.accountId)));
	});
});

describe('robust, memory-lean builds', () => {
	it('a failed build reports status error and keeps the previous catalog', async () => {
		const { a } = await withXtream();
		const before = await get('/v1/catalog/titles?limit=500', a.token);
		assert.ok(before.total > 0);
		// Too little heap for the build worker: it runs out of memory.
		ctx!.catalog!.config.buildMemoryMb = 4;
		ctx!.catalog!.refresh(a.accountId, { force: true });
		await ctx!.catalog!.queue.idle();
		const meta = await get('/v1/catalog/meta', a.token);
		assert.equal(meta.status, 'error');
		assert.equal(meta.errorCode, 'too_large');
		assert.match(meta.error, /te groot/);
		assert.equal(meta.counts.movies, 15, 'counts of the previous catalog');
		const after = await get('/v1/catalog/titles?limit=500', a.token);
		assert.deepEqual(after, before, 'the previous catalog stays available');
		const db = ctx!.catalog!.db;
		const keys = db
			.prepare('SELECT DISTINCT account_id FROM cat_titles WHERE account_id GLOB ?')
			.all(`${a.accountId}@*`) as Json[];
		assert.equal(keys.length, 1, 'no staging rows left behind');
		// The next good build clears the error.
		ctx!.catalog!.config.buildMemoryMb = 256;
		ctx!.catalog!.refresh(a.accountId);
		await ctx!.catalog!.queue.idle();
		const ok = await get('/v1/catalog/meta', a.token);
		assert.equal(ok.status, 'ready');
		assert.equal(ok.error, undefined);
	});

	it('merging in small batches gives the same titles as one big merge', async () => {
		const { runBuild } = await import('../src/catalog/build.ts');
		const { openCatalogDb, genKey } = await import('../src/catalog/db.ts');
		const { mkdtempSync, rmSync } = await import('node:fs');
		const { tmpdir } = await import('node:os');
		const dir = mkdtempSync(join(tmpdir(), 'ps-batch-'));
		const snapshot = async (batchItems: number) => {
			const db = openCatalogDb(join(dir, `c${batchItems}.db`));
			await runBuild(
				{
					accountId: 'a_x',
					dataDir: dir,
					catalogDbPath: '',
					sources: [{ id: 'sample', type: 'sample', name: 'Demo', enabled: true, updatedAt: 0 }],
					force: [],
					preferLang: 'nl',
					limits: {} as never,
					ttl: { catalogMs: 1, epgMs: 1, seriesMs: 1 },
					batchItems
				},
				() => {},
				db
			);
			const gen = (db.prepare('SELECT gen FROM cat_state').get() as Json).gen;
			const rows = db
				.prepare('SELECT id, card FROM cat_titles WHERE account_id = ? ORDER BY id')
				.all(genKey('a_x', gen)) as Json[];
			const variants = db
				.prepare('SELECT COUNT(*) AS n FROM cat_variants WHERE account_id = ?')
				.get(genKey('a_x', gen)) as Json;
			db.close();
			return { rows: rows.map((r) => [r.id, JSON.parse(r.card).languages.join(',')]), variants: variants.n };
		};
		const one = await snapshot(1_000_000);
		const small = await snapshot(20);
		rmSync(dir, { recursive: true, force: true });
		assert.ok(one.rows.length > 50);
		assert.deepEqual(small.rows, one.rows);
		assert.equal(small.variants, one.variants);
	});

	it('awkward Xtream data: U+2028/U+2029/\\r in names and one broken item', async () => {
		const odd = await startMockIptv({ movies: 60, series: 4, channels: 4, tricky: true, rich: false });
		try {
			ctx = setup({ proxyAllowPrivate: true, demoSource: false });
			const a = await newAccount(ctx.call);
			await ctx.call('/v1/sources', {
				method: 'POST',
				token: a.token,
				json: { type: 'xtream', serverUrl: odd.url, username: USER, password: PASS }
			});
			await ctx.catalog!.queue.idle();
			const meta = await get('/v1/catalog/meta', a.token);
			assert.equal(meta.status, 'ready', JSON.stringify(meta));
			assert.ok(meta.counts.movies >= 30);
			const src = ((await get('/v1/sources', a.token)) as unknown as Json[])[0];
			assert.equal(src.stats.movies, 60, 'the broken item is skipped, the rest is kept');
			assert.match(src.lastWarning, /1 ongeldige item/);
			assert.ok(!src.lastWarning.includes('kapot'), 'no item content in warnings');
			// A rebuild from the cache (with those characters in it) works too.
			ctx.catalog!.refresh(a.accountId);
			await ctx.catalog!.queue.idle();
			assert.equal((await get('/v1/catalog/meta', a.token)).status, 'ready');
			const s = await get('/v1/catalog/search?q=mock%20film%203', a.token);
			assert.ok(s.movies.length > 0);
		} finally {
			await odd.close();
		}
	});

	it('build errors in meta are readable text with a code', async () => {
		const { friendlyError } = await import('../src/catalog/build.ts');
		const e = friendlyError(new SyntaxError('Unterminated string in JSON at position 588')) as Error & {
			code: string;
		};
		assert.equal(e.message, 'De bron gaf ongeldige gegevens terug');
		assert.equal(e.code, 'invalid_response');
		const z = friendlyError(Object.assign(new Error('unexpected end of file'), { code: 'Z_BUF_ERROR' })) as Error & {
			code: string;
		};
		assert.equal(z.code, 'invalid_response');
	});

	it('realistic Xtream data: duplicates, empty categories and one huge category', async () => {
		const dup = await startMockIptv({ movies: 400, series: 20, channels: 10, duplicates: true, rich: false });
		try {
			ctx = setup({ proxyAllowPrivate: true, demoSource: false });
			const a = await newAccount(ctx.call);
			await ctx.call('/v1/sources', {
				method: 'POST',
				token: a.token,
				json: { type: 'xtream', serverUrl: dup.url, username: USER, password: PASS }
			});
			await ctx.catalog!.queue.idle();
			const meta = await get('/v1/catalog/meta', a.token);
			assert.equal(meta.status, 'ready');
			assert.equal(meta.counts.movies, 200, 'duplicate list entries do not create titles');
			const src = ((await get('/v1/sources', a.token)) as unknown as Json[])[0];
			assert.equal(src.stats.movies, 400, 'duplicate stream ids are stored once');
		} finally {
			await dup.close();
		}
	});
});

describe('stream urls: the server is never in the video path', () => {
	it('detail and channels carry direct urls with no-store; lists never contain stream urls', async () => {
		const logs: string[] = [];
		const orig = { log: console.log, warn: console.warn, error: console.error };
		const capture = (...args: unknown[]) => logs.push(args.map(String).join(' '));
		console.log = console.warn = console.error = capture;
		try {
			const { a } = await withXtream({ log: true });
			const movies = await get('/v1/catalog/titles?kind=movie&limit=1', a.token);
			const id = movies.items[0].id;
			const r = await ctx!.call(`/v1/catalog/titles/${encodeURIComponent(id)}?kids=0`, { token: a.token });
			assert.equal(r.status, 200);
			assert.equal(r.headers.get('cache-control'), 'private, no-store');
			assert.equal(r.headers.get('etag'), null, 'no ETag on responses with stream urls');
			const d = (await r.json()) as Json;
			const v = d.variants[0];
			assert.ok(v.url.startsWith(`${mock.url}/movie/${USER}/${PASS}/`));
			assert.equal(v.upstreamHttp, true);
			// The url really plays (the device fetches it directly; here: the mock).
			const direct = await fetch(v.url, { headers: { range: 'bytes=0-9' } });
			assert.equal(direct.status, 206);
			await direct.arrayBuffer();
			// If-None-Match never produces a 304 here.
			const again = await ctx!.call(`/v1/catalog/titles/${encodeURIComponent(id)}`, {
				token: a.token,
				headers: { 'if-none-match': '*' }
			});
			assert.equal(again.status, 200);

			// Live: url and the .ts alt url, both direct.
			const chRes = await ctx!.call('/v1/catalog/channels', { token: a.token });
			assert.equal(chRes.headers.get('cache-control'), 'private, no-store');
			assert.equal(chRes.headers.get('etag'), null);
			const ch = (await chRes.json()) as Json;
			const lv = ch.items[0].variants[0];
			assert.ok(lv.url.startsWith(`${mock.url}/live/${USER}/${PASS}/`) && lv.url.endsWith('.m3u8'));
			assert.equal(lv.altUrls.length, 1);
			assert.ok(lv.altUrls[0].endsWith('.ts') && lv.altUrls[0].includes(PASS));

			// Another account cannot get these urls.
			const b = await newAccount(ctx!.call);
			assert.equal((await ctx!.call(`/v1/catalog/titles/${encodeURIComponent(id)}`, { token: b.token })).status, 404);
			const other = (await get('/v1/catalog/channels', b.token)) as Json;
			assert.ok(!JSON.stringify(other).includes(PASS));

			// Lists (titles, home, search, recommend) never contain stream urls or credentials.
			for (const path of ['/v1/catalog/titles?limit=200', '/v1/catalog/home', '/v1/catalog/search?q=mock', '/v1/catalog/meta']) {
				const body = JSON.stringify(await get(path, a.token));
				assert.ok(!body.includes(PASS) && !body.includes('/movie/') && !body.includes('/live/'), path);
			}

			// No play, play-token or proxy routes (the proxy is off by default).
			for (const path of [
				'/v1/play/pt_x/abc',
				'/v1/play/pt_x/s/abc',
				'/v1/play-token',
				'/v1/proxy/ppx_abcdefghijklmnopqrstuvwx?url=http%3A%2F%2Fexample.com'
			])
				assert.equal((await ctx!.call(path, { token: a.token })).status, 404, path);
			assert.equal((await ctx!.call('/v1/proxy-token', { method: 'POST', token: a.token })).status, 404);
			assert.equal((await ctx!.call('/v1/play-token', { method: 'POST', token: a.token })).status, 404);
		} finally {
			Object.assign(console, orig);
		}
		const all = logs.join('\n');
		assert.ok(all.includes('GET /v1/catalog/titles/:id 200'), 'detail route logged as its pattern');
		assert.ok(!all.includes('?kids'), 'no query strings in logs');
		assert.ok(!/https?:\/\//.test(all), 'no urls at all in logs');
		assert.ok(!all.includes(PASS) && !all.includes(USER));
	});

	it('errors are logged without urls', async () => {
		const { scrubUrls } = await import('../src/util.ts');
		assert.equal(
			scrubUrls(`fetch failed: http://h:8080/live/${USER}/${PASS}/1.ts and https://x.example/a?b=c`),
			'fetch failed: <url> and <url>'
		);
		const { redactPath } = await import('../src/app.ts');
		assert.equal(redactPath('/v1/catalog/titles/tmdb-m-603?kids=1'), '/v1/catalog/titles/:id');
		assert.equal(redactPath('/v1/catalog/titles'), '/v1/catalog/titles');
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
