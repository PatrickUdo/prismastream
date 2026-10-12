<!--
	Log in / create an account (e-mail, password, invitation code) / log in with a tv code.
	Shared by the welcome screen (/welcome) and Settings → Account. Zero-knowledge: the password
	only feeds the key derivation on this device (see #lib/sync/crypto.ts).
-->
<script lang="ts" module>
	export type AccountTab = 'login' | 'register' | 'tv';
</script>

<script lang="ts">
	import { t } from '#lib/i18n/index.svelte.ts';
	import { syncEngine, SyncFailure, defaultDeviceName } from '#lib/sync/index.ts';
	import { passwordStrength } from '#lib/sync/crypto.ts';
	import Button from '../Button.svelte';
	import Icon from '../Icon.svelte';
	import ErrorDetails from '../ErrorDetails.svelte';
	import { errorDetail } from '#lib/backend/errors.ts';
	import PasswordField from './PasswordField.svelte';
	import TvLogin from './TvLogin.svelte';

	interface Props {
		serverUrl: string;
		tab?: AccountTab;
		/** Called after a successful login, registration or tv login. */
		onsuccess?: (kind: AccountTab) => void | Promise<void>;
		/** Hide the "with a code" tab (e.g. on a page that only approves tvs). */
		allowTv?: boolean;
	}

	let { serverUrl, tab = $bindable('login'), onsuccess, allowTv = true }: Props = $props();

	let email = $state('');
	let password = $state('');
	let password2 = $state('');
	let signupCode = $state('');
	let busy = $state(false);
	let formError = $state<string | null>(null);
	let formDetail = $state<string | null>(null);

	const strength = $derived(passwordStrength(password));
	const tabs = $derived(
		(
			[
				['login', t('account.tab.login')],
				['register', t('account.tab.register')],
				['tv', t('account.tab.tv')]
			] as [AccountTab, string][]
		).filter(([id]) => allowTv || id !== 'tv')
	);

	function errorText(err: unknown): string {
		if (err instanceof SyncFailure) return t('sync.error.' + err.code);
		return t('sync.error.unknown');
	}

	const validEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

	function select(id: AccountTab) {
		tab = id;
		formError = null;
	}

	async function done(kind: AccountTab) {
		password = password2 = signupCode = '';
		await onsuccess?.(kind);
	}

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		formError = null;
		if (!serverUrl) return void (formError = t('account.noServer'));
		if (!validEmail(email)) return void (formError = t('sync.error.invalidEmail'));
		if (tab === 'login') {
			if (!password) return void (formError = t('sync.error.invalidLogin'));
		} else {
			if (!strength.acceptable) return void (formError = t('account.password.tooWeak'));
			if (password !== password2) return void (formError = t('account.password.mismatch'));
			if (!signupCode.trim()) return void (formError = t('account.signupCode.required'));
		}
		busy = true;
		try {
			if (tab === 'login') await syncEngine.login(serverUrl, email, password, defaultDeviceName());
			else await syncEngine.register(serverUrl, email, password, signupCode, defaultDeviceName());
			await done(tab);
		} catch (err) {
			formError = errorText(err);
			formDetail = err instanceof SyncFailure ? `SyncFailure: ${err.code}` : errorDetail(err);
		} finally {
			busy = false;
		}
	}
</script>

<div class="account-form">
	<div class="tabs" role="tablist" aria-label={t('account.title')}>
		{#each tabs as [id, label] (id)}
			<button
				type="button"
				role="tab"
				aria-selected={tab === id}
				class:active={tab === id}
				onclick={() => select(id)}
				data-focusable
			>
				{label}
			</button>
		{/each}
	</div>

	{#if formError}
		<p class="error" role="alert"><Icon name="alert" size="1.1rem" /> {formError}</p>
		<ErrorDetails text={formDetail} />
	{/if}

	{#if !serverUrl}
		<p class="warn"><Icon name="alert" size="1rem" /> {t('account.noServer')}</p>
	{:else if tab === 'tv'}
		<TvLogin {serverUrl} ondone={() => void done('tv')} />
	{:else}
		<form class="form" onsubmit={submit} novalidate>
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
				<Button variant="primary" size="l" type="submit" disabled={busy} data-focusable>
					{#if tab === 'login'}
						{busy ? t('account.loggingIn') : t('account.loginAction')}
					{:else}
						{busy ? t('account.creating') : t('account.registerAction')}
					{/if}
				</Button>
			</div>
		</form>
	{/if}
</div>

<style>
	.account-form {
		display: grid;
		gap: 1.1rem;
		min-width: 0;
	}
	.tabs {
		display: grid;
		grid-auto-flow: column;
		grid-auto-columns: minmax(0, 1fr);
		gap: 0.25rem;
		padding: 0.3rem;
		border-radius: var(--radius-m);
		background: rgb(255 255 255 / 0.04);
		border: 1px solid var(--line);
		min-width: 0;
	}
	.tabs button {
		min-height: 2.6rem;
		padding: 0.35rem 0.5rem;
		border: 0;
		border-radius: calc(var(--radius-m) - 4px);
		background: none;
		color: var(--text-2);
		font: inherit;
		font-size: var(--text-s);
		font-weight: 650;
		line-height: 1.2;
		text-align: center;
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
	input[type='text'] {
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
	.hint {
		color: var(--text-3);
		font-size: var(--text-s);
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
	}
	.error,
	.warn {
		display: flex;
		gap: 0.5rem;
		align-items: flex-start;
		border-radius: var(--radius-m);
		padding: 0.75rem 0.9rem;
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
</style>
