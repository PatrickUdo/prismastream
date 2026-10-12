<!-- Thin accent progress bar (0..1). -->
<script lang="ts">
	interface Props {
		value: number;
		label?: string;
		size?: 's' | 'm';
	}

	let { value, label, size = 's' }: Props = $props();
	const pct = $derived(Math.round(Math.min(1, Math.max(0, value)) * 100));
</script>

<span
	class="bar {size}"
	role={label ? 'progressbar' : undefined}
	aria-label={label}
	aria-valuenow={label ? pct : undefined}
	aria-valuemin={label ? 0 : undefined}
	aria-valuemax={label ? 100 : undefined}
	aria-hidden={label ? undefined : 'true'}
>
	<span class="fill" style:width="{pct}%"></span>
</span>

<style>
	.bar {
		display: block;
		width: 100%;
		height: 3px;
		border-radius: 3px;
		background: rgb(255 255 255 / 0.18);
		overflow: hidden;
	}
	.m {
		height: 4px;
	}
	.fill {
		display: block;
		height: 100%;
		border-radius: inherit;
		background: var(--accent);
		box-shadow: 0 0 10px var(--accent-glow);
	}
</style>
