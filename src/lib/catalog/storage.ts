// Local storage housekeeping: the IndexedDB caches of local mode (raw source catalogs + EPG,
// the merged catalog, TMDB metadata) are not used in remote mode and are removed there, and
// the settings show the device's storage use (navigator.storage.estimate).

/** IndexedDB databases that only local mode uses. */
export const LOCAL_MODE_DATABASES = ['prismastream-cache', 'ps-catalog', 'ps-tmdb'] as const;
/** IndexedDB databases of the remote-mode cache. */
export const REMOTE_CACHE_DATABASES = ['prismastream-remote', 'prismastream-remote-lru'] as const;

function deleteDb(name: string): Promise<void> {
	return new Promise((resolve) => {
		try {
			const req = indexedDB.deleteDatabase(name);
			req.onsuccess = req.onerror = () => resolve();
			// An open connection (this session used it) blocks the delete until it closes; the
			// delete then completes later on its own.
			req.onblocked = () => resolve();
		} catch {
			resolve();
		}
	});
}

/** Delete IndexedDB databases that exist (never creates one). */
export async function deleteDatabases(names: readonly string[]): Promise<string[]> {
	if (typeof indexedDB === 'undefined') return [];
	let existing: string[] | null = null;
	try {
		const list = await indexedDB.databases?.();
		if (list) existing = list.map((d) => d.name ?? '').filter(Boolean);
	} catch {
		existing = null;
	}
	const doomed = existing ? names.filter((n) => existing!.includes(n)) : [...names];
	await Promise.all(doomed.map(deleteDb));
	return doomed;
}

export interface StorageUse {
	/** Bytes used by this origin (IndexedDB, caches, localStorage, ...), when known. */
	usage?: number;
	quota?: number;
}

export async function storageEstimate(): Promise<StorageUse> {
	try {
		const e = await navigator.storage?.estimate?.();
		return e ? { usage: e.usage, quota: e.quota } : {};
	} catch {
		return {};
	}
}

/** "1,2 MB" style size. */
export function formatBytes(bytes: number | undefined, locale = 'nl'): string {
	if (bytes === undefined || !Number.isFinite(bytes)) return '–';
	const units = ['B', 'kB', 'MB', 'GB'];
	let v = bytes;
	let i = 0;
	while (v >= 1000 && i < units.length - 1) {
		v /= 1000;
		i++;
	}
	return `${new Intl.NumberFormat(locale, { maximumFractionDigits: v < 10 && i > 0 ? 1 : 0 }).format(v)} ${units[i]}`;
}
