import assert from 'node:assert/strict';
import { pbkdf2Sync, randomBytes, webcrypto } from 'node:crypto';
import { afterEach, describe, it } from 'node:test';
import { setup } from './helpers.ts';

const subtle = webcrypto.subtle;
let ctx: ReturnType<typeof setup> | undefined;
afterEach(async () => {
	await ctx?.dispose();
	ctx = undefined;
});

type Json = Record<string, any>;
const ITER = 600_000;

/** What a client does: PBKDF2 → masterKey → HKDF → authKey (only that goes to the server). */
async function deriveKeys(password: string, saltB64: string, iterations = ITER) {
	const master = pbkdf2Sync(password, Buffer.from(saltB64, 'base64'), iterations, 32, 'sha256');
	const base = await subtle.importKey('raw', master, 'HKDF', false, ['deriveBits']);
	const authKey = Buffer.from(
		await subtle.deriveBits(
			{ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: new TextEncoder().encode('prismastream-auth') },
			base,
			256
		)
	);
	return { master, authKey: authKey.toString('base64') };
}

function post(path: string, json: Json, token?: string, ip?: string) {
	return ctx!.call(path, { method: 'POST', json, token, ip });
}

async function register(email: string, password: string, extra: Json = {}) {
	const salt = randomBytes(16).toString('base64');
	const { authKey, master } = await deriveKeys(password, salt);
	const res = await post('/v1/auth/register', {
		email,
		authKey,
		salt,
		iterations: ITER,
		signupCode: 'welkom',
		deviceName: 'Laptop',
		...extra
	});
	return { res, salt, authKey, master };
}

