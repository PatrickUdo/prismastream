// IPTV sources per account, stored in the main database (table `sources`).
// Non-secret config (server url, username, redacted urls) is plain JSON; secrets (password,
// full playlist/EPG urls, which often carry credentials) are sealed with AES-256-GCM using the
// server key, with `<accountId>:<sourceId>` as additional data. Responses never contain them.
import { hostAllowed } from '../ssrf.ts';
import { seal, unseal } from '../keys.ts';
import type { Store } from '../store.ts';
import { randomId } from '../util.ts';
import { normalizeServerUrl, redactUrl, secretsFromUrl } from './core.ts';
import { SourceError } from './fetch.ts';

export type SourceType = 'xtream' | 'm3u' | 'sample';

export interface SourceSecret {
	password?: string;
	/** Full playlist url (may contain credentials). */
	playlistUrl?: string;
	/** Full EPG url override (may contain credentials). */
	epgUrl?: string;
}

export interface SourceConfigJson {
	serverUrl?: string;
	username?: string;
	/** Redacted, for display only. */
	playlistUrl?: string;
	/** Redacted, for display only. */
	epgUrl?: string;
}

export interface SourceStats {
	movies: number;
	series: number;
	channels: number;
	programmes: number;
}

export interface SourceStatus {
	lastSyncAt?: number;
	lastError?: string;
	errorCode?: string;
	lastWarning?: string;
	epgSyncAt?: number;
	stats?: SourceStats;
	account?: {
		status?: string;
		expiresAt?: number;
		maxConnections?: number;
		activeConnections?: number;
		isTrial?: boolean;
	};
}

export interface SourceRecord {
	accountId: string;
	id: string;
	type: SourceType;
	name: string;
	enabled: boolean;
	config: SourceConfigJson;
	sealed: string | null;
	addedAt: number;
	updatedAt: number;
	status: SourceStatus;
}

/** What the API returns (docs/BACKEND.md GET /v1/sources). */
export interface PublicSource extends SourceStatus {
	id: string;
	type: SourceType;
	name: string;
	enabled: boolean;
	serverUrl?: string;
	username?: string;
	playlistUrl?: string;
	epgUrl?: string;
	addedAt: number;
}

export interface SourceInput {
	type?: unknown;
	name?: unknown;
	serverUrl?: unknown;
	username?: unknown;
	password?: unknown;
	playlistUrl?: unknown;
	epgUrl?: unknown;
	enabled?: unknown;
}

/** Fully resolved source for fetching (secrets decrypted, in memory only). */
export interface ResolvedSource {
	id: string;
	type: SourceType;
	name: string;
	enabled: boolean;
	serverUrl?: string;
	username?: string;
	password?: string;
	playlistUrl?: string;
	epgUrl?: string;
	updatedAt: number;
}

export const SAMPLE_ID = 'sample';
export const MAX_SOURCES = 20;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

type Row = Record<string, unknown>;

function str(v: unknown, max = 2048): string | undefined {
	if (typeof v !== 'string') return undefined;
	const s = v.replace(/[\u0000-\u001f\u007f]/g, '').trim();
	return s ? s.slice(0, max) : undefined;
}

/** Strings to mask in errors and cached urls, in a STABLE order (placeholder indices). */
export function secretList(s: ResolvedSource): string[] {
	const out: string[] = [];
	if (s.type === 'xtream') {
		if (s.password) out.push(s.password);
		if (s.username) out.push(s.username);
	}
	for (const u of [s.playlistUrl, s.epgUrl]) if (u) out.push(...secretsFromUrl(u));
	return [...new Set(out.filter((x) => x && x.length >= 1))];
}

/** Pasted `http://host/get.php?username=U&password=P` → parts. */
export function parseXtreamUrl(input: string): { serverUrl: string; username: string; password: string } | undefined {
	try {
		const u = new URL(input.trim());
		const username = u.searchParams.get('username');
		const password = u.searchParams.get('password');
		if (!username || !password) return undefined;
		return { serverUrl: normalizeServerUrl(`${u.protocol}//${u.host}${u.pathname}`), username, password };
	} catch {
		return undefined;
	}
}

