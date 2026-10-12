<!--
	2:3 poster. Uses title.posterUrl when available (lazy, fades in); otherwise, or when
	the image fails, a deterministic generative poster with the title typeset on it (in the
	profile's language via displayTitle, so the artwork matches the card and detail title).
-->
<script lang="ts" module>
	export interface PosterSource {
		id: string;
		title: string;
		originalTitle?: string;
		/** Translated titles; the generative poster shows the one in the profile language. */
		altTitles?: { title: string; lang?: string }[];
		genres: readonly string[];
		year?: number;
		posterUrl?: string;
	}
</script>

<script lang="ts">
	import GenerativeArt from './GenerativeArt.svelte';
	import { displayTitle } from './titles.ts';

	interface Props {
		title: PosterSource;
		/** Load immediately (above the fold). */
		eager?: boolean;
		/** Rounded corners; set false when the parent clips. */
		rounded?: boolean;
	}

	let { title, eager = false, rounded = true }: Props = $props();

	let failedUrl = $state<string | null>(null);
	let loaded = $state(false);
	const useImage = $derived(!!title.posterUrl && failedUrl !== title.posterUrl);
	const name = $derived(displayTitle(title));
	const tagline = $derived(
		[title.year, title.genres[0]].filter((x) => x !== undefined && x !== '').join(' · ')
	);
</script>

<div class="poster" class:rounded>
	{#if useImage}
		<div class="placeholder" class:hidden={loaded}></div>
		<img
			src={title.posterUrl}
			alt=""
			loading={eager ? 'eager' : 'lazy'}
			decoding="async"
			class:loaded
			onload={() => (loaded = true)}
			onerror={() => (failedUrl = title.posterUrl ?? null)}
		/>
	{:else}
		<GenerativeArt seed={title.id} format="poster" genres={title.genres} title={name} {tagline} />
	{/if}
</div>

<style>
	.poster {
		position: relative;
		aspect-ratio: 2 / 3;
		width: 100%;
		overflow: hidden;
		background: var(--bg-elev-2);
		isolation: isolate;
	}
	.rounded {
		border-radius: var(--radius-m);
	}
	.poster :global(.art) {
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
	.placeholder {
		position: absolute;
		inset: 0;
		background: linear-gradient(160deg, var(--bg-elev-2), var(--bg-elev-1));
		transition: opacity var(--dur-slow) var(--ease-out);
	}
	.placeholder.hidden {
		opacity: 0;
	}
</style>
