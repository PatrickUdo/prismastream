// Local persistence for sync: a private IndexedDB store for sync state and the non-extractable
// CryptoKeys, and secure storage for the bearer token (Keychain/Keystore on native; on the web
// the token lives in IndexedDB, never in localStorage).
import { Capacitor } from '@capacitor/core';
import { KeychainAccess, SecureStorage } from '@aparajita/capacitor-secure-storage';
import { createStore, del, get, set, clear, type UseStore } from 'idb-keyval';

let store: UseStore | null = null;
const kv = () => (store ??= createStore('prismastream-sync', 'kv'));

export const vault = {
	get<T>(key: string): Promise<T | undefined> {
		return get<T>(key, kv());
	},
	set(key: string, value: unknown): Promise<void> {
		return set(key, value, kv());
	},
	del(key: string): Promise<void> {
		return del(key, kv());
	},
	clear(): Promise<void> {
		return clear(kv());
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
