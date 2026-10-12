// Admin CLI. Works directly on the databases in DATA_DIR (no HTTP), also while the server runs
// (SQLite WAL). In the container:
//
//   docker exec prismastream-backend node src/cli.ts invite create [--days 30] [--note "Jan"]
//   docker exec prismastream-backend node src/cli.ts invite list
//   docker exec prismastream-backend node src/cli.ts invite revoke <id>
//   docker exec prismastream-backend node src/cli.ts accounts list
//   docker exec prismastream-backend node src/cli.ts accounts delete <email> --yes
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { openCatalogDb, purgeAccount } from './catalog/db.ts';
import { accountCacheDir } from './catalog/rawcache.ts';
import { loadConfig } from './config.ts';
import { createInvite, INVITE_DEFAULT_DAYS } from './invites.ts';
import { Store } from './store.ts';

const USAGE = `Gebruik: node src/cli.ts <commando>

  invite create [--days 30] [--note "tekst"]   Nieuwe eenmalige uitnodigingscode (wordt één keer getoond).
                                               --days 0 = verloopt nooit.
  invite list                                  Alle codes (zonder de codes zelf): status, notitie, data.
  invite revoke <id>                           Een ongebruikte code intrekken.
  accounts list                                Accounts: e-mail, aangemaakt, apparaten, laatste activiteit.
  accounts delete <email> --yes                Account met apparaten, data, bronnen en catalogus verwijderen.
`;

function fmt(ms: number | null | undefined): string {
	if (!ms) return '-';
	const d = new Date(ms);
	const p = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function table(rows: string[][]): string {
	const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
	return rows
		.map((r) =>
			r
				.map((c, i) => c.padEnd(widths[i]))
				.join('  ')
				.trimEnd()
		)
		.join('\n');
}

function option(args: string[], name: string): string | undefined {
	const i = args.indexOf(name);
	if (i === -1) return undefined;
	const v = args[i + 1];
	if (v === undefined || v.startsWith('--')) throw new Error(`${name} heeft een waarde nodig`);
	return v;
}

export interface CliIo {
	out: (s: string) => void;
	err: (s: string) => void;
}

/** Runs one CLI command. Returns the exit code. */
export function runCli(
	argv: string[],
	env: Record<string, string | undefined> = process.env,
	io: CliIo = { out: (s) => console.log(s), err: (s) => console.error(s) }
): number {
	const [group, cmd, ...rest] = argv;
	const config = loadConfig(env);
	if (!group || group === 'help' || group === '--help') {
		io.out(USAGE);
		return group ? 0 : 1;
	}
	if (config.dbPath !== ':memory:' && !existsSync(config.dbPath) && group !== 'invite') {
		io.err(`Geen database gevonden op ${config.dbPath} (DATA_DIR=${config.dataDir}).`);
		return 1;
	}
	const store = new Store(config.dbPath);
	try {
		if (group === 'invite' && cmd === 'create') {
			const daysRaw = option(rest, '--days');
			const days = daysRaw === undefined ? INVITE_DEFAULT_DAYS : Number(daysRaw);
			if (!Number.isInteger(days) || days < 0 || days > 3650)
				throw new Error('--days moet een geheel getal tussen 0 en 3650 zijn');
			const note = option(rest, '--note');
			const inv = createInvite(store, { days, note });
			io.out(`Uitnodigingscode: ${inv.code}`);
			io.out(
				`Id: ${inv.id} · verloopt: ${inv.expiresAt ? fmt(inv.expiresAt) : 'nooit'}${note ? ` · notitie: ${note}` : ''}`
			);
			io.out('Deze code wordt maar één keer getoond en is één keer te gebruiken.');
			return 0;
		}
		if (group === 'invite' && cmd === 'list') {
			const list = store.listInvites();
			if (!list.length) {
				io.out('Nog geen uitnodigingscodes.');
				return 0;
			}
			const status = {
				open: 'open',
				used: 'gebruikt',
				expired: 'verlopen',
				revoked: 'ingetrokken'
			};
			io.out(
				table([
					['ID', 'STATUS', 'NOTITIE', 'AANGEMAAKT', 'VERLOOPT', 'GEBRUIKT', 'DOOR'],
					...list.map((i) => [
						i.id,
						status[i.status],
						i.note ?? '-',
						fmt(i.createdAt),
						i.expiresAt ? fmt(i.expiresAt) : 'nooit',
						fmt(i.usedAt),
						i.usedByEmail ??
							(i.usedBy ? `(${i.usedBy}${i.usedByExists ? ', legacy' : ', verwijderd'})` : '-')
					])
				])
			);
			return 0;
		}
		if (group === 'invite' && cmd === 'revoke') {
			const id = rest[0];
			if (!id) throw new Error('Gebruik: invite revoke <id>');
			if (!store.revokeInvite(id)) {
				io.err(`Geen open code met id ${id} (onbekend, al gebruikt of al ingetrokken).`);
				return 1;
			}
			io.out(`Code ${id} is ingetrokken.`);
			return 0;
		}
		if (group === 'accounts' && cmd === 'list') {
			const list = store.listAccounts();
			if (!list.length) {
				io.out('Nog geen accounts.');
				return 0;
			}
			io.out(
				table([
					['E-MAIL', 'AANGEMAAKT', 'APPARATEN', 'LAATSTE ACTIVITEIT', 'ID'],
					...list.map((a) => [
						a.email ?? '(legacy, zonder e-mail)',
						fmt(a.createdAt),
						String(a.devices),
						fmt(a.lastSeenAt),
						a.id
					])
				])
			);
			return 0;
		}
		if (group === 'accounts' && cmd === 'delete') {
			const email = rest
				.find((a) => !a.startsWith('--'))
				?.trim()
				.toLowerCase();
			if (!email) throw new Error('Gebruik: accounts delete <email> --yes');
			const acc = store.accountByEmail(email);
			if (!acc) {
				io.err(`Geen account met e-mailadres ${email}.`);
				return 1;
			}
			if (!rest.includes('--yes')) {
				io.err(
					`Dit verwijdert ${email} definitief, met alle apparaten, gesynchroniseerde data, bronnen en de catalogus.\nHerhaal het commando met --yes om te bevestigen.`
				);
				return 2;
			}
			store.deleteAccount(acc.id);
			const catalogPath = join(config.dataDir, 'catalog.db');
			if (existsSync(catalogPath)) {
				const db = openCatalogDb(catalogPath);
				try {
					purgeAccount(db, acc.id);
				} finally {
					db.close();
				}
			}
			rmSync(accountCacheDir(config.dataDir, acc.id), { recursive: true, force: true });
			io.out(`Account ${email} (${acc.id}) is verwijderd.`);
			return 0;
		}
		io.err(USAGE);
		return 1;
	} catch (e) {
		io.err(`Fout: ${(e as Error).message}`);
		return 1;
	} finally {
		store.close();
	}
}

if (import.meta.main) process.exitCode = runCli(process.argv.slice(2));
