<!--
	Tv login (Android TV, web in tv mode, anything without a comfortable keyboard): shows a code
	and a QR code of the activation url, and waits until a logged-in device approves it. The
	E2E key arrives sealed (ECDH) and is opened on this device only.
-->
<script lang="ts">
	import { onDestroy } from 'svelte';
	import { t } from '#lib/i18n/index.svelte.ts';
	import { syncEngine, SyncFailure, defaultDeviceName } from '#lib/sync/index.ts';
	import { appOrigin } from '#lib/backend/config.ts';
	import Qr from '../Qr.svelte';
	import Button from '../Button.svelte';
	import Icon from '../Icon.svelte';

	interface Props {
		serverUrl: string;
		ondone?: () => void;
	}

	let { serverUrl, ondone }: Props = $props();

	let code = $state<string | null>(null);
	let verifyUrl = $state('');
	let expiresAt = $state(0);
	let now = $state(Date.now());
	let error = $state<string | null>(null);
	let busy = $state(false);
	let ctrl: AbortController | null = null;

	const tick = setInterval(() => (now = Date.now()), 1000);
	onDestroy(() => {
		clearInterval(tick);
		ctrl?.abort();
	});

	async function start() {
		ctrl?.abort();
		const c = new AbortController();
		ctrl = c;
		error = null;
		code = null;
		busy = true;
		try {
			const s = await syncEngine.startDeviceLogin(serverUrl, defaultDeviceName());
			if (c.signal.aborted) return;
			code = s.userCode;
			expiresAt = s.expiresAt;
			const base = s.verifyUrl || `${appOrigin()}/activate`;
			verifyUrl = `${base}${base.includes('?') ? '&' : '?'}code=${encodeURIComponent(s.userCode)}`;
			busy = false;
			await s.wait(c.signal);
			ondone?.();
		} catch (err) {
			if (c.signal.aborted) return;
			busy = false;
			code = null;
			error = err instanceof SyncFailure ? t('sync.error.' + err.code) : t('sync.error.unknown');
		}
	}

	$effect(() => {
		void start();
		return () => ctrl?.abort();
	});

	const left = $derived(Math.max(0, Math.round((expiresAt - now) / 1000)));
	const countdown = $derived(`${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`);
</script>

<section class="tv" aria-labelledby="tv-title">
	<h2 id="tv-title">{t('account.tv.title')}</h2>
	{#if code}
		<div class="layout">
			<div class="qr-wrap">
				<Qr value={verifyUrl} label={t('account.tv.qr')} size="13rem" />
			</div>
			<ol class="steps">
				<li>{t('account.tv.step1')}</li>
				<li>
					{t('account.tv.step2')}
					<span class="url">{verifyUrl.replace(/^https?:\/\//, '').split('?')[0]}</span>
				</li>
				<li>{t('account.tv.step3')}</li>
				<li class="code-li">
					<span class="code" aria-label={t('sync.code.aria', { code: code.split('').join(' ') })}
						>{code}</span
					>
				</li>
			</ol>
		</div>
		<p class="wait" role="status">
			<span class="spinner" aria-hidden="true"></span>
			{t('account.tv.waiting')} · <Icon name="clock" size="0.95rem" />
			{countdown}
		</p>
	{:else if busy}
		<p class="wait" role="status">
			<span class="spinner" aria-hidden="true"></span>{t('common.loading')}
		</p>
	{/if}
	{#if error}
		<p class="error" role="alert"><Icon name="alert" size="1.1rem" /> {error}</p>
		<Button variant="primary" icon="refresh" onclick={() => void start()} data-focusable>
			{t('account.tv.newCode')}
		</Button>
	{/if}
</section>

<style>
	.tv {
		display: grid;
		gap: 1.25rem;
		min-width: 0;
	}
	h2 {
		font-size: var(--text-l);
		font-weight: 750;
	}
	.layout {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		gap: 1.75rem;
		align-items: center;
	}
	@media (max-width: 599.98px) {
		.layout {
			grid-template-columns: minmax(0, 1fr);
			justify-items: center;
		}
	}
	.qr-wrap {
		padding: 0.6rem;
		border-radius: var(--radius-l);
		background: #fff;
	}
	.steps {
		display: grid;
		gap: 0.6rem;
		padding-left: 1.2rem;
		color: var(--text-2);
		min-width: 0;
	}
	.url {
		display: block;
		color: var(--text);
		font-weight: 700;
		overflow-wrap: anywhere;
	}
	.code-li {
		list-style: none;
		margin-left: -1.2rem;
	}
	.code {
		display: inline-block;
		padding: 0.5rem 1rem;
		border-radius: var(--radius-m);
		background: var(--bg-elev-2);
		color: var(--text);
		font-size: clamp(1.8rem, 1.2rem + 2vw, 2.6rem);
		font-weight: 800;
		letter-spacing: 0.12em;
		font-variant-numeric: tabular-nums;
	}
	.wait {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		color: var(--text-3);
		font-size: var(--text-s);
	}
	.spinner {
		width: 1rem;
		height: 1rem;
		border-radius: 50%;
		border: 2px solid var(--line-strong);
		border-top-color: var(--accent);
		animation: spin 0.9s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	.error {
		display: flex;
		gap: 0.5rem;
		color: #ff8a8a;
	}
</style>