export function checkUrl(raw: string, allowPrivate: boolean, field: string): string {
	let u: URL;
	try {
		u = new URL(raw);
	} catch {
		throw new SourceError('config', `${field}: ongeldige url`);
	}
	if (u.protocol !== 'http:' && u.protocol !== 'https:')
		throw new SourceError('config', `${field}: alleen http en https`);
	if (!hostAllowed(u.hostname, allowPrivate))
		throw new SourceError('blocked_address', `${field}: privé- of lokale adressen zijn niet toegestaan`);
	return u.toString();
}

export interface ValidatedInput {
	type: 'xtream' | 'm3u';
	name: string;
	enabled: boolean;
	config: SourceConfigJson;
	secret: SourceSecret;
}

/** Validates a create/test body. Throws SourceError('config' | 'blocked_address'). */
export function validateInput(body: SourceInput, allowPrivate: boolean): ValidatedInput {
	const type = body.type;
	const epgRaw = str(body.epgUrl);
	const epg = epgRaw ? checkUrl(epgRaw, allowPrivate, 'epgUrl') : undefined;
	const enabled = body.enabled === undefined ? true : body.enabled !== false;
	if (type === 'xtream') {
		const given = str(body.serverUrl);
		const pasted = given ? parseXtreamUrl(given) : undefined;
		const serverUrl = pasted?.serverUrl ?? (given ? normalizeServerUrl(given) : undefined);
		const username = str(body.username, 256) ?? pasted?.username;
		const password = (typeof body.password === 'string' && body.password) || pasted?.password;
		if (!serverUrl || !username || !password)
			throw new SourceError('config', 'Server, gebruikersnaam en wachtwoord zijn verplicht');
		checkUrl(serverUrl, allowPrivate, 'serverUrl');
		return {
			type,
			enabled,
			name: str(body.name, 80) ?? hostOf(serverUrl),
			config: { serverUrl, username, epgUrl: epg ? redactUrl(epg) : undefined },
			secret: { password: password.slice(0, 512), epgUrl: epg }
		};
	}
	if (type === 'm3u') {
		const raw = str(body.playlistUrl, 4096);
		if (!raw) throw new SourceError('config', 'Een playlist-url is verplicht');
		const playlistUrl = checkUrl(raw, allowPrivate, 'playlistUrl');
		return {
			type,
			enabled,
			name: str(body.name, 80) ?? hostOf(playlistUrl),
			config: { playlistUrl: redactUrl(playlistUrl), epgUrl: epg ? redactUrl(epg) : undefined },
			secret: { playlistUrl, epgUrl: epg }
		};
	}
	throw new SourceError('config', 'type moet "xtream" of "m3u" zijn');
}

function hostOf(url: string): string {
	try {
		return new URL(url).hostname || 'IPTV';
	} catch {
		return 'IPTV';
	}
}

export class SourceRepo {
	#store: Store;
	#key: Buffer;
	#demo: boolean;
	#allowPrivate: boolean;

	constructor(store: Store, secretsKey: Buffer, opts: { demo: boolean; allowPrivate: boolean }) {
		this.#store = store;
		this.#key = secretsKey;
		this.#demo = opts.demo;
		this.#allowPrivate = opts.allowPrivate;
	}

	get demo(): boolean {
		return this.#demo;
	}

