<!--
	Button / link-button.
	variant: primary (accent), light (white, for media), glass (frosted), ghost (text), icon (round glass).
	Renders <a> when href is set, otherwise <button>.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import type { ResolvedPathname } from '$app/types';
	import Icon, { type IconName } from './Icon.svelte';

	interface Props extends HTMLAttributes<HTMLElement> {
		variant?: 'primary' | 'light' | 'glass' | 'ghost' | 'icon';
		size?: 's' | 'm' | 'l';
		href?: ResolvedPathname;
		icon?: IconName;
		/** Accessible label; required for icon-only buttons. */
		label?: string;
		/** Toggle state (aria-pressed). */
		pressed?: boolean;
		disabled?: boolean;
		type?: 'button' | 'submit';
		/** 0..1 progress shown as a thin bar inside the button. */
		progress?: number;
		children?: Snippet;
	}

	let {
		variant = 'glass',
		size = 'm',
		href,
		icon,
		label,
		pressed,
		disabled = false,
		type = 'button',
		progress,
		children,
		class: cls = '',
		...rest
	}: Props = $props();

	const iconSize = $derived(size === 'l' ? '1.4rem' : size === 's' ? '1rem' : '1.2rem');
</script>

{#snippet content()}
	{#if icon}<Icon name={icon} size={iconSize} />{/if}
	{#if children}<span class="text">{@render children()}</span>{/if}
	{#if progress !== undefined && progress > 0}
		<span class="progress" aria-hidden="true"
			><span style:width="{Math.min(100, progress * 100)}%"></span></span
		>
	{/if}
{/snippet}

{#if href && !disabled}
	<a
		{href}
		class="btn {variant} {size} {cls}"
		aria-label={label}
		data-sveltekit-preload-data="hover"
		{...rest}
	>
		{@render content()}
	</a>
{:else}
	<button
		{type}
		class="btn {variant} {size} {cls}"
		aria-label={label}
		aria-pressed={pressed}
		{disabled}
		{...rest}
	>
		{@render content()}
	</button>
{/if}

<style>
	.btn {
		--h: 2.75rem;
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.55em;
		min-height: var(--h);
		padding: 0 1.25rem;
		border: 1px solid transparent;
		border-radius: var(--radius-pill);
		font-size: var(--text-m);
		font-weight: 700;
		letter-spacing: -0.005em;
		white-space: nowrap;
		overflow: hidden;
		isolation: isolate;
		transition:
			transform var(--dur-fast) var(--ease-out),
			background-color var(--dur) var(--ease-out),
			box-shadow var(--dur) var(--ease-out),
			color var(--dur) var(--ease-out),
			border-color var(--dur) var(--ease-out);
	}
	.btn:active:not(:disabled) {
		transform: scale(0.97);
	}
	.btn:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
	.s {
		--h: 2.25rem;
		padding: 0 0.95rem;
		font-size: var(--text-s);
	}
	.l {
		--h: 3.25rem;
		padding: 0 1.6rem;
		font-size: 1rem;
	}

	.primary {
		background: var(--accent);
		color: var(--accent-contrast);
		box-shadow:
			inset 0 1px 0 rgb(255 255 255 / 0.22),
			0 10px 30px -10px var(--accent-glow);
	}
	@media (hover: hover) {
		.primary:hover {
			background: color-mix(in oklab, var(--accent) 88%, white);
			box-shadow:
				inset 0 1px 0 rgb(255 255 255 / 0.25),
				0 14px 38px -10px var(--accent-glow);
		}
		.light:hover {
			background: #ffffff;
		}
		.glass:hover,
		.icon:hover {
			background: rgb(255 255 255 / 0.17);
			border-color: rgb(255 255 255 / 0.2);
		}
		.ghost:hover {
			color: var(--text);
			background: var(--bg-hover);
		}
	}
	/* Touch: small buttons still get a 44 px target. */
	@media (pointer: coarse) {
		.s {
			--h: 2.75rem;
		}
	}
	/* Variants set their own shadow; the focus ring must win over it. */
	.btn:focus-visible,
	:global(html[data-input='remote']) .btn:focus {
		box-shadow: var(--focus-ring);
	}
	/* Remote: the focused button is unmistakable from across the room. */
	:global(html[data-input='remote']) .btn:focus {
		transform: scale(1.06);
	}
	:global(html[data-input='remote']) .glass:focus,
	:global(html[data-input='remote']) .icon:focus,
	:global(html[data-input='remote']) .ghost:focus {
		background: rgb(255 255 255 / 0.2);
		color: var(--text);
	}

	.light {
		background: #f6f5fa;
		color: #0b0b10;
		box-shadow: 0 10px 30px -12px rgb(0 0 0 / 0.6);
	}

	.glass,
	.icon {
		background: rgb(255 255 255 / 0.1);
		border-color: rgb(255 255 255 / 0.12);
		color: var(--text);
		backdrop-filter: blur(16px) saturate(140%);
		-webkit-backdrop-filter: blur(16px) saturate(140%);
	}
	.glass[aria-pressed='true'],
	.icon[aria-pressed='true'] {
		color: var(--accent-strong);
		border-color: color-mix(in oklab, var(--accent) 50%, transparent);
		background: var(--accent-soft);
	}

	.ghost {
		background: transparent;
		color: var(--text-2);
		padding-inline: 0.75rem;
	}

	.icon {
		width: var(--h);
		padding: 0;
	}

	.text {
		display: inline-flex;
		align-items: center;
		gap: 0.4em;
	}

	.progress {
		position: absolute;
		left: 1.1rem;
		right: 1.1rem;
		bottom: 0.45rem;
		height: 3px;
		border-radius: 3px;
		background: rgb(0 0 0 / 0.18);
		overflow: hidden;
	}
	.light .progress {
		background: rgb(0 0 0 / 0.12);
	}
	.progress span {
		display: block;
		height: 100%;
		background: currentColor;
		border-radius: inherit;
	}
	.btn:has(.progress) {
		padding-bottom: 0.35rem;
	}
</style>
