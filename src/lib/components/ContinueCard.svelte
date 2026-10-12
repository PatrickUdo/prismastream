<!--
	"Verder kijken" card: 16:9 artwork (episode still or backdrop), title, episode label,
	remaining time and an accent progress bar. Links straight into the player.
-->
<script lang="ts">
	import type { Title, WatchProgress } from '#lib/types.ts';
	import { t } from '#lib/i18n/index.svelte.ts';
	import Backdrop from './Backdrop.svelte';
	import ProgressBar from './ProgressBar.svelte';
	import Icon from './Icon.svelte';
	import { watchHref } from './links.ts';
	import { displayTitle } from './titles.ts';
	import { formatRemaining } from './format.ts';
	import { findEpisode } from './versions.ts';

	interface Props {
		title: Title;
		progress: WatchProgress;
	}

	let { title, progress }: Props = $props();

	const name = $derived(displayTitle(title));
	const episode = $derived(findEpisode(title, progress.episodeId));
	const ratio = $derived(
		progress.durationSec > 0 ? Math.min(1, progress.positionSec / progress.durationSec) : 0
	);
	const remaining = $derived(formatRemaining(progress.positionSec, progress.durationSec));
	const sub = $derived(
		episode
			? t('ui.episodeShort', { s: episode.season, e: episode.episode }) +
					(episode.title ? ` · ${episode.title}` : '')
			: remaining
	);
	const label = $derived(
		t('ui.resumeLabel', { title: name }) + (episode ? `, ${sub}` : '') + `, ${remaining}`
	);
</script>

<a
	class="card"
	href={watchHref(title.id, { episodeId: progress.episodeId, variantId: progress.variantId })}
	aria-label={label}
	data-focusable
>
	<div class="frame">
		<Backdrop
			seed={episode?.id ?? title.id}
			genres={title.genres}
			url={episode?.stillUrl ?? title.backdropUrl}
		/>
		<div class="shade"></div>
		<span class="play" aria-hidden="true"><Icon name="play" size="1.25rem" /></span>
		<div class="info" aria-hidden="true">
			<strong>{name}</strong>
			<span class="sub">{sub}</span>
			{#if episode && remaining}<span class="rem">{remaining}</span>{/if}
		</div>
		<div class="bar"><ProgressBar value={ratio} size="m" /></div>
	</div>
</a>

<style>
	.card {
		display: block;
		border-radius: var(--radius-m);
	}
	.frame {
		position: relative;
		border-radius: var(--radius-m);
		overflow: hidden;
		isolation: isolate;
		box-shadow:
			var(--shadow-1),
			inset 0 0 0 1px rgb(255 255 255 / 0.06);
		transition:
			transform var(--dur) var(--ease-out),
			box-shadow var(--dur) var(--ease-out);
	}
	.shade {
		position: absolute;
		inset: 0;
		background: linear-gradient(to top, rgb(6 6 10 / 0.92) 0%, rgb(6 6 10 / 0.35) 55%, transparent);
	}
	.play {
		position: absolute;
		top: 50%;
		left: 50%;
		display: grid;
		place-items: center;
		width: 3rem;
		height: 3rem;
		padding-left: 0.15rem;
		border-radius: 50%;
		background: rgb(255 255 255 / 0.16);
		border: 1px solid rgb(255 255 255 / 0.25);
		backdrop-filter: blur(12px);
		-webkit-backdrop-filter: blur(12px);
		color: #fff;
		transform: translate(-50%, -60%) scale(0.85);
		opacity: 0;
		transition:
			opacity var(--dur) var(--ease-out),
			transform var(--dur) var(--ease-out);
	}
	.info {
		position: absolute;
		left: 0.85rem;
		right: 0.85rem;
		bottom: 1.15rem;
		display: grid;
		gap: 0.1rem;
	}
	strong {
		font-size: var(--text-m);
		font-weight: 750;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.sub,
	.rem {
		font-size: var(--text-xs);
		color: var(--text-2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.rem {
		color: var(--text-3);
	}
	.bar {
		position: absolute;
		left: 0.85rem;
		right: 0.85rem;
		bottom: 0.6rem;
	}
	@media (hover: hover) {
		:global(html:not([data-device='tv'])) .card:hover .frame {
			transform: translateY(-4px) scale(1.025);
			box-shadow: var(--shadow-3), var(--glow);
		}
		:global(html:not([data-device='tv'])) .card:hover .play {
			opacity: 1;
			transform: translate(-50%, -60%);
		}
	}
	.card:focus-visible,
	:global(html[data-input='remote']) .card:focus {
		box-shadow: none;
	}
	.card:focus-visible .frame,
	:global(html[data-input='remote']) .card:focus .frame {
		transform: translateY(-4px) scale(1.025);
		box-shadow: var(--focus-ring), var(--glow);
	}
	:global(html[data-input='remote']) .card:focus .frame {
		transform: translateY(-4px) scale(1.05);
	}
	.card:focus-visible .play,
	:global(html[data-input='remote']) .card:focus .play {
		opacity: 1;
		transform: translate(-50%, -60%);
	}
</style>
