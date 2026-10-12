import { describe, expect, it } from 'vitest';
import type { AppSettings, Profile, ProfileData, WatchProgress } from '#lib/types.ts';
import {
	HISTORY_LIMIT,
	dataFromDoc,
	emptyDataDoc,
	mergeData,
	mergeHistory,
	mergeLwwMap,
	mergeProfiles,
	mergeSet,
	mergeSettings,
	mergeSources,
	profilesFromDoc,
	pruneData,
	pruneLwwMap,
	reconcileData,
	reconcileLwwMap,
	reconcileProfiles,
	reconcileSet,
	reconcileSettings,
	reconcileSources,
	sameJson,
	setValues,
	settingsPatch,
	sourcesFromDoc,
	stableStringify,
	stripLocalSettings,
	type DataDoc
} from './merge.ts';

const ROWS = [
	{ id: 'continue' as const, visible: true },
	{ id: 'favorites' as const, visible: true }
];

function data(p: Partial<ProfileData> = {}): ProfileData {
	return {
		favorites: [],
		favoriteChannels: [],
		progress: {},
		history: [],
		homeRows: ROWS.map((r) => ({ ...r })),
		updatedAt: 1000,
		...p
	};
}

function prog(titleId: string, positionSec: number, updatedAt: number): WatchProgress {
	return { titleId, variantId: 'v', positionSec, durationSec: 100, updatedAt };
}

function profile(id: string, p: Partial<Profile> = {}): Profile {
	return {
		id,
		name: id,
		avatar: 'aurora',
		isKids: false,
		audioLangs: ['nl'],
		subtitleLangs: ['nl'],
		subtitlesOn: false,
		uiLang: 'nl',
		createdAt: 1,
		...p
	};
}

const settings = (p: Partial<AppSettings> = {}): AppSettings => ({
	accent: '#7c5cff',
	autoplayNext: true,
	reduceMotion: false,
	updatedAt: 100,
	...p
});

/** Merge must be commutative, associative and idempotent for convergence. */
function expectLattice<T>(merge: (a: T, b: T) => T, a: T, b: T, c: T) {
	expect(stableStringify(merge(a, b))).toBe(stableStringify(merge(b, a)));
	expect(stableStringify(merge(merge(a, b), c))).toBe(stableStringify(merge(a, merge(b, c))));
	expect(stableStringify(merge(a, a))).toBe(stableStringify(a));
}

