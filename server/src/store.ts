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
	playTokenGen: number;
	playTokenHash: string | null;
}

export interface EmailAccountRow extends AccountRow {
	email: string;
	authHash: string;
}

export interface InviteRow {
	id: string;
	createdAt: number;
	expiresAt: number | null;
	usedAt: number | null;
	usedBy: string | null;
	/** E-mail of the account that used it (when it still exists). */
	usedByEmail: string | null;
	/** The account that used it still exists. */
	usedByExists: boolean;
	revokedAt: number | null;
	note: string | null;
	status: 'open' | 'used' | 'expired' | 'revoked';
}

/** Thrown inside the signup transaction when the invite was used/revoked/expired meanwhile. */
export class InviteUnavailableError extends Error {
	constructor() {
		super('invite code not available');
	}
}

export interface DeviceCodeRow {
	deviceCodeHash: string;
	userCode: string;
	publicKey: string;
	deviceName: string;
	createdAt: number;
	expiresAt: number;
	lastPollAt: number;
	accountId: string | null;
	sealedKey: string | null;
	ephemeralPublicKey: string | null;
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
CREATE TABLE IF NOT EXISTS sources (
	account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
	id TEXT NOT NULL,
	type TEXT NOT NULL,
	name TEXT NOT NULL,
	enabled INTEGER NOT NULL DEFAULT 1,
	config TEXT NOT NULL,
	secret TEXT,
	added_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL,
	status TEXT,
	PRIMARY KEY (account_id, id)
);
CREATE TABLE IF NOT EXISTS device_codes (
	device_code_hash TEXT PRIMARY KEY,
	user_code TEXT NOT NULL UNIQUE,
	public_key TEXT NOT NULL,
	device_name TEXT NOT NULL,
	created_at INTEGER NOT NULL,
	expires_at INTEGER NOT NULL,
	last_poll_at INTEGER NOT NULL DEFAULT 0,
	account_id TEXT REFERENCES accounts(id) ON DELETE CASCADE,
	sealed_key TEXT,
	ephemeral_public_key TEXT
);
CREATE TABLE IF NOT EXISTS invite_codes (
	id TEXT PRIMARY KEY,
	code_hash TEXT NOT NULL UNIQUE,
	created_at INTEGER NOT NULL,
	expires_at INTEGER,
	used_at INTEGER,
	used_by TEXT,
	revoked_at INTEGER,
	note TEXT
);
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
		lastSeenAt: Number(r.last_seen_at),
		playTokenGen: Number(r.play_token_gen ?? 0),
		playTokenHash: r.play_token_hash == null ? null : String(r.play_token_hash)
	};
}

function toDeviceCode(r: Row): DeviceCodeRow {
	return {
		deviceCodeHash: String(r.device_code_hash),
		userCode: String(r.user_code),
		publicKey: String(r.public_key),
		deviceName: String(r.device_name),
		createdAt: Number(r.created_at),
		expiresAt: Number(r.expires_at),
		lastPollAt: Number(r.last_poll_at),
		accountId: r.account_id == null ? null : String(r.account_id),
		sealedKey: r.sealed_key == null ? null : String(r.sealed_key),
		ephemeralPublicKey: r.ephemeral_public_key == null ? null : String(r.ephemeral_public_key)
	};
}

export class Store {
	db: DatabaseSync;

	constructor(path: string) {
		if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
		this.db = new DatabaseSync(path);
		this.db.exec(SCHEMA);
		this.#migrate();
	}

