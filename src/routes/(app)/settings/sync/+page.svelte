<!--
	Settings → Account (PrismaStream Cloud): log in or create an account with e-mail and password
	(zero-knowledge: the server only sees a derived authKey; the E2E keys stay on the device),
	tv login with a code, devices, change password, log out. The backend url is fixed in the
	build and only changeable under "Geavanceerd".
-->
<script lang="ts">
	import { onDestroy } from 'svelte';
	import { page } from '$app/state';
	import { t, i18n } from '#lib/i18n/index.svelte.ts';
	import { user } from '#lib/stores/user.svelte.ts';
	import { syncEngine, SyncFailure, defaultDeviceName, initSync } from '#lib/sync/index.ts';
	import type { DeviceInfo } from '#lib/sync/api.ts';
	import { isInsecureUrl, normalizeServerUrl } from '#lib/sync/api.ts';
	import { passwordStrength } from '#lib/sync/crypto.ts';
	import { library } from '#lib/catalog/library.svelte.ts';
	import { DEFAULT_BACKEND_URL } from '#lib/backend/config.ts';
	import { inputMode } from '#lib/tv/mode.svelte.ts';
	import Button from '#lib/components/Button.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import PasswordField from '#lib/components/account/PasswordField.svelte';
	import TvLogin from '#lib/components/account/TvLogin.svelte';
	import { path } from '#lib/components/links.ts';
	import { kids } from '#lib/stores/kids.svelte.ts';
	import KidsLock from '#lib/components/KidsLock.svelte';

	type Tab = 'login' | 'register' | 'tv';

	let tab = $state<Tab>(
		inputMode.tv ? 'tv' : page.url.searchParams.get('tab') === 'register' ? 'register' : 'login'
	);
	let email = $state('');
	let password = $state('');
	let password2 = $state('');
	let signupCode = $state('');
	let unlockPass = $state('');
	let oldPass = $state('');
	let newPass = $state('');
	let newPass2 = $state('');
	let changeOpen = $state(false);
	let confirmLogout = $state(false);

	let busy = $state(false);
	let formError = $state<string | null>(null);
	let notice = $state<string | null>(null);

	let devices = $state<DeviceInfo[] | null>(null);
	let devicesBusy = $state(false);
	let now = $state(Date.now());
	const tick = setInterval(() => (now = Date.now()), 30_000);
	onDestroy(() => clearInterval(tick));

	// Keeps this page working even before the app shell started sync (idempotent).
	$effect(() => {
		void initSync();
	});

	const configured = $derived(syncEngine.configured);
	const serverUrl = $derived(library.backendUrl ?? '');
	const strength = $derived(passwordStrength(password));
	const newStrength = $derived(passwordStrength(newPass));
	const passwordAccount = $derived(syncEngine.authMode === 'password');
	/** The key does not fit any more (password changed elsewhere) or is missing. */
	const needsPassword = $derived(
		configured &&
			passwordAccount &&
			(syncEngine.locked || syncEngine.error === 'decrypt' || syncEngine.error === 'wrongPassword')
	);
	const loggedOut = $derived(configured && syncEngine.error === 'unauthorized');

	function errorText(err: unknown): string {
		if (err instanceof SyncFailure) return t('sync.error.' + err.code);
		return t('sync.error.unknown');
	}

	function relTime(ms: number | null | undefined): string {
		if (!ms) return '';
		const diff = Math.round((ms - now) / 1000);
		const rtf = new Intl.RelativeTimeFormat(i18n.locale, { numeric: 'auto' });
		const abs = Math.abs(diff);
		if (abs < 60) return rtf.format(diff, 'second');
		if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
		if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
		return rtf.format(Math.round(diff / 86400), 'day');
	}

	function reset() {
		password = '';
		password2 = '';
		unlockPass = '';
		oldPass = '';
		newPass = '';
		newPass2 = '';
	}

	function requireServer(): string | null {
		if (!serverUrl) {
			formError = t('account.noServer');
			return null;
		}
		return serverUrl;
	}

	const validEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

	async function submitLogin(e: SubmitEvent) {
		e.preventDefault();
		formError = notice = null;
		const url = requireServer();
		if (!url) return;
		if (!validEmail(email)) return void (formError = t('sync.error.invalidEmail'));
		if (!password) return void (formError = t('sync.error.invalidLogin'));
		busy = true;
		try {
			await syncEngine.login(url, email, password, defaultDeviceName());
			reset();
			notice = t('account.done.login');
		} catch (err) {
			formError = errorText(err);
		} finally {
			busy = false;
		}
	}

	async function submitRegister(e: SubmitEvent) {
		e.preventDefault();
		formError = notice = null;
		const url = requireServer();
		if (!url) return;
		if (!validEmail(email)) return void (formError = t('sync.error.invalidEmail'));
		if (!strength.acceptable) return void (formError = t('account.password.tooWeak'));
		if (password !== password2) return void (formError = t('account.password.mismatch'));
		if (!signupCode.trim()) return void (formError = t('account.signupCode.required'));
		busy = true;
		try {
			await syncEngine.register(url, email, password, signupCode, defaultDeviceName());
			reset();
			signupCode = '';
			notice = t('account.done.register');
		} catch (err) {
			formError = errorText(err);
		} finally {
			busy = false;
		}
	}

	async function submitUnlock(e: SubmitEvent) {
		e.preventDefault();
		formError = null;
		busy = true;
		try {
			const ok = passwordAccount
				? await syncEngine.unlockWithPassword(unlockPass)
				: await syncEngine.unlock(unlockPass);
			if (ok) {
				reset();
				notice = t('account.done.unlocked');
			} else
				formError = t(passwordAccount ? 'sync.error.wrongPassword' : 'sync.error.wrongPassphrase');
		} catch (err) {
			formError = errorText(err);
		} finally {
			busy = false;
		}
	}

	async function submitChange(e: SubmitEvent) {
		e.preventDefault();
		formError = notice = null;
		if (!newStrength.acceptable) return void (formError = t('account.password.tooWeak'));
		if (newPass !== newPass2) return void (formError = t('account.password.mismatch'));
		busy = true;
		try {
			await syncEngine.changePassword(oldPass, newPass);
			reset();
			changeOpen = false;
			notice = t('account.done.passwordChanged');
		} catch (err) {
			formError = errorText(err);
		} finally {
			busy = false;
		}
	}

	async function logout() {
		formError = null;
		busy = true;
		try {
			await syncEngine.logout();
			confirmLogout = false;
			devices = null;
			notice = t('account.done.logout');
		} catch (err) {
			formError = errorText(err);
		} finally {
			busy = false;
		}
	}

	async function loadDevices() {
		devicesBusy = true;
		formError = null;
		try {
			devices = await syncEngine.listDevices();
		} catch (err) {
			formError = errorText(err);
		} finally {
			devicesBusy = false;
		}
	}

	async function removeDevice(d: DeviceInfo) {
		if (d.current) {
			confirmLogout = true;
			return;
		}
		devicesBusy = true;
		try {
			await syncEngine.removeDevice(d.id);
			notice = t('sync.devices.removed', { name: d.name });
			devices = await syncEngine.listDevices();
		} catch (err) {
			formError = errorText(err);
		} finally {
			devicesBusy = false;
		}
	}

	// ---- advanced: backend url ---------------------------------------------------------
	let advanced = $state(user.settings.syncServerUrl ?? '');
	let advancedSaved = $state(false);
	const advancedInsecure = $derived(isInsecureUrl(advanced.trim()));
	async function saveAdvanced(e: SubmitEvent) {
		e.preventDefault();
		formError = null;
		const v = advanced.trim();
		if (v && !normalizeServerUrl(v)) return void (formError = t('sync.error.invalidUrl'));
		await user.updateSettings({
			syncServerUrl: v ? (normalizeServerUrl(v) ?? undefined) : undefined
		});
		advancedSaved = true;
	}

	const statusText = $derived(t('sync.status.' + syncEngine.status));
