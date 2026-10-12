<script lang="ts">
	import type { Snippet } from 'svelte';
	import { t } from '#lib/i18n/index.svelte.ts';
	import Icon from './Icon.svelte';

	interface Props {
		title: string;
		wide?: boolean;
		onClose: () => void;
		el?: HTMLElement;
		children: Snippet;
		header?: Snippet;
	}

	let { title, wide = false, onClose, el = $bindable(), children, header }: Props = $props();
</script>

<div
	class="panel"
	class:wide
	role="dialog"
	tabindex="-1"
	aria-modal="false"
	aria-label={title}
	bind:this={el}
	onpointerdown={(e) => e.stopPropagation()}
>
	<header>
		<h2>{title}</h2>
		<button
			type="button"
			class="close"
			data-focusable
			aria-label={t('player.close')}
			onclick={onClose}
		>
			<Icon name="close" size={22} />
		</button>
	</header>
	{#if header}
		<div class="sub">{@render header()}</div>
	{/if}
	<div class="body">
		{@render children()}
	</div>
</div>

<style>
	.panel {
		position: absolute;
		z-index: 30;
		right: max(var(--gutter), env(safe-area-inset-right, 0px));
		bottom: calc(132px + var(--safe-bottom));
		width: min(380px, calc(100vw - 2 * var(--gutter)));
		max-height: min(68vh, calc(100% - 200px - var(--safe-top) - var(--safe-bottom)));
		display: flex;
		flex-direction: column;
		border-radius: var(--radius-l);
		background: color-mix(in oklab, var(--bg-elev-2) 78%, transparent);
		border: 1px solid var(--line-strong);
		backdrop-filter: blur(28px) saturate(1.4);
		-webkit-backdrop-filter: blur(28px) saturate(1.4);
		box-shadow: 0 30px 80px color-mix(in oklab, var(--bg) 55%, transparent);
		overflow: hidden;
		animation: rise var(--dur) var(--ease-out);
	}
	.panel.wide {
		top: calc(var(--safe-top) + 16px);
		bottom: calc(16px + var(--safe-bottom));
		max-height: none;
		width: min(460px, calc(100vw - 2 * var(--gutter)));
		animation-name: slide;
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 18px 14px 10px 22px;
	}
	h2 {
		margin: 0;
		font-size: 17px;
		font-weight: 700;
		letter-spacing: 0.01em;
	}
	.close {
		display: grid;
		place-items: center;
		width: 40px;
		height: 40px;
		border: 0;
		border-radius: 50%;
		background: transparent;
		color: var(--text-2);
		cursor: pointer;
		transition:
			background var(--dur-fast),
			color var(--dur-fast);
	}
	.close:hover {
		background: var(--line);
		color: var(--text);
	}
	.sub {
		padding: 0 14px 8px;
	}
	.body {
		overflow-y: auto;
		overscroll-behavior: contain;
		padding: 4px 8px 12px;
		scrollbar-width: thin;
	}
	@keyframes rise {
		from {
			opacity: 0;
			transform: translateY(12px) scale(0.98);
		}
	}
	@keyframes slide {
		from {
			opacity: 0;
			transform: translateX(24px);
		}
	}
	@media (max-width: 640px), (max-height: 480px) {
		.panel,
		.panel.wide {
			left: max(12px, env(safe-area-inset-left, 0px));
			right: max(12px, env(safe-area-inset-right, 0px));
			top: auto;
			bottom: calc(12px + var(--safe-bottom));
			width: auto;
			max-height: min(78vh, calc(100% - 24px - var(--safe-top) - var(--safe-bottom)));
			animation-name: rise;
		}
	}
	@media (max-height: 480px) and (min-width: 641px) {
		.panel,
		.panel.wide {
			left: auto;
			width: min(420px, 60vw);
		}
	}
</style>
