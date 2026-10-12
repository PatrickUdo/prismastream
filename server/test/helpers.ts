import { mkdtempSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp, type AppContext } from '../src/app.ts';
import { loadConfig, type Config } from '../src/config.ts';
import { Store } from '../src/store.ts';

export type CallInit = RequestInit & { json?: unknown; token?: string; ip?: string };

export function setup(overrides: Partial<Config> = {}): AppContext & {
	call: (path: string, init?: CallInit) => Promise<Response>;
	dataDir: string;
} {
	const dataDir = mkdtempSync(join(tmpdir(), 'ps-test-'));
	const config = loadConfig(
		{},
		{
			log: false,
			trustProxy: true,
			dbPath: ':memory:',
			dataDir,
			serverKey: randomBytes(32),
			catalogRefreshHours: 0,
			...overrides
		}
	);
	const ctx = createApp(config, new Store(':memory:'));
	const call = (path: string, init: CallInit = {}) => {
		const headers = new Headers(init.headers);
		headers.set('x-forwarded-for', init.ip ?? '203.0.113.7');
		if (init.token) headers.set('authorization', `Bearer ${init.token}`);
		let body = init.body;
		if (init.json !== undefined) {
			headers.set('content-type', 'application/json');
			body = JSON.stringify(init.json);
		}
		return Promise.resolve(ctx.app.request(`http://sync.test${path}`, { ...init, headers, body }));
	};
	const dispose = ctx.dispose;
	return {
		...ctx,
		call,
		dataDir,
		async dispose() {
			await dispose();
			rmSync(dataDir, { recursive: true, force: true });
		}
	};
}

export async function newAccount(call: ReturnType<typeof setup>['call'], ip?: string) {
	const res = await call('/v1/accounts', { method: 'POST', json: { deviceName: 'Test' }, ip });
	if (res.status !== 201) throw new Error('account create failed ' + res.status);
	return (await res.json()) as {
		accountId: string;
		deviceId: string;
		token: string;
		salt: string;
		kdf: { alg: string; iterations: number };
	};
}
