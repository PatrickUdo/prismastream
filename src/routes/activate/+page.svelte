<!--
	/activate: approve a tv (or other device) that shows a login code. The account's E2E key
	is sealed for that device (ECDH) on this device; the server never sees it.
-->
<script lang="ts">
	import { page } from '$app/state';
	import { t } from '#lib/i18n/index.svelte.ts';
	import { syncEngine, SyncFailure, initSync } from '#lib/sync/index.ts';
	import { normalizeUserCode } from '#lib/sync/engine.svelte.ts';
	import Button from '#lib/components/Button.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import PasswordField from '#lib/components/account/PasswordField.svelte';
	import { path } from '#lib/components/links.ts';
	import { kids } from '#lib/stores/kids.svelte.ts';
	import KidsLock from '#lib/components/KidsLock.svelte';
	import AuthShell from '#lib/components/account/AuthShell.svelte';
	import AccountForm from '#lib/components/account/AccountForm.svelte';
	import { library } from '#lib/catalog/library.svelte.ts';

	$effect(() => {
		void initSync();
	});

	let code = $state(page.url.searchParams.get('code') ?? '');
	let device = $state<{ deviceName: string; publicKey: string; code: string } | null>(null);
	let password = $state('');
	let busy = $state(false);
	let error = $state<string | null>(null);
	let done = $state<string | null>(null);

	const ready = $derived(syncEngine.configured && syncEngine.authMode === 'password');

	function errorText(err: unknown): string {
		if (err instanceof SyncFailure)
			return err.code === 'server' ? t('account.activate.notFound') : t('sync.error.' + err.code);
		return t('sync.error.unknown');
	}

	async function find(e?: SubmitEvent) {
		e?.preventDefault();
		error = done = null;
		const c = normalizeUserCode(code);
		if (c.replace('-', '').length !== 8) return void (error = t('account.activate.invalid'));
		busy = true;
		try {
			const d = await syncEngine.lookupDevice(c);
			device = { ...d, code: c };
		} catch (err) {
			error = errorText(err);
			device = null;
		} finally {
			busy = false;
		}
	}

	async function approve(e: SubmitEvent) {
		e.preventDefault();
		if (!device) return;
		error = null;
		busy = true;
		try {
			await syncEngine.approveDevice(device.code, device.publicKey, password || undefined);
			done = t('account.activate.done', { name: device.deviceName });
			device = null;
			code = '';
			password = '';
		} catch (err) {
			error = errorText(err);
		} finally {
			busy = false;
		}
	}

	// A code from the QR link: look it up right away once logged in.
	let auto = false;
	$effect(() => {
		if (!auto && ready && code) {
			auto = true;
			void find();
		}
	});
</script>

<svelte:head>
	<title>{t('account.activate.title')} · PrismaStream</title>
</svelte:head>

{#if kids.restricted}
	<KidsLock />
{:else}
	<AuthShell>
		<div class="activate">
			<header class="head">
				<p class="eyebrow">{t('account.eyebrow')}</p>
				<h1>{t('account.activate.title')}</h1>
				<p class="lead">{t('account.activate.lead')}</p>
			</header>

			{#if done}
				<p class="notice" role="status"><Icon name="check" size="1.1rem" /> {done}</p>
			{/if}
			{#if error}
				<p class="error" role="alert"><Icon name="alert" size="1.1rem" /> {error}</p>
			{/if}

			{#if !syncEngine.configured}
				<section class="panel">
					<p class="muted">{t('account.activate.loginFirst')}</p>
					<AccountForm serverUrl={library.backendUrl ?? ''} allowTv={false} />
				</section>
			{:else if !ready}
				<section class="panel">
					<p>{t('account.activate.legacy')}</p>
				</section>
			{:else if device}
				<section class="panel">
					<h2>{t('account.activate.confirmTitle')}</h2>
					<p class="device">
						<Icon name="monitor" size="1.3rem" /> <strong>{device.deviceName}</strong>
					</p>
					<p class="muted">{t('account.activate.confirmBody')}</p>
					<form class="form" onsubmit={approve}>
						{#if !syncEngine.hasMasterKey}
							<PasswordField
								id="act-pass"
								label={t('account.password')}
								bind:value={password}
								autocomplete="current-password"
								hint={t('account.activate.passwordHint')}
							/>
						{/if}
						<div class="actions">
							<Button
								variant="primary"
								type="submit"
								icon="check"
								disabled={busy || (!syncEngine.hasMasterKey && !password)}
								data-focusable
							>
								{busy ? t('account.activate.busy') : t('account.activate.approve')}
							</Button>
							<Button variant="ghost" onclick={() => (device = null)} data-focusable>
								{t('common.cancel')}
							</Button>
						</div>
					</form>
				</section>
			{:else}
				<section class="panel">
					<form class="form" onsubmit={find}>
						<div class="field">
							<label for="act-code">{t('account.activate.code')}</label>
							<input
								id="act-code"
								class="code"
								type="text"
								autocomplete="one-time-code"
								autocapitalize="characters"
								spellcheck="false"
								maxlength="9"
								placeholder="ABCD-1234"
								bind:value={code}
								data-focusable
							/>
						</div>
						<div class="actions">
							<Button
								variant="primary"
								type="submit"
								disabled={busy || !code.trim()}
								data-focusable
							>
								{busy ? t('common.loading') : t('account.activate.next')}
							</Button>
						</div>
					</form>
				</section>
			{/if}
			{#if syncEngine.configured}
				<a class="home" href={path('/')} data-focusable>{t('account.activate.toApp')}</a>
			{/if}
		</div>
	</AuthShell>
{/if}

<style>
	.activate {
		display: grid;
		gap: 1.25rem;
		min-width: 0;
	}
	.home {
		justify-self: start;
		color: var(--text-2);
		font-size: var(--text-s);
		font-weight: 650;
		text-decoration: underline;
		text-underline-offset: 0.2em;
	}
	h1 {
		font-size: var(--text-2xl);
		margin: 0.35rem 0 0.5rem;
	}
	.lead {
		color: var(--text-2);
		font-size: var(--text-l);
	}
	.panel {
		display: grid;
		gap: 0.9rem;
		min-width: 0;
	}
	.panel h2 {
		font-size: var(--text-l);
	}
	.muted {
		color: var(--text-3);
	}
	.device {
		display: flex;
		gap: 0.6rem;
		align-items: center;
		font-size: var(--text-l);
	}
	.form {
		display: grid;
		gap: 1rem;
	}
	.field {
		display: grid;
		gap: 0.4rem;
	}
	label {
		font-weight: 650;
		font-size: var(--text-s);
	}
	.code {
		width: 100%;
		min-height: 3.25rem;
		padding: 0 1rem;
		border-radius: var(--radius-m);
		border: 1px solid var(--line-strong);
		background: rgb(255 255 255 / 0.04);
		color: var(--text);
		font: inherit;
		font-size: 1.5rem;
		font-weight: 750;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}
	.code:focus-visible {
		outline: none;
		box-shadow: var(--focus-ring);
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
	}
	.notice,
	.error {
		display: flex;
		gap: 0.5rem;
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
</style>
