import { describe, expect, it } from 'vitest';
import {
	DecryptError,
	base64ToBytes,
	bytesToBase64,
	decryptJson,
	deriveKeys,
	docAad,
	encryptJson,
	fingerprint,
	generatePassphrase,
	passphraseStrength
} from './crypto.ts';

const KDF = { alg: 'PBKDF2-SHA256' as const, iterations: 310_000 };
const SALT = bytesToBase64(new Uint8Array(16).fill(7));

describe('sync crypto', async () => {
	const keys = await deriveKeys('correct horse battery staple', SALT, KDF);

	it('derives non-extractable keys', () => {
		expect(keys.enc.extractable).toBe(false);
		expect(keys.mac.extractable).toBe(false);
		expect(keys.enc.algorithm.name).toBe('AES-GCM');
	});

	it('refuses weak KDF parameters', async () => {
		await expect(
			deriveKeys('x', SALT, { alg: 'PBKDF2-SHA256', iterations: 1000 })
		).rejects.toThrow();
	});

	it('round-trips small and large (compressed) documents', async () => {
		const aad = docAad('a_1', 'profiles');
		const small = { hello: 'wereld', n: 1 };
		expect(await decryptJson(keys.enc, aad, await encryptJson(keys.enc, aad, small))).toEqual(
			small
		);
		const big = { history: Array.from({ length: 500 }, (_, i) => ({ titleId: 't' + i, at: i })) };
		const blob = await encryptJson(keys.enc, aad, big);
		expect(base64ToBytes(blob)[1]).toBe(1); // gzip flag
		expect(blob.length).toBeLessThan(JSON.stringify(big).length);
		expect(await decryptJson(keys.enc, aad, blob)).toEqual(big);
	});

	it('uses a fresh IV per encryption', async () => {
		const aad = docAad('a_1', 'x');
		expect(await encryptJson(keys.enc, aad, 1)).not.toBe(await encryptJson(keys.enc, aad, 1));
	});

	it('fails with the wrong passphrase', async () => {
		const other = await deriveKeys('correct horse battery stapler', SALT, KDF);
		const aad = docAad('a_1', 'settings');
		const blob = await encryptJson(keys.enc, aad, { a: 1 });
		await expect(decryptJson(other.enc, aad, blob)).rejects.toBeInstanceOf(DecryptError);
	});

	it('fails with a different salt', async () => {
		const other = await deriveKeys(
			'correct horse battery staple',
			bytesToBase64(new Uint8Array(16).fill(8)),
			KDF
		);
		const aad = docAad('a_1', 'settings');
		await expect(
			decryptJson(other.enc, aad, await encryptJson(keys.enc, aad, 1))
		).rejects.toBeInstanceOf(DecryptError);
	});

	it('binds ciphertexts to account and doc id (no swapping by the server)', async () => {
		const blob = await encryptJson(keys.enc, docAad('a_1', 'data:p1'), { fav: ['x'] });
		await expect(decryptJson(keys.enc, docAad('a_1', 'data:p2'), blob)).rejects.toBeInstanceOf(
			DecryptError
		);
		await expect(decryptJson(keys.enc, docAad('a_2', 'data:p1'), blob)).rejects.toBeInstanceOf(
			DecryptError
		);
	});

	it('detects tampering and garbage', async () => {
		const aad = docAad('a_1', 'x');
		const bytes = base64ToBytes(await encryptJson(keys.enc, aad, { a: 1 }));
		bytes[bytes.length - 1] ^= 1;
		await expect(decryptJson(keys.enc, aad, bytesToBase64(bytes))).rejects.toBeInstanceOf(
			DecryptError
		);
		await expect(decryptJson(keys.enc, aad, 'AAAA')).rejects.toBeInstanceOf(DecryptError);
		await expect(decryptJson(keys.enc, aad, '!!!')).rejects.toBeInstanceOf(DecryptError);
	});

	it('fingerprints are keyed and stable', async () => {
		const other = await deriveKeys('another passphrase!', SALT, KDF);
		expect(await fingerprint(keys.mac, 'pw')).toBe(await fingerprint(keys.mac, 'pw'));
		expect(await fingerprint(keys.mac, 'pw')).not.toBe(await fingerprint(other.mac, 'pw'));
		expect(await fingerprint(keys.mac, 'pw')).not.toBe(await fingerprint(keys.mac, 'pw2'));
	});
});

describe('passphrases', () => {
	it('rates weak and strong passphrases', () => {
		expect(passphraseStrength('').acceptable).toBe(false);
		expect(passphraseStrength('password123').acceptable).toBe(false);
		expect(passphraseStrength('aaaaaaaaaaaa').acceptable).toBe(false);
		expect(passphraseStrength('short1!').acceptable).toBe(false);
		expect(passphraseStrength('Zonnige-Fiets-Regent-42').score).toBeGreaterThanOrEqual(3);
		expect(passphraseStrength('correct horse battery staple').acceptable).toBe(true);
	});

	it('generates strong random passphrases', () => {
		const p = generatePassphrase();
		expect(p).toMatch(/^([a-z2-9]{5}-){4}[a-z2-9]{5}$/);
		expect(passphraseStrength(p).score).toBe(4);
		expect(generatePassphrase()).not.toBe(p);
	});
});
