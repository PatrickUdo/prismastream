<!--
	Modal dialog built on <dialog> (focus trap, Escape and backdrop click close it).
	Content is only rendered while open, so iframes/videos stop when closed.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { t } from '#lib/i18n/index.svelte.ts';
	import Icon from './Icon.svelte';

	interface Props {
		open: boolean;
		label: string;
		/** 'media' = wide 16:9 stage without padding. */
		variant?: 'media' | 'panel';
		onclose?: () => void;
		children: Snippet;
	}

	let { open = $bindable(), label, variant = 'panel', onclose, children }: Props = $props();
	let dialog = $state<HTMLDialogElement>();

	$effect(() => {
		if (!dialog) return;
		if (open && !dialog.open) dialog.showModal();
		else if (!open && dialog.open) dialog.close();
	});

	function handleClose() {
		open = false;
		onclose?.();
	}
</script>

<dialog
	bind:this={dialog}
	class={variant}
	aria-label={label}
	onclose={handleClose}
	onclick={(e) => {
		if (e.target === dialog) dialog?.close();
	}}
>
	{#if open}
		<div class="inner">
			<button
				type="button"
				class="close"
				aria-label={t('common.close')}
				onclick={() => dialog?.close()}
			>
				<Icon name="close" size="1.25rem" />
			</button>
			{@render children()}
		</div>
	{/if}
</dialog>

<style>
	dialog {
		padding: 0;
		border: 0;
		background: transparent;
		color: var(--text);
		max-width: none;
		max-height: none;
		overflow: visible;
	}
	dialog::backdrop {
		background: rgb(3 3 6 / 0.78);
		backdrop-filter: blur(8px);
		-webkit-backdrop-filter: blur(8px);
	}
	dialog[open] {
		animation: pop var(--dur-slow) var(--ease-out);
	}
	dialog[open]::backdrop {
		animation: fade var(--dur) var(--ease-out);
	}
	.inner {
		position: relative;
	}
	.media .inner {
		width: min(92vw, calc(82vh * 16 / 9), 1400px);
		aspect-ratio: 16 / 9;
		border-radius: var(--radius-l);
		overflow: hidden;
		background: #000;
		box-shadow: var(--shadow-3);
	}
	.panel .inner {
		width: min(92vw, 36rem);
		padding: 2rem;
		border-radius: var(--radius-l);
		background: var(--bg-glass-strong);
		border: 1px solid var(--line);
		box-shadow: var(--shadow-3);
	}
	.close {
		position: absolute;
		top: 0.75rem;
		right: 0.75rem;
		z-index: 2;
		display: grid;
		place-items: center;
		width: 2.5rem;
		height: 2.5rem;
		border: 1px solid rgb(255 255 255 / 0.14);
		border-radius: 50%;
		background: rgb(10 10 16 / 0.6);
		backdrop-filter: blur(12px);
		-webkit-backdrop-filter: blur(12px);
		transition: background-color var(--dur) var(--ease-out);
	}
	.close:hover {
		background: rgb(30 30 40 / 0.85);
	}
	@keyframes pop {
		from {
			opacity: 0;
			transform: translateY(12px) scale(0.98);
		}
	}
	@keyframes fade {
		from {
			opacity: 0;
		}
	}
</style>
