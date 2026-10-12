<!--
	Episode row: still (or generative still with the episode number), number + title,
	runtime, overview, available languages and watch progress. Links into the player
	with the variant chosen for this episode.
-->
<script lang="ts">
	import type { Episode, StreamVariant, WatchProgress } from '#lib/types.ts';
	import { t } from '#lib/i18n/index.svelte.ts';
	import Backdrop from './Backdrop.svelte';
	import ProgressBar from './ProgressBar.svelte';
	import LangBadge from './LangBadge.svelte';
	import QualityBadge from './QualityBadge.svelte';
	import Icon from './Icon.svelte';
	import { watchHref, type SubtitleParam } from './links.ts';
	import { formatRemaining, formatRuntime } from './format.ts';
	import { episodeLanguages } from './versions.ts';

	interface Props {
		titleId: string;
		episode: Episode;
		genres: readonly string[];
		variant?: StreamVariant;
		progress?: WatchProgress;
		/** Explicit subtitle choice from the detail page (passed to the player as ?s=). */
		subtitle?: SubtitleParam;
	}

	let { titleId, episode, genres, variant, progress, subtitle }: Props = $props();

	const ratio = $derived(
		progress && progress.durationSec > 0 ? progress.positionSec / progress.durationSec : 0
	);
	const langs = $derived(episodeLanguages(episode));
	const runtime = $derived(formatRuntime(episode.runtimeMin));
	const unavailable = $derived(episode.variants.length === 0);
	const label = $derived(
		[
			t('ui.episodeN', { n: episode.episode }),
			episode.title,
			runtime,
			ratio > 0 && progress ? formatRemaining(progress.positionSec, progress.durationSec) : ''
		]
			.filter(Boolean)
			.join(', ')
	);
</script>

{#snippet body()}
	<div class="still">
		<Backdrop
			seed={episode.id}
			{genres}
			url={episode.stillUrl}
			label={String(episode.episode).padStart(2, '0')}
		/>
		{#if !unavailable}
			<span class="play" aria-hidden="true"><Icon name="play" size="1.1rem" /></span>
		{/if}
		{#if ratio > 0}
			<span class="bar"><ProgressBar value={ratio} /></span>
		{/if}
	</div>
	<div class="text" aria-hidden="true">
		<div class="head">
			<strong><span class="num">{episode.episode}.</span> {episode.title}</strong>
			{#if runtime}<span class="rt">{runtime}</span>{/if}
		</div>
		{#if episode.overview}<p>{episode.overview}</p>{/if}
		<div class="tags">
			<LangBadge languages={langs} max={4} tone="plain" />
			<QualityBadge quality={variant?.quality} tone="plain" />
			{#if unavailable}<span class="na">{t('detail.notAvailable')}</span>{/if}
		</div>
	</div>
{/snippet}

{#if unavailable}
	<div class="ep disabled" role="group" aria-label={label}>{@render body()}</div>
{:else}
	<a
		class="ep"
		href={watchHref(titleId, { episodeId: episode.id, variantId: variant?.id, subtitle })}
		aria-label={label}
		data-focusable
	>
		{@render body()}
	</a>
{/if}

<style>
	.ep {
		display: grid;
		grid-template-columns: minmax(8.5rem, 16rem) 1fr;
		gap: clamp(0.85rem, 0.5rem + 1vw, 1.5rem);
		align-items: center;
		padding: 0.75rem;
		border-radius: var(--radius-l);
		transition: background-color var(--dur) var(--ease-out);
	}
	.ep:hover {
		background: var(--bg-hover);
	}
	.disabled {
		opacity: 0.55;
	}
	.still {
		position: relative;
		border-radius: var(--radius-m);
		overflow: hidden;
		box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.06);
	}
	.play {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		background: rgb(6 6 10 / 0.35);
		opacity: 0;
		transition: opacity var(--dur) var(--ease-out);
	}
	.play :global(svg) {
		width: 2.75rem;
		height: 2.75rem;
		padding: 0.8rem 0.7rem 0.8rem 0.9rem;
		border-radius: 50%;
		background: rgb(255 255 255 / 0.18);
		backdrop-filter: blur(10px);
		-webkit-backdrop-filter: blur(10px);
	}
	.ep:hover .play,
	.ep:focus-visible .play {
		opacity: 1;
	}
	.bar {
		position: absolute;
		left: 0.5rem;
		right: 0.5rem;
		bottom: 0.45rem;
	}
	.text {
		display: grid;
		gap: 0.4rem;
		min-width: 0;
	}
	.head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
	}
	strong {
		font-size: var(--text-m);
		font-weight: 720;
		line-height: 1.3;
	}
	.num {
		color: var(--text-3);
		font-variant-numeric: tabular-nums;
	}
	.rt {
		flex: none;
		font-size: var(--text-s);
		color: var(--text-3);
	}
	p {
		color: var(--text-2);
		font-size: var(--text-s);
		line-height: 1.55;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.tags {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}
	.na {
		font-size: var(--text-xs);
		color: var(--text-3);
	}
	@media (max-width: 599.98px) {
		.ep {
			grid-template-columns: 8.5rem 1fr;
			align-items: start;
			padding: 0.5rem;
		}
		p {
			-webkit-line-clamp: 3;
			line-clamp: 3;
		}
		.head {
			flex-direction: column;
			gap: 0.15rem;
		}
	}
</style>
