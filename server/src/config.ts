// Configuration from environment variables. Every option has a safe default.

export interface Config {
	port: number;
	host: string;
	/** NODE_ENV=production: stricter defaults (no open signup, SERVER_KEY required). */
	production: boolean;
	/** Root for all server data: sync database, catalog database, caches, dev key. */
	dataDir: string;
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
	/** Invitation code for POST /v1/accounts when signup is closed (timing-safe compare). */
	signupCode?: string;
	/** Base64 32-byte server key (SERVER_KEY) or a file with it (SERVER_KEY_FILE). */
	serverKey?: string | Uint8Array;
	serverKeyFile?: string;
	/** The fictional demo library as a source per account (never in production). */
	demoSource: boolean;
	/** Base url shown to TVs for the device login (verifyUrl). */
	verifyUrl: string;
	/** Server-side catalog (sources, merge, cache; streams go device → provider). */
	catalogEnabled: boolean;
	/** Language for overviews/episode titles in the merged catalog. */
	catalogLang: string;
	/** Hours between scheduled refreshes per account (0 = no scheduler). */
	catalogRefreshHours: number;
	/** Heap limit (MB) of the worker thread that runs a catalog build. */
	buildMemoryMb: number;
	/** Run catalog builds inline instead of in a worker thread (tests/debugging only). */
	buildInline: boolean;
	/** Optional TMDB key for server-side enrichment (shared metadata cache). */
	tmdbApiKey?: string;
	/** TMDB lookups per build (rate limited by the client). */
	tmdbMaxTitles: number;
	/** Limits for upstream IPTV downloads. */
	m3uMaxBytes: number;
	jsonMaxBytes: number;
	xmltvMaxBytes: number;
	fetchTimeoutMs: number;
	fetchUserAgent: string;
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
	const production = (env.NODE_ENV ?? '').toLowerCase() === 'production';
	const dataDir = (env.DATA_DIR || './data').replace(/\/+$/, '') || '.';
	return {
		port: int(env.PORT, 8787),
		host: env.HOST || '0.0.0.0',
		production,
		dataDir,
		dbPath: env.DB_PATH || `${dataDir}/prismastream-sync.db`,
		corsOrigins: replace ? extra : [...DEFAULT_CORS_ORIGINS, ...extra],
		publicUrl: env.PUBLIC_URL ? env.PUBLIC_URL.replace(/\/+$/, '') : undefined,
		trustProxy: bool(env.TRUST_PROXY, false),
		allowSignup: bool(env.ALLOW_SIGNUP, !production),
		proxyEnabled: bool(env.PROXY_ENABLED, false),
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
		signupCode: env.SIGNUP_CODE?.trim() || undefined,
		serverKey: env.SERVER_KEY?.trim() || undefined,
		serverKeyFile: env.SERVER_KEY_FILE?.trim() || undefined,
		demoSource: bool(env.DEMO_SOURCE, !production),
		verifyUrl: env.VERIFY_URL || 'https://prismastream.patrickudo.nl/activate',
		catalogEnabled: bool(env.CATALOG_ENABLED, true),
		catalogLang: (env.CATALOG_LANG || 'nl').toLowerCase(),
		catalogRefreshHours: int(env.CATALOG_REFRESH_HOURS, 12),
		buildMemoryMb: int(env.CATALOG_BUILD_MEMORY_MB, 256),
		buildInline: bool(env.CATALOG_BUILD_INLINE, false),
		tmdbApiKey: env.TMDB_API_KEY?.trim() || undefined,
		tmdbMaxTitles: int(env.TMDB_MAX_TITLES, 400),
		m3uMaxBytes: int(env.M3U_MAX_BYTES, 200 * 1024 * 1024),
		jsonMaxBytes: int(env.JSON_MAX_BYTES, 200 * 1024 * 1024),
		xmltvMaxBytes: int(env.XMLTV_MAX_BYTES, 300 * 1024 * 1024),
		fetchTimeoutMs: int(env.FETCH_TIMEOUT_MS, 30_000),
		fetchUserAgent: env.FETCH_USER_AGENT || 'PrismaStream/1.0',
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
