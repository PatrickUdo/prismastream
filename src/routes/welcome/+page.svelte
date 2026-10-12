<!--
	Welcome: the only screen without an account (production login gate, see #lib/session).
	Log in, create an account with an invitation code, or log in with a tv code (QR). After
	logging in: the first sync (profiles), then the profile choice when there are several,
	then the page that was asked for (?next=).
-->
<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { t } from '#lib/i18n/index.svelte.ts';
	import { library } from '#lib/catalog/library.svelte.ts';
	import { syncEngine } from '#lib/sync/index.ts';
	import { inputMode } from '#lib/tv/mode.svelte.ts';
	import { safeNext, session } from '#lib/session.svelte.ts';
	import { path } from '#lib/components/links.ts';
	import AuthShell from '#lib/components/account/AuthShell.svelte';
	import AccountForm, { type AccountTab } from '#lib/components/account/AccountForm.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import { resetProfileChosen } from '../(app)/profiles/session.ts';

	const next = $derived(safeNext(page.url.searchParams.get('next')));
	const reason = $derived(page.url.searchParams.get('reason') ?? session.notice);

	let tab = $state<AccountTab>(
		page.url.searchParams.get('tab') === 'register' ? 'register' : 'login'
	);
	let tvDefaulted = false;
	// On a tv (remote control, no keyboard) the code login comes first.
	$effect(() => {
		if (tvDefaulted || !inputMode.tv) return;
		tvDefaulted = true;
		tab = 'tv';
	});

	let finishing = $state(false);

	async function finish() {
		finishing = true;
		session.notice = null;
		resetProfileChosen();
		// Wait (briefly) for the first sync so the profile choice shows the account's profiles.
		await Promise.race([
			syncEngine.syncNow().catch(() => undefined),
			new Promise((r) => setTimeout(r, 8000))
		]);
		await goto(path(next), { replaceState: true });
	}

	// Already logged in (e.g. opened /welcome by hand): straight on.
	let checked = false;
	$effect(() => {
		if (checked || !library.initialized) return;
		checked = true;
		if (session.loggedIn) void goto(path(next), { replaceState: true });
	});
</script>

<svelte:head>
	<title>{t('welcome.title')} · PrismaStream</title>
</svelte:head>

{#snippet aside()}
	<p class="eyebrow">{t('welcome.eyebrow')}</p>
	<h1>{t('welcome.title')}</h1>
	<p class="lead">{t('welcome.lead')}</p>
	<ul class="points">
		<li><Icon name="sparkle" size="1.1rem" /> {t('welcome.point.merge')}</li>
		<li><Icon name="monitor" size="1.1rem" /> {t('welcome.point.devices')}</li>
		<li><Icon name="lock" size="1.1rem" /> {t('welcome.point.private')}</li>
	</ul>
{/snippet}

<AuthShell {aside}>
	<div class="card-body">
		{#if reason === 'expired'}
			<p class="notice warn" role="status">
				<Icon name="alert" size="1.1rem" />
				{t('welcome.expired')}
			</p>
		{:else if reason === 'logout'}
			<p class="notice" role="status">
				<Icon name="check" size="1.1rem" />
				{t('welcome.loggedOut')}
			</p>
		{/if}

		{#if finishing}
			<div class="finishing" role="status" aria-live="polite">
				<span class="spinner" aria-hidden="true"></span>
				<p>{t('welcome.finishing')}</p>
			</div>
		{:else}
			<AccountForm serverUrl={library.backendUrl ?? ''} bind:tab onsuccess={finish} />
		{/if}
	</div>
</AuthShell>

<style>
	.eyebrow {
		color: var(--accent-strong, var(--accent));
		font-size: var(--text-s);
		font-weight: 700;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}
	h1 {
		margin: 0.6rem 0 0.9rem;
		font-size: clamp(2.1rem, 1.4rem + 3vw, 3.6rem);
		font-weight: 800;
		line-height: 1.05;
		letter-spacing: -0.02em;
		text-wrap: balance;
	}
	.lead {
		color: var(--text-2);
		font-size: var(--text-l);
		line-height: 1.55;
		max-width: 32rem;
	}
	.points {
		display: grid;
		gap: 0.6rem;
		margin-top: 1.5rem;
		padding: 0;
		list-style: none;
		color: var(--text-2);
	}
	.points li {
		display: flex;
		gap: 0.6rem;
		align-items: center;
	}
	.points :global(.icon) {
		color: var(--accent);
		flex: none;
	}
	@media (max-width: 899.98px) {
		.points {
			display: none;
		}
		h1 {
			font-size: clamp(1.8rem, 1.3rem + 3vw, 2.4rem);
			text-align: center;
		}
		.eyebrow,
		.lead {
			text-align: center;
			margin-inline: auto;
		}
	}
	.card-body {
		display: grid;
		gap: 1rem;
		min-width: 0;
	}
	.notice {
		display: flex;
		gap: 0.5rem;
		align-items: flex-start;
		border-radius: var(--radius-m);
		padding: 0.75rem 0.9rem;
		background: color-mix(in oklab, var(--success) 14%, transparent);
		color: var(--success);
	}
	.notice.warn {
		background: color-mix(in oklab, var(--rating) 12%, transparent);
		color: var(--rating);
	}
	.finishing {
		display: grid;
		justify-items: center;
		gap: 0.9rem;
		padding: 2rem 0;
		color: var(--text-2);
	}
	.spinner {
		width: 1.6rem;
		height: 1.6rem;
		border-radius: 50%;
		border: 2.5px solid var(--line-strong);
		border-top-color: var(--accent);
		animation: spin 0.9s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
