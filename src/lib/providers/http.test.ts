import { describe, expect, it, vi } from 'vitest';
import { gzipSync } from 'node:zlib';
import {
	applyProxy,
	createNativeFetch,
	fetchJSON,
	httpGet,
	HttpError
} from '#lib/providers/http.ts';
import { parseXmltv } from '#lib/providers/xmltv.ts';
import {
	redactSecrets,
	redactText,
	redactUrl,
	secretsFromUrl,
	urlHasSecrets
} from '#lib/providers/redact.ts';

describe('redactUrl', () => {
	it('masks query credentials', () => {
		expect(redactUrl('http://h:8080/get.php?username=bob&password=hunter2&type=m3u_plus')).toBe(
			'http://h:8080/get.php?username=***&password=***&type=m3u_plus'
		);
		expect(redactUrl('http://h/x.m3u?token=abc123&x=1')).toBe('http://h/x.m3u?token=***&x=1');
	});
	it('masks Xtream stream paths', () => {
		expect(redactUrl('http://h:8080/movie/bob/hunter2/5001.mkv')).toBe(
			'http://h:8080/movie/***/***/5001.mkv'
		);
		expect(redactUrl('http://h/live/bob/hunter2/101.m3u8')).toBe('http://h/live/***/***/101.m3u8');
		expect(redactUrl('http://h/series/bob/hunter2/7.mp4')).toBe('http://h/series/***/***/7.mp4');
	});
	it('masks userinfo', () => {
		expect(redactUrl('http://bob:hunter2@h/list.m3u')).toBe('http://***:***@h/list.m3u');
	});
	it('masks extra secrets and leaves clean urls alone', () => {
		expect(redactUrl('http://h/hunter2/list', ['hunter2'])).toBe('http://h/***/list');
		expect(redactUrl('https://example.com/a.m3u')).toBe('https://example.com/a.m3u');
		expect(urlHasSecrets('https://example.com/a.m3u')).toBe(false);
		expect(urlHasSecrets('http://h/get.php?username=a&password=b')).toBe(true);
	});
	it('handles non-urls', () => {
		expect(redactUrl('not a url?username=x&password=y')).toBe(
			'not a url?username=***&password=***'
		);
		expect(redactUrl('')).toBe('');
	});
	it('redacts urls inside text and encoded secrets', () => {
		expect(redactText('fetch failed for http://h/movie/bob/p%40ss/1.mkv: p@ss', ['p@ss'])).toBe(
			'fetch failed for http://h/movie/***/***/1.mkv: ***'
		);
		expect(redactSecrets('a=p%40ss', ['p@ss'])).toBe('a=***');
		expect(redactSecrets('ab', ['a'])).toBe('ab'); // too short to mask
	});
	it('extracts secrets from urls', () => {
		expect(secretsFromUrl('http://h/get.php?username=bob&password=hunter2&type=m3u')).toEqual([
			'bob',
			'hunter2'
		]);
		expect(secretsFromUrl('http://h/live/bob/hunter2/1.ts')).toEqual(['bob', 'hunter2']);
		expect(secretsFromUrl('nope')).toEqual([]);
	});
});

describe('applyProxy', () => {
	it('prefixes or substitutes', () => {
		expect(applyProxy('http://h/a?b=1', 'http://p/?url=')).toBe(
			'http://p/?url=http%3A%2F%2Fh%2Fa%3Fb%3D1'
		);
		expect(applyProxy('http://h/a', 'http://p/fetch/{url}/raw')).toBe(
			'http://p/fetch/http%3A%2F%2Fh%2Fa/raw'
		);
		expect(applyProxy('http://h/a', '')).toBe('http://h/a');
		expect(applyProxy('http://h/a', undefined)).toBe('http://h/a');
	});
});

describe('httpGet', () => {
	it('retries 5xx with backoff, then succeeds', async () => {
		let n = 0;
		const f = vi.fn(async () =>
			++n < 3 ? new Response('busy', { status: 503 }) : new Response('ok')
		);
		const res = await httpGet('http://h/x', { fetch: f as unknown as typeof fetch, backoffMs: 1 });
		expect(await res.text()).toBe('ok');
		expect(f).toHaveBeenCalledTimes(3);
	});

	it('does not retry auth errors', async () => {
		const f = vi.fn(async () => new Response('no', { status: 401 }));
		await expect(
			httpGet('http://h/x', { fetch: f as unknown as typeof fetch, backoffMs: 1 })
		).rejects.toMatchObject({
			code: 'auth',
			status: 401
		});
		expect(f).toHaveBeenCalledTimes(1);
	});

	it('times out (even when fetch ignores the abort signal)', async () => {
		const f = vi.fn(() => new Promise<Response>(() => {}));
		await expect(
			httpGet('http://h/x', {
				fetch: f as unknown as typeof fetch,
				timeoutMs: 20,
				retries: 1,
				backoffMs: 1
			})
		).rejects.toMatchObject({ code: 'timeout' });
		expect(f).toHaveBeenCalledTimes(2);
	});

	it('maps network failures to unreachable without leaking credentials', async () => {
		const f = vi.fn(async (url: string) => {
			throw new TypeError(`connect ECONNREFUSED for ${url}`);
		});
		const err = (await httpGet('http://h/movie/bob/hunter2/1.mkv', {
			fetch: f as unknown as typeof fetch,
			retries: 0,
			secrets: ['hunter2', 'bob']
		}).catch((e) => e)) as HttpError;
		expect(err).toBeInstanceOf(HttpError);
		expect(err.code).toBe('unreachable');
		expect(err.message).not.toContain('hunter2');
		expect(err.message).not.toContain('bob');
		expect(err.url).toBe('http://h/movie/***/***/1.mkv');
	});

	it('uses the proxy url', async () => {
		const f = vi.fn(async () => new Response('{}'));
		await httpGet('http://h/x', { fetch: f as unknown as typeof fetch, proxyUrl: 'http://p/?u=' });
		expect((f.mock.calls[0] as unknown[])[0]).toBe('http://p/?u=http%3A%2F%2Fh%2Fx');
	});
});

