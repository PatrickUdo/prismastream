import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { describe, it } from 'node:test';
import { JsonListError, JsonListSplitter } from '../src/catalog/jsonlist.ts';
import {
	NdjsonWriter,
	readEpg,
	readItems,
	readLines,
	type ReadStats
} from '../src/catalog/rawcache.ts';

/** Realistic Xtream items with everything that can trip a hand-written JSON splitter. */
const TRICKY = [
	{
		num: 1,
		name: 'NL - "Quoted" \\ backslash {not an object} [not an array]',
		stream_icon: 'http:\/\/img.example\/a.jpg',
		category_ids: [1, 2, [3]],
		backdrop_path: ['http://x/1.jpg', ''],
		rating: null,
		plot: ''
	},
	{ num: 2, name: 'AR - مسلسل عربي 🎬🍿 family 👨‍👩‍👧', is_adult: '0', custom_sid: null },
	{ num: 3, name: 'Line separator paragraph\rcarriage\nnewline\ttab', tmdb: '' },
	{ num: 4, name: '\\"}]', direct_source: '}{][', trailer: '\\\\' },
	{ num: 5, name: 'éèê 中文 \u0000\u001f', nested: { a: { b: [{ c: '}' }] } } },
	{ num: 6, name: 'x'.repeat(300), empty: {}, list: [] }
];
const TEXT = '﻿  ' + JSON.stringify(TRICKY, null, 1).replace(/\//g, '\\/');
const BYTES = Buffer.from(TEXT, 'utf8');
const EXPECTED = JSON.parse(TEXT.slice(1));

function run(chunks: (Buffer | string)[]): unknown[] {
	const out: unknown[] = [];
	const s = new JsonListSplitter((it) => out.push(it));
	for (const c of chunks) s.push(c);
	s.end();
	return out;
}

describe('JSON list splitter (Xtream streams)', () => {
	it('every byte split position gives exactly JSON.parse of the whole', () => {
		for (let i = 0; i <= BYTES.length; i++)
			assert.deepEqual(run([BYTES.subarray(0, i), BYTES.subarray(i)]), EXPECTED, `split at ${i}`);
	});

	it('every pair of split positions over the text (string chunks)', () => {
		const step = Math.max(1, Math.floor(TEXT.length / 120));
		for (let i = 0; i <= TEXT.length; i += step)
			for (let j = i; j <= TEXT.length; j += step)
				assert.deepEqual(run([TEXT.slice(0, i), TEXT.slice(i, j), TEXT.slice(j)]), EXPECTED);
	});

	it('random byte chunks of 1–64 bytes (2.000 runs)', () => {
		let seed = 42;
		const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32);
		for (let r = 0; r < 2000; r++) {
			const chunks: Buffer[] = [];
			for (let i = 0; i < BYTES.length; ) {
				const n = 1 + Math.floor(rnd() * 64);
				chunks.push(BYTES.subarray(i, i + n));
				i += n;
			}
			assert.deepEqual(run(chunks), EXPECTED);
		}
	});

	it('object root (values are the items) and an empty list', () => {
		const obj = Object.fromEntries(TRICKY.map((t, i) => [String(i), t]));
		const text = JSON.stringify(obj);
		const b = Buffer.from(text);
		for (let i = 0; i <= b.length; i += 7)
			assert.deepEqual(run([b.subarray(0, i), b.subarray(i)]), Object.values(obj));
		assert.deepEqual(run(['[ ]']), []);
	});

	it('skips one broken element and keeps the rest; position only', () => {
		const inner = TEXT.slice(TEXT.indexOf('[') + 1, TEXT.lastIndexOf(']'));
		const text = `[{"num":0,"name":"broken", bad},${inner}]`;
		const out: unknown[] = [];
		const s = new JsonListSplitter((it) => out.push(it));
		s.push(text);
		const r = s.end();
		assert.equal(r.skipped, 1);
		assert.equal(r.count, EXPECTED.length);
		assert.deepEqual(out, EXPECTED);
		assert.equal(s.skippedAt[0], 1);
	});

	it('a broken structure is an error (not JSON, cut off, unbalanced)', () => {
		assert.throws(() => run(['<html>error</html>']), JsonListError);
		assert.throws(() => run([TEXT.slice(0, TEXT.length - 20)]), JsonListError);
		assert.throws(() => run(['']), JsonListError);
		// Trailing bytes after a complete list are ignored (some panels append whitespace/junk).
		assert.deepEqual(run(['[{"a":1}]]']), [{ a: 1 }]);
	});
});

describe('NDJSON cache: only "\\n" ends a line', () => {
	const dir = mkdtempSync(join(tmpdir(), 'ps-ndjson-'));
	const tricky = {
		name: 'Titel met line sep,  para sep, losse\rCR en "quotes"',
		plot: 'a\nb\r\nc'
	};

	it('catalog cache round-trips U+2028, U+2029 and a lone \\r', async () => {
		const w = NdjsonWriter.create(join(dir, 'items.ndjson.gz'));
		for (let i = 0; i < 3; i++) w.write(['m', { ...tricky, providerId: String(i) }]);
		w.write(['c', { ...tricky, providerId: 'c1' }]);
		await w.commit();
		const movies: unknown[] = [];
		for await (const m of readItems(dir, ['m'])) movies.push(m);
		assert.equal(movies.length, 3);
		assert.deepEqual(movies[1], { ...tricky, providerId: '1' });
		const channels: unknown[] = [];
		for await (const c of readItems(dir, ['c'])) channels.push(c);
		assert.deepEqual(channels, [{ ...tricky, providerId: 'c1' }]);
	});

	it('EPG cache round-trips them too', async () => {
		const w = NdjsonWriter.create(join(dir, 'epg.ndjson.gz'));
		w.write({ v: 2, savedAt: 1 });
		w.write({ channelId: 'x', start: 1, stop: 10, title: tricky.name, desc: tricky.plot });
		await w.commit();
		const out: unknown[] = [];
		for await (const p of readEpg(dir, 0)) out.push(p);
		assert.deepEqual(out, [{ channelId: 'x', start: 1, stop: 10, title: tricky.name, desc: tricky.plot }]);
	});

	it('reads existing caches with a RAW U+2028 inside a string (written by older versions)', async () => {
		const raw =
			JSON.stringify({ v: 2 }) +
			'\n' +
			JSON.stringify(['m', tricky]) + // JSON.stringify keeps U+2028/U+2029 raw
			'\n' +
			'{"broken": \n' +
			JSON.stringify(['m', { name: 'ok' }]) +
			'\n';
		assert.ok(raw.includes(' '));
		const path = join(dir, 'raw.ndjson.gz');
		writeFileSync(path, gzipSync(Buffer.from(raw)));
		const stats: ReadStats = { skipped: 0, lines: [] };
		const out: unknown[] = [];
		for await (const v of readLines(path, stats)) out.push(v);
		assert.deepEqual(out, [{ v: 2 }, ['m', tricky], ['m', { name: 'ok' }]]);
		assert.equal(stats.skipped, 1, 'the broken line is skipped and counted');
		assert.deepEqual(stats.lines, [3]);
		rmSync(dir, { recursive: true, force: true });
	});
});
