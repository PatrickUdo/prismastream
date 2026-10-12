// Adapter between the sync engine and the sources module (IPTV accounts + their secrets).
// The engine only talks to this interface, so the sources module can evolve independently.
// The default implementation (sources-adapter.svelte.ts) is registered by setSourcesSync(true)
// in local mode only (the catalog library decides; see #lib/catalog/library.svelte.ts).
import type { SourceConfig } from '#lib/types.ts';

export interface SourcesSyncAdapter {
	/** Current sources to sync, reduced to the portable SourceConfig fields (no secrets). */
	list(): SourceConfig[];
	/**
	 * Opaque secret blob for a source (e.g. JSON with the Xtream password or a credential-bearing
	 * url), or null when there is none. It only ever travels inside the E2E-encrypted doc.
	 */
	getSecret(id: string): Promise<string | null>;
	/**
	 * Make the local sources equal to `list` (add, update, remove; ids are stable across devices).
	 * `secrets` holds new secret blobs for some ids; ids that are missing keep their current secret.
	 */
	apply(list: SourceConfig[], secrets: Record<string, string>): Promise<void>;
	/** Called whenever the local list or a secret changes. Returns an unsubscribe function. */
	onChange(cb: () => void): () => void;
}

let current: SourcesSyncAdapter | null = null;
const listeners = new Set<(a: SourcesSyncAdapter | null) => void>();

export function registerSourcesAdapter(adapter: SourcesSyncAdapter | null) {
	current = adapter;
	for (const l of listeners) l(adapter);
}

export function getSourcesAdapter(): SourcesSyncAdapter | null {
	return current;
}

export function onSourcesAdapter(cb: (a: SourcesSyncAdapter | null) => void): () => void {
	listeners.add(cb);
	return () => listeners.delete(cb);
}
