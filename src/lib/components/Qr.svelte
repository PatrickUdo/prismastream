<!-- QR code as crisp SVG (generated on the device, see #lib/qr/qr.ts). -->
<script lang="ts">
	import { encodeQr, qrPath } from '#lib/qr/qr.ts';

	interface Props {
		value: string;
		/** Accessible label (e.g. "QR-code om deze tv te koppelen"). */
		label: string;
		size?: string;
	}

	let { value, label, size = '12rem' }: Props = $props();

	const shape = $derived.by(() => {
		try {
			return qrPath(encodeQr(value));
		} catch {
			return null;
		}
	});
</script>

{#if shape}
	<svg
		class="qr"
		viewBox="0 0 {shape.size} {shape.size}"
		width={size}
		height={size}
		role="img"
		aria-label={label}
		shape-rendering="crispEdges"
	>
		<rect width={shape.size} height={shape.size} fill="#fff" />
		<path d={shape.d} fill="#000" />
	</svg>
{/if}

<style>
	.qr {
		display: block;
		max-width: 100%;
		height: auto;
		border-radius: var(--radius-m);
	}
</style>
