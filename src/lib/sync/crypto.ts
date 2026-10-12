// End-to-end encryption for sync documents (WebCrypto only, no dependencies).
//
// passphrase ──PBKDF2-SHA256 (≥ 310k, default 600k iterations, per-account random salt)──▶ 256-bit
//   master secret ──HKDF-SHA256──▶ AES-256-GCM key (documents) + HMAC-SHA256 key (fingerprints)
// Both derived keys are non-extractable CryptoKeys. The passphrase and master secret never leave
// this module and are never persisted.
//
// Envelope (base64): [0x01 format][flags: 0 = raw, 1 = gzip][12-byte IV][ciphertext + GCM tag]
// Additional authenticated data binds a ciphertext to its account and doc id, so the server
// cannot swap documents around without detection.

export const KDF_ITERATIONS = 600_000;
export const MIN_KDF_ITERATIONS = 310_000;

export interface Kdf {
	alg: 'PBKDF2-SHA256';
	iterations: number;
}

export interface SyncKeys {
	enc: CryptoKey;
	mac: CryptoKey;
}

export class DecryptError extends Error {
	constructor(message = 'Decryption failed') {
		super(message);
		this.name = 'DecryptError';
	}
}

const te = new TextEncoder();
const td = new TextDecoder();
const FORMAT = 1;
const GZIP_MIN = 1024;

export function bytesToBase64(bytes: Uint8Array): string {
	let s = '';
	for (let i = 0; i < bytes.length; i += 0x8000)
		s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return btoa(s);
}

export function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
	const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
	const out = new Uint8Array(s.length);
	for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
	return out;
}

export async function deriveKeys(passphrase: string, saltB64: string, kdf: Kdf): Promise<SyncKeys> {
	if (kdf.alg !== 'PBKDF2-SHA256' || kdf.iterations < MIN_KDF_ITERATIONS)
		throw new Error('Unsupported KDF parameters');
	const salt = base64ToBytes(saltB64);
	const base = await crypto.subtle.importKey(
		'raw',
		te.encode(passphrase.normalize('NFKC')),
		'PBKDF2',
		false,
		['deriveBits']
	);
	const bits = new Uint8Array(
		await crypto.subtle.deriveBits(
			{ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: kdf.iterations },
			base,
			256
		)
	);
	const master = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
	bits.fill(0);
	const hkdf = (info: string) => ({ name: 'HKDF', hash: 'SHA-256', salt, info: te.encode(info) });
	const enc = await crypto.subtle.deriveKey(
		hkdf('prismastream-sync/v1/enc'),
		master,
		{ name: 'AES-GCM', length: 256 },
		false,
		['encrypt', 'decrypt']
	);
	const mac = await crypto.subtle.deriveKey(
		hkdf('prismastream-sync/v1/mac'),
		master,
		{ name: 'HMAC', hash: 'SHA-256', length: 256 },
		false,
		['sign']
	);
	return { enc, mac };
}

export function docAad(accountId: string, docId: string): Uint8Array<ArrayBuffer> {
	return te.encode(`prismastream-sync:v1:${accountId}:${docId}`);
}

async function pipeBytes(
	bytes: Uint8Array<ArrayBuffer>,
	stream: CompressionStream | DecompressionStream
): Promise<Uint8Array<ArrayBuffer>> {
	const out = await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer();
	return new Uint8Array(out);
}

const canGzip = () => typeof CompressionStream !== 'undefined';

export async function encryptJson(
	key: CryptoKey,
	aad: Uint8Array<ArrayBuffer>,
	value: unknown
): Promise<string> {
	let plain: Uint8Array<ArrayBuffer> = te.encode(JSON.stringify(value));
	let flags = 0;
	if (plain.length >= GZIP_MIN && canGzip()) {
		plain = await pipeBytes(plain, new CompressionStream('gzip'));
		flags = 1;
	}
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const ct = new Uint8Array(
		await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, plain)
	);
	const out = new Uint8Array(2 + iv.length + ct.length);
	out[0] = FORMAT;
	out[1] = flags;
	out.set(iv, 2);
	out.set(ct, 14);
	return bytesToBase64(out);
}

