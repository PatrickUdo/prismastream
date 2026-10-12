// Persistence on the built-in node:sqlite. The server only stores opaque encrypted blobs
// plus metadata (doc id, version, sequence, timestamps). Tokens are stored as SHA-256 hashes.
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export interface Kdf {
	alg: 'PBKDF2-SHA256';
	iterations: number;
}

export interface AccountRow {
	id: string;
	salt: string;
	kdf: Kdf;
	createdAt: number;
	seq: number;
}

export interface DeviceRow {
	id: string;
	accountId: string;
	name: string;
	createdAt: number;
	lastSeenAt: number;
}

export interface DocRow {
	docId: string;
	version: number;
	seq: number;
	updatedAt: number;
	deleted: boolean;
	blob: string | null;
}

export type PutResult =
	| { ok: true; doc: DocRow }
	| { ok: false; reason: 'conflict'; current: DocRow | null }
	| { ok: false; reason: 'quota' };

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
CREATE TABLE IF NOT EXISTS accounts (
	id TEXT PRIMARY KEY,
	salt TEXT NOT NULL,
	kdf TEXT NOT NULL,
	created_at INTEGER NOT NULL,
	seq INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS devices (
	id TEXT PRIMARY KEY,
	account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
	token_hash TEXT NOT NULL UNIQUE,
	proxy_token_hash TEXT UNIQUE,
	name TEXT NOT NULL,
	created_at INTEGER NOT NULL,
	last_seen_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS devices_account ON devices(account_id);
CREATE TABLE IF NOT EXISTS docs (
	account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
	doc_id TEXT NOT NULL,
	version INTEGER NOT NULL,
	seq INTEGER NOT NULL,
	updated_at INTEGER NOT NULL,
	deleted INTEGER NOT NULL DEFAULT 0,
	blob TEXT,
	PRIMARY KEY (account_id, doc_id)
);
CREATE INDEX IF NOT EXISTS docs_seq ON docs(account_id, seq);
CREATE TABLE IF NOT EXISTS pairing_codes (
	code_hash TEXT PRIMARY KEY,
	account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
	created_by TEXT NOT NULL,
	expires_at INTEGER NOT NULL
);
`;

type Row = Record<string, unknown>;

function toDoc(r: Row): DocRow {
	return {
		docId: String(r.doc_id),
		version: Number(r.version),
		seq: Number(r.seq),
		updatedAt: Number(r.updated_at),
		deleted: Number(r.deleted) === 1,
		blob: r.blob == null ? null : String(r.blob)
	};
}

function toDevice(r: Row): DeviceRow {
	return {
		id: String(r.id),
		accountId: String(r.account_id),
		name: String(r.name),
		createdAt: Number(r.created_at),
		lastSeenAt: Number(r.last_seen_at)
	};
}

export class Store {
	db: DatabaseSync;

	constructor(path: string) {
		if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
		this.db = new DatabaseSync(path);
		this.db.exec(SCHEMA);
	}

	close() {
		this.db.close();
	}

	#tx<T>(fn: () => T): T {
		this.db.exec('BEGIN IMMEDIATE');
		try {
			const out = fn();
			this.db.exec('COMMIT');
			return out;
		} catch (err) {
			this.db.exec('ROLLBACK');
			throw err;
		}
	}

	// ---- accounts & devices -------------------------------------------------

	createAccount(a: { id: string; salt: string; kdf: Kdf }, d: NewDevice) {
		const now = Date.now();
		this.#tx(() => {
			this.db
				.prepare('INSERT INTO accounts (id, salt, kdf, created_at) VALUES (?, ?, ?, ?)')
				.run(a.id, a.salt, JSON.stringify(a.kdf), now);
			this.#insertDevice(a.id, d, now);
		});
	}

	getAccount(id: string): AccountRow | undefined {
		const r = this.db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) as Row | undefined;
		if (!r) return undefined;
		return {
			id: String(r.id),
			salt: String(r.salt),
			kdf: JSON.parse(String(r.kdf)) as Kdf,
			createdAt: Number(r.created_at),
			seq: Number(r.seq)
		};
	}

	deleteAccount(id: string) {
		this.db.prepare('DELETE FROM accounts WHERE id = ?').run(id);
	}

	#insertDevice(accountId: string, d: NewDevice, now: number) {
		this.db
			.prepare(
				'INSERT INTO devices (id, account_id, token_hash, name, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)'
			)
			.run(d.id, accountId, d.tokenHash, d.name, now, now);
	}

	addDevice(accountId: string, d: NewDevice) {
		this.#insertDevice(accountId, d, Date.now());
	}

	deviceByTokenHash(hash: string): DeviceRow | undefined {
		const r = this.db.prepare('SELECT * FROM devices WHERE token_hash = ?').get(hash) as
			| Row
			| undefined;
		return r ? toDevice(r) : undefined;
	}

	deviceByProxyTokenHash(hash: string): DeviceRow | undefined {
		const r = this.db.prepare('SELECT * FROM devices WHERE proxy_token_hash = ?').get(hash) as
			| Row
			| undefined;
		return r ? toDevice(r) : undefined;
	}

	setProxyTokenHash(deviceId: string, hash: string) {
		this.db.prepare('UPDATE devices SET proxy_token_hash = ? WHERE id = ?').run(hash, deviceId);
	}

	touchDevice(deviceId: string, now = Date.now()) {
		this.db.prepare('UPDATE devices SET last_seen_at = ? WHERE id = ?').run(now, deviceId);
	}

	listDevices(accountId: string): DeviceRow[] {
		return (
			this.db
				.prepare('SELECT * FROM devices WHERE account_id = ? ORDER BY created_at')
				.all(accountId) as Row[]
		).map(toDevice);
	}

	countDevices(accountId: string): number {
		const r = this.db
			.prepare('SELECT COUNT(*) AS n FROM devices WHERE account_id = ?')
			.get(accountId) as Row;
		return Number(r.n);
	}

	/** Removes a device. Returns 'account-deleted' when it was the last device of the account. */
	removeDevice(accountId: string, deviceId: string): 'removed' | 'not-found' | 'account-deleted' {
		return this.#tx(() => {
			const res = this.db
				.prepare('DELETE FROM devices WHERE id = ? AND account_id = ?')
				.run(deviceId, accountId);
			if (Number(res.changes) === 0) return 'not-found';
			this.db.prepare('DELETE FROM pairing_codes WHERE created_by = ?').run(deviceId);
			if (this.countDevices(accountId) === 0) {
				this.deleteAccount(accountId);
				return 'account-deleted';
			}
			return 'removed';
		});
	}

	// ---- pairing --------------------------------------------------------------

	createPairingCode(codeHash: string, accountId: string, deviceId: string, expiresAt: number) {
		this.db
			.prepare(
				'INSERT INTO pairing_codes (code_hash, account_id, created_by, expires_at) VALUES (?, ?, ?, ?)'
			)
			.run(codeHash, accountId, deviceId, expiresAt);
	}

	countActivePairingCodes(accountId: string, now = Date.now()): number {
		const r = this.db
			.prepare('SELECT COUNT(*) AS n FROM pairing_codes WHERE account_id = ? AND expires_at > ?')
			.get(accountId, now) as Row;
		return Number(r.n);
	}

	/** Atomically consumes a pairing code and adds the new device. */
	redeemPairingCode(
		codeHash: string,
		d: NewDevice,
		maxDevices: number,
		now = Date.now()
	):
		| { ok: true; account: AccountRow }
		| { ok: false; reason: 'invalid' | 'expired' | 'device-limit' } {
		return this.#tx(() => {
			const r = this.db.prepare('SELECT * FROM pairing_codes WHERE code_hash = ?').get(codeHash) as
				| Row
				| undefined;
			if (!r) return { ok: false as const, reason: 'invalid' as const };
			this.db.prepare('DELETE FROM pairing_codes WHERE code_hash = ?').run(codeHash);
			if (Number(r.expires_at) <= now) return { ok: false as const, reason: 'expired' as const };
			const accountId = String(r.account_id);
			if (this.countDevices(accountId) >= maxDevices)
				return { ok: false as const, reason: 'device-limit' as const };
			this.#insertDevice(accountId, d, now);
			return { ok: true as const, account: this.getAccount(accountId)! };
		});
	}

	purgeExpiredPairingCodes(now = Date.now()) {
		this.db.prepare('DELETE FROM pairing_codes WHERE expires_at <= ?').run(now);
	}

	// ---- docs -----------------------------------------------------------------

	getDoc(accountId: string, docId: string): DocRow | undefined {
		const r = this.db
			.prepare('SELECT * FROM docs WHERE account_id = ? AND doc_id = ?')
			.get(accountId, docId) as Row | undefined;
		return r ? toDoc(r) : undefined;
	}

	listDocsSince(
		accountId: string,
		since: number,
		limit: number
	): { docs: DocRow[]; cursor: number; more: boolean } {
		const rows = this.db
			.prepare('SELECT * FROM docs WHERE account_id = ? AND seq > ? ORDER BY seq LIMIT ?')
			.all(accountId, since, limit + 1) as Row[];
		const more = rows.length > limit;
		const docs = rows.slice(0, limit).map(toDoc);
		const cursor = more
			? docs[docs.length - 1].seq
			: Math.max(since, this.getAccount(accountId)?.seq ?? 0);
		return { docs, cursor, more };
	}

	/**
	 * Optimistic concurrency: `expectedVersion` must equal the stored version
	 * (0 = the doc must not exist yet). Bumps the account sequence for the change feed.
	 */
	putDoc(
		accountId: string,
		docId: string,
		expectedVersion: number,
		body: { blob: string | null; deleted: boolean },
		maxDocs: number
	): PutResult {
		return this.#tx(() => {
			const cur = this.getDoc(accountId, docId);
			const curVersion = cur?.version ?? 0;
			if (curVersion !== expectedVersion)
				return { ok: false as const, reason: 'conflict' as const, current: cur ?? null };
			if (!cur) {
				const n = Number(
					(
						this.db
							.prepare('SELECT COUNT(*) AS n FROM docs WHERE account_id = ?')
							.get(accountId) as Row
					).n
				);
				if (n >= maxDocs) return { ok: false as const, reason: 'quota' as const };
			}
			this.db.prepare('UPDATE accounts SET seq = seq + 1 WHERE id = ?').run(accountId);
			const seq = Number(
				(this.db.prepare('SELECT seq FROM accounts WHERE id = ?').get(accountId) as Row).seq
			);
			const now = Date.now();
			const version = curVersion + 1;
			this.db
				.prepare(
					`INSERT INTO docs (account_id, doc_id, version, seq, updated_at, deleted, blob)
					 VALUES (?, ?, ?, ?, ?, ?, ?)
					 ON CONFLICT (account_id, doc_id) DO UPDATE SET
					   version = excluded.version, seq = excluded.seq, updated_at = excluded.updated_at,
					   deleted = excluded.deleted, blob = excluded.blob`
				)
				.run(accountId, docId, version, seq, now, body.deleted ? 1 : 0, body.blob);
			return {
				ok: true as const,
				doc: { docId, version, seq, updatedAt: now, deleted: body.deleted, blob: body.blob }
			};
		});
	}
}

export interface NewDevice {
	id: string;
	tokenHash: string;
	name: string;
}