describe('fetchJSON', () => {
	const ok = (body: string) => vi.fn(async () => new Response(body)) as unknown as typeof fetch;
	it('parses JSON with a BOM', async () => {
		expect(await fetchJSON('http://h', { fetch: ok('﻿ {"a":1}') })).toEqual({ a: 1 });
	});
	it('rejects HTML, empty and malformed bodies as invalid', async () => {
		await expect(fetchJSON('http://h', { fetch: ok('<html>') })).rejects.toMatchObject({
			code: 'invalid'
		});
		await expect(fetchJSON('http://h', { fetch: ok('') })).rejects.toMatchObject({
			code: 'invalid'
		});
		await expect(fetchJSON('http://h', { fetch: ok('{"a":') })).rejects.toMatchObject({
			code: 'invalid'
		});
	});
});

describe('createNativeFetch (CapacitorHttp adapter)', () => {
	type Req = Parameters<Parameters<typeof createNativeFetch>[0]>[0];
	const fake = (
		res: { data: unknown; status?: number; headers?: Record<string, string> } | Error
	) => {
		const calls: Req[] = [];
		const request = vi.fn(async (o: Req) => {
			calls.push(o);
			if (res instanceof Error) throw res;
			return { data: res.data, status: res.status ?? 200, headers: res.headers ?? {}, url: o.url };
		});
		return { request, calls };
	};

	it('returns text bodies and requests responseType text', async () => {
		const { request, calls } = fake({ data: '#EXTM3U\n' });
		const res = await createNativeFetch(request)('http://h/list.m3u?username=a&password=b');
		expect(await res.text()).toBe('#EXTM3U\n');
		expect(calls[0]).toMatchObject({
			method: 'GET',
			responseType: 'text',
			shouldEncodeUrlParams: false
		});
		expect(calls[0].url).toBe('http://h/list.m3u?username=a&password=b');
	});

	it('re-serialises JSON the plugin already parsed', async () => {
		const { request } = fake({
			data: { user_info: { auth: 1 } },
			headers: { 'Content-Type': 'application/json' }
		});
		const json = await fetchJSON('http://h/player_api.php', {
			fetch: createNativeFetch(request) as typeof fetch
		});
		expect(json).toEqual({ user_info: { auth: 1 } });
	});

	it('decodes base64 binary bodies (gzip EPG) and keeps plain XML', async () => {
		const gz = new Uint8Array(gzipSync(Buffer.from('<tv></tv>')));
		const { request, calls } = fake({ data: Buffer.from(gz).toString('base64') });
		const res = await createNativeFetch(request, { binary: true })('http://h/epg.xml.gz');
		expect(calls[0].responseType).toBe('arraybuffer');
		expect(new Uint8Array(await res.arrayBuffer())).toEqual(gz);
		const { request: r2 } = fake({ data: '<tv></tv>' });
		expect(await (await createNativeFetch(r2, { binary: true })('http://h/epg.xml')).text()).toBe(
			'<tv></tv>'
		);
	});

	it('feeds native gzip EPG into the XMLTV parser', async () => {
		const now = Date.UTC(2024, 0, 1, 12);
		const xml =
			'<tv><programme start="20240101113000 +0000" stop="20240101123000 +0000" channel="a"><title>Nu</title></programme></tv>';
		const { request } = fake({ data: Buffer.from(gzipSync(Buffer.from(xml))).toString('base64') });
		const res = await httpGet('http://h/xmltv.php', {
			fetch: createNativeFetch(request, { binary: true }) as typeof fetch
		});
		const r = await parseXmltv(res.body!, { from: now - 3600_000, to: now + 3600_000 });
		expect(r.programmes.map((p) => p.title)).toEqual(['Nu']);
	});

	it('maps statuses and native errors through the normal error handling', async () => {
		const { request: r401 } = fake({ data: 'denied', status: 401 });
		await expect(
			httpGet('http://h/x', { fetch: createNativeFetch(r401) as typeof fetch, retries: 0 })
		).rejects.toMatchObject({ code: 'auth' });
		const { request: rTimeout } = fake(new Error('The request timed out.'));
		await expect(
			httpGet('http://h/x', { fetch: createNativeFetch(rTimeout) as typeof fetch, retries: 0 })
		).rejects.toMatchObject({ code: 'timeout' });
		const { request: rDown } = fake(
			new Error('UnknownHostException: http://h/live/bob/hunter2/1.ts')
		);
		const err = (await httpGet('http://h/live/bob/hunter2/1.ts', {
			fetch: createNativeFetch(rDown) as typeof fetch,
			retries: 0,
			secrets: ['hunter2']
		}).catch((e) => e)) as HttpError;
		expect(err.code).toBe('unreachable');
		expect(err.message).not.toContain('hunter2');
	});
});
