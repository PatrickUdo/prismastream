// Public API of the sync module.
//
//   initSync()            call once at app start, after user.init() (idempotent, never throws)
//   syncEngine            reactive status ($state): status, error, lastSyncAt, locked, pending, ...
//   getSyncProxyPrefix()  CORS proxy prefix for the web build when sync is configured, else null
//   setSourcesSync(on)    sync the local IPTV sources (local mode) or not (remote mode: the
//                         backend keeps the sources, devices must not receive credentials)
//   registerSourcesAdapter(adapter)  replace the default bridge to #lib/sources
import { syncEngine } from './engine.svelte.ts';
import { getSourcesAdapter, registerSourcesAdapter } from './adapters.ts';
import { createDefaultSourcesAdapter } from './sources-adapter.svelte.ts';

export { syncEngine, SyncFailure, defaultDeviceName } from './engine.svelte.ts';
export type { SyncStatus, SyncErrorCode } from './engine.svelte.ts';
export { registerSourcesAdapter, type SourcesSyncAdapter } from './adapters.ts';

/**
 * Starts the sync engine. The sources adapter is NOT registered here: the catalog library
 * decides (setSourcesSync) once it knows whether the device runs in local or remote mode, so a
 * remote-mode device never applies synced IPTV credentials. Until then, a remote `sources`
 * doc is simply fetched again later.
 */
export async function initSync(): Promise<void> {
	if (typeof window === 'undefined') return;
	await syncEngine.init();
}

/** Turn syncing of the local sources (and their secrets) on or off. */
export function setSourcesSync(on: boolean) {
	try {
		if (on) {
			if (!getSourcesAdapter()) registerSourcesAdapter(createDefaultSourcesAdapter());
		} else if (getSourcesAdapter()) registerSourcesAdapter(null);
	} catch {
		// Sources module unavailable: sources are simply not synced.
	}
}

/** `https://host/v1/proxy/<proxyToken>?url=` (prefix style), or null without sync. */
export function getSyncProxyPrefix(): Promise<string | null> {
	return syncEngine.getProxyPrefix();
}
