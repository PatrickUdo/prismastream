// E-mail accounts with zero-knowledge login (docs/BACKEND.md, "Accounts en synchronisatie").
//
// The client derives masterKey = PBKDF2(password, salt) and from it (HKDF) an authKey plus its
// E2E keys. Only authKey reaches the server, which stores scrypt(authKey, random salt). The
// password and the E2E key never leave the client. Unknown e-mail addresses get a deterministic
// fake salt from /prelogin, and login failures are always the same generic error.
//
// TV login (device flow): the TV posts its ECDH P-256 public key and shows a user code; a
// signed-in device approves the code with the masterKey sealed to that public key
// (ECDH + HKDF + AES-GCM, done by the clients). The server only relays the sealed blob.
import { randomBytes, randomInt, scrypt, timingSafeEqual, type BinaryLike } from 'node:crypto';
import type { Context, Hono, MiddlewareHandler } from 'hono';
import type { Env } from './env.ts';
import type { Config } from './config.ts';
import { hmac, type ServerKeys } from './keys.ts';
import type { RateLimiter } from './ratelimit.ts';
import type { DeviceRow, Kdf, Store } from './store.ts';
import { newToken, PAIRING_ALPHABET, randomId, sha256hex } from './util.ts';


export interface AuthDeps {
	config: Config;
	store: Store;
	keys: ServerKeys;
	limiter: RateLimiter;
	auth: MiddlewareHandler<Env>;
	clientIp: (c: Context<Env>) => string;
	readJson: (c: Context) => Promise<Record<string, unknown>>;
	err: (c: Context, status: number, error: string, message?: string, extra?: object) => Response;
	tooMany: (c: Context, retry: number) => Response;
	deviceName: (v: unknown) => string;
	/** Called after devices were removed (play tokens, caches). */
	onAccountChanged?: (accountId: string) => void;
}

export const AUTH_MIN_ITERATIONS = 600_000;
export const AUTH_MAX_ITERATIONS = 10_000_000;
export const DEFAULT_ITERATIONS = 600_000;
const LOGIN_FAIL_LIMIT = 10;
const LOGIN_FAIL_WINDOW = 15 * 60_000;
const IP_LOGIN_LIMIT = 30;
const DEVICE_CODE_TTL = 600_000;
const DEVICE_POLL_INTERVAL = 3;
const GENERIC = 'E-mail of wachtwoord onjuist';

const SCRYPT = { N: 16384, r: 8, p: 1, len: 32 };

function scryptAsync(pw: BinaryLike, salt: BinaryLike): Promise<Buffer> {
	return new Promise((resolve, reject) =>
		scrypt(
			pw,
			salt,
			SCRYPT.len,
			{ N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 64 * 1024 * 1024 },
			(e, key) => (e ? reject(e) : resolve(key))
		)
	);
}

/** "scrypt$N$r$p$salt$hash" (base64url). */
export async function hashAuthKey(authKey: Buffer): Promise<string> {
	const salt = randomBytes(16);
	const hash = await scryptAsync(authKey, salt);
	return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export async function verifyAuthKey(authKey: Buffer, stored: string): Promise<boolean> {
	const parts = stored.split('$');
	if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
	const [, n, r, p, salt, hash] = parts;
	const expected = Buffer.from(hash, 'base64url');
	const got = await new Promise<Buffer>((resolve, reject) =>
		scrypt(
			authKey,
			Buffer.from(salt, 'base64url'),
			expected.length,
			{ N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024 },
			(e, key) => (e ? reject(e) : resolve(key))
		)
	);
	return got.length === expected.length && timingSafeEqual(got, expected);
}

// A fixed dummy hash so unknown e-mail addresses cost the same scrypt time as real ones.
let dummyHash: Promise<string> | undefined;

export function normalizeEmail(v: unknown): string | undefined {
	if (typeof v !== 'string') return undefined;
	const e = v.trim().toLowerCase();
	if (e.length > 254 || !/^[^\s@]{1,64}@[^\s@]{1,253}\.[^\s@]{2,}$/.test(e)) return undefined;
	return e;
}

/** base64 or base64url → bytes, or undefined when invalid / wrong length. */
export function decodeB64(v: unknown, min: number, max = min): Buffer | undefined {
	if (typeof v !== 'string' || v.length > 4 * max) return undefined;
	const s = v.trim();
	if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(s)) return undefined;
	const buf = Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
	return buf.length >= min && buf.length <= max ? buf : undefined;
}

function iterationsOf(v: unknown): number | undefined {
	return typeof v === 'number' &&
		Number.isInteger(v) &&
		v >= AUTH_MIN_ITERATIONS &&
		v <= AUTH_MAX_ITERATIONS
		? v
		: undefined;
}

