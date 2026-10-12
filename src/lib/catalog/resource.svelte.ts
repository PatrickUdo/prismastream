// Async data for components: loads whenever `key()` changes (a string; null = do not load),
// aborts the previous request, and keeps the previous value while a new one loads (no flicker).
// Call during component initialisation (it uses $effect).
import { untrack } from 'svelte';
import { isAbortError } from '#lib/backend/client.ts';

export interface Resource<T> {
	readonly value: T | undefined;
	readonly loading: boolean;
	readonly error: unknown;
	/** Key of the loaded value. */
	readonly key: string | null;
	reload(): void;
}

export function resource<T>(
	key: () => string | null,
	load: (key: string, signal: AbortSignal) => Promise<T>
): Resource<T> {
	let value = $state.raw<T | undefined>(undefined);
	let loading = $state(false);
	let error = $state.raw<unknown>(null);
	let loadedKey = $state<string | null>(null);
	let nonce = $state(0);
	const k = $derived(key());

	$effect(() => {
		const current = k;
		void nonce;
		if (current === null) {
			loading = false;
			return;
		}
		const ctrl = new AbortController();
		loading = true;
		error = null;
		untrack(() => load(current, ctrl.signal))
			.then((v) => {
				if (ctrl.signal.aborted) return;
				value = v;
				loadedKey = current;
				loading = false;
			})
			.catch((err: unknown) => {
				if (ctrl.signal.aborted || isAbortError(err)) return;
				error = err;
				loading = false;
			});
		return () => ctrl.abort();
	});

	return {
		get value() {
			return value;
		},
		get loading() {
			return loading;
		},
		get error() {
			return error;
		},
		get key() {
			return loadedKey;
		},
		reload() {
			nonce++;
		}
	};
}
