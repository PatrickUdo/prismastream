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
import { createInterface } from 'node:readline';
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
		this.#batch += JSON.stringify(value) + '\n';
		if (this.#batch.length > 1 << 16) {
			this.#gz.write(this.#batch);
			this.#batch = '';
		}
	}

	/** Append and wait when the gzip buffer is full (for fast local producers). */
	async writeAsync(value: unknown) {
		this.#batch += JSON.stringify(value) + '\n';
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

async function* readLines(path: string): AsyncGenerator<unknown> {
	const rl = createInterface({
		input: createReadStream(path).pipe(createGunzip()),
		crlfDelay: Infinity
	});
	for await (const line of rl) if (line) yield JSON.parse(line);
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
	kinds: ItemKind[]
): AsyncGenerator<T> {
	const want = new Set(kinds);
	for await (const v of readLines(itemsPath(dir))) {
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
	after: number
): AsyncGenerator<T> {
	if (!existsSync(epgPath(dir))) return;
	let first = true;
	for await (const v of readLines(epgPath(dir))) {
		if (first) {
			first = false;
			continue;
		}
		if ((v as T).stop > after) yield v as T;
	}
}

export async function removeDir(dir: string) {
	await rm(dir, { recursive: true, force: true });
}
