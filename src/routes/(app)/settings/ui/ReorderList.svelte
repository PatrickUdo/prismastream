<!--
	Reorderable list: drag the grip with mouse, pen or touch (pointer events), or use the
	up/down buttons (remote control, keyboard, assistive tech). Arrow keys on the grip
	move the item too. Calls `onreorder` with the new order.
-->
<script lang="ts" generics="T">
	import type { Snippet } from 'svelte';
	import { tick } from 'svelte';
	import { flip } from 'svelte/animate';
	import { prefersReducedMotion } from 'svelte/motion';
	import { t } from '#lib/i18n/index.svelte.ts';
	import { user } from '#lib/stores/user.svelte.ts';
	import Icon from '#lib/components/Icon.svelte';

	interface Props {
		items: T[];
		key: (item: T) => string;
		/** Plain-text name of an item (for button labels and announcements). */
		label: (item: T) => string;
		row: Snippet<[T, number]>;
		/** Extra controls at the end of a row (e.g. a switch or remove button). */
		trailing?: Snippet<[T, number]>;
		onreorder: (items: T[]) => void;
		ariaLabel: string;
		/** Rows with `muted` styling (e.g. hidden home rows). */
		muted?: (item: T) => boolean;
	}

	let { items, key, label, row, trailing, onreorder, ariaLabel, muted }: Props = $props();

	const id = $props.id();
	let listEl = $state<HTMLOListElement>();
	let local = $state.raw<T[] | null>(null);
	let drag = $state<{ key: string; startY: number; offset: number; pointer: number } | null>(null);
	let announcement = $state('');

	const list = $derived(local ?? items);
	const reduce = $derived(prefersReducedMotion.current || user.settings.reduceMotion);

	function rowEl(k: string): HTMLElement | null {
		return listEl?.querySelector<HTMLElement>(`[data-key="${CSS.escape(k)}"]`) ?? null;
	}

	function announce(item: T, pos: number, total: number) {
		announcement = t('settings.reorder.moved', { label: label(item), pos, total });
	}

	async function move(i: number, dir: -1 | 1, focus: 'up' | 'down' | 'grip') {
		const j = i + dir;
		if (j < 0 || j >= items.length) return;
		const next = [...items];
		const [it] = next.splice(i, 1);
		next.splice(j, 0, it);
		onreorder(next);
		announce(it, j + 1, next.length);
		await tick();
		const el = rowEl(key(it));
		let btn = el?.querySelector<HTMLButtonElement>(`[data-act="${focus}"]`);
		if (btn?.disabled) btn = el?.querySelector<HTMLButtonElement>(`[data-act="grip"]`);
		btn?.focus();
	}

	function onpointerdown(e: PointerEvent, item: T) {
		if (e.pointerType === 'mouse' && e.button !== 0) return;
		e.preventDefault();
		try {
			(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		} catch {
			// Pointer already gone; moves still arrive while it is over the grip.
		}
		local = [...items];
		drag = { key: key(item), startY: e.clientY, offset: 0, pointer: e.pointerId };
	}

	function onpointermove(e: PointerEvent) {
		if (!drag || !local || e.pointerId !== drag.pointer) return;
		const cur = local;
		const i = cur.findIndex((x) => key(x) === drag!.key);
		const el = rowEl(drag.key);
		let offset = e.clientY - drag.startY;
		if (el && offset > 0 && i < cur.length - 1) {
			const nextEl = rowEl(key(cur[i + 1]));
			const step = nextEl ? nextEl.offsetTop - el.offsetTop : 0;
			if (step > 0 && offset > step / 2) {
				local = swap(cur, i, i + 1);
				drag.startY += step;
				offset -= step;
			}
		} else if (el && offset < 0 && i > 0) {
			const prevEl = rowEl(key(cur[i - 1]));
			const step = prevEl ? el.offsetTop - prevEl.offsetTop : 0;
			if (step > 0 && -offset > step / 2) {
				local = swap(cur, i, i - 1);
				drag.startY -= step;
				offset += step;
			}
		}
		drag.offset = offset;
	}

	function onpointerup(e: PointerEvent) {
		if (!drag || e.pointerId !== drag.pointer) return;
		const result = local;
		const moved = drag.key;
		drag = null;
		local = null;
		if (result && result.some((x, i) => key(x) !== key(items[i]))) {
			onreorder(result);
			const i = result.findIndex((x) => key(x) === moved);
			announce(result[i], i + 1, result.length);
		}
	}

	function swap(arr: T[], a: number, b: number): T[] {
		const next = [...arr];
		[next[a], next[b]] = [next[b], next[a]];
		return next;
	}

	function onGripKey(e: KeyboardEvent, i: number) {
		if (e.key === 'ArrowUp' && i > 0) {
			e.preventDefault();
			void move(i, -1, 'grip');
		} else if (e.key === 'ArrowDown' && i < items.length - 1) {
			e.preventDefault();
			void move(i, 1, 'grip');
		}
	}
</script>

<ol class="reorder" class:dragging={!!drag} aria-label={ariaLabel} bind:this={listEl}>
	{#each list as item, i (key(item))}
		{@const k = key(item)}
		{@const active = drag?.key === k}
		<li
			class="item"
			class:active
			class:muted={muted?.(item)}
			data-key={k}
			style:transform={active ? `translateY(${drag?.offset ?? 0}px)` : undefined}
			animate:flip={{ duration: active || reduce ? 0 : 220 }}
		>
			<button
				type="button"
				class="grip"
				data-act="grip"
				data-focusable
				aria-label={t('settings.reorder.handle', { label: label(item) })}
				aria-describedby="{id}-help"
				onpointerdown={(e) => onpointerdown(e, item)}
				{onpointermove}
				{onpointerup}
				onpointercancel={onpointerup}
				onkeydown={(e) => onGripKey(e, i)}
			>
				<Icon name="grip" size="1.15rem" />
			</button>
			<span class="pos" aria-hidden="true">{i + 1}</span>
			<div class="content">{@render row(item, i)}</div>
			{#if trailing}<div class="trailing">{@render trailing(item, i)}</div>{/if}
			<div class="moves">
				<button
					type="button"
					class="mv"
					data-act="up"
					data-focusable
					disabled={i === 0}
					aria-label={t('settings.reorder.up', { label: label(item) })}
					onclick={() => move(i, -1, 'up')}
				>
					<Icon name="arrow-up" size="1rem" />
				</button>
				<button
					type="button"
					class="mv"
					data-act="down"
					data-focusable
					disabled={i === list.length - 1}
					aria-label={t('settings.reorder.down', { label: label(item) })}
					onclick={() => move(i, 1, 'down')}
				>
					<Icon name="arrow-down" size="1rem" />
				</button>
			</div>
		</li>
	{/each}
</ol>
<p class="sr-only" id="{id}-help">{t('settings.reorder.help')}</p>
<p class="sr-only" aria-live="polite">{announcement}</p>

<style>
	.reorder {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 0.45rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.item {
		position: relative;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-height: 3.5rem;
		padding: 0.35rem 0.4rem 0.35rem 0.25rem;
		border-radius: var(--radius-m);
		border: 1px solid var(--line);
		background: rgb(255 255 255 / 0.035);
		transition:
			background-color var(--dur) var(--ease-out),
			border-color var(--dur) var(--ease-out),
			box-shadow var(--dur) var(--ease-out),
			opacity var(--dur) var(--ease-out);
	}
	.item.muted .content,
	.item.muted .pos {
		opacity: 0.45;
	}
	.item.active {
		z-index: 2;
		background: var(--bg-elev-3);
		border-color: color-mix(in oklab, var(--accent) 55%, transparent);
		box-shadow:
			var(--shadow-3),
			0 0 0 1px var(--accent-soft);
		transition: none;
	}
	.dragging {
		user-select: none;
		-webkit-user-select: none;
	}
	.grip {
		display: grid;
		place-items: center;
		flex: none;
		width: 2.5rem;
		height: 2.75rem;
		border: 0;
		border-radius: var(--radius-s);
		background: none;
		color: var(--text-3);
		cursor: grab;
		touch-action: none;
	}
	.grip:hover {
		color: var(--text);
		background: var(--bg-hover);
	}
	.active .grip {
		cursor: grabbing;
		color: var(--accent-strong);
	}
	.pos {
		flex: none;
		width: 1.25rem;
		font-size: var(--text-xs);
		font-weight: 750;
		color: var(--text-3);
		font-variant-numeric: tabular-nums;
		text-align: center;
	}
	.content {
		flex: 1;
		min-width: 0;
	}
	.trailing {
		flex: none;
		display: flex;
		align-items: center;
	}
	.moves {
		flex: none;
		display: flex;
		gap: 0.2rem;
	}
	.mv {
		display: grid;
		place-items: center;
		width: 2.4rem;
		height: 2.4rem;
		border: 1px solid transparent;
		border-radius: 50%;
		background: rgb(255 255 255 / 0.05);
		color: var(--text-2);
		transition:
			background-color var(--dur) var(--ease-out),
			color var(--dur) var(--ease-out);
	}
	.mv:hover:not(:disabled) {
		background: var(--bg-hover);
		color: var(--text);
		border-color: var(--line-strong);
	}
	.mv:disabled {
		opacity: 0.25;
		cursor: default;
	}
	@media (max-width: 420px) {
		.pos {
			display: none;
		}
		.mv {
			width: 2.2rem;
			height: 2.2rem;
		}
	}
</style>
