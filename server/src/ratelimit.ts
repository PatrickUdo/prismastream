// In-memory fixed-window rate limiter. Good enough for a single instance; for several
// instances behind a load balancer, put rate limiting in the reverse proxy as well.

export class RateLimiter {
	#buckets = new Map<string, { count: number; resetAt: number }>();
	#timer: ReturnType<typeof setInterval>;

	constructor() {
		this.#timer = setInterval(() => this.sweep(), 60_000);
		this.#timer.unref();
	}

	/** Counts a hit. Returns 0 when allowed, otherwise the seconds until the window resets. */
	hit(key: string, limit: number, windowMs: number, now = Date.now()): number {
		let b = this.#buckets.get(key);
		if (!b || b.resetAt <= now) {
			b = { count: 0, resetAt: now + windowMs };
			this.#buckets.set(key, b);
		}
		b.count++;
		return b.count > limit ? Math.max(1, Math.ceil((b.resetAt - now) / 1000)) : 0;
	}

	/** Checks without counting. */
	blocked(key: string, limit: number, now = Date.now()): number {
		const b = this.#buckets.get(key);
		if (!b || b.resetAt <= now) return 0;
		return b.count >= limit ? Math.max(1, Math.ceil((b.resetAt - now) / 1000)) : 0;
	}

	sweep(now = Date.now()) {
		for (const [k, b] of this.#buckets) if (b.resetAt <= now) this.#buckets.delete(k);
	}

	dispose() {
		clearInterval(this.#timer);
		this.#buckets.clear();
	}
}