</script>

<svelte:head>
	<title>{t('account.title')} · PrismaStream</title>
</svelte:head>

{#if kids.restricted}
	<KidsLock />
{:else}
	<div class="page account">
		<header class="head">
			<p class="eyebrow">{t('account.eyebrow')}</p>
			<h1>{t('account.title')}</h1>
			<p class="lead">{configured ? t('account.leadIn') : t('account.lead')}</p>
		</header>

		<div class="live" aria-live="polite">
			{#if notice}<p class="notice"><Icon name="check" size="1.1rem" /> {notice}</p>{/if}
			{#if formError}<p class="error" role="alert">
					<Icon name="alert" size="1.1rem" />
					{formError}
				</p>{/if}
		</div>

		{#if !configured}
			<section class="panel glass">
				<div class="tabs" role="tablist" aria-label={t('account.title')}>
					{#each [['login', t('account.tab.login')], ['register', t('account.tab.register')], ['tv', t('account.tab.tv')]] as [id, label] (id)}
						<button
							type="button"
							role="tab"
							aria-selected={tab === id}
							class:active={tab === id}
							onclick={() => ((tab = id as Tab), (formError = null))}
							data-focusable
						>
							{label}
						</button>
					{/each}
				</div>

				{#if !serverUrl}
					<p class="warn"><Icon name="alert" size="1rem" /> {t('account.noServer')}</p>
				{:else if tab === 'tv'}
					<TvLogin {serverUrl} ondone={() => (notice = t('account.done.login'))} />
				{:else}
					<form class="form" onsubmit={tab === 'login' ? submitLogin : submitRegister} novalidate>
						<div class="field">
							<label for="acc-email">{t('account.email')}</label>
							<input
								id="acc-email"
								type="email"
								inputmode="email"
								autocomplete={tab === 'login' ? 'username' : 'email'}
								autocapitalize="off"
								spellcheck="false"
								bind:value={email}
								data-focusable
							/>
						</div>
						<PasswordField
							id="acc-pass"
							label={t('account.password')}
							bind:value={password}
							autocomplete={tab === 'login' ? 'current-password' : 'new-password'}
							meter={tab === 'register'}
						/>
						{#if tab === 'register'}
							<PasswordField
								id="acc-pass2"
								label={t('account.passwordConfirm')}
								bind:value={password2}
								autocomplete="new-password"
							/>
							<div class="field">
								<label for="acc-code">{t('account.signupCode')}</label>
								<input
									id="acc-code"
									type="text"
									autocomplete="off"
									autocapitalize="off"
									spellcheck="false"
									bind:value={signupCode}
									aria-describedby="acc-code-hint"
									data-focusable
								/>
								<p id="acc-code-hint" class="hint">{t('account.signupCode.hint')}</p>
							</div>
							<p class="hint">{t('account.password.e2e')}</p>
						{/if}
						<div class="actions">
							<Button variant="primary" type="submit" disabled={busy} icon="check" data-focusable>
								{#if tab === 'login'}
									{busy ? t('account.loggingIn') : t('account.loginAction')}
								{:else}
									{busy ? t('account.creating') : t('account.registerAction')}
								{/if}
							</Button>
						</div>
					</form>
				{/if}
			</section>
		{:else}
			<section class="panel glass">
				<div class="status-head">
					<h2>{t('account.status')}</h2>
					<span class="badge {syncEngine.status}" role="status">
						<span class="dot" aria-hidden="true"></span>{statusText}
					</span>
				</div>
				<dl class="facts">
					<div>
						<dt>{t('account.email')}</dt>
						<dd>{syncEngine.email ?? t('account.legacy')}</dd>
					</div>
					<div>
						<dt>{t('sync.thisDevice')}</dt>
						<dd>{syncEngine.deviceName}</dd>
					</div>
				</dl>
				<p class="muted">
					{syncEngine.lastSyncAt
						? t('sync.lastSync', { time: relTime(syncEngine.lastSyncAt) })
						: t('sync.never')}
					{#if syncEngine.pending > 0}· {t('sync.pending', { n: syncEngine.pending })}{/if}
				</p>
				{#if !needsPassword && !loggedOut}
					<div class="actions">
						<Button
							icon="refresh"
							disabled={syncEngine.status === 'syncing'}
							onclick={() => void syncEngine.syncNow()}
							data-focusable
						>
							{t('sync.syncNow')}
						</Button>
						{#if passwordAccount}
							<Button icon="monitor" href={path('/activate')} data-focusable>
								{t('account.tv.link')}
							</Button>
						{/if}
					</div>
				{/if}
			</section>

			{#if loggedOut}
				<section class="panel glass">
					<h2>{t('account.loggedOut.title')}</h2>
					<p class="muted">{t('account.loggedOut.body')}</p>
					<div class="actions">
						<Button
							variant="primary"
							onclick={() => void syncEngine.disable('local')}
							data-focusable
						>
							{t('account.loggedOut.action')}
						</Button>
					</div>
				</section>
			{:else if needsPassword || syncEngine.locked}
				<section class="panel glass">
					<h2>{t('account.unlock.title')}</h2>
					<p class="muted">{passwordAccount ? t('account.unlock.body') : t('sync.unlock.desc')}</p>
					<form class="form" onsubmit={submitUnlock}>
						<PasswordField
							id="acc-unlock"
							label={passwordAccount ? t('account.password') : t('sync.passphrase.label')}
							bind:value={unlockPass}
							autocomplete="current-password"
						/>
						<div class="actions">
							<Button variant="primary" type="submit" disabled={busy || !unlockPass} data-focusable>
								{busy ? t('sync.unlock.busy') : t('sync.unlock.action')}
							</Button>
						</div>
					</form>
				</section>
			{/if}

			<section class="panel glass">
				<div class="status-head">
					<h2>{t('sync.devices.title')}</h2>
					<Button
						variant="ghost"
						size="s"
						icon="refresh"
						disabled={devicesBusy}
						onclick={loadDevices}
						data-focusable
					>
						{devices ? t('sync.devices.refresh') : t('sync.devices.show')}
					</Button>
				</div>
				{#if devices}
					<ul class="devices">
						{#each devices as d (d.id)}
							<li>
								<div>
									<p class="dev-name">
										{d.name}
										{#if d.current}<span class="pill">{t('sync.devices.current')}</span>{/if}
									</p>
									<p class="hint">{t('sync.devices.lastSeen', { time: relTime(d.lastSeenAt) })}</p>
								</div>
								<Button
									variant="ghost"
									size="s"
									label={t('sync.devices.removeLabel', { name: d.name })}
									disabled={devicesBusy}
									onclick={() => removeDevice(d)}
									data-focusable
								>
									{t('sync.devices.remove')}
								</Button>
							</li>
						{/each}
					</ul>
				{/if}
			</section>

			{#if passwordAccount && !needsPassword && !loggedOut}
				<section class="panel glass">
					<div class="status-head">
						<h2>{t('account.change.title')}</h2>
						{#if !changeOpen}
							<Button
								variant="ghost"
								size="s"
								icon="key"
								onclick={() => (changeOpen = true)}
								data-focusable
							>
								{t('account.change.open')}
							</Button>
						{/if}
					</div>
					{#if changeOpen}
						<form class="form" onsubmit={submitChange} novalidate>
							<PasswordField
								id="acc-old"
								label={t('account.change.old')}
								bind:value={oldPass}
								autocomplete="current-password"
							/>
							<PasswordField
								id="acc-new"
								label={t('account.change.new')}
								bind:value={newPass}
								autocomplete="new-password"
								meter
							/>
							<PasswordField
								id="acc-new2"
								label={t('account.passwordConfirm')}
								bind:value={newPass2}
								autocomplete="new-password"
							/>
							<p class="hint">{t('account.change.hint')}</p>
							<div class="actions">
								<Button variant="primary" type="submit" disabled={busy} data-focusable>
									{busy ? t('account.change.busy') : t('account.change.action')}
								</Button>
								<Button
									variant="ghost"
									onclick={() => ((changeOpen = false), reset())}
									data-focusable
								>
									{t('common.cancel')}
								</Button>
							</div>
						</form>
					{/if}
				</section>
			{/if}

			<section class="panel glass">
				<h2>{t('account.logout.title')}</h2>
				<p class="muted">{t('account.logout.body')}</p>
				{#if confirmLogout}
					<div class="actions">
						<Button variant="primary" disabled={busy} onclick={logout} data-focusable>
							{t('account.logout.confirm')}
						</Button>
						<Button variant="ghost" onclick={() => (confirmLogout = false)} data-focusable>
							{t('common.cancel')}
						</Button>
					</div>
				{:else}
					<div class="actions">
						<Button icon="close" onclick={() => (confirmLogout = true)} data-focusable>
							{t('account.logout.action')}
						</Button>
					</div>
				{/if}
			</section>
		{/if}

		<section class="panel glass">
			<h2>{t('sync.what.title')}</h2>
			<ul class="what">
				{#each ['profiles', 'prefs', 'data', 'home', 'settings'] as k (k)}
					<li><Icon name="check" size="1rem" /> {t('sync.what.' + k)}</li>
				{/each}
				<li><Icon name="check" size="1rem" /> {t('account.what.sources')}</li>
			</ul>
			<p class="muted small">{t('account.e2e')}</p>
		</section>

		<details class="panel glass advanced">
			<summary data-focusable>{t('account.advanced.title')}</summary>
			<form class="form" onsubmit={saveAdvanced}>
				<div class="field">
					<label for="acc-server">{t('account.advanced.server')}</label>
					<input
						id="acc-server"
						type="url"
						inputmode="url"
						autocapitalize="off"
						spellcheck="false"
						placeholder={DEFAULT_BACKEND_URL ?? 'https://'}
						bind:value={advanced}
						oninput={() => (advancedSaved = false)}
						disabled={configured}
						data-focusable
					/>
					<p class="hint">
						{configured ? t('account.advanced.locked') : t('account.advanced.hint')}
					</p>
					{#if advancedInsecure}
						<p class="warn"><Icon name="alert" size="1rem" /> {t('sync.server.insecure')}</p>
					{/if}
				</div>
				{#if !configured}
					<div class="actions">
						<Button variant="glass" type="submit" data-focusable>{t('common.save')}</Button>
						{#if advancedSaved}<span class="ok">{t('settings.saved')}</span>{/if}
					</div>
				{/if}
			</form>
		</details>
	</div>
{/if}

<style>
	.account {
		max-width: 52rem;
		display: grid;
		gap: 1.25rem;
	}
	.head h1 {
		font-size: var(--text-2xl);
		margin: 0.35rem 0 0.5rem;
	}
	.lead {
		color: var(--text-2);
		font-size: var(--text-l);
		line-height: 1.5;
		max-width: 44rem;
	}
	.panel {
		border-radius: var(--radius-l);
		padding: clamp(1.1rem, 0.8rem + 1.2vw, 1.75rem);
		display: grid;
		gap: 0.9rem;
		min-width: 0;
	}
	.panel h2 {
		font-size: var(--text-l);
	}
	.muted,
	.hint {
		color: var(--text-3);
	}
	.hint,
	.small {
		font-size: var(--text-s);
	}
	.live:empty {
		display: none;
	}
	.notice,
	.error,
	.warn {
		display: flex;
		gap: 0.5rem;
		align-items: flex-start;
		border-radius: var(--radius-m);
		padding: 0.75rem 0.9rem;
	}
	.notice {
		background: color-mix(in oklab, var(--success) 14%, transparent);
		color: var(--success);
	}
	.error {
		background: color-mix(in oklab, var(--danger) 14%, transparent);
		color: var(--danger);
	}
	.warn {
		background: color-mix(in oklab, var(--rating) 12%, transparent);
		color: var(--rating);
		font-size: var(--text-s);
	}
	.tabs {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		padding: 0.3rem;
		border-radius: var(--radius-pill);
		background: rgb(255 255 255 / 0.04);
		border: 1px solid var(--line);
		justify-self: start;
		max-width: 100%;
	}
	.tabs button {
		min-height: 2.5rem;
		padding: 0 1rem;
		border: 0;
		border-radius: var(--radius-pill);
		background: none;
		color: var(--text-2);
		font-weight: 650;
	}
	.tabs button.active {
		background: var(--bg-elev-3);
		color: var(--text);
	}
	.form {
		display: grid;
		gap: 1rem;
		min-width: 0;
	}
	.field {
		display: grid;
		gap: 0.4rem;
		min-width: 0;
	}
	.field label {
		font-weight: 650;
		font-size: var(--text-s);
	}
	input[type='email'],
	input[type='text'],
	input[type='url'] {
		width: 100%;
		min-width: 0;
		min-height: 2.75rem;
		font: inherit;
		color: var(--text);
		background: rgb(255 255 255 / 0.04);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-m);
		padding: 0 0.9rem;
	}
	input:focus-visible {
		outline: none;
		box-shadow: var(--focus-ring);
	}
	input:disabled {
		opacity: 0.6;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
		align-items: center;
	}
	.ok {
		color: var(--success);
		font-size: var(--text-s);
	}
	.status-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
		flex-wrap: wrap;
	}
	.badge {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.3rem 0.7rem;
		border-radius: var(--radius-pill);
		background: rgb(255 255 255 / 0.06);
		font-size: var(--text-s);
		font-weight: 650;
	}
	.dot {
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
		background: var(--text-3);
	}
	.badge.idle .dot {
		background: var(--success);
	}
	.badge.syncing .dot {
		background: var(--accent);
	}
	.badge.error .dot,
	.badge.offline .dot {
		background: var(--danger);
	}
	.facts {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(14rem, 100%), 1fr));
		gap: 0.75rem;
	}
	.facts dt {
		color: var(--text-3);
		font-size: var(--text-s);
	}
	.facts dd {
		font-weight: 650;
		overflow-wrap: anywhere;
	}
	.devices {
		display: grid;
		gap: 0.5rem;
		list-style: none;
		padding: 0;
	}
	.devices li {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
		padding: 0.6rem 0;
		border-bottom: 1px solid var(--line);
	}
	.dev-name {
		font-weight: 650;
	}
	.pill {
		margin-left: 0.4rem;
		padding: 0.1rem 0.5rem;
		border-radius: var(--radius-pill);
		background: var(--accent-faint);
		color: var(--accent);
		font-size: var(--text-xs, 0.75rem);
	}
	.what {
		display: grid;
		gap: 0.45rem;
		list-style: none;
		padding: 0;
		color: var(--text-2);
	}
	.what li {
		display: flex;
		gap: 0.5rem;
		align-items: center;
	}
	.advanced summary {
		cursor: pointer;
		font-weight: 700;
	}
</style>
