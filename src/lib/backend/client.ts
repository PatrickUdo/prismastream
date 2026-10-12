// Typed HTTP client for the PrismaStream backend (docs/BACKEND.md): catalog and sources API.
//
// - Bearer auth with the device token of the sync account (no second account system).
// - Timeouts, retries with backoff for idempotent calls (network errors, 429, 502-504).
// - ETag / If-None-Match: a small in-memory map of url → { etag, body }; a 304 answers from it.
//   Seeds can be passed in (e.g. the last home response from the persistent cache).
// - Offline detection: navigator.onLine === false or an unreachable server raise
//   BackendOfflineError; `onReachability` reports every change so the UI can show a banner.
//
// Pure TypeScript (no Svelte): unit-tested with a mocked fetch.
import type {
	CatalogMeta,
	ChannelsResponse,
	EpgResponse,
	HomeResponse,
	NowNextResponse,
	RecommendRequest,
	RefreshResponse,
	RemoteSource,
	SearchResponse,
	SourceInputBody,
	SourcePatchBody,
	SourceTestResponse,
	TitleDetail,
	TitlesQuery,
	TitlesResponse
} from './types.ts';
import type { TitleCard } from '#lib/types.ts';

/** HTTP error from the backend (JSON `{ error | code, message }`). */
export class BackendError extends Error {
	readonly status: number;
	readonly code: string;
	readonly body: Record<string, unknown>;
	constructor(status: number, code: string, message?: string, body: Record<string, unknown> = {}) {
		super(message || `${status} ${code}`);
		this.name = 'BackendError';
		this.status = status;
		this.code = code;
		this.body = body;
	}
}

/** The device is offline or the backend cannot be reached (DNS, TLS, CORS, timeout). */
export class BackendOfflineError extends Error {
	readonly reason: 'offline' | 'unreachable' | 'timeout';
	constructor(reason: 'offline' | 'unreachable' | 'timeout' = 'unreachable') {
		super(`Backend ${reason}`);
		this.name = 'BackendOfflineError';
		this.reason = reason;
	}
}

/** No backend url or no account token on this device. */
export class BackendNotConfiguredError extends Error {
	constructor() {
		super('Backend not configured');
		this.name = 'BackendNotConfiguredError';
	}
}

export function isAbortError(err: unknown): boolean {
	return err instanceof DOMException
		? err.name === 'AbortError'
		: (err as Error)?.name === 'AbortError';
}

type QueryValue = string | number | boolean | undefined | null | string[];

export interface RequestOptions {
	method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
	query?: Record<string, QueryValue>;
	json?: unknown;
	signal?: AbortSignal;
	timeoutMs?: number;
	/** Retries after the first attempt (default: 2 for GET, 0 otherwise). */
	retries?: number;
	/** Use the ETag cache (default: true for GET). */
	conditional?: boolean;
	/** Send the bearer token (default: true). */
	auth?: boolean;
}

export interface BackendClientOptions {
	/** Current backend base url (no trailing slash), or null when there is none. */
	baseUrl: () => string | null | undefined;
	/** Current device token, or null. */
	getToken: () => Promise<string | null> | string | null;
	fetch?: typeof fetch;
	/** Default timeout per attempt (ms). */
	timeoutMs?: number;
	/** Sleep used between retries (tests pass a fake). */
	sleep?: (ms: number) => Promise<void>;
	isOnline?: () => boolean;
	/** Called when reachability changes (true = the server answered). */
	onReachability?: (reachable: boolean) => void;
	/** Called on a 401 (the device token was revoked). */
	onUnauthorized?: () => void;
	/** Max entries in the ETag cache. */
	etagEntries?: number;
}

interface EtagEntry {
	etag: string;
	body: unknown;
}

const RETRY_STATUS = new Set([429, 502, 503, 504]);

function buildQuery(query: Record<string, QueryValue> | undefined): string {
	if (!query) return '';
	const q = new URLSearchParams();
	for (const [k, v] of Object.entries(query)) {
		if (v === undefined || v === null || v === '' || v === false) continue;
		if (Array.isArray(v)) {
			if (v.length) q.set(k, v.join(','));
		} else q.set(k, v === true ? '1' : String(v));
	}
	const s = q.toString();
	return s ? `?${s}` : '';
}

function retryAfterMs(res: Response): number | undefined {
	const h = res.headers.get('retry-after');
	if (!h) return undefined;
	const s = Number(h);
	if (Number.isFinite(s)) return Math.min(30_000, Math.max(0, s * 1000));
	const at = Date.parse(h);
	return Number.isFinite(at) ? Math.min(30_000, Math.max(0, at - Date.now())) : undefined;
}

