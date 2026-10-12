import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { runCli } from '../src/cli.ts';
import { createInvite, inviteHash, newInviteCode, normalizeInviteCode } from '../src/invites.ts';
import { Store } from '../src/store.ts';
import { setup } from './helpers.ts';

let ctx: ReturnType<typeof setup> | undefined;
afterEach(async () => {
	await ctx?.dispose();
	ctx = undefined;
});

type Json = Record<string, any>;

function register(email: string, signupCode: string | undefined, ip = '203.0.113.20') {
	return ctx!.call('/v1/auth/register', {
		method: 'POST',
		ip,
		json: {
			email,
			authKey: randomBytes(32).toString('base64'),
			salt: randomBytes(16).toString('base64'),
			iterations: 600_000,
			signupCode,
			deviceName: 'Test'
		}
	});
}

const closed = () => setup({ allowSignup: false, signupCode: 'hoofdcode-2026' });

describe('invite codes', () => {
	it('format: 10 Crockford characters, forgiving input', () => {
		for (let i = 0; i < 50; i++)
			assert.match(newInviteCode(), /^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/);
		assert.equal(normalizeInviteCode('abcde-fghjk'), 'ABCDEFGHJK');
		assert.equal(normalizeInviteCode(' oiL23 45678 '), '01123' + '45678');
		assert.equal(normalizeInviteCode('ABCDE-FGHJ'), undefined, 'too short');
		assert.equal(normalizeInviteCode('ABCDE-FGHJU'), undefined, 'U is not Crockford');
		assert.equal(normalizeInviteCode(42), undefined);
	});

	it('a valid code registers once, then it is used', async () => {
		ctx = closed();
		const inv = createInvite(ctx.store, { note: 'Jan' });
		assert.equal((await register('nocode@example.com', undefined)).status, 403);
		const ok = await register('jan@example.com', inv.code.toLowerCase().replace('-', ' '));
		assert.equal(ok.status, 201);
		const again = await register('piet@example.com', inv.code);
		assert.equal(again.status, 403);
		assert.equal(((await again.json()) as Json).error, 'invalid_signup_code');
		const [row] = ctx.store.listInvites();
		assert.equal(row.status, 'used');
		assert.equal(row.usedByEmail, 'jan@example.com');
		assert.equal(row.note, 'Jan');
		// Only the hash is stored.
		const raw = ctx.store.db.prepare('SELECT * FROM invite_codes').get() as Json;
		assert.ok(!JSON.stringify(raw).includes(normalizeInviteCode(inv.code)!));
		assert.equal(raw.code_hash, inviteHash(normalizeInviteCode(inv.code)!));
	});

	it('expired and revoked codes are refused', async () => {
		ctx = closed();
		const expired = createInvite(ctx.store, { days: 1 });
		ctx.store.db
			.prepare('UPDATE invite_codes SET expires_at = ? WHERE id = ?')
			.run(Date.now() - 1, expired.id);
		assert.equal((await register('a@example.com', expired.code)).status, 403);
		const revoked = createInvite(ctx.store);
		assert.equal(ctx.store.revokeInvite(revoked.id), true);
		assert.equal(ctx.store.revokeInvite(revoked.id), false, 'already revoked');
		assert.equal((await register('b@example.com', revoked.code)).status, 403);
		const forever = createInvite(ctx.store, { days: 0 });
		assert.equal(forever.expiresAt, null);
		assert.equal((await register('c@example.com', forever.code)).status, 201);
		assert.equal(ctx.store.revokeInvite(forever.id), false, 'a used code cannot be revoked');
		const status = Object.fromEntries(ctx.store.listInvites().map((i) => [i.id, i.status]));
		assert.deepEqual(status, {
			[expired.id]: 'expired',
			[revoked.id]: 'revoked',
			[forever.id]: 'used'
		});
		assert.equal(ctx.store.listAccounts().length, 1);
	});

	it('race: the same code used twice at once creates exactly one account', async () => {
		ctx = closed();
		const inv = createInvite(ctx.store);
		const results = await Promise.all(
			Array.from({ length: 5 }, (_, i) =>
				register(`race${i}@example.com`, inv.code, `198.51.100.${i}`)
			)
		);
		const statuses = results.map((r) => r.status).sort();
		assert.deepEqual(statuses, [201, 403, 403, 403, 403]);
		assert.equal(ctx.store.listAccounts().length, 1, 'the losers left nothing behind');
		assert.equal(ctx.store.listInvites()[0].status, 'used');
	});

	it('the master SIGNUP_CODE stays reusable; legacy /v1/accounts accepts invites too', async () => {
		ctx = closed();
		for (const e of ['m1@example.com', 'm2@example.com', 'm3@example.com'])
			assert.equal((await register(e, 'hoofdcode-2026')).status, 201);
		assert.equal(ctx.store.listInvites().length, 0);
		const inv = createInvite(ctx.store);
		const legacy = (code: string) =>
			ctx!.call('/v1/accounts', { method: 'POST', json: { signupCode: code } });
		assert.equal((await legacy(inv.code)).status, 201);
		assert.equal((await legacy(inv.code)).status, 403);
		assert.equal((await legacy('hoofdcode-2026')).status, 201);
	});
});

