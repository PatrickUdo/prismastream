// Raw data per source, in DATA_DIR/cache/<accountId>/<sourceId>/:
//   items.ndjson.gz   one `["m"|"s"|"c", item]` per line (movies, series, channels)
//   meta.json         { v, savedAt, epgUrls, account, warnings, counts } (written last = commit)
//   epg.ndjson.gz     header line, then one EpgProgramme per line
// Everything streams: a download is written item by item while it arrives, and a build reads
// only the kind it is merging. Nothing holds a whole provider list as one string. Stream urls
// are MASKED (credential placeholders), so these files contain no IPTV passwords.
import { createReadStream, createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { createGunzip, createGzip, type Gzip } from 'node:zlib';
import type { WriteStream } from 'node:fs';

const SAFE = /^[A-Za-z0-9_-]{1,80}$/;
export const CACHE_VERSION = 2;

export function sourceDir(dataDir: string, accountId: string, sourceId: string): string {
	if (!SAFE.test(accountId) || !SAFE.test(sourceId)) throw new Error('unsafe cache path');
	return join(dataDir, 'cache', accountId, sourceId);
}

export function accountCacheDir(dataDir: string, accountId: string): string {
	if (!SAFE.test(accountId)) throw new Error('unsafe cache path');
	return join(dataDir, 'cache', accountId);
}

export type ItemKind = 'm' | 's' | 'c';

export interface CatalogMetaFile {
	v: number;
	savedAt: number;
	/** EPG urls announced by an M3U header (masked). */
	epgUrls: string[];
	account?: Record<string, unknown>;
	warnings: string[];
	counts: { movies: number; series: number; channels: number };
}

/** Streaming gzip NDJSON writer to a temp file; `commit()` renames it into place. */
export class NdjsonWriter {
	#path: string;
	#tmp: string;
	#gz: Gzip;
	#out: WriteStream;
	#batch = '';
	#failed: Error | undefined;

	private constructor(path: string) {
		this.#path = path;
		this.#tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
		this.#gz = createGzip({ level: 5 });
		this.#out = createWriteStream(this.#tmp);
		this.#gz.on('error', (e) => (this.#failed = e));
		this.#out.on('error', (e) => (this.#failed = e));
		this.#gz.pipe(this.#out);
	}

	static create(path: string): NdjsonWriter {
		mkdirSync(join(path, '..'), { recursive: true });
		return new NdjsonWriter(path);
	}

	/** Synchronous append (buffered; gzip keeps up with any network download). */
	write(value: unknown) {
		this.#batch += ndjsonLine(value);
		if (this.#batch.length > 1 << 16) {
			this.#gz.write(this.#batch);
			this.#batch = '';
		}
	}

	/** Append and wait when the gzip buffer is full (for fast local producers). */
	async writeAsync(value: unknown) {
		this.#batch += ndjsonLine(value);
		if (this.#batch.length > 1 << 16) {
			const ok = this.#gz.write(this.#batch);
			this.#batch = '';
			if (!ok) await once(this.#gz, 'drain');
		}
	}

	async commit() {
		if (this.#batch) this.#gz.write(this.#batch);
		this.#batch = '';
		this.#gz.end();
		await once(this.#out, 'close');
		if (this.#failed) {
			await rm(this.#tmp, { force: true });
			throw this.#failed;
		}
		await rename(this.#tmp, this.#path);
	}

	async abort() {
		this.#gz.destroy();
		this.#out.destroy();
		await rm(this.#tmp, { force: true });
	}
}

/**
 * One NDJSON line. JSON.stringify leaves U+2028/U+2029 unescaped (valid JSON), but some line
 * readers treat them as line breaks, so they are escaped too.
 */
export function ndjsonLine(value: unknown): string {
	let s = JSON.stringify(value);
	if (s.includes('\u2028') || s.includes('\u2029'))
		s = s.replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
	return s + '\n';
}

/** Counts lines that could not be parsed (skipped instead of failing the build). */
export interface ReadStats {
	skipped: number;
	/** Line numbers of skipped lines (at most 20); never their content. */
	lines: number[];
}

/**
 * Reads a gzip NDJSON file line by line. Splits ONLY on "\n" (0x0A): not on \r, U+2028 or
 * U+2029 (node:readline does, which cut a valid line in two). UTF-8 is decoded streaming, so a
 * multi-byte character split over chunks is fine. A line that does not parse is skipped and
 * counted in `stats`; a broken gzip stream throws.
 */
export async function* readLines(path: string, stats?: ReadStats): AsyncGenerator<unknown> {
	const input = createReadStream(path).pipe(createGunzip());
	const decoder = new StringDecoder('utf8');
	let rest = '';
	let lineNo = 0;
	const parse = (line: string): { ok: true; v: unknown } | { ok: false } => {
		lineNo++;
		if (!line.trim()) return { ok: false };
		try {
			return { ok: true, v: JSON.parse(line) };
		} catch {
			if (stats) {
				stats.skipped++;
				if (stats.lines.length < 20) stats.lines.push(lineNo);
			}
			return { ok: false };
		}
	};
	for await (const chunk of input) {
		const text = rest + decoder.write(chunk as Buffer);
		let start = 0;
		for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', start)) {
			const r = parse(text.slice(start, i));
			start = i + 1;
			if (r.ok) yield r.v;
		}
		rest = text.slice(start);
	}
	rest += decoder.end();
	if (rest) {
		const r = parse(rest);
		if (r.ok) yield r.v;
	}
}

export function itemsPath(dir: string) {
	return join(dir, 'items.ndjson.gz');
}

export async function readMeta(dir: string): Promise<CatalogMetaFile | undefined> {
	try {
		const m = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8')) as CatalogMetaFile;
		if (m.v !== CACHE_VERSION || !existsSync(itemsPath(dir))) return undefined;
		return m;
	} catch {
		return undefined;
	}
}

export async function writeMeta(dir: string, meta: CatalogMetaFile) {
	const tmp = join(dir, `meta.json.${process.pid}.tmp`);
	await writeFile(tmp, JSON.stringify(meta));
	await rename(tmp, join(dir, 'meta.json'));
}

/** Streams the cached items of the given kinds. */
export async function* readItems<T = unknown>(
	dir: string,
	kinds: ItemKind[],
	stats?: ReadStats
): AsyncGenerator<T> {
	const want = new Set(kinds);
	for await (const v of readLines(itemsPath(dir), stats)) {
		if (!Array.isArray(v) || v.length !== 2) {
			if (stats) stats.skipped++;
			continue;
		}
		const [k, item] = v as [ItemKind, T];
		if (want.has(k)) yield item;
	}
}

export async function epgAge(dir: string): Promise<number | undefined> {
	try {
		return Date.now() - (await stat(join(dir, 'epg.ndjson.gz'))).mtimeMs;
	} catch {
		return undefined;
	}
}

export function epgPath(dir: string) {
	return join(dir, 'epg.ndjson.gz');
}

/** Streams cached programmes that end after `after`. */
export async function* readEpg<T extends { stop: number }>(
	dir: string,
	after: number,
	stats?: ReadStats
): AsyncGenerator<T> {
	if (!existsSync(epgPath(dir))) return;
	// The header line has no `stop`, so it is skipped by the window check.
	for await (const v of readLines(epgPath(dir), stats))
		if (v && typeof v === 'object' && (v as T).stop > after) yield v as T;
}

export async function removeDir(dir: string) {
	await rm(dir, { recursive: true, force: true });
}
