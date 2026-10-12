<!--
	Switch row: label (+ optional description) with an on/off switch (role="switch").
	The whole row is the hit area.
-->
<script lang="ts">
	interface Props {
		label: string;
		description?: string;
		checked: boolean;
		disabled?: boolean;
		onchange?: (checked: boolean) => void;
	}

	let { label, description, checked = $bindable(), disabled = false, onchange }: Props = $props();
	const id = $props.id();

	function toggle() {
		if (disabled) return;
		checked = !checked;
		onchange?.(checked);
	}
</script>

<button
	type="button"
	class="toggle"
	role="switch"
	aria-checked={checked}
	aria-labelledby="{id}-l"
	aria-describedby={description ? `${id}-d` : undefined}
	{disabled}
	data-focusable
	onclick={toggle}
>
	<span class="text">
		<span class="label" id="{id}-l">{label}</span>
		{#if description}<span class="desc" id="{id}-d">{description}</span>{/if}
	</span>
	<span class="track" aria-hidden="true"><span class="thumb"></span></span>
</button>

<style>
	.toggle {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		min-height: 3rem;
		padding: 0.6rem 0.75rem;
		margin: 0 -0.75rem;
		width: calc(100% + 1.5rem);
		border: 0;
		border-radius: var(--radius-m);
		background: transparent;
		text-align: left;
		transition: background-color var(--dur) var(--ease-out);
	}
	.toggle:hover:not(:disabled) {
		background: var(--bg-hover);
	}
	.toggle:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.text {
		display: grid;
		gap: 0.15rem;
	}
	.label {
		font-weight: 650;
	}
	.desc {
		font-size: var(--text-s);
		color: var(--text-3);
	}
	.track {
		position: relative;
		flex: none;
		width: 2.75rem;
		height: 1.6rem;
		border-radius: var(--radius-pill);
		background: rgb(255 255 255 / 0.14);
		box-shadow: inset 0 0 0 1px var(--line);
		transition: background-color var(--dur) var(--ease-out);
	}
	.thumb {
		position: absolute;
		top: 0.2rem;
		left: 0.2rem;
		width: 1.2rem;
		height: 1.2rem;
		border-radius: 50%;
		background: #fff;
		box-shadow: var(--shadow-1);
		transition: transform var(--dur) var(--ease-out);
	}
	[aria-checked='true'] .track {
		background: var(--accent);
		box-shadow: 0 0 16px -4px var(--accent-glow);
	}
	[aria-checked='true'] .thumb {
		transform: translateX(1.15rem);
	}
</style>
