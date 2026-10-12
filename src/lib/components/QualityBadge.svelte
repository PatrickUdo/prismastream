<!-- Quality badge ("4K", "FHD", "HD", "SD"). Hidden for 'unknown'. -->
<script lang="ts">
	import type { Quality } from '#lib/types.ts';

	interface Props {
		quality: Quality | undefined;
		tone?: 'glass' | 'plain';
	}

	let { quality, tone = 'glass' }: Props = $props();
</script>

{#if quality && quality !== 'unknown'}
	<span class="q {tone}" class:uhd={quality === '4K'}>{quality}</span>
{/if}

<style>
	.q {
		display: inline-flex;
		align-items: center;
		min-height: 1.4rem;
		padding: 0 0.42rem;
		border-radius: var(--radius-xs);
		font-size: 0.6875rem;
		font-weight: 800;
		letter-spacing: 0.06em;
		line-height: 1;
	}
	.glass {
		background: rgb(10 10 16 / 0.55);
		border: 1px solid rgb(255 255 255 / 0.12);
		backdrop-filter: blur(10px);
		-webkit-backdrop-filter: blur(10px);
		color: var(--text-on-media);
	}
	.plain {
		border: 1px solid var(--line-strong);
		color: var(--text-2);
	}
	.uhd {
		border-color: transparent;
		background:
			linear-gradient(var(--bg-elev-1), var(--bg-elev-1)) padding-box,
			var(--spectrum) border-box;
		border: 1px solid transparent;
		color: var(--text);
	}
</style>
