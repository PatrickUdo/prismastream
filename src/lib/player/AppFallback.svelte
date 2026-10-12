<!--
	Web only, shown after a real playback failure (see web-playback.ts):
	- mixed-chromium: step-by-step "allow insecure content" for Chrome, Edge, Brave and Opera,
	  then "Opnieuw proberen" (reloads only the player);
	- mixed-other: Safari/Firefox cannot play http on an https page: the apps, copy the stream
	  link, or open it in VLC (.m3u generated on this device);
	- cors: the provider does not allow browsers (no CORS): the apps or VLC.
	The stream goes straight from the provider to the browser; it never passes our server.
-->
<script lang="ts">
	import { onDestroy } from 'svelte';
	import { t } from '#lib/i18n/index.svelte.ts';
	import Icon from './Icon.svelte';
	import AppIcon from '#lib/components/Icon.svelte';
	import { APP_LINKS } from '#lib/backend/config.ts';
	import { mobileOs, vlcUrl } from './play-url.ts';
	import { m3uFileName, m3uFor, type WebBlock } from './web-playback.ts';

	interface Props {
		block: WebBlock;
		/** The stream url (for the copy/VLC actions only; never shown or logged). */
		url?: string;
		/** Title for the .m3u entry. */
		title?: string;
		onBack: () => void;
		onRetry?: () => void;
	}

	let { block, url, title = 'PrismaStream', onBack, onRetry }: Props = $props();

	const os = mobileOs();
	const host = typeof location !== 'undefined' ? location.host : 'prismastream.patrickudo.nl';
	const vlc = $derived(url ? vlcUrl(url, os) : null);
	const stores = $derived(
		[
			{ id: 'ios', label: t('player.app.ios'), href: APP_LINKS.ios },
			{ id: 'android', label: t('player.app.android'), href: APP_LINKS.android },
			{ id: 'tv', label: t('player.app.appletv'), href: APP_LINKS.appletv }
		].sort((a, b) => Number(b.id === os) - Number(a.id === os))
	);

	// .m3u for VLC: a blob url made on this device (never via the server).
	const m3u = $derived(
		url ? URL.createObjectURL(new Blob([m3uFor(url, title)], { type: 'audio/x-mpegurl' })) : null
	);
	let lastM3u: string | null = null;
	$effect(() => {
		if (lastM3u && lastM3u !== m3u) URL.revokeObjectURL(lastM3u);
		lastM3u = m3u;
	});
	onDestroy(() => {
		if (lastM3u) URL.revokeObjectURL(lastM3u);
	});

	let copied = $state(false);
	async function copy() {
		if (!url) return;
		try {
			await navigator.clipboard.writeText(url);
			copied = true;
			setTimeout(() => (copied = false), 2500);
		} catch {
			copied = false;
		}
	}

	function onKey(e: KeyboardEvent) {
		if (['Escape', 'Backspace', 'GoBack', 'BrowserBack'].includes(e.key)) {
			e.preventDefault();
			onBack();
		}
	}
</script>

<svelte:window onkeydown={onKey} />

<div class="screen" data-app-fallback={block}>
	<button type="button" class="back" data-focusable aria-label={t('player.back')} onclick={onBack}>
		<Icon name="back" size={30} />
	</button>

	<div class="msg" role="alert">
		{#if block === 'mixed-chromium'}
			<span class="ico"><AppIcon name="lock" size="2rem" /></span>
			<h1>{t('player.web.allow.title')}</h1>
			<p>{t('player.web.allow.why')}</p>

			<div class="bar" aria-hidden="true">
				<span class="site"><AppIcon name="sliders" size="0.95rem" /></span>
				<span class="addr">{host}</span>
				<span class="pointer">←</span>
			</div>
			<ol class="steps">
				<li>{t('player.web.allow.step1')}</li>
				<li>{t('player.web.allow.step2')}</li>
				<li>{t('player.web.allow.step3')}</li>
				<li>{t('player.web.allow.step4')}</li>
			</ol>
			<div class="actions">
				{#if onRetry}
					<button type="button" class="btn primary" data-focusable onclick={onRetry}>
						{t('player.retry')}
					</button>
				{/if}
				<button type="button" class="btn" data-focusable onclick={onBack}>{t('player.back')}</button
				>
			</div>
			<p class="small">{t('player.web.allow.app')}</p>
		{:else}
			<span class="ico"><AppIcon name="monitor" size="2rem" /></span>
			<h1>{block === 'cors' ? t('player.web.cors.title') : t('player.app.title')}</h1>
			<p>{block === 'cors' ? t('player.web.cors.body') : t('player.web.other.body')}</p>
			<div class="actions">
				{#if url}
					<button type="button" class="btn" data-focusable onclick={copy}>
						{copied ? t('player.web.copied') : t('player.web.copy')}
					</button>
				{/if}
				{#if vlc}
					<a class="btn" href={vlc} data-focusable>{t('player.app.vlc')}</a>
				{:else if m3u}
					<a class="btn" href={m3u} download={m3uFileName(title)} data-focusable
						>{t('player.web.m3u')}</a
					>
				{/if}
				{#if onRetry}
					<button type="button" class="btn" data-focusable onclick={onRetry}
						>{t('player.retry')}</button
					>
				{/if}
			</div>
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
			<button type="button" class="link" data-focusable onclick={onBack}>{t('player.back')}</button>
		{/if}
	</div>
</div>

<style>
	.screen {
		position: fixed;
		inset: 0;
		z-index: 20;
		display: grid;
		place-items: center;
		padding: calc(var(--safe-top) + 4.5rem) var(--gutter) 2rem;
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
		width: 100%;
		max-width: 34rem;
		min-width: 0;
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
	.small {
		font-size: var(--text-s);
		color: var(--text-3);
	}
	.bar {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		width: min(100%, 24rem);
		min-width: 0;
		padding: 0.5rem 0.75rem;
		border-radius: var(--radius-pill);
		background: var(--bg-elev-2);
		border: 1px solid var(--line-strong);
		font-size: var(--text-s);
		color: var(--text-2);
	}
	.site {
		display: grid;
		place-items: center;
		width: 1.8rem;
		height: 1.8rem;
		border-radius: 50%;
		background: var(--accent);
		color: var(--accent-contrast, #fff);
		box-shadow: 0 0 0 4px var(--accent-faint);
		flex: none;
	}
	.addr {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		text-align: start;
	}
	.pointer {
		color: var(--accent);
		font-weight: 800;
	}
	.steps {
		display: grid;
		gap: 0.5rem;
		width: 100%;
		margin: 0;
		padding-left: 1.4rem;
		text-align: start;
		color: var(--text);
		line-height: 1.45;
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
	.link {
		border: 0;
		background: none;
		color: var(--text-3);
		font: inherit;
		text-decoration: underline;
		cursor: pointer;
	}
</style>
