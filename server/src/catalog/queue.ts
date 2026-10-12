// Build queue: at most ONE catalog build runs at a time (memory budget), jobs are per account
// and deduplicated (a second request for a queued account merges its force flags). Each build
// runs in a fresh worker thread with its own heap limit; when it exits, all its memory is gone.
import { Worker } from 'node:worker_threads';
import { scrubUrls } from '../util.ts';
import type { BuildEvent, BuildJob } from './build.ts';

export type QueueState = 'idle' | 'queued' | 'building';

export interface AccountBuildStatus {
	state: QueueState;
	phase?: string;
	progress?: number;
	/** Last build error (credential-free), until the next successful build. */
	error?: string;
	startedAt?: number;
}

export interface QueueHooks {
	/** Creates the job (sources decrypted at start, so later edits are picked up). */
	makeJob(accountId: string, force: string[]): BuildJob | null;
	onEvent(accountId: string, e: BuildEvent): void;
	onFinished(accountId: string, error?: string, code?: string): void;
}

export interface QueueOptions {
	inline: boolean;
	memoryMb: number;
	/** Hard limit for one build (default 30 min). */
	timeoutMs?: number;
}

type Msg = BuildEvent | { type: 'done' } | { type: 'error'; message: string };

export class BuildQueue {
	#hooks: QueueHooks;
	#opts: QueueOptions;
	#order: string[] = [];
	#pending = new Map<string, Set<string>>();
	#status = new Map<string, AccountBuildStatus>();
	#running: string | null = null;
	#worker: Worker | null = null;
	#idle: (() => void)[] = [];
	#disposed = false;

	constructor(hooks: QueueHooks, opts: QueueOptions) {
		this.#hooks = hooks;
		this.#opts = opts;
	}

	status(accountId: string): AccountBuildStatus {
		return this.#status.get(accountId) ?? { state: 'idle' };
	}

	get running(): string | null {
		return this.#running;
	}

	/** Queues a build. `force`: source ids whose cache is bypassed ('*' = all). */
	enqueue(accountId: string, force: string[] = []): AccountBuildStatus {
		if (this.#disposed) return this.status(accountId);
		const set = this.#pending.get(accountId);
		if (set) for (const f of force) set.add(f);
		else {
			this.#pending.set(accountId, new Set(force));
			this.#order.push(accountId);
		}
		const prev = this.#status.get(accountId);
		if (this.#running !== accountId)
			this.#status.set(accountId, { state: 'queued', error: prev?.error });
		queueMicrotask(() => this.#pump());
		return this.status(accountId);
	}

	/** Resolves when nothing is queued or running (tests, shutdown). */
	idle(): Promise<void> {
		if (!this.#running && !this.#order.length) return Promise.resolve();
		return new Promise((r) => this.#idle.push(r));
	}

	forget(accountId: string) {
		this.#pending.delete(accountId);
		this.#order = this.#order.filter((a) => a !== accountId);
		this.#status.delete(accountId);
	}

	async #pump() {
		if (this.#running || this.#disposed) return;
		const accountId = this.#order.shift();
		if (!accountId) {
			for (const r of this.#idle.splice(0)) r();
			return;
		}
		const force = [...(this.#pending.get(accountId) ?? [])];
		this.#pending.delete(accountId);
		this.#running = accountId;
		const prevError = this.#status.get(accountId)?.error;
		this.#status.set(accountId, {
			state: 'building',
			progress: 0,
			startedAt: Date.now(),
			error: prevError
		});
		let error: string | undefined;
		let code: string | undefined;
		try {
			const job = this.#hooks.makeJob(accountId, force);
			if (job) await this.#run(accountId, job);
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
			code = (err as { code?: string }).code ?? 'build_failed';
		}
		this.#running = null;
		this.#worker = null;
		if (error) this.#status.set(accountId, { state: 'idle', error });
		else this.#status.delete(accountId);
		try {
			this.#hooks.onFinished(accountId, error, code);
		} catch (err) {
			console.error('[catalog] onFinished failed', scrubUrls((err as Error).message));
		}
		// Requeued while running: keep the queued state.
		if (this.#pending.has(accountId)) this.#status.set(accountId, { state: 'queued' });
		void this.#pump();
	}

	#event(accountId: string, e: BuildEvent) {
		if (e.type === 'progress') {
			const st = this.#status.get(accountId);
			if (st) {
				st.phase = e.phase;
				st.progress = Math.max(st.progress ?? 0, Math.min(1, e.ratio));
			}
		}
		this.#hooks.onEvent(accountId, e);
	}

	async #run(accountId: string, job: BuildJob): Promise<void> {
		if (this.#opts.inline) {
			const { runBuild } = await import('./build.ts');
			await runBuild(job, (e) => this.#event(accountId, e));
			return;
		}
		await new Promise<void>((resolve, reject) => {
			const worker = new Worker(new URL('./worker.ts', import.meta.url), {
				workerData: job,
				resourceLimits: {
					maxOldGenerationSizeMb: this.#opts.memoryMb,
					maxYoungGenerationSizeMb: 16
				}
			});
			this.#worker = worker;
			let failed: string | undefined;
			let failedCode = 'build_failed';
			const timer = setTimeout(
				() => {
					failed = 'De build duurde te lang en is afgebroken';
				failedCode = 'timeout';
					void worker.terminate();
				},
				this.#opts.timeoutMs ?? 30 * 60_000
			);
			timer.unref();
			worker.on('message', (m: Msg) => {
				if (m.type === 'done') return;
				if (m.type === 'error') {
					failed = m.message;
					return;
				}
				this.#event(accountId, m);
			});
			worker.on('error', (err: Error & { code?: string }) => {
				if (err.code === 'ERR_WORKER_OUT_OF_MEMORY') failedCode = 'too_large';
				failed =
					err.code === 'ERR_WORKER_OUT_OF_MEMORY'
						? 'De catalogus is te groot voor het geheugenbudget van de server'
						: err.message;
			});
			worker.on('exit', () => {
				clearTimeout(timer);
				if (failed) reject(Object.assign(new Error(failed), { code: failedCode }));
				else resolve();
			});
		});
	}

	async dispose() {
		this.#disposed = true;
		this.#order = [];
		this.#pending.clear();
		await this.#worker?.terminate();
	}
}
