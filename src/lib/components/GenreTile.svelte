<!-- Genre tile: generative artwork in the genre's palette with the genre name. -->
<script lang="ts">
	import type { ResolvedPathname } from '$app/types';
	import GenerativeArt from './GenerativeArt.svelte';
	import { tn } from './format.ts';

	interface Props {
		genre: string;
		href: ResolvedPathname;
		count?: number;
	}

	let { genre, href, count }: Props = $props();
</script>

<a class="tile" {href} data-focusable>
	<GenerativeArt seed="genre:{genre}" format="backdrop" genres={[genre]} />
	<span class="shade" aria-hidden="true"></span>
	<span class="text">
		<strong>{genre}</strong>
		{#if count}<span class="count">{tn('ui.titlesCount', count)}</span>{/if}
	</span>
</a>

<style>
	.tile {
		position: relative;
		display: block;
		aspect-ratio: 16 / 9;
		border-radius: var(--radius-m);
		overflow: hidden;
		isolation: isolate;
		background: var(--bg-elev-1);
		box-shadow:
			var(--shadow-1),
			inset 0 0 0 1px rgb(255 255 255 / 0.06);
		transition:
			transform var(--dur) var(--ease-out),
			box-shadow var(--dur) var(--ease-out);
	}
	.tile :global(.art) {
		position: absolute;
		inset: 0;
		transition: transform var(--dur-slow) var(--ease-out);
	}
	.shade {
		position: absolute;
		inset: 0;
		background: linear-gradient(20deg, rgb(6 6 10 / 0.85) 0%, rgb(6 6 10 / 0.2) 60%, transparent);
	}
	.text {
		position: absolute;
		left: 0.9rem;
		right: 0.9rem;
		bottom: 0.75rem;
		display: grid;
		gap: 0.05rem;
	}
	strong {
		font-size: var(--text-l);
		font-weight: 780;
		letter-spacing: -0.015em;
		line-height: 1.15;
	}
	.count {
		font-size: var(--text-xs);
		color: var(--text-2);
	}
	@media (hover: hover) {
		:global(html:not([data-device='tv'])) .tile:hover {
			transform: translateY(-4px);
			box-shadow: var(--shadow-3), var(--glow);
		}
		:global(html:not([data-device='tv'])) .tile:hover :global(.art) {
			transform: scale(1.06);
		}
	}
	.tile:focus-visible,
	:global(html[data-input='remote']) .tile:focus {
		transform: translateY(-4px);
		box-shadow: var(--focus-ring), var(--glow);
	}
	:global(html[data-input='remote']) .tile:focus {
		transform: translateY(-4px) scale(1.05);
	}
</style>
