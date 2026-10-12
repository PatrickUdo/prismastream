// HTTP API (Hono). The server never sees plaintext user data: docs are opaque encrypted blobs.
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { registerAuthRoutes } from './auth.ts';
import { signupDecision } from './invites.ts';
import { redactText } from './catalog/core.ts';
import { registerCatalogRoutes } from './catalog/routes.ts';
import { CatalogService } from './catalog/service.ts';
import { SourceRepo } from './catalog/sources.ts';
import { originAllowed, type Config } from './config.ts';
import { deriveKeys, loadMasterKey, type ServerKeys } from './keys.ts';
import { EventHub } from './events.ts';
import { parseTarget, ProxyError, proxyFetch } from './proxy.ts';
import { RateLimiter } from './ratelimit.ts';
import { InviteUnavailableError, Store, type DeviceRow, type DocRow, type Kdf } from './store.ts';
import {
	scrubUrls,
	newPairingCode,
	newProxyToken,
	newSalt,
	newToken,
	normalizePairingCode,
	randomId,
	sha256hex
} from './util.ts';

import type { Env } from './env.ts';

export const MIN_KDF_ITERATIONS = 310_000;
export const DEFAULT_KDF: Kdf = { alg: 'PBKDF2-SHA256', iterations: 600_000 };
const DOC_ID_RE = /^[A-Za-z0-9:_.-]{1,128}$/;
const BLOB_RE = /^[A-Za-z0-9+/=_-]*$/;
const AUTH_FAIL_LIMIT = 30;
const AUTH_FAIL_WINDOW = 10 * 60 * 1000;

export interface AppContext {
	app: Hono<Env>;
	store: Store;
	events: EventHub;
	limiter: RateLimiter;
	keys: ServerKeys;
	sources: SourceRepo;
	/** Server-side catalog (undefined when CATALOG_ENABLED=false). */
	catalog?: CatalogService;
	dispose(): Promise<void>;
}

function err(c: Context, status: number, error: string, message?: string, extra?: object) {
	return c.json({ error, message: message ?? error, ...extra }, status as never);
}

function docJson(d: DocRow) {
	return {
		docId: d.docId,
		version: d.version,
		updatedAt: d.updatedAt,
		deleted: d.deleted,
		blob: d.deleted ? null : d.blob
	};
}

function deviceName(v: unknown): string {
	const s = typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').trim() : '';
	return (s || 'Apparaat').slice(0, 64);
}

/**
 * Path for logs: no query string, no tokens or codes, and the detail route only as its pattern
 * (`/v1/catalog/titles/:id`).
 */
export function redactPath(path: string): string {
	return path
		.replace(/\?.*$/, '')
		.replace(/^\/v1\/proxy\/[^/]+/, '/v1/proxy/***')
		.replace(/^\/v1\/catalog\/titles\/[^/]+$/, '/v1/catalog/titles/:id')
		.replace(/^\/v1\/auth\/device-code\/[^/]+/, '/v1/auth/device-code/***');
}

