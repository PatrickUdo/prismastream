// Pure conflict resolution for sync documents. No I/O, no Svelte: fully unit-testable.
//
// Every synced document has a "state" form that carries the metadata needed to merge
// deterministically (timestamps, tombstones). Two operations per document type:
//   reconcile(prev, current, now)  folds local edits (current store contents) into the state,
//                                  stamping whatever changed since `prev` with `now`.
//   merge(a, b)                    commutative, idempotent join of two states.
// The store contents are derived back from a state with the *FromDoc helpers.
import type {
	AppSettings,
	HistoryEntry,
	HomeRowConfig,
	Profile,
	ProfileData,
	SourceConfig,
	WatchProgress
} from '#lib/types.ts';

export const HISTORY_LIMIT = 500;
/** Tombstones older than this are dropped (a device offline for longer may resurrect items). */
export const TOMBSTONE_TTL_MS = 180 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** JSON with sorted object keys; `undefined` members are dropped like JSON.stringify does. */
export function stableStringify(value: unknown): string {
	return JSON.stringify(value, (_k, v) => {
		if (v && typeof v === 'object' && !Array.isArray(v)) {
			const out: Record<string, unknown> = {};
			for (const k of Object.keys(v).sort()) out[k] = (v as Record<string, unknown>)[k];
			return out;
		}
		return v;
	});
}

export function sameJson(a: unknown, b: unknown): boolean {
	return stableStringify(a) === stableStringify(b);
}

/** Deterministic tie-breaker so every device picks the same winner. */
function tieBreak<T>(a: T, b: T): T {
	return stableStringify(a) >= stableStringify(b) ? a : b;
}

// ---------------------------------------------------------------------------
// Last-writer-wins register
// ---------------------------------------------------------------------------

export interface LwwEntry<T> {
	v: T;
	ts: number;
}

export function pickLww<T>(a: LwwEntry<T>, b: LwwEntry<T>): LwwEntry<T> {
	if (a.ts !== b.ts) return a.ts > b.ts ? a : b;
	return tieBreak(a, b);
}

// ---------------------------------------------------------------------------
// LWW map with tombstones (profiles, sources)
// ---------------------------------------------------------------------------

export interface LwwMap<T> {
	items: Record<string, LwwEntry<T>>;
	/** id -> deletion time. An item is dead when deleted[id] >= item.ts. */
	deleted: Record<string, number>;
}

export function emptyLwwMap<T>(): LwwMap<T> {
	return { items: {}, deleted: {} };
}

export function reconcileLwwMap<T>(
	prev: LwwMap<T> | undefined,
	current: Record<string, T>,
	now: number
): LwwMap<T> {
	const p = prev ?? emptyLwwMap<T>();
	const items = { ...p.items };
	const deleted = { ...p.deleted };
	for (const [id, v] of Object.entries(current)) {
		const e = p.items[id];
		if (e && sameJson(e.v, v)) continue;
		items[id] = { v, ts: Math.max(now, (e?.ts ?? 0) + 1, (deleted[id] ?? 0) + 1) };
		delete deleted[id];
	}
	for (const [id, e] of Object.entries(p.items)) {
		if (id in current) continue;
		deleted[id] = Math.max(now, e.ts + 1);
		delete items[id];
	}
	return { items, deleted };
}

export function mergeLwwMap<T>(a: LwwMap<T>, b: LwwMap<T>): LwwMap<T> {
	const deleted: Record<string, number> = { ...a.deleted };
	for (const [id, ts] of Object.entries(b.deleted)) deleted[id] = Math.max(deleted[id] ?? 0, ts);
	const items: Record<string, LwwEntry<T>> = {};
	for (const id of new Set([...Object.keys(a.items), ...Object.keys(b.items)])) {
		const x = a.items[id];
		const y = b.items[id];
		const win = x && y ? pickLww(x, y) : (x ?? y)!;
		if ((deleted[id] ?? -Infinity) >= win.ts) continue;
		items[id] = win;
	}
	return { items, deleted };
}

export function lwwValues<T>(m: LwwMap<T>): T[] {
	return Object.keys(m.items)
		.sort()
		.map((id) => m.items[id].v);
}

export function pruneLwwMap<T>(m: LwwMap<T>, now: number, ttl = TOMBSTONE_TTL_MS): LwwMap<T> {
	const deleted: Record<string, number> = {};
	for (const [id, ts] of Object.entries(m.deleted)) if (ts >= now - ttl) deleted[id] = ts;
	return { items: m.items, deleted };
}

