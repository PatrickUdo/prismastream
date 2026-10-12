// Recent searches per profile (localStorage; per-device convenience, not synced).

const MAX = 10;
const key = (profileId: string) => `ps:recentSearches:${profileId}`;

export function loadRecent(profileId: string | null | undefined): string[] {
	if (!profileId) return [];
	try {
		const raw = localStorage.getItem(key(profileId));
		const list: unknown = raw ? JSON.parse(raw) : [];
		return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : [];
	} catch {
		return [];
	}
}

function save(profileId: string, list: string[]) {
	try {
		if (list.length) localStorage.setItem(key(profileId), JSON.stringify(list));
		else localStorage.removeItem(key(profileId));
	} catch {
		// ignore (private mode / quota)
	}
}

/** Add `query` to the front (case-insensitive de-duplication). Returns the new list. */
export function addRecent(profileId: string | null | undefined, query: string): string[] {
	const q = query.trim().replace(/\s+/g, ' ');
	if (!profileId || q.length < 2) return loadRecent(profileId);
	const list = [q, ...loadRecent(profileId).filter((x) => x.toLowerCase() !== q.toLowerCase())];
	const next = list.slice(0, MAX);
	save(profileId, next);
	return next;
}

export function removeRecent(profileId: string | null | undefined, query: string): string[] {
	if (!profileId) return [];
	const next = loadRecent(profileId).filter((x) => x !== query);
	save(profileId, next);
	return next;
}

export function clearRecent(profileId: string | null | undefined): string[] {
	if (profileId) save(profileId, []);
	return [];
}
