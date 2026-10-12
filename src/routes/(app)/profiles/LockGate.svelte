<!--
	Inline PIN gate for pages that need a PIN first (editing a locked profile, managing
	profiles or settings while in kids mode).
-->
<script lang="ts">
	import { kids } from '#lib/stores/kids.svelte.ts';
	import PinPad from './PinPad.svelte';

	interface Props {
		title: string;
		subtitle?: string;
		hashes: string[];
		onsuccess: () => void;
		oncancel?: () => void;
	}

	let { title, subtitle, hashes, onsuccess, oncancel }: Props = $props();

	async function submit(pin: string) {
		const r = await kids.checkPin(pin, hashes);
		if (r === 'ok') onsuccess();
		return r;
	}
</script>

<div class="gate glass">
	<PinPad {title} {subtitle} onsubmit={submit} {oncancel} />
</div>

<style>
	.gate {
		width: min(100%, 26rem);
		margin: clamp(1rem, 6vh, 4rem) auto;
		padding: clamp(1.5rem, 1rem + 2vw, 2.5rem) 1.25rem;
		border-radius: var(--radius-xl);
		box-shadow: var(--shadow-3);
	}
</style>
