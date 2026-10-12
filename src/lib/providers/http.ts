// HTTP layer for provider requests: timeouts, retries with backoff, an optional CORS
// proxy for the browser, and typed errors with credential-free messages.
//
// Platforms:
// - iOS/Android: provider requests (Xtream API, M3U, XMLTV) call CapacitorHttp.request()
//   EXPLICITLY (native networking: no CORS; cleartext http allowed via ATS /
//   network_security_config). The global fetch/XHR are NOT patched (CapacitorHttp is
//   disabled in capacitor.config.ts), so hls.js segment traffic stays in the WebView.
//   The native result is wrapped in a standard Response so callers are platform-agnostic.
//   Binary bodies (gzip EPG) are requested as 'arraybuffer'; the bridge returns them
//   base64-encoded and they are decoded here. Native requests cannot be aborted: the
//   timeout races the promise and native read/connect timeouts are set as well.
// - Web/desktop browser: CORS applies, and an https page cannot load http:// at all
//   (mixed content). Most IPTV servers send no CORS headers, so a proxy is usually
//   needed. A proxy url is applied prefix-style: `${proxy}${encodeURIComponent(url)}`,
//   or, when the proxy contains `{url}`, that placeholder is replaced instead.
//   Example: proxyUrl = "http://localhost:8787/proxy?url=".

import {
	Capacitor,
	CapacitorHttp,
	type HttpOptions as CapHttpOptions,
	type HttpResponse as CapHttpResponse
} from '@capacitor/core';
import { redactText, redactUrl } from '#lib/providers/redact.ts';
import { HttpError } from '#lib/providers/errors.ts';

export { HttpError, type HttpErrorCode } from '#lib/providers/errors.ts';

export interface HttpOptions {
	/** Per-attempt timeout in ms (default 20 s). For big downloads this covers time-to-headers. */
	timeoutMs?: number;
	/** Number of extra attempts after the first (default 2). */
	retries?: number;
	/** Base delay for exponential backoff (default 600 ms). */
	backoffMs?: number;
	/** CORS proxy (browser only; the caller decides whether to pass it). */
	proxyUrl?: string;
	/** Extra strings to mask in error messages (passwords, usernames). */
	secrets?: string[];
	signal?: AbortSignal;
	headers?: Record<string, string>;
	/**
	 * 'text' (default) or 'binary'. Only matters on native, where CapacitorHttp needs to
	 * know whether to base64-encode the body (use 'binary' for possibly gzipped XMLTV).
	 */
	responseType?: 'text' | 'binary';
	/** Injected fetch (tests). Default: CapacitorHttp on native, globalThis.fetch on the web. */
	fetch?: typeof fetch;
}

type NativeRequest = (o: CapHttpOptions) => Promise<CapHttpResponse>;

/** Decode base64 to bytes (atob is available in WebViews and Node). */
function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
	const bin = atob(b64.replace(/\s/g, ''));
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

const BASE64_HEAD = /^[A-Za-z0-9+/=\r\n]{8,}$/;

/** CapacitorHttp response data → body for `new Response()`. */
function nativeBody(data: unknown, binary: boolean): BodyInit | null {
	if (data == null) return null;
	if (data instanceof ArrayBuffer || data instanceof Uint8Array) return data as BodyInit;
	if (typeof data !== 'string') return JSON.stringify(data); // JSON auto-parsed by the plugin
	if (binary) {
		// Binary response types come back base64-encoded. A server that ignores the
		// requested type may still send plain text (e.g. XML starting with '<').
		if (BASE64_HEAD.test(data.slice(0, 256))) {
			try {
				return base64ToBytes(data);
			} catch {
				// not base64 after all
			}
		}
	}
	return data;
}

/**
 * Build a fetch-compatible function on top of CapacitorHttp.request (GET only).
 * Exported for tests (inject a fake `request`).
 */
