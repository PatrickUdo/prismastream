// One-time invitation codes (in addition to the master SIGNUP_CODE).
//
// Format: 10 characters of Crockford base32 (no I, L, O, U), shown as XXXXX-XXXXX (50 bits).
// Input is forgiving: case, spaces and dashes do not matter, and I/L → 1, O → 0 (Crockford).
// Only SHA-256 hashes are stored; lookups go by hash, so comparing codes is constant-time.
// A code is consumed in the same transaction that creates the account (see Store).
import { randomInt, timingSafeEqual } from 'node:crypto';
import type { Config } from './config.ts';
import type { Store } from './store.ts';
import { randomId, sha256hex } from './util.ts';

export const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const INVITE_DEFAULT_DAYS = 30;

export function newInviteCode(): string {
	let s = '';
	for (let i = 0; i < 10; i++) s += CROCKFORD[randomInt(CROCKFORD.length)];
	return `${s.slice(0, 5)}-${s.slice(5)}`;
}

/** Canonical form (10 chars, no dash) or undefined when it cannot be an invite code. */
export function normalizeInviteCode(input: unknown): string | undefined {
	if (typeof input !== 'string' || input.length > 40) return undefined;
	const s = input.toUpperCase().replace(/[\s-]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0');
	return /^[0-9A-HJKMNP-TV-Z]{10}$/.test(s) ? s : undefined;
}

export function inviteHash(code: string): string {
	return sha256hex('invite:' + code);
}

/** Creates an invite; returns the code (shown once) and its id. `days` 0 = no expiry. */
export function createInvite(
	store: Store,
	opts: { days?: number; note?: string } = {}
): { id: string; code: string; expiresAt: number | null } {
	const days = opts.days ?? INVITE_DEFAULT_DAYS;
	const expiresAt = days > 0 ? Date.now() + days * 86_400_000 : null;
	const code = newInviteCode();
	const id = randomId('inv_', 6);
	store.createInvite({
		id,
		codeHash: inviteHash(normalizeInviteCode(code)!),
		expiresAt,
		note: opts.note?.slice(0, 200)
	});
	return { id, code, expiresAt };
}

function masterCodeValid(given: unknown, expected: string | undefined): boolean {
	if (!expected || typeof given !== 'string' || !given) return false;
	const a = Buffer.from(sha256hex('signup:' + given.trim()), 'hex');
	const b = Buffer.from(sha256hex('signup:' + expected), 'hex');
	return timingSafeEqual(a, b);
}

export type SignupDecision = { ok: true; inviteHash?: string } | { ok: false };

/**
 * May this signup proceed? The master SIGNUP_CODE (reusable) wins; otherwise an available
 * one-time invite (its hash is returned, the caller consumes it atomically with the account);
 * otherwise only when signup is open (ALLOW_SIGNUP).
 */
export function signupDecision(config: Config, store: Store, code: unknown): SignupDecision {
	if (masterCodeValid(code, config.signupCode)) return { ok: true };
	const norm = normalizeInviteCode(code);
	if (norm) {
		const hash = inviteHash(norm);
		if (store.inviteAvailable(hash)) return { ok: true, inviteHash: hash };
	}
	return config.allowSignup ? { ok: true } : { ok: false };
}
