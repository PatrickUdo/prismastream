// Thin HTTP client for the PrismaStream sync server (see server/README.md for the protocol).
// The token is passed per call and only ever sent in the Authorization header.
import type { Kdf } from './crypto.ts';

export interface RemoteDoc {
	docId: string;
	version: number;
	updatedAt: number;
	deleted: boolean;
	blob: string | null;
}

export interface Credentials {
	accountId: string;
	deviceId: string;
	token: string;
	salt: string;
	kdf: Kdf;
}

/** Session returned by register, login and the device login. */
export interface AuthSession {
	accountId: string;
	token: string;
	deviceId: string;
}

export interface DeviceInfo {
	id: string;
	name: string;
	createdAt: number;
	lastSeenAt: number;
	current: boolean;
}

/** HTTP error from the server (JSON `{ error, message }`). */
export class SyncApiError extends Error {
	status: number;
	code: string;
	body: Record<string, unknown>;
	constructor(status: number, code: string, body: Record<string, unknown> = {}) {
		super(`${status} ${code}`);
		this.name = 'SyncApiError';
		this.status = status;
		this.code = code;
		this.body = body;
	}
}

/** Network failure (offline, DNS, CORS, timeout). */
export class SyncNetworkError extends Error {
	constructor(message = 'Network error') {
		super(message);
		this.name = 'SyncNetworkError';
	}
}

export function normalizeServerUrl(input: string): string | null {
	const s = input.trim().replace(/\/+$/, '');
	try {
		const u = new URL(s);
		if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
		if (u.username || u.password || u.search || u.hash) return null;
		return u.origin + u.pathname.replace(/\/+$/, '');
	} catch {
		return null;
	}
}

