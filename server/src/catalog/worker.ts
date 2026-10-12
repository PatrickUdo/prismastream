// Worker thread for one catalog build (isolated heap with its own limit, so a huge provider
// list cannot take the API down, and CPU-heavy merging never blocks the event loop).
import { parentPort, workerData } from 'node:worker_threads';
import { runBuild, type BuildEvent, type BuildJob } from './build.ts';

const job = workerData as BuildJob;
const post = (e: BuildEvent | { type: 'done' } | { type: 'error'; message: string; code?: string }) =>
	parentPort!.postMessage(e);

runBuild(job, post)
	.then(() => post({ type: 'done' }))
	.catch((err: unknown) => {
		post({
			type: 'error',
			message: err instanceof Error ? err.message : String(err),
			code: (err as { code?: string }).code
		});
	});
