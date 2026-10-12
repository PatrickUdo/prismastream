<script lang="ts">
	import { t } from '#lib/i18n/index.svelte.ts';
	import { clamp, formatTime } from './format.ts';

	interface Props {
		current: number;
		duration: number;
		buffered: number;
		onSeek: (sec: number) => void;
		/** Called while dragging starts/stops (keeps the overlay visible). */
		onScrubbing?: (active: boolean) => void;
	}

	let { current, duration, buffered, onSeek, onScrubbing }: Props = $props();

	let track: HTMLDivElement | undefined = $state();
	let dragging = $state(false);
	let hoverX = $state<number | null>(null);
	let dragTime = $state(0);

	const safeDur = $derived(duration > 0 ? duration : 0);
	const shown = $derived(dragging ? dragTime : current);
	const pct = (v: number) => (safeDur ? clamp((v / safeDur) * 100, 0, 100) : 0);
	const hoverTime = $derived(
		hoverX !== null && track ? (hoverX / track.clientWidth) * safeDur : null
	);
	const previewTime = $derived(dragging ? dragTime : hoverTime);

	function timeAt(clientX: number): number {
		if (!track) return 0;
		const r = track.getBoundingClientRect();
		return clamp((clientX - r.left) / r.width, 0, 1) * safeDur;
	}

	function onPointerDown(e: PointerEvent) {
		if (!safeDur || e.button > 0) return;
		e.preventDefault();
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		dragging = true;
		dragTime = timeAt(e.clientX);
		onScrubbing?.(true);
	}

	function onPointerMove(e: PointerEvent) {
		if (!track) return;
		const r = track.getBoundingClientRect();
		hoverX = clamp(e.clientX - r.left, 0, r.width);
		if (dragging) dragTime = timeAt(e.clientX);
	}

	function onPointerUp(e: PointerEvent) {
		if (!dragging) return;
		dragging = false;
		onSeek(timeAt(e.clientX));
		onScrubbing?.(false);
		if (e.pointerType !== 'mouse') hoverX = null;
	}

	function onPointerCancel() {
		if (dragging) onScrubbing?.(false);
		dragging = false;
		hoverX = null;
	}

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Home') {
			e.preventDefault();
			onSeek(0);
		} else if (e.key === 'End') {
			e.preventDefault();
			onSeek(Math.max(0, safeDur - 1));
		}
	}
</script>

<div class="scrubber" class:dragging>
	<div
		class="hit"
		role="slider"
		tabindex="0"
		data-focusable
		data-scrubber
		aria-label={t('player.seek')}
		aria-valuemin={0}
		aria-valuemax={Math.round(safeDur)}
		aria-valuenow={Math.round(shown)}
		aria-valuetext={`${formatTime(shown)} / ${formatTime(safeDur)}`}
		onpointerdown={onPointerDown}
		onpointermove={onPointerMove}
		onpointerup={onPointerUp}
		onpointercancel={onPointerCancel}
		onpointerleave={() => !dragging && (hoverX = null)}
		onkeydown={onKey}
	>
		<div class="track" bind:this={track}>
			<div class="bars">
				<div class="buffer" style:transform="scaleX({pct(buffered) / 100})"></div>
				{#if hoverX !== null && !dragging && track}
					<div class="hover" style:transform="scaleX({hoverX / (track.clientWidth || 1)})"></div>
				{/if}
				<div class="fill" style:transform="scaleX({pct(shown) / 100})"></div>
			</div>
			<div class="thumb" style:left="{pct(shown)}%"></div>
		</div>
		{#if previewTime !== null && safeDur > 0}
			<div class="preview" style:left="clamp(28px, {pct(previewTime)}%, calc(100% - 28px))">
				{formatTime(previewTime)}
			</div>
		{/if}
	</div>
</div>

<style>
	.scrubber {
		position: relative;
		width: 100%;
	}
	.hit {
		position: relative;
		padding: 14px 0;
		cursor: pointer;
		touch-action: none;
		border-radius: var(--radius-pill);
		outline: none;
	}
	.hit:focus-visible {
		box-shadow: none;
	}
	/* Fixed layout box; the visual thickness animates with transform only. */
	.track {
		position: relative;
		height: 7px;
	}
	.bars {
		position: absolute;
		inset: 0;
		border-radius: var(--radius-pill);
		background: var(--line-strong);
		overflow: hidden;
		transform: scaleY(0.58);
		transition: transform var(--dur-fast) var(--ease-out);
	}
	.hit:hover .bars,
	.dragging .bars,
	.hit:focus-visible .bars {
		transform: none;
	}
	.buffer,
	.hover,
	.fill {
		position: absolute;
		inset: 0;
		transform-origin: left center;
		will-change: transform;
	}
	.buffer {
		background: var(--text-3);
	}
	.hover {
		background: var(--text-3);
		opacity: 0.6;
	}
	.fill {
		background: var(--accent);
	}
	.thumb {
		position: absolute;
		top: 50%;
		width: 16px;
		height: 16px;
		border-radius: 50%;
		background: var(--text);
		transform: translate(-50%, -50%) scale(0.75);
		transition: transform var(--dur-fast) var(--ease-out);
		box-shadow: 0 0 0 4px var(--accent-soft);
	}
	.hit:hover .thumb,
	.dragging .thumb {
		transform: translate(-50%, -50%) scale(1);
	}
	.hit:focus-visible .thumb {
		transform: translate(-50%, -50%) scale(1.1);
		box-shadow: var(--focus-ring);
	}
	.preview {
		position: absolute;
		bottom: calc(100% + 2px);
		transform: translateX(-50%);
		padding: 6px 10px;
		border-radius: var(--radius-s);
		background: var(--bg-elev-3);
		border: 1px solid var(--line);
		font-size: 13px;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
		pointer-events: none;
	}
</style>
