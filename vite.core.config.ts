// Library build of the shared core for the native Apple TV app (see docs/TVOS.md):
// src/core/index.ts → one minified IIFE that defines the global `PrismaCore`, without
// imports or chunks, loaded into a JavaScriptCore context by tvos/.../CoreEngine.swift.
//
//   npm run build:core   → tvos/PrismaStream/Resources/prisma-core.js
import { defineConfig } from 'vite';

export const CORE_OUT_DIR = 'tvos/PrismaStream/Resources';
export const CORE_FILE = 'prisma-core.js';

export default defineConfig({
	// No SvelteKit plugin: the core is plain TypeScript and must not contain Svelte runtime.
	plugins: [],
	publicDir: false,
	logLevel: 'warn',
	define: {
		'process.env.NODE_ENV': JSON.stringify('production')
	},
	build: {
		target: 'es2020',
		outDir: CORE_OUT_DIR,
		// The folder also holds the app's other resources: only overwrite our file.
		emptyOutDir: false,
		copyPublicDir: false,
		minify: true,
		sourcemap: false,
		reportCompressedSize: false,
		lib: {
			entry: 'src/core/index.ts',
			name: 'PrismaCore',
			formats: ['iife'],
			fileName: () => CORE_FILE
		},
		rolldownOptions: {
			output: {
				// One file, everything inlined.
				codeSplitting: false
			}
		}
	}
});
