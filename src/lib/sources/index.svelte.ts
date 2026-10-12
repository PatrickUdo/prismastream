// Sources store: the user's IPTV accounts (Xtream Codes, M3U) plus the built-in demo
// library, loading/caching of their raw catalogs, and lazy series episodes.
//
// Contract (used by the catalog store and the UI):
//   sources.list                         reactive SourceEntry[] (incl. the sample source)
//   sources.progress                     per-source load progress (reactive)
//   loadRawCatalogs({ force? })          every enabled source in parallel -> RawCatalog[]
//   loadSeriesEpisodes(srcId, provId)    lazy episodes of a series
//   addSource / updateSource / removeSource / testSource / refreshSource / sourceName
//
// Caching: IndexedDB (idb-keyval) per source. Catalog 12 h, EPG 6 h, series info 12 h.
// Without `force` a fresh cache is used; otherwise the source is fetched again. A failing
// source never blocks the others: it gets `lastError` and, if available, its stale cache
// is returned.
//
// Security: passwords and credential-bearing urls live in secure storage (credentials.ts),
// never in the persisted list. Cached catalogs have their credentials masked (mask.ts)
// and are re-hydrated on read with the current secret.
import { Capacitor } from '@capacitor/core';
import type {
	EpgProgramme,
	M3USource,
	RawCatalog,
	RawChannel,
	RawEpisode,
	RawMovie,
	RawSeries,
	SourceConfig,
	XtreamSource
} from '#lib/types.ts';
import { sampleCatalog, SAMPLE_SOURCE, SAMPLE_SOURCE_NAMES } from '#lib/sample/index.ts';
import { loadJSON, saveJSON, uid } from '#lib/storage.ts';
import { t } from '#lib/i18n/index.svelte.ts';
import { httpGet, HttpError, toHttpError, type HttpErrorCode } from '#lib/providers/http.ts';
import { looksLikeM3U, parseM3U, parseM3UStream, type M3UResult } from '#lib/providers/m3u.ts';
import { parseXmltv } from '#lib/providers/xmltv.ts';
import {
	loadXtreamCatalog,
	mapSeriesInfo,
	normalizeServerUrl,
	parseXtreamUrl,
	XtreamClient,
	type XtreamAccount
} from '#lib/providers/xtream.ts';
import { redactText, redactUrl, secretsFromUrl, urlHasSecrets } from '#lib/providers/redact.ts';
import { isHttpUrl } from '#lib/providers/util.ts';
import { credentials, type SourceSecret } from '#lib/sources/credentials.ts';
import {
	cacheClear,
	cacheGet,
	cacheKey,
	cacheSet,
	fileDel,
	fileGet,
	fileSet,
	isFresh,
	TTL
} from '#lib/sources/cache.ts';
import {
	createMasker,
	mapCatalogUrls,
	maskEpisodes,
	unmaskEpisodes,
	type Masker
} from '#lib/sources/mask.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SourceStats {
	movies: number;
	series: number;
	channels: number;
	programmes: number;
}

/** Extra (non-secret) fields kept next to a SourceConfig. */
export interface SourceExtras {
	/** CORS proxy for this source (browser only), prefix style or with `{url}`. */
	proxyUrl?: string;
	stats?: SourceStats;
	account?: Pick<
		XtreamAccount,
		'status' | 'expiresAt' | 'maxConnections' | 'activeConnections' | 'isTrial'
	>;
	/** Non-fatal problem of the last load (e.g. EPG failed, one list missing). */
	lastWarning?: string;
	/** M3U loaded from a local file (contents in IndexedDB); playlistUrl is `local:<name>`. */
	localFileName?: string;
	/** Last successful EPG download (epoch ms). */
	epgSyncAt?: number;
}

export type SourceEntry = SourceConfig & SourceExtras;

export type SourceInput =
	| {
			type: 'xtream';
			name?: string;
			serverUrl: string;
			username: string;
			password: string;
			epgUrl?: string;
			proxyUrl?: string;
			enabled?: boolean;
	  }
	| {
			type: 'm3u';
			name?: string;
			/** Remote playlist url. Either this or `file`. */
			playlistUrl?: string;
			/** Local playlist file contents. */
			file?: { name: string; text: string };
			epgUrl?: string;
			proxyUrl?: string;
			enabled?: boolean;
	  };

export interface SourcePatch {
	name?: string;
	enabled?: boolean;
	proxyUrl?: string;
	serverUrl?: string;
	username?: string;
	/** New password; empty/undefined keeps the stored one. */
	password?: string;
	playlistUrl?: string;
	file?: { name: string; text: string };
	/** Empty string removes the override. */
	epgUrl?: string;
}

export type LoadPhase =
	| 'queued'
	| 'auth'
	| 'download'
	| 'parse'
	| 'movies'
	| 'series'
	| 'live'
	| 'epg'
	| 'cache'
	| 'done'
	| 'error';

export interface SourceProgress {
	phase: LoadPhase;
	/** 0..1, or -1 when unknown. */
	ratio: number;
	/** Bytes downloaded in the current phase (playlist / EPG). */
	bytes?: number;
}