/** True when the url would send data unencrypted over the network (http to a non-local host). */
export function isInsecureUrl(url: string): boolean {
	try {
		const u = new URL(url);
		return (
			u.protocol === 'http:' &&
			!['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) &&
			!u.hostname.endsWith('.local')
		);
	} catch {
		return false;
	}
}

interface CallOptions {
	method?: string;
	token?: string;
	json?: unknown;
	headers?: Record<string, string>;
	timeoutMs?: number;
	signal?: AbortSignal;
	/** Statuses that resolve with the parsed body instead of throwing. */
	accept?: number[];
}

export class SyncApi {
	readonly base: string;
	constructor(base: string) {
		this.base = base;
	}

	async call<T>(path: string, o: CallOptions = {}): Promise<{ status: number; body: T }> {
		const ctrl = new AbortController();
		const timer = setTimeout(() => ctrl.abort(), o.timeoutMs ?? 20_000);
		const onAbort = () => ctrl.abort();
		o.signal?.addEventListener('abort', onAbort, { once: true });
		const headers: Record<string, string> = { accept: 'application/json', ...o.headers };
		if (o.token) headers.authorization = `Bearer ${o.token}`;
		if (o.json !== undefined) headers['content-type'] = 'application/json';
		let res: Response;
		try {
			res = await fetch(this.base + path, {
				method: o.method ?? 'GET',
				headers,
				body: o.json === undefined ? undefined : JSON.stringify(o.json),
				signal: ctrl.signal,
				cache: 'no-store',
				credentials: 'omit',
				referrerPolicy: 'no-referrer'
			});
		} catch {
			throw new SyncNetworkError(ctrl.signal.aborted ? 'Timeout' : 'Network error');
		} finally {
			clearTimeout(timer);
			o.signal?.removeEventListener('abort', onAbort);
		}
		let body: unknown = null;
		if (res.status !== 204) {
			try {
				body = await res.json();
			} catch {
				body = null;
			}
		}
		if (res.ok || o.accept?.includes(res.status)) return { status: res.status, body: body as T };
		const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
		throw new SyncApiError(res.status, String(b.error ?? 'http_' + res.status), b);
	}

	health() {
		return this.call<{ ok: boolean; service?: string; signup?: string; features?: string[] }>(
			'/v1/health',
			{ timeoutMs: 8000 }
		);
	}

	async createAccount(deviceName: string, kdf: Kdf, signupCode?: string): Promise<Credentials> {
		const json: Record<string, unknown> = { deviceName, kdf };
		if (signupCode) json.signupCode = signupCode;
		return (
			await this.call<Credentials>('/v1/accounts', {
				method: 'POST',
				json
			})
		).body;
	}

	async pair(code: string, deviceName: string): Promise<Credentials> {
		return (
			await this.call<Credentials>('/v1/devices/pair', {
				method: 'POST',
				json: { code, deviceName }
			})
		).body;
	}

	async me(token: string) {
		return (
			await this.call<{ accountId: string; deviceId: string; salt: string; kdf: Kdf }>('/v1/me', {
				token
			})
		).body;
	}

	async createPairingCode(token: string) {
		return (
			await this.call<{ code: string; expiresAt: number }>('/v1/pairing-codes', {
				method: 'POST',
				token
			})
		).body;
	}

	async devices(token: string): Promise<DeviceInfo[]> {
		return (await this.call<{ devices: DeviceInfo[] }>('/v1/devices', { token })).body.devices;
	}

	async removeDevice(token: string, id: string) {
		return (
			await this.call<{ ok: boolean; accountDeleted: boolean }>(
				`/v1/devices/${encodeURIComponent(id)}`,
				{ method: 'DELETE', token }
			)
		).body;
	}

	async deleteAccount(token: string) {
		await this.call('/v1/account', { method: 'DELETE', token });
	}

	async changes(token: string, since: number) {
		return (
			await this.call<{ docs: RemoteDoc[]; cursor: number; more: boolean }>(
				`/v1/docs?since=${since}&limit=200`,
				{ token, timeoutMs: 30_000 }
			)
		).body;
	}

	async getDoc(token: string, docId: string): Promise<RemoteDoc | null> {
		const r = await this.call<RemoteDoc>(`/v1/docs/${encodeURIComponent(docId)}`, {
			token,
			accept: [404]
		});
		return r.status === 404 ? null : r.body;
	}

	/** Returns the new version, or `{ conflict }` with the server's current doc. */
	async putDoc(
		token: string,
		docId: string,
		version: number,
		payload: { blob: string } | { deleted: true }
	): Promise<{ version: number } | { conflict: RemoteDoc | null }> {
		const r = await this.call<{ version: number; current?: RemoteDoc | null }>(
			`/v1/docs/${encodeURIComponent(docId)}`,
			{
				method: 'PUT',
				token,
				json: payload,
				headers: { 'if-match': `"${version}"` },
				accept: [409],
				timeoutMs: 30_000
			}
		);
		if (r.status === 409) return { conflict: r.body.current ?? null };
		return { version: r.body.version };
	}

	async waitForChanges(token: string, since: number, signal: AbortSignal) {
		return (
			await this.call<{ cursor: number; changed: boolean }>(
				`/v1/events?since=${since}&timeout=25`,
				{ token, signal, timeoutMs: 40_000 }
			)
		).body;
	}

	// ---- e-mail + password accounts (docs/BACKEND.md, "Accounts en synchronisatie") ----------

	async prelogin(email: string) {
		return (
			await this.call<{ salt: string; iterations: number }>('/v1/auth/prelogin', {
				method: 'POST',
				json: { email }
			})
		).body;
	}

	async register(body: {
		email: string;
		authKey: string;
		salt: string;
		iterations: number;
		signupCode?: string;
		deviceName: string;
	}) {
		return (
			await this.call<AuthSession>('/v1/auth/register', {
				method: 'POST',
				json: body,
				timeoutMs: 30_000
			})
		).body;
	}

	async login(body: { email: string; authKey: string; deviceName: string }) {
		return (await this.call<AuthSession>('/v1/auth/login', { method: 'POST', json: body })).body;
	}

	async logout(token: string) {
		await this.call('/v1/auth/logout', { method: 'POST', token, accept: [401, 404] });
	}

	async changePassword(
		token: string,
		body: { oldAuthKey: string; newAuthKey: string; newSalt: string; newIterations: number }
	) {
		await this.call('/v1/auth/password', { method: 'POST', token, json: body });
	}

	async deviceCode(body: { publicKey: string; deviceName: string }) {
		return (
			await this.call<{
				userCode: string;
				deviceCode: string;
				verifyUrl?: string;
				expiresIn: number;
				interval?: number;
			}>('/v1/auth/device-code', { method: 'POST', json: body })
		).body;
	}

	/** Poll once: `{ pending }` while the code waits for approval. */
	async deviceToken(
		deviceCode: string
	): Promise<
		| { pending: true; slowDown?: boolean }
		| (AuthSession & { sealedKey: string; ephemeralPublicKey: string })
	> {
		const r = await this.call<Record<string, unknown>>('/v1/auth/device-token', {
			method: 'POST',
			json: { deviceCode },
			accept: [202, 400, 403, 428]
		});
		const b = (r.body ?? {}) as Record<string, unknown>;
		if (r.status === 200 && typeof b.token === 'string')
			return b as unknown as AuthSession & { sealedKey: string; ephemeralPublicKey: string };
		const code = String(b.error ?? b.code ?? '');
		if (r.status === 202 || code === 'authorization_pending' || code === 'pending')
			return { pending: true };
		if (code === 'slow_down') return { pending: true, slowDown: true };
		throw new SyncApiError(r.status, code || 'http_' + r.status, b);
	}

	async lookupDeviceCode(token: string, userCode: string) {
		return (
			await this.call<{ deviceName: string; publicKey: string; expiresAt?: number }>(
				`/v1/auth/device-code/${encodeURIComponent(userCode)}`,
				{ token }
			)
		).body;
	}

	async approveDeviceCode(
		token: string,
		userCode: string,
		body: { sealedKey: string; ephemeralPublicKey: string }
	) {
		await this.call(`/v1/auth/device-code/${encodeURIComponent(userCode)}/approve`, {
			method: 'POST',
			token,
			json: body
		});
	}

	async proxyToken(token: string) {
		return (
			await this.call<{ proxyToken: string; prefix: string }>('/v1/proxy-token', {
				method: 'POST',
				token
			})
		).body;
	}
}

/** True when a /v1/health `service` value belongs to a PrismaStream server (sync or backend). */
export function isPrismaService(service: unknown): boolean {
	return typeof service === 'string' && service.startsWith('prismastream');
}