// ---------------------------------------------------------------------------
// Add/remove set with timestamps (favorites, favorite channels)
// ---------------------------------------------------------------------------

/** id -> { a: last add time, r: last removal time }. Present when a > r. */
export type ElementSet = Record<string, { a: number; r?: number }>;

const isPresent = (e: { a: number; r?: number } | undefined) => !!e && e.a > (e.r ?? -Infinity);

export type SetOrder = 'newest-first' | 'oldest-first';

/** Folds a local list into the set. New items keep their list order through their add times. */
export function reconcileSet(
	prev: ElementSet | undefined,
	current: string[],
	now: number,
	order: SetOrder
): ElementSet {
	const p = prev ?? {};
	const out: ElementSet = { ...p };
	const list = [...new Set(current)];
	const n = list.length;
	list.forEach((id, i) => {
		const e = p[id];
		if (isPresent(e)) return;
		// newest-first lists: index 0 is the newest. Spread add times so the order survives.
		const offset = order === 'newest-first' ? i : n - 1 - i;
		const base = now - offset;
		out[id] = { a: Math.max(base, (e?.r ?? 0) + 1, (e?.a ?? 0) + 1), r: e?.r };
		if (out[id].r === undefined) delete out[id].r;
	});
	const set = new Set(list);
	for (const [id, e] of Object.entries(p)) {
		if (!isPresent(e) || set.has(id)) continue;
		out[id] = { a: e.a, r: Math.max(now, e.a + 1) };
	}
	return out;
}

export function mergeSet(a: ElementSet, b: ElementSet): ElementSet {
	const out: ElementSet = {};
	for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) {
		const x = a[id];
		const y = b[id];
		const ad = Math.max(x?.a ?? -Infinity, y?.a ?? -Infinity);
		const rs = [x?.r, y?.r].filter((v): v is number => v !== undefined);
		out[id] = rs.length ? { a: ad, r: Math.max(...rs) } : { a: ad };
	}
	return out;
}

export function setValues(s: ElementSet, order: SetOrder): string[] {
	const ids = Object.keys(s).filter((id) => isPresent(s[id]));
	return ids.sort((x, y) => {
		const d = order === 'newest-first' ? s[y].a - s[x].a : s[x].a - s[y].a;
		return d !== 0 ? d : x < y ? -1 : x > y ? 1 : 0;
	});
}

