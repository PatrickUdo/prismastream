// Backend url: fixed in the build (VITE_BACKEND_URL), changeable under "Geavanceerd" in the
// settings (stored as the device-local setting syncServerUrl: one backend for catalog and sync).
import { normalizeServerUrl } from '#lib/sync/api.ts';

/** The backend url of this build, or null (local mode only). */
export const DEFAULT_BACKEND_URL: string | null = normalizeServerUrl(
	import.meta.env.VITE_BACKEND_URL ?? ''
);

/** The web app's own origin for links such as /activate (the backend may live elsewhere). */
export function appOrigin(): string {
	return typeof location !== 'undefined' ? location.origin : '';
}
