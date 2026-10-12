import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { redactPath } from '../src/app.ts';
import { originAllowed } from '../src/config.ts';
import { newAccount, setup } from './helpers.ts';

let ctx: ReturnType<typeof setup> | undefined;
afterEach(async () => {
	await ctx?.dispose();
	ctx = undefined;
});

describe('health & basics', () => {
	it('GET /v1/health', async () => {
		ctx = setup();
		const res = await ctx!.call('/v1/health');
		assert.equal(res.status, 200);
		assert.equal((await res.json()).ok, true);
		assert.equal(res.headers.get('cache-control'), 'no-store');
	});

	it('unknown routes return JSON 404', async () => {
		ctx = setup();
		const res = await ctx!.call('/v1/nope');
		assert.equal(res.status, 404);
		assert.equal((await res.json()).error, 'not_found');
	});

	it('CORS allows Capacitor origins by default and rejects others', async () => {
		ctx = setup();
		for (const origin of ['capacitor://localhost', 'https://localhost', 'http://localhost']) {
			const res = await ctx!.call('/v1/health', { headers: { origin } });
			assert.equal(res.headers.get('access-control-allow-origin'), origin);
		}
		const bad = await ctx!.call('/v1/health', { headers: { origin: 'https://evil.example' } });
		assert.equal(bad.headers.get('access-control-allow-origin'), null);
		const pre = await ctx!.call('/v1/docs', {
			method: 'OPTIONS',
			headers: {
				origin: 'capacitor://localhost',
				'access-control-request-method': 'PUT',
				'access-control-request-headers': 'authorization,if-match,content-type'
			}
		});
		assert.ok(pre.status === 204 || pre.status === 200);
		assert.match(pre.headers.get('access-control-allow-headers') ?? '', /If-Match/i);
	});

	it('origin globs', () => {
		assert.ok(originAllowed('http://localhost:5174', ['http://localhost:*']));
		assert.ok(!originAllowed('http://localhost.evil.com', ['http://localhost:*']));
		assert.ok(originAllowed('https://x.example', ['*']));
	});

	it('redacts proxy tokens and query strings from log paths', () => {
		assert.equal(redactPath('/v1/proxy/ppx_secret?url=http%3A%2F%2Fa'), '/v1/proxy/***');
		assert.equal(redactPath('/v1/docs?since=3'), '/v1/docs');
	});
});

describe('accounts', () => {
	it('creates an account with token, salt and kdf params', async () => {
		ctx = setup();
		const a = await newAccount(ctx.call);
		assert.match(a.accountId, /^a_/);
		assert.match(a.token, /^pst_/);
		assert.equal(Buffer.from(a.salt, 'base64').length, 16);
		assert.equal(a.kdf.alg, 'PBKDF2-SHA256');
		assert.ok(a.kdf.iterations >= 310_000);
		const me = await ctx!.call('/v1/me', { token: a.token });
		assert.equal(me.status, 200);
		const body = await me.json();
		assert.equal(body.accountId, a.accountId);
		assert.equal(body.salt, a.salt);
	});

	it('stores only a hash of the token', async () => {
		ctx = setup();
		const a = await newAccount(ctx.call);
		const rows = ctx!.store.db.prepare('SELECT token_hash FROM devices').all() as {
			token_hash: string;
		}[];
		assert.equal(rows.length, 1);
		assert.notEqual(rows[0].token_hash, a.token);
		assert.match(rows[0].token_hash, /^[0-9a-f]{64}$/);
	});

	it('rejects weak kdf parameters', async () => {
		ctx = setup();
		const res = await ctx!.call('/v1/accounts', {
			method: 'POST',
			json: { kdf: { alg: 'PBKDF2-SHA256', iterations: 1000 } }
		});
		assert.equal(res.status, 400);
	});

	it('honours ALLOW_SIGNUP=false', async () => {
		ctx = setup({ allowSignup: false });
		const res = await ctx!.call('/v1/accounts', { method: 'POST', json: {} });
		assert.equal(res.status, 403);
	});

	it('rate-limits account creation per IP', async () => {
		ctx = setup();
		let last = 0;
		for (let i = 0; i < 11; i++)
			last = (await ctx!.call('/v1/accounts', { method: 'POST', json: {}, ip: '198.51.100.9' }))
				.status;
		assert.equal(last, 429);
	});
});

describe('auth errors', () => {
	it('401 without or with a wrong token', async () => {
		ctx = setup();
		assert.equal((await ctx!.call('/v1/docs')).status, 401);
		const res = await ctx!.call('/v1/docs', { token: 'pst_' + 'x'.repeat(43) });
		assert.equal(res.status, 401);
		assert.equal((await res.json()).error, 'unauthorized');
		assert.equal((await ctx!.call('/v1/docs', { headers: { authorization: 'Basic abc' } })).status, 401);
	});

	it('blocks an IP after too many auth failures', async () => {
		ctx = setup();
		let status = 0;
		for (let i = 0; i < 32; i++)
			status = (await ctx!.call('/v1/me', { token: 'pst_' + 'y'.repeat(43), ip: '192.0.2.50' }))
				.status;
		assert.equal(status, 429);
		// Other IPs are unaffected.
		const a = await newAccount(ctx.call, '192.0.2.51');
		assert.equal((await ctx!.call('/v1/me', { token: a.token, ip: '192.0.2.51' })).status, 200);
	});

	it('enforces the body limit', async () => {
		ctx = setup({ bodyLimitBytes: 1024 });
		const a = await newAccount(ctx.call);
		const res = await ctx!.call('/v1/docs/settings', {
			method: 'PUT',
			token: a.token,
			headers: { 'if-match': '0' },
			json: { blob: 'A'.repeat(4096) }
		});
		assert.equal(res.status, 413);
	});
});