	/** Additive migrations for databases created by older versions. */
	#migrate() {
		const cols = (table: string) =>
			new Set(
				(this.db.prepare(`PRAGMA table_info(${table})`).all() as Row[]).map((r) => String(r.name))
			);
		const acc = cols('accounts');
		if (!acc.has('email')) this.db.exec('ALTER TABLE accounts ADD COLUMN email TEXT');
		if (!acc.has('auth_hash')) this.db.exec('ALTER TABLE accounts ADD COLUMN auth_hash TEXT');
		this.db.exec('CREATE UNIQUE INDEX IF NOT EXISTS accounts_email ON accounts(email)');
		const dev = cols('devices');
		if (!dev.has('play_token_gen'))
			this.db.exec('ALTER TABLE devices ADD COLUMN play_token_gen INTEGER NOT NULL DEFAULT 0');
		if (!dev.has('play_token_hash')) {
			this.db.exec('ALTER TABLE devices ADD COLUMN play_token_hash TEXT');
		}
		this.db.exec(
			'CREATE UNIQUE INDEX IF NOT EXISTS devices_play_token ON devices(play_token_hash)'
		);
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

	createAccount(a: { id: string; salt: string; kdf: Kdf }, d: NewDevice, inviteHash?: string) {
		const now = Date.now();
		this.#tx(() => {
			this.db
				.prepare('INSERT INTO accounts (id, salt, kdf, created_at) VALUES (?, ?, ?, ?)')
				.run(a.id, a.salt, JSON.stringify(a.kdf), now);
			this.#insertDevice(a.id, d, now);
			if (inviteHash) this.#consumeInvite(inviteHash, a.id, now);
		});
	}

	// ---- invite codes ----------------------------------------------------------------

	/** Marks an invite as used; throws (→ rollback of the signup) when it is not available. */
	#consumeInvite(hash: string, accountId: string, now: number) {
		const res = this.db
			.prepare(
				`UPDATE invite_codes SET used_at = ?, used_by = ?
				 WHERE code_hash = ? AND used_at IS NULL AND revoked_at IS NULL
				 AND (expires_at IS NULL OR expires_at > ?)`
			)
			.run(now, accountId, hash, now);
		if (Number(res.changes) !== 1) throw new InviteUnavailableError();
	}

	createInvite(i: { id: string; codeHash: string; expiresAt: number | null; note?: string }) {
		this.db
			.prepare(
				'INSERT INTO invite_codes (id, code_hash, created_at, expires_at, note) VALUES (?, ?, ?, ?, ?)'
			)
			.run(i.id, i.codeHash, Date.now(), i.expiresAt, i.note ?? null);
	}

	/** True when an unused, unrevoked, unexpired invite with this hash exists. */
	inviteAvailable(hash: string, now = Date.now()): boolean {
		return !!this.db
			.prepare(
				`SELECT 1 FROM invite_codes WHERE code_hash = ? AND used_at IS NULL AND revoked_at IS NULL
				 AND (expires_at IS NULL OR expires_at > ?)`
			)
			.get(hash, now);
	}

	listInvites(now = Date.now()): InviteRow[] {
		const rows = this.db
			.prepare(
				`SELECT i.*, a.email AS used_email, a.id AS used_exists FROM invite_codes i
				 LEFT JOIN accounts a ON a.id = i.used_by ORDER BY i.created_at`
			)
			.all() as Row[];
		return rows.map((r) => {
			const n = (v: unknown) => (v == null ? null : Number(v));
			const row: InviteRow = {
				id: String(r.id),
				createdAt: Number(r.created_at),
				expiresAt: n(r.expires_at),
				usedAt: n(r.used_at),
				usedBy: r.used_by == null ? null : String(r.used_by),
				usedByEmail: r.used_email == null ? null : String(r.used_email),
				usedByExists: r.used_exists != null,
				revokedAt: n(r.revoked_at),
				note: r.note == null ? null : String(r.note),
				status: 'open'
			};
			row.status = row.usedAt
				? 'used'
				: row.revokedAt
					? 'revoked'
					: row.expiresAt !== null && row.expiresAt <= now
						? 'expired'
						: 'open';
			return row;
		});
	}

	/** Revokes an unused invite. Returns false when unknown or already used. */
	revokeInvite(id: string): boolean {
		const res = this.db
			.prepare(
				'UPDATE invite_codes SET revoked_at = ? WHERE id = ? AND used_at IS NULL AND revoked_at IS NULL'
			)
			.run(Date.now(), id);
		return Number(res.changes) === 1;
	}

	/** Accounts with device count and last activity (for the admin CLI). */
	listAccounts(): {
		id: string;
		email: string | null;
		createdAt: number;
		devices: number;
		lastSeenAt: number | null;
	}[] {
		const rows = this.db
			.prepare(
				`SELECT a.id, a.email, a.created_at, COUNT(d.id) AS devices, MAX(d.last_seen_at) AS seen
				 FROM accounts a LEFT JOIN devices d ON d.account_id = a.id
				 GROUP BY a.id ORDER BY a.created_at`
			)
			.all() as Row[];
		return rows.map((r) => ({
			id: String(r.id),
			email: r.email == null ? null : String(r.email),
			createdAt: Number(r.created_at),
			devices: Number(r.devices),
			lastSeenAt: r.seen == null ? null : Number(r.seen)
		}));
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
			Row | undefined;
		return r ? toDevice(r) : undefined;
	}

	deviceByProxyTokenHash(hash: string): DeviceRow | undefined {
		const r = this.db.prepare('SELECT * FROM devices WHERE proxy_token_hash = ?').get(hash) as
			Row | undefined;
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
			// E-mail accounts outlive their devices (log in again); legacy accounts do not.
			if (this.countDevices(accountId) === 0 && !this.accountHasEmail(accountId)) {
				this.deleteAccount(accountId);
				return 'account-deleted';
			}
			return 'removed';
		});
	}

	// ---- e-mail accounts (zero-knowledge login) --------------------------------

	accountHasEmail(id: string): boolean {
		const r = this.db.prepare('SELECT email FROM accounts WHERE id = ?').get(id) as Row | undefined;
		return !!r?.email;
	}

	createEmailAccount(
		a: { id: string; email: string; salt: string; kdf: Kdf; authHash: string },
		d: NewDevice,
		inviteHash?: string
	) {
		const now = Date.now();
		this.#tx(() => {
			this.db
				.prepare(
					'INSERT INTO accounts (id, salt, kdf, created_at, email, auth_hash) VALUES (?, ?, ?, ?, ?, ?)'
				)
				.run(a.id, a.salt, JSON.stringify(a.kdf), now, a.email, a.authHash);
			this.#insertDevice(a.id, d, now);
			if (inviteHash) this.#consumeInvite(inviteHash, a.id, now);
		});
	}

	accountByEmail(email: string): EmailAccountRow | undefined {
		const r = this.db.prepare('SELECT * FROM accounts WHERE email = ?').get(email) as
			Row | undefined;
		if (!r || !r.auth_hash) return undefined;
		return {
			id: String(r.id),
			salt: String(r.salt),
			kdf: JSON.parse(String(r.kdf)) as Kdf,
			createdAt: Number(r.created_at),
			seq: Number(r.seq),
			email: String(r.email),
			authHash: String(r.auth_hash)
		};
	}

	authHashOf(accountId: string): string | undefined {
		const r = this.db.prepare('SELECT auth_hash FROM accounts WHERE id = ?').get(accountId) as
			Row | undefined;
		return r?.auth_hash ? String(r.auth_hash) : undefined;
	}

	/** New password: new auth hash and KDF salt; every other device is signed out. */
	changeAuth(accountId: string, keepDeviceId: string, authHash: string, salt: string, kdf: Kdf) {
		return this.#tx(() => {
			this.db
				.prepare('UPDATE accounts SET auth_hash = ?, salt = ?, kdf = ? WHERE id = ?')
				.run(authHash, salt, JSON.stringify(kdf), accountId);
			const res = this.db
				.prepare('DELETE FROM devices WHERE account_id = ? AND id != ?')
				.run(accountId, keepDeviceId);
			this.db.prepare('DELETE FROM pairing_codes WHERE account_id = ?').run(accountId);
			return Number(res.changes);
		});
	}

	getDevice(id: string): DeviceRow | undefined {
		const r = this.db.prepare('SELECT * FROM devices WHERE id = ?').get(id) as Row | undefined;
		return r ? toDevice(r) : undefined;
	}

	// ---- play tokens -------------------------------------------------------------

	setPlayToken(deviceId: string, gen: number, hash: string) {
		this.db
			.prepare('UPDATE devices SET play_token_gen = ?, play_token_hash = ? WHERE id = ?')
			.run(gen, hash, deviceId);
	}

	deviceByPlayTokenHash(hash: string): DeviceRow | undefined {
		const r = this.db.prepare('SELECT * FROM devices WHERE play_token_hash = ?').get(hash) as
			Row | undefined;
		return r ? toDevice(r) : undefined;
	}

	// ---- device codes (TV login) -------------------------------------------------

	createDeviceCode(
		c: Omit<DeviceCodeRow, 'accountId' | 'sealedKey' | 'ephemeralPublicKey' | 'lastPollAt'>
	) {
		this.db
			.prepare(
				`INSERT INTO device_codes (device_code_hash, user_code, public_key, device_name, created_at, expires_at)
				 VALUES (?, ?, ?, ?, ?, ?)`
			)
			.run(c.deviceCodeHash, c.userCode, c.publicKey, c.deviceName, c.createdAt, c.expiresAt);
	}

	deviceCodeByUserCode(userCode: string): DeviceCodeRow | undefined {
		const r = this.db.prepare('SELECT * FROM device_codes WHERE user_code = ?').get(userCode) as
			Row | undefined;
		return r ? toDeviceCode(r) : undefined;
	}

	deviceCodeByHash(hash: string): DeviceCodeRow | undefined {
		const r = this.db.prepare('SELECT * FROM device_codes WHERE device_code_hash = ?').get(hash) as
			Row | undefined;
		return r ? toDeviceCode(r) : undefined;
	}

	/** Approves a pending code once. Returns false when it was already approved or expired. */
	approveDeviceCode(
		userCode: string,
		accountId: string,
		sealedKey: string,
		ephemeralPublicKey: string,
		now = Date.now()
	): boolean {
		const res = this.db
			.prepare(
				`UPDATE device_codes SET account_id = ?, sealed_key = ?, ephemeral_public_key = ?
				 WHERE user_code = ? AND account_id IS NULL AND expires_at > ?`
			)
			.run(accountId, sealedKey, ephemeralPublicKey, userCode, now);
		return Number(res.changes) === 1;
	}

	touchDeviceCodePoll(hash: string, now: number) {
		this.db
			.prepare('UPDATE device_codes SET last_poll_at = ? WHERE device_code_hash = ?')
			.run(now, hash);
	}

	/** Consumes an approved code and adds the device atomically. */
	redeemDeviceCode(
		hash: string,
		d: NewDevice,
		maxDevices: number
	): { ok: true; row: DeviceCodeRow } | { ok: false; reason: 'invalid' | 'device-limit' } {
		return this.#tx(() => {
			const r = this.db
				.prepare('SELECT * FROM device_codes WHERE device_code_hash = ?')
				.get(hash) as Row | undefined;
			if (!r || r.account_id == null) return { ok: false as const, reason: 'invalid' as const };
			const row = toDeviceCode(r);
			this.db.prepare('DELETE FROM device_codes WHERE device_code_hash = ?').run(hash);
			if (this.countDevices(row.accountId!) >= maxDevices)
				return { ok: false as const, reason: 'device-limit' as const };
			this.#insertDevice(row.accountId!, d, Date.now());
			return { ok: true as const, row };
		});
	}

	countPendingDeviceCodes(now = Date.now()): number {
		const r = this.db
			.prepare('SELECT COUNT(*) AS n FROM device_codes WHERE expires_at > ?')
			.get(now) as Row;
		return Number(r.n);
	}

	purgeExpiredDeviceCodes(now = Date.now()) {
		this.db.prepare('DELETE FROM device_codes WHERE expires_at <= ?').run(now);
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
				Row | undefined;
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
