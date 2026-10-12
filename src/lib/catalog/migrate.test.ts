import { describe, expect, it, vi } from 'vitest';
import { migrateLocalModeData, type MigrationDeps } from './migrate.ts';

function deps(over: Partial<MigrationDeps> = {}): MigrationDeps & { done: boolean } {
	const d: MigrationDeps & { done: boolean } = {
		done: false,
		native: false,
		isDone: vi.fn(async (): Promise<boolean> => d.done),
		markDone: vi.fn(async () => {
			d.done = true;
		}),
		deleteLocalCaches: vi.fn(async () => undefined),
		localSourceIds: vi.fn(async () => ['src-1', 'src-2']),
		removeSource: vi.fn(async () => undefined),
		clearOldSyncKeys: vi.fn(async () => undefined),
		...over
	};
	return d;
}

describe('migrateLocalModeData', () => {
	it('web: removes caches, local sources (with passwords) and old sync keys, once', async () => {
		const d = deps();
		const r = await migrateLocalModeData(d);
		expect(r).toEqual({ ran: true, removedSources: ['src-1', 'src-2'], errors: [] });
		expect(d.deleteLocalCaches).toHaveBeenCalledOnce();
		expect(d.clearOldSyncKeys).toHaveBeenCalledOnce();
		const again = await migrateLocalModeData(d);
		expect(again.ran).toBe(false);
		expect(d.removeSource).toHaveBeenCalledTimes(2);
	});

	it('native keeps the local sources (they can be moved to the cloud)', async () => {
		const d = deps({ native: true });
		const r = await migrateLocalModeData(d);
		expect(r.removedSources).toEqual([]);
		expect(d.removeSource).not.toHaveBeenCalled();
		expect(d.deleteLocalCaches).toHaveBeenCalledOnce();
	});

	it('a failing step does not stop the rest and the migration is not retried forever', async () => {
		const d = deps({
			deleteLocalCaches: vi.fn(async () => {
				throw new Error('IndexedDB blocked');
			})
		});
		const r = await migrateLocalModeData(d);
		expect(r.errors[0]).toContain('IndexedDB blocked');
		expect(r.removedSources).toHaveLength(2);
		expect(d.done).toBe(true);
	});
});