export function createNativeFetch(
	request: NativeRequest,
	opts: { binary?: boolean; timeoutMs?: number } = {}
) {
	return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
		const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
		const headers: Record<string, string> = {};
		new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
		const res = await request({
			url,
			method: 'GET',
			headers,
			responseType: opts.binary ? 'arraybuffer' : 'text',
			connectTimeout: opts.timeoutMs,
			readTimeout: opts.timeoutMs,
			// Our urls are already encoded (credentials, proxy prefix).
			shouldEncodeUrlParams: false
		});
		const status = res.status >= 200 && res.status <= 599 ? res.status : 502;
		const body = status === 204 || status === 304 ? null : nativeBody(res.data, !!opts.binary);
		const hdrs = new Headers();
		for (const [k, v] of Object.entries(res.headers ?? {})) {
			try {
				hdrs.set(k, String(v));
			} catch {
				// skip invalid header names
			}
		}
		return new Response(body, { status, headers: hdrs });
	};
}

/** Transport for one request: injected fetch (tests), native CapacitorHttp, or web fetch. */
function transport(opts: HttpOptions): typeof fetch {
	if (opts.fetch) return opts.fetch;
	if (Capacitor.isNativePlatform())
		return createNativeFetch((o) => CapacitorHttp.request(o), {
			binary: opts.responseType === 'binary',
			timeoutMs: opts.timeoutMs ?? 20_000
		}) as typeof fetch;
	return globalThis.fetch.bind(globalThis);
}

/** Apply a proxy to a url. Empty/undefined proxy returns the url unchanged. */
export function applyProxy(url: string, proxyUrl?: string): string {
	const p = proxyUrl?.trim();
	if (!p) return url;
	if (p.includes('{url}')) return p.replace('{url}', encodeURIComponent(url));
	return p + encodeURIComponent(url);
}

const sleep = (ms: number, signal?: AbortSignal) =>
	new Promise<void>((resolve, reject) => {
		if (signal?.aborted) return reject(new HttpError('aborted', 'Request aborted'));
		const t = setTimeout(resolve, ms);
		signal?.addEventListener(
			'abort',
			() => {
				clearTimeout(t);
				reject(new HttpError('aborted', 'Request aborted'));
			},
			{ once: true }
		);
	});

function isRetryable(err: unknown): boolean {
	if (!(err instanceof HttpError)) return false;
	if (err.code === 'timeout' || err.code === 'unreachable') return true;
	if (err.code === 'http' && err.status !== undefined)
		return err.status >= 500 || err.status === 429 || err.status === 408;
	return false;
}

/**
 * One request with timeout, without retries. Returns the Response (status 2xx);
 * throws HttpError otherwise. The timeout is cleared once headers arrive, so long
 * bodies can still stream; use `signal` to cancel a body read.
 */
