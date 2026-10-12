<!--
	16:9 backdrop. Uses `url` (title.backdropUrl or an episode still) when available;
	otherwise a generative backdrop in the title's genre palette. With `fill` it covers
	its positioned parent instead of keeping a 16:9 box.
-->
<script lang="ts">
	import GenerativeArt from './GenerativeArt.svelte';

	interface Props {
		/** Seed for the generative fallback (title id, episode id...). */
		seed: string;
		genres?: readonly string[];
		url?: string;
		eager?: boolean;
		fill?: boolean;
		/** Faint large label on generative stills (episode number). */
		label?: string;
		/** Image focus for object-position. */
		position?: string;
	}

	let {
		seed,
		genres = [],
		url,
		eager = false,
		fill = false,
		label,
		position = 'center 25%'
	}: Props = $props();

	let failedUrl = $state<string | null>(null);
	let loaded = $state(false);
	const useImage = $derived(!!url && failedUrl !== url);
</script>

<div class="backdrop" class:fill>
	{#if useImage}
		<img
			src={url}
			alt=""
			loading={eager ? 'eager' : 'lazy'}
			decoding="async"
			fetchpriority={eager ? 'high' : 'auto'}
			class:loaded
			style:object-position={position}
			onload={() => (loaded = true)}
			onerror={() => (failedUrl = url ?? null)}
		/>
	{:else}
		<GenerativeArt {seed} format="backdrop" {genres} {label} />
	{/if}
</div>

<style>
	.backdrop {
		position: relative;
		aspect-ratio: 16 / 9;
		width: 100%;
		overflow: hidden;
		background: linear-gradient(160deg, var(--bg-elev-2), var(--bg-elev-1));
	}
	.backdrop.fill {
		position: absolute;
		inset: 0;
		aspect-ratio: auto;
		height: 100%;
	}
	.backdrop :global(.art) {
		position: absolute;
		inset: 0;
	}
	img {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
		opacity: 0;
		transition: opacity var(--dur-slow) var(--ease-out);
	}
	img.loaded {
		opacity: 1;
	}
</style>
