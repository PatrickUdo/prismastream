// hls.js loader with a native-HTTP fallback for IPTV servers without CORS headers.
//
// On native (Capacitor) the first request to a host goes through the normal XHR loader.
// If it fails with status 0 (CORS / blocked / network), the same url is fetched through
// CapacitorHttp and the host is remembered, so later requests to it go native directly.
// On the web there is no fallback (a sync-server proxy will handle that).
//
// This module has no Capacitor import: the native request function is injected
// (see engine.svelte.ts), which keeps everything here unit-testable.
import type {
	HlsConfig,
	Loader,
	LoaderCallbacks,
	LoaderConfiguration,
	LoaderContext,
	LoaderStats
} from 'hls.js';

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Host key for the memo ('' when the url cannot be parsed). */
export function hostOf(url: string): string {
	try {
		return new URL(url).host.toLowerCase();
	} catch {
		return '';
	}
}

/** Per-host memory: which hosts need native requests, which work with XHR, and their latency. */
export class HostMemo {
	#mode = new Map<string, 'xhr' | 'native'>();
	#latency = new Map<string, number>();

	needsNative(url: string): boolean {
		return this.#mode.get(hostOf(url)) === 'native';
	}

	/** XHR already worked for this host (no need to probe without retries). */
	xhrWorks(url: string): boolean {
		return this.#mode.get(hostOf(url)) === 'xhr';
	}

	markNative(url: string) {
		const h = hostOf(url);
		if (h) this.#mode.set(h, 'native');
	}