async function attempt(url: string, opts: HttpOptions): Promise<Response> {
	const doFetch = transport(opts);
	const target = applyProxy(url, opts.proxyUrl);
	const safeUrl = redactUrl(url, opts.secrets);
	const ctrl = new AbortController();
	const onAbort = () => ctrl.abort();
	opts.signal?.addEventListener('abort', onAbort, { once: true });
	let timedOut = false;
	// On the web the timeout covers time-to-headers (the body streams afterwards). Native
	// CapacitorHttp resolves only after the WHOLE body has arrived, so allow more time
	// there; stalls are caught by the native connect/read timeouts (= timeoutMs).
	const nativeTransport = !opts.fetch && Capacitor.isNativePlatform();
	const timeoutMs = (opts.timeoutMs ?? 20_000) * (nativeTransport ? 6 : 1);
	let timer: ReturnType<typeof setTimeout> | undefined;
	// Promise.race as well as abort(): native requests cannot be aborted.
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => {
			timedOut = true;
			ctrl.abort();
			reject(
				new HttpError('timeout', `Timeout after ${timeoutMs} ms: ${safeUrl}`, { url: safeUrl })
			);
		}, timeoutMs);
	});
	try {
		const res = await Promise.race([
			doFetch(target, { signal: ctrl.signal, headers: opts.headers, redirect: 'follow' }),
			timeout
		]);
		if (!res.ok) {
			const status = res.status;
			// Drain/cancel the body so the connection can be reused.
			void res.body?.cancel().catch(() => {});
			if (status === 401 || status === 403)
				throw new HttpError('auth', `HTTP ${status} (access denied): ${safeUrl}`, {
					status,
					url: safeUrl
				});
			throw new HttpError('http', `HTTP ${status}: ${safeUrl}`, { status, url: safeUrl });
		}
		return res;
	} catch (err) {
		if (err instanceof HttpError) throw err;
		if (timedOut)
			throw new HttpError('timeout', `Timeout after ${timeoutMs} ms: ${safeUrl}`, { url: safeUrl });
		if (opts.signal?.aborted) throw new HttpError('aborted', 'Request aborted', { url: safeUrl });
		const msg = err instanceof Error ? err.message : String(err);
		// Native stacks report their own (connect/read) timeouts as errors.
		if (/timed?\s?out|SocketTimeout|NSURLErrorDomain.*-1001/i.test(msg))
			throw new HttpError('timeout', `Timeout: ${safeUrl}`, { url: safeUrl });
		throw new HttpError(
			'unreachable',
			`${redactText(msg, opts.secrets)} (${safeUrl})`.slice(0, 500),
			{ url: safeUrl }
		);
	} finally {
		clearTimeout(timer);
		opts.signal?.removeEventListener('abort', onAbort);
	}
}

/** GET with timeout + retries (exponential backoff with jitter on network/5xx/429 errors). */
export async function httpGet(url: string, opts: HttpOptions = {}): Promise<Response> {
	const retries = opts.retries ?? 2;
	const base = opts.backoffMs ?? 600;
	let lastErr: unknown;
	for (let i = 0; i <= retries; i++) {
		try {
			return await attempt(url, opts);
		} catch (err) {
			lastErr = err;
			if (i === retries || !isRetryable(err)) break;
			await sleep(base * 2 ** i * (0.75 + Math.random() * 0.5), opts.signal);
		}
	}
	throw lastErr;
}

/** GET text. */
export async function fetchText(url: string, opts: HttpOptions = {}): Promise<string> {
	const res = await httpGet(url, opts);
	try {
		return await res.text();
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		throw new HttpError('unreachable', `Download interrupted: ${redactText(msg, opts.secrets)}`, {
			url: redactUrl(url, opts.secrets)
		});
	}
}

/**
 * GET JSON. Tolerates a UTF-8 BOM and leading whitespace; throws 'invalid' for HTML or
 * malformed bodies (many panels answer errors with an HTML page and status 200).
 */
export async function fetchJSON<T = unknown>(url: string, opts: HttpOptions = {}): Promise<T> {
	const text = (await fetchText(url, opts)).replace(/^\uFEFF/, '').trim();
	const safeUrl = redactUrl(url, opts.secrets);
	if (!text) throw new HttpError('invalid', `Empty response: ${safeUrl}`, { url: safeUrl });
	if (text[0] !== '{' && text[0] !== '[')
		throw new HttpError(
			'invalid',
			`Expected JSON, got: ${redactText(text.slice(0, 80), opts.secrets)}`,
			{
				url: safeUrl
			}
		);
	try {
		return JSON.parse(text) as T;
	} catch {
		throw new HttpError('invalid', `Malformed JSON: ${safeUrl}`, { url: safeUrl });
	}
}

/** Normalise any thrown value to an HttpError (keeps messages credential-free). */
export function toHttpError(err: unknown, secrets: string[] = []): HttpError {
	if (err instanceof HttpError) return err;
	const msg = err instanceof Error ? err.message : String(err);
	return new HttpError('invalid', redactText(msg, secrets).slice(0, 500));
}
