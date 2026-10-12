// Local persistence for sync: a private IndexedDB store for sync state and the non-extractable
// CryptoKeys, and secure storage for the bearer token (Keychain/Keystore on native; on the web
// the token lives in IndexedDB, never in localStorage).
import { Capacitor } from '@capacitor/core';
import { KeychainAccess, SecureStorage } from '@aparajita/capacitor-secure-storage';
import { del, get, set, clear, type UseStore } from 'idb-keyval';
import { safeStore } from '#lib/idb.ts';

let store: UseStore | null = null;
const kv = () => (store ??= safeStore('prismastream-sync', 'kv'));

/**
 * When IndexedDB cannot be used (blocked by another tab, private mode quirks), the vault keeps
 * working in memory for this session instead of failing the login or the sync.
 */
const memory = new Map<string, unknown>();
let degraded = false;

async function guarded<T>(idb: () => Promise<T>, fallback: () => T): Promise<T> {
	if (degraded) return fallback();
	try {
		return await idb();
	} catch (err) {
		if ((err as Error)?.name !== 'IdbUnavailableError') throw err;
		degraded = true;
		console.warn('[sync] storage unavailable, keeping the session in memory');
		return fallback();
	}
}

export const vault = {
	/** IndexedDB is unavailable: state only lives in memory until the app restarts. */
	get degraded() {
		return degraded;
	},
	get<T>(key: string): Promise<T | undefined> {
		return guarded(
			() => get<T>(key, kv()),
			() => memory.get(key) as T | undefined
		);
	},
	set(key: string, value: unknown): Promise<void> {
		memory.set(key, value);
		return guarded(
			() => set(key, value, kv()),
			() => undefined
		);
	},
	del(key: string): Promise<void> {
		memory.delete(key);
		return guarded(
			() => del(key, kv()),
			() => undefined
		);
	},
	clear(): Promise<void> {
		memory.clear();
		return guarded(
			() => clear(kv()),
			() => undefined
		);
	}
};

const TOKEN_KEY = 'prismastream.sync.token';
const PROXY_KEY = 'prismastream.sync.proxy';
const native = () => Capacitor.isNativePlatform();

// The key prefix is global plugin state; use the same values as #lib/sources/credentials.ts
// so both modules always read and write under one prefix.
let nativeReady: Promise<void> | undefined;
function initNative(): Promise<void> {
	nativeReady ??= (async () => {
		await SecureStorage.setKeyPrefix('prismastream_');
		await SecureStorage.setDefaultKeychainAccess(KeychainAccess.afterFirstUnlockThisDeviceOnly);
	})();
	return nativeReady;
}

async function secureGet(key: string): Promise<string | null> {
	if (native()) {
		await initNative();
		const v = await SecureStorage.getItem(key);
		return v ?? null;
	}
	return (await vault.get<string>('secret:' + key)) ?? null;
}

async function secureSet(key: string, value: string | null): Promise<void> {
	if (native()) {
		await initNative();
		if (value == null) await SecureStorage.removeItem(key);
		else await SecureStorage.setItem(key, value);
		return;
	}
	if (value == null) await vault.del('secret:' + key);
	else await vault.set('secret:' + key, value);
}

export const secrets = {
	getToken: () => secureGet(TOKEN_KEY),
	setToken: (t: string | null) => secureSet(TOKEN_KEY, t),
	getProxyPrefix: () => secureGet(PROXY_KEY),
	setProxyPrefix: (p: string | null) => secureSet(PROXY_KEY, p)
};
