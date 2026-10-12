import { createApp, type AppContext } from '../src/app.ts';
import { loadConfig, type Config } from '../src/config.ts';
import { Store } from '../src/store.ts';

export function setup(overrides: Partial<Config> = {}): AppContext & {
	call: (path: string, init?: RequestInit & { json?: unknown; token?: string; ip?: string }) => Promise<Response>;
} {
	const config = loadConfig({}, { log: false, trustProxy: true, dbPath: ':memory:', ...overrides });
	const ctx = createApp(config, new Store(':memory:'));
	const call = (
		path: string,
		init: RequestInit & { json?: unknown; token?: string; ip?: string } = {}
	) => {
		const headers = new Headers(init.headers);
		headers.set('x-forwarded-for', init.ip ?? '203.0.113.7');
		if (init.token) headers.set('authorization', `Bearer ${init.token}`);
		let body = init.body;
		if (init.json !== undefined) {
			headers.set('content-type', 'application/json');
			body = JSON.stringify(init.json);
		}
		return Promise.resolve(
			ctx.app.request(`http://sync.test${path}`, { ...init, headers, body })
		);
	};
	return { ...ctx, call };
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
