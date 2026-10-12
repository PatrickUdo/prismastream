<!-- Shimmering placeholder. Shapes: poster (2:3), backdrop (16:9), circle, line, block. -->
<script lang="ts">
	interface Props {
		shape?: 'poster' | 'backdrop' | 'circle' | 'line' | 'block';
		width?: string;
		height?: string;
		radius?: string;
	}

	let { shape = 'block', width, height, radius }: Props = $props();
</script>

<span
	class="skeleton {shape}"
	style:width
	style:height
	style:border-radius={radius}
	aria-hidden="true"
></span>

<style>
	.skeleton {
		position: relative;
		display: block;
		overflow: hidden;
		background: var(--bg-elev-1);
		border-radius: var(--radius-m);
	}
	.skeleton::after {
		content: '';
		position: absolute;
		inset: 0;
		background: linear-gradient(
			100deg,
			transparent 20%,
			rgb(255 255 255 / 0.045) 42%,
			rgb(255 255 255 / 0.08) 50%,
			rgb(255 255 255 / 0.045) 58%,
			transparent 80%
		);
		transform: translateX(-100%);
		animation: shimmer 1.6s var(--ease-in-out) infinite;
	}
	.poster {
		width: 100%;
		aspect-ratio: 2 / 3;
	}
	.backdrop {
		width: 100%;
		aspect-ratio: 16 / 9;
	}
	.circle {
		aspect-ratio: 1;
		border-radius: 50%;
	}
	.line {
		height: 0.85em;
		border-radius: var(--radius-xs);
	}
	@keyframes shimmer {
		to {
			transform: translateX(100%);
		}
	}
</style>
