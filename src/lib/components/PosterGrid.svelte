<!--
	Responsive poster grid with incremental rendering: renders `pageSize` cards and adds
	more when a sentinel near the end scrolls into view. Cheap for 10.000+ titles.
-->
<script lang="ts">
	import type { Title } from '#lib/types.ts';
	import TitleCard from './TitleCard.svelte';
	import Skeleton from './Skeleton.svelte';

	interface Props {
		titles: Title[];
		pageSize?: number;
		/** Changing this resets the rendered window (e.g. on filter change). */
		resetKey?: string;
		loading?: boolean;
	}

	let { titles, pageSize = 60, resetKey = '', loading = false }: Props = $props();

	let limit = $state(0);
	let sentinel = $state<HTMLDivElement>();
	const visible = $derived(titles.slice(0, limit || pageSize));

	$effect(() => {
		void resetKey;
		limit = pageSize;
	});

	$effect(() => {
		if (!sentinel) return;
		// Re-observe after every page so a still-visible sentinel triggers the next one.
		void visible.length;
		const io = new IntersectionObserver(
			(entries) => {
				if (entries.some((e) => e.isIntersecting) && limit < titles.length) limit += pageSize;
			},
			{ rootMargin: '1200px 0px' }
		);
		io.observe(sentinel);
		return () => io.disconnect();
	});
</script>

<ul class="grid">
	{#if loading}
		{#each Array.from({ length: 18 }, (_, i) => i) as i (i)}
			<li><Skeleton shape="poster" /></li>
		{/each}
	{:else}
		{#each visible as title, i (title.id)}
			<li><TitleCard {title} eager={i < 12} /></li>
		{/each}
	{/if}
</ul>
{#if !loading && visible.length < titles.length}
	<div class="sentinel" bind:this={sentinel} aria-hidden="true"></div>
{/if}

<style>
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(var(--card-w), 42vw), 1fr));
		gap: clamp(1rem, 0.6rem + 1.2vw, 1.75rem) clamp(0.6rem, 0.4rem + 0.8vw, 1.1rem);
		margin: 0;
		padding: 0;
		list-style: none;
	}
	@media (max-width: 520px) {
		.grid {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
	}
	.sentinel {
		height: 1px;
	}
</style>
