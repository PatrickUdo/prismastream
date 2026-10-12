<!--
	Single-choice chip group (ARIA radiogroup with roving tabindex and arrow keys).
	Building block for the language / quality / source pickers.
-->
<script lang="ts" module>
	export interface ChoiceOption {
		value: string;
		label: string;
		/** Small trailing hint, e.g. "4K" or a count. */
		hint?: string;
		/** Secondary text for screen readers / tooltip. */
		description?: string;
		disabled?: boolean;
	}
</script>

<script lang="ts">
	import Icon, { type IconName } from './Icon.svelte';

	interface Props {
		label: string;
		icon?: IconName;
		options: ChoiceOption[];
		value?: string;
		onchange?: (value: string) => void;
		/** Read-only groups show the options as static chips. */
		readonly?: boolean;
		emptyText?: string;
	}

	let {
		label,
		icon,
		options,
		value = $bindable(),
		onchange,
		readonly = false,
		emptyText = ''
	}: Props = $props();

	const id = $props.id();
	let group = $state<HTMLDivElement>();

	const focusIndex = $derived(
		Math.max(
			0,
			options.findIndex((o) => o.value === value)
		)
	);

	function choose(v: string) {
		if (v === value) return;
		value = v;
		onchange?.(v);
	}

	function onkeydown(e: KeyboardEvent, i: number) {
		const keys: Record<string, number> = {
			ArrowRight: 1,
			ArrowDown: 1,
			ArrowLeft: -1,
			ArrowUp: -1
		};
		const step = keys[e.key];
		if (!step) return;
		e.preventDefault();
		const n = options.length;
		for (let k = 1; k <= n; k++) {
			const j = (i + step * k + n) % n;
			if (!options[j].disabled) {
				choose(options[j].value);
				group?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[j]?.focus();
				return;
			}
		}
	}
</script>

<div class="choice">
	<div class="head" id="{id}-label">
		{#if icon}<Icon name={icon} size="1rem" />{/if}
		<span>{label}</span>
	</div>
	{#if options.length === 0}
		<p class="empty">{emptyText}</p>
	{:else if readonly}
		<ul class="options" aria-labelledby="{id}-label">
			{#each options as o (o.value)}
				<li class="opt static" title={o.description}>
					{o.label}
					{#if o.hint}<span class="hint">{o.hint}</span>{/if}
				</li>
			{/each}
		</ul>
	{:else}
		<div class="options" role="radiogroup" aria-labelledby="{id}-label" bind:this={group}>
			{#each options as o, i (o.value)}
				<button
					type="button"
					role="radio"
					class="opt"
					aria-checked={o.value === value}
					tabindex={i === focusIndex ? 0 : -1}
					disabled={o.disabled}
					title={o.description}
					data-focusable
					onclick={() => choose(o.value)}
					onkeydown={(e) => onkeydown(e, i)}
				>
					{#if o.value === value}<Icon name="check" size="0.95em" />{/if}
					{o.label}
					{#if o.hint}<span class="hint">{o.hint}</span>{/if}
				</button>
			{/each}
		</div>
	{/if}
</div>

<style>
	.choice {
		display: grid;
		gap: 0.65rem;
	}
	.head {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		font-size: var(--text-xs);
		font-weight: 700;
		letter-spacing: var(--tracking-caps);
		text-transform: uppercase;
		color: var(--text-3);
	}
	.options {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.opt {
		display: inline-flex;
		align-items: center;
		gap: 0.4em;
		min-height: 2.5rem;
		padding: 0 1rem;
		border-radius: var(--radius-pill);
		border: 1px solid var(--line);
		background: rgb(255 255 255 / 0.04);
		color: var(--text-2);
		font-size: var(--text-s);
		font-weight: 650;
		transition:
			background-color var(--dur) var(--ease-out),
			border-color var(--dur) var(--ease-out),
			color var(--dur) var(--ease-out),
			transform var(--dur-fast) var(--ease-out);
	}
	button.opt:hover:not(:disabled) {
		background: var(--bg-hover);
		border-color: var(--line-strong);
		color: var(--text);
	}
	button.opt:active:not(:disabled) {
		transform: scale(0.97);
	}
	button.opt:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	.opt[aria-checked='true'] {
		background: var(--accent-soft);
		border-color: color-mix(in oklab, var(--accent) 65%, transparent);
		color: var(--text);
	}
	.opt.static {
		min-height: 2.1rem;
		padding: 0 0.85rem;
	}
	.hint {
		font-size: 0.82em;
		font-weight: 700;
		color: var(--text-3);
	}
	.opt[aria-checked='true'] .hint {
		color: var(--text-2);
	}
	.empty {
		color: var(--text-3);
		font-size: var(--text-s);
	}
</style>
