// Public API of the sync module.
//
//   initSync()            call once at app start, after user.init() (idempotent, never throws)
//   syncEngine            reactive status ($state): status, error, lastSyncAt, locked, pending, ...
//   getSyncProxyPrefix()  CORS proxy prefix for the web build when sync is configured, else null
//   registerSourcesAdapter(adapter)  replace the default bridge to #lib/sources
import { syncEngine } from './engine.svelte.ts';
import { getSourcesAdapter, registerSourcesAdapter } from './adapters.ts';
import { createDefaultSourcesAdapter } from './sources-adapter.svelte.ts';

export { syncEngine, SyncFailure, defaultDeviceName } from './engine.svelte.ts';
export type { SyncStatus, SyncErrorCode } from './engine.svelte.ts';
export { registerSourcesAdapter, type SourcesSyncAdapter } from './adapters.ts';

export async function initSync(): Promise<void> {
	if (typeof window === 'undefined') return;
	try {
		if (!getSourcesAdapter()) registerSourcesAdapter(createDefaultSourcesAdapter());
	} catch {
		// Sources module unavailable: sources are simply not synced.
	}
	await syncEngine.init();
}

/** `https://host/v1/proxy/<proxyToken>?url=` (prefix style), or null without sync. */
export function getSyncProxyPrefix(): Promise<string | null> {
	return syncEngine.getProxyPrefix();
}
