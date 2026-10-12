<!--
	Modal PIN prompt. Accepts any of `hashes` (SHA-256 via hashPin, never a plain PIN);
	calls `onsuccess` and closes when a correct PIN is entered.
-->
<script lang="ts">
	import Modal from '#lib/components/Modal.svelte';
	import { kids } from '#lib/stores/kids.svelte.ts';
	import PinPad from './PinPad.svelte';

	interface Props {
		open: boolean;
		title: string;
		subtitle?: string;
		hashes: string[];
		onsuccess: () => void;
		onclose?: () => void;
	}

	let { open = $bindable(), title, subtitle, hashes, onsuccess, onclose }: Props = $props();

	async function submit(pin: string) {
		const r = await kids.checkPin(pin, hashes);
		if (r === 'ok') {
			open = false;
			onsuccess();
		}
		return r;
	}
</script>

<Modal bind:open label={title} {onclose}>
	<div class="wrap">
		<PinPad {title} {subtitle} onsubmit={submit} oncancel={() => (open = false)} />
	</div>
</Modal>

<style>
	.wrap {
		padding-top: 0.5rem;
	}
</style>
