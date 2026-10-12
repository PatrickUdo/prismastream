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

/**
 * masterKey = PBKDF2-SHA256(password, salt, iterations): 32 raw bytes. Zero-fill it when done;
 * it is only kept in memory (and handed sealed to a tv during a device login).
 */
export async function deriveMasterKey(
	password: string,
	saltB64: string,
	kdf: Kdf
): Promise<Uint8Array<ArrayBuffer>> {
	if (kdf.alg !== 'PBKDF2-SHA256' || kdf.iterations < MIN_KDF_ITERATIONS)
		throw new Error('Unsupported KDF parameters');
	const salt = base64ToBytes(saltB64);
	const base = await crypto.subtle.importKey(
		'raw',
		te.encode(password.normalize('NFKC')),
		'PBKDF2',
		false,
		['deriveBits']
	);
	return new Uint8Array(
		await crypto.subtle.deriveBits(
			{ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: kdf.iterations },
			base,
			256
		)
	);
}

/**
 * From the masterKey via HKDF-SHA256 (salt = the account salt):
 *   authKey  info "prismastream-auth/v1"      32 bytes, base64; the only value the server sees
 *   enc      info "prismastream-sync/v1/enc"  AES-256-GCM document key (non-extractable)
 *   mac      info "prismastream-sync/v1/mac"  HMAC-SHA256 fingerprint key (non-extractable)
 * enc/mac are identical to the keys of the older passphrase flow for the same secret.
 */
export async function keysFromMaster(
	master: Uint8Array<ArrayBuffer>,
	saltB64: string
): Promise<{ authKey: string; keys: SyncKeys }> {
	const salt = base64ToBytes(saltB64);
	const hk = await crypto.subtle.importKey('raw', master, 'HKDF', false, [
		'deriveKey',
		'deriveBits'
	]);
	const hkdf = (info: string) => ({ name: 'HKDF', hash: 'SHA-256', salt, info: te.encode(info) });
	const enc = await crypto.subtle.deriveKey(
		hkdf('prismastream-sync/v1/enc'),
		hk,
		{ name: 'AES-GCM', length: 256 },
		false,
		['encrypt', 'decrypt']
	);
	const mac = await crypto.subtle.deriveKey(
		hkdf('prismastream-sync/v1/mac'),
		hk,
		{ name: 'HMAC', hash: 'SHA-256', length: 256 },
		false,
		['sign']
	);
	const auth = new Uint8Array(
		await crypto.subtle.deriveBits(hkdf('prismastream-auth/v1'), hk, 256)
	);
	const authKey = bytesToBase64(auth);
	auth.fill(0);
	return { authKey, keys: { enc, mac } };
}

export async function deriveKeys(passphrase: string, saltB64: string, kdf: Kdf): Promise<SyncKeys> {
	const master = await deriveMasterKey(passphrase, saltB64, kdf);
	try {
		return (await keysFromMaster(master, saltB64)).keys;
	} finally {
		master.fill(0);
	}
}

/** Random 16-byte salt (base64) for a new account or a new password. */
export function randomSalt(): string {
	return bytesToBase64(crypto.getRandomValues(new Uint8Array(16)));
}

// ---- Device login: hand the masterKey to a tv, sealed with ECDH P-256 ----------------------
//
// tv: generateDeviceKeyPair() → publicKey (raw, base64) to the server
// phone: sealForDevice(publicKey, plaintext) → { sealedKey, ephemeralPublicKey }
//   shared = ECDH(ephemeral private, tv public); key = HKDF-SHA256(shared, salt = 32 zero bytes,
//   info "prismastream-device-link/v1") → AES-256-GCM; sealedKey = base64(iv(12) || ct+tag)
// tv: openSealed(privateKey, sealedKey, ephemeralPublicKey) → plaintext

const LINK_INFO = 'prismastream-device-link/v1';

export async function generateDeviceKeyPair(): Promise<{
	privateKey: CryptoKey;
	publicKey: string;
}> {
	const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, [
		'deriveBits'
	])) as CryptoKeyPair;
	const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
	return { privateKey: pair.privateKey, publicKey: bytesToBase64(raw) };
}

async function linkKey(priv: CryptoKey, peerPublicB64: string): Promise<CryptoKey> {
	const peer = await crypto.subtle.importKey(
		'raw',
		base64ToBytes(peerPublicB64),
		{ name: 'ECDH', namedCurve: 'P-256' },
		false,
		[]
	);
	const shared = new Uint8Array(
		await crypto.subtle.deriveBits({ name: 'ECDH', public: peer }, priv, 256)
	);
	const hk = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
	shared.fill(0);
	return crypto.subtle.deriveKey(
		{ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: te.encode(LINK_INFO) },
		hk,
		{ name: 'AES-GCM', length: 256 },
		false,
		['encrypt', 'decrypt']
	);
}

export async function sealForDevice(
	devicePublicKeyB64: string,
	plaintext: Uint8Array<ArrayBuffer>
): Promise<{ sealedKey: string; ephemeralPublicKey: string }> {
	const eph = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, [
		'deriveBits'
	])) as CryptoKeyPair;
	const key = await linkKey(eph.privateKey, devicePublicKeyB64);
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext));
	const out = new Uint8Array(12 + ct.length);
	out.set(iv);
	out.set(ct, 12);
	const ephPub = new Uint8Array(await crypto.subtle.exportKey('raw', eph.publicKey));
	return { sealedKey: bytesToBase64(out), ephemeralPublicKey: bytesToBase64(ephPub) };
}

export async function openSealed(
	privateKey: CryptoKey,
	sealedKeyB64: string,
	ephemeralPublicKeyB64: string
): Promise<Uint8Array<ArrayBuffer>> {
	try {
		const key = await linkKey(privateKey, ephemeralPublicKeyB64);
		const bytes = base64ToBytes(sealedKeyB64);
		return new Uint8Array(
			await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, key, bytes.slice(12))
		);
	} catch {
		throw new DecryptError('Sealed key could not be opened');
	}
}

/** What a phone hands to a tv (JSON, sealed): the masterKey plus the KDF parameters. */
export interface LinkPayload {
	v: 1;
	masterKey: string;
	salt: string;
	iterations: number;
	email?: string;
}

export function encodeLinkPayload(p: LinkPayload): Uint8Array<ArrayBuffer> {
	return te.encode(JSON.stringify(p));
}

export function decodeLinkPayload(bytes: Uint8Array): LinkPayload {
	const v = JSON.parse(td.decode(bytes)) as LinkPayload;
	if (!v || v.v !== 1 || typeof v.masterKey !== 'string' || typeof v.salt !== 'string')
		throw new DecryptError('Invalid link payload');
	return v;
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

/** Account password strength (same rules: ≥ 10 characters and at least "fair"). */
export const passwordStrength = passphraseStrength;
export const MIN_PASSWORD_LENGTH = MIN_PASSPHRASE_LENGTH;
