// Small helpers: random ids/tokens, hashing, pairing codes.
import { createHash, randomBytes, randomInt } from 'node:crypto';

export function b64url(buf: Uint8Array): string {
	return Buffer.from(buf).toString('base64url');
}

export function randomId(prefix: string, bytes = 12): string {
	return prefix + b64url(randomBytes(bytes));
}

/** Bearer token for API access (256 bits). Only its SHA-256 is stored. */
export function newToken(): string {
	return 'pst_' + b64url(randomBytes(32));
}

/** Low-privilege token that only works for the CORS proxy (may appear in urls). */
export function newProxyToken(): string {
	return 'ppx_' + b64url(randomBytes(24));
}

export function sha256hex(s: string): string {
	return createHash('sha256').update(s, 'utf8').digest('hex');
}

/** Unambiguous alphabet (no 0/O, 1/I/L): 31 symbols, 8 chars is about 39.6 bits. */
export const PAIRING_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function newPairingCode(): string {
	let s = '';
	for (let i = 0; i < 8; i++) s += PAIRING_ALPHABET[randomInt(PAIRING_ALPHABET.length)];
	return s;
}

/** Normalise user input: uppercase, strip spaces and dashes. */
export function normalizePairingCode(input: string): string {
	return input.toUpperCase().replace(/[\s-]/g, '');
}

export function newSalt(): string {
	return randomBytes(16).toString('base64');
}

/** Removes every url from a log message (stream and provider urls never go into logs). */
export function scrubUrls(text: string): string {
	return text.replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]*/gi, '<url>').slice(0, 500);
}
