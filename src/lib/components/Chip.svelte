<!--
	Chip / pill. Interactive (button or link) or static (span) when neither href nor onclick.
	`selected` renders the accent state. Extra attributes (role, aria-*, data-*) pass through.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import type { ResolvedPathname } from '$app/types';
	import Icon, { type IconName } from './Icon.svelte';

	interface Props extends HTMLAttributes<HTMLElement> {
		selected?: boolean;
		href?: ResolvedPathname;
		icon?: IconName;
		/** Small trailing hint, e.g. a count or "4K". */
		hint?: string | number;
		size?: 's' | 'm';
		/** Static chips: visual tone. */
		tone?: 'default' | 'outline' | 'accent' | 'live';
		disabled?: boolean;
		interactive?: boolean;
		children: Snippet;
	}

	let {
		selected = false,
		href,
		icon,
		hint,
		size = 'm',
		tone = 'default',
		disabled = false,
		interactive,
		children,
		class: cls = '',
		onclick,
		...rest
	}: Props = $props();

	const isButton = $derived(interactive ?? !!onclick);
</script>

{#snippet inner()}
	{#if icon}<Icon name={icon} size="1em" />{/if}
	<span class="label">{@render children()}</span>
	{#if hint !== undefined && hint !== ''}<span class="hint">{hint}</span>{/if}
{/snippet}

{#if href}
	<a
		{href}
		class="chip {size} {tone} {cls}"
		class:selected
		aria-current={selected ? 'true' : undefined}
		{...rest}
	>
		{@render inner()}
	</a>
{:else if isButton}
	<button
		type="button"
		class="chip {size} {tone} {cls}"
		class:selected
		{disabled}
		{onclick}
		{...rest}
	>
		{@render inner()}
	</button>
{:else}
	<span class="chip static {size} {tone} {cls}" class:selected {...rest}>
		{@render inner()}
	</span>
{/if}

<style>
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 0.45em;
		min-height: 2.25rem;
		padding: 0 0.95rem;
		border-radius: var(--radius-pill);
		border: 1px solid var(--line);
		background: rgb(255 255 255 / 0.04);
		color: var(--text-2);
		font-size: var(--text-s);
		font-weight: 650;
		white-space: nowrap;
		transition:
			background-color var(--dur) var(--ease-out),
			border-color var(--dur) var(--ease-out),
			color var(--dur) var(--ease-out),
			transform var(--dur-fast) var(--ease-out);
	}
	.s {
		min-height: 1.75rem;
		padding: 0 0.65rem;
		font-size: var(--text-xs);
	}
	@media (hover: hover) {
		a.chip:hover,
		button.chip:hover:not(:disabled) {
			background: var(--bg-hover);
			border-color: var(--line-strong);
			color: var(--text);
		}
		.chip.selected:hover {
			background: color-mix(in oklab, var(--accent) 30%, transparent);
		}
	}
	/* Touch: a 44 px hit area around interactive chips (the look stays the same). */
	@media (pointer: coarse) {
		a.chip,
		button.chip {
			position: relative;
		}
		a.chip::after,
		button.chip::after {
			content: '';
			position: absolute;
			inset: -0.25rem 0;
		}
		a.chip.s::after,
		button.chip.s::after {
			inset: -0.5rem -0.15rem;
		}
	}
	a.chip:active,
	button.chip:active:not(:disabled) {
		transform: scale(0.97);
	}
	button.chip:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	.chip.selected {
		background: var(--accent-soft);
		border-color: color-mix(in oklab, var(--accent) 60%, transparent);
		color: var(--text);
	}
	.static {
		cursor: default;
	}
	.outline {
		background: transparent;
		border-color: var(--line-strong);
	}
	.accent {
		background: var(--accent-soft);
		border-color: transparent;
		color: var(--accent-strong);
	}
	.live {
		background: color-mix(in oklab, var(--live) 18%, transparent);
		border-color: transparent;
		color: #ffd0d8;
	}
	.hint {
		font-size: 0.85em;
		font-weight: 600;
		color: var(--text-3);
		font-variant-numeric: tabular-nums;
	}
	.selected .hint {
		color: var(--text-2);
	}
</style>
