import { describe, expect, it, vi } from 'vitest';
import type {
	HlsConfig,
	Loader,
	LoaderCallbacks,
	LoaderConfiguration,
	LoaderContext,
	LoaderStats
} from 'hls.js';
import {
	HostMemo,
	base64ToArrayBuffer,
	createNativeFallbackLoader,
	emptyStats,
	estimateNativeTiming,
	hostOf,
	shouldUseNativeFallback,
	toResponseData,
	type NativeRequest,
	type NativeResponse
} from './native-loader.ts';

describe('host memo', () => {
	it('remembers native hosts per host, not per url', () => {
		const memo = new HostMemo();
		expect(hostOf('http://Iptv.Example:8080/live/u/p/1.m3u8')).toBe('iptv.example:8080');
		expect(hostOf('not a url')).toBe('');
		memo.markNative('http://iptv.example:8080/live/u/p/1.m3u8');
		expect(memo.needsNative('http://iptv.example:8080/hls/seg-9.ts')).toBe(true);
		expect(memo.needsNative('http://iptv.example/hls/seg-9.ts')).toBe(false);
	});

	it('does not downgrade a native host to xhr and tracks the lowest latency', () => {
		const memo = new HostMemo();
		memo.markXhr('https://cdn.test/a.m3u8');
		expect(memo.xhrWorks('https://cdn.test/b.ts')).toBe(true);
		memo.markNative('https://cdn.test/a.m3u8');
		memo.markXhr('https://cdn.test/a.m3u8');
		expect(memo.needsNative('https://cdn.test/x')).toBe(true);
		memo.noteLatency('https://cdn.test/a', 300);
		memo.noteLatency('https://cdn.test/b', 120);
		memo.noteLatency('https://cdn.test/c', 900);
		expect(memo.latency('https://cdn.test/z')).toBe(120);
	});
});

describe('decision', () => {
	it('falls back only on native, status 0 and not aborted', () => {
		expect(shouldUseNativeFallback({ native: true, code: 0, aborted: false })).toBe(true);
		expect(shouldUseNativeFallback({ native: false, code: 0, aborted: false })).toBe(false);
		expect(shouldUseNativeFallback({ native: true, code: 404, aborted: false })).toBe(false);
		expect(shouldUseNativeFallback({ native: true, code: 0, aborted: true })).toBe(false);
	});
});

describe('base64 and response data', () => {
	it('decodes base64 (and data urls) to an ArrayBuffer', () => {
		const buf = base64ToArrayBuffer('R0VU\nAAH/');
		expect([...new Uint8Array(buf)]).toEqual([71, 69, 84, 0, 1, 255]);
		expect(new Uint8Array(base64ToArrayBuffer('data:video/mp2t;base64,AQID'))).toEqual(
			new Uint8Array([1, 2, 3])
		);
		expect(base64ToArrayBuffer('').byteLength).toBe(0);
	});

	it('normalises CapacitorHttp data', () => {
		expect(new Uint8Array(toResponseData('AQID', true) as ArrayBuffer)).toEqual(
			new Uint8Array([1, 2, 3])
		);
		const ab = new Uint8Array([9]).buffer;
		expect(toResponseData(ab, true)).toBe(ab);
		expect(toResponseData('#EXTM3U', false)).toBe('#EXTM3U');
		expect(toResponseData({ a: 1 }, false)).toBe('{"a":1}');
		expect(() => toResponseData(42, true)).toThrow();
	});
});

describe('timing estimate', () => {
	it('uses the host latency as TTFB, capped at half the request', () => {
		const t1 = estimateNativeTiming(1000, 2000, 100, 1000);
		expect(t1.first).toBe(1100);
		expect(t1.bwEstimate).toBeCloseTo(8000000 / 900);
		expect(estimateNativeTiming(1000, 1100, 500, 10).first).toBe(1050);
		expect(estimateNativeTiming(0, 400, undefined, 100).first).toBe(200);
		expect(Number.isFinite(estimateNativeTiming(5, 5, 0, 100).bwEstimate)).toBe(true);
	});
});

// ---- loader integration with fakes ------------------------------------------------

type ErrFn = (cb: LoaderCallbacks<LoaderContext>, ctx: LoaderContext, stats: LoaderStats) => void;

function fakeBase(behaviour: ErrFn) {
	const seen: LoaderConfiguration[] = [];
	class FakeXhr implements Loader<LoaderContext> {
		context: LoaderContext | null = null;
		stats: LoaderStats = emptyStats();
		load(ctx: LoaderContext, config: LoaderConfiguration, cb: LoaderCallbacks<LoaderContext>) {
			seen.push(config);
			this.context = ctx;
			behaviour(cb, ctx, this.stats);
		}
		abort() {}
		destroy() {}
	}
	return { FakeXhr, seen };
}

const cfg = {
	loadPolicy: {
		maxTimeToFirstByteMs: 5000,
		maxLoadTimeMs: 20000,
		timeoutRetry: null,
		errorRetry: { maxNumRetry: 3, retryDelayMs: 1000, maxRetryDelayMs: 8000 }
	},
	maxRetry: 0,
	timeout: 0,
	retryDelay: 0,
	maxRetryDelay: 0
} as unknown as LoaderConfiguration;

const ctx = (url: string, responseType = 'arraybuffer'): LoaderContext =>
	({ url, responseType, type: 'media-fragment' }) as unknown as LoaderContext;