describe('pairing', () => {
	it('pairs a second device with a one-time code', async () => {
		ctx = setup();
		const a = await newAccount(ctx.call);
		const pc = await ctx!.call('/v1/pairing-codes', { method: 'POST', token: a.token });
		assert.equal(pc.status, 201);
		const { code, expiresAt } = await pc.json();
		assert.match(code, /^[A-Z2-9]{8}$/);
		assert.ok(expiresAt > Date.now() + 9 * 60_000);
		const formatted = `${code.slice(0, 4)}-${code.slice(4).toLowerCase()}`;
		const res = await ctx!.call('/v1/devices/pair', {
			method: 'POST',
			json: { code: formatted, deviceName: 'Tablet' }
		});
		assert.equal(res.status, 201);
		const b = await res.json();
		assert.equal(b.accountId, a.accountId);
		assert.equal(b.salt, a.salt);
		assert.notEqual(b.token, a.token);
		// One-time use.
		const again = await ctx!.call('/v1/devices/pair', { method: 'POST', json: { code } });
		assert.equal(again.status, 400);
		const list = await (await ctx!.call('/v1/devices', { token: b.token })).json();
		assert.equal(list.devices.length, 2);
		assert.equal(list.devices.filter((d: { current: boolean }) => d.current).length, 1);
	});

	it('rejects expired codes', async () => {
		ctx = setup({ pairingTtlMs: -1 });
		const a = await newAccount(ctx.call);
		const { code } = await (await ctx!.call('/v1/pairing-codes', { method: 'POST', token: a.token })).json();
		const res = await ctx!.call('/v1/devices/pair', { method: 'POST', json: { code } });
		assert.equal(res.status, 400);
	});

	it('requires auth to create codes and rate-limits redemption attempts', async () => {
		ctx = setup();
		assert.equal((await ctx!.call('/v1/pairing-codes', { method: 'POST' })).status, 401);
		let status = 0;
		for (let i = 0; i < 11; i++)
			status = (
				await ctx!.call('/v1/devices/pair', {
					method: 'POST',
					json: { code: 'ABCDEFGH' },
					ip: '198.51.100.20'
				})
			).status;
		assert.equal(status, 429);
	});

	it('unlinking devices; removing the last device deletes the account', async () => {
		ctx = setup();
		const a = await newAccount(ctx.call);
		const { code } = await (await ctx!.call('/v1/pairing-codes', { method: 'POST', token: a.token })).json();
		const b = await (await ctx!.call('/v1/devices/pair', { method: 'POST', json: { code } })).json();
		await ctx!.call('/v1/docs/settings', {
			method: 'PUT',
			token: a.token,
			headers: { 'if-match': '0' },
			json: { blob: 'AAAA' }
		});
		const del = await ctx!.call(`/v1/devices/${b.deviceId}`, { method: 'DELETE', token: a.token });
		assert.equal(del.status, 200);
		assert.equal((await del.json()).accountDeleted, false);
		assert.equal((await ctx!.call('/v1/docs', { token: b.token })).status, 401);
		const self = await ctx!.call(`/v1/devices/${a.deviceId}`, { method: 'DELETE', token: a.token });
		assert.equal((await self.json()).accountDeleted, true);
		const n = ctx!.store.db.prepare('SELECT COUNT(*) AS n FROM docs').get() as { n: number };
		assert.equal(Number(n.n), 0);
	});
});

