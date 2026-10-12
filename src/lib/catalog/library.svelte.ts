/* eslint-disable svelte/prefer-svelte-reactivity -- request bookkeeping maps/sets are intentionally not reactive */
// The catalog library: one reactive façade over the CatalogProvider of the current mode.
//
//   local   no backend url or no account (or the server has no catalog API): demo + local
//           sources, merged on this device (catalog store), like before.
//   remote  backend url + account: everything comes from the API; the device keeps only a small
//           LRU cache plus the last home/meta responses. Local-mode caches are removed.
//
// Pages use `library.provider` (async, paginated) through `resource()`, plus a few reactive
// helpers: `channels`, `getChannel`, `nowNext`, `programmes`/`requestEpg` (EPG per visible
// window), `status`, `offline`, `version` (changes when the catalog changes).
import { untrack } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import type { Channel, ChannelCard, EpgProgramme, NowNext, TitleCard } from '#lib/types.ts';
import type { CatalogMeta } from '#lib/backend/types.ts';
import {
	BackendClient,
	BackendError,
	BackendOfflineError,
	isAbortError
} from '#lib/backend/client.ts';
import { DEFAULT_BACKEND_URL } from '#lib/backend/config.ts';
import { LruCache, idbLruStorage } from '#lib/backend/lru.ts';
import { catalog } from '#lib/stores/catalog.svelte.ts';
import { kids } from '#lib/stores/kids.svelte.ts';
import { user } from '#lib/stores/user.svelte.ts';
import { initSync, setSourcesSync, syncEngine } from '#lib/sync/index.ts';
import { normalizeServerUrl } from '#lib/sync/api.ts';
import { t } from '#lib/i18n/index.svelte.ts';
import { LocalProvider } from './local.ts';
import { RemoteProvider, type CacheEntry, type SnapshotStore } from './remote.ts';
import type { CatalogProvider } from './provider.ts';
import { LOCAL_MODE_DATABASES, deleteDatabases } from './storage.ts';
import { sourceName as localSourceName } from '#lib/sources/index.svelte.ts';
import { SAMPLE_SOURCE_NAMES } from '#lib/sample/meta.ts';

export type LibraryMode = 'local' | 'remote';
export type LibraryStatus = 'loading' | 'ready' | 'error';

const LRU_ITEMS = 300;
const LRU_BYTES = 5 * 1024 * 1024;
const META_POLL_MS = 5 * 60_000;
const META_POLL_BUILDING_MS = 5_000;
const EPG_BLOCK = 6 * 3_600_000;
const NOWNEXT_TTL = 10 * 60_000;
const NO_CATALOG_KEY = 'ps:backend:noCatalog';

function idbSnapshots(): SnapshotStore {
	type Idb = typeof import('idb-keyval');
	let p: Promise<{ m: Idb; s: ReturnType<Idb['createStore']> }> | null = null;
	const open = () =>
		(p ??= import('idb-keyval').then((m) => ({
			m,
			s: m.createStore('prismastream-remote', 'kv')
		})));
	const ok = () => typeof indexedDB !== 'undefined';
	return {
		async get<T>(key: string) {
			if (!ok()) return undefined;
			try {
				const { m, s } = await open();
				return (await m.get(key, s)) as T | undefined;
			} catch {
				return undefined;
			}
		},
		async set(key, value) {
			if (!ok()) return;
			try {
				const { m, s } = await open();
				await m.set(key, value, s);
			} catch {
				// quota / private mode
			}
		},
		async clear() {
			if (!ok()) return;
			try {
				const { m, s } = await open();
				await m.clear(s);
			} catch {
				// ignore
			}
		}
	};
}

function noCatalogFor(url: string): boolean {
	try {
		return localStorage.getItem(NO_CATALOG_KEY) === url;
	} catch {
		return false;
	}
}

function rememberNoCatalog(url: string | null) {
	try {
		if (url) localStorage.setItem(NO_CATALOG_KEY, url);
		else localStorage.removeItem(NO_CATALOG_KEY);
	} catch {
		// ignore
	}
}

/** "6 hour" blocks covering [from, to). */
function blocks(from: number, to: number): number[] {
	const out: number[] = [];
	for (let b = Math.floor(from / EPG_BLOCK) * EPG_BLOCK; b < to; b += EPG_BLOCK) out.push(b);
	return out;
}

const NONE: readonly EpgProgramme[] = Object.freeze([]);