export type TestResult =
	| {
			ok: true;
			movies: number;
			series: number;
			channels: number;
			/** Epoch ms; undefined = unlimited or unknown. */
			expiresAt?: number;
			status?: string;
			maxConnections?: number;
			activeConnections?: number;
			/** EPG url announced in an M3U header, masked. */
			epgSuggestion?: string;
			warnings: string[];
	  }
	| { ok: false; code: HttpErrorCode | 'config'; message: string };

const native = Capacitor.isNativePlatform();
const EPG_PAST = 6 * 3600_000;
const EPG_FUTURE = 48 * 3600_000;

// ---------------------------------------------------------------------------
// Change listeners (used by the sync module). Fired by the public mutators only:
// addSource, updateSource, removeSource and setProxyUrl, never by applySynced or by
// loading (stats, errors), so applying synced data does not echo back.
// ---------------------------------------------------------------------------

// eslint-disable-next-line svelte/prefer-svelte-reactivity -- listener registry, not UI state
const changeListeners = new Set<() => void>();

function emitChange(): void {
	for (const cb of changeListeners) {
		try {
			cb();
		} catch (err) {
			console.warn('[sources] onChange listener failed', err);
		}
	}
}

/** Subscribe to user-driven changes of the source list or secrets. Returns an unsubscribe. */
export function onChange(cb: () => void): () => void {
	changeListeners.add(cb);
	return () => {
		changeListeners.delete(cb);
	};
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

class SourcesStore {
	list = $state<SourceEntry[]>([{ ...SAMPLE_SOURCE }]);
	progress = $state<Record<string, SourceProgress>>({});
	/** Global CORS proxy for the browser (per-source proxyUrl wins). */
	proxyUrl = $state('');
	/** True on iOS/Android (native HTTP, no CORS, no proxy needed). */
	readonly native = native;
	readonly ready: Promise<void>;

	busy = $derived(
		Object.values(this.progress).some((p) => p.phase !== 'done' && p.phase !== 'error')
	);

	constructor() {
		this.ready = typeof window === 'undefined' ? Promise.resolve() : this.#restore();
	}

	async #restore() {
		const stored = await loadJSON<SourceEntry[]>('sources', []);
		this.proxyUrl = await loadJSON<string>('sources.proxy', '');
		const list: SourceEntry[] = [];
		let sample: SourceEntry | undefined;
		for (const s of Array.isArray(stored) ? stored : []) {
			if (!s || typeof s !== 'object' || !s.id || !s.type) continue;
			if (s.type === 'sample')
				sample = { ...SAMPLE_SOURCE, enabled: s.enabled, stats: s.stats, lastSyncAt: s.lastSyncAt };
			else list.push(s);
		}
		this.list = [sample ?? { ...SAMPLE_SOURCE }, ...list];
	}

	get(id: string): SourceEntry | undefined {
		return this.list.find((s) => s.id === id);
	}

	/** Shallow-merge a patch into an entry and persist. */
	patch(id: string, patch: Partial<SourceExtras & SourceConfig>): void {
		const i = this.list.findIndex((s) => s.id === id);
		if (i === -1) return;
		const next = { ...$state.snapshot(this.list[i]), ...patch } as SourceEntry;
		for (const k of Object.keys(next) as (keyof SourceEntry)[])
			if (next[k] === undefined) delete next[k];
		this.list[i] = next;
		this.persist();
	}

	persist(): void {
		void saveJSON('sources', $state.snapshot(this.list));
	}

	setProgress(id: string, phase: LoadPhase, ratio = -1, bytes?: number): void {
		this.progress[id] = { phase, ratio, bytes };
	}

	async setProxyUrl(url: string): Promise<void> {
		this.proxyUrl = url.trim();
		await saveJSON('sources.proxy', this.proxyUrl);
		emitChange();
	}
}

export const sources = new SourcesStore();

/** Display name of a source (falls back to the id). */
export function sourceName(id: string): string {
	return sources.get(id)?.name ?? SAMPLE_SOURCE_NAMES[id] ?? id;
}

/** Map of sourceId → name, handy for buildCatalog({ sourceNames }). */
export function sourceNames(): Record<string, string> {
	return { ...SAMPLE_SOURCE_NAMES, ...Object.fromEntries(sources.list.map((s) => [s.id, s.name])) };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * CORS proxy for a request (browser only): per-source proxy, else the global one, else
 * the sync server's proxy prefix when sync is configured (fetched lazily, never stored
 * in the source list). Lazy import: #lib/sync imports this module.
 */
async function proxyFor(src: SourceExtras): Promise<string | undefined> {
	if (native) return undefined;
	const own = src.proxyUrl?.trim() || sources.proxyUrl.trim();
	if (own) return own;
	try {
		const { getSyncProxyPrefix } = await import('#lib/sync/index.ts');
		return (await getSyncProxyPrefix()) || undefined;
	} catch {
		return undefined;
	}
}

/** Human readable, localised, credential-free error message. */
export function describeError(err: unknown, secrets: string[] = []): string {
	const e = toHttpError(err, secrets);
	switch (e.code) {
		case 'auth':
			return t('sources.err.auth');
		case 'expired':
			return t('sources.err.expired');
		case 'timeout':
			return t('sources.err.timeout');
		case 'unreachable':
			return native ? t('sources.err.unreachable') : t('sources.err.unreachableWeb');
		case 'http':
			return t('sources.err.http', { status: e.status ?? '?' });
		case 'aborted':
			return t('sources.err.aborted');
		default:
			return t('sources.err.invalid', { detail: redactText(e.message, secrets).slice(0, 160) });
	}
}

