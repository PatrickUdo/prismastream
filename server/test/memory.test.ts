// Memory and speed with a big provider: 50.000 items (40.000 VOD entries, 5.000 series,
// 5.000 live channels) from a local mock Xtream server, built in the worker thread.
// Measures the peak RSS of the whole process (main thread + build worker) and the build time.
// Budget: container 768 MB, Node --max-old-space-size=512; target peak RSS < 450 MB.
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { after, before, describe, it } from 'node:test';
import { newAccount, setup } from './helpers.ts';
import { PASS, USER } from './mock-iptv.ts';

let mock: { url: string; proc: ChildProcess };
let ctx: ReturnType<typeof setup>;

before(async () => {
	// The mock provider runs in its own process, so only the server is measured.
	const proc = spawn(
		process.execPath,
		[new URL('./mock-iptv-server.ts', import.meta.url).pathname, JSON.stringify({ movies: 40_000, series: 5_000, channels: 5_000 })],
		{ stdio: ['ignore', 'pipe', 'inherit'] }
	);
	const [chunk] = (await once(proc.stdout!, 'data')) as [Buffer];
	mock = { url: chunk.toString().trim(), proc };
});
after(async () => {
	await ctx?.dispose();
	mock?.proc.kill('SIGTERM');
});

const MB = 1024 * 1024;

describe('memory with 50.000 items', () => {
	it('builds within the memory budget and serves queries fast', { timeout: 180_000 }, async (t) => {
		ctx = setup({ proxyAllowPrivate: true, demoSource: false });
		const a = await newAccount(ctx.call);
		global.gc?.();
		const baseline = process.memoryUsage().rss;
		let peak = baseline;
		const timer = setInterval(() => {
			peak = Math.max(peak, process.memoryUsage().rss);
		}, 25);
		const t0 = performance.now();
		const res = await ctx.call('/v1/sources', {
			method: 'POST',
			token: a.token,
			json: { type: 'xtream', name: 'Groot', serverUrl: mock.url, username: USER, password: PASS }
		});
		assert.equal(res.status, 201);
		await ctx.catalog!.queue.idle();
		const buildMs = performance.now() - t0;
		peak = Math.max(peak, process.memoryUsage().rss);

		const meta = (await (await ctx.call('/v1/catalog/meta', { token: a.token })).json()) as Record<string, any>;
		assert.equal(meta.status, 'ready', JSON.stringify(meta).slice(0, 300));
		assert.equal(meta.counts.movies, 20_000);
		assert.ok(meta.counts.series > 4_500);
		assert.ok(meta.counts.channels > 4_000);

		const q = async (path: string) => {
			const s = performance.now();
			const r = await ctx.call(path, { token: a.token });
			assert.equal(r.status, 200, path);
			const body = (await r.json()) as Record<string, any>;
			return { ms: performance.now() - s, body };
		};
		const first = await q('/v1/catalog/titles?sort=popular&limit=60');
		const page2 = await q(`/v1/catalog/titles?sort=popular&limit=60&cursor=${first.body.nextCursor}`);
		const filtered = await q('/v1/catalog/titles?kind=movie&genre=action&lang=de&sort=az&limit=60');
		const home = await q('/v1/catalog/home');
		const detail = await q(`/v1/catalog/titles/${encodeURIComponent(first.body.items[0].id)}`);
		const search1 = await q('/v1/catalog/search?q=mock%20film%201234');
		const search2 = await q('/v1/catalog/search?q=serie%2042');
		peak = Math.max(peak, process.memoryUsage().rss);
		clearInterval(timer);
		assert.ok(search1.body.movies.some((m: { title: string }) => m.title === 'Mock Film 1234'));

		const report = {
			items: 50_000,
			buildSeconds: Math.round(buildMs / 100) / 10,
			baselineRssMb: Math.round(baseline / MB),
			peakRssMb: Math.round(peak / MB),
			afterRssMb: Math.round(process.memoryUsage().rss / MB),
			heapUsedMb: Math.round(process.memoryUsage().heapUsed / MB),
			titlesMs: Math.round(first.ms),
			page2Ms: Math.round(page2.ms),
			filteredMs: Math.round(filtered.ms),
			homeMs: Math.round(home.ms),
			detailMs: Math.round(detail.ms),
			searchFirstMs: Math.round(search1.ms),
			searchNextMs: Math.round(search2.ms)
		};
		t.diagnostic(JSON.stringify(report));
		console.log('[memory-50k]', JSON.stringify(report));
		assert.ok(report.peakRssMb < 450, `peak RSS ${report.peakRssMb} MB`);
		assert.ok(report.titlesMs < 500 && report.page2Ms < 500 && report.detailMs < 500);
	});
});