	#row(r: Row): SourceRecord {
		return {
			accountId: String(r.account_id),
			id: String(r.id),
			type: String(r.type) as SourceType,
			name: String(r.name),
			enabled: Number(r.enabled) === 1,
			config: JSON.parse(String(r.config)) as SourceConfigJson,
			sealed: r.secret == null ? null : String(r.secret),
			addedAt: Number(r.added_at),
			updatedAt: Number(r.updated_at),
			status: r.status ? (JSON.parse(String(r.status)) as SourceStatus) : {}
		};
	}

	/** The demo source exists for every account while DEMO_SOURCE is on (insert once). */
	#ensureSample(accountId: string) {
		if (!this.#demo) return;
		const now = Date.now();
		this.#store.db
			.prepare(
				`INSERT OR IGNORE INTO sources (account_id, id, type, name, enabled, config, added_at, updated_at)
				 VALUES (?, ?, 'sample', 'Demo-bibliotheek', 1, '{}', 0, ?)`
			)
			.run(accountId, SAMPLE_ID, now);
	}

	list(accountId: string): SourceRecord[] {
		this.#ensureSample(accountId);
		const rows = this.#store.db
			.prepare('SELECT * FROM sources WHERE account_id = ? ORDER BY added_at, id')
			.all(accountId) as Row[];
		return rows.map((r) => this.#row(r)).filter((s) => this.#demo || s.type !== 'sample');
	}

	get(accountId: string, id: string): SourceRecord | undefined {
		if (!ID_RE.test(id)) return undefined;
		if (id === SAMPLE_ID) this.#ensureSample(accountId);
		const r = this.#store.db
			.prepare('SELECT * FROM sources WHERE account_id = ? AND id = ?')
			.get(accountId, id) as Row | undefined;
		const rec = r ? this.#row(r) : undefined;
		if (rec?.type === 'sample' && !this.#demo) return undefined;
		return rec;
	}

	#aad(accountId: string, id: string) {
		return `source:${accountId}:${id}`;
	}

	secretOf(rec: SourceRecord): SourceSecret {
		if (!rec.sealed) return {};
		return JSON.parse(unseal(this.#key, rec.sealed, this.#aad(rec.accountId, rec.id))) as SourceSecret;
	}

	resolve(rec: SourceRecord): ResolvedSource {
		const secret = this.secretOf(rec);
		return {
			id: rec.id,
			type: rec.type,
			name: rec.name,
			enabled: rec.enabled,
			serverUrl: rec.config.serverUrl,
			username: rec.config.username,
			password: secret.password,
			playlistUrl: secret.playlistUrl,
			epgUrl: secret.epgUrl,
			updatedAt: rec.updatedAt
		};
	}

	create(accountId: string, input: ValidatedInput): SourceRecord {
		const count = this.list(accountId).filter((s) => s.type !== 'sample').length;
		if (count >= MAX_SOURCES) throw new SourceError('config', `Maximaal ${MAX_SOURCES} bronnen`);
		const id = randomId('s_', 9);
		const now = Date.now();
		this.#store.db
			.prepare(
				`INSERT INTO sources (account_id, id, type, name, enabled, config, secret, added_at, updated_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
			)
			.run(
				accountId,
				id,
				input.type,
				input.name,
				input.enabled ? 1 : 0,
				JSON.stringify(input.config),
				seal(this.#key, JSON.stringify(input.secret), this.#aad(accountId, id)),
				now,
				now
			);
		return this.get(accountId, id)!;
	}

	/**
	 * Applies a PATCH. Returns the record and whether fetch-relevant config changed (then the
	 * source cache must be dropped and refetched).
	 */
	update(
		accountId: string,
		id: string,
		patch: SourceInput
	): { record: SourceRecord; refetch: boolean; toggled: boolean } {
		const rec = this.get(accountId, id);
		if (!rec) throw new SourceError('config', 'Bron niet gevonden');
		const name = patch.name !== undefined ? (str(patch.name, 80) ?? rec.name) : rec.name;
		const enabled = patch.enabled !== undefined ? patch.enabled !== false : rec.enabled;
		let config = { ...rec.config };
		let refetch = false;
		let sealed = rec.sealed;
		if (rec.type !== 'sample') {
			const secret = this.secretOf(rec);
			if (rec.type === 'xtream') {
				const given = str(patch.serverUrl);
				const pasted = given ? parseXtreamUrl(given) : undefined;
				if (given) {
					const serverUrl = pasted?.serverUrl ?? normalizeServerUrl(given);
					checkUrl(serverUrl, this.#allowPrivate, 'serverUrl');
					if (serverUrl !== config.serverUrl) refetch = true;
					config.serverUrl = serverUrl;
				}
				const username = str(patch.username, 256) ?? pasted?.username;
				if (username && username !== config.username) {
					config.username = username;
					refetch = true;
				}
				const pw = (typeof patch.password === 'string' && patch.password) || pasted?.password;
				if (pw && pw !== secret.password) {
					secret.password = pw.slice(0, 512);
					refetch = true;
				}
			} else if (rec.type === 'm3u') {
				const raw = str(patch.playlistUrl, 4096);
				// The masked url coming back from GET means "unchanged".
				if (raw && raw !== rec.config.playlistUrl) {
					const url = checkUrl(raw, this.#allowPrivate, 'playlistUrl');
					if (url !== secret.playlistUrl) refetch = true;
					secret.playlistUrl = url;
					config.playlistUrl = redactUrl(url);
				}
			}
			if (patch.epgUrl !== undefined) {
				const raw = str(patch.epgUrl, 4096);
				if (!raw) {
					if (secret.epgUrl) refetch = true;
					delete secret.epgUrl;
					delete config.epgUrl;
				} else if (raw !== rec.config.epgUrl) {
					const url = checkUrl(raw, this.#allowPrivate, 'epgUrl');
					secret.epgUrl = url;
					config.epgUrl = redactUrl(url);
					refetch = true;
				}
			}
			sealed = seal(this.#key, JSON.stringify(secret), this.#aad(accountId, id));
		} else {
			config = {};
		}
		this.#store.db
			.prepare(
				`UPDATE sources SET name = ?, enabled = ?, config = ?, secret = ?, updated_at = ?
				 WHERE account_id = ? AND id = ?`
			)
			.run(name, enabled ? 1 : 0, JSON.stringify(config), sealed, Date.now(), accountId, id);
		return { record: this.get(accountId, id)!, refetch, toggled: enabled !== rec.enabled };
	}

	remove(accountId: string, id: string): boolean {
		const res = this.#store.db
			.prepare('DELETE FROM sources WHERE account_id = ? AND id = ?')
			.run(accountId, id);
		return Number(res.changes) > 0;
	}

	setEnabled(accountId: string, id: string, enabled: boolean) {
		this.#store.db
			.prepare('UPDATE sources SET enabled = ?, updated_at = ? WHERE account_id = ? AND id = ?')
			.run(enabled ? 1 : 0, Date.now(), accountId, id);
	}

	/** Merges a status patch (null clears a field). */
	setStatus(accountId: string, id: string, patch: Record<string, unknown>) {
		const rec = this.get(accountId, id);
		if (!rec) return;
		const next: Record<string, unknown> = { ...rec.status };
		for (const [k, v] of Object.entries(patch)) {
			if (v === null || v === undefined) delete next[k];
			else next[k] = v;
		}
		this.#store.db
			.prepare('UPDATE sources SET status = ? WHERE account_id = ? AND id = ?')
			.run(JSON.stringify(next), accountId, id);
	}

	toPublic(rec: SourceRecord): PublicSource {
		const out: PublicSource = {
			id: rec.id,
			type: rec.type,
			name: rec.name,
			enabled: rec.enabled,
			serverUrl: rec.config.serverUrl,
			username: rec.config.username,
			playlistUrl: rec.config.playlistUrl,
			epgUrl: rec.config.epgUrl,
			addedAt: rec.addedAt,
			...rec.status
		};
		for (const k of Object.keys(out) as (keyof PublicSource)[])
			if (out[k] === undefined) delete out[k];
		return out;
	}

	/** Accounts with at least one enabled real source, with their latest device activity. */
	accountsWithSources(): { accountId: string; lastSeenAt: number }[] {
		const rows = this.#store.db
			.prepare(
				`SELECT s.account_id AS account_id, MAX(d.last_seen_at) AS seen
				 FROM sources s LEFT JOIN devices d ON d.account_id = s.account_id
				 WHERE s.enabled = 1 AND s.type != 'sample'
				 GROUP BY s.account_id`
			)
			.all() as Row[];
		return rows.map((r) => ({ accountId: String(r.account_id), lastSeenAt: Number(r.seen ?? 0) }));
	}
}
