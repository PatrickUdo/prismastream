// Login gate (production): without a logged-in PrismaStream account there is no app, only the
// welcome screen. VITE_REQUIRE_LOGIN (default: on when VITE_DEMO=false) switches it on.
//
// Public routes: /welcome (log in, create an account, tv code) and /activate (approve a tv; it
// asks to log in first). Everything else redirects to /welcome?next=<url>.
// A revoked or invalid token (401 from the backend or the sync) ends the session cleanly:
// the account is forgotten on this device (profiles stay) and /welcome shows a notice.
import { DEMO } from '#lib/demo.ts';
import { syncEngine } from '#lib/sync/index.ts';

export const REQUIRE_LOGIN: boolean =
	(import.meta.env.VITE_REQUIRE_LOGIN ?? (DEMO ? 'false' : 'true')) === 'true';

export type SessionNotice = 'expired' | 'logout';

const PUBLIC_PATHS = ['/welcome', '/activate'];

export function isPublicPath(pathname: string): boolean {
	return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

/** Only same-app paths are accepted as a redirect target (no open redirects). */
export function safeNext(next: string | null | undefined): string {
	if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return '/';
	if (isPublicPath(next.split(/[?#]/)[0])) return '/';
	return next;
}

class Session {
	/** Shown once on the welcome screen. */
	notice = $state<SessionNotice | null>(null);
	#ending = false;

	/** A usable account on this device (configured and the token not rejected). */
	get loggedIn(): boolean {
		return syncEngine.configured && syncEngine.error !== 'unauthorized';
	}

	/** The token was rejected: forget the account here and go back to the welcome screen. */
	async expire(): Promise<void> {
		if (this.#ending) return;
		this.#ending = true;
		this.notice = 'expired';
		try {
			await syncEngine.disable('local');
		} finally {
			this.#ending = false;
		}
	}

	async logout(): Promise<void> {
		await syncEngine.logout();
		this.notice = 'logout';
	}
}

export const session = new Session();
