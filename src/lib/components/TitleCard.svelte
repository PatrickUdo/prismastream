<!--
	Poster card for a movie or series. Hover/focus: lift, scale, accent glow and an info
	reveal (title, meta, languages). Always shows the language badge and best quality.
-->
<script lang="ts">
	import type { TitleCard as Card } from '#lib/types.ts';
	import { t } from '#lib/i18n/index.svelte.ts';
	import { user } from '#lib/stores/user.svelte.ts';
	import Poster from './Poster.svelte';
	import LangBadge from './LangBadge.svelte';
	import QualityBadge from './QualityBadge.svelte';
	import ProgressBar from './ProgressBar.svelte';
	import Icon from './Icon.svelte';
	import { titleHref } from './links.ts';
	import { displayTitle } from './titles.ts';
	import { bestQuality, titleMeta } from './format.ts';

	interface Props {
		title: Card;
		eager?: boolean;
		/** Show watch progress when available (default true). */
		showProgress?: boolean;
	}

	let { title, eager = false, showProgress = true }: Props = $props();

	const name = $derived(displayTitle(title));
	const quality = $derived(bestQuality(title.qualities));
	const meta = $derived(titleMeta(title).join(' · '));
	const progress = $derived(showProgress ? user.latestProgress(title.id) : undefined);
	const ratio = $derived(
		progress && progress.durationSec > 0 ? progress.positionSec / progress.durationSec : 0
	);
	const favorite = $derived(user.isFavorite(title.id));
	const label = $derived(
		[name, title.year, title.kind === 'movie' ? t('common.movie') : t('common.series')]
			.filter(Boolean)
			.join(', ')
	);
</script>

<a class="card" href={titleHref(title.id)} aria-label={label} data-focusable>
	<div class="frame">
		<Poster {title} {eager} rounded={false} />
		<div class="badges">
			<LangBadge languages={title.languages} />
			<span class="right">
				{#if favorite}
					<span class="fav" title={t('ui.inMyList')}
						><Icon name="bookmark-filled" size="0.8rem" /></span
					>
				{/if}
				<QualityBadge {quality} />
			</span>
		</div>
		<div class="reveal" aria-hidden="true">
			<strong>{name}</strong>
			<span class="meta">{meta}</span>
			{#if title.rating}
				<span class="rating"><Icon name="star" size="0.75rem" />{title.rating.toFixed(1)}</span>
			{/if}
		</div>
		{#if ratio > 0}
			<div class="progress"><ProgressBar value={ratio} /></div>
		{/if}
	</div>
</a>

<style>
	.card {
		display: block;
		border-radius: var(--radius-m);
		outline: none;
		transition: transform var(--dur) var(--ease-out);
	}
	.frame {
		position: relative;
		border-radius: var(--radius-m);
		overflow: hidden;
		isolation: isolate;
		background: var(--bg-elev-1);
		box-shadow:
			var(--shadow-1),
			inset 0 0 0 1px rgb(255 255 255 / 0.04);
		transition:
			transform var(--dur) var(--ease-out),
			box-shadow var(--dur) var(--ease-out);
	}
	/* Hairline that catches the light on hover. */
	.frame::after {
		content: '';
		position: absolute;
		inset: 0;
		z-index: 3;
		border-radius: inherit;
		box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.08);
		pointer-events: none;
		transition: box-shadow var(--dur) var(--ease-out);
	}

	.badges {
		position: absolute;
		top: 0.45rem;
		left: 0.45rem;
		right: 0.45rem;
		z-index: 2;
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 0.3rem;
		pointer-events: none;
	}
	.right {
		display: inline-flex;
		gap: 0.3rem;
	}
	.fav {
		display: inline-grid;
		place-items: center;
		width: 1.4rem;
		height: 1.4rem;
		border-radius: var(--radius-xs);
		background: var(--accent);
		color: var(--accent-contrast);
	}

	.reveal {
		position: absolute;
		inset: auto 0 0 0;
		z-index: 2;
		display: grid;
		gap: 0.2rem;
		padding: 2.75rem 0.75rem 0.75rem;
		background: linear-gradient(
			to top,
			rgb(6 6 10 / 0.96) 0%,
			rgb(6 6 10 / 0.82) 45%,
			rgb(6 6 10 / 0) 100%
		);
		opacity: 0;
		transform: translateY(0.6rem);
		transition:
			opacity var(--dur) var(--ease-out),
			transform var(--dur) var(--ease-out);
	}
	.reveal strong {
		font-size: var(--text-s);
		font-weight: 750;
		line-height: 1.25;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.meta {
		font-size: var(--text-xs);
		color: var(--text-2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.rating {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		font-size: var(--text-xs);
		font-weight: 700;
		color: var(--rating);
	}

	.progress {
		position: absolute;
		left: 0.6rem;
		right: 0.6rem;
		bottom: 0.55rem;
		z-index: 2;
		transition: opacity var(--dur) var(--ease-out);
	}

	@media (hover: hover) {
		:global(html:not([data-device='tv'])) .card:hover .frame {
			transform: translateY(-6px) scale(1.04);
			box-shadow: var(--shadow-3), var(--glow);
		}
		:global(html:not([data-device='tv'])) .card:hover .frame::after {
			box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.18);
		}
		:global(html:not([data-device='tv'])) .card:hover .reveal {
			opacity: 1;
			transform: none;
		}
		:global(html:not([data-device='tv'])) .card:hover .progress {
			opacity: 0;
		}
	}
	.card:focus-visible,
	:global(html[data-input='remote']) .card:focus {
		box-shadow: none;
	}
	.card:focus-visible .frame,
	:global(html[data-input='remote']) .card:focus .frame {
		transform: translateY(-6px) scale(1.04);
		box-shadow: var(--focus-ring), var(--glow);
	}
	/* Remote: the focused card stands out more (10-foot UI). */
	:global(html[data-input='remote']) .card:focus .frame {
		transform: translateY(-4px) scale(1.07);
	}
	.card:focus-visible .reveal,
	:global(html[data-input='remote']) .card:focus .reveal {
		opacity: 1;
		transform: none;
	}
	.card:focus-visible .progress,
	:global(html[data-input='remote']) .card:focus .progress {
		opacity: 0;
	}
	.card:active .frame {
		transform: translateY(-2px) scale(1.01);
		transition-duration: var(--dur-fast);
	}
</style>