describe('admin CLI', () => {
	it('invite create/list/revoke and accounts list/delete on DATA_DIR', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'ps-cli-'));
		const env = { DATA_DIR: dir };
		const run = (...argv: string[]) => {
			const out: string[] = [];
			const err: string[] = [];
			const code = runCli(argv, env, { out: (s) => out.push(s), err: (s) => err.push(s) });
			return { code, out: out.join('\n'), err: err.join('\n') };
		};
		try {
			const created = run('invite', 'create', '--days', '7', '--note', 'Voor Jan');
			assert.equal(created.code, 0);
			const code = /Uitnodigingscode: (\S+)/.exec(created.out)![1];
			const id = /Id: (inv_\S+)/.exec(created.out)![1];
			assert.match(code, /^[0-9A-Z]{5}-[0-9A-Z]{5}$/);
			const second = run('invite', 'create');
			const id2 = /Id: (inv_\S+)/.exec(second.out)![1];

			const list = run('invite', 'list');
			assert.equal(list.code, 0);
			assert.match(list.out, /Voor Jan/);
			assert.ok(!list.out.includes(code), 'list never shows codes');
			assert.equal(run('invite', 'revoke', id2).code, 0);
			assert.equal(run('invite', 'revoke', id2).code, 1);
			assert.match(run('invite', 'list').out, /ingetrokken/);
			assert.equal(run('invite', 'create', '--days', 'x').code, 1);

			// An account signs up with the code (the server and the CLI share the database).
			const db = join(dir, 'prismastream-sync.db');
			const store = new Store(db);
			store.createEmailAccount(
				{
					id: 'a_cli',
					email: 'jan@example.com',
					salt: 'c2FsdA==',
					kdf: { alg: 'PBKDF2-SHA256', iterations: 600_000 },
					authHash: 'x'
				},
				{ id: 'd_cli', tokenHash: 'h1', name: 'Laptop' },
				inviteHash(normalizeInviteCode(code)!)
			);
			store.addDevice('a_cli', { id: 'd_cli2', tokenHash: 'h2', name: 'Tv' });
			store.close();
			const used = run('invite', 'list');
			assert.match(used.out, /gebruikt\s.*jan@example\.com/);
			assert.equal(run('invite', 'revoke', id).code, 1, 'a used code cannot be revoked');

			const accounts = run('accounts', 'list');
			assert.equal(accounts.code, 0);
			assert.match(accounts.out, /jan@example\.com\s+\S+ \S+\s+2\s/);
			const noYes = run('accounts', 'delete', 'jan@example.com');
			assert.equal(noYes.code, 2);
			assert.match(noYes.err, /--yes/);
			assert.equal(run('accounts', 'delete', 'nobody@example.com', '--yes').code, 1);
			const del = run('accounts', 'delete', 'JAN@example.com', '--yes');
			assert.equal(del.code, 0, del.err);
			assert.match(run('accounts', 'list').out, /Nog geen accounts/);
			assert.match(run('invite', 'list').out, /verwijderd/);
			assert.equal(run('nope').code, 1);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
