// Library build of the shared core for the backend (server/, see docs/BACKEND.md):
// src/core/node.ts → one ESM file for Node (target node24) with every dependency inlined
// (saxes, …), without Svelte or Capacitor. The server imports only this bundle at runtime.
//
//   npm run build:core:node   → server/vendor/prisma-core.mjs
//
// Type declarations: server/vendor/prisma-core.d.mts (hand-written, not generated).
import { defineConfig } from 'vite';

export const CORE_NODE_OUT_DIR = 'server/vendor';
export const CORE_NODE_FILE = 'prisma-core.mjs';

export default defineConfig({
	plugins: [],
	publicDir: false,
	logLevel: 'warn',
	define: {
		'process.env.NODE_ENV': JSON.stringify('production')
	},
	build: {
		target: 'node24',
		outDir: CORE_NODE_OUT_DIR,
		// The folder also holds the hand-written .d.mts: only overwrite our file.
		emptyOutDir: false,
		copyPublicDir: false,
		// Readable stack traces on the server; size does not matter here.
		minify: false,
		sourcemap: false,
		reportCompressedSize: false,
		lib: {
			entry: 'src/core/node.ts',
			formats: ['es'],
			fileName: () => CORE_NODE_FILE
		},
		rolldownOptions: {
			// Node built-ins stay imports; everything else is bundled.
			external: [/^node:/],
			output: {
				codeSplitting: false
			}
		}
	}
});