class Library {
	/** Mode decided (user + sync initialised). */
	initialized = $state(false);
	#noCatalog = $state<string | null>(null);

	/** The backend of this device: the account's server, the advanced override or the build's. */
	backendUrl = $derived<string | null>(
		(syncEngine.configured && syncEngine.serverUrl) ||
			normalizeServerUrl(user.settings.syncServerUrl ?? '') ||
			DEFAULT_BACKEND_URL
	);
	hasAccount = $derived(syncEngine.configured);
	mode = $derived<LibraryMode>(
		this.initialized && this.backendUrl && this.hasAccount && this.#noCatalog !== this.backendUrl
			? 'remote'
			: 'local'
	);

	// ---- remote state ----------------------------------------------------------------
	#remoteStatus = $state<LibraryStatus>('loading');
	#remoteError = $state<string | null>(null);
	/** The device cannot reach the backend; cached data is shown. */
	offline = $state(false);
	meta = $state.raw<CatalogMeta | null>(null);
	#remoteVersion = $state(0);
	#remoteChannels = $state.raw<Channel[]>([]);
	#channelsKey = $state('');
	#channelsLoading = $state(false);
	#channelsError = $state<string | null>(null);
	#channelIndex = $derived(new Map(this.#remoteChannels.map((c) => [c.id, c])));

	readonly local = new LocalProvider();
	readonly client = new BackendClient({
		baseUrl: () => this.backendUrl,
		getToken: async () => {
			await syncEngine.whenReady();
			return syncEngine.authToken();
		},
		onReachability: (ok) => {
			this.offline = !ok;
		}
	});
	readonly remote = new RemoteProvider({
		client: this.client,
		cache: new LruCache<CacheEntry>({
			maxItems: LRU_ITEMS,
			maxBytes: LRU_BYTES,
			storage: idbLruStorage<CacheEntry>('prismastream-remote-lru')
		}),
		snapshots: idbSnapshots()
	});

	provider = $derived<CatalogProvider>(this.mode === 'remote' ? this.remote : this.local);