export class BackendClient {
	#o: BackendClientOptions;
	#etags = new Map<string, EtagEntry>();
	/** The server's CORS setup rejected If-None-Match: stop sending it this session. */
	#conditionalBroken = false;
	#reachable: boolean | null = null;

	constructor(options: BackendClientOptions) {
		this.#o = options;
	}

	get base(): string | null {
		const b = this.#o.baseUrl();
		return b ? b.replace(/\/+$/, '') : null;
	}

	/** Last known reachability (null = unknown yet). */
	get reachable(): boolean | null {
		return this.#reachable;
	}

	/** Seed the ETag cache, e.g. with a persisted response. */
	seedEtag(pathWithQuery: string, etag: string, body: unknown) {
		const base = this.base;
		if (!base || !etag) return;
		this.#remember(base + pathWithQuery, { etag, body });
	}

	/** ETag of the last response for a path (to persist it next to the body). */
	etagFor(pathWithQuery: string): string | undefined {
		const base = this.base;
		return base ? this.#etags.get(base + pathWithQuery)?.etag : undefined;
	}

	clearEtags() {
		this.#etags.clear();
	}

	#remember(url: string, e: EtagEntry) {
		this.#etags.delete(url);
		this.#etags.set(url, e);
		const max = this.#o.etagEntries ?? 64;
		while (this.#etags.size > max) this.#etags.delete(this.#etags.keys().next().value!);
	}

	#setReachable(v: boolean) {
		if (this.#reachable === v) return;
		this.#reachable = v;
		this.#o.onReachability?.(v);
	}

