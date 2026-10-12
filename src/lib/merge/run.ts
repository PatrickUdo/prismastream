// Async catalog build: uses a Web Worker for large catalogs, falls back to the main thread
// when workers are unavailable or fail.
import type { Catalog, RawCatalog } from '#lib/types.ts';
import { buildCatalog, rawSize, type BuildOptions } from './index.ts';

/** Above this many raw entries the build runs in a worker. */
export const WORKER_THRESHOLD = 4000;

let worker: Worker | null = null;
let workerBroken = false;
let seq = 0;
const pending = new Map<number, { resolve: (c: Catalog) => void; reject: (e: Error) => void }>();

function getWorker(): Worker | null {
	if (workerBroken || typeof Worker === 'undefined') return null;
	if (worker) return worker;
	try {
		worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
		worker.onmessage = (e: MessageEvent<{ id: number; catalog?: Catalog; error?: string }>) => {
			const p = pending.get(e.data.id);
			if (!p) return;
			pending.delete(e.data.id);
			if (e.data.catalog) p.resolve(e.data.catalog);
			else p.reject(new Error(e.data.error ?? 'build failed'));
		};
		worker.onerror = (e) => {
			workerBroken = true;
			for (const p of pending.values()) p.reject(new Error(e.message || 'worker error'));
			pending.clear();
			worker?.terminate();
			worker = null;
		};
		return worker;
	} catch {
		workerBroken = true;
		return null;
	}
}

/** Build a catalog, in a worker when it is large. Never rejects because of the worker itself. */
export async function buildCatalogAsync(
	raws: RawCatalog[],
	opts: BuildOptions = {}
): Promise<Catalog> {
	const w = rawSize(raws) >= WORKER_THRESHOLD ? getWorker() : null;
	if (!w) return buildCatalog(raws, opts);
	try {
		const id = ++seq;
		return await new Promise<Catalog>((resolve, reject) => {
			pending.set(id, { resolve, reject });
			w.postMessage({ id, raws, opts });
		});
	} catch {
		return buildCatalog(raws, opts);
	}
}