	markXhr(url: string) {
		const h = hostOf(url);
		if (h && this.#mode.get(h) !== 'native') this.#mode.set(h, 'xhr');
	}

	/** Record a native request duration; the smallest one approximates the time to first byte. */
	noteLatency(url: string, ms: number) {
		const h = hostOf(url);
		if (!h || !Number.isFinite(ms) || ms < 0) return;
		const cur = this.#latency.get(h);
		if (cur === undefined || ms < cur) this.#latency.set(h, ms);
	}

	latency(url: string): number | undefined {
		return this.#latency.get(hostOf(url));
	}

	clear() {
		this.#mode.clear();
		this.#latency.clear();
	}
}

/** Fall back to a native request only on native platforms, for status-0 failures that were not aborted. */
export function shouldUseNativeFallback(opts: {
	native: boolean;
	code: number;
	aborted: boolean;
}): boolean {
	return opts.native && !opts.aborted && opts.code === 0;
}

type Base64Decoder = { fromBase64?: (s: string) => Uint8Array };

/** Decode base64 (optionally a data: url) to an ArrayBuffer. */
export function base64ToArrayBuffer(b64: string): ArrayBuffer {
	const clean = b64.replace(/^data:[^,]*,/, '').replace(/\s+/g, '');
	const fast = (Uint8Array as unknown as Base64Decoder).fromBase64;
	if (fast) {
		const bytes = fast(clean);
		return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
	}
	const bin = atob(clean);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out.buffer;
}

/** Normalise CapacitorHttp response data for the requested hls.js response type. */
export function toResponseData(data: unknown, binary: boolean): string | ArrayBuffer {
	if (binary) {
		if (data instanceof ArrayBuffer) return data;
		if (ArrayBuffer.isView(data))
			return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
		if (typeof data === 'string') return base64ToArrayBuffer(data);
		throw new Error('Unexpected binary response type');
	}
	if (typeof data === 'string') return data;
	if (data == null) return '';
	// CapacitorHttp parses JSON content types; hls.js wants the raw text.
	return JSON.stringify(data);
}

/**
 * CapacitorHttp delivers the whole body at once, so there is no real first-byte moment.
 * Estimate it from the host's fastest request (≈ latency), capped at half of this request,
 * so hls.js gets a sensible TTFB and bandwidth estimate for ABR.
 */
export function estimateNativeTiming(
	start: number,
	end: number,
	hostLatency: number | undefined,
	bytes: number
): { first: number; bwEstimate: number } {
	const total = Math.max(0, end - start);
	const ttfb = Math.min(hostLatency ?? total / 2, total / 2);
	const first = start + ttfb;
	const streaming = Math.max(1, end - first);
	return { first, bwEstimate: (bytes * 8000) / streaming };
}

export function emptyStats(): LoaderStats {
	return {
		aborted: false,
		loaded: 0,
		retry: 0,
		total: 0,
		chunkCount: 0,
		bwEstimate: 0,
		loading: { start: 0, first: 0, end: 0 },
		parsing: { start: 0, end: 0 },
		buffering: { start: 0, first: 0, end: 0 }
	};
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export interface NativeRequest {
	url: string;
	headers: Record<string, string>;
	responseType: 'text' | 'arraybuffer';
	connectTimeout?: number;
	readTimeout?: number;
}

export interface NativeResponse {
	status: number;
	data: unknown;
	headers: Record<string, string>;
	url: string;
}

export interface NativeLoaderDeps {
	isNative: () => boolean;
	request: (req: NativeRequest) => Promise<NativeResponse>;
	memo: HostMemo;
	now?: () => number;
}

export type LoaderCtor = new (config: HlsConfig) => Loader<LoaderContext>;

/** Shared memo for the whole app session. */
export const hostMemo = new HostMemo();

/** Build an hls.js `loader` class that wraps `Base` (the default XhrLoader). */
export function createNativeFallbackLoader(Base: LoaderCtor, deps: NativeLoaderDeps): LoaderCtor {
	const now = deps.now ?? (() => performance.now());

	return class NativeFallbackLoader implements Loader<LoaderContext> {
		context: LoaderContext | null = null;
		#inner: Loader<LoaderContext> | null;
		#mode: 'inner' | 'native' = 'inner';
		#nativeStats: LoaderStats = emptyStats();
		#nativeHeaders: Record<string, string> = {};
		#callbacks: LoaderCallbacks<LoaderContext> | null = null;
		#token = 0;
		#timer: ReturnType<typeof setTimeout> | undefined;

		constructor(config: HlsConfig) {
			this.#inner = new Base(config);
		}

		get stats(): LoaderStats {
			return this.#mode === 'native' || !this.#inner ? this.#nativeStats : this.#inner.stats;
		}

		set stats(s: LoaderStats) {
			if (this.#mode === 'native' || !this.#inner) this.#nativeStats = s;
			else this.#inner.stats = s;
		}

		load(
			context: LoaderContext,
			config: LoaderConfiguration,
			callbacks: LoaderCallbacks<LoaderContext>
		): void {
			const inner = this.#inner;
			this.context = context;
			this.#callbacks = callbacks;
			this.#token++;
			clearTimeout(this.#timer);
			const native = deps.isNative();
			if (native && (deps.memo.needsNative(context.url) || !inner)) {
				this.#loadNative(context, config, callbacks, 0);
				return;
			}
			this.#mode = 'inner';
			if (!inner) return;
			if (!native) {
				inner.load(context, config, callbacks);
				return;
			}
			// Unknown host on native: probe XHR without loader-level retries, so a CORS
			// failure falls back immediately instead of after several retry delays.
			const probe = deps.memo.xhrWorks(context.url)
				? config
				: { ...config, loadPolicy: { ...config.loadPolicy, errorRetry: null } };
			inner.load(context, probe, {
				...callbacks,
				onSuccess: (response, stats, ctx, details) => {
					deps.memo.markXhr(ctx.url);
					callbacks.onSuccess(response, stats, ctx, details);
				},
				onError: (error, ctx, details, stats) => {
					if (shouldUseNativeFallback({ native, code: error.code, aborted: stats.aborted })) {
						deps.memo.markNative(ctx.url);
						this.#loadNative(ctx, config, callbacks, stats.retry);
						return;
					}
					callbacks.onError(error, ctx, details, stats);
				}
			});
		}

		#loadNative(
			context: LoaderContext,
			config: LoaderConfiguration,
			callbacks: LoaderCallbacks<LoaderContext>,
			retry: number
		) {
			this.#mode = 'native';
			const token = ++this.#token;
			const stats = emptyStats();
			stats.retry = retry;
			const start = now();
			stats.loading.start = start;
			this.#nativeStats = stats;
			this.#nativeHeaders = {};

			const policy = config.loadPolicy;
			const ttfbMs = Number.isFinite(policy.maxTimeToFirstByteMs)
				? policy.maxTimeToFirstByteMs
				: undefined;
			const loadMs = Number.isFinite(policy.maxLoadTimeMs) ? policy.maxLoadTimeMs : undefined;
			clearTimeout(this.#timer);
			if (loadMs)
				this.#timer = setTimeout(() => {
					if (token !== this.#token) return;
					this.#token++;
					callbacks.onTimeout(stats, context, null);
				}, loadMs);

			const headers: Record<string, string> = { ...(context.headers ?? {}) };
			if (context.rangeEnd)
				headers.Range = `bytes=${context.rangeStart ?? 0}-${context.rangeEnd - 1}`;
			const binary = context.responseType === 'arraybuffer';

			deps
				.request({
					url: context.url,
					headers,
					responseType: binary ? 'arraybuffer' : 'text',
					connectTimeout: ttfbMs,
					readTimeout: loadMs
				})
				.then((res) => {
					if (token !== this.#token) return;
					clearTimeout(this.#timer);
					const end = now();
					this.#nativeHeaders = res.headers ?? {};
					if (res.status < 200 || res.status >= 300) {
						stats.loading.first = stats.loading.end = end;
						callbacks.onError(
							{ code: res.status, text: `HTTP ${res.status}` },
							context,
							null,
							stats
						);
						return;
					}
					const data = toResponseData(res.data, binary);
					const bytes = typeof data === 'string' ? data.length : data.byteLength;
					deps.memo.noteLatency(context.url, end - start);
					const timing = estimateNativeTiming(start, end, deps.memo.latency(context.url), bytes);
					stats.loading.first = timing.first;
					stats.loading.end = end;
					stats.loaded = stats.total = bytes;
					stats.bwEstimate = timing.bwEstimate;
					callbacks.onProgress?.(stats, context, data, null);
					callbacks.onSuccess(
						{ url: res.url || context.url, data, code: res.status },
						stats,
						context,
						null
					);
				})
				.catch((err: unknown) => {
					if (token !== this.#token) return;
					clearTimeout(this.#timer);
					stats.loading.end = now();
					callbacks.onError(
						{ code: 0, text: err instanceof Error ? err.message : String(err) },
						context,
						null,
						stats
					);
				});
		}

		abort(): void {
			if (this.#mode === 'native') {
				if (this.#nativeStats.loading.end) return; // already finished
				this.#token++;
				clearTimeout(this.#timer);
				this.#nativeStats.aborted = true;
				if (this.context) this.#callbacks?.onAbort?.(this.#nativeStats, this.context, null);
				return;
			}
			this.#inner?.abort();
		}

		destroy(): void {
			this.#token++;
			clearTimeout(this.#timer);
			this.#inner?.destroy();
			this.#inner = null;
			this.#callbacks = null;
			this.context = null;
		}

		getCacheAge(): number | null {
			if (this.#mode !== 'native') return this.#inner?.getCacheAge?.() ?? null;
			const age = this.getResponseHeader('age');
			return age ? parseFloat(age) : null;
		}

		getResponseHeader(name: string): string | null {
			if (this.#mode !== 'native') return this.#inner?.getResponseHeader?.(name) ?? null;
			const key = Object.keys(this.#nativeHeaders).find(
				(k) => k.toLowerCase() === name.toLowerCase()
			);
			return key ? this.#nativeHeaders[key] : null;
		}
	};
}
