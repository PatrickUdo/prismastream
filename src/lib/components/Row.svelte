<!--
	Horizontal carousel row. Scroll-snap on touch, arrow buttons on pointer devices,
	cards scroll beneath the navigation rail while staying aligned with the page edge.
	Generic over the item type: pass `items`, a `key` function and an `item` snippet.
-->
<script lang="ts" generics="T">
	import type { Snippet } from 'svelte';
	import type { ResolvedPathname } from '$app/types';
	import { prefersReducedMotion } from 'svelte/motion';
	import { t } from '#lib/i18n/index.svelte.ts';
	import { user } from '#lib/stores/user.svelte.ts';
	import Icon from './Icon.svelte';

	interface Props {
		title: string;
		items: T[];
		key: (item: T) => string;
		item: Snippet<[T, number]>;
		variant?: 'poster' | 'wide' | 'tile' | 'channel' | 'cast';
		eyebrow?: string;
		/** "Alles bekijken" link. */
		href?: ResolvedPathname;
		/** Extra header content (right side). */
		action?: Snippet;
	}

	let { title, items, key, item, variant = 'poster', eyebrow, href, action }: Props = $props();

	const id = $props.id();
	let track = $state<HTMLUListElement>();
	let canPrev = $state(false);
	let canNext = $state(false);

	function update() {
		if (!track) return;
		canPrev = track.scrollLeft > 4;
		canNext = track.scrollLeft + track.clientWidth < track.scrollWidth - 4;
	}

	$effect(() => {
		if (!track) return;
		void items.length;
		update();
		const ro = new ResizeObserver(update);
		ro.observe(track);
		return () => ro.disconnect();
	});

	function page(dir: 1 | -1) {
		if (!track) return;
		const reduce = prefersReducedMotion.current || user.settings.reduceMotion;
		track.scrollBy({ left: dir * track.clientWidth * 0.85, behavior: reduce ? 'auto' : 'smooth' });
	}
</script>

<section class="row {variant}" aria-labelledby="{id}-h">
	<header>
		<div class="titles">
			{#if eyebrow}<span class="eyebrow">{eyebrow}</span>{/if}
			<h2 id="{id}-h">{title}</h2>
		</div>
		<div class="tools">
			{#if action}{@render action()}{/if}
			{#if href}
				<a class="all" {href} data-focusable>
					{t('ui.seeAll')}
					<Icon name="chevron-right" size="1rem" />
				</a>
			{/if}
		</div>
	</header>

	<div class="viewport">
		<ul class="track" bind:this={track} onscroll={update} data-nav-row>
			{#each items as it, i (key(it))}
				<li>{@render item(it, i)}</li>
			{/each}
		</ul>
		<button
			type="button"
			class="arrow prev"
			class:show={canPrev}
			tabindex="-1"
			aria-label={t('ui.scrollPrev')}
			onclick={() => page(-1)}
		>
			<Icon name="chevron-left" size="1.6rem" />
		</button>
		<button
			type="button"
			class="arrow next"
			class:show={canNext}
			tabindex="-1"
			aria-label={t('ui.scrollNext')}
			onclick={() => page(1)}
		>
			<Icon name="chevron-right" size="1.6rem" />
		</button>
	</div>
</section>

<style>
	.row {
		--col: var(--card-w);
		--gap: clamp(0.6rem, 0.4rem + 0.6vw, 1rem);
		position: relative;
		/* The track scrolls internally; never let its content width size the parent. */
		min-width: 0;
		contain: inline-size;
	}
	.wide {
		--col: var(--card-w-wide);
	}
	.tile {
		--col: clamp(11rem, 8rem + 9vw, 16rem);
	}
	.channel {
		--col: clamp(13rem, 10rem + 8vw, 17.5rem);
	}
	.cast {
		--col: clamp(6.5rem, 5.5rem + 3vw, 8.5rem);
	}

	header {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 1rem;
		padding-inline: var(--page-start) var(--page-end);
		margin-bottom: 0.15rem;
	}
	.titles {
		display: grid;
		gap: 0.2rem;
	}
	h2 {
		font-size: var(--text-xl);
		font-weight: 750;
	}
	.tools {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.all {
		display: inline-flex;
		align-items: center;
		gap: 0.15rem;
		padding: 0.35rem 0.4rem 0.35rem 0.7rem;
		border-radius: var(--radius-pill);
		color: var(--text-3);
		font-size: var(--text-s);
		font-weight: 650;
		transition:
			color var(--dur) var(--ease-out),
			background-color var(--dur) var(--ease-out);
	}
	@media (hover: hover) {
		.all:hover {
			color: var(--text);
			background: var(--bg-hover);
		}
	}
	/* Touch: at least 44 px to hit. */
	@media (pointer: coarse) {
		.all {
			min-height: 2.75rem;
		}
	}

	.viewport {
		position: relative;
	}
	.track {
		display: grid;
		grid-auto-flow: column;
		grid-auto-columns: var(--col);
		gap: var(--gap);
		margin: 0;
		/* Vertical room so lifted/glowing cards are not clipped. */
		padding: 1.1rem var(--page-end) 1.75rem var(--page-start);
		list-style: none;
		overflow-x: auto;
		overflow-y: hidden;
		overscroll-behavior-x: contain;
		scroll-snap-type: x mandatory;
		scroll-padding-inline: var(--page-start) var(--page-end);
		scrollbar-width: none;
		-webkit-overflow-scrolling: touch;
	}
	.track::-webkit-scrollbar {
		display: none;
	}
	.track > li {
		scroll-snap-align: start;
		min-width: 0;
	}
	/* Remote: the focused card is scrolled into view calmly; snapping would make it jump. */
	:global(html[data-input='remote']) .track {
		scroll-snap-type: none;
	}

	.arrow {
		position: absolute;
		top: 1.1rem;
		bottom: 1.75rem;
		z-index: 3;
		display: none;
		place-items: center;
		width: calc(var(--gutter) + 0.5rem);
		min-width: 3rem;
		padding: 0;
		border: 0;
		color: var(--text);
		opacity: 0;
		pointer-events: none;
		transition: opacity var(--dur) var(--ease-out);
	}
	.prev {
		left: calc(var(--shell-left) + var(--safe-left));
		background: linear-gradient(90deg, rgb(7 7 11 / 0.92), rgb(7 7 11 / 0));
	}
	.next {
		right: 0;
		background: linear-gradient(270deg, rgb(7 7 11 / 0.92), rgb(7 7 11 / 0));
	}
	.arrow :global(svg) {
		transition: transform var(--dur) var(--ease-out);
	}
	.arrow:hover :global(svg) {
		transform: scale(1.18);
	}
	@media (hover: hover) and (pointer: fine) {
		.arrow {
			display: grid;
		}
		.viewport:hover .arrow.show {
			opacity: 1;
			pointer-events: auto;
		}
	}
</style>
