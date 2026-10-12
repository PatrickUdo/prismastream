// Web Worker entry: builds the catalog off the main thread for large libraries.
// Message in: { id, raws, opts } → message out: { id, catalog } or { id, error }.
import type { RawCatalog } from '#lib/types.ts';
import { buildCatalog, type BuildOptions } from './index.ts';

interface BuildRequest {
	id: number;
	raws: RawCatalog[];
	opts: BuildOptions;
}

const ctx = self as unknown as {
	onmessage: ((e: MessageEvent<BuildRequest>) => void) | null;
	postMessage(message: unknown): void;
};

ctx.onmessage = (e) => {
	const { id, raws, opts } = e.data;
	try {
		ctx.postMessage({ id, catalog: buildCatalog(raws, opts) });
	} catch (err) {
		ctx.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
	}
};
