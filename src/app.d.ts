// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- augments Vite's env typing
interface ImportMetaEnv {
	/** Default backend (catalog + sync) url, e.g. https://backend.prismastream.patrickudo.nl */
	readonly VITE_BACKEND_URL?: string;
	/** 'false' leaves the demo library out (production). Default: on. */
	readonly VITE_DEMO?: string;
}

export {};
