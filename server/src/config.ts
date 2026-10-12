// Configuration from environment variables. Every option has a safe default.

export interface Config {
	port: number;
	host: string;
	dbPath: string;
	/** Exact origins or simple globs ("http://localhost:*"). "*" allows every origin. */
	corsOrigins: string[];
	/** Public base url (https://sync.example.com), used to rewrite HLS playlists in the proxy. */
	publicUrl?: string;
	/** Trust X-Forwarded-For / X-Forwarded-Proto (only behind your own reverse proxy). */
	trustProxy: boolean;
	allowSignup: boolean;
	proxyEnabled: boolean;
	/** DANGER: lets the proxy reach private/loopback addresses. Only for tests or a closed LAN. */
	proxyAllowPrivate: boolean;
	proxyMaxBytes: number;
	proxyTimeoutMs: number;
	bodyLimitBytes: number;
	/** Requests per minute per IP for the API (not the proxy). */
	rateLimitPerMin: number;
	/** Proxy requests per minute per device. */
	proxyRateLimitPerMin: number;
	maxDocsPerAccount: number;
	maxDevicesPerAccount: number;
	pairingTtlMs: number;
	log: boolean;
}

export const DEFAULT_CORS_ORIGINS = [
	'capacitor://localhost',
	'ionic://localhost',
	'http://localhost',
	'https://localhost',
	'http://localhost:5173',
	'http://localhost:4173'
];

function int(v: string | undefined, def: number): number {
	const n = v == null || v === '' ? NaN : Number(v);
	return Number.isFinite(n) ? n : def;
}

function bool(v: string | undefined, def: boolean): boolean {
	if (v == null || v === '') return def;
	return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

export function loadConfig(
	env: Record<string, string | undefined> = process.env,
	overrides: Partial<Config> = {}
): Config {
	const extra = (env.CORS_ORIGINS ?? '')
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
	const replace = bool(env.CORS_REPLACE_DEFAULTS, false);
	return {
		port: int(env.PORT, 8787),
		host: env.HOST || '0.0.0.0',
		dbPath: env.DB_PATH || './data/prismastream-sync.db',
		corsOrigins: replace ? extra : [...DEFAULT_CORS_ORIGINS, ...extra],
		publicUrl: env.PUBLIC_URL ? env.PUBLIC_URL.replace(/\/+$/, '') : undefined,
		trustProxy: bool(env.TRUST_PROXY, false),
		allowSignup: bool(env.ALLOW_SIGNUP, true),
		proxyEnabled: bool(env.PROXY_ENABLED, true),
		proxyAllowPrivate: bool(env.PROXY_ALLOW_PRIVATE, false),
		proxyMaxBytes: int(env.PROXY_MAX_BYTES, 100 * 1024 * 1024),
		proxyTimeoutMs: int(env.PROXY_TIMEOUT_MS, 20_000),
		bodyLimitBytes: int(env.BODY_LIMIT_BYTES, 2 * 1024 * 1024),
		rateLimitPerMin: int(env.RATE_LIMIT_PER_MIN, 600),
		proxyRateLimitPerMin: int(env.PROXY_RATE_LIMIT_PER_MIN, 1200),
		maxDocsPerAccount: int(env.MAX_DOCS_PER_ACCOUNT, 1000),
		maxDevicesPerAccount: int(env.MAX_DEVICES_PER_ACCOUNT, 20),
		pairingTtlMs: 10 * 60 * 1000,
		log: bool(env.LOG, true),
		...overrides
	};
}

/** Origin matching with support for "*" and simple globs like "http://localhost:*". */
export function originAllowed(origin: string, allowed: string[]): boolean {
	for (const pattern of allowed) {
		if (pattern === '*' || pattern === origin) return true;
		if (pattern.includes('*')) {
			const re = new RegExp(
				'^' +
					pattern
						.split('*')
						.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
						.join('[^/]*') +
					'$'
			);
			if (re.test(origin)) return true;
		}
	}
	return false;
}