export function createApp(config: Config, store = new Store(config.dbPath)): AppContext {
	const app = new Hono<Env>();
	const events = new EventHub();
	const limiter = new RateLimiter();
	const keys = deriveKeys(loadMasterKey(config));
	const sources = new SourceRepo(store, keys.secrets, {
		demo: config.demoSource,
		allowPrivate: config.proxyAllowPrivate
	});
	const catalog = config.catalogEnabled
		? new CatalogService({ config, store, keys, sources })
		: undefined;
	const purgeTimer = setInterval(() => {
		store.purgeExpiredPairingCodes();
		store.purgeExpiredDeviceCodes();
	}, 5 * 60_000);
	purgeTimer.unref();
	/** After an account was deleted (directly or with its last legacy device). */
	const accountGone = (accountId: string) => {
		if (!store.getAccount(accountId)) catalog?.purgeAccount(accountId);
	};

	const clientIp = (c: Context<Env>): string => {
		if (config.trustProxy) {
			const xff = c.req.header('x-forwarded-for');
			if (xff) return xff.split(',')[0].trim();
		}
		return c.env?.incoming?.socket?.remoteAddress ?? 'unknown';
	};

	const publicBase = (c: Context<Env>): string => {
		if (config.publicUrl) return config.publicUrl;
		const u = new URL(c.req.url);
		if (config.trustProxy) {
			const proto = c.req.header('x-forwarded-proto');
			const host = c.req.header('x-forwarded-host');
			if (proto) u.protocol = proto.split(',')[0].trim() + ':';
			if (host) u.host = host.split(',')[0].trim();
		}
		return u.origin;
	};

	const tooMany = (c: Context, retry: number) => {
		c.header('Retry-After', String(retry));
		return err(c, 429, 'rate_limited', 'Too many requests');
	};

	// ---- global middleware ------------------------------------------------------

	if (config.log) {
		app.use(async (c, next) => {
			const t0 = performance.now();
			await next();
			const ms = Math.round(performance.now() - t0);
			// Never log query strings, tokens or bodies.
			console.log(`${c.req.method} ${redactPath(c.req.path)} ${c.res.status} ${ms}ms`);
		});
	}

	app.use(
		cors({
			origin: (origin) => (origin && originAllowed(origin, config.corsOrigins) ? origin : null),
			allowMethods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
			allowHeaders: [
				'Authorization',
				'Content-Type',
				'If-Match',
				'If-None-Match',
				'Range',
				'If-Range'
			],
			exposeHeaders: [
				'ETag',
				'Content-Length',
				'Content-Range',
				'Accept-Ranges',
				'Retry-After',
				'Content-Type'
			],
			maxAge: 600
		})
	);

	app.use(async (c, next) => {
		await next();
		c.header('X-Content-Type-Options', 'nosniff');
		c.header('Referrer-Policy', 'no-referrer');
		const streaming = c.req.path.startsWith('/v1/proxy/');
		if (!streaming && !c.res.headers.get('cache-control')) c.header('Cache-Control', 'no-store');
	});

	app.use(
		'/v1/*',
		bodyLimit({
			maxSize: config.bodyLimitBytes,
			onError: (c) => err(c, 413, 'payload_too_large', 'Request body too large')
		})
	);

	// Per-IP rate limit for the API (the proxy has its own per-device limit).
	app.use('/v1/*', async (c, next) => {
		if (
			c.req.method === 'OPTIONS' ||
			c.req.path.startsWith('/v1/proxy/')
		)
			return next();
		const retry = limiter.hit('ip:' + clientIp(c), config.rateLimitPerMin, 60_000);
		if (retry) return tooMany(c, retry);
		return next();
	});

	const auth: MiddlewareHandler<Env> = async (c, next) => {
		const ip = clientIp(c);
		const blocked = limiter.blocked('authfail:' + ip, AUTH_FAIL_LIMIT);
		if (blocked) return tooMany(c, blocked);
		const h = c.req.header('authorization') ?? '';
		const m = /^Bearer\s+(pst_[A-Za-z0-9_-]{20,128})$/.exec(h);
		const device = m ? store.deviceByTokenHash(sha256hex(m[1])) : undefined;
		if (!device) {
			limiter.hit('authfail:' + ip, AUTH_FAIL_LIMIT, AUTH_FAIL_WINDOW);
			return err(c, 401, 'unauthorized', 'Missing or invalid token');
		}
		if (Date.now() - device.lastSeenAt > 60_000) store.touchDevice(device.id);
		c.set('device', device);
		await next();
	};

	const readJson = async (c: Context): Promise<Record<string, unknown>> => {
		try {
			const body = await c.req.json();
			return body && typeof body === 'object' && !Array.isArray(body) ? body : {};
		} catch {
			return {};
		}
	};

	// ---- routes -----------------------------------------------------------------

	app.get('/v1/health', (c) =>
		c.json({ ok: true, service: 'prismastream-sync', version: 1, time: Date.now() })
	);

	app.post('/v1/accounts', async (c) => {
		const retry = limiter.hit('signup:' + clientIp(c), 10, 60 * 60_000);
		if (retry) return tooMany(c, retry);
		const body = await readJson(c);
		const signup = signupDecision(config, store, body.signupCode);
		if (!signup.ok)
			return err(c, 403, 'signup_disabled', 'Signup requires a valid invitation code');
		let kdf = DEFAULT_KDF;
		const k = body.kdf as Partial<Kdf> | undefined;
		if (k && typeof k === 'object') {
			if (
				k.alg !== 'PBKDF2-SHA256' ||
				typeof k.iterations !== 'number' ||
				!Number.isInteger(k.iterations) ||
				k.iterations < MIN_KDF_ITERATIONS ||
				k.iterations > 10_000_000
			)
				return err(c, 400, 'invalid_kdf', `PBKDF2-SHA256 with >= ${MIN_KDF_ITERATIONS} iterations`);
			kdf = { alg: 'PBKDF2-SHA256', iterations: k.iterations };
		}
		const accountId = randomId('a_');
		const deviceId = randomId('d_', 9);
		const token = newToken();
		const salt = newSalt();
		try {
			store.createAccount(
				{ id: accountId, salt, kdf },
				{ id: deviceId, tokenHash: sha256hex(token), name: deviceName(body.deviceName) },
				signup.inviteHash
			);
		} catch (e) {
			if (e instanceof InviteUnavailableError)
				return err(c, 403, 'signup_disabled', 'Signup requires a valid invitation code');
			throw e;
		}
		return c.json({ accountId, deviceId, token, salt, kdf }, 201);
	});

	app.get('/v1/me', auth, (c) => {
		const d = c.get('device');
		const a = store.getAccount(d.accountId)!;
		return c.json({ accountId: a.id, deviceId: d.id, salt: a.salt, kdf: a.kdf, cursor: a.seq });
	});

	app.delete('/v1/account', auth, (c) => {
		const accountId = c.get('device').accountId;
		store.deleteAccount(accountId);
		accountGone(accountId);
		return c.body(null, 204);
	});

	registerAuthRoutes(app, {
		config,
		store,
		keys,
		limiter,
		auth,
		clientIp,
		readJson,
		err,
		tooMany,
		deviceName,
		onAccountChanged: accountGone
	});

	// ---- pairing ---------------------------------------------------------------

	app.post('/v1/pairing-codes', auth, (c) => {
		const d = c.get('device');
		const retry = limiter.hit('paircode:' + d.accountId, 10, 10 * 60_000);
		if (retry) return tooMany(c, retry);
		if (store.countActivePairingCodes(d.accountId) >= 5)
			return err(c, 429, 'too_many_codes', 'Too many active pairing codes');
		const code = newPairingCode();
		const expiresAt = Date.now() + config.pairingTtlMs;
		store.createPairingCode(sha256hex('pair:' + code), d.accountId, d.id, expiresAt);
		return c.json({ code, expiresAt }, 201);
	});

	app.post('/v1/devices/pair', async (c) => {
		const ip = clientIp(c);
		const retry = limiter.hit('pair:' + ip, 10, 10 * 60_000);
		if (retry) return tooMany(c, retry);
		const body = await readJson(c);
		const code = typeof body.code === 'string' ? normalizePairingCode(body.code) : '';
		if (!/^[A-Z0-9]{8}$/.test(code)) return err(c, 400, 'invalid_code', 'Invalid pairing code');
		const deviceId = randomId('d_', 9);
		const token = newToken();
		const res = store.redeemPairingCode(
			sha256hex('pair:' + code),
			{ id: deviceId, tokenHash: sha256hex(token), name: deviceName(body.deviceName) },
			config.maxDevicesPerAccount
		);
		if (!res.ok) {
			if (res.reason === 'device-limit')
				return err(c, 409, 'device_limit', 'Maximum number of devices reached');
			return err(c, 400, 'invalid_code', 'Invalid or expired pairing code');
		}
		return c.json(
			{ accountId: res.account.id, deviceId, token, salt: res.account.salt, kdf: res.account.kdf },
			201
		);
	});

	// ---- devices ---------------------------------------------------------------

	app.get('/v1/devices', auth, (c) => {
		const me = c.get('device');
		return c.json({
			devices: store.listDevices(me.accountId).map((d) => ({
				id: d.id,
				name: d.name,
				createdAt: d.createdAt,
				lastSeenAt: d.lastSeenAt,
				current: d.id === me.id
			}))
		});
	});

	app.delete('/v1/devices/:id', auth, (c) => {
		const me = c.get('device');
		const res = store.removeDevice(me.accountId, c.req.param('id'));
		if (res === 'not-found') return err(c, 404, 'not_found', 'Device not found');
		if (res === 'account-deleted') accountGone(me.accountId);
		return c.json({ ok: true, accountDeleted: res === 'account-deleted' });
	});

	// ---- docs ------------------------------------------------------------------

	app.get('/v1/docs', auth, (c) => {
		const since = Math.max(0, Math.floor(Number(c.req.query('since') ?? 0)) || 0);
		const limit = Math.min(
			500,
			Math.max(1, Math.floor(Number(c.req.query('limit') ?? 200)) || 200)
		);
		const res = store.listDocsSince(c.get('device').accountId, since, limit);
		return c.json({ docs: res.docs.map(docJson), cursor: res.cursor, more: res.more });
	});

	app.get('/v1/docs/:docId', auth, (c) => {
		const docId = c.req.param('docId');
		if (!DOC_ID_RE.test(docId)) return err(c, 400, 'invalid_doc_id', 'Invalid doc id');
		const d = store.getDoc(c.get('device').accountId, docId);
		if (!d) return err(c, 404, 'not_found', 'Doc not found');
		c.header('ETag', `"${d.version}"`);
		return c.json(docJson(d));
	});

	app.put('/v1/docs/:docId', auth, async (c) => {
		const docId = c.req.param('docId');
		if (!DOC_ID_RE.test(docId)) return err(c, 400, 'invalid_doc_id', 'Invalid doc id');
		const ifMatch = c.req.header('if-match');
		if (ifMatch == null)
			return err(c, 428, 'precondition_required', 'If-Match header with the version is required');
		const expected = Number(ifMatch.replace(/^W\//, '').replace(/"/g, '').trim());
		if (!Number.isInteger(expected) || expected < 0)
			return err(c, 400, 'invalid_if_match', 'If-Match must be a version number');
		const body = await readJson(c);
		const deleted = body.deleted === true;
		const blob = deleted ? null : body.blob;
		if (!deleted && (typeof blob !== 'string' || blob.length === 0 || !BLOB_RE.test(blob)))
			return err(c, 400, 'invalid_blob', 'Body must be { blob: <base64> } or { deleted: true }');
		const accountId = c.get('device').accountId;
		const res = store.putDoc(
			accountId,
			docId,
			expected,
			{ blob: blob as string | null, deleted },
			config.maxDocsPerAccount
		);
		if (!res.ok) {
			if (res.reason === 'quota') return err(c, 507, 'quota_exceeded', 'Too many docs');
			if (res.current) c.header('ETag', `"${res.current.version}"`);
			return err(c, 409, 'conflict', 'Version mismatch', {
				current: res.current ? docJson(res.current) : null
			});
		}
		events.notify(accountId, res.doc.seq);
		c.header('ETag', `"${res.doc.version}"`);
		return c.json({
			docId,
			version: res.doc.version,
			updatedAt: res.doc.updatedAt,
			cursor: res.doc.seq
		});
	});

	// Long-poll: resolves as soon as anything changed after `since`, or after `timeout` s.
	app.get('/v1/events', auth, async (c) => {
		const accountId = c.get('device').accountId;
		const since = Math.max(0, Math.floor(Number(c.req.query('since') ?? 0)) || 0);
		const timeout = Math.min(55, Math.max(1, Number(c.req.query('timeout') ?? 25) || 25)) * 1000;
		const seq = store.getAccount(accountId)?.seq ?? 0;
		if (seq > since) return c.json({ cursor: seq, changed: true });
		const next = await events.wait(accountId, since, timeout, c.req.raw.signal);
		return c.json({ cursor: Math.max(next, since), changed: next > since });
	});

	// ---- proxy (legacy, off by default) ------------------------------------------
	// The server must never be in the path of video streams. This generic CORS proxy only exists
	// for the local-mode web build fetching playlists/APIs; with PROXY_ENABLED=false (the default)
	// its routes are not registered at all (404).

	if (config.proxyEnabled) {
		app.post('/v1/proxy-token', auth, (c) => {
			if (!config.proxyEnabled) return err(c, 403, 'proxy_disabled', 'Proxy is disabled');
			const d = c.get('device');
			const proxyToken = newProxyToken();
			store.setProxyTokenHash(d.id, sha256hex(proxyToken));
			return c.json({ proxyToken, prefix: `${publicBase(c)}/v1/proxy/${proxyToken}?url=` }, 201);
		});

		const proxyRoute = async (c: Context<Env>) => {
			if (!config.proxyEnabled) return err(c, 403, 'proxy_disabled', 'Proxy is disabled');
			const ip = clientIp(c);
			const blocked = limiter.blocked('authfail:' + ip, AUTH_FAIL_LIMIT);
			if (blocked) return tooMany(c, blocked);
			const token = c.req.param('token') ?? '';
			const device = /^ppx_[A-Za-z0-9_-]{20,64}$/.test(token)
				? store.deviceByProxyTokenHash(sha256hex(token))
				: undefined;
			if (!device) {
				limiter.hit('authfail:' + ip, AUTH_FAIL_LIMIT, AUTH_FAIL_WINDOW);
				return err(c, 401, 'unauthorized', 'Invalid proxy token');
			}
			const retry = limiter.hit('proxy:' + device.id, config.proxyRateLimitPerMin, 60_000);
			if (retry) return tooMany(c, retry);
			try {
				const target = parseTarget(c.req.query('url'), config.proxyAllowPrivate);
				const headers: Record<string, string | undefined> = {};
				for (const [k, v] of c.req.raw.headers) headers[k.toLowerCase()] = v;
				const res = await proxyFetch(target, {
					allowPrivate: config.proxyAllowPrivate,
					maxBytes: config.proxyMaxBytes,
					timeoutMs: config.proxyTimeoutMs,
					selfPrefix: `${publicBase(c)}/v1/proxy/${token}?url=`,
					rewriteHls: c.req.query('raw') !== '1',
					method: c.req.method === 'HEAD' ? 'HEAD' : 'GET',
					headers,
					signal: c.req.raw.signal
				});
				return res;
			} catch (e) {
				if (e instanceof ProxyError) return err(c, e.status, e.code, e.message);
				throw e;
			}
		};
		app.get('/v1/proxy/:token', proxyRoute);
		app.on('HEAD', '/v1/proxy/:token', proxyRoute);
		app.on(['POST', 'PUT', 'DELETE', 'PATCH'], '/v1/proxy/:token', (c) =>
			err(c, 405, 'method_not_allowed', 'Only GET and HEAD are allowed')
		);
	}

	// ---- catalog and sources -------------------------------------------------------

	if (catalog)
		registerCatalogRoutes(app, {
			config,
			catalog,
			limiter,
			auth,
			readJson,
			err,
			tooMany
		});

	// ---- errors ----------------------------------------------------------------

	app.notFound((c) => err(c, 404, 'not_found', 'Not found'));
	app.onError((e, c) => {
		console.error(
			'[error]',
			c.req.method,
			redactPath(c.req.path),
			scrubUrls(redactText((e as Error).message))
		);
		return err(c, 500, 'internal', 'Internal server error');
	});

	return {
		app,
		store,
		events,
		limiter,
		keys,
		sources,
		catalog,
		async dispose() {
			clearInterval(purgeTimer);
			events.closeAll();
			limiter.dispose();
			await catalog?.dispose();
			store.close();
		}
	};
}