/** Timing-safe comparison of an invitation code. */
export function signupCodeValid(given: unknown, expected: string | undefined): boolean {
	if (!expected || typeof given !== 'string' || !given) return false;
	const a = Buffer.from(sha256hex('signup:' + given.trim()), 'hex');
	const b = Buffer.from(sha256hex('signup:' + expected), 'hex');
	return timingSafeEqual(a, b);
}

/** Signup policy shared by /v1/accounts (legacy) and /v1/auth/register. */
export function signupAllowed(config: Config, code: unknown): boolean {
	if (config.signupCode) return signupCodeValid(code, config.signupCode) || config.allowSignup;
	return config.allowSignup;
}

/** Accepts a P-256 public key as raw point (65 bytes), SPKI DER (91 bytes) or a JWK string. */
export function validPublicKey(v: unknown): boolean {
	if (typeof v !== 'string' || v.length > 1024) return false;
	const s = v.trim();
	if (s.startsWith('{')) {
		try {
			const jwk = JSON.parse(s) as Record<string, unknown>;
			return jwk.kty === 'EC' && jwk.crv === 'P-256' && typeof jwk.x === 'string';
		} catch {
			return false;
		}
	}
	const raw = decodeB64(s, 65, 91);
	return !!raw && ((raw.length === 65 && raw[0] === 4) || raw.length === 91);
}

function newUserCode(): string {
	let s = '';
	for (let i = 0; i < 8; i++) s += PAIRING_ALPHABET[randomInt(PAIRING_ALPHABET.length)];
	return `${s.slice(0, 4)}-${s.slice(4)}`;
}