describe('docs & versioning', () => {
	const put = (token: string, id: string, version: string | null, json: unknown) =>
		ctx!.call(`/v1/docs/${encodeURIComponent(id)}`, {
			method: 'PUT',
			token,
			headers: version == null ? {} : { 'if-match': version },
			json
		});

	it('creates, updates and lists docs with a cursor', async () => {
		ctx = setup();
		const a = await newAccount(ctx.call);
		const r1 = await put(a.token, 'profiles', '0', { blob: 'AQID' });
		assert.equal(r1.status, 200);
		assert.equal((await r1.json()).version, 1);
		assert.equal(r1.headers.get('etag'), '"1"');
		const r2 = await put(a.token, 'data:p_123', '0', { blob: 'BBBB' });
		const c2 = (await r2.json()).cursor;
		const r3 = await put(a.token, 'profiles', '"1"', { blob: 'CCCC' });
		assert.equal((await r3.json()).version, 2);

		const all = await (await ctx!.call('/v1/docs?since=0', { token: a.token })).json();
		assert.equal(all.docs.length, 2);
		assert.equal(all.cursor, 3);
		const since = await (await ctx!.call(`/v1/docs?since=${c2}`, { token: a.token })).json();
		assert.deepEqual(
			since.docs.map((d: { docId: string; blob: string }) => [d.docId, d.blob]),
			[['profiles', 'CCCC']]
		);
		const one = await ctx!.call('/v1/docs/data:p_123', { token: a.token });
		assert.equal((await one.json()).blob, 'BBBB');
	});

	it('paginates with limit', async () => {
		ctx = setup();
		const a = await newAccount(ctx.call);
		for (let i = 0; i < 5; i++) await put(a.token, `d${i}`, '0', { blob: 'AAAA' });
		const p1 = await (await ctx!.call('/v1/docs?since=0&limit=2', { token: a.token })).json();
		assert.equal(p1.docs.length, 2);
		assert.equal(p1.more, true);
		const p2 = await (await ctx!.call(`/v1/docs?since=${p1.cursor}&limit=10`, { token: a.token })).json();
		assert.equal(p2.docs.length, 3);
		assert.equal(p2.more, false);
	});

	it('returns 409 with the current server version on conflict', async () => {
		ctx = setup();
		const a = await newAccount(ctx.call);
		await put(a.token, 'settings', '0', { blob: 'AAAA' });
		await put(a.token, 'settings', '1', { blob: 'BBBB' });
		const stale = await put(a.token, 'settings', '1', { blob: 'CCCC' });
		assert.equal(stale.status, 409);
		const body = await stale.json();
		assert.equal(body.error, 'conflict');
		assert.equal(body.current.version, 2);
		assert.equal(body.current.blob, 'BBBB');
		// Creating an existing doc with version 0 also conflicts.
		assert.equal((await put(a.token, 'settings', '0', { blob: 'DDDD' })).status, 409);
		// Conflict on a missing doc reports current: null.
		const missing = await put(a.token, 'other', '4', { blob: 'DDDD' });
		assert.equal(missing.status, 409);
		assert.equal((await missing.json()).current, null);
	});

	it('requires If-Match and validates input', async () => {
		ctx = setup();
		const a = await newAccount(ctx.call);
		assert.equal((await put(a.token, 'settings', null, { blob: 'AAAA' })).status, 428);
		assert.equal((await put(a.token, 'settings', 'abc', { blob: 'AAAA' })).status, 400);
		assert.equal((await put(a.token, 'settings', '0', { blob: '<script>' })).status, 400);
		assert.equal((await put(a.token, 'settings', '0', {})).status, 400);
		assert.equal((await put(a.token, 'bad id!', '0', { blob: 'AAAA' })).status, 400);
	});

	it('supports deletion markers', async () => {
		ctx = setup();
		const a = await newAccount(ctx.call);
		await put(a.token, 'data:p_1', '0', { blob: 'AAAA' });
		const del = await put(a.token, 'data:p_1', '1', { deleted: true });
		assert.equal(del.status, 200);
		const all = await (await ctx!.call('/v1/docs?since=0', { token: a.token })).json();
		assert.equal(all.docs[0].deleted, true);
		assert.equal(all.docs[0].blob, null);
	});

	it('isolates accounts', async () => {
		ctx = setup();
		const a = await newAccount(ctx.call);
		const b = await newAccount(ctx.call);
		await put(a.token, 'settings', '0', { blob: 'AAAA' });
		const list = await (await ctx!.call('/v1/docs?since=0', { token: b.token })).json();
		assert.equal(list.docs.length, 0);
		assert.equal((await ctx!.call('/v1/docs/settings', { token: b.token })).status, 404);
		assert.equal((await put(b.token, 'settings', '0', { blob: 'BBBB' })).status, 200);
	});

	it('enforces the doc quota', async () => {
		ctx = setup({ maxDocsPerAccount: 2 });
		const a = await newAccount(ctx.call);
		await put(a.token, 'a', '0', { blob: 'AAAA' });
		await put(a.token, 'b', '0', { blob: 'AAAA' });
		assert.equal((await put(a.token, 'c', '0', { blob: 'AAAA' })).status, 507);
	});

	it('long-poll wakes up on changes', async () => {
		ctx = setup();
		const a = await newAccount(ctx.call);
		const t0 = Date.now();
		const pending = ctx!.call('/v1/events?since=0&timeout=10', { token: a.token });
		await new Promise((r) => setTimeout(r, 50));
		await put(a.token, 'settings', '0', { blob: 'AAAA' });
		const res = await (await pending).json();
		assert.equal(res.changed, true);
		assert.equal(res.cursor, 1);
		assert.ok(Date.now() - t0 < 5000);
		// Already newer -> immediate answer.
		const now = await (await ctx!.call('/v1/events?since=0', { token: a.token })).json();
		assert.equal(now.changed, true);
		const idle = await (await ctx!.call('/v1/events?since=1&timeout=1', { token: a.token })).json();
		assert.equal(idle.changed, false);
	});
});
