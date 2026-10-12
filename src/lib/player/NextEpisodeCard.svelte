<script lang="ts">
	import type { Episode } from '#lib/types.ts';
	import { t } from '#lib/i18n/index.svelte.ts';
	import Icon from './Icon.svelte';

	interface Props {
		episode: Episode;
		/** Seconds left before autoplay; null = no autoplay countdown. */
		countdown: number | null;
		total: number;
		onPlay: () => void;
		onDismiss: () => void;
	}

	let { episode, countdown, total, onPlay, onDismiss }: Props = $props();

	let playBtn: HTMLButtonElement | undefined = $state();
	const progress = $derived(countdown === null ? 0 : 1 - countdown / Math.max(1, total));

	$effect(() => {
		// Bring remote/keyboard users straight to the primary action.
		if (playBtn && document.activeElement === document.body) playBtn.focus({ preventScroll: true });
	});
</script>

<aside class="card" aria-label={t('player.nextEpisode')}>
	{#if episode.stillUrl}
		<img src={episode.stillUrl} alt="" loading="lazy" />
	{/if}
	<div class="info">
		<span class="eyebrow">{t('player.nextEpisode')}</span>
		<strong
			>{t('player.episodeCode', { s: episode.season, e: episode.episode })} · {episode.title}</strong
		>
		{#if countdown !== null}
			<span class="count">{t('player.nextIn', { s: countdown })}</span>
		{/if}
	</div>
	<div class="actions">
		<button
			type="button"
			class="play"
			data-focusable
			bind:this={playBtn}
			onclick={onPlay}
			style:--p={progress}
		>
			<Icon name="next" size={20} />
			{t('player.playNow')}
		</button>
		<button type="button" class="dismiss" data-focusable onclick={onDismiss}>
			{t('player.watchCredits')}
		</button>
	</div>
</aside>

<style>
	.card {
		position: absolute;
		z-index: 16;
		right: max(var(--gutter), env(safe-area-inset-right, 0px));
		bottom: calc(var(--safe-bottom) + 150px);
		display: grid;
		gap: 14px;
		width: min(360px, calc(100vw - 2 * var(--gutter)));
		padding: 14px;
		border-radius: var(--radius-l);
		background: color-mix(in oklab, var(--bg-elev-2) 82%, transparent);
		border: 1px solid var(--line-strong);
		backdrop-filter: blur(28px) saturate(1.4);
		-webkit-backdrop-filter: blur(28px) saturate(1.4);
		box-shadow: 0 24px 60px color-mix(in oklab, var(--bg) 60%, transparent);
		animation: in var(--dur-slow) var(--ease-out);
	}
	img {
		width: 100%;
		aspect-ratio: 16 / 9;
		object-fit: cover;
		border-radius: var(--radius-m);
		background: var(--bg-elev-3);
	}
	.info {
		display: grid;
		gap: 4px;
		padding: 0 4px;
	}
	.eyebrow {
		font-size: 12px;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-3);
	}
	strong {
		font-size: 16px;
		line-height: 1.35;
	}
	.count {
		font-size: 13px;
		color: var(--text-2);
	}
	.actions {
		display: flex;
		gap: 8px;
	}
	button {
		min-height: 46px;
		border-radius: var(--radius-pill);
		font-weight: 700;
		font-size: 14px;
		cursor: pointer;
	}
	.play {
		position: relative;
		flex: 1;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		border: 0;
		overflow: hidden;
		color: var(--bg);
		background: linear-gradient(
			to right,
			color-mix(in oklab, var(--text) 78%, transparent) calc(var(--p) * 100%),
			var(--text) calc(var(--p) * 100%)
		);
	}
	.dismiss {
		padding: 0 16px;
		border: 1px solid var(--line-strong);
		background: transparent;
	}
	.dismiss:hover {
		background: var(--line);
	}
	@keyframes in {
		from {
			opacity: 0;
			transform: translateX(30px);
		}
	}
	@media (max-height: 480px) {
		.card {
			bottom: calc(var(--safe-bottom) + 110px);
			width: min(320px, 50vw);
		}
		img {
			display: none;
		}
	}
</style>
