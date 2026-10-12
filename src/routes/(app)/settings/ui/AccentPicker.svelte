<!--
	Accent colour: 8 presets plus a custom colour (input type=color). Applies live through
	user.updateSettings({ accent }); the root layout turns it into the --accent token.
-->
<script lang="ts">
	import { t } from '#lib/i18n/index.svelte.ts';
	import { user } from '#lib/stores/user.svelte.ts';
	import Button from '#lib/components/Button.svelte';
	import Chip from '#lib/components/Chip.svelte';
	import Icon from '#lib/components/Icon.svelte';

	const PRESETS = [
		{ id: 'violet', color: '#7c5cff' },
		{ id: 'ice', color: '#5cc8ff' },
		{ id: 'emerald', color: '#2fd18b' },
		{ id: 'amber', color: '#ffb020' },
		{ id: 'pink', color: '#ff6fae' },
		{ id: 'coral', color: '#ff7a59' },
		{ id: 'lemon', color: '#e6e04a' },
		{ id: 'white', color: '#ecebff' }
	] as const;

	let group = $state<HTMLDivElement>();
	const current = $derived(user.settings.accent.toLowerCase());
	const presetIndex = $derived(PRESETS.findIndex((p) => p.color === current));
	const isCustom = $derived(presetIndex === -1);
	/** <input type=color> only accepts #rrggbb. */
	const colorValue = $derived(/^#[0-9a-f]{6}$/.test(current) ? current : '#7c5cff');

	function set(color: string) {
		void user.updateSettings({ accent: color });
	}

	function onkey(e: KeyboardEvent, i: number) {
		const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
		if (!step) return;
		e.preventDefault();
		const j = (i + step + PRESETS.length) % PRESETS.length;
		set(PRESETS[j].color);
		group?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[j]?.focus();
	}
</script>

<div class="accent">
	<div
		class="swatches"
		role="radiogroup"
		aria-label={t('settings.appearance.accent')}
		bind:this={group}
	>
		{#each PRESETS as p, i (p.id)}
			<button
				type="button"
				role="radio"
				class="swatch"
				style:--c={p.color}
				aria-checked={presetIndex === i}
				aria-label={t(`settings.accent.${p.id}`)}
				title={t(`settings.accent.${p.id}`)}
				tabindex={presetIndex === i || (isCustom && i === 0) ? 0 : -1}
				data-focusable
				onclick={() => set(p.color)}
				onkeydown={(e) => onkey(e, i)}
			>
				{#if presetIndex === i}<Icon name="check" size="1rem" />{/if}
			</button>
		{/each}
		<label class="swatch custom" class:selected={isCustom} title={t('settings.appearance.custom')}>
			<input
				type="color"
				value={colorValue}
				oninput={(e) => set(e.currentTarget.value)}
				aria-label={t('settings.appearance.custom')}
				data-focusable
			/>
			<span class="rainbow" aria-hidden="true"></span>
			{#if isCustom}<span class="dot" aria-hidden="true" style:--c={current}></span>{/if}
		</label>
	</div>

	<div class="preview" aria-hidden="true">
		<Button variant="primary" size="s" icon="play" tabindex={-1}>{t('common.play')}</Button>
		<Chip selected>{t('settings.appearance.previewChip')}</Chip>
		<span class="bar"><span></span></span>
	</div>
</div>

<style>
	.accent {
		display: grid;
		gap: 1rem;
	}
	.swatches {
		display: flex;
		flex-wrap: wrap;
		gap: 0.65rem;
	}
	.swatch {
		position: relative;
		display: grid;
		place-items: center;
		width: 2.75rem;
		height: 2.75rem;
		border: 0;
		border-radius: 50%;
		background: var(--c);
		color: color-mix(in oklab, var(--c) 25%, black);
		box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.2);
		cursor: pointer;
		transition:
			transform var(--dur-fast) var(--ease-out),
			box-shadow var(--dur) var(--ease-out);
	}
	.swatch:hover {
		transform: scale(1.08);
	}
	.swatch[aria-checked='true'],
	.swatch.selected {
		box-shadow:
			0 0 0 2px var(--bg),
			0 0 0 4px var(--c, var(--accent)),
			0 8px 24px -6px var(--c, var(--accent));
	}
	.custom {
		overflow: hidden;
		background: none;
	}
	.custom.selected {
		--c: var(--accent);
	}
	.custom input {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		opacity: 0;
		cursor: pointer;
	}
	.custom:has(input:focus-visible) {
		box-shadow: var(--focus-ring);
	}
	.rainbow {
		position: absolute;
		inset: 0;
		border-radius: 50%;
		background: conic-gradient(#ff6b8b, #ffd36b, #6dffb8, #5cc8ff, #a77bff, #ff6b8b);
		pointer-events: none;
	}
	.dot {
		position: relative;
		width: 1.1rem;
		height: 1.1rem;
		border-radius: 50%;
		background: var(--c);
		box-shadow: 0 0 0 2px #fff;
		pointer-events: none;
	}
	.preview {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.75rem;
		padding: 0.85rem 1rem;
		border-radius: var(--radius-m);
		background: rgb(0 0 0 / 0.2);
		border: 1px solid var(--line);
		pointer-events: none;
	}
	.bar {
		flex: 1;
		min-width: 5rem;
		height: 4px;
		border-radius: 4px;
		background: rgb(255 255 255 / 0.12);
		overflow: hidden;
	}
	.bar span {
		display: block;
		width: 62%;
		height: 100%;
		background: var(--accent);
		box-shadow: 0 0 10px var(--accent-glow);
	}
</style>
