/* eslint-disable svelte/prefer-svelte-reactivity -- internal bookkeeping maps/sets are intentionally not reactive */
// SyncEngine: end-to-end encrypted sync of profiles, per-profile data, settings and sources.
//
// Model: for every document the engine keeps a merge *state* (see merge.ts) plus the server
// version it is based on and a dirty flag. Local edits are folded into the state immediately
// (user.onChange → reconcile), then pushed after a short debounce. Remote docs are decrypted,
// merged with the state and applied to the stores in one synchronous step, after which the
// state equals the store again, so applying remote data never echoes back as a local change.
// Pushes use optimistic concurrency (If-Match); a 409 hands us the server copy to merge.
import { Capacitor } from '@capacitor/core';
import type { AppSettings, Profile, ProfileData } from '#lib/types.ts';
import { DEFAULT_HOME_ROWS, user } from '#lib/stores/user.svelte.ts';
import { loadJSON, saveJSON } from '#lib/storage.ts';
import {
	SyncApi,
	SyncApiError,
	SyncNetworkError,
	normalizeServerUrl,
	type Credentials,
	type DeviceInfo,
	type RemoteDoc
} from './api.ts';
import {
	DecryptError,
	KDF_ITERATIONS,
	decryptJson,
	deriveKeys,
	docAad,
	encryptJson,
	fingerprint,
	type Kdf,
	type SyncKeys
} from './crypto.ts';
import {
	dataFromDoc,
	isDataDoc,
	isLwwMap,
	isSettingsDoc,
	mergeData,
	mergeProfiles,
	mergeSettings,
	mergeSources,
	profilesFromDoc,
	pruneData,
	pruneLwwMap,
	reconcileData,
	reconcileProfiles,
	reconcileSettings,
	reconcileSources,
	sameJson,
	settingsPatch,
	sourcesFromDoc,
	stripLocalSettings,
	type DataDoc,
	type ProfilesDoc,
	type SettingsDoc,
	type SourcesDoc,
	type SyncedSource
} from './merge.ts';
import { getSourcesAdapter, onSourcesAdapter, type SourcesSyncAdapter } from './adapters.ts';
import { secrets, vault } from './vault.ts';

export type SyncStatus = 'off' | 'idle' | 'syncing' | 'error' | 'offline';
export type SyncErrorCode =
	| 'network'
	| 'unauthorized'
	| 'locked'
	| 'wrongPassphrase'
	| 'decrypt'
	| 'invalidUrl'
	| 'notSyncServer'
	| 'invalidCode'
	| 'deviceLimit'
	| 'signupDisabled'
	| 'rateLimited'
	| 'quota'
	| 'server'
	| 'unknown';

interface SyncConfig {
	serverUrl: string;
	accountId: string;
	deviceId: string;
	deviceName: string;
	salt: string;
	kdf: Kdf;
	/** Joined an existing account; local defaults must not override remote data. */
	joining?: boolean;
	/** Untouched default profile of a joining device; dropped once remote profiles arrive. */
	pristineProfileId?: string | null;
}

interface DocState {
	doc: unknown;
	version: number;
	dirty: boolean;
	rev: number;
	deleted?: boolean;
}

type Kind = 'profiles' | 'settings' | 'data' | 'sources';

/** Wire format of the `sources` doc: merge state plus the secrets of live sources. */
interface SourcesWire {
	map: SourcesDoc;
	secrets: Record<string, string>;
}

const KEYCHECK_ID = 'meta:keycheck';
const KEYCHECK_VALUE = 'prismastream-sync-keycheck-v1';
const PUSH_DEBOUNCE_MS = 2000;
const PUSH_MIN_INTERVAL_MS = 8000;
const PERIODIC_MS = 5 * 60_000;
const MAX_BACKOFF_MS = 5 * 60_000;

function kindOf(docId: string): Kind | null {
	if (docId === 'profiles' || docId === 'settings' || docId === 'sources') return docId;
	if (docId.startsWith('data:')) return 'data';
	return null;
}

const ORDER: Record<Kind, number> = { profiles: 0, settings: 1, data: 2, sources: 3 };

export function defaultDeviceName(): string {
	const platform = Capacitor.getPlatform();
	if (platform === 'ios') return /iPad/.test(navigator.userAgent) ? 'iPad' : 'iPhone';
	if (platform === 'android') return 'Android';
	const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
	const browser = /Edg\//.test(ua)
		? 'Edge'
		: /Firefox\//.test(ua)
			? 'Firefox'
			: /Chrome\//.test(ua)
				? 'Chrome'
				: /Safari\//.test(ua)
					? 'Safari'
					: 'Browser';
	const os = /Mac OS X/.test(ua)
		? 'macOS'
		: /Windows/.test(ua)
			? 'Windows'
			: /Linux/.test(ua)
				? 'Linux'
				: '';
	return os ? `${browser} op ${os}` : browser;
}