function xtreamCreds(src: XtreamSource, secret: SourceSecret) {
	return { serverUrl: src.serverUrl, username: src.username, password: secret.password ?? '' };
}

/** Secrets of a source in a STABLE order (placeholder indices depend on it). */
function secretList(src: SourceEntry, secret: SourceSecret): string[] {
	if (src.type === 'xtream') return [secret.password ?? '', src.username];
	if (src.type === 'm3u') {
		const out = secret.playlistUrl ? secretsFromUrl(secret.playlistUrl) : [];
		return out.sort((a, b) => b.length - a.length || (a < b ? -1 : 1));
	}
	return [];
}

function playlistUrlOf(src: M3USource, secret: SourceSecret): string {
	return secret.playlistUrl ?? src.playlistUrl;
}

function epgUrlOf(src: SourceEntry, secret: SourceSecret): string | undefined {
	if (src.type === 'sample') return undefined;
	return secret.epgUrl ?? src.epgUrl ?? undefined;
}

function statsOf(c: Pick<RawCatalog, 'movies' | 'series' | 'channels' | 'epg'>): SourceStats {
	return {
		movies: c.movies.length,
		series: c.series.length,
		channels: c.channels.length,
		programmes: c.epg.length
	};
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

interface FetchedCatalog {
	movies: RawMovie[];
	series: RawSeries[];
	channels: RawChannel[];
	/** EPG urls suggested by an M3U header. */
	epgUrls: string[];
	account?: XtreamAccount;
	warnings: string[];
}

async function fetchM3U(
	src: M3USource & SourceExtras,
	secret: SourceSecret,
	onBytes?: (n: number) => void
): Promise<M3UResult> {
	if (src.localFileName || src.playlistUrl.startsWith('local:')) {
		const text = await fileGet(src.id);
		if (text == null)
			throw new HttpError('invalid', 'Local playlist file is missing; choose the file again');
		return parseM3U(text, { sourceId: src.id });
	}
	const url = playlistUrlOf(src, secret);
	const secrets = secretsFromUrl(url);
	const res = await httpGet(url, { proxyUrl: await proxyFor(src), secrets, timeoutMs: 45_000 });
	let result: M3UResult;
	if (res.body) result = await parseM3UStream(res.body, { sourceId: src.id, onBytes });
	else result = parseM3U(await res.text(), { sourceId: src.id });
	if (!result.entryCount) {
		throw new HttpError('invalid', 'The playlist contains no entries (is this an M3U file?)');
	}
	return result;
}

async function fetchCatalog(src: SourceEntry, secret: SourceSecret): Promise<FetchedCatalog> {
	if (src.type === 'xtream') {
		if (!secret.password) throw new HttpError('auth', 'No password stored');
		const client = new XtreamClient(xtreamCreds(src, secret), { proxyUrl: await proxyFor(src) });
		const r = await loadXtreamCatalog(client, src.id, (step, done, total) => {
			sources.setProgress(src.id, step, done / total);
		});
		return {
			movies: r.movies,
			series: r.series,
			channels: r.channels,
			epgUrls: [],
			account: r.account,
			warnings: r.warnings
		};
	}
	if (src.type === 'm3u') {
		sources.setProgress(src.id, 'download', -1);
		const r = await fetchM3U(src, secret, (n) => sources.setProgress(src.id, 'download', -1, n));
		return {
			movies: r.movies,
			series: r.series,
			channels: r.channels,
			epgUrls: r.epgUrls,
			warnings: []
		};
	}
	const s = sampleCatalog();
	return { movies: s.movies, series: s.series, channels: s.channels, epgUrls: [], warnings: [] };
}

async function fetchEpg(
	src: SourceEntry,
	secret: SourceSecret,
	channels: RawChannel[],
	headerUrls: string[]
): Promise<EpgProgramme[]> {
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local, non-reactive
	const ids = new Set<string>();
	for (const c of channels) if (c.tvgId) ids.add(c.tvgId);
	if (!ids.size) return [];
	const candidates: string[] = [];
	const override = epgUrlOf(src, secret);
	if (override) candidates.push(override);
	else if (src.type === 'xtream')
		candidates.push(new XtreamClient(xtreamCreds(src, secret)).xmltvUrl());
	else candidates.push(...headerUrls);
	if (!candidates.length) return [];

	const secrets = [secret.password, src.type === 'xtream' ? src.username : undefined].filter(
		(x): x is string => !!x
	);
	let lastErr: unknown;
	for (const url of candidates) {
		const ctrl = new AbortController();
		const watchdog = setTimeout(() => ctrl.abort(), 5 * 60_000);
		try {
			sources.setProgress(src.id, 'epg', -1);
			const res = await httpGet(url, {
				proxyUrl: await proxyFor(src),
				secrets: [...secrets, ...secretsFromUrl(url)],
				timeoutMs: 60_000,
				retries: 1,
				// May be gzip: on native CapacitorHttp must return it as (base64) binary.
				responseType: 'binary',
				signal: ctrl.signal
			});
			const now = Date.now();
			const body = res.body ?? new Uint8Array(await res.arrayBuffer());
			const r = await parseXmltv(body, {
				from: now - EPG_PAST,
				to: now + EPG_FUTURE,
				channelIds: ids,
				signal: ctrl.signal,
				onBytes: (n) => sources.setProgress(src.id, 'epg', -1, n)
			});
			return r.programmes;
		} catch (err) {
			lastErr = err;
		} finally {
			clearTimeout(watchdog);
		}
	}
	throw lastErr;
}

// ---------------------------------------------------------------------------
// Loading with cache
// ---------------------------------------------------------------------------

interface CachedCatalog {
	movies: RawMovie[];
	series: RawSeries[];
	channels: RawChannel[];
	epgUrls: string[];
}

// eslint-disable-next-line svelte/prefer-svelte-reactivity -- module cache, non-reactive
const inflight = new Map<string, Promise<RawCatalog | null>>();

async function maskerFor(
	src: SourceEntry
): Promise<{ secret: SourceSecret; masker: Masker; secrets: string[] }> {
	const secret = src.type === 'sample' ? {} : await credentials.load(src.id);
	const secrets = secretList(src, secret);
	return { secret, masker: createMasker(secrets), secrets: secrets.filter(Boolean) };
}

async function loadOne(src: SourceEntry, force: boolean): Promise<RawCatalog | null> {
	const key = src.id;
	const running = inflight.get(key);
	if (running && !force) return running;
	const p = doLoadOne(src, force).finally(() => {
		if (inflight.get(key) === p) inflight.delete(key);
	});
	inflight.set(key, p);
	return p;
}

async function doLoadOne(src: SourceEntry, force: boolean): Promise<RawCatalog | null> {
	if (src.type === 'sample') {
		const cat = sampleCatalog();
		sources.patch(src.id, { stats: statsOf(cat), lastSyncAt: cat.fetchedAt, lastError: undefined });
		sources.setProgress(src.id, 'done', 1);
		return cat;
	}
	sources.setProgress(src.id, 'queued', 0);
	const { secret, masker, secrets } = await maskerFor(src);
	const now = Date.now();
	const catKey = cacheKey(src.id, 'catalog');
	const epgKey = cacheKey(src.id, 'epg');
	const cached = await cacheGet<CachedCatalog>(catKey);
	let base: CachedCatalog | undefined;
	let fetchedAt = cached?.savedAt ?? now;
	const patch: Partial<SourceEntry> = {};
	const warnings: string[] = [];

	try {
		if (!force && cached && isFresh(cached, TTL.catalog, now)) {
			sources.setProgress(src.id, 'cache', -1);
			base = mapCatalogUrls(cached.data, masker.unmask);
		} else {
			const fetched = await fetchCatalog(src, secret);
			base = {
				movies: fetched.movies,
				series: fetched.series,
				channels: fetched.channels,
				epgUrls: fetched.epgUrls
			};
			fetchedAt = Date.now();
			warnings.push(...fetched.warnings);
			sources.setProgress(src.id, 'cache', -1);
			await cacheSet(catKey, {
				...mapCatalogUrls(base, masker.mask),
				epgUrls: base.epgUrls.map(masker.mask)
			});
			// Lazy series info depends on the catalog: drop it on a forced refresh.
			if (force) await cacheClear(src.id, ['series']);
			patch.lastSyncAt = fetchedAt;
			// Only a successful fetch clears an earlier error; a cache hit keeps it visible.
			patch.lastError = undefined;
			if (fetched.account) {
				const a = fetched.account;
				patch.account = {
					status: a.status,
					expiresAt: a.expiresAt,
					maxConnections: a.maxConnections,
					activeConnections: a.activeConnections,
					isTrial: a.isTrial
				};
			}
		}
	} catch (err) {
		const msg = describeError(err, secrets);
		sources.setProgress(src.id, 'error', 0);
		if (!cached) {
			sources.patch(src.id, { lastError: msg });
			return null;
		}
		// Use the stale cache so the library keeps working offline.
		patch.lastError = msg;
		base = mapCatalogUrls(cached.data, masker.unmask);
	}

	// EPG (separate TTL; failures are warnings, not errors)
	let epg: EpgProgramme[] = [];
	const cachedEpg = await cacheGet<EpgProgramme[]>(epgKey);
	const lower = Date.now() - EPG_PAST;
	if (!force && cachedEpg && isFresh(cachedEpg, TTL.epg)) {
		epg = cachedEpg.data.filter((p) => p.stop > lower);
	} else if (patch.lastError === undefined) {
		try {
			epg = await fetchEpg(src, secret, base.channels, (base.epgUrls ?? []).map(masker.unmask));
			if (epg.length) {
				await cacheSet(epgKey, epg);
				patch.epgSyncAt = Date.now();
			}
		} catch (err) {
			warnings.push(t('sources.warn.epg', { detail: describeError(err, secrets) }));
			if (cachedEpg) epg = cachedEpg.data.filter((p) => p.stop > lower);
		}
	} else if (cachedEpg) {
		epg = cachedEpg.data.filter((p) => p.stop > lower);
	}

	const cat: RawCatalog = {
		sourceId: src.id,
		movies: base.movies,
		series: base.series,
		channels: base.channels,
		epg,
		fetchedAt
	};
	patch.stats = statsOf(cat);
	patch.lastWarning = warnings.length
		? redactText(warnings.join(' · '), secrets).slice(0, 400)
		: undefined;
	sources.patch(src.id, patch);
	sources.setProgress(src.id, patch.lastError ? 'error' : 'done', 1);
	return cat;
}

/** Load every enabled source in parallel. Broken sources are skipped (see lastError). */
export async function loadRawCatalogs(opts: { force?: boolean } = {}): Promise<RawCatalog[]> {
	await sources.ready;
	const enabled = sources.list
		.filter((s) => s.enabled)
		.map((s) => $state.snapshot(s) as SourceEntry);
	const results = await Promise.all(
		enabled.map((s) =>
			loadOne(s, !!opts.force).catch((err) => {
				sources.patch(s.id, { lastError: describeError(err) });
				sources.setProgress(s.id, 'error', 0);
				return null;
			})
		)
	);
	return results.filter((r): r is RawCatalog => !!r);
}

/** Force-reload one source (catalog + EPG). Call catalog.refresh() afterwards. */
export async function refreshSource(id: string): Promise<RawCatalog | null> {
	await sources.ready;
	const src = sources.get(id);
	if (!src) return null;
	return loadOne($state.snapshot(src) as SourceEntry, true);
}

/** Series metadata and episodes (Xtream: get_series_info, cached 12 h). */
export async function loadSeriesInfo(
	sourceId: string,
	providerId: string
): Promise<{ info: Partial<RawSeries>; episodes: RawEpisode[] }> {
	await sources.ready;
	const src = sources.get(sourceId);
	if (!src) return { info: {}, episodes: [] };
	if (src.type === 'sample') {
		return {
			info: {},
			episodes: sampleCatalog().series.find((s) => s.providerId === providerId)?.episodes ?? []
		};
	}
	const snap = $state.snapshot(src) as SourceEntry;
	if (snap.type === 'm3u') {
		const { masker } = await maskerFor(snap);
		const cached = await cacheGet<CachedCatalog>(cacheKey(snap.id, 'catalog'));
		const series = cached ? cached.data.series : ((await loadOne(snap, false))?.series ?? []);
		const s = series.find((x) => x.providerId === providerId);
		return {
			info: {},
			episodes: cached ? unmaskEpisodes(s?.episodes ?? [], masker) : (s?.episodes ?? [])
		};
	}
	if (snap.type !== 'xtream') return { info: {}, episodes: [] };
	const { secret, masker, secrets } = await maskerFor(snap);
	const key = cacheKey(snap.id, 'series', providerId);
	const cached = await cacheGet<{ info: Partial<RawSeries>; episodes: RawEpisode[] }>(key);
	if (cached && isFresh(cached, TTL.series)) {
		return { info: cached.data.info, episodes: unmaskEpisodes(cached.data.episodes, masker) };
	}
	try {
		const client = new XtreamClient(xtreamCreds(snap, secret), { proxyUrl: await proxyFor(snap) });
		const res = mapSeriesInfo(await client.seriesInfo(providerId), { creds: client.creds });
		await cacheSet(key, { info: res.info, episodes: maskEpisodes(res.episodes, masker) });
		return res;
	} catch (err) {
		if (cached)
			return { info: cached.data.info, episodes: unmaskEpisodes(cached.data.episodes, masker) };
		throw new Error(describeError(err, secrets), { cause: err });
	}
}

/** Lazy episode list of a series (contract for the catalog store). */
export async function loadSeriesEpisodes(
	sourceId: string,
	providerId: string
): Promise<RawEpisode[]> {
	return (await loadSeriesInfo(sourceId, providerId)).episodes;
}

/** Xtream short EPG (now/next) for one live stream; [] for other source types. */
export async function loadShortEpg(
	sourceId: string,
	streamId: string,
	channelId = streamId
): Promise<EpgProgramme[]> {
	const src = sources.get(sourceId);
	if (!src || src.type !== 'xtream') return [];
	const snap = $state.snapshot(src) as XtreamSource & SourceExtras;
	const secret = await credentials.load(snap.id);
	const client = new XtreamClient(xtreamCreds(snap, secret), {
		proxyUrl: await proxyFor(snap),
		retries: 0
	});
	return client.shortEpg(streamId, channelId);
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

function defaultName(input: SourceInput): string {
	try {
		if (input.type === 'xtream') return new URL(normalizeServerUrl(input.serverUrl)).hostname;
		if (input.file) return input.file.name.replace(/\.(m3u8?|txt)$/i, '');
		if (input.playlistUrl) return new URL(input.playlistUrl).hostname;
	} catch {
		// fall through
	}
	return input.type === 'xtream' ? 'Xtream' : 'M3U';
}

/** Split a url into (stored config value, secret value) depending on embedded credentials. */
function splitUrl(url: string | undefined): { config?: string; secret?: string } {
	const u = url?.trim();
	if (!u) return {};
	return urlHasSecrets(u) ? { config: redactUrl(u), secret: u } : { config: u };
}

/** Validate input; returns a localised error or null. */
export function validateInput(
	input: SourceInput | (SourcePatch & { type: 'xtream' | 'm3u' }),
	isNew = true
): string | null {
	const isUrl = isHttpUrl;
	if (input.type === 'xtream') {
		const server = input.serverUrl ? normalizeServerUrl(input.serverUrl) : '';
		if (isNew || input.serverUrl !== undefined) if (!isUrl(server)) return t('sources.val.server');
		if ((isNew || input.username !== undefined) && !input.username?.trim())
			return t('sources.val.username');
		if (isNew && !input.password) return t('sources.val.password');
	} else {
		const hasFile = !!input.file?.text;
		if (isNew && !hasFile && !isUrl(input.playlistUrl)) return t('sources.val.playlist');
		if (
			!isNew &&
			input.playlistUrl !== undefined &&
			!hasFile &&
			!input.playlistUrl.startsWith('local:') &&
			!isUrl(input.playlistUrl)
		)
			return t('sources.val.playlist');
		if (hasFile && !looksLikeM3U(input.file!.text)) return t('sources.val.file');
	}
	if (input.epgUrl && !isUrl(input.epgUrl)) return t('sources.val.epg');
	if (input.proxyUrl && !isUrl(input.proxyUrl.replace('{url}', ''))) return t('sources.val.proxy');
	return null;
}

/** Add a source. Secrets go to secure storage; returns the stored entry. */
export async function addSource(input: SourceInput): Promise<SourceEntry> {
	await sources.ready;
	const err = validateInput(input, true);
	if (err) throw new Error(err);
	const id = uid('src_');
	const base = {
		id,
		name: input.name?.trim() || defaultName(input),
		enabled: input.enabled ?? true,
		addedAt: Date.now(),
		proxyUrl: input.proxyUrl?.trim() || undefined
	};
	const secret: SourceSecret = {};
	const epg = splitUrl(input.epgUrl);
	if (epg.secret) secret.epgUrl = epg.secret;
	let entry: SourceEntry;
	if (input.type === 'xtream') {
		// Accept a pasted get.php?username=…&password=… url as server.
		const pasted = parseXtreamUrl(input.serverUrl);
		secret.password = input.password || pasted?.password;
		entry = {
			...base,
			type: 'xtream',
			serverUrl: normalizeServerUrl(pasted?.serverUrl ?? input.serverUrl),
			username: input.username.trim() || pasted?.username || '',
			epgUrl: epg.config
		};
	} else if (input.file) {
		await fileSet(id, input.file.text);
		entry = {
			...base,
			type: 'm3u',
			playlistUrl: `local:${input.file.name}`,
			localFileName: input.file.name,
			epgUrl: epg.config
		};
	} else {
		const pl = splitUrl(input.playlistUrl);
		if (pl.secret) secret.playlistUrl = pl.secret;
		entry = { ...base, type: 'm3u', playlistUrl: pl.config!, epgUrl: epg.config };
	}
	for (const k of Object.keys(entry) as (keyof SourceEntry)[])
		if (entry[k] === undefined) delete entry[k];
	await credentials.save(id, secret);
	sources.list.push(entry);
	sources.persist();
	emitChange();
	return entry;
}

/** Update a source. Connection changes invalidate its cache. */
export async function updateSource(
	id: string,
	patch: SourcePatch
): Promise<SourceEntry | undefined> {
	await sources.ready;
	const cur = sources.get(id);
	if (!cur) return undefined;
	const snap = $state.snapshot(cur) as SourceEntry;
	if (snap.type === 'sample') {
		sources.patch(id, { enabled: patch.enabled ?? snap.enabled });
		emitChange();
		return sources.get(id);
	}
	const err = validateInput({ ...patch, type: snap.type }, false);
	if (err) throw new Error(err);

	const next: Partial<SourceExtras & Omit<XtreamSource, 'type'> & Omit<M3USource, 'type'>> = {};
	const secret = { ...(await credentials.load(id)) };
	let secretChanged = false;
	let connChanged = false;
	if (patch.name !== undefined) next.name = patch.name.trim() || snap.name;
	if (patch.enabled !== undefined) next.enabled = patch.enabled;
	if (patch.proxyUrl !== undefined) next.proxyUrl = patch.proxyUrl.trim() || undefined;
	if (patch.epgUrl !== undefined && patch.epgUrl.trim() !== (snap.epgUrl ?? '')) {
		const e = splitUrl(patch.epgUrl);
		next.epgUrl = e.config;
		secret.epgUrl = e.secret;
		secretChanged = true;
		await cacheClear(id, ['epg']);
	}
	if (snap.type === 'xtream') {
		if (patch.serverUrl !== undefined && normalizeServerUrl(patch.serverUrl) !== snap.serverUrl) {
			next.serverUrl = normalizeServerUrl(patch.serverUrl);
			connChanged = true;
		}
		if (patch.username !== undefined && patch.username.trim() !== snap.username) {
			next.username = patch.username.trim();
			connChanged = true;
		}
		if (patch.password) {
			secret.password = patch.password;
			secretChanged = true;
			connChanged = true;
		}
	} else {
		if (patch.file) {
			await fileSet(id, patch.file.text);
			next.playlistUrl = `local:${patch.file.name}`;
			next.localFileName = patch.file.name;
			secret.playlistUrl = undefined;
			secretChanged = true;
			connChanged = true;
		} else if (patch.playlistUrl !== undefined && patch.playlistUrl.trim() !== snap.playlistUrl) {
			const pl = splitUrl(patch.playlistUrl);
			next.playlistUrl = pl.config;
			next.localFileName = undefined;
			secret.playlistUrl = pl.secret;
			secretChanged = true;
			connChanged = true;
			await fileDel(id);
		}
	}
	if (secretChanged) await credentials.save(id, secret);
	if (connChanged) {
		await cacheClear(id, ['catalog', 'epg', 'series']);
		next.lastError = undefined;
		next.lastWarning = undefined;
		next.account = undefined;
	}
	sources.patch(id, next as Partial<SourceEntry>);
	emitChange();
	return sources.get(id);
}

/** Remove a source, its cache, its local file and its credentials. The sample source is only disabled. */
export async function removeSource(id: string): Promise<void> {
	await sources.ready;
	const src = sources.get(id);
	if (!src) return;
	if (src.type === 'sample') {
		sources.patch(id, { enabled: false });
		emitChange();
		return;
	}
	await dropSource(id);
	emitChange();
}

/** Remove an entry with its cache, credentials and local file (no change event). */
async function dropSource(id: string): Promise<void> {
	sources.list = sources.list.filter((s) => s.id !== id);
	delete sources.progress[id];
	sources.persist();
	await Promise.all([cacheClear(id), credentials.remove(id), fileDel(id)]);
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

const SYNC_FIELDS = [
	'name',
	'enabled',
	'addedAt',
	'serverUrl',
	'username',
	'playlistUrl',
	'epgUrl'
] as const;
const CONN_FIELDS = ['type', 'serverUrl', 'username', 'playlistUrl'] as const;
const SECRET_KEYS = ['password', 'playlistUrl', 'epgUrl'] as const;

function isLocalFile(s: SourceEntry): boolean {
	return s.type === 'm3u' && (!!s.localFileName || s.playlistUrl.startsWith('local:'));
}

function cleanSecret(v: SourceSecret | undefined): SourceSecret {
	const out: SourceSecret = {};
	if (v) for (const k of SECRET_KEYS) if (typeof v[k] === 'string' && v[k]) out[k] = v[k];
	return out;
}

const field = (o: unknown, k: string) => (o as Record<string, unknown>)[k];

/**
 * Make the local list equal to a synced list (from another device). Ids are stable:
 * existing entries are updated in place (per-device fields such as proxyUrl, stats and
 * errors are kept), unknown ids are added with that id, and local entries missing from
 * `list` are removed with their cache and credentials. Kept regardless: the sample
 * source (only its `enabled` flag syncs) and device-only M3U sources from a local file.
 * `secrets` holds new secrets for some ids; ids without an entry keep their current one.
 * Caches are invalidated where the connection (or EPG url) changed.
 * Does NOT fire onChange (no sync echo).
 */
export async function applySynced(
	list: SourceConfig[],
	secrets: Record<string, SourceSecret> = {}
): Promise<void> {
	await sources.ready;
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local lookup, not UI state
	const wanted = new Map(list.filter((c) => c && c.id && c.type).map((c) => [c.id, c]));

	for (const cur of $state.snapshot(sources.list) as SourceEntry[]) {
		if (wanted.has(cur.id) || cur.type === 'sample' || isLocalFile(cur)) continue;
		await dropSource(cur.id);
	}

	for (const cfg of wanted.values()) {
		const cur = sources.get(cfg.id);
		const curSnap = cur ? ($state.snapshot(cur) as SourceEntry) : undefined;
		if (cfg.type === 'sample' || curSnap?.type === 'sample') {
			if (curSnap && curSnap.enabled !== cfg.enabled)
				sources.patch(cfg.id, { enabled: cfg.enabled });
			continue;
		}
		const incomingSecret = cfg.id in secrets ? cleanSecret(secrets[cfg.id]) : undefined;
		let secretChanged = false;
		if (incomingSecret) {
			const have = cleanSecret(await credentials.load(cfg.id));
			secretChanged = JSON.stringify(have) !== JSON.stringify(incomingSecret);
			if (secretChanged) await credentials.save(cfg.id, incomingSecret);
		}

		if (!curSnap) {
			const entry = { ...cfg } as SourceEntry;
			for (const k of Object.keys(entry) as (keyof SourceEntry)[])
				if (entry[k] === undefined || entry[k] === null) delete entry[k];
			sources.list.push(entry);
			continue;
		}

		const next: Record<string, unknown> = {};
		for (const k of SYNC_FIELDS) {
			const v = field(cfg, k);
			if (v !== field(curSnap, k)) next[k] = v === null || v === '' ? undefined : v;
		}
		const connChanged =
			secretChanged || CONN_FIELDS.some((k) => field(cfg, k) !== field(curSnap, k));
		if (cfg.type !== curSnap.type) {
			// Same id, different kind: replace the entry but keep per-device extras.
			sources.list = sources.list.map((s) =>
				s.id === cfg.id ? ({ ...cfg, proxyUrl: curSnap.proxyUrl } as SourceEntry) : s
			);
			await cacheClear(cfg.id);
			continue;
		}
		if (connChanged) {
			await cacheClear(cfg.id, ['catalog', 'epg', 'series']);
			Object.assign(next, { lastError: undefined, lastWarning: undefined, account: undefined });
		} else if ('epgUrl' in next) {
			await cacheClear(cfg.id, ['epg']);
		}
		if (Object.keys(next).length) {
			const i = sources.list.findIndex((s) => s.id === cfg.id);
			const merged = { ...curSnap, ...next } as SourceEntry;
			for (const k of Object.keys(merged) as (keyof SourceEntry)[])
				if (merged[k] === undefined) delete merged[k];
			if (i !== -1) sources.list[i] = merged;
		}
	}
	sources.persist();
}

/**
 * Test a connection without saving: counts films/series/channels and (Xtream) reports the
 * account expiry. `config` may be new input or an existing entry; a missing password is
 * taken from secure storage when `config` has an id.
 */
export async function testSource(
	config: SourceInput | SourceEntry | (SourcePatch & { id: string; type: 'xtream' | 'm3u' }),
	password?: string
): Promise<TestResult> {
	await sources.ready;
	const id = 'id' in config ? config.id : undefined;
	const stored = id ? sources.get(id) : undefined;
	const storedSnap = stored ? ($state.snapshot(stored) as SourceEntry) : undefined;
	const secret: SourceSecret = id ? { ...(await credentials.load(id)) } : {};
	const proxy = await proxyFor({
		proxyUrl: (config as SourceExtras).proxyUrl ?? storedSnap?.proxyUrl
	});
	const tmpId = id ?? 'test';
	let secrets: string[] = [];
	try {
		if (config.type === 'xtream') {
			const c = config as Partial<XtreamSource> & { password?: string };
			const pasted = c.serverUrl ? parseXtreamUrl(c.serverUrl) : undefined;
			const serverUrl =
				pasted?.serverUrl ??
				c.serverUrl ??
				(storedSnap as XtreamSource | undefined)?.serverUrl ??
				'';
			const username =
				c.username?.trim() ||
				pasted?.username ||
				(storedSnap as XtreamSource | undefined)?.username ||
				'';
			const pw = password || c.password || pasted?.password || secret.password || '';
			secrets = [pw, username].filter(Boolean);
			if (!serverUrl || !username || !pw)
				return { ok: false, code: 'config', message: t('sources.val.incomplete') };
			const client = new XtreamClient({ serverUrl, username, password: pw }, { proxyUrl: proxy });
			const r = await loadXtreamCatalog(client, tmpId);
			return {
				ok: true,
				movies: r.movies.length,
				series: r.series.length,
				channels: r.channels.length,
				expiresAt: r.account.expiresAt,
				status: r.account.status,
				maxConnections: r.account.maxConnections,
				activeConnections: r.account.activeConnections,
				warnings: r.warnings
			};
		}
		if (config.type === 'm3u') {
			const c = config as Partial<M3USource> & { file?: { name: string; text: string } };
			const st = storedSnap?.type === 'm3u' ? storedSnap : undefined;
			let text: string | undefined;
			let url: string | undefined;
			const given = c.playlistUrl?.trim();
			if (c.file) text = c.file.text;
			else if (given && given !== st?.playlistUrl) url = given;
			else if (st && (st.localFileName || st.playlistUrl.startsWith('local:'))) {
				text = await fileGet(st.id);
				if (text == null) return { ok: false, code: 'config', message: t('sources.val.file') };
			} else if (st) url = secret.playlistUrl ?? st.playlistUrl;
			else return { ok: false, code: 'config', message: t('sources.val.playlist') };

			let result: M3UResult;
			if (text !== undefined) {
				if (!looksLikeM3U(text))
					return { ok: false, code: 'invalid', message: t('sources.val.file') };
				result = parseM3U(text, { sourceId: tmpId });
			} else {
				secrets = secretsFromUrl(url!);
				const res = await httpGet(url!, { proxyUrl: proxy, secrets, timeoutMs: 45_000 });
				result = res.body
					? await parseM3UStream(res.body, { sourceId: tmpId })
					: parseM3U(await res.text(), { sourceId: tmpId });
			}
			if (!result.entryCount)
				return { ok: false, code: 'invalid', message: t('sources.err.emptyPlaylist') };
			return {
				ok: true,
				movies: result.movies.length,
				series: result.series.length,
				channels: result.channels.length,
				epgSuggestion: result.epgUrls[0] ? redactUrl(result.epgUrls[0]) : undefined,
				warnings: []
			};
		}
		const s = sampleCatalog();
		return {
			ok: true,
			movies: s.movies.length,
			series: s.series.length,
			channels: s.channels.length,
			warnings: []
		};
	} catch (err) {
		const e = toHttpError(err, secrets);
		return { ok: false, code: e.code, message: describeError(e, secrets) };
	}
}

/** Re-export so UI code can mask urls it displays or logs. */
export { redactUrl };
