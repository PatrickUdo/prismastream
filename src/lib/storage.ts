// Small key/value persistence for settings & profile data (JSON, < ~1 MB per key).
// Native: Capacitor Preferences. Web: localStorage. Large data (catalog cache) belongs in IndexedDB (idb-keyval).
import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';

const PREFIX = 'ps:';
const native = Capacitor.isNativePlatform();

export async function loadJSON<T>(key: string, fallback: T): Promise<T> {
	try {
		const raw = native
			? (await Preferences.get({ key: PREFIX + key })).value
			: localStorage.getItem(PREFIX + key);
		return raw == null ? fallback : (JSON.parse(raw) as T);
	} catch {
		return fallback;
	}
}

export async function saveJSON(key: string, value: unknown): Promise<void> {
	const raw = JSON.stringify(value);
	try {
		if (native) await Preferences.set({ key: PREFIX + key, value: raw });
		else localStorage.setItem(PREFIX + key, raw);
	} catch (err) {
		console.warn('[storage] save failed', key, err);
	}
}

export async function removeKey(key: string): Promise<void> {
	try {
		if (native) await Preferences.remove({ key: PREFIX + key });
		else localStorage.removeItem(PREFIX + key);
	} catch {
		// ignore
	}
}

/** Debounced saver so frequent updates (playback progress) don't hammer storage. */
export function debouncedSaver(key: string, ms = 800) {
	let timer: ReturnType<typeof setTimeout> | undefined;
	let pending: unknown;
	const flush = () => {
		if (timer) clearTimeout(timer);
		timer = undefined;
		void saveJSON(key, pending);
	};
	return {
		save(value: unknown) {
			pending = value;
			if (timer) clearTimeout(timer);
			timer = setTimeout(flush, ms);
		},
		flush
	};
}

export function uid(prefix = ''): string {
	return prefix + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
}