	async request<T>(path: string, o: RequestOptions = {}): Promise<T> {
		const base = this.base;
		if (!base) throw new BackendNotConfiguredError();
		const method = o.method ?? 'GET';
		const auth = o.auth ?? true;
		const token = auth ? await this.#o.getToken() : null;
		if (auth && !token) throw new BackendNotConfiguredError();
		const url = base + path + buildQuery(o.query);
		const retries = o.retries ?? (method === 'GET' ? 2 : 0);
		const conditional = (o.conditional ?? method === 'GET') && method === 'GET';
		const sleep = this.#o.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
		const fetchFn = this.#o.fetch ?? fetch;

		let attempt = 0;
		let useConditional = conditional && !this.#conditionalBroken;
		for (;;) {
			if (o.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
			const online =
				this.#o.isOnline?.() ?? (typeof navigator === 'undefined' || navigator.onLine !== false);
			if (!online) {
				this.#setReachable(false);
				throw new BackendOfflineError('offline');
			}
			const cached = useConditional ? this.#etags.get(url) : undefined;
			const headers: Record<string, string> = { accept: 'application/json' };
			if (token) headers.authorization = `Bearer ${token}`;
			if (o.json !== undefined) headers['content-type'] = 'application/json';
			if (cached) headers['if-none-match'] = cached.etag;

			const ctrl = new AbortController();
			let timedOut = false;
			const timer = setTimeout(
				() => {
					timedOut = true;
					ctrl.abort();
				},
				o.timeoutMs ?? this.#o.timeoutMs ?? 15_000
			);
			const onAbort = () => ctrl.abort();
			o.signal?.addEventListener('abort', onAbort, { once: true });

			let res: Response | undefined;
			let failure: BackendOfflineError | undefined;
			try {
				res = await fetchFn(url, {
					method,
					headers,
					body: o.json === undefined ? undefined : JSON.stringify(o.json),
					signal: ctrl.signal,
					cache: 'no-store',
					credentials: 'omit',
					referrerPolicy: 'no-referrer'
				});
			} catch (err) {
				if (o.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
				if (cached && !timedOut && !isAbortError(err)) {
					// Most likely the CORS preflight refused If-None-Match: retry without it.
					this.#conditionalBroken = true;
					useConditional = false;
					clearTimeout(timer);
					o.signal?.removeEventListener('abort', onAbort);
					continue;
				}
				failure = new BackendOfflineError(timedOut ? 'timeout' : 'unreachable');
			} finally {
				clearTimeout(timer);
				o.signal?.removeEventListener('abort', onAbort);
			}

			if (failure || !res) {
				if (attempt < retries) {
					await sleep(300 * 2 ** attempt + Math.floor(Math.random() * 200));
					attempt++;
					continue;
				}
				this.#setReachable(false);
				throw failure ?? new BackendOfflineError('unreachable');
			}

			this.#setReachable(true);

			if (res.status === 304 && cached) return structuredCloneSafe(cached.body) as T;

			if (RETRY_STATUS.has(res.status) && attempt < retries) {
				const wait = retryAfterMs(res) ?? 400 * 2 ** attempt;
				await sleep(Math.min(wait, 8000));
				attempt++;
				continue;
			}

			let body: unknown = null;
			if (res.status !== 204) {
				const text = await res.text().catch(() => '');
				if (text) {
					try {
						body = JSON.parse(text);
					} catch {
						body = null;
					}
				}
			}

			if (res.ok) {
				const etag = res.headers.get('etag');
				if (conditional && etag && body !== null) this.#remember(url, { etag, body });
				return body as T;
			}

			const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
			if (res.status === 401) this.#o.onUnauthorized?.();
			throw new BackendError(
				res.status,
				String(b.code ?? b.error ?? `http_${res.status}`),
				typeof b.message === 'string' ? b.message : undefined,
				b
			);
		}
	}

	// ---- catalog --------------------------------------------------------------------

	meta(signal?: AbortSignal) {
		return this.request<CatalogMeta>('/v1/catalog/meta', { signal });
	}

	home(opts: { kids?: boolean; limit?: number } = {}, signal?: AbortSignal) {
		return this.request<HomeResponse>('/v1/catalog/home', {
			query: { kids: opts.kids, limit: opts.limit },
			signal
		});
	}

	titles(q: TitlesQuery, signal?: AbortSignal) {
		return this.request<TitlesResponse>('/v1/catalog/titles', {
			query: { ...q } as Record<string, QueryValue>,
			signal
		});
	}

	/** Cards by id (max. 100 per call; the order of `ids` is not guaranteed by the server). */
	titlesByIds(ids: string[], opts: { kids?: boolean } = {}, signal?: AbortSignal) {
		return this.request<TitlesResponse>('/v1/catalog/titles', {
			query: { ids: ids.slice(0, 100), kids: opts.kids },
			signal
		});
	}

	title(id: string, signal?: AbortSignal) {
		return this.request<TitleDetail>(`/v1/catalog/titles/${encodeURIComponent(id)}`, {
			signal,
			timeoutMs: 30_000
		});
	}

	search(q: string, opts: { kids?: boolean; limit?: number } = {}, signal?: AbortSignal) {
		return this.request<SearchResponse>('/v1/catalog/search', {
			query: { q, limit: opts.limit, kids: opts.kids },
			signal,
			timeoutMs: 10_000,
			retries: 1
		});
	}

	recommend(body: RecommendRequest, signal?: AbortSignal) {
		return this.request<{ items: TitleCard[] }>('/v1/catalog/recommend', {
			method: 'POST',
			json: body,
			signal,
			retries: 1
		});
	}

	channels(opts: { group?: string; lang?: string; kids?: boolean } = {}, signal?: AbortSignal) {
		return this.request<ChannelsResponse>('/v1/catalog/channels', {
			query: { group: opts.group, lang: opts.lang, kids: opts.kids },
			signal,
			timeoutMs: 30_000
		});
	}

	/** Programmes per epgId (max. 50 channels and 48 hours per call). */
	epg(epgIds: string[], from: number, to: number, signal?: AbortSignal) {
		return this.request<EpgResponse>('/v1/catalog/epg', {
			query: { channels: epgIds.slice(0, 50), from: Math.floor(from), to: Math.ceil(to) },
			signal
		});
	}

	nowNext(channelIds: string[], signal?: AbortSignal) {
		return this.request<NowNextResponse>('/v1/catalog/nownext', {
			query: { channels: channelIds },
			signal,
			conditional: false
		});
	}

	refreshCatalog(body: { force?: boolean; sourceId?: string } = {}) {
		return this.request<RefreshResponse>('/v1/catalog/refresh', { method: 'POST', json: body });
	}

	// ---- sources --------------------------------------------------------------------

	sources(signal?: AbortSignal) {
		return this.request<RemoteSource[] | { items: RemoteSource[] }>('/v1/sources', {
			signal,
			conditional: false
		}).then((r) => (Array.isArray(r) ? r : (r?.items ?? [])));
	}

	testSource(body: SourceInputBody) {
		return this.request<SourceTestResponse>('/v1/sources/test', {
			method: 'POST',
			json: body,
			timeoutMs: 60_000
		});
	}

	addSource(body: SourceInputBody & { name: string }) {
		return this.request<RemoteSource>('/v1/sources', {
			method: 'POST',
			json: body,
			timeoutMs: 30_000
		});
	}

	updateSource(id: string, patch: SourcePatchBody) {
		return this.request<RemoteSource>(`/v1/sources/${encodeURIComponent(id)}`, {
			method: 'PATCH',
			json: patch
		});
	}

	removeSource(id: string) {
		return this.request<unknown>(`/v1/sources/${encodeURIComponent(id)}`, { method: 'DELETE' });
	}
}

function structuredCloneSafe<T>(v: T): T {
	try {
		return structuredClone(v);
	} catch {
		return v;
	}
}