export function pruneSet(s: ElementSet, now: number, ttl = TOMBSTONE_TTL_MS): ElementSet {
	const out: ElementSet = {};
	for (const [id, e] of Object.entries(s)) {
		if (!isPresent(e) && (e.r ?? 0) < now - ttl) continue;
		out[id] = e;
	}
	return out;
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

const historyKey = (h: HistoryEntry) => `${h.titleId}\u0000${h.episodeId ?? ''}\u0000${h.at}`;

/** Union on (titleId, episodeId, at), newest first, capped at HISTORY_LIMIT. */
export function mergeHistory(a: HistoryEntry[], b: HistoryEntry[]): HistoryEntry[] {
	const map = new Map<string, HistoryEntry>();
	for (const h of [...a, ...b]) {
		const k = historyKey(h);
		if (!map.has(k)) {
			const e: HistoryEntry = { titleId: h.titleId, at: h.at };
			if (h.episodeId !== undefined) e.episodeId = h.episodeId;
			map.set(k, e);
		}
	}
	return [...map.entries()]
		.sort(([ka, x], [kb, y]) => y.at - x.at || (ka < kb ? -1 : ka > kb ? 1 : 0))
		.map(([, h]) => h)
		.slice(0, HISTORY_LIMIT);
}

// ---------------------------------------------------------------------------
// Per-profile data (document `data:<profileId>`)
// ---------------------------------------------------------------------------

export interface DataDoc {
	favorites: ElementSet;
	favoriteChannels: ElementSet;
	progress: Record<string, WatchProgress>;
	/** progress key -> time the entry was cleared. */
	progressDeleted: Record<string, number>;
	history: HistoryEntry[];
	homeRows: LwwEntry<HomeRowConfig[]>;
	lastChannelId: LwwEntry<string | null>;
	updatedAt: number;
}

export function emptyDataDoc(defaultHomeRows: HomeRowConfig[] = []): DataDoc {
	return {
		favorites: {},
		favoriteChannels: {},
		progress: {},
		progressDeleted: {},
		history: [],
		homeRows: { v: defaultHomeRows, ts: 0 },
		lastChannelId: { v: null, ts: 0 },
		updatedAt: 0
	};
}

function pickProgress(a: WatchProgress, b: WatchProgress): WatchProgress {
	if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b;
	return tieBreak(a, b);
}

export function reconcileData(
	prev: DataDoc | undefined,
	current: ProfileData,
	now: number,
	defaultHomeRows: HomeRowConfig[] = []
): DataDoc {
	const p = prev ?? emptyDataDoc(defaultHomeRows);
	const progress = { ...p.progress };
	const progressDeleted = { ...p.progressDeleted };
	for (const [k, v] of Object.entries(current.progress ?? {})) {
		if (p.progress[k] && sameJson(p.progress[k], v)) continue;
		progress[k] = v;
		if ((progressDeleted[k] ?? -Infinity) < v.updatedAt) delete progressDeleted[k];
	}
	for (const [k, v] of Object.entries(p.progress)) {
		if (current.progress && k in current.progress) continue;
		progressDeleted[k] = Math.max(now, v.updatedAt + 1);
		delete progress[k];
	}
	const rows = current.homeRows ?? p.homeRows.v;
	const homeRows = sameJson(p.homeRows.v, rows)
		? p.homeRows
		: { v: rows, ts: Math.max(current.updatedAt || now, p.homeRows.ts + 1) };
	const lc = current.lastChannelId ?? null;
	const lastChannelId =
		p.lastChannelId.v === lc
			? p.lastChannelId
			: { v: lc, ts: Math.max(current.updatedAt || now, p.lastChannelId.ts + 1) };
	return {
		favorites: reconcileSet(p.favorites, current.favorites ?? [], now, 'newest-first'),
		favoriteChannels: reconcileSet(
			p.favoriteChannels,
			current.favoriteChannels ?? [],
			now,
			'oldest-first'
		),
		progress,
		progressDeleted,
		history: mergeHistory(p.history, current.history ?? []),
		homeRows,
		lastChannelId,
		updatedAt: Math.max(p.updatedAt, current.updatedAt || 0)
	};
}

export function mergeData(a: DataDoc, b: DataDoc): DataDoc {
	const progressDeleted: Record<string, number> = { ...a.progressDeleted };
	for (const [k, ts] of Object.entries(b.progressDeleted))
		progressDeleted[k] = Math.max(progressDeleted[k] ?? 0, ts);
	const progress: Record<string, WatchProgress> = {};
	for (const k of new Set([...Object.keys(a.progress), ...Object.keys(b.progress)])) {
		const x = a.progress[k];
		const y = b.progress[k];
		const win = x && y ? pickProgress(x, y) : (x ?? y)!;
		if ((progressDeleted[k] ?? -Infinity) >= win.updatedAt) continue;
		progress[k] = win;
	}
	return {
		favorites: mergeSet(a.favorites, b.favorites),
		favoriteChannels: mergeSet(a.favoriteChannels, b.favoriteChannels),
		progress,
		progressDeleted,
		history: mergeHistory(a.history, b.history),
		homeRows: pickLww(a.homeRows, b.homeRows),
		lastChannelId: pickLww(a.lastChannelId, b.lastChannelId),
		updatedAt: Math.max(a.updatedAt, b.updatedAt)
	};
}

export function dataFromDoc(doc: DataDoc): ProfileData {
	const out: ProfileData = {
		favorites: setValues(doc.favorites, 'newest-first'),
		favoriteChannels: setValues(doc.favoriteChannels, 'oldest-first'),
		progress: { ...doc.progress },
		history: [...doc.history],
		homeRows: doc.homeRows.v.map((r) => ({ ...r })),
		updatedAt: doc.updatedAt
	};
	if (doc.lastChannelId.v) out.lastChannelId = doc.lastChannelId.v;
	return out;
}

export function pruneData(doc: DataDoc, now: number, ttl = TOMBSTONE_TTL_MS): DataDoc {
	const progressDeleted: Record<string, number> = {};
	for (const [k, ts] of Object.entries(doc.progressDeleted))
		if (ts >= now - ttl) progressDeleted[k] = ts;
	return {
		...doc,
		favorites: pruneSet(doc.favorites, now, ttl),
		favoriteChannels: pruneSet(doc.favoriteChannels, now, ttl),
		progressDeleted
	};
}

// ---------------------------------------------------------------------------
// Profiles (document `profiles`)
// ---------------------------------------------------------------------------

export type ProfilesDoc = LwwMap<Profile>;

export function reconcileProfiles(
	prev: ProfilesDoc | undefined,
	current: Profile[],
	now: number
): ProfilesDoc {
	return reconcileLwwMap(prev, Object.fromEntries(current.map((p) => [p.id, p])), now);
}

export const mergeProfiles = mergeLwwMap<Profile>;

export function profilesFromDoc(doc: ProfilesDoc): Profile[] {
	return lwwValues(doc).sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
}

// ---------------------------------------------------------------------------
// Settings (document `settings`): last writer wins on updatedAt
// ---------------------------------------------------------------------------

/** Device-local fields that never leave the device. */
export const LOCAL_ONLY_SETTINGS = ['syncServerUrl', 'syncToken', 'updatedAt'] as const;
export type SyncedSettings = Omit<AppSettings, (typeof LOCAL_ONLY_SETTINGS)[number]>;
export type SettingsDoc = LwwEntry<SyncedSettings>;

export function stripLocalSettings(s: AppSettings): SyncedSettings {
	const out: Record<string, unknown> = { ...s };
	for (const k of LOCAL_ONLY_SETTINGS) delete out[k];
	for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
	return out as SyncedSettings;
}

export function reconcileSettings(
	prev: SettingsDoc | undefined,
	current: AppSettings,
	now: number
): SettingsDoc {
	const v = stripLocalSettings(current);
	if (!prev) return { v, ts: current.updatedAt || 0 };
	if (sameJson(prev.v, v)) return prev;
	return { v, ts: Math.max(current.updatedAt || now, prev.ts + 1) };
}

export const mergeSettings = pickLww<SyncedSettings>;

/** Patch for user.updateSettings: also clears synced keys that the doc no longer has. */
export function settingsPatch(doc: SettingsDoc, current: AppSettings): Partial<AppSettings> {
	const patch: Record<string, unknown> = { ...doc.v };
	const local = stripLocalSettings(current) as Record<string, unknown>;
	for (const k of Object.keys(local)) if (!(k in patch)) patch[k] = undefined;
	return patch as Partial<AppSettings>;
}

// ---------------------------------------------------------------------------
// Sources (document `sources`). Secrets travel next to the map, see engine.
// ---------------------------------------------------------------------------

/** Per-device fields that are not synced. */
export const LOCAL_ONLY_SOURCE_FIELDS = ['lastSyncAt', 'lastError'] as const;

export interface SyncedSource {
	config: SourceConfig;
	/** HMAC of the source password (so a changed password is detected without storing it). */
	secretMac?: string;
}

export type SourcesDoc = LwwMap<SyncedSource>;

export function stripSource(s: SourceConfig): SourceConfig {
	const out: Record<string, unknown> = { ...s };
	for (const k of LOCAL_ONLY_SOURCE_FIELDS) delete out[k];
	for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
	return out as unknown as SourceConfig;
}

export function reconcileSources(
	prev: SourcesDoc | undefined,
	current: SyncedSource[],
	now: number
): SourcesDoc {
	return reconcileLwwMap(
		prev,
		Object.fromEntries(
			current.map((s) => {
				const v: SyncedSource = { config: stripSource(s.config) };
				if (s.secretMac) v.secretMac = s.secretMac;
				return [s.config.id, v];
			})
		),
		now
	);
}

export const mergeSources = mergeLwwMap<SyncedSource>;

export function sourcesFromDoc(doc: SourcesDoc): SourceConfig[] {
	return lwwValues(doc)
		.map((s) => s.config)
		.sort((a, b) => a.addedAt - b.addedAt || (a.id < b.id ? -1 : 1));
}

// ---------------------------------------------------------------------------
// Validation of decrypted remote docs (defensive: never trust shapes blindly)
// ---------------------------------------------------------------------------

const isObj = (v: unknown): v is Record<string, unknown> =>
	!!v && typeof v === 'object' && !Array.isArray(v);

export function isLwwMap(v: unknown): v is LwwMap<unknown> {
	return (
		isObj(v) &&
		isObj(v.items) &&
		isObj(v.deleted) &&
		Object.values(v.items).every((e) => isObj(e) && typeof e.ts === 'number' && 'v' in e)
	);
}

export function isDataDoc(v: unknown): v is DataDoc {
	return (
		isObj(v) &&
		isObj(v.favorites) &&
		isObj(v.favoriteChannels) &&
		isObj(v.progress) &&
		isObj(v.progressDeleted) &&
		Array.isArray(v.history) &&
		isObj(v.homeRows) &&
		Array.isArray(v.homeRows.v) &&
		isObj(v.lastChannelId) &&
		typeof v.updatedAt === 'number'
	);
}

export function isSettingsDoc(v: unknown): v is SettingsDoc {
	return isObj(v) && isObj(v.v) && typeof v.ts === 'number';
}