export function normalizeUserCode(v: string): string {
	const s = v.toUpperCase().replace(/[\s-]/g, '');
	return s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4)}` : s;
}

export function registerAuthRoutes(app: Hono<Env>, d: AuthDeps) {
	const { config, store, keys, limiter, err, tooMany, readJson, clientIp } = d;
	const auth = d.auth;
	dummyHash ??= hashAuthKey(Buffer.alloc(32));

	const fakeSalt = (email: string) =>
		hmac(keys.prelogin, 'salt:' + email)
			.subarray(0, 16)
			.toString('base64');

	app.post('/v1/auth/prelogin', async (c) => {
		const retry = limiter.hit('prelogin:' + clientIp(c), 60, 10 * 60_000);
		if (retry) return tooMany(c, retry);
		const body = await readJson(c);
		const email = normalizeEmail(body.email);
		if (!email) return err(c, 400, 'invalid_email', 'Ongeldig e-mailadres');
		const acc = store.accountByEmail(email);
		const iterations = acc ? acc.kdf.iterations : DEFAULT_ITERATIONS;
		const salt = acc ? acc.salt : fakeSalt(email);
		return c.json({ salt, iterations, kdf: { alg: 'PBKDF2-SHA256', iterations } });
	});

	app.post('/v1/auth/register', async (c) => {
		const ip = clientIp(c);
		const retry = limiter.hit('signup:' + ip, 10, 60 * 60_000);
		if (retry) return tooMany(c, retry);
		const body = await readJson(c);
		if (!signupAllowed(config, body.signupCode))
			return err(c, 403, 'invalid_signup_code', 'Ongeldige of ontbrekende uitnodigingscode');
		const email = normalizeEmail(body.email);
		if (!email) return err(c, 400, 'invalid_email', 'Ongeldig e-mailadres');
		const authKey = decodeB64(body.authKey, 32);
		if (!authKey) return err(c, 400, 'invalid_auth_key', 'authKey must be 32 bytes (base64)');
		const salt = decodeB64(body.salt, 16, 64);
		if (!salt) return err(c, 400, 'invalid_salt', 'salt must be 16..64 bytes (base64)');
		const iterations = iterationsOf(body.iterations ?? (body.kdf as Kdf | undefined)?.iterations);
		if (!iterations)
			return err(c, 400, 'invalid_kdf', `PBKDF2-SHA256 with >= ${AUTH_MIN_ITERATIONS} iterations`);
		if (store.accountByEmail(email))
			return err(c, 409, 'email_taken', 'Er bestaat al een account met dit e-mailadres');
		const accountId = randomId('a_');
		const deviceId = randomId('d_', 9);
		const token = newToken();
		const kdf: Kdf = { alg: 'PBKDF2-SHA256', iterations };
		try {
			store.createEmailAccount(
				{
					id: accountId,
					email,
					salt: String(body.salt).trim(),
					kdf,
					authHash: await hashAuthKey(authKey)
				},
				{ id: deviceId, tokenHash: sha256hex(token), name: d.deviceName(body.deviceName) }
			);
		} catch {
			// Unique index race: someone registered the same address meanwhile.
			return err(c, 409, 'email_taken', 'Er bestaat al een account met dit e-mailadres');
		}
		return c.json({ accountId, token, deviceId, salt: String(body.salt).trim(), kdf }, 201);
	});

	app.post('/v1/auth/login', async (c) => {
		const ip = clientIp(c);
		const ipBlocked =
			limiter.blocked('authfail:' + ip, IP_LOGIN_LIMIT) ||
			limiter.hit('login:' + ip, 60, 10 * 60_000);
		if (ipBlocked) return tooMany(c, ipBlocked);
		const body = await readJson(c);
		const email = normalizeEmail(body.email);
		const authKey = decodeB64(body.authKey, 32);
		if (!email || !authKey) return err(c, 401, 'invalid_credentials', GENERIC);
		const lockKey = 'loginfail:' + sha256hex(email);
		const locked = limiter.blocked(lockKey, LOGIN_FAIL_LIMIT);
		if (locked) return tooMany(c, locked);
		const acc = store.accountByEmail(email);
		const ok = await verifyAuthKey(authKey, acc?.authHash ?? (await dummyHash!));
		if (!acc || !ok) {
			limiter.hit(lockKey, LOGIN_FAIL_LIMIT, LOGIN_FAIL_WINDOW);
			limiter.hit('authfail:' + ip, IP_LOGIN_LIMIT, 10 * 60_000);
			return err(c, 401, 'invalid_credentials', GENERIC);
		}
		if (store.countDevices(acc.id) >= config.maxDevicesPerAccount)
			return err(c, 409, 'device_limit', 'Maximum number of devices reached');
		const deviceId = randomId('d_', 9);
		const token = newToken();
		store.addDevice(acc.id, {
			id: deviceId,
			tokenHash: sha256hex(token),
			name: d.deviceName(body.deviceName)
		});
		return c.json({ accountId: acc.id, token, deviceId, salt: acc.salt, kdf: acc.kdf });
	});

	app.post('/v1/auth/logout', auth, (c) => {
		const dev = c.get('device');
		store.removeDevice(dev.accountId, dev.id);
		d.onAccountChanged?.(dev.accountId);
		return c.json({ ok: true });
	});

	app.post('/v1/auth/password', auth, async (c) => {
		const dev = c.get('device');
		const retry = limiter.hit('password:' + dev.accountId, 10, 60 * 60_000);
		if (retry) return tooMany(c, retry);
		const stored = store.authHashOf(dev.accountId);
		if (!stored) return err(c, 400, 'not_email_account', 'This account has no password');
		const body = await readJson(c);
		const oldKey = decodeB64(body.oldAuthKey, 32);
		const newKey = decodeB64(body.newAuthKey, 32);
		const newSalt = decodeB64(body.newSalt, 16, 64);
		const iterations = iterationsOf(body.newIterations);
		if (!newKey || !newSalt || !iterations)
			return err(c, 400, 'invalid_request', 'newAuthKey, newSalt and newIterations are required');
		if (!oldKey || !(await verifyAuthKey(oldKey, stored)))
			return err(c, 401, 'invalid_credentials', 'Huidig wachtwoord onjuist');
		const revoked = store.changeAuth(
			dev.accountId,
			dev.id,
			await hashAuthKey(newKey),
			String(body.newSalt).trim(),
			{ alg: 'PBKDF2-SHA256', iterations }
		);
		d.onAccountChanged?.(dev.accountId);
		return c.json({
			ok: true,
			revokedDevices: revoked,
			salt: String(body.newSalt).trim(),
			kdf: { alg: 'PBKDF2-SHA256', iterations }
		});
	});

	// ---- TV login (device flow) -----------------------------------------------------

	app.post('/v1/auth/device-code', async (c) => {
		const retry = limiter.hit('devicecode:' + clientIp(c), 10, 10 * 60_000);
		if (retry) return tooMany(c, retry);
		const body = await readJson(c);
		if (!validPublicKey(body.publicKey))
			return err(c, 400, 'invalid_public_key', 'publicKey must be an ECDH P-256 public key');
		if (store.countPendingDeviceCodes() > 1000)
			return err(c, 503, 'busy', 'Too many pending device codes');
		const deviceCode = 'pdc_' + randomBytes(32).toString('base64url');
		const now = Date.now();
		let userCode = newUserCode();
		for (let i = 0; i < 5 && store.deviceCodeByUserCode(userCode); i++) userCode = newUserCode();
		store.createDeviceCode({
			deviceCodeHash: sha256hex(deviceCode),
			userCode,
			publicKey: String(body.publicKey).trim(),
			deviceName: d.deviceName(body.deviceName),
			createdAt: now,
			expiresAt: now + DEVICE_CODE_TTL
		});
		const verifyUrl = config.verifyUrl;
		return c.json(
			{
				userCode,
				deviceCode,
				verifyUrl,
				verifyUrlComplete: `${verifyUrl}?code=${encodeURIComponent(userCode)}`,
				expiresIn: DEVICE_CODE_TTL / 1000,
				interval: DEVICE_POLL_INTERVAL
			},
			201
		);
	});

	const pendingCode = (c: Context, raw: string) => {
		const row = store.deviceCodeByUserCode(normalizeUserCode(raw));
		if (!row || row.expiresAt <= Date.now())
			return { error: err(c, 404, 'invalid_code', 'Onbekende of verlopen code') };
		if (row.accountId) return { error: err(c, 409, 'already_approved', 'Code al gebruikt') };
		return { row };
	};

	app.get('/v1/auth/device-code/:userCode', auth, (c) => {
		const dev = c.get('device');
		const retry = limiter.hit('devicelookup:' + dev.accountId, 20, 10 * 60_000);
		if (retry) return tooMany(c, retry);
		const r = pendingCode(c, c.req.param('userCode') ?? '');
		if (r.error) return r.error;
		return c.json({
			userCode: r.row.userCode,
			deviceName: r.row.deviceName,
			publicKey: r.row.publicKey,
			expiresAt: r.row.expiresAt
		});
	});

	app.post('/v1/auth/device-code/:userCode/approve', auth, async (c) => {
		const dev = c.get('device');
		const retry = limiter.hit('devicelookup:' + dev.accountId, 20, 10 * 60_000);
		if (retry) return tooMany(c, retry);
		const r = pendingCode(c, c.req.param('userCode') ?? '');
		if (r.error) return r.error;
		const body = await readJson(c);
		const sealed = typeof body.sealedKey === 'string' ? body.sealedKey.trim() : '';
		const eph = body.ephemeralPublicKey;
		if (!sealed || sealed.length > 4096 || !/^[A-Za-z0-9+/=_.-]+$/.test(sealed))
			return err(c, 400, 'invalid_sealed_key', 'sealedKey must be base64');
		if (!validPublicKey(eph))
			return err(c, 400, 'invalid_public_key', 'ephemeralPublicKey must be a P-256 public key');
		if (!store.approveDeviceCode(r.row.userCode, dev.accountId, sealed, String(eph).trim()))
			return err(c, 409, 'already_approved', 'Code al gebruikt');
		return c.json({ ok: true, deviceName: r.row.deviceName });
	});

	app.post('/v1/auth/device-token', async (c) => {
		const retry = limiter.hit('devicetoken:' + clientIp(c), 240, 10 * 60_000);
		if (retry) return tooMany(c, retry);
		const body = await readJson(c);
		const code = typeof body.deviceCode === 'string' ? body.deviceCode : '';
		if (!/^pdc_[A-Za-z0-9_-]{20,64}$/.test(code))
			return err(c, 400, 'invalid_grant', 'Invalid device code');
		const hash = sha256hex(code);
		const row = store.deviceCodeByHash(hash);
		const now = Date.now();
		if (!row) return err(c, 400, 'invalid_grant', 'Invalid device code');
		if (row.expiresAt <= now) return err(c, 400, 'expired_token', 'Device code expired');
		if (!row.accountId) {
			const tooFast = now - row.lastPollAt < (DEVICE_POLL_INTERVAL - 1) * 1000;
			store.touchDeviceCodePoll(hash, now);
			if (tooFast)
				return err(c, 400, 'slow_down', 'Polling too fast', { interval: DEVICE_POLL_INTERVAL + 2 });
			return err(c, 400, 'authorization_pending', 'Waiting for approval', {
				interval: DEVICE_POLL_INTERVAL
			});
		}
		const deviceId = randomId('d_', 9);
		const token = newToken();
		const res = store.redeemDeviceCode(
			hash,
			{ id: deviceId, tokenHash: sha256hex(token), name: row.deviceName },
			config.maxDevicesPerAccount
		);
		if (!res.ok) {
			if (res.reason === 'device-limit')
				return err(c, 409, 'device_limit', 'Maximum number of devices reached');
			return err(c, 400, 'invalid_grant', 'Invalid device code');
		}
		const acc = store.getAccount(res.row.accountId!)!;
		return c.json({
			accountId: acc.id,
			token,
			deviceId,
			sealedKey: res.row.sealedKey,
			ephemeralPublicKey: res.row.ephemeralPublicKey,
			salt: acc.salt,
			kdf: acc.kdf
		});
	});
}
