import { describe, expect, it } from 'vitest';
import {
	decodeLinkPayload,
	decryptJson,
	deriveKeys,
	deriveMasterKey,
	docAad,
	encodeLinkPayload,
	encryptJson,
	generateDeviceKeyPair,
	keysFromMaster,
	openSealed,
	randomSalt,
	sealForDevice,
	DecryptError
} from './crypto.ts';

const KDF = { alg: 'PBKDF2-SHA256', iterations: 310_000 } as const;

describe('e-mail + password key derivation', () => {
	it('authKey is deterministic and differs per password', async () => {
		const salt = randomSalt();
		const a = await keysFromMaster(await deriveMasterKey('correct horse battery', salt, KDF), salt);
		const b = await keysFromMaster(await deriveMasterKey('correct horse battery', salt, KDF), salt);
		const c = await keysFromMaster(await deriveMasterKey('another password!!', salt, KDF), salt);
		expect(a.authKey).toBe(b.authKey);
		expect(a.authKey).not.toBe(c.authKey);
		expect(atob(a.authKey)).toHaveLength(32);
	});

	it('the E2E keys match the older passphrase derivation', async () => {
		const salt = randomSalt();
		const legacy = await deriveKeys('same secret 123', salt, KDF);
		const { keys } = await keysFromMaster(
			await deriveMasterKey('same secret 123', salt, KDF),
			salt
		);
		const aad = docAad('a_1', 'profiles');
		const blob = await encryptJson(legacy.enc, aad, { hello: 1 });
		expect(await decryptJson(keys.enc, aad, blob)).toEqual({ hello: 1 });
	});
});

describe('device link (ECDH sealing)', () => {
	it('a tv opens what a phone sealed for it', async () => {
		const tv = await generateDeviceKeyPair();
		const master = crypto.getRandomValues(new Uint8Array(32));
		const payload = encodeLinkPayload({
			v: 1,
			masterKey: btoa(String.fromCharCode(...master)),
			salt: 'c2FsdA==',
			iterations: 600_000,
			email: 'a@b.nl'
		});
		const sealed = await sealForDevice(tv.publicKey, payload);
		const opened = decodeLinkPayload(
			await openSealed(tv.privateKey, sealed.sealedKey, sealed.ephemeralPublicKey)
		);
		expect(opened.email).toBe('a@b.nl');
		expect(opened.iterations).toBe(600_000);
		expect(opened.masterKey).toBe(btoa(String.fromCharCode(...master)));
	});

	it('another device cannot open it', async () => {
		const tv = await generateDeviceKeyPair();
		const other = await generateDeviceKeyPair();
		const sealed = await sealForDevice(tv.publicKey, new TextEncoder().encode('{}'));
		await expect(
			openSealed(other.privateKey, sealed.sealedKey, sealed.ephemeralPublicKey)
		).rejects.toBeInstanceOf(DecryptError);
	});
});
