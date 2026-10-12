// Secure storage for source secrets (Xtream password, credential-bearing playlist urls).
//
// Native (iOS/Android): @aparajita/capacitor-secure-storage → iOS Keychain
//   (accessible after first unlock, this device only) / Android Keystore-backed storage.
//
// Web/desktop browser: AES-GCM 256 encryption with a NON-extractable CryptoKey that is
//   generated once and stored in IndexedDB (CryptoKey is structured-cloneable, so the
//   browser keeps the key material out of reach of JavaScript). Ciphertexts live in the
//   same IndexedDB database, never in localStorage.
//   Honest limitations: this protects against casual inspection, copying localStorage,
//   sync/backup exports and extensions that read storage as plain data. It does NOT
//   protect against code running inside this origin (XSS, a malicious extension with
//   page access) — such code can simply ask the key to decrypt — nor against someone
//   with full access to the unlocked browser profile. A browser offers no OS keychain.
//   If IndexedDB or WebCrypto is unavailable (e.g. some private modes), secrets are kept
//   in memory only for this session (`credentials.persistent === false`).
//
// Secrets never go to Preferences/localStorage, logs or error messages.
import { Capacitor } from '@capacitor/core';
import { SecureStorage, KeychainAccess } from '@aparajita/capacitor-secure-storage';
import { createStore, get, set, del, type UseStore } from 'idb-keyval';

export { redactUrl, redactText } from '#lib/providers/redact.ts';

export interface SourceSecret {
	/** Xtream password. */
	password?: string;
	/** Full M3U playlist url when it contains credentials (the config keeps a masked copy). */
	playlistUrl?: string;
	/** Full EPG url when it contains credentials. */
	epgUrl?: string;
}

const native = Capacitor.isNativePlatform();
const memory = new Map<string, SourceSecret>();
const KEY_PREFIX = 'src.';

let nativeReady: Promise<void> | undefined;
function initNative(): Promise<void> {
	nativeReady ??= (async () => {
		await SecureStorage.setKeyPrefix('prismastream_');
		await SecureStorage.setDefaultKeychainAccess(KeychainAccess.afterFirstUnlockThisDeviceOnly);
	})();
	return nativeReady;
}

// ---- web vault -----------------------------------------------------------

let vault: UseStore | undefined;
let webKey: Promise<CryptoKey | null> | undefined;

function webAvailable(): boolean {
	return typeof indexedDB !== 'undefined' && typeof crypto !== 'undefined' && !!crypto.subtle;
}

function store(): UseStore {
	vault ??= createStore('prismastream-vault', 'vault');
	return vault;
}

function getWebKey(): Promise<CryptoKey | null> {
	webKey ??= (async () => {
		if (!webAvailable()) return null;
		try {
			const existing = await get<CryptoKey>('master-key', store());
			if (existing) return existing;
			const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
				'encrypt',
				'decrypt'
			]);
			await set('master-key', key, store());
			return key;
		} catch {
			return null;
		}
	})();
	return webKey;
}

interface Sealed {
	iv: Uint8Array;
	data: ArrayBuffer;
}

async function seal(key: CryptoKey, value: SourceSecret, aad: string): Promise<Sealed> {
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const data = await crypto.subtle.encrypt(
		{ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(aad) },
		key,
		new TextEncoder().encode(JSON.stringify(value))
	);
	return { iv, data };
}

async function unseal(key: CryptoKey, sealed: Sealed, aad: string): Promise<SourceSecret> {
	const plain = await crypto.subtle.decrypt(
		{
			name: 'AES-GCM',
			iv: sealed.iv as Uint8Array<ArrayBuffer>,
			additionalData: new TextEncoder().encode(aad)
		},
		key,
		sealed.data
	);
	return JSON.parse(new TextDecoder().decode(plain)) as SourceSecret;
}

// ---- public API ------------------------------------------------------------

export const credentials = {
	/** False when secrets only live in memory (no secure persistence available). */
	persistent: true,

	async save(sourceId: string, secret: SourceSecret): Promise<void> {
		const clean: SourceSecret = {};
		for (const k of ['password', 'playlistUrl', 'epgUrl'] as const)
			if (secret[k]) clean[k] = secret[k];
		memory.set(sourceId, clean);
		if (native) {
			await initNative();
			await SecureStorage.set(KEY_PREFIX + sourceId, JSON.stringify(clean), false);
			return;
		}
		const key = await getWebKey();
		if (!key) {
			this.persistent = false;
			return;
		}
		await set(KEY_PREFIX + sourceId, await seal(key, clean, sourceId), store());
	},

	async load(sourceId: string): Promise<SourceSecret> {
		const cached = memory.get(sourceId);
		if (cached) return cached;
		let out: SourceSecret = {};
		try {
			if (native) {
				await initNative();
				const raw = await SecureStorage.get(KEY_PREFIX + sourceId, false);
				if (typeof raw === 'string') out = JSON.parse(raw) as SourceSecret;
				else if (raw && typeof raw === 'object') out = raw as SourceSecret;
			} else {
				const key = await getWebKey();
				if (!key) this.persistent = false;
				else {
					const sealed = await get<Sealed>(KEY_PREFIX + sourceId, store());
					if (sealed) out = await unseal(key, sealed, sourceId);
				}
			}
		} catch {
			// Corrupt/undecryptable entry: behave as "no secret stored"; the UI asks again.
			out = {};
		}
		memory.set(sourceId, out);
		return out;
	},

	async remove(sourceId: string): Promise<void> {
		memory.delete(sourceId);
		try {
			if (native) {
				await initNative();
				await SecureStorage.remove(KEY_PREFIX + sourceId);
			} else if (webAvailable()) {
				await del(KEY_PREFIX + sourceId, store());
			}
		} catch {
			// ignore
		}
	}
};
