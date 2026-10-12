// Default SourcesSyncAdapter on top of #lib/sources (Agent C's store and credentials module).
//
// What is synced per source: id, type, name, enabled, addedAt and the connection fields
// (serverUrl/username/epgUrl for Xtream, playlistUrl/epgUrl for M3U), plus the secret blob from
// the credentials module (password, credential-bearing urls), inside the encrypted doc.
// Not synced (per device): proxyUrl, stats, account info, warnings/errors, sync timestamps,
// and M3U sources loaded from a local file (their contents only exist on that device).
import type { SourceConfig } from '#lib/types.ts';
import { stableStringify } from './merge.ts';
import type { SourcesSyncAdapter } from './adapters.ts';
import {
	applySynced,
	onChange as onSourcesChange,
	sources,
	type SourceEntry
} from '#lib/sources/index.svelte.ts';
import { credentials, type SourceSecret } from '#lib/sources/credentials.ts';

const COMMON = ['id', 'type', 'name', 'enabled', 'addedAt'] as const;
const BY_TYPE: Record<string, readonly string[]> = {
	xtream: ['serverUrl', 'username', 'epgUrl'],
	m3u: ['playlistUrl', 'epgUrl'],
	sample: []
};

function portable(e: SourceEntry): SourceConfig | null {
	if (!(e.type in BY_TYPE)) return null;
	if (e.type === 'm3u' && (e.localFileName || e.playlistUrl?.startsWith('local:'))) return null;
	const out: Record<string, unknown> = {};
	for (const k of [...COMMON, ...BY_TYPE[e.type]]) {
		const v = (e as unknown as Record<string, unknown>)[k];
		if (v !== undefined && v !== null && v !== '') out[k] = v;
	}
	return out as unknown as SourceConfig;
}

function parseSecret(blob: string): SourceSecret {
	try {
		const v = JSON.parse(blob) as SourceSecret;
		const out: SourceSecret = {};
		for (const k of ['password', 'playlistUrl', 'epgUrl'] as const)
			if (typeof v[k] === 'string' && v[k]) out[k] = v[k];
		return out;
	} catch {
		return {};
	}
}

export function createDefaultSourcesAdapter(): SourcesSyncAdapter {
	return {
		list() {
			return $state
				.snapshot(sources.list)
				.map((s) => portable(s as SourceEntry))
				.filter((s): s is SourceConfig => s !== null);
		},

		async getSecret(id) {
			const s = await credentials.load(id);
			const clean: SourceSecret = {};
			for (const k of ['password', 'playlistUrl', 'epgUrl'] as const) if (s[k]) clean[k] = s[k];
			return Object.keys(clean).length ? stableStringify(clean) : null;
		},

		async apply(list, secrets) {
			// applySynced upserts by id, removes what is missing (keeping the sample source and
			// device-only local-file sources), stores secrets, invalidates changed caches, and
			// does not fire onChange, so applying never echoes back to the server.
			const parsed: Record<string, SourceSecret> = {};
			for (const [id, blob] of Object.entries(secrets)) parsed[id] = parseSecret(blob);
			await applySynced(list, parsed);
		},

		onChange(cb) {
			// Fired by addSource / updateSource / removeSource / setProxyUrl only. Debounced so a
			// burst of edits results in one sync.
			let timer: ReturnType<typeof setTimeout> | undefined;
			const off = onSourcesChange(() => {
				clearTimeout(timer);
				timer = setTimeout(cb, 300);
			});
			return () => {
				clearTimeout(timer);
				off();
			};
		}
	};
}