describe('e-mail accounts (zero-knowledge)', () => {
	it('register needs the invitation code; the server stores only scrypt(authKey)', async () => {
		ctx = setup({ allowSignup: false, signupCode: 'welkom' });
		const bad = await register('a@example.com', 'geheim wachtwoord', { signupCode: 'nee' });
		assert.equal(bad.res.status, 403);
		const ok = await register('A@Example.com ', 'geheim wachtwoord');
		assert.equal(ok.res.status, 201);
		const body = (await ok.res.json()) as Json;
		assert.match(body.accountId, /^a_/);
		assert.match(body.token, /^pst_/);
		assert.match(body.deviceId, /^d_/);
		const row = ctx.store.db.prepare('SELECT * FROM accounts WHERE id = ?').get(body.accountId) as Json;
		assert.equal(row.email, 'a@example.com');
		assert.match(row.auth_hash, /^scrypt\$/);
		assert.ok(!row.auth_hash.includes(ok.authKey));
		const dup = await register('a@example.com', 'iets anders');
		assert.equal(dup.res.status, 409);
		// Weak KDF parameters are refused.
		const weak = await register('b@example.com', 'x', { iterations: 1000 });
		assert.equal(weak.res.status, 400);
		const me = await ctx.call('/v1/me', { token: body.token });
		assert.equal(((await me.json()) as Json).salt, ok.salt);
	});

	it('prelogin: real salt for accounts, deterministic fake salt for unknown e-mails', async () => {
		ctx = setup();
		const { salt } = await register('real@example.com', 'pw-1234567');
		const pre = async (email: string) => (await (await post('/v1/auth/prelogin', { email })).json()) as Json;
		const real = await pre('Real@Example.com');
		assert.equal(real.salt, salt);
		assert.equal(real.iterations, ITER);
		const f1 = await pre('nobody@example.com');
		const f2 = await pre('nobody@example.com');
		const f3 = await pre('other@example.com');
		assert.equal(f1.salt, f2.salt, 'stable, so repeated queries do not reveal anything');
		assert.notEqual(f1.salt, f3.salt);
		assert.equal(Buffer.from(f1.salt, 'base64').length, 16, 'same shape as a real salt');
		assert.equal(f1.iterations, ITER);
		assert.deepEqual(Object.keys(f1).sort(), Object.keys(real).sort());
	});

	it('login, generic errors, logout and lockout', async () => {
		ctx = setup();
		const { salt } = await register('user@example.com', 'correct horse');
		const good = await deriveKeys('correct horse', salt);
		const wrong = await deriveKeys('wrong horse', salt);
		let res = await post('/v1/auth/login', { email: 'user@example.com', authKey: good.authKey, deviceName: 'TV' });
		assert.equal(res.status, 200);
		const login = (await res.json()) as Json;
		assert.match(login.token, /^pst_/);
		const devices = (await (await ctx.call('/v1/devices', { token: login.token })).json()) as Json;
		assert.equal(devices.devices.length, 2);

		res = await post('/v1/auth/login', { email: 'user@example.com', authKey: wrong.authKey });
		const e1 = (await res.json()) as Json;
		res = await post('/v1/auth/login', { email: 'ghost@example.com', authKey: wrong.authKey });
		const e2 = (await res.json()) as Json;
		assert.equal(res.status, 401);
		assert.deepEqual(e1, e2, 'unknown e-mail and wrong password look the same');
		assert.equal(e1.message, 'E-mail of wachtwoord onjuist');

		// Logout revokes only this device; the account (with e-mail) stays.
		res = await post('/v1/auth/logout', {}, login.token);
		assert.equal(res.status, 200);
		assert.equal((await ctx.call('/v1/me', { token: login.token })).status, 401);

		// Lockout per e-mail after 10 failures (1 above + 9 from other IPs), even with the right key.
		for (let i = 0; i < 9; i++) {
			res = await post('/v1/auth/login', { email: 'user@example.com', authKey: wrong.authKey }, undefined, `198.51.100.${i}`);
			assert.equal(res.status, 401);
		}
		res = await post('/v1/auth/login', { email: 'user@example.com', authKey: good.authKey }, undefined, '198.51.100.99');
		assert.equal(res.status, 429);
		assert.ok(Number(res.headers.get('retry-after')) > 0);
	});

	it('logging out the last device keeps an e-mail account', async () => {
		ctx = setup();
		const r = await register('solo@example.com', 'pw pw pw pw');
		const body = (await r.res.json()) as Json;
		await post('/v1/auth/logout', {}, body.token);
		assert.ok(ctx.store.getAccount(body.accountId), 'account still exists');
		const { authKey } = await deriveKeys('pw pw pw pw', r.salt);
		const again = await post('/v1/auth/login', { email: 'solo@example.com', authKey });
		assert.equal(again.status, 200);
	});

	it('password change: old key required, new salt, other devices signed out', async () => {
		ctx = setup();
		const r = await register('pw@example.com', 'oud wachtwoord');
		const first = (await r.res.json()) as Json;
		const other = (await (
			await post('/v1/auth/login', { email: 'pw@example.com', authKey: r.authKey })
		).json()) as Json;
		const newSalt = randomBytes(16).toString('base64');
		const next = await deriveKeys('nieuw wachtwoord', newSalt);
		let res = await post(
			'/v1/auth/password',
			{ oldAuthKey: next.authKey, newAuthKey: next.authKey, newSalt, newIterations: ITER },
			first.token
		);
		assert.equal(res.status, 401);
		res = await post(
			'/v1/auth/password',
			{ oldAuthKey: r.authKey, newAuthKey: next.authKey, newSalt, newIterations: ITER },
			first.token
		);
		assert.equal(res.status, 200);
		assert.equal(((await res.json()) as Json).revokedDevices, 1);
		assert.equal((await ctx.call('/v1/me', { token: other.token })).status, 401);
		assert.equal((await ctx.call('/v1/me', { token: first.token })).status, 200);
		const pre = (await (await post('/v1/auth/prelogin', { email: 'pw@example.com' })).json()) as Json;
		assert.equal(pre.salt, newSalt);
		assert.equal((await post('/v1/auth/login', { email: 'pw@example.com', authKey: r.authKey })).status, 401);
		assert.equal((await post('/v1/auth/login', { email: 'pw@example.com', authKey: next.authKey })).status, 200);
	});

	it('TV device flow with an ECDH-sealed master key', async () => {
		ctx = setup();
		const r = await register('tv@example.com', 'mijn wachtwoord');
		const phone = (await r.res.json()) as Json;

		// TV: key pair, request a code.
		const tv = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
		const tvPub = Buffer.from(await subtle.exportKey('raw', tv.publicKey)).toString('base64');
		let res = await post('/v1/auth/device-code', { publicKey: tvPub, deviceName: 'Woonkamer-tv' });
		assert.equal(res.status, 201);
		const code = (await res.json()) as Json;
		assert.match(code.userCode, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
		assert.match(code.deviceCode, /^pdc_/);
		assert.equal(code.expiresIn, 600);
		assert.equal(code.interval, 3);
		assert.match(code.verifyUrl, /\/activate$/);

		// Polling before approval.
		res = await post('/v1/auth/device-token', { deviceCode: code.deviceCode });
		assert.equal(res.status, 400);
		assert.equal(((await res.json()) as Json).error, 'authorization_pending');
		res = await post('/v1/auth/device-token', { deviceCode: code.deviceCode });
		assert.equal(((await res.json()) as Json).error, 'slow_down');

		// Lookup needs a signed-in device.
		assert.equal((await ctx.call(`/v1/auth/device-code/${code.userCode}`)).status, 401);
		res = await ctx.call(`/v1/auth/device-code/${code.userCode.toLowerCase().replace('-', '')}`, {
			token: phone.token
		});
		assert.equal(res.status, 200);
		const info = (await res.json()) as Json;
		assert.equal(info.deviceName, 'Woonkamer-tv');
		assert.equal(info.publicKey, tvPub);

		// Phone: seal the master key to the TV's public key (ECDH + HKDF + AES-GCM).
		const eph = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
		const tvKey = await subtle.importKey('raw', Buffer.from(info.publicKey, 'base64'), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
		const wrapKey = async (priv: webcrypto.CryptoKey, pub: webcrypto.CryptoKey) => {
			const shared = await subtle.deriveBits({ name: 'ECDH', public: pub }, priv, 256);
			const hk = await subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
			return subtle.deriveKey(
				{ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: new TextEncoder().encode('prismastream-device-v1') },
				hk,
				{ name: 'AES-GCM', length: 256 },
				false,
				['encrypt', 'decrypt']
			);
		};
		const iv = randomBytes(12);
		const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, await wrapKey(eph.privateKey, tvKey), r.master);
		const sealedKey = Buffer.concat([iv, Buffer.from(ct)]).toString('base64');
		const ephPub = Buffer.from(await subtle.exportKey('raw', eph.publicKey)).toString('base64');
		res = await ctx.call(`/v1/auth/device-code/${code.userCode}/approve`, {
			method: 'POST',
			token: phone.token,
			json: { sealedKey, ephemeralPublicKey: ephPub }
		});
		assert.equal(res.status, 200);
		// Approving twice is refused.
		res = await ctx.call(`/v1/auth/device-code/${code.userCode}/approve`, {
			method: 'POST',
			token: phone.token,
			json: { sealedKey, ephemeralPublicKey: ephPub }
		});
		assert.equal(res.status, 409);

		// TV: gets its token and the sealed key, opens it locally.
		res = await post('/v1/auth/device-token', { deviceCode: code.deviceCode });
		assert.equal(res.status, 200);
		const grant = (await res.json()) as Json;
		assert.equal(grant.accountId, phone.accountId);
		assert.match(grant.token, /^pst_/);
		const ephKey = await subtle.importKey('raw', Buffer.from(grant.ephemeralPublicKey, 'base64'), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
		const blob = Buffer.from(grant.sealedKey, 'base64');
		const opened = Buffer.from(
			await subtle.decrypt({ name: 'AES-GCM', iv: blob.subarray(0, 12) }, await wrapKey(tv.privateKey, ephKey), blob.subarray(12))
		);
		assert.deepEqual(opened, r.master, 'TV recovered the master key; the server only relayed it');
		const me = (await (await ctx.call('/v1/me', { token: grant.token })).json()) as Json;
		assert.equal(me.accountId, phone.accountId);
		const devs = (await (await ctx.call('/v1/devices', { token: grant.token })).json()) as Json;
		assert.ok(devs.devices.some((d: Json) => d.name === 'Woonkamer-tv'));

		// The code is single use.
		res = await post('/v1/auth/device-token', { deviceCode: code.deviceCode });
		assert.equal(((await res.json()) as Json).error, 'invalid_grant');
		// Invalid public keys are refused.
		res = await post('/v1/auth/device-code', { publicKey: 'bm9wZQ==' });
		assert.equal(res.status, 400);
	});

	it('expired device codes cannot be approved or redeemed', async () => {
		ctx = setup();
		const r = await register('exp@example.com', 'pw pw pw pw');
		const phone = (await r.res.json()) as Json;
		const pub = Buffer.concat([Buffer.from([4]), randomBytes(64)]).toString('base64');
		const code = (await (await post('/v1/auth/device-code', { publicKey: pub })).json()) as Json;
		ctx.store.db.prepare('UPDATE device_codes SET expires_at = ?').run(Date.now() - 1);
		assert.equal((await ctx.call(`/v1/auth/device-code/${code.userCode}`, { token: phone.token })).status, 404);
		const res = await post('/v1/auth/device-token', { deviceCode: code.deviceCode });
		assert.equal(((await res.json()) as Json).error, 'expired_token');
	});
});
