// One-time cleanup when a device first runs in remote mode (an account on the backend):
// remove what older versions kept for local mode, so it can never get in the way again.
//
// - IndexedDB caches of local mode (raw catalogs + EPG, merged catalog, TMDB): deleted.
// - Web: local IPTV sources and their passwords. From a browser they never worked (CORS,
//   mixed content); in remote mode the backend has the sources. Native keeps them, so the
//   sources page can still offer "Verplaats naar PrismaStream Cloud".
// - Old sync leftovers: the CORS-proxy token and the "no catalog on this server" marker.

export interface MigrationDeps {
	native: boolean;
	isDone(): Promise<boolean>;
	markDone(): Promise<void>;
	deleteLocalCaches(): Promise<unknown>;
	localSourceIds(): Promise<string[]>;
	removeSource(id: string): Promise<void>;
	clearOldSyncKeys(): Promise<void>;
}

export interface MigrationResult {
	ran: boolean;
	removedSources: string[];
	errors: string[];
}

export async function migrateLocalModeData(d: MigrationDeps): Promise<MigrationResult> {
	const result: MigrationResult = { ran: false, removedSources: [], errors: [] };
	if (await d.isDone().catch(() => false)) return result;
	result.ran = true;
	const step = async (name: string, fn: () => Promise<unknown>) => {
		try {
			await fn();
		} catch (err) {
			result.errors.push(`${name}: ${(err as Error)?.message ?? err}`);
		}
	};
	await step('caches', () => d.deleteLocalCaches());
	if (!d.native)
		await step('sources', async () => {
			for (const id of await d.localSourceIds()) {
				await d.removeSource(id);
				result.removedSources.push(id);
			}
		});
	await step('sync', () => d.clearOldSyncKeys());
	// Mark as done even after a partial failure: never loop on a broken storage.
	await d.markDone().catch(() => undefined);
	return result;
}
