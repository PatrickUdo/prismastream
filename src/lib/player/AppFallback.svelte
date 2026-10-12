<!--
	Web only: this stream cannot play in the browser (plain http on an https page, or blocked by
	CORS). Points to the PrismaStream apps, and on phones offers "Open in VLC".
-->
<script lang="ts">
	import { t } from '#lib/i18n/index.svelte.ts';
	import Icon from './Icon.svelte';
	import AppIcon from '#lib/components/Icon.svelte';
	import { APP_LINKS } from '#lib/backend/config.ts';
	import { mobileOs, vlcUrl } from './play-url.ts';

	interface Props {
		/** The stream url (only used for the VLC link; never shown or logged). */
		url?: string;
		/** 'mixed' = http stream on an https page; 'error' = the browser could not load it. */
		reason: 'mixed' | 'error';
		onBack: () => void;
		onRetry?: () => void;
	}

	let { url, reason, onBack, onRetry }: Props = $props();

	const os = mobileOs();
	const vlc = $derived(url ? vlcUrl(url, os) : null);
	const stores = $derived(
		[
			{ id: 'ios', label: t('player.app.ios'), href: APP_LINKS.ios },
			{ id: 'android', label: t('player.app.android'), href: APP_LINKS.android },
			{ id: 'tv', label: t('player.app.appletv'), href: APP_LINKS.appletv }
		].sort((a, b) => Number(b.id === os) - Number(a.id === os))
	);

	function onKey(e: KeyboardEvent) {
		if (['Escape', 'Backspace', 'GoBack', 'BrowserBack'].includes(e.key)) {
			e.preventDefault();
			onBack();
		}
	}
</script>

<svelte:window onkeydown={onKey} />

<div class="screen" data-app-fallback>
	<button type="button" class="back" data-focusable aria-label={t('player.back')} onclick={onBack}>
		<Icon name="back" size={30} />
	</button>
	<div class="msg" role="alert">
		<span class="ico"><AppIcon name="monitor" size="2rem" /></span>
		<h1>{t('player.app.title')}</h1>
		<p>{reason === 'mixed' ? t('player.app.bodyMixed') : t('player.app.bodyError')}</p>
		<div class="stores">
			{#each stores as s (s.id)}
				<a
					class="btn"
					class:primary={s.id === os}
					href={s.href}
					target="_blank"
					rel="noopener"
					data-focusable>{s.label}</a
				>
			{/each}
		</div>
		<div class="actions">
			{#if vlc}
				<a class="btn" href={vlc} data-focusable>{t('player.app.vlc')}</a>
			{/if}
			{#if onRetry}
				<button type="button" class="btn" data-focusable onclick={onRetry}
					>{t('player.retry')}</button
				>
			{/if}
			<button type="button" class="btn" data-focusable onclick={onBack}>{t('player.back')}</button>
		</div>
	</div>
</div>

<style>
	.screen {
		position: fixed;
		inset: 0;
		z-index: 20;
		display: grid;
		place-items: center;
		padding: var(--gutter);
		background:
			radial-gradient(50rem 30rem at 50% 0%, var(--accent-faint), transparent 70%), var(--bg);
		color: var(--text);
		overflow-y: auto;
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
		color: var(--text);
		cursor: pointer;
	}
	.msg {
		display: grid;
		justify-items: center;
		gap: 1rem;
		max-width: 32rem;
		text-align: center;
	}
	.ico {
		display: grid;
		place-items: center;
		width: 4.5rem;
		height: 4.5rem;
		border-radius: 50%;
		background: var(--accent-faint);
		color: var(--accent);
	}
	h1 {
		font-size: clamp(1.4rem, 1.1rem + 1.4vw, 2rem);
		font-weight: 800;
		text-wrap: balance;
	}
	p {
		color: var(--text-2);
		line-height: 1.55;
	}
	.stores,
	.actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 0.6rem;
	}
	.btn {
		display: inline-flex;
		align-items: center;
		min-height: 2.75rem;
		padding: 0 1.1rem;
		border-radius: var(--radius-pill);
		border: 1px solid var(--line-strong);
		background: rgb(255 255 255 / 0.04);
		color: var(--text);
		font: inherit;
		font-weight: 650;
		text-decoration: none;
		cursor: pointer;
	}
	.btn.primary {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--accent-contrast, #fff);
	}
</style>
