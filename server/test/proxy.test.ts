import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, afterEach, before, describe, it } from 'node:test';
import { rewritePlaylist } from '../src/proxy.ts';
import { hostAllowed, isPublicAddress } from '../src/ssrf.ts';
import { newAccount, setup } from './helpers.ts';

let ctx: ReturnType<typeof setup> | undefined;
afterEach(async () => {
	await ctx?.dispose();
	ctx = undefined;
});

async function proxyToken(c: ReturnType<typeof setup>) {
	const a = await newAccount(c.call);
	const res = await c.call('/v1/proxy-token', { method: 'POST', token: a.token });
	assert.equal(res.status, 201);
	return (await res.json()) as { proxyToken: string; prefix: string };
}

describe('SSRF address classification', () => {
	it('blocks private, loopback, link-local, metadata and mapped addresses', () => {
		for (const a of [
			'127.0.0.1',
			'10.0.0.1',
			'172.16.5.4',
			'192.168.1.1',
			'169.254.169.254',
			'100.64.0.1',
			'0.0.0.0',
			'224.0.0.1',
			'::1',
			'::',
			'fe80::1',
			'fd12:3456::1',
			'::ffff:127.0.0.1',
			'::ffff:7f00:1',
			'::ffff:a9fe:a9fe',
			'64:ff9b::7f00:1'
		])
			assert.equal(isPublicAddress(a), false, a);
		for (const a of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '93.184.216.34'])
			assert.equal(isPublicAddress(a), true, a);
	});

	it('hostAllowed checks IP literals and lets names through to the DNS check', () => {
		assert.equal(hostAllowed('[::1]'), false);
		assert.equal(hostAllowed('127.0.0.1'), false);
		assert.equal(hostAllowed('example.com'), true);
		assert.equal(hostAllowed('127.0.0.1', true), true);
	});
});