function callbacks() {
	return {
		onSuccess: vi.fn(),
		onError: vi.fn(),
		onTimeout: vi.fn(),
		onAbort: vi.fn()
	};
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('NativeFallbackLoader', () => {
	it('falls back to a native request on a CORS failure and remembers the host', async () => {
		const memo = new HostMemo();
		const { FakeXhr, seen } = fakeBase((cb, c, stats) =>
			cb.onError({ code: 0, text: '' }, c, null, stats)
		);
		const requests: NativeRequest[] = [];
		let t = 0;
		const Loader = createNativeFallbackLoader(FakeXhr, {
			isNative: () => true,
			memo,
			now: () => (t += 100),
			request: async (r): Promise<NativeResponse> => {
				requests.push(r);
				return { status: 200, data: 'AQID', headers: { Age: '4' }, url: r.url };
			}
		});
		const loader = new Loader({} as HlsConfig);
		const cb = callbacks();
		loader.load(ctx('http://iptv.test/seg1.ts'), cfg, cb);
		await flush();

		expect(seen[0].loadPolicy.errorRetry).toBeNull(); // probe without retries
		expect(requests[0].responseType).toBe('arraybuffer');
		expect(cb.onSuccess).toHaveBeenCalledOnce();
		const [response, stats] = cb.onSuccess.mock.calls[0] as [{ data: ArrayBuffer }, LoaderStats];
		expect(new Uint8Array(response.data)).toEqual(new Uint8Array([1, 2, 3]));
		expect(stats.loaded).toBe(3);
		expect(stats.total).toBe(3);
		expect(stats.loading.start).toBeGreaterThan(0);
		expect(stats.loading.first).toBeGreaterThan(stats.loading.start);
		expect(stats.loading.end).toBeGreaterThanOrEqual(stats.loading.first);
		expect(stats.bwEstimate).toBeGreaterThan(0);
		expect(loader.stats).toBe(stats);
		expect(loader.getCacheAge?.()).toBe(4);
		expect(memo.needsNative('http://iptv.test/other.m3u8')).toBe(true);

		// Next request to the same host goes native directly (XHR not called again).
		const cb2 = callbacks();
		loader.load(ctx('http://iptv.test/list.m3u8', 'text'), cfg, cb2);
		await flush();
		expect(seen).toHaveLength(1);
		expect(requests[1].responseType).toBe('text');
		expect(cb2.onSuccess.mock.calls[0][0].data).toBe('AQID');
	});

	it('passes non-CORS errors through and never falls back on the web', async () => {
		const memo = new HostMemo();
		const request = vi.fn();
		const { FakeXhr } = fakeBase((cb, c, stats) =>
			cb.onError({ code: 404, text: 'Not found' }, c, null, stats)
		);
		const Native = createNativeFallbackLoader(FakeXhr, { isNative: () => true, memo, request });
		const cb = callbacks();
		new Native({} as HlsConfig).load(ctx('http://a.test/x.ts'), cfg, cb);
		expect(cb.onError).toHaveBeenCalledOnce();

		const { FakeXhr: Cors, seen } = fakeBase((cb2, c, stats) =>
			cb2.onError({ code: 0, text: '' }, c, null, stats)
		);
		const Web = createNativeFallbackLoader(Cors, { isNative: () => false, memo, request });
		const cb3 = callbacks();
		new Web({} as HlsConfig).load(ctx('http://b.test/x.ts'), cfg, cb3);
		expect(seen[0]).toBe(cfg); // untouched config on the web
		expect(cb3.onError).toHaveBeenCalledOnce();
		expect(request).not.toHaveBeenCalled();
		expect(memo.needsNative('http://b.test/x.ts')).toBe(false);
	});

	it('keeps full retries once XHR is known to work for a host', () => {
		const memo = new HostMemo();
		const { FakeXhr, seen } = fakeBase((cb, c, stats) =>
			cb.onSuccess({ url: c.url, data: '#EXTM3U' }, stats, c, null)
		);
		const Loader = createNativeFallbackLoader(FakeXhr, {
			isNative: () => true,
			memo,
			request: vi.fn()
		});
		const loader = new Loader({} as HlsConfig);
		loader.load(ctx('https://cdn.test/a.m3u8', 'text'), cfg, callbacks());
		loader.load(ctx('https://cdn.test/b.m3u8', 'text'), cfg, callbacks());
		expect(seen[0].loadPolicy.errorRetry).toBeNull();
		expect(seen[1]).toBe(cfg);
	});

	it('reports native HTTP errors, aborts cleanly and ignores late responses', async () => {
		const memo = new HostMemo();
		memo.markNative('http://n.test/');
		let resolve: (r: NativeResponse) => void = () => {};
		const Loader = createNativeFallbackLoader(fakeBase(() => {}).FakeXhr, {
			isNative: () => true,
			memo,
			request: (r) =>
				r.url.endsWith('404')
					? Promise.resolve({ status: 404, data: '', headers: {}, url: r.url })
					: new Promise((res) => (resolve = res))
		});
		const loader = new Loader({} as HlsConfig);
		const cb = callbacks();
		loader.load(ctx('http://n.test/404'), cfg, cb);
		await flush();
		expect(cb.onError.mock.calls[0][0]).toEqual({ code: 404, text: 'HTTP 404' });

		const cb2 = callbacks();
		loader.load(ctx('http://n.test/slow.ts'), cfg, cb2);
		loader.abort();
		expect(cb2.onAbort).toHaveBeenCalledOnce();
		expect(loader.stats.aborted).toBe(true);
		resolve({ status: 200, data: 'AQID', headers: {}, url: 'http://n.test/slow.ts' });
		await flush();
		expect(cb2.onSuccess).not.toHaveBeenCalled();
		loader.destroy();
	});
});
