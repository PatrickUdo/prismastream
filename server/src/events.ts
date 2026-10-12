// Long-poll notification hub: waiters per account are woken when the account's
// change sequence moves past the cursor they wait on.

type Waiter = { since: number; resolve: (seq: number) => void };

export class EventHub {
	#waiters = new Map<string, Set<Waiter>>();

	notify(accountId: string, seq: number) {
		const set = this.#waiters.get(accountId);
		if (!set) return;
		for (const w of [...set]) {
			if (seq > w.since) {
				set.delete(w);
				w.resolve(seq);
			}
		}
		if (set.size === 0) this.#waiters.delete(accountId);
	}

	/** Resolves with the new sequence, or with `since` after the timeout / abort. */
	wait(accountId: string, since: number, timeoutMs: number, signal?: AbortSignal): Promise<number> {
		return new Promise((resolve) => {
			let set = this.#waiters.get(accountId);
			if (!set) this.#waiters.set(accountId, (set = new Set()));
			const done = (seq: number) => {
				clearTimeout(timer);
				signal?.removeEventListener('abort', onAbort);
				set!.delete(w);
				if (set!.size === 0) this.#waiters.delete(accountId);
				resolve(seq);
			};
			const w: Waiter = { since, resolve: done };
			const onAbort = () => done(since);
			const timer = setTimeout(() => done(since), timeoutMs);
			signal?.addEventListener('abort', onAbort, { once: true });
			set.add(w);
			if (signal?.aborted) done(since);
		});
	}

	get size(): number {
		let n = 0;
		for (const s of this.#waiters.values()) n += s.size;
		return n;
	}

	closeAll() {
		for (const [, set] of this.#waiters) for (const w of [...set]) w.resolve(w.since);
		this.#waiters.clear();
	}
}
