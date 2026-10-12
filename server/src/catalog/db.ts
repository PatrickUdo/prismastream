// Catalog database (DATA_DIR/catalog.db, node:sqlite, WAL). Regenerable cache: deleting the
// file only costs a rebuild. The build worker writes, the main thread reads (WAL lets both run).
//
// Why SQLite instead of one big JSON per account: lists, filters and cursor pagination are
// index lookups over light rows (`cat_titles.card` is the ready TitleCard JSON), a detail page
// reads one compressed row, and nothing needs the whole catalog in memory. Stream urls are
// stored MASKED (credential placeholders, see sources.ts) and only unmasked for a 302.
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { deflateRawSync, inflateRawSync } from 'node:zlib';

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 15000;
PRAGMA temp_store = MEMORY;
PRAGMA journal_size_limit = 33554432;
CREATE TABLE IF NOT EXISTS cat_state (
	account_id TEXT PRIMARY KEY,
	built_at INTEGER NOT NULL DEFAULT 0,
	version INTEGER NOT NULL DEFAULT 0,
	meta TEXT,
	error TEXT
);
CREATE TABLE IF NOT EXISTS cat_titles (
	account_id TEXT NOT NULL,
	id TEXT NOT NULL,
	kind TEXT NOT NULL,
	sort_title TEXT NOT NULL,
	year INTEGER NOT NULL,
	popularity INTEGER NOT NULL,
	added_at INTEGER NOT NULL,
	kids INTEGER NOT NULL,
	has_overview INTEGER NOT NULL,
	genres TEXT NOT NULL,
	langs TEXT NOT NULL,
	card TEXT NOT NULL,
	search TEXT NOT NULL,
	PRIMARY KEY (account_id, id)
);
CREATE INDEX IF NOT EXISTS cat_titles_pop ON cat_titles(account_id, popularity DESC, id);
CREATE INDEX IF NOT EXISTS cat_titles_new ON cat_titles(account_id, added_at DESC, id);
CREATE INDEX IF NOT EXISTS cat_titles_az ON cat_titles(account_id, sort_title, id);
CREATE INDEX IF NOT EXISTS cat_titles_year ON cat_titles(account_id, year DESC, id);
CREATE TABLE IF NOT EXISTS cat_details (
	account_id TEXT NOT NULL,
	id TEXT NOT NULL,
	data BLOB NOT NULL,
	PRIMARY KEY (account_id, id)
);
CREATE TABLE IF NOT EXISTS cat_variants (
	account_id TEXT NOT NULL,
	id TEXT NOT NULL,
	source_id TEXT NOT NULL,
	url TEXT NOT NULL,
	alt TEXT,
	PRIMARY KEY (account_id, id)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS cat_channels (
	account_id TEXT NOT NULL,
	id TEXT NOT NULL,
	pos INTEGER NOT NULL,
	grp TEXT NOT NULL,
	kids INTEGER NOT NULL,
	langs TEXT NOT NULL,
	epg_id TEXT,
	card TEXT NOT NULL,
	data TEXT NOT NULL,
	PRIMARY KEY (account_id, id)
);
CREATE INDEX IF NOT EXISTS cat_channels_pos ON cat_channels(account_id, pos);
CREATE TABLE IF NOT EXISTS cat_epg (
	account_id TEXT NOT NULL,
	epg_id TEXT NOT NULL,
	start INTEGER NOT NULL,
	stop INTEGER NOT NULL,
	title TEXT NOT NULL,
	desc TEXT,
	category TEXT,
	icon TEXT
);
CREATE INDEX IF NOT EXISTS cat_epg_idx ON cat_epg(account_id, epg_id, start);
CREATE TABLE IF NOT EXISTS cat_series (
	account_id TEXT NOT NULL,
	source_id TEXT NOT NULL,
	provider_id TEXT NOT NULL,
	fetched_at INTEGER NOT NULL,
	data TEXT NOT NULL,
	PRIMARY KEY (account_id, source_id, provider_id)
);
CREATE TABLE IF NOT EXISTS tmdb_cache (key TEXT PRIMARY KEY, at INTEGER NOT NULL, v TEXT);
CREATE TABLE IF NOT EXISTS tmdb_meta (key TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tmdb_keys (key TEXT PRIMARY KEY, tmdb_id INTEGER NOT NULL) WITHOUT ROWID;
`;

/** Bump when the catalog schema changes: the cache tables are dropped and rebuilt. */
const SCHEMA_VERSION = 2;
const CACHE_TABLES = [
	'cat_state',
	'cat_titles',
	'cat_details',
	'cat_variants',
	'cat_channels',
	'cat_epg',
	'cat_series'
];

export function openCatalogDb(path: string): DatabaseSync {
	if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
	const db = new DatabaseSync(path);
	db.exec('PRAGMA busy_timeout = 15000');
	const v = Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version);
	if (v !== SCHEMA_VERSION) {
		db.exec('BEGIN IMMEDIATE');
		const again = Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version);
		if (again !== SCHEMA_VERSION) {
			for (const t of CACHE_TABLES) db.exec(`DROP TABLE IF EXISTS ${t}`);
			db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
		}
		db.exec('COMMIT');
	}
	db.exec(SCHEMA);
	return db;
}

export function packJson(v: unknown): Uint8Array {
	return deflateRawSync(Buffer.from(JSON.stringify(v), 'utf8'));
}

export function unpackJson<T>(b: Uint8Array): T {
	return JSON.parse(inflateRawSync(b).toString('utf8')) as T;
}

export function tx<T>(db: DatabaseSync, fn: () => T): T {
	db.exec('BEGIN IMMEDIATE');
	try {
		const out = fn();
		db.exec('COMMIT');
		return out;
	} catch (err) {
		db.exec('ROLLBACK');
		throw err;
	}
}

/** Moves the WAL into the database and truncates it (after a big write). */
export function checkpoint(db: DatabaseSync) {
	try {
		db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
	} catch {
		// readers active: SQLite checkpoints later on its own
	}
}

/** Removes every catalog row of an account (account deleted). */
export function purgeAccount(db: DatabaseSync, accountId: string) {
	tx(db, () => {
		for (const t of CACHE_TABLES)
			db.prepare(`DELETE FROM ${t} WHERE account_id = ?`).run(accountId);
	});
}

/** Drops the lazily loaded episodes of one source (its config changed). */
export function purgeSourceSeries(db: DatabaseSync, accountId: string, sourceId: string) {
	db.prepare('DELETE FROM cat_series WHERE account_id = ? AND source_id = ?').run(
		accountId,
		sourceId
	);
}
