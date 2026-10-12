// Server key handling. One 32-byte master key (SERVER_KEY or SERVER_KEY_FILE, base64) is
// expanded with HKDF into independent subkeys:
//   secrets    AES-256-GCM for stored IPTV credentials (AAD binds account + source)
//   prelogin   HMAC for fake salts of unknown e-mail addresses (no account enumeration)
// Production refuses to start without a key; development generates one in DATA_DIR.
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Config } from './config.ts';

export interface ServerKeys {
	secrets: Buffer;
	prelogin: Buffer;
}

function decodeKey(raw: string | Uint8Array, what: string): Buffer {
	if (typeof raw !== 'string') {
		if (raw.length !== 32) throw new Error(`${what}: de sleutel moet 32 bytes zijn`);
		return Buffer.from(raw);
	}
	const s = raw.trim();
	const buf = Buffer.from(s, /^[A-Za-z0-9_-]+$/.test(s) ? 'base64url' : 'base64');
	if (buf.length !== 32)
		throw new Error(`${what}: verwacht base64 van precies 32 bytes (openssl rand -base64 32)`);
	return buf;
}

/** Resolves the master key from the config (and generates a dev key when allowed). */
export function loadMasterKey(config: Config): Buffer {
	if (config.serverKey) return decodeKey(config.serverKey, 'SERVER_KEY');
	if (config.serverKeyFile) {
		const data = readFileSync(config.serverKeyFile);
		if (data.length === 32) return Buffer.from(data);
		return decodeKey(data.toString('utf8'), 'SERVER_KEY_FILE');
	}
	if (config.production)
		throw new Error(
			'SERVER_KEY of SERVER_KEY_FILE ontbreekt. Maak er een met: openssl rand -base64 32'
		);
	const file = join(config.dataDir, 'server.key');
	if (existsSync(file)) return decodeKey(readFileSync(file, 'utf8'), file);
	mkdirSync(config.dataDir, { recursive: true });
	const key = randomBytes(32);
	writeFileSync(file, key.toString('base64') + '\n', { mode: 0o600 });
	console.warn(`[keys] Ontwikkelsleutel aangemaakt in ${file} (gebruik SERVER_KEY in productie).`);
	return key;
}

export function deriveKeys(master: Buffer): ServerKeys {
	const sub = (info: string) =>
		Buffer.from(hkdfSync('sha256', master, 'prismastream-server', info, 32));
	return {
		secrets: sub('source-secrets-v1'),
		prelogin: sub('prelogin-salt-v1')
	};
}

/** AES-256-GCM sealing: "v1." + base64url(iv | ciphertext | tag). */
export function seal(key: Buffer, plaintext: string, aad: string): string {
	const iv = randomBytes(12);
	const c = createCipheriv('aes-256-gcm', key, iv);
	c.setAAD(Buffer.from(aad, 'utf8'));
	const ct = Buffer.concat([c.update(plaintext, 'utf8'), c.final()]);
	return 'v1.' + Buffer.concat([iv, ct, c.getAuthTag()]).toString('base64url');
}

/** Opens a sealed value; throws when it was tampered with or the key/AAD is wrong. */
export function unseal(key: Buffer, sealed: string, aad: string): string {
	if (!sealed.startsWith('v1.')) throw new Error('unknown sealed format');
	const buf = Buffer.from(sealed.slice(3), 'base64url');
	if (buf.length < 12 + 16) throw new Error('sealed value too short');
	const d = createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
	d.setAAD(Buffer.from(aad, 'utf8'));
	d.setAuthTag(buf.subarray(buf.length - 16));
	return Buffer.concat([d.update(buf.subarray(12, buf.length - 16)), d.final()]).toString('utf8');
}

export function hmac(key: Buffer, data: string): Buffer {
	return createHmac('sha256', key).update(data, 'utf8').digest();
}
