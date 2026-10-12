<script lang="ts">
	import { t } from '#lib/i18n/index.svelte.ts';
	import Icon from './Icon.svelte';
	import AppIcon from '#lib/components/Icon.svelte';

	interface Props {
		/** null = loading spinner. */
		message: string | null;
		/** Secondary text under the message. */
		detail?: string;
		/** 'blocked' = calm lock state (e.g. kids mode) instead of an error. */
		kind?: 'error' | 'blocked';
		onBack: () => void;
		onRetry?: () => void;
	}

	let { message, detail, kind = 'error', onBack, onRetry }: Props = $props();

	function onKey(e: KeyboardEvent) {
		if (['Escape', 'Backspace', 'GoBack', 'BrowserBack'].includes(e.key)) {
			e.preventDefault();
			onBack();
		}
	}
</script>

<svelte:window onkeydown={onKey} />

<div class="screen">
	<button type="button" class="back" data-focusable aria-label={t('player.back')} onclick={onBack}>
		<Icon name="back" size={30} />
	</button>
	{#if message === null}
		<div class="spinner" role="status" aria-label={t('player.loading')}><span></span></div>
	{:else}
		<div class="msg" class:blocked={kind === 'blocked'} role="alert">
			{#if kind === 'blocked'}
				<span class="lock"><AppIcon name="lock" size="2rem" /></span>
				<h1>{message}</h1>
				{#if detail}<p>{detail}</p>{/if}
			{:else}
				<Icon name="alert" size={40} />
				<p>{message}</p>
				{#if detail}<p>{detail}</p>{/if}
			{/if}
			<div class="actions">
				{#if onRetry}
					<button type="button" class="btn primary" data-focusable onclick={onRetry}>
						{t('player.retry')}
					</button>
				{/if}
				<button type="button" class="btn" data-focusable onclick={onBack}>{t('player.back')}</button
				>
			</div>
		</div>
	{/if}
</div>

<style>
	.screen {
		position: fixed;
		inset: 0;
		display: grid;
		place-items: center;
		padding: var(--gutter);
		background: var(--bg);
		color: var(--text);
	}
	.back {
		position: absolute;
		top: calc(var(--safe-top) + 18px);
		left: max(var(--gutter), env(safe-area-inset-left, 0px));
		display: grid;
		place-items: center;
		width: 48px;
		height: 48px;
		border: 0;
		border-radius: 50%;
		background: transparent;
		cursor: pointer;
	}
	.back:hover {
		background: var(--line);
	}
	.spinner span {
		display: block;
		width: 56px;
		height: 56px;
		border-radius: 50%;
		border: 4px solid var(--line-strong);
		border-top-color: var(--accent);
		animation: spin 0.9s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	.msg {
		display: grid;
		justify-items: center;
		gap: 12px;
		max-width: 420px;
		text-align: center;
	}
	.msg :global(svg) {
		color: var(--danger);
	}
	.msg.blocked :global(svg) {
		color: var(--text);
	}
	.lock {
		display: grid;
		place-items: center;
		width: 4.5rem;
		height: 4.5rem;
		border-radius: 50%;
		background: var(--bg-elev-2);
		border: 1px solid var(--line);
	}
	.msg h1 {
		margin: 0;
		font-size: var(--text-xl);
		font-weight: 800;
	}
	.msg p {
		margin: 0;
		color: var(--text-2);
		line-height: 1.5;
	}
	.actions {
		display: flex;
		gap: 10px;
	}
	.btn {
		min-height: 46px;
		padding: 0 20px;
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-pill);
		background: var(--bg-elev-2);
		font-weight: 700;
		cursor: pointer;
	}
	.btn.primary {
		background: var(--accent);
		color: var(--accent-contrast);
		border-color: transparent;
	}
</style>