export async function decryptJson<T = unknown>(
	key: CryptoKey,
	aad: Uint8Array<ArrayBuffer>,
	blob: string
): Promise<T> {
	let bytes: Uint8Array<ArrayBuffer>;
	try {
		bytes = base64ToBytes(blob);
	} catch {
		throw new DecryptError('Invalid envelope');
	}
	if (bytes.length < 2 + 12 + 16 || bytes[0] !== FORMAT) throw new DecryptError('Unknown format');
	const flags = bytes[1];
	let plain: Uint8Array<ArrayBuffer>;
	try {
		plain = new Uint8Array(
			await crypto.subtle.decrypt(
				{ name: 'AES-GCM', iv: bytes.slice(2, 14), additionalData: aad },
				key,
				bytes.slice(14)
			)
		);
	} catch {
		throw new DecryptError();
	}
	if (flags === 1) {
		if (typeof DecompressionStream === 'undefined')
			throw new DecryptError('Compression not supported on this device');
		plain = await pipeBytes(plain, new DecompressionStream('gzip'));
	} else if (flags !== 0) throw new DecryptError('Unknown flags');
	try {
		return JSON.parse(td.decode(plain)) as T;
	} catch {
		throw new DecryptError('Invalid payload');
	}
}

/** Keyed fingerprint (HMAC-SHA256, base64) used to detect changed secrets without storing them. */
export async function fingerprint(key: CryptoKey, value: string): Promise<string> {
	const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, te.encode(value)));
	return bytesToBase64(sig.subarray(0, 18));
}

/** Random passphrase suggestion: 5 groups of 5 unambiguous characters (~124 bits). */
export function generatePassphrase(): string {
	const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
	const groups: string[] = [];
	const rnd = new Uint32Array(25);
	crypto.getRandomValues(rnd);
	for (let g = 0; g < 5; g++) {
		let s = '';
		for (let i = 0; i < 5; i++) s += alphabet[rnd[g * 5 + i] % alphabet.length];
		groups.push(s);
	}
	return groups.join('-');
}

export interface Strength {
	/** 0 (very weak) .. 4 (very strong) */
	score: 0 | 1 | 2 | 3 | 4;
	/** Rough entropy estimate in bits. */
	bits: number;
	acceptable: boolean;
}

const COMMON = [
	'password',
	'wachtwoord',
	'welkom',
	'qwerty',
	'azerty',
	'123456',
	'letmein',
	'iloveyou',
	'admin',
	'prismastream',
	'abc123',
	'monkey',
	'dragon'
];

export const MIN_PASSPHRASE_LENGTH = 10;

/** Conservative passphrase strength estimate (character pools, repeats, common words). */
export function passphraseStrength(pass: string): Strength {
	const p = pass.normalize('NFKC');
	if (!p) return { score: 0, bits: 0, acceptable: false };
	let pool = 0;
	if (/[a-z]/.test(p)) pool += 26;
	if (/[A-Z]/.test(p)) pool += 26;
	if (/[0-9]/.test(p)) pool += 10;
	if (/[^a-zA-Z0-9]/.test(p)) pool += 33;
	let bits = p.length * Math.log2(Math.max(pool, 2));
	const unique = new Set(p).size;
	if (unique < p.length / 2) bits *= unique / (p.length / 2);
	const lower = p.toLowerCase();
	for (const w of COMMON) if (lower.includes(w)) bits -= w.length * 4;
	if (/(.)\1{2,}/.test(p)) bits -= 10;
	if (/(0123|1234|2345|3456|4567|5678|6789|abcd|bcde|qwer|asdf)/i.test(p)) bits -= 10;
	bits = Math.max(0, Math.round(bits));
	const score = (
		bits < 28 ? 0 : bits < 45 ? 1 : bits < 60 ? 2 : bits < 80 ? 3 : 4
	) as Strength['score'];
	return { score, bits, acceptable: p.length >= MIN_PASSPHRASE_LENGTH && score >= 2 };
}