function isPristine(profiles: Profile[], data: ProfileData): boolean {
	return (
		profiles.length === 1 &&
		data.favorites.length === 0 &&
		data.favoriteChannels.length === 0 &&
		Object.keys(data.progress).length === 0 &&
		data.history.length === 0 &&
		sameJson(data.homeRows, DEFAULT_HOME_ROWS) &&
		!data.lastChannelId
	);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class SyncEngine {
	status = $state<SyncStatus>('off');
	error = $state<SyncErrorCode | null>(null);
	lastSyncAt = $state<number | null>(null);
	/** Configured, but the encryption key is not available: the passphrase is needed. */
	locked = $state(false);
	/** Number of documents with changes that are not on the server yet. */
	pending = $state(0);
	serverUrl = $state('');
	accountId = $state<string | null>(null);
	deviceId = $state<string | null>(null);
	deviceName = $state('');

	get configured(): boolean {
		return this.accountId !== null;
	}

	#config: SyncConfig | null = null;
	#token: string | null = null;
	#keys: SyncKeys | null = null;
	#api: SyncApi | null = null;
	#states = new Map<string, DocState>();
	#cursor = 0;
	#loaded = false;
	#initStarted = false;
	#adapter: SourcesSyncAdapter | null = null;
	#unsubs: (() => void)[] = [];
	#chain: Promise<unknown> = Promise.resolve();
	#cycleQueued = false;
	#pushTimer: ReturnType<typeof setTimeout> | undefined;
	#retryTimer: ReturnType<typeof setTimeout> | undefined;
	#periodic: ReturnType<typeof setInterval> | undefined;
	#persistTimer: ReturnType<typeof setTimeout> | undefined;
	#persistIds = new Set<string>();
	#lastPushAt = 0;
	#lastFocusSync = 0;
	#backoff = 0;
	#polling = false;
	#pollAbort: AbortController | null = null;
	#wake: (() => void) | null = null;
	#sourcesNeedFetch = false;

	// ---- lifecycle --------------------------------------------------------------

	/** Starts sync if this device is configured. Safe to call more than once. */
	async init(): Promise<void> {
		if (this.#initStarted) return;
		this.#initStarted = true;
		try {
			for (let i = 0; i < 400 && !user.ready; i++) await sleep(50);
			const cfg = await vault.get<SyncConfig>('config');
			this.lastSyncAt = (await vault.get<number>('lastSyncAt')) ?? null;
			if (cfg) await this.#activate(cfg);
			else this.status = 'off';
		} catch (err) {
			console.warn('[sync] init failed:', (err as Error)?.name ?? 'error');
			this.status = 'error';
			this.error = 'unknown';
		}
	}

	async #activate(cfg: SyncConfig, keys?: SyncKeys | null) {
		this.#config = cfg;
		this.serverUrl = cfg.serverUrl;
		this.accountId = cfg.accountId;
		this.deviceId = cfg.deviceId;
		this.deviceName = cfg.deviceName;
		this.#api = new SyncApi(cfg.serverUrl);
		this.#token = await secrets.getToken();
		this.#keys = keys ?? (await vault.get<SyncKeys>('keys')) ?? null;
		await this.#loadStates();
		this.#subscribe();
		if (!this.#token) {
			this.status = 'error';
			this.error = 'unauthorized';
			return;
		}
		if (!this.#keys) {
			this.locked = true;
			this.status = 'error';
			this.error = this.error === 'wrongPassphrase' ? 'wrongPassphrase' : 'locked';
			return;
		}
		this.locked = false;
		this.status = 'idle';
		this.error = null;
		this.#startBackground();
		void this.syncNow();
	}

	async #loadStates() {
		this.#states.clear();
		this.#cursor = (await vault.get<number>('cursor')) ?? 0;
		const ids = (await vault.get<string[]>('docIds')) ?? [];
		for (const id of ids) {
			const st = await vault.get<DocState>('doc:' + id);
			if (st) this.#states.set(id, st);
		}
		this.#sourcesNeedFetch = (await vault.get<boolean>('sourcesNeedFetch')) ?? false;
		this.#loaded = true;
		this.#updatePending();
	}

	#subscribe() {
		this.#unsubscribe();
		this.#unsubs.push(user.onChange((kind) => this.#onLocalChange(kind)));
		const bindAdapter = (a: SourcesSyncAdapter | null) => {
			this.#adapter = a;
			if (a) this.#unsubs.push(a.onChange(() => this.#onLocalChange('sources')));
			if (a && this.#keys) void this.syncNow();
		};
		bindAdapter(getSourcesAdapter());
		this.#unsubs.push(onSourcesAdapter(bindAdapter));
		if (typeof window === 'undefined') return;
		const onVisible = () => {
			if (document.visibilityState === 'visible') {
				this.#wakeUp();
				if (Date.now() - this.#lastFocusSync > 5000) {
					this.#lastFocusSync = Date.now();
					void this.syncNow();
				}
			} else {
				void this.#flushPush();
			}
		};
		const onOnline = () => {
			this.#wakeUp();
			void this.syncNow();
		};
		const onOffline = () => {
			if (this.configured && !this.locked) this.status = 'offline';
		};
		const onHide = () => void this.#flushPush();
		window.addEventListener('focus', onVisible);
		document.addEventListener('visibilitychange', onVisible);
		window.addEventListener('online', onOnline);
		window.addEventListener('offline', onOffline);
		window.addEventListener('pagehide', onHide);
		this.#unsubs.push(() => {
			window.removeEventListener('focus', onVisible);
			document.removeEventListener('visibilitychange', onVisible);
			window.removeEventListener('online', onOnline);
			window.removeEventListener('offline', onOffline);
			window.removeEventListener('pagehide', onHide);
		});
	}

	#unsubscribe() {
		for (const u of this.#unsubs.splice(0)) u();
	}

	#startBackground() {
		clearInterval(this.#periodic);
		this.#periodic = setInterval(() => void this.syncNow(), PERIODIC_MS);
		if (!this.#polling) {
			this.#polling = true;
			void this.#pollLoop();
		}
	}

	#stopBackground() {
		clearInterval(this.#periodic);
		clearTimeout(this.#pushTimer);
		clearTimeout(this.#retryTimer);
		this.#polling = false;
		this.#pollAbort?.abort();
		this.#wakeUp();
	}

	#wakeUp() {
		const w = this.#wake;
		this.#wake = null;
		w?.();
	}

	#idle(ms: number) {
		return new Promise<void>((resolve) => {
			const timer = setTimeout(done, ms);
			function done() {
				clearTimeout(timer);
				resolve();
			}
			this.#wake = done;
		});
	}

	/** Long-poll loop: wakes up as soon as another device pushed something. */
	async #pollLoop() {
		let failures = 0;
		while (this.#polling) {
			const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
			const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
			if (hidden || offline || this.locked || !this.#token || !this.#api) {
				await this.#idle(30_000);
				continue;
			}
			const ctrl = new AbortController();
			this.#pollAbort = ctrl;
			try {
				const r = await this.#api.waitForChanges(this.#token, this.#cursor, ctrl.signal);
				failures = 0;
				if (r.cursor > this.#cursor) await this.syncNow();
			} catch (err) {
				if (!this.#polling) break;
				if (err instanceof SyncApiError && err.status === 401) {
					this.#handleError(err);
					break;
				}
				failures++;
				await this.#idle(Math.min(60_000, 2000 * 2 ** Math.min(failures, 5)));
			} finally {
				this.#pollAbort = null;
			}
		}
	}

	// ---- serialisation ----------------------------------------------------------

	#exclusive<T>(fn: () => Promise<T>): Promise<T> {
		const run = this.#chain.then(fn, fn);
		this.#chain = run.catch(() => undefined);
		return run;
	}

	/** Pull remote changes and push local ones. Coalesces concurrent calls. */
	syncNow(): Promise<void> {
		if (!this.configured || this.locked || !this.#keys) return Promise.resolve();
		if (this.#cycleQueued) return this.#chain.then(() => undefined);
		this.#cycleQueued = true;
		return this.#exclusive(async () => {
			this.#cycleQueued = false;
			await this.#cycle(true);
		});
	}

	#schedulePush() {
		if (!this.#keys || !this.#token) return;
		clearTimeout(this.#pushTimer);
		const wait = Math.max(PUSH_DEBOUNCE_MS, this.#lastPushAt + PUSH_MIN_INTERVAL_MS - Date.now());
		this.#pushTimer = setTimeout(() => void this.#flushPush(), wait);
	}

	#flushPush(): Promise<void> {
		clearTimeout(this.#pushTimer);
		if (!this.#keys || !this.#token || this.pending === 0) return Promise.resolve();
		return this.#exclusive(() => this.#cycle(false));
	}

	async #cycle(pull: boolean) {
		if (!this.#keys || !this.#token || !this.#api || !this.#config) return;
		clearTimeout(this.#retryTimer);
		this.status = 'syncing';
		try {
			await this.#prepareLocal();
			if (pull) await this.#pull();
			await this.#push();
			this.status = 'idle';
			this.error = null;
			this.#backoff = 0;
			if (pull) {
				this.lastSyncAt = Date.now();
				void vault.set('lastSyncAt', this.lastSyncAt);
			}
		} catch (err) {
			this.#handleError(err);
		}
	}

	#handleError(err: unknown) {
		if (err instanceof SyncNetworkError) {
			this.status = 'offline';
			this.error = 'network';
			this.#retryLater();
			return;
		}
		this.status = 'error';
		if (err instanceof SyncApiError) {
			if (err.status === 401) {
				this.error = 'unauthorized';
				this.#stopBackground();
				return;
			}
			this.error = err.status === 429 ? 'rateLimited' : err.status === 507 ? 'quota' : 'server';
			this.#retryLater();
			return;
		}
		if (err instanceof DecryptError) {
			this.error = 'decrypt';
			return;
		}
		console.warn('[sync] error:', (err as Error)?.name ?? 'error');
		this.error = 'unknown';
		this.#retryLater();
	}

	#retryLater() {
		clearTimeout(this.#retryTimer);
		this.#backoff = Math.min(MAX_BACKOFF_MS, this.#backoff ? this.#backoff * 2 : 5000);
		this.#retryTimer = setTimeout(() => void this.syncNow(), this.#backoff);
	}

	// ---- local → state ----------------------------------------------------------

	#onLocalChange(kind: 'profiles' | 'data' | 'settings' | 'sources') {
		if (!this.#loaded || !this.configured) return;
		const now = Date.now();
		if (kind === 'sources') {
			void this.#reconcileSources(now).then((c) => c && this.#schedulePush());
			return;
		}
		const changed =
			kind === 'profiles'
				? this.#reconcileProfiles(now)
				: kind === 'settings'
					? this.#reconcileSettings(now)
					: this.#reconcileActiveData(now);
		if (changed) this.#schedulePush();
	}

	#liveProfileIds(): Set<string> {
		const st = this.#states.get('profiles');
		return new Set(st && !st.deleted ? Object.keys((st.doc as ProfilesDoc).items) : []);
	}

	#setDoc(docId: string, doc: unknown): boolean {
		const st = this.#states.get(docId);
		if (st && !st.deleted && sameJson(st.doc, doc)) return false;
		this.#states.set(docId, {
			doc,
			version: st?.version ?? 0,
			dirty: true,
			rev: (st?.rev ?? 0) + 1
		});
		this.#persist(docId);
		return true;
	}

	#reconcileProfiles(now: number): boolean {
		const pristine = this.#config?.pristineProfileId;
		let current = $state.snapshot(user.profiles) as Profile[];
		if (pristine) current = current.filter((p) => p.id !== pristine);
		const prev = this.#states.get('profiles');
		const next = reconcileProfiles(
			prev && !prev.deleted ? (prev.doc as ProfilesDoc) : undefined,
			current,
			now
		);
		const changed = this.#setDoc('profiles', next);
		// Profiles deleted here: remove their data doc from the server as well.
		for (const id of Object.keys(next.deleted)) {
			const st = this.#states.get('data:' + id);
			if (st && !st.deleted && !(id in next.items)) {
				this.#states.set('data:' + id, {
					doc: null,
					deleted: true,
					version: st.version,
					dirty: st.version > 0,
					rev: st.rev + 1
				});
				this.#persist('data:' + id);
			}
		}
		this.#updatePending();
		return changed;
	}

	#reconcileSettings(now: number): boolean {
		const prev = this.#states.get('settings');
		const cur = $state.snapshot(user.settings) as AppSettings;
		let next: SettingsDoc;
		if (!prev && this.#config?.joining) next = { v: stripLocalSettings(cur), ts: 0 };
		else next = reconcileSettings(prev?.doc as SettingsDoc | undefined, cur, now);
		const changed = this.#setDoc('settings', next);
		this.#updatePending();
		return changed;
	}

	#reconcileActiveData(now: number): boolean {
		const id = user.activeId;
		if (!id || id === this.#config?.pristineProfileId) return false;
		if (!this.#liveProfileIds().has(id)) return false;
		const st = this.#states.get('data:' + id);
		const prev = st && !st.deleted ? (st.doc as DataDoc) : undefined;
		const next = reconcileData(
			prev,
			$state.snapshot(user.data) as ProfileData,
			now,
			DEFAULT_HOME_ROWS
		);
		const changed = this.#setDoc('data:' + id, next);
		this.#updatePending();
		return changed;
	}

	async #reconcileSources(now: number): Promise<boolean> {
		const a = this.#adapter;
		const keys = this.#keys;
		if (!a || !keys || this.#sourcesNeedFetch) return false;
		const current: SyncedSource[] = [];
		for (const config of a.list()) {
			const secret = await a.getSecret(config.id);
			const s: SyncedSource = { config };
			if (secret) s.secretMac = await fingerprint(keys.mac, `${config.id}\u0000${secret}`);
			current.push(s);
		}
		const prev = this.#states.get('sources');
		const changed = this.#setDoc(
			'sources',
			reconcileSources(prev?.doc as SourcesDoc | undefined, current, now)
		);
		this.#updatePending();
		return changed;
	}

	/** Folds all local state into the docs (also profiles that have no data doc yet). */
	async #prepareLocal() {
		const now = Date.now();
		this.#reconcileProfiles(now);
		this.#reconcileSettings(now);
		this.#reconcileActiveData(now);
		for (const id of this.#liveProfileIds()) {
			if (id === user.activeId || this.#states.get('data:' + id)) continue;
			const stored = await loadJSON<ProfileData | null>(`data:${id}`, null);
			if (stored)
				this.#setDoc('data:' + id, reconcileData(undefined, stored, now, DEFAULT_HOME_ROWS));
		}
		if (this.#adapter && this.#sourcesNeedFetch && this.#api && this.#token) {
			const r = await this.#api.getDoc(this.#token, 'sources');
			this.#sourcesNeedFetch = false;
			void vault.set('sourcesNeedFetch', false);
			if (r && r.version !== this.#states.get('sources')?.version)
				await this.#integrate([await this.#decode(r)]);
		}
		await this.#reconcileSources(now);
		this.#updatePending();
	}

	// ---- remote → state → stores -------------------------------------------------

	async #decode(r: RemoteDoc): Promise<{ remote: RemoteDoc; doc: unknown }> {
		if (r.deleted || !r.blob) return { remote: r, doc: null };
		const doc = await decryptJson(
			this.#keys!.enc,
			docAad(this.#config!.accountId, r.docId),
			r.blob
		);
		return { remote: r, doc };
	}

	async #pull() {
		const api = this.#api!;
		for (let page = 0; page < 100; page++) {
			const res = await api.changes(this.#token!, this.#cursor);
			const list: { remote: RemoteDoc; doc: unknown }[] = [];
			for (const r of res.docs) {
				if (!kindOf(r.docId)) continue;
				if (this.#states.get(r.docId)?.version === r.version) continue;
				list.push(await this.#decode(r));
			}
			await this.#integrate(list);
			this.#cursor = res.cursor;
			void vault.set('cursor', this.#cursor);
			if (!res.more) break;
		}
		if (this.#config?.joining) {
			this.#config = { ...this.#config, joining: false, pristineProfileId: null };
			await vault.set('config', this.#config);
		}
	}

	/** Merge decoded remote docs into the states and apply them to the stores. */
	async #integrate(list: { remote: RemoteDoc; doc: unknown }[]) {
		if (list.length === 0) return;
		const now = Date.now();
		// Capture pending local edits first so the merge sees them.
		this.#reconcileProfiles(now);
		this.#reconcileSettings(now);
		this.#reconcileActiveData(now);
		const sorted = [...list].sort(
			(a, b) => ORDER[kindOf(a.remote.docId)!] - ORDER[kindOf(b.remote.docId)!]
		);
		const sourceJobs: Promise<void>[] = [];
		for (const { remote, doc } of sorted) {
			const kind = kindOf(remote.docId)!;
			const st = this.#states.get(remote.docId);
			const rev = (st?.rev ?? 0) + 1;
			if (remote.deleted) {
				this.#states.set(remote.docId, {
					doc: null,
					deleted: true,
					version: remote.version,
					dirty: false,
					rev
				});
				this.#persist(remote.docId);
				continue;
			}
			const local = st && !st.deleted ? st.doc : undefined;
			let merged: unknown;
			let remoteState: unknown = doc;
			if (kind === 'profiles') {
				if (!isLwwMap(doc)) continue;
				merged = local ? mergeProfiles(local as ProfilesDoc, doc as ProfilesDoc) : doc;
			} else if (kind === 'settings') {
				if (!isSettingsDoc(doc)) continue;
				merged = local ? mergeSettings(local as SettingsDoc, doc) : doc;
			} else if (kind === 'data') {
				if (!isDataDoc(doc)) continue;
				merged = local ? mergeData(local as DataDoc, doc) : doc;
			} else {
				const wire = doc as SourcesWire;
				if (!wire || !isLwwMap(wire.map)) continue;
				if (!this.#adapter) {
					// Nobody can apply sources yet: fetch this doc again once an adapter exists.
					this.#sourcesNeedFetch = true;
					void vault.set('sourcesNeedFetch', true);
					continue;
				}
				remoteState = wire.map;
				merged = local ? mergeSources(local as SourcesDoc, wire.map) : wire.map;
				sourceJobs.push(this.#applySources(merged as SourcesDoc, wire, local as SourcesDoc));
			}
			this.#states.set(remote.docId, {
				doc: merged,
				version: remote.version,
				dirty: !sameJson(merged, remoteState),
				rev
			});
			this.#persist(remote.docId);
			if (kind === 'profiles') this.#applyProfiles(merged as ProfilesDoc);
			else if (kind === 'settings') this.#applySettings(merged as SettingsDoc);
			else if (kind === 'data') this.#applyData(remote.docId.slice(5), merged as DataDoc);
		}
		this.#updatePending();
		await Promise.all(sourceJobs);
	}

	#applyProfiles(doc: ProfilesDoc) {
		const target = profilesFromDoc(doc);
		if (target.length === 0) return;
		const current = $state.snapshot(user.profiles) as Profile[];
		const jobs: Promise<unknown>[] = [];
		for (const p of target) {
			const cur = current.find((c) => c.id === p.id);
			if (!cur) {
				jobs.push(user.createProfile(p));
				// Its data doc may have arrived earlier (another page of changes): apply it now.
				const ds = this.#states.get('data:' + p.id);
				if (ds && !ds.deleted && ds.doc) this.#applyData(p.id, ds.doc as DataDoc);
			} else if (!sameJson(cur, p)) {
				// Explicitly clear optional fields the winner no longer has (e.g. a removed PIN).
				const patch: Record<string, unknown> = { ...p };
				for (const k of Object.keys(cur)) if (!(k in patch)) patch[k] = undefined;
				jobs.push(user.updateProfile(p.id, patch as Partial<Profile>));
			}
		}
		const keep = new Set(target.map((p) => p.id));
		for (const c of current) if (!keep.has(c.id)) jobs.push(user.deleteProfile(c.id));
		void Promise.all(jobs).catch(() => undefined);
	}

	#applySettings(doc: SettingsDoc) {
		const cur = $state.snapshot(user.settings) as AppSettings;
		if (sameJson(stripLocalSettings(cur), doc.v)) return;
		void user.updateSettings(settingsPatch(doc, cur));
	}

	#applyData(profileId: string, doc: DataDoc) {
		if (!this.#liveProfileIds().has(profileId)) return;
		const data = dataFromDoc(doc);
		if (profileId === user.activeId) {
			if (!sameJson($state.snapshot(user.data), data)) user.replaceData(structuredClone(data));
		} else {
			void saveJSON(`data:${profileId}`, data);
		}
	}

	async #applySources(merged: SourcesDoc, wire: SourcesWire, local: SourcesDoc | undefined) {
		const a = this.#adapter;
		if (!a) return;
		// Only hand over secrets that differ from what this device already has.
		const secretsToSet: Record<string, string> = {};
		for (const [id, e] of Object.entries(merged.items)) {
			const s = wire.secrets?.[id];
			if (typeof s !== 'string') continue;
			if (wire.map.items[id]?.v.secretMac !== e.v.secretMac) continue;
			if (local?.items[id]?.v.secretMac === e.v.secretMac) continue;
			secretsToSet[id] = s;
		}
		await a.apply(sourcesFromDoc(merged), secretsToSet);
	}

	// ---- state → server ---------------------------------------------------------

	async #wire(docId: string, doc: unknown): Promise<unknown> {
		const kind = kindOf(docId);
		const now = Date.now();
		if (kind === 'data') return pruneData(doc as DataDoc, now);
		if (kind === 'profiles') return pruneLwwMap(doc as ProfilesDoc, now);
		if (kind === 'sources') {
			const map = pruneLwwMap(doc as SourcesDoc, now);
			const out: SourcesWire = { map, secrets: {} };
			const a = this.#adapter;
			if (a)
				for (const id of Object.keys(map.items)) {
					const s = await a.getSecret(id);
					if (s) out.secrets[id] = s;
				}
			return out;
		}
		return doc;
	}

	async #push() {
		const api = this.#api!;
		const ids = [...this.#states.entries()]
			.filter(([, s]) => s.dirty)
			.map(([id]) => id)
			.sort((a, b) => ORDER[kindOf(a) ?? 'sources'] - ORDER[kindOf(b) ?? 'sources']);
		if (ids.length) this.#lastPushAt = Date.now();
		for (const docId of ids) {
			for (let attempt = 0; attempt < 4; attempt++) {
				const st = this.#states.get(docId);
				if (!st || !st.dirty) break;
				if (docId === 'sources' && (!this.#adapter || this.#sourcesNeedFetch)) break;
				const rev = st.rev;
				const payload = st.deleted
					? ({ deleted: true } as const)
					: {
							blob: await encryptJson(
								this.#keys!.enc,
								docAad(this.#config!.accountId, docId),
								await this.#wire(docId, st.doc)
							)
						};
				const res = await api.putDoc(this.#token!, docId, st.version, payload);
				if ('version' in res) {
					const cur = this.#states.get(docId)!;
					cur.version = res.version;
					if (cur.rev === rev) cur.dirty = false;
					this.#persist(docId);
					break;
				}
				// Conflict: merge the server copy and try again.
				if (!res.conflict) {
					st.version = 0;
					continue;
				}
				await this.#integrate([await this.#decode(res.conflict)]);
			}
		}
		this.#updatePending();
	}

	// ---- persistence of states --------------------------------------------------

	#persist(docId: string) {
		this.#persistIds.add(docId);
		clearTimeout(this.#persistTimer);
		this.#persistTimer = setTimeout(() => void this.#flushPersist(), 400);
	}

	async #flushPersist() {
		const ids = [...this.#persistIds];
		this.#persistIds.clear();
		try {
			for (const id of ids) {
				const st = this.#states.get(id);
				if (st) await vault.set('doc:' + id, st);
			}
			await vault.set('docIds', [...this.#states.keys()]);
		} catch {
			// IndexedDB unavailable: state is rebuilt from the server on the next start.
		}
	}

	#updatePending() {
		let n = 0;
		for (const s of this.#states.values()) if (s.dirty) n++;
		this.pending = n;
	}

	// ---- account management -----------------------------------------------------

	async #verifyKey(api: SyncApi, token: string, accountId: string, keys: SyncKeys) {
		const doc = await api.getDoc(token, KEYCHECK_ID);
		if (!doc || !doc.blob) {
			await this.#writeKeycheck(api, token, accountId, keys, doc?.version ?? 0);
			return true;
		}
		try {
			const v = await decryptJson<{ check?: string }>(
				keys.enc,
				docAad(accountId, KEYCHECK_ID),
				doc.blob
			);
			return v?.check === KEYCHECK_VALUE;
		} catch (err) {
			if (err instanceof DecryptError) return false;
			throw err;
		}
	}

	async #writeKeycheck(
		api: SyncApi,
		token: string,
		accountId: string,
		keys: SyncKeys,
		version = 0
	) {
		const blob = await encryptJson(keys.enc, docAad(accountId, KEYCHECK_ID), {
			check: KEYCHECK_VALUE,
			createdAt: Date.now()
		});
		await api.putDoc(token, KEYCHECK_ID, version, { blob });
	}

	async #storeNew(creds: Credentials, serverUrl: string, deviceName: string, joining: boolean) {
		await this.#teardownLocal();
		let pristineProfileId: string | null = null;
		if (joining) {
			const profiles = $state.snapshot(user.profiles) as Profile[];
			if (isPristine(profiles, $state.snapshot(user.data) as ProfileData))
				pristineProfileId = profiles[0].id;
		}
		const cfg: SyncConfig = {
			serverUrl,
			accountId: creds.accountId,
			deviceId: creds.deviceId,
			deviceName,
			salt: creds.salt,
			kdf: creds.kdf,
			joining,
			pristineProfileId
		};
		await secrets.setToken(creds.token);
		await vault.set('config', cfg);
		if (user.settings.syncServerUrl !== serverUrl)
			await user.updateSettings({ syncServerUrl: serverUrl });
		return cfg;
	}

	async #saveKeys(keys: SyncKeys) {
		try {
			await vault.set('keys', keys);
		} catch {
			// Could not persist the CryptoKey: it stays in memory; the passphrase is asked next start.
		}
	}

	/** Checks that the url points at a PrismaStream sync server. */
	async checkServer(serverUrl: string): Promise<boolean> {
		const url = normalizeServerUrl(serverUrl);
		if (!url) return false;
		try {
			const r = await new SyncApi(url).health();
			return r.body?.service === 'prismastream-sync';
		} catch {
			return false;
		}
	}

	/** Creates a new sync account on `serverUrl`, protected by `passphrase`. */
	async createAccount(serverUrl: string, passphrase: string, deviceName = defaultDeviceName()) {
		const url = normalizeServerUrl(serverUrl);
		if (!url) throw this.#fail('invalidUrl');
		const api = new SyncApi(url);
		await this.#ensureServer(api);
		const creds = await this.#guard(() =>
			api.createAccount(deviceName, { alg: 'PBKDF2-SHA256', iterations: KDF_ITERATIONS })
		);
		const keys = await deriveKeys(passphrase, creds.salt, creds.kdf);
		await this.#guard(() => this.#writeKeycheck(api, creds.token, creds.accountId, keys));
		const cfg = await this.#storeNew(creds, url, deviceName, false);
		await this.#saveKeys(keys);
		await this.#activate(cfg, keys);
	}

	/** Joins an existing sync account with a pairing code. Returns false on a wrong passphrase. */
	async pairDevice(
		serverUrl: string,
		code: string,
		passphrase: string,
		deviceName = defaultDeviceName()
	): Promise<boolean> {
		const url = normalizeServerUrl(serverUrl);
		if (!url) throw this.#fail('invalidUrl');
		const api = new SyncApi(url);
		await this.#ensureServer(api);
		const creds = await this.#guard(() => api.pair(code, deviceName));
		const keys = await deriveKeys(passphrase, creds.salt, creds.kdf);
		const ok = await this.#guard(() => this.#verifyKey(api, creds.token, creds.accountId, keys));
		const cfg = await this.#storeNew(creds, url, deviceName, true);
		if (!ok) {
			this.error = 'wrongPassphrase';
			await this.#activate(cfg, null);
			return false;
		}
		await this.#saveKeys(keys);
		await this.#activate(cfg, keys);
		return true;
	}

	/** Re-enters the passphrase on a configured device whose key is not available. */
	async unlock(passphrase: string): Promise<boolean> {
		if (!this.#api || !this.#token || !this.#config) return false;
		const me = await this.#guard(() => this.#api!.me(this.#token!));
		const keys = await deriveKeys(passphrase, me.salt, me.kdf);
		const ok = await this.#guard(() =>
			this.#verifyKey(this.#api!, this.#token!, me.accountId, keys)
		);
		if (!ok) {
			this.error = 'wrongPassphrase';
			return false;
		}
		this.#keys = keys;
		await this.#saveKeys(keys);
		this.locked = false;
		this.status = 'idle';
		this.error = null;
		this.#startBackground();
		void this.syncNow();
		return true;
	}

	async createPairingCode(): Promise<{ code: string; expiresAt: number }> {
		this.#requireReady();
		return this.#guard(() => this.#api!.createPairingCode(this.#token!));
	}

	async listDevices(): Promise<DeviceInfo[]> {
		this.#requireReady();
		return this.#guard(() => this.#api!.devices(this.#token!));
	}

	async removeDevice(id: string): Promise<void> {
		this.#requireReady();
		if (id === this.deviceId) return this.disable('unlink');
		await this.#guard(() => this.#api!.removeDevice(this.#token!, id));
	}

	/**
	 * Turns sync off on this device. 'unlink' also revokes this device on the server;
	 * 'deleteAccount' wipes the whole sync account (all devices) from the server.
	 * Local profiles, favorites and settings are kept.
	 */
	async disable(mode: 'local' | 'unlink' | 'deleteAccount' = 'unlink'): Promise<void> {
		await this.#flushPush().catch(() => undefined);
		if (this.#api && this.#token) {
			if (mode === 'deleteAccount') await this.#guard(() => this.#api!.deleteAccount(this.#token!));
			else if (mode === 'unlink' && this.deviceId)
				await this.#api.removeDevice(this.#token, this.deviceId).catch(() => undefined);
		}
		await this.#teardownLocal();
	}

	async #teardownLocal() {
		this.#stopBackground();
		this.#unsubscribe();
		clearTimeout(this.#persistTimer);
		this.#persistIds.clear();
		this.#states.clear();
		this.#cursor = 0;
		this.#config = null;
		this.#token = null;
		this.#keys = null;
		this.#api = null;
		this.#loaded = false;
		this.#sourcesNeedFetch = false;
		try {
			await vault.clear();
		} catch {
			// ignore
		}
		await secrets.setToken(null).catch(() => undefined);
		await secrets.setProxyPrefix(null).catch(() => undefined);
		this.status = 'off';
		this.error = null;
		this.locked = false;
		this.pending = 0;
		this.lastSyncAt = null;
		this.accountId = null;
		this.deviceId = null;
		this.deviceName = '';
	}

	/**
	 * CORS proxy prefix for the web build (`https://host/v1/proxy/<proxyToken>?url=`), or null when
	 * sync is not configured. The proxy token only works for the proxy, never for the sync API.
	 */
	async getProxyPrefix(): Promise<string | null> {
		if (!this.#api || !this.#token) return null;
		const cached = await secrets.getProxyPrefix();
		if (cached) return cached;
		try {
			const r = await this.#api.proxyToken(this.#token);
			await secrets.setProxyPrefix(r.prefix);
			return r.prefix;
		} catch {
			return null;
		}
	}

	// ---- helpers ------------------------------------------------------------------

	#requireReady() {
		if (!this.#api || !this.#token) throw this.#fail('unauthorized');
	}

	async #ensureServer(api: SyncApi) {
		let ok = false;
		try {
			ok = (await api.health()).body?.service === 'prismastream-sync';
		} catch (err) {
			if (err instanceof SyncNetworkError) throw this.#fail('network');
		}
		if (!ok) throw this.#fail('notSyncServer');
	}

	/** Maps transport errors to SyncFailure with an i18n-able code. */
	async #guard<T>(fn: () => Promise<T>): Promise<T> {
		try {
			return await fn();
		} catch (err) {
			if (err instanceof SyncFailure) throw err;
			if (err instanceof SyncNetworkError) throw this.#fail('network');
			if (err instanceof SyncApiError) {
				const map: Record<string, SyncErrorCode> = {
					invalid_code: 'invalidCode',
					device_limit: 'deviceLimit',
					signup_disabled: 'signupDisabled',
					rate_limited: 'rateLimited',
					too_many_codes: 'rateLimited',
					unauthorized: 'unauthorized',
					quota_exceeded: 'quota'
				};
				throw this.#fail(map[err.code] ?? 'server');
			}
			throw this.#fail('unknown');
		}
	}

	#fail(code: SyncErrorCode): SyncFailure {
		return new SyncFailure(code);
	}
}

/** Error thrown by the public engine methods; `code` maps to `sync.error.<code>`. */
export class SyncFailure extends Error {
	code: SyncErrorCode;
	constructor(code: SyncErrorCode) {
		super(code);
		this.name = 'SyncFailure';
		this.code = code;
	}
}

export const syncEngine = new SyncEngine();