	status = $derived.by<LibraryStatus>(() => {
		if (!this.initialized) return 'loading';
		if (this.mode === 'remote') return this.#remoteStatus;
		const s = catalog.status;
		return s === 'ready' ? 'ready' : s === 'error' ? 'error' : 'loading';
	});
	error = $derived(
		this.mode === 'remote' ? (this.#remoteError ? t(this.#remoteError) : null) : catalog.error
	);
	refreshing = $derived(
		this.mode === 'remote' ? this.meta?.status === 'building' : catalog.refreshing
	);

	/** Changes whenever lists should be fetched again (catalog rebuilt, mode or kids switch). */
	version = $derived(
		!this.initialized
			? 'init'
			: this.mode === 'remote'
				? `r:${this.backendUrl}:${this.#remoteVersion}`
				: `l:${catalog.catalog.builtAt}:${catalog.titles.length}:${catalog.channels.length}`
	);

	counts = $derived.by(() => {
		if (this.mode === 'remote') {
			const c = this.meta?.counts;
			return {
				movies: c?.movies ?? 0,
				series: c?.series ?? 0,
				titles: (c?.movies ?? 0) + (c?.series ?? 0),
				channels: c?.channels ?? 0
			};
		}
		const movies = catalog.titles.filter((t) => t.kind === 'movie').length;
		return {
			movies,
			series: catalog.titles.length - movies,
			titles: catalog.titles.length,
			channels: catalog.channels.length
		};
	});

	/** The catalog has no titles and no channels at all (show the "add a source" state). */
	empty = $derived(
		this.status === 'ready' && this.counts.titles === 0 && this.counts.channels === 0
	);

	#initJob: Promise<void> | null = null;
	#modeApplied: string | null = null;
	#pollTimer: ReturnType<typeof setTimeout> | undefined;
	#cleanupRoot: (() => void) | null = null;

	/** Starts user, sync and the catalog in the right mode. Idempotent. */
	init(): Promise<void> {
		this.#initJob ??= (async () => {
			try {
				await user.init();
				await initSync();
				await syncEngine.whenReady();
			} catch {
				// Sync failures must not block the catalog.
			}
			const url = this.backendUrl;
			this.#noCatalog = url && noCatalogFor(url) ? url : null;
			this.initialized = true;
			this.#cleanupRoot = $effect.root(() => {
				$effect(() => {
					const key = `${this.mode}|${this.backendUrl}|${syncEngine.accountId}`;
					untrack(() => this.#applyMode(key));
				});
			});
		})();
		return this.#initJob;
	}

	#applyMode(key: string) {
		if (this.#modeApplied === key) return;
		const previous = this.#modeApplied;
		this.#modeApplied = key;
		clearTimeout(this.#pollTimer);
		this.#resetLive();
		this.#remoteChannels = [];
		this.#channelsKey = '';
		if (this.mode === 'local') {
			setSourcesSync(true);
			this.offline = false;
			this.meta = null;
			if (previous?.startsWith('remote')) void this.remote.clear();
			void catalog.init();
			return;
		}
		// Remote: no local catalog, no synced IPTV credentials, no local-mode caches.
		setSourcesSync(false);
		if (catalog.status !== 'idle') catalog.reset();
		void deleteDatabases(LOCAL_MODE_DATABASES);
		this.#remoteStatus = 'loading';
		this.#remoteError = null;
		this.#remoteVersion++;
		void this.#startRemote();
	}

	async #startRemote() {
		await this.remote.prime();
		const cached = await this.remote.cachedMeta();
		if (cached && !this.meta) {
			this.meta = cached;
			this.#remoteStatus = 'ready';
		}
		await this.#pollMeta();
	}

	async #pollMeta() {
		clearTimeout(this.#pollTimer);
		if (this.mode !== 'remote') return;
		let next = META_POLL_MS;
		try {
			const { meta, fromCache } = await this.remote.meta();
			if (this.mode !== 'remote') return;
			const prev = this.meta;
			this.meta = meta;
			this.#remoteStatus = 'ready';
			this.#remoteError = null;
			if (!fromCache && (!prev || prev.builtAt !== meta.builtAt)) this.#remoteVersion++;
			if (meta.status === 'building' || meta.status === 'empty') next = META_POLL_BUILDING_MS;
			if (this.#noCatalog) {
				this.#noCatalog = null;
				rememberNoCatalog(null);
			}
		} catch (err) {
			if (err instanceof BackendError && err.status === 404) {
				// A sync-only server without catalog API: stay in local mode for this url.
				const url = this.backendUrl;
				if (url) rememberNoCatalog(url);
				this.#noCatalog = url;
				return;
			}
			if (!this.meta) {
				this.#remoteStatus = 'error';
				this.#remoteError = errorText(err);
			}
			next = err instanceof BackendOfflineError ? 30_000 : 60_000;
		}
		if (this.meta?.status === 'building') next = Math.min(next, META_POLL_BUILDING_MS);
		this.#pollTimer = setTimeout(() => void this.#pollMeta(), next);
	}

	/** Re-check the backend now (focus, online event, after adding a source). */
	poke() {
		if (this.mode === 'remote') void this.#pollMeta();
	}

	/** Refresh the catalog (local: reload sources; remote: ask the server to rebuild). */
	async refresh(opts: { force?: boolean } = {}): Promise<void> {
		if (this.mode === 'local') return catalog.refresh(opts);
		try {
			await this.client.refreshCatalog({ force: opts.force });
		} finally {
			await this.#pollMeta();
		}
	}

	/** Remove every catalog cache of this device (both modes). Personal data is kept. */
	async clearLocalCache(): Promise<void> {
		await this.remote.clear();
		this.#resetLive();
		await deleteDatabases(LOCAL_MODE_DATABASES);
		if (this.mode === 'remote') {
			this.#remoteVersion++;
			void this.#pollMeta();
		}
	}

	/** Remote cache use (items and approximate bytes). */
	get cacheUse(): { items: number; bytes: number } {
		return { items: this.remote.cache.size, bytes: this.remote.cache.bytes };
	}

	/** Kind of a title when it is known without a request (nav highlighting). */
	peekKind(id: string): 'movie' | 'series' | undefined {
		if (this.mode === 'local') return catalog.getTitle(id)?.kind;
		return this.remote.peekCard(id)?.kind;
	}

	peekCard(id: string): TitleCard | undefined {
		return this.mode === 'local' ? catalog.getTitle(id) : this.remote.peekCard(id);
	}

	// ---- names ---------------------------------------------------------------------------

	#sourceNames = new SvelteMap<string, string>();
	#sourceNamesKey = '';

	/** Display name of a source (remote: from /v1/sources, loaded once per catalog version). */
	sourceName(id: string): string {
		if (this.mode === 'local') return localSourceName(id);
		const key = this.version;
		if (this.#sourceNamesKey !== key) {
			this.#sourceNamesKey = key;
			queueMicrotask(() => {
				this.client
					.sources()
					.then((list) => {
						for (const s of list) if (s?.id) this.#sourceNames.set(s.id, s.name || s.id);
					})
					.catch(() => (this.#sourceNamesKey = ''));
			});
		}
		return this.#sourceNames.get(id) ?? SAMPLE_SOURCE_NAMES[id] ?? id;
	}

	/** The `genre` filter value for a genre name (remote: the server slug). */
	genreSlug(name: string): string {
		if (this.mode === 'local') return name;
		return this.meta?.genres.find((g) => g.name === name || g.slug === name)?.slug ?? name;
	}

	// ---- channels ----------------------------------------------------------------------

	/** Channels of this profile (kids filter applied). Call ensureChannels() first in remote. */
	get channels(): Channel[] {
		if (this.mode === 'local') return kids.visibleChannels;
		return kids.filterChannels(this.#remoteChannels);
	}

	get channelsLoading(): boolean {
		if (this.mode === 'local') return this.status === 'loading' && !catalog.channels.length;
		const wanted = `${this.version}|${kids.active}`;
		return (
			(this.#channelsLoading || (this.#channelsKey !== wanted && !this.#channelsError)) &&
			!this.#remoteChannels.length
		);
	}

	get channelsError(): string | null {
		if (this.mode === 'local') return catalog.status === 'error' ? catalog.error : null;
		return this.#channelsError ? t(this.#channelsError) : null;
	}

	getChannel(id: string): Channel | undefined {
		if (this.mode === 'local') return catalog.getChannel(id);
		return this.#channelIndex.get(id);
	}

	/** Load the channel list (remote; once per catalog version and kids mode). */
	ensureChannels(force = false): void {
		if (this.mode !== 'remote') return;
		const key = `${this.version}|${kids.active}`;
		if (this.#channelsKey === key && !force) return;
		this.#channelsKey = key;
		this.#channelsLoading = true;
		this.#channelsError = null;
		this.remote
			.channels({ kids: kids.active })
			.then((list) => {
				if (this.#channelsKey === key) this.#remoteChannels = list;
			})
			.catch((err: unknown) => {
				if (this.#channelsKey !== key) return;
				this.#channelsError = errorText(err);
			})
			.finally(() => {
				if (this.#channelsKey === key) this.#channelsLoading = false;
			});
	}

	// ---- EPG (remote: per visible window, batched) ----------------------------------------

	#epg = new SvelteMap<string, readonly EpgProgramme[]>();
	#epgLoaded = new Map<string, Set<number>>();
	#epgQueue = new Map<number, Set<string>>();
	#epgTimer: ReturnType<typeof setTimeout> | undefined;
	#nn = new SvelteMap<string, NowNext & { at: number }>();
	#nnQueue = new Set<string>();
	#nnTimer: ReturnType<typeof setTimeout> | undefined;
	#nnPending = new Set<string>();

	#resetLive() {
		clearTimeout(this.#epgTimer);
		clearTimeout(this.#nnTimer);
		this.#epg.clear();
		this.#epgLoaded.clear();
		this.#epgQueue.clear();
		this.#nn.clear();
		this.#nnQueue.clear();
		this.#nnPending.clear();
	}

	/** Programmes of a channel (remote: what was loaded so far, sorted by start). */
	programmes(channel: Pick<Channel, 'id' | 'epgId'>): readonly EpgProgramme[] {
		if (this.mode === 'local') return channel.epgId ? (catalog.epg[channel.epgId] ?? NONE) : NONE;
		return channel.epgId ? (this.#epg.get(channel.epgId) ?? NONE) : NONE;
	}

	/** Ask for the guide of a channel in [from, to) (remote only; deduplicated per 6 h block). */
	requestEpg(channel: Pick<Channel, 'epgId'>, from?: number, to?: number) {
		if (this.mode !== 'remote' || !channel.epgId) return;
		const now = Date.now();
		const f = from ?? now - 2 * 3_600_000;
		const t = to ?? now + 10 * 3_600_000;
		const loaded = this.#epgLoaded.get(channel.epgId) ?? new Set<number>();
		this.#epgLoaded.set(channel.epgId, loaded);
		let queued = false;
		for (const b of blocks(f, t)) {
			if (loaded.has(b)) continue;
			loaded.add(b);
			let set = this.#epgQueue.get(b);
			if (!set) this.#epgQueue.set(b, (set = new Set()));
			set.add(channel.epgId);
			queued = true;
		}
		if (queued && !this.#epgTimer) this.#epgTimer = setTimeout(() => this.#flushEpg(), 60);
	}

	async #flushEpg() {
		this.#epgTimer = undefined;
		const queue = [...this.#epgQueue.entries()];
		this.#epgQueue.clear();
		const version = this.version;
		for (const [block, idSet] of queue) {
			const ids = [...idSet];
			try {
				const r = await this.remote.epg(ids, block, block + EPG_BLOCK);
				if (version !== this.version) return;
				for (const id of ids) {
					const incoming = r[id] ?? [];
					if (!incoming.length) continue;
					const byStart = new Map<number, EpgProgramme>();
					for (const p of this.#epg.get(id) ?? []) byStart.set(p.start, p);
					for (const p of incoming) byStart.set(p.start, p);
					this.#epg.set(
						id,
						[...byStart.values()].sort((a, b) => a.start - b.start)
					);
				}
			} catch (err) {
				if (isAbortError(err)) return;
				// Allow a retry of these blocks later.
				for (const id of ids) this.#epgLoaded.get(id)?.delete(block);
			}
		}
	}

	/** Current and next programme (local: catalog EPG; remote: loaded EPG, else /nownext). */
	nowNext(channel: Pick<Channel, 'id' | 'epgId'> | ChannelCard, at = Date.now()): NowNext {
		if (this.mode === 'local') {
			const list = this.programmes(channel);
			return nowNextIn(list, at);
		}
		const list = this.programmes(channel);
		if (list.length) {
			const nn = nowNextIn(list, at);
			if (nn.now || nn.next) return nn;
		}
		const cached = this.#nn.get(channel.id);
		const stale =
			!cached || Date.now() - cached.at > NOWNEXT_TTL || (cached.now && cached.now.stop <= at);
		if (stale) this.#queueNowNext(channel.id);
		if (!cached) return {};
		if (cached.now && cached.now.stop <= at)
			return cached.next && cached.next.start <= at ? { now: cached.next } : { next: cached.next };
		return { now: cached.now, next: cached.next };
	}

	#queueNowNext(id: string) {
		if (this.#nnPending.has(id)) return;
		this.#nnPending.add(id);
		this.#nnQueue.add(id);
		if (!this.#nnTimer) this.#nnTimer = setTimeout(() => void this.#flushNowNext(), 80);
	}

	async #flushNowNext() {
		this.#nnTimer = undefined;
		const ids = [...this.#nnQueue];
		this.#nnQueue.clear();
		if (!ids.length || this.mode !== 'remote') return;
		try {
			const r = await this.remote.nowNext(ids);
			const at = Date.now();
			for (const id of ids) {
				const v = r[id];
				this.#nn.set(id, { now: v?.now, next: v?.next, at });
			}
		} catch {
			// Try again on the next read after the TTL.
			const at = Date.now() - NOWNEXT_TTL + 60_000;
			for (const id of ids) if (!this.#nn.has(id)) this.#nn.set(id, { at });
		} finally {
			for (const id of ids) this.#nnPending.delete(id);
		}
	}

	/** For tests and teardown. */
	destroy() {
		clearTimeout(this.#pollTimer);
		this.#cleanupRoot?.();
	}
}

/** now/next in a list sorted by start. */
export function nowNextIn(list: readonly EpgProgramme[], at: number): NowNext {
	if (!list.length) return {};
	let lo = 0;
	let hi = list.length - 1;
	let idx = -1;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		if (list[mid].start <= at) {
			idx = mid;
			lo = mid + 1;
		} else hi = mid - 1;
	}
	if (idx !== -1 && list[idx].stop > at) return { now: list[idx], next: list[idx + 1] };
	return { next: list[idx + 1] };
}

/** A user-facing message key for a backend failure (see cloud.* messages). */
export function errorText(err: unknown): string {
	if (err instanceof BackendOfflineError) return 'cloud.error.offline';
	if (err instanceof BackendError) {
		if (err.status === 401) return 'cloud.error.unauthorized';
		if (err.status === 429) return 'cloud.error.rateLimited';
		if (err.status >= 500) return 'cloud.error.server';
		return 'cloud.error.request';
	}
	return 'cloud.error.unknown';
}

export const library = new Library();