describe('stableStringify', () => {
	it('is independent of key order and drops undefined', () => {
		expect(stableStringify({ b: 1, a: { d: 2, c: undefined } })).toBe('{"a":{"d":2},"b":1}');
		expect(sameJson({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
		expect(sameJson([1, 2], [2, 1])).toBe(false);
	});
});

describe('element sets (favorites)', () => {
	it('records adds and removals against the previous state', () => {
		let s = reconcileSet(undefined, ['a', 'b'], 100, 'newest-first');
		expect(setValues(s, 'newest-first')).toEqual(['a', 'b']);
		s = reconcileSet(s, ['b'], 200, 'newest-first');
		expect(s.a.r).toBe(200);
		expect(setValues(s, 'newest-first')).toEqual(['b']);
	});

	it('a removal on one device is not undone by a stale copy elsewhere', () => {
		const base = reconcileSet(undefined, ['x', 'y'], 100, 'newest-first');
		const deviceA = reconcileSet(base, ['y'], 200, 'newest-first'); // removed x
		const deviceB = base; // still has x (never touched)
		const merged = mergeSet(deviceA, deviceB);
		expect(setValues(merged, 'newest-first')).toEqual(['y']);
		expect(setValues(mergeSet(deviceB, deviceA), 'newest-first')).toEqual(['y']);
	});

	it('re-adding after a removal wins when it is newer', () => {
		const base = reconcileSet(undefined, ['x'], 100, 'newest-first');
		const removed = reconcileSet(base, [], 200, 'newest-first');
		const readded = reconcileSet(removed, ['x'], 300, 'newest-first');
		expect(setValues(mergeSet(removed, readded), 'newest-first')).toEqual(['x']);
		// A concurrent stale removal (older) does not hide the newer add.
		expect(setValues(mergeSet(readded, removed), 'newest-first')).toEqual(['x']);
	});

	it('re-adding immediately (same clock) still beats the removal', () => {
		const base = reconcileSet(undefined, ['x'], 100, 'newest-first');
		const removed = reconcileSet(base, [], 100, 'newest-first');
		const readded = reconcileSet(removed, ['x'], 100, 'newest-first');
		expect(setValues(readded, 'newest-first')).toEqual(['x']);
	});

	it('union of concurrent adds', () => {
		const base = reconcileSet(undefined, ['a'], 100, 'newest-first');
		const x = reconcileSet(base, ['b', 'a'], 200, 'newest-first');
		const y = reconcileSet(base, ['c', 'a'], 300, 'newest-first');
		expect(setValues(mergeSet(x, y), 'newest-first')).toEqual(['c', 'b', 'a']);
	});

	it('keeps list order for a first import', () => {
		const fav = reconcileSet(undefined, ['n3', 'n2', 'n1'], 1000, 'newest-first');
		expect(setValues(fav, 'newest-first')).toEqual(['n3', 'n2', 'n1']);
		const ch = reconcileSet(undefined, ['c1', 'c2', 'c3'], 1000, 'oldest-first');
		expect(setValues(ch, 'oldest-first')).toEqual(['c1', 'c2', 'c3']);
	});

	it('merge is a lattice', () => {
		const a = reconcileSet(undefined, ['a', 'b'], 100, 'newest-first');
		const b = reconcileSet(a, ['b'], 200, 'newest-first');
		const c = reconcileSet(undefined, ['a', 'c'], 150, 'newest-first');
		expectLattice(mergeSet, a, b, c);
	});
});

describe('LWW map with tombstones (profiles)', () => {
	it('per-profile newest version wins', () => {
		const base = reconcileProfiles(undefined, [profile('p1'), profile('p2')], 100);
		const a = reconcileProfiles(base, [profile('p1', { name: 'Anna' }), profile('p2')], 200);
		const b = reconcileProfiles(base, [profile('p1'), profile('p2', { name: 'Bob' })], 300);
		const m = mergeProfiles(a, b);
		expect(profilesFromDoc(m).map((p) => p.name)).toEqual(['Anna', 'Bob']);
	});

	it('deletions win over older edits and do not come back', () => {
		const base = reconcileProfiles(undefined, [profile('p1'), profile('p2')], 100);
		const del = reconcileProfiles(base, [profile('p1')], 200);
		expect(del.deleted.p2).toBe(200);
		const m = mergeProfiles(base, del);
		expect(profilesFromDoc(m).map((p) => p.id)).toEqual(['p1']);
		// Reconciling the merged state with the local list (which no longer has p2) changes nothing.
		expect(sameJson(reconcileProfiles(m, profilesFromDoc(m), 300), m)).toBe(true);
	});

	it('an edit newer than the deletion resurrects the profile', () => {
		const base = reconcileProfiles(undefined, [profile('p1'), profile('p2')], 100);
		const del = reconcileProfiles(base, [profile('p1')], 200);
		const edit = reconcileProfiles(base, [profile('p1'), profile('p2', { name: 'X' })], 300);
		expect(profilesFromDoc(mergeProfiles(del, edit)).map((p) => p.name)).toEqual(['p1', 'X']);
	});

	it('equal timestamps resolve deterministically', () => {
		const a = reconcileProfiles(undefined, [profile('p1', { name: 'A' })], 100);
		const b = reconcileProfiles(undefined, [profile('p1', { name: 'B' })], 100);
		expect(sameJson(mergeProfiles(a, b), mergeProfiles(b, a))).toBe(true);
	});

	it('unchanged items keep their timestamp', () => {
		const a = reconcileLwwMap(undefined, { x: 1 }, 100);
		const b = reconcileLwwMap(a, { x: 1 }, 500);
		expect(b.items.x.ts).toBe(100);
	});

	it('prunes old tombstones only', () => {
		const m = { items: {}, deleted: { old: 10, fresh: 990 } };
		expect(Object.keys(pruneLwwMap(m, 1000, 100).deleted)).toEqual(['fresh']);
	});

	it('merge is a lattice', () => {
		const a = reconcileLwwMap(undefined, { x: 1, y: 2 }, 100);
		const b = reconcileLwwMap(a, { x: 3 }, 200);
		const c = reconcileLwwMap(undefined, { y: 5, z: 1 }, 150);
		expectLattice(mergeLwwMap<number>, a, b, c);
	});
});

describe('profile data', () => {
	it('progress: newest updatedAt per key', () => {
		const base = reconcileData(undefined, data(), 100, ROWS);
		const a = reconcileData(base, data({ progress: { t1: prog('t1', 50, 500) } }), 500, ROWS);
		const b = reconcileData(
			base,
			data({ progress: { t1: prog('t1', 20, 400), t2: prog('t2', 5, 450) } }),
			450,
			ROWS
		);
		const m = dataFromDoc(mergeData(a, b));
		expect(m.progress.t1.positionSec).toBe(50);
		expect(m.progress.t2.positionSec).toBe(5);
	});

	it('cleared progress does not come back from a stale device', () => {
		const base = reconcileData(undefined, data({ progress: { t1: prog('t1', 50, 100) } }), 100);
		const cleared = reconcileData(base, data({ progress: {} }), 200);
		expect(cleared.progressDeleted.t1).toBe(200);
		expect(dataFromDoc(mergeData(base, cleared)).progress).toEqual({});
		// Watching again later beats the old clear.
		const again = reconcileData(cleared, data({ progress: { t1: prog('t1', 10, 300) } }), 300);
		expect(again.progressDeleted.t1).toBeUndefined();
		expect(dataFromDoc(mergeData(cleared, again)).progress.t1.positionSec).toBe(10);
	});

	it('history: union, sorted newest first, deduplicated and capped', () => {
		const h1 = [
			{ titleId: 'a', at: 3 },
			{ titleId: 'b', episodeId: 'e1', at: 1 }
		];
		const h2 = [
			{ titleId: 'a', at: 3 },
			{ titleId: 'c', at: 2 },
			{ titleId: 'b', episodeId: 'e2', at: 1 }
		];
		const m = mergeHistory(h1, h2);
		expect(m.map((h) => h.titleId + (h.episodeId ?? ''))).toEqual(['a', 'c', 'be1', 'be2']);
		const many = Array.from({ length: 400 }, (_, i) => ({ titleId: 't' + i, at: i }));
		const more = Array.from({ length: 400 }, (_, i) => ({ titleId: 'u' + i, at: i + 0.5 }));
		const capped = mergeHistory(many, more);
		expect(capped).toHaveLength(HISTORY_LIMIT);
		expect(capped[0].at).toBe(399.5);
	});

	it('homeRows and lastChannelId: newest change wins per field', () => {
		const base = reconcileData(undefined, data({ updatedAt: 100 }), 100, ROWS);
		const rows2 = [ROWS[1], ROWS[0]];
		// Device A reorders rows at t=200.
		const a = reconcileData(base, data({ homeRows: rows2, updatedAt: 200 }), 200, ROWS);
		// Device B only watches something later (t=300); its rows are the old ones.
		const b = reconcileData(
			base,
			data({ progress: { t: prog('t', 1, 300) }, lastChannelId: 'ch9', updatedAt: 300 }),
			300,
			ROWS
		);
		const m = dataFromDoc(mergeData(a, b));
		expect(m.homeRows.map((r) => r.id)).toEqual(['favorites', 'continue']);
		expect(m.lastChannelId).toBe('ch9');
		expect(m.updatedAt).toBe(300);
	});

	it('a fresh device with default rows does not override customised rows', () => {
		const custom = reconcileData(undefined, data({ homeRows: [ROWS[1]], updatedAt: 50 }), 50, ROWS);
		const fresh = reconcileData(undefined, data({ updatedAt: 9999 }), 9999, ROWS);
		expect(fresh.homeRows.ts).toBe(0);
		expect(dataFromDoc(mergeData(custom, fresh)).homeRows).toEqual([ROWS[1]]);
	});

	it('favorites inside profile data merge as sets', () => {
		const base = reconcileData(undefined, data({ favorites: ['m1', 'm2'] }), 100);
		const a = reconcileData(base, data({ favorites: ['m3', 'm1', 'm2'] }), 200);
		const b = reconcileData(base, data({ favorites: ['m1'] }), 300);
		expect(dataFromDoc(mergeData(a, b)).favorites).toEqual(['m3', 'm1']);
	});

	it('reconcile after applying the merged doc is a no-op (no echo push)', () => {
		const a = reconcileData(undefined, data({ favorites: ['x'], favoriteChannels: ['c'] }), 100);
		const b = reconcileData(
			undefined,
			data({ progress: { t: prog('t', 3, 120) }, history: [{ titleId: 't', at: 120 }] }),
			120
		);
		const merged = mergeData(a, b);
		const applied = dataFromDoc(merged);
		expect(sameJson(reconcileData(merged, applied, 999), merged)).toBe(true);
	});

	it('prunes expired tombstones', () => {
		const doc: DataDoc = {
			...emptyDataDoc(),
			favorites: { a: { a: 1, r: 2 }, b: { a: 5 } },
			progressDeleted: { k: 2, j: 990 }
		};
		const p = pruneData(doc, 1000, 100);
		expect(Object.keys(p.favorites)).toEqual(['b']);
		expect(Object.keys(p.progressDeleted)).toEqual(['j']);
	});

	it('merge is a lattice', () => {
		const a = reconcileData(undefined, data({ favorites: ['x'] }), 100);
		const b = reconcileData(a, data({ favorites: [], progress: { t: prog('t', 1, 200) } }), 200);
		const c = reconcileData(undefined, data({ history: [{ titleId: 'z', at: 5 }] }), 150);
		expectLattice(mergeData, a, b, c);
	});
});

describe('settings', () => {
	it('strips device-local fields', () => {
		const s = stripLocalSettings(
			settings({ syncServerUrl: 'https://x', syncToken: 'secret', tmdbApiKey: 'k' })
		);
		expect(s).toEqual({
			accent: '#7c5cff',
			autoplayNext: true,
			reduceMotion: false,
			tmdbApiKey: 'k'
		});
	});

	it('last writer wins on updatedAt', () => {
		const a = reconcileSettings(undefined, settings({ accent: 'red', updatedAt: 100 }), 100);
		const b = reconcileSettings(undefined, settings({ accent: 'blue', updatedAt: 200 }), 200);
		expect(mergeSettings(a, b).v.accent).toBe('blue');
		expect(mergeSettings(b, a).v.accent).toBe('blue');
	});

	it('only local-only changes do not create a new version', () => {
		const a = reconcileSettings(undefined, settings({ updatedAt: 100 }), 100);
		const b = reconcileSettings(a, settings({ syncServerUrl: 'https://s', updatedAt: 500 }), 500);
		expect(b).toBe(a);
	});

	it('applying a remote doc yields a patch that also clears removed keys', () => {
		const doc = reconcileSettings(undefined, settings({ accent: 'green' }), 1);
		const patch = settingsPatch(doc, settings({ tmdbApiKey: 'old' }));
		expect(patch.accent).toBe('green');
		expect('tmdbApiKey' in patch && patch.tmdbApiKey === undefined).toBe(true);
	});
});

describe('sources', () => {
	const src = (id: string, extra: object = {}) =>
		({
			id,
			type: 'm3u',
			name: id,
			enabled: true,
			addedAt: 1,
			playlistUrl: 'https://x/' + id,
			...extra
		}) as never;

	it('ignores per-device status fields and merges per source', () => {
		const a = reconcileSources(undefined, [{ config: src('s1', { lastSyncAt: 5 }) }], 100);
		const a2 = reconcileSources(a, [{ config: src('s1', { lastSyncAt: 9, lastError: 'x' }) }], 200);
		expect(a2).toEqual(a);
		const b = reconcileSources(
			undefined,
			[{ config: src('s1', { name: 'Renamed' }), secretMac: 'm2' }, { config: src('s2') }],
			300
		);
		const m = mergeSources(a, b);
		expect(sourcesFromDoc(m).map((s) => s.name)).toEqual(['Renamed', 's2']);
		expect(m.items.s1.v.secretMac).toBe('m2');
	});

	it('removed sources stay removed', () => {
		const a = reconcileSources(undefined, [{ config: src('s1') }, { config: src('s2') }], 100);
		const del = reconcileSources(a, [{ config: src('s1') }], 200);
		expect(sourcesFromDoc(mergeSources(a, del)).map((s) => s.id)).toEqual(['s1']);
	});
});
