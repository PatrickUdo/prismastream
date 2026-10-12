// Raw data per source: DATA_DIR/cache/<accountId>/<sourceId>/{catalog,epg}.ndjson.gz.
// Gzip-compressed JSON, one JSON value per line (header first), so writing and reading stream
// item by item instead of building one huge string. Stream urls inside are MASKED (credential
// placeholders), so the cache files contain no IPTV passwords.
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { createGunzip, createGzip } from 'node:zlib';
import type { EpgProgramme, RawChannel, RawMovie, RawSeries } from './core.ts';

const SAFE = /^[A-Za-z0-9_-]{1,80}$/;

export function sourceDir(dataDir: string, accountId: string, sourceId: string): string {
	if (!SAFE.test(accountId) || !SAFE.test(sourceId)) throw new Error('unsafe cache path');
	return join(dataDir, 'cache', accountId, sourceId);
}

export function accountCacheDir(dataDir: string, accountId: string): string {
	if (!SAFE.test(accountId)) throw new Error('unsafe cache path');
	return join(dataDir, 'cache', accountId);
}

export interface CatalogHeader {
	v: 1;
	savedAt: number;
	/** EPG urls announced by an M3U header (masked). */
	epgUrls: string[];
	account?: Record<string, unknown>;
	warnings: string[];
}

export interface CachedCatalog extends CatalogHeader {
	movies: RawMovie[];
	series: RawSeries[];
	channels: RawChannel[];
}

async function writeLines(path: string, lines: Iterable<unknown>) {
	await mkdir(join(path, '..'), { recursive: true });
	const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
	const gz = createGzip({ level: 6 });
	const out = createWriteStream(tmp);
	gz.pipe(out);
	let batch = '';
	for (const v of lines) {
		batch += JSON.stringify(v) + '\n';
		if (batch.length > 1 << 16) {
			if (!gz.write(batch)) await once(gz, 'drain');
			batch = '';
		}
	}
	if (batch) gz.write(batch);
	gz.end();
	await once(out, 'close');
	await rename(tmp, path);
}

async function* readLines(path: string): AsyncGenerator<unknown> {
	const rl = createInterface({ input: createReadStream(path).pipe(createGunzip()), crlfDelay: Infinity });
	for await (const line of rl) if (line) yield JSON.parse(line);
}

export async function writeCatalogCache(dir: string, cat: CachedCatalog) {
	const { movies, series, channels, ...header } = cat;
	await writeLines(
		join(dir, 'catalog.ndjson.gz'),
		(function* () {
			yield header;
			for (const m of movies) yield ['m', m];
			for (const s of series) yield ['s', s];
			for (const c of channels) yield ['c', c];
		})()
	);
}

export async function readCatalogCache(dir: string): Promise<CachedCatalog | undefined> {
	const path = join(dir, 'catalog.ndjson.gz');
	if (!existsSync(path)) return undefined;
	try {
		let header: CatalogHeader | undefined;
		const movies: RawMovie[] = [];
		const series: RawSeries[] = [];
		const channels: RawChannel[] = [];
		for await (const v of readLines(path)) {
			if (!header) {
				header = v as CatalogHeader;
				continue;
			}
			const [k, item] = v as [string, unknown];
			if (k === 'm') movies.push(item as RawMovie);
			else if (k === 's') series.push(item as RawSeries);
			else if (k === 'c') channels.push(item as RawChannel);
		}
		if (!header || header.v !== 1) return undefined;
		return { ...header, movies, series, channels };
	} catch {
		return undefined; // corrupt cache: refetch
	}
}

export async function cacheAge(dir: string, file: 'catalog' | 'epg'): Promise<number | undefined> {
	try {
		const s = await stat(join(dir, `${file}.ndjson.gz`));
		return Date.now() - s.mtimeMs;
	} catch {
		return undefined;
	}
}

export async function writeEpgCache(dir: string, programmes: EpgProgramme[]) {
	await writeLines(
		join(dir, 'epg.ndjson.gz'),
		(function* () {
			yield { v: 1, savedAt: Date.now() };
			for (const p of programmes) yield p;
		})()
	);
}

export async function readEpgCache(dir: string, after: number): Promise<EpgProgramme[] | undefined> {
	const path = join(dir, 'epg.ndjson.gz');
	if (!existsSync(path)) return undefined;
	try {
		const out: EpgProgramme[] = [];
		let first = true;
		for await (const v of readLines(path)) {
			if (first) {
				first = false;
				continue;
			}
			const p = v as EpgProgramme;
			if (p.stop > after) out.push(p);
		}
		return out;
	} catch {
		return undefined;
	}
}

export async function removeDir(dir: string) {
	await rm(dir, { recursive: true, force: true });
}