describe('proxy', () => {
	it('requires a valid proxy token (API tokens do not work)', async () => {
		ctx = setup();
		const a = await newAccount(ctx.call);
		const url = encodeURIComponent('http://example.com/');
		assert.equal((await ctx!.call(`/v1/proxy/ppx_${'z'.repeat(32)}?url=${url}`)).status, 401);
		assert.equal((await ctx!.call(`/v1/proxy/${a.token}?url=${url}`)).status, 401);
	});

	it('only allows GET/HEAD and http(s)', async () => {
		ctx = setup();
		const { proxyToken: t } = await proxyToken(ctx!);
		assert.equal((await ctx!.call(`/v1/proxy/${t}?url=x`, { method: 'POST' })).status, 405);
		for (const bad of ['file:///etc/passwd', 'ftp://example.com/a', 'gopher://x', 'not a url'])
			assert.equal(
				(await ctx!.call(`/v1/proxy/${t}?url=${encodeURIComponent(bad)}`)).status,
				400,
				bad
			);
		assert.equal((await ctx!.call(`/v1/proxy/${t}`)).status, 400);
	});

	it('blocks loopback, private and metadata targets (literal and via DNS)', async () => {
		ctx = setup();
		const { proxyToken: t } = await proxyToken(ctx!);
		for (const target of [
			'http://127.0.0.1:8787/v1/health',
			'http://[::1]/',
			'http://169.254.169.254/latest/meta-data/',
			'http://10.0.0.1/',
			'http://192.168.0.1/',
			'http://2130706433/',
			'http://0x7f.0.0.1/',
			'http://[::ffff:127.0.0.1]/',
			'http://localhost/'
		]) {
			const res = await ctx!.call(`/v1/proxy/${t}?url=${encodeURIComponent(target)}`);
			assert.equal(res.status, 403, target);
			assert.equal((await res.json()).error, 'blocked_address');
		}
	});

	describe('against a local upstream (allowPrivate for testing only)', () => {
		let upstream: Server;
		let base: string;
		before(async () => {
			upstream = createServer((req, res) => {
				if (req.url === '/redirect') {
					res.writeHead(302, { location: 'http://127.0.0.1:1/never' });
					return res.end();
				}
				if (req.url === '/redirect-ok') {
					res.writeHead(302, { location: '/file.bin' });
					return res.end();
				}
				if (req.url === '/master.m3u8') {
					res.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl' });
					return res.end(
						'#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXTINF:6,\nseg1.ts\n#EXTINF:6,\nhttps://cdn.example/seg2.ts\n'
					);
				}
				if (req.url === '/channels.m3u') {
					res.writeHead(200, { 'content-type': 'audio/x-mpegurl' });
					return res.end('#EXTM3U\n#EXTINF:-1 tvg-id="a",A\nhttp://iptv.example/live/1.ts\n');
				}
				if (req.url === '/big') {
					res.writeHead(200, { 'content-type': 'application/octet-stream' });
					res.write(Buffer.alloc(4096));
					res.write(Buffer.alloc(4096));
					return res.end();
				}
				if (req.url === '/big-declared') {
					res.writeHead(200, { 'content-length': '999999' });
					return res.end();
				}
				const range = req.headers.range;
				const data = Buffer.from('0123456789');
				if (range) {
					res.writeHead(206, {
						'content-type': 'video/mp2t',
						'content-range': 'bytes 2-4/10',
						'content-length': '3'
					});
					return res.end(data.subarray(2, 5));
				}
				res.writeHead(200, { 'content-type': 'video/mp2t', 'content-length': '10' });
				res.end(data);
			});
			await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r));
			base = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
		});
		after(() => upstream.close());

		it('streams the body and forwards Range', async () => {
			ctx = setup({ proxyAllowPrivate: true });
			const { proxyToken: t } = await proxyToken(ctx!);
			const res = await ctx!.call(`/v1/proxy/${t}?url=${encodeURIComponent(base + '/file.bin')}`, {
				headers: { origin: 'http://localhost:5173' }
			});
			assert.equal(res.status, 200);
			assert.equal(await res.text(), '0123456789');
			assert.equal(res.headers.get('access-control-allow-origin'), 'http://localhost:5173');
			const part = await ctx!.call(`/v1/proxy/${t}?url=${encodeURIComponent(base + '/file.bin')}`, {
				headers: { range: 'bytes=2-4' }
			});
			assert.equal(part.status, 206);
			assert.equal(part.headers.get('content-range'), 'bytes 2-4/10');
			assert.equal(await part.text(), '234');
		});

		it('follows redirects but re-validates the target', async () => {
			ctx = setup({ proxyAllowPrivate: true });
			const { proxyToken: t } = await proxyToken(ctx!);
			const ok = await ctx!.call(`/v1/proxy/${t}?url=${encodeURIComponent(base + '/redirect-ok')}`);
			assert.equal(await ok.text(), '0123456789');
		});

		it('blocks a private upstream when private access is off', async () => {
			ctx = setup({ proxyAllowPrivate: false });
			const { proxyToken: t } = await proxyToken(ctx!);
			const res = await ctx!.call(`/v1/proxy/${t}?url=${encodeURIComponent(base + '/redirect')}`);
			assert.equal(res.status, 403);
		});

		it('rewrites HLS playlists so segments go through the proxy', async () => {
			ctx = setup({ proxyAllowPrivate: true });
			const { proxyToken: t, prefix } = await proxyToken(ctx!);
			assert.equal(prefix, `http://sync.test/v1/proxy/${t}?url=`);
			const res = await ctx!.call(`/v1/proxy/${t}?url=${encodeURIComponent(base + '/master.m3u8')}`);
			const text = await res.text();
			assert.ok(text.includes(prefix + encodeURIComponent(base + '/seg1.ts')));
			assert.ok(text.includes(prefix + encodeURIComponent('https://cdn.example/seg2.ts')));
			assert.ok(text.includes(`URI="${prefix}${encodeURIComponent(base + '/key.bin')}"`));
			// raw=1 disables rewriting
			const raw = await ctx!.call(
				`/v1/proxy/${t}?raw=1&url=${encodeURIComponent(base + '/master.m3u8')}`
			);
			assert.ok((await raw.text()).includes('\nseg1.ts\n'));
		});

		it('does not rewrite IPTV channel lists (no #EXT-X- tags)', async () => {
			ctx = setup({ proxyAllowPrivate: true });
			const { proxyToken: t } = await proxyToken(ctx!);
			const res = await ctx!.call(`/v1/proxy/${t}?url=${encodeURIComponent(base + '/channels.m3u')}`);
			assert.ok((await res.text()).includes('\nhttp://iptv.example/live/1.ts\n'));
		});

		it('enforces the maximum response size', async () => {
			ctx = setup({ proxyAllowPrivate: true, proxyMaxBytes: 5000 });
			const { proxyToken: t } = await proxyToken(ctx!);
			const declared = await ctx!.call(
				`/v1/proxy/${t}?url=${encodeURIComponent(base + '/big-declared')}`
			);
			assert.equal(declared.status, 502);
			const streamed = await ctx!.call(`/v1/proxy/${t}?url=${encodeURIComponent(base + '/big')}`);
			await assert.rejects(streamed.arrayBuffer());
		});
	});
});

describe('playlist rewriting', () => {
	it('leaves already proxied urls alone', () => {
		const prefix = 'https://s/v1/proxy/ppx_a?url=';
		const out = rewritePlaylist(
			`#EXTM3U\n#EXT-X-VERSION:3\n${prefix}abc\n`,
			new URL('https://o/x/m.m3u8'),
			prefix
		);
		assert.ok(out.includes(`\n${prefix}abc\n`));
	});
});
