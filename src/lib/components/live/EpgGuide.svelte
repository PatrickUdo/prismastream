<!--
	EPG guide: time runs horizontally (half-hour marks, a "now" line that follows the clock),
	channels vertically with a sticky channel column. Programme blocks are proportionally wide;
	the running one is highlighted. Click or Enter opens details via `onopen`.

	Performance: one scroll container; only the visible channel rows (+ overscan) are rendered,
	and per row only the programmes inside the visible time window (quantised to whole hours, so
	scrolling does not re-render on every frame). Keyboard/remote: arrow keys move a roving focus
	(up/down = channel, left/right = programme), PageUp/PageDown jump a screen.
-->
<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { prefersReducedMotion } from 'svelte/motion';
	import type { Channel } from '#lib/types.ts';
	import { i18n, t } from '#lib/i18n/index.svelte.ts';
	import { user } from '#lib/stores/user.svelte.ts';
	import Icon from '#lib/components/Icon.svelte';
	import ChannelLogo from './ChannelLogo.svelte';
	import {
		HOUR,
		MINUTE,
		addDays,
		epgBounds,
		fillGaps,
		floorHalfHour,
		formatDay,
		formatTime,
		formatTimeRange,
		guideRange,
		halfHourTicks,
		isLiveAt,
		progressAt,
		slotIndexAt,
		startOfDay,
		visibleRows,
		type GuideSlot
	} from './epg.ts';
	import { shortEpg } from './live.svelte.ts';
	import { liveHref } from '#lib/components/links.ts';

	interface Props {
		channels: Channel[];
		now: number;
		onopen: (channel: Channel, slot: GuideSlot) => void;
	}

	let { channels, now, onopen }: Props = $props();

	const lookup = shortEpg.programmes;
	const uid = $props.id();
	const CHUNK = HOUR;
	const OVERSCAN_ROWS = 4;

	// ---- geometry --------------------------------------------------------------------------

	let scroller = $state<HTMLDivElement>();
	let viewW = $state(0);
	let viewH = $state(0);
	let scrollTop = $state(0);
	let scrollLeft = $state(0);
	let rem = $state(16);

	const narrow = $derived(viewW > 0 && viewW < 640);
	const chanW = $derived(narrow ? 64 : Math.round(rem * 13));
	const rowH = $derived(Math.round(rem * (narrow ? 4 : 4.5)));
	const headH = $derived(Math.round(rem * 2.75));
	const timelineViewW = $derived(Math.max(0, viewW - chanW));
	/** Pixels per minute: about 1.5 h visible on phones, 2.5 h on tablets, 3.5 h on desktop. */
	const ppm = $derived(
		Math.max(narrow ? 3 : 4, timelineViewW / (viewW < 640 ? 100 : viewW < 1100 ? 150 : 210))
	);

	// Range: the available EPG (at least 2 h back and 6 h ahead). Stable while scrolling; when it
	// moves (new data, clock passes a half hour) the scroll position is compensated below.
	const bounds = $derived(epgBounds(channels.map((c) => lookup(c))));
	const range = $derived(guideRange(bounds, floorHalfHour(now)));
	const totalW = $derived(chanW + ((range.to - range.from) / MINUTE) * ppm);
	const bodyH = $derived(channels.length * rowH);

	const x = (time: number) => ((time - range.from) / MINUTE) * ppm;
	const timeAtX = (px: number) => range.from + (px / ppm) * MINUTE;

	// Visible time window, quantised to whole chunks with one chunk of overscan on each side.
	const viewFrom = $derived(timeAtX(scrollLeft));
	const viewTo = $derived(timeAtX(scrollLeft + timelineViewW));
	const winFrom = $derived(
		Math.max(range.from, range.from + (Math.floor((viewFrom - range.from) / CHUNK) - 1) * CHUNK)
	);
	const winTo = $derived(
		Math.min(range.to, range.from + (Math.ceil((viewTo - range.from) / CHUNK) + 1) * CHUNK)
	);

	const rowsWin = $derived(
		visibleRows(scrollTop, Math.max(0, viewH - headH), rowH, channels.length, OVERSCAN_ROWS)
	);
	const rows = $derived(
		channels.slice(rowsWin.start, rowsWin.end).map((channel, i) => ({
			channel,
			index: rowsWin.start + i
		}))
	);
	const ticks = $derived(halfHourTicks(winFrom, winTo));
	const nowX = $derived(x(now));
	const nowVisible = $derived(now >= range.from && now <= range.to);
	/** The now line hides once it would slide under the sticky channel column. */
	const nowLineVisible = $derived(nowVisible && nowX >= scrollLeft);
	const centerTime = $derived(timeAtX(scrollLeft + timelineViewW / 2));
	const dayLabel = $derived(formatDay(centerTime, now, i18n.locale));
	const canPrevDay = $derived(startOfDay(centerTime) > range.from);
	const canNextDay = $derived(addDays(startOfDay(centerTime), 1) < range.to);

	// Ask for short EPG of visible channels without a guide (Xtream only; no-op otherwise).
	$effect(() => {
		for (const r of rows) shortEpg.request(r.channel, winFrom, winTo);
	});

	// ---- scrolling -------------------------------------------------------------------------

	let frame = 0;
	function onScroll() {
		if (frame) return;
		frame = requestAnimationFrame(() => {
			frame = 0;
			if (!scroller) return;
			scrollTop = scroller.scrollTop;
			scrollLeft = scroller.scrollLeft;
		});
	}

	function behavior(): ScrollBehavior {
		return prefersReducedMotion.current || user.settings.reduceMotion ? 'auto' : 'smooth';
	}

	function scrollToTime(time: number, align: 'start' | 'center' = 'start', smooth = true) {
		if (!scroller) return;
		const offset = align === 'center' ? timelineViewW / 2 : timelineViewW * 0.15;
		const left = Math.max(0, Math.min(totalW - viewW, x(time) - offset));
		scroller.scrollTo({ left, behavior: smooth ? behavior() : 'auto' });
	}

	function goNow(smooth = true) {
		scrollToTime(now, 'start', smooth);
	}

	function goDay(dir: 1 | -1) {
		const target = addDays(centerTime, dir);
		scrollToTime(Math.min(range.to, Math.max(range.from, target)), 'center');
	}

	$effect(() => {
		if (!scroller) return;
		const el = scroller;
		const measure = () => {
			viewW = el.clientWidth;
			viewH = el.clientHeight;
			rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
		};
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		return () => {
			ro.disconnect();
			cancelAnimationFrame(frame);
		};
	});

	// Initial position: just before now. Afterwards keep the same time at the left edge when the
	// range or the scale changes (resize, new EPG, clock).
	let placed = false;
	let geom = { from: 0, ppm: 0 };
	$effect(() => {
		const from = range.from;
		const scale = ppm;
		const width = viewW;
		untrack(() => {
			if (!scroller || !width) return;
			if (!placed) {
				placed = true;
				geom = { from, ppm: scale };
				void tick().then(() => goNow(false));
				return;
			}
			if (geom.from !== from || geom.ppm !== scale) {
				const leftTime = geom.from + (scroller.scrollLeft / geom.ppm) * MINUTE;
				geom = { from, ppm: scale };
				void tick().then(() => {
					if (scroller) scroller.scrollLeft = ((leftTime - from) / MINUTE) * scale;
				});
			}
		});
	});

	// Channel list changed (filter): back to the top. Compared by ids, so a re-filter that yields
	// the same channels (e.g. on a clock tick) keeps the position.
	const signature = $derived(channels.map((c) => c.id).join('\n'));
	$effect(() => {
		void signature;
		untrack(() => {
			if (scroller) scroller.scrollTop = 0;
			active = { row: 0, key: 'channel', time: now };
		});
	});

	// ---- keyboard / remote -----------------------------------------------------------------

	interface ActiveCell {
		row: number;
		/** Slot key, or 'channel' for the channel cell. */
		key: string;
		/** Anchor time used when moving up/down. */
		time: number;
	}

	let active = $state<ActiveCell>({ row: 0, key: 'channel', time: Date.now() });

	const activeRendered = $derived(
		active.row >= rowsWin.start &&
			active.row < rowsWin.end &&
			(active.key === 'channel' || (active.time >= winFrom && active.time < winTo))
	);

	function rowSlots(row: number): GuideSlot[] {
		const ch = channels[row];
		return ch ? fillGaps(lookup(ch), range.from, range.to) : [];
	}

	async function focusCell(cell: ActiveCell, slot?: GuideSlot) {
		if (!scroller) return;
		active = cell;
		// Vertical: keep the row fully visible below the sticky header.
		const top = cell.row * rowH;
		const bodyView = viewH - headH;
		let st = scroller.scrollTop;
		if (top < st) st = top;
		else if (top + rowH > st + bodyView) st = top + rowH - bodyView;
		// Horizontal: bring the start of the programme into view.
		let sl = scroller.scrollLeft;
		if (slot) {
			const x1 = x(Math.max(slot.start, range.from));
			const x2 = x(Math.min(slot.stop, range.to));
			// Only when the block is (nearly) out of view, so moving up/down keeps the time position.
			if (x2 < sl + 48 || x1 > sl + timelineViewW - 48) sl = Math.max(0, x1 - 16);
		}
		if (st !== scroller.scrollTop || sl !== scroller.scrollLeft) {
			scroller.scrollTo({ top: st, left: sl, behavior: 'auto' });
			scrollTop = scroller.scrollTop;
			scrollLeft = scroller.scrollLeft;
		}
		await tick();
		scroller
			.querySelector<HTMLElement>(`[data-row="${cell.row}"][data-key="${cell.key}"]`)
			?.focus({ preventScroll: true });
	}

	function moveTo(row: number, wantChannel: boolean, time: number) {
		row = Math.max(0, Math.min(channels.length - 1, row));
		if (wantChannel) return focusCell({ row, key: 'channel', time });
		const slots = rowSlots(row);
		const i = slotIndexAt(slots, time);
		if (i < 0) return focusCell({ row, key: 'channel', time });
		return focusCell({ row, key: slots[i].key, time }, slots[i]);
	}

	function onKeydown(e: KeyboardEvent) {
		if (!channels.length || e.altKey || e.ctrlKey || e.metaKey) return;
		const onChannel = active.key === 'channel';
		const pageRows = Math.max(1, Math.floor((viewH - headH) / rowH) - 1);
		switch (e.key) {
			case 'ArrowDown':
			case 'ArrowUp': {
				const d = e.key === 'ArrowDown' ? 1 : -1;
				if (active.row + d < 0 || active.row + d >= channels.length) return;
				e.preventDefault();
				void moveTo(active.row + d, onChannel, active.time);
				break;
			}
			case 'PageDown':
			case 'PageUp': {
				e.preventDefault();
				void moveTo(
					active.row + (e.key === 'PageDown' ? pageRows : -pageRows),
					onChannel,
					active.time
				);
				break;
			}
			case 'ArrowRight': {
				e.preventDefault();
				const slots = rowSlots(active.row);
				if (onChannel) {
					const i = slotIndexAt(slots, Math.max(viewFrom, Math.min(now, viewTo)));
					if (i >= 0)
						void focusCell(
							{ row: active.row, key: slots[i].key, time: Math.max(slots[i].start, viewFrom) },
							slots[i]
						);
					return;
				}
				const i = slots.findIndex((s) => s.key === active.key);
				const next = slots[i + 1];
				if (next) void focusCell({ row: active.row, key: next.key, time: next.start }, next);
				break;
			}
			case 'ArrowLeft': {
				if (onChannel) return;
				e.preventDefault();
				const slots = rowSlots(active.row);
				const i = slots.findIndex((s) => s.key === active.key);
				const prev = i > 0 ? slots[i - 1] : undefined;
				if (prev)
					void focusCell(
						{ row: active.row, key: prev.key, time: Math.max(prev.start, range.from) },
						prev
					);
				else void focusCell({ row: active.row, key: 'channel', time: active.time });
				break;
			}
		}
	}

	function onFocusIn(e: FocusEvent) {
		// Keyboard/remote users: bring the whole guide into the window.
		if (scroller && !scroller.contains(e.relatedTarget as Node | null)) {
			const r = scroller.getBoundingClientRect();
			if (r.top < 0 || r.bottom > window.innerHeight)
				scroller.scrollIntoView({ block: 'nearest', behavior: behavior() });
		}
		const el = (e.target as HTMLElement).closest<HTMLElement>('[data-row][data-key]');
		if (!el) return;
		const row = Number(el.dataset.row);
		const key = el.dataset.key!;
		if (row === active.row && key === active.key) return;
		const start = Number(el.dataset.start);
		active = {
			row,
			key,
			time:
				key === 'channel' ? active.time : Math.max(Number.isFinite(start) ? start : now, viewFrom)
		};
	}

	function slotLabel(channel: Channel, slot: GuideSlot): string {
		const title = slot.programme?.title ?? t('live.noInfo');
		const time = formatTimeRange(slot.start, slot.stop, i18n.locale);
		const state = isLiveAt(slot, now) ? `, ${t('live.onNow')}` : '';
		return `${channel.name}: ${title}, ${time}${state}`;
	}

	function block(slot: GuideSlot) {
		const x1 = x(Math.max(slot.start, range.from));
		const x2 = x(Math.min(slot.stop, range.to));
		return { left: chanW + x1, width: Math.max(0, x2 - x1) };
	}
</script>

<div class="guide-wrap">
	<div class="toolbar">
		<div class="day" aria-live="polite">
			<Icon name="clock" size="1.05rem" />
			<span>{dayLabel}</span>
		</div>
		<div class="nav">
			<button
				type="button"
				class="tbtn"
				disabled={!canPrevDay}
				onclick={() => goDay(-1)}
				aria-label={t('live.prevDay')}
				data-focusable
			>
				<Icon name="chevron-left" size="1.1rem" />
			</button>
			<button type="button" class="tbtn now-btn" onclick={() => goNow()} data-focusable>
				{t('live.jumpNow')}
			</button>
			<button
				type="button"
				class="tbtn"
				disabled={!canNextDay}
				onclick={() => goDay(1)}
				aria-label={t('live.nextDay')}
				data-focusable
			>
				<Icon name="chevron-right" size="1.1rem" />
			</button>
		</div>
	</div>

	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		class="guide"
		bind:this={scroller}
		onscroll={onScroll}
		onkeydown={onKeydown}
		onfocusin={onFocusIn}
		role="region"
		aria-label={t('live.guideLabel')}
		aria-describedby="{uid}-help"
		style:--chan-w="{chanW}px"
		style:--row-h="{rowH}px"
		style:--head-h="{headH}px"
	>
		<p id="{uid}-help" class="sr-only">{t('live.guideHelp')}</p>
		<div class="canvas" style:width="{totalW}px" style:height="{headH + bodyH}px">
			<div class="head" style:width="{totalW}px">
				<div class="corner"><span>{dayLabel}</span></div>
				{#each ticks as tk (tk)}
					<span
						class="tick"
						class:hour={new Date(tk).getMinutes() === 0}
						style:left="{chanW + x(tk)}px"
					>
						{formatTime(tk, i18n.locale)}
					</span>
				{/each}
				{#if nowVisible}
					<span class="now-badge" style:left="{chanW + nowX}px">{formatTime(now, i18n.locale)}</span
					>
				{/if}
			</div>

			<div class="body" style:height="{bodyH}px">
				{#each ticks as tk (tk)}
					<span class="grid-line" style:left="{chanW + x(tk)}px" aria-hidden="true"></span>
				{/each}

				{#each rows as { channel, index } (channel.id)}
					{@const slots = fillGaps(lookup(channel), winFrom, winTo)}
					{@const fav = user.isFavoriteChannel(channel.id)}
					<div class="row" style:transform="translateY({index * rowH}px)" style:width="{totalW}px">
						<a
							class="chan"
							href={liveHref(channel.id)}
							data-row={index}
							data-key="channel"
							data-focusable
							tabindex={(active.row === index && active.key === 'channel') ||
							(!activeRendered && index === rowsWin.start)
								? 0
								: -1}
							aria-label={t('live.watchChannelNamed', { name: channel.name })}
						>
							<ChannelLogo {channel} width={narrow ? '2.75rem' : '3.5rem'} />
							{#if !narrow}
								<span class="chan-text">
									<span class="chan-name">{channel.name}</span>
									{#if channel.number != null}
										<span class="chan-num">{channel.number}</span>
									{/if}
								</span>
							{:else if channel.number != null}
								<span class="chan-num narrow-num">{channel.number}</span>
							{/if}
							{#if fav}
								<span class="fav" aria-hidden="true"><Icon name="star" size="0.7rem" /></span>
							{/if}
						</a>
						{#each slots as slot (slot.key)}
							{@const geo = block(slot)}
							{@const p = slot.programme}
							{@const live = isLiveAt(slot, now)}
							<button
								type="button"
								class="prog"
								class:live
								class:past={slot.stop <= now}
								class:gap={!p}
								style:left="{geo.left}px"
								style:width="{geo.width}px"
								data-row={index}
								data-key={slot.key}
								data-start={slot.start}
								data-focusable
								tabindex={active.row === index && active.key === slot.key ? 0 : -1}
								aria-label={slotLabel(channel, slot)}
								onclick={() => onopen(channel, slot)}
							>
								<span class="inner">
									<span class="ptitle">{p?.title ?? t('live.noInfo')}</span>
									{#if p}
										<span class="ptime">{formatTimeRange(slot.start, slot.stop, i18n.locale)}</span>
									{/if}
								</span>
								{#if live && p}
									<span class="pbar" style:width="{progressAt(slot, now) * 100}%" aria-hidden="true"
									></span>
								{/if}
							</button>
						{/each}
					</div>
				{/each}

				{#if nowLineVisible}
					<span class="now-line" style:left="{chanW + nowX}px" aria-hidden="true"></span>
				{/if}
			</div>
		</div>
	</div>
</div>

<style>
	.guide-wrap {
		display: grid;
		gap: 0.75rem;
	}
	.toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}
	.day {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		font-weight: 750;
		font-size: var(--text-l);
		color: var(--text);
	}
	.day :global(svg) {
		color: var(--text-3);
	}
	.nav {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
	}
	.tbtn {
		display: inline-grid;
		place-items: center;
		min-width: 2.5rem;
		height: 2.5rem;
		padding: 0 0.6rem;
		border-radius: var(--radius-pill);
		border: 1px solid var(--line);
		background: rgb(255 255 255 / 0.04);
		color: var(--text-2);
		font-size: var(--text-s);
		font-weight: 700;
		transition:
			background-color var(--dur) var(--ease-out),
			color var(--dur) var(--ease-out),
			border-color var(--dur) var(--ease-out);
	}
	.tbtn:hover:not(:disabled) {
		background: var(--bg-hover);
		border-color: var(--line-strong);
		color: var(--text);
	}
	.tbtn:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}
	.now-btn {
		padding: 0 1rem;
		color: var(--text);
	}

	.guide {
		position: relative;
		/* Fills the viewport, but shrinks to fit a short (filtered) channel list. */
		max-height: clamp(
			22rem,
			calc(100dvh - var(--safe-top) - var(--topbar-h) - var(--shell-bottom) - 3rem),
			70rem
		);
		overflow: auto;
		overscroll-behavior-x: contain;
		border-radius: var(--radius-l);
		border: 1px solid var(--line);
		background: var(--bg-elev-1);
		scrollbar-width: thin;
		contain: layout paint;
		scroll-margin-top: calc(var(--safe-top) + 1rem);
		scroll-margin-bottom: calc(var(--shell-bottom) + 1rem);
	}
	@media (max-width: 799.98px) {
		.guide {
			scroll-margin-top: calc(var(--safe-top) + var(--topbar-h) + 0.5rem);
		}
	}
	.canvas {
		position: relative;
	}

	/* ---- header ---- */
	.head {
		position: sticky;
		top: 0;
		z-index: 4;
		height: var(--head-h);
		background: var(--bg-glass-strong);
		backdrop-filter: var(--glass-blur);
		-webkit-backdrop-filter: var(--glass-blur);
		border-bottom: 1px solid var(--line);
	}
	.corner {
		position: sticky;
		left: 0;
		z-index: 2;
		display: flex;
		align-items: center;
		width: var(--chan-w);
		height: 100%;
		padding-inline: 0.75rem;
		background: var(--bg-elev-2);
		border-right: 1px solid var(--line);
		font-size: var(--text-xs);
		font-weight: 750;
		color: var(--text-3);
		text-transform: uppercase;
		letter-spacing: 0.08em;
		white-space: nowrap;
		overflow: hidden;
	}
	.tick {
		position: absolute;
		top: 0;
		height: 100%;
		display: flex;
		align-items: flex-start;
		padding: 0.4rem 0 0 0.5rem;
		border-left: 1px solid var(--line);
		font-size: var(--text-xs);
		font-weight: 650;
		color: var(--text-3);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.tick.hour {
		color: var(--text-2);
		border-left-color: var(--line-strong);
	}
	.now-badge {
		position: absolute;
		bottom: 0.25rem;
		z-index: 1;
		padding: 0.1rem 0.4rem;
		border-radius: var(--radius-xs);
		background: var(--live);
		color: var(--text-on-media);
		font-size: 0.6875rem;
		font-weight: 800;
		font-variant-numeric: tabular-nums;
		transform: translateX(-50%);
		box-shadow: 0 0 12px color-mix(in oklab, var(--live) 60%, transparent);
	}

	/* ---- body ---- */
	.body {
		position: relative;
	}
	.grid-line {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 1px;
		background: var(--line);
		opacity: 0.5;
		pointer-events: none;
	}
	.row {
		position: absolute;
		top: 0;
		left: 0;
		height: var(--row-h);
		border-bottom: 1px solid var(--line);
		will-change: transform;
	}
	.chan {
		position: sticky;
		left: 0;
		z-index: 2;
		display: flex;
		align-items: center;
		gap: 0.7rem;
		width: var(--chan-w);
		height: 100%;
		padding: 0 0.75rem;
		background: var(--bg-elev-2);
		border-right: 1px solid var(--line);
		transition: background-color var(--dur) var(--ease-out);
	}
	.chan:hover {
		background: var(--bg-elev-3);
	}
	.chan:focus-visible {
		box-shadow: inset 0 0 0 2px var(--accent);
		background: var(--bg-elev-3);
	}
	.chan-text {
		display: grid;
		min-width: 0;
	}
	.chan-name {
		font-size: var(--text-s);
		font-weight: 700;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.chan-num {
		font-size: var(--text-xs);
		color: var(--text-3);
		font-variant-numeric: tabular-nums;
	}
	.narrow-num {
		position: absolute;
		left: 0.3rem;
		bottom: 0.2rem;
		font-size: 0.625rem;
		font-weight: 700;
	}
	.fav {
		position: absolute;
		top: 0.35rem;
		right: 0.35rem;
		color: var(--rating);
	}

	.prog {
		position: absolute;
		top: 0.3rem;
		bottom: 0.3rem;
		z-index: 0;
		display: flex;
		align-items: center;
		padding: 0;
		margin: 0;
		margin-left: 2px;
		border: 1px solid var(--line);
		border-radius: var(--radius-s);
		background: var(--bg-elev-2);
		color: var(--text);
		text-align: left;
		overflow: clip;
		transition:
			background-color var(--dur-fast) var(--ease-out),
			border-color var(--dur-fast) var(--ease-out);
	}
	.prog:hover {
		background: var(--bg-elev-3);
		border-color: var(--line-strong);
	}
	.prog:focus-visible {
		z-index: 1;
		box-shadow: var(--focus-ring);
		background: var(--bg-elev-3);
	}
	.prog.live {
		background: linear-gradient(90deg, var(--accent-soft), var(--accent-faint));
		border-color: color-mix(in oklab, var(--accent) 50%, transparent);
	}
	.prog.live:hover,
	.prog.live:focus-visible {
		background: linear-gradient(
			90deg,
			color-mix(in oklab, var(--accent) 32%, transparent),
			var(--accent-faint)
		);
	}
	.prog.past {
		background: transparent;
		color: var(--text-3);
	}
	.prog.gap {
		background: repeating-linear-gradient(
			135deg,
			rgb(255 255 255 / 0.025) 0 8px,
			transparent 8px 16px
		);
		border-style: dashed;
		color: var(--text-3);
	}
	.inner {
		position: sticky;
		left: calc(var(--chan-w) + 0.5rem);
		display: grid;
		gap: 0.1rem;
		min-width: 0;
		max-width: 100%;
		padding: 0 0.65rem;
	}
	.ptitle {
		font-size: var(--text-s);
		font-weight: 700;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.gap .ptitle {
		font-weight: 550;
	}
	.ptime {
		font-size: var(--text-xs);
		color: var(--text-3);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.live .ptime {
		color: var(--text-2);
	}
	.pbar {
		position: absolute;
		left: 0;
		bottom: 0;
		height: 3px;
		background: var(--accent);
		box-shadow: 0 0 10px var(--accent-glow);
	}
	.now-line {
		position: absolute;
		top: 0;
		bottom: 0;
		z-index: 1;
		width: 2px;
		margin-left: -1px;
		background: var(--live);
		box-shadow: 0 0 10px color-mix(in oklab, var(--live) 60%, transparent);
		pointer-events: none;
		transition: left var(--dur-slow) var(--ease-out);
	}

	@media (max-width: 639.98px) {
		.chan {
			justify-content: center;
			padding: 0;
		}
		.corner {
			padding-inline: 0.4rem;
			font-size: 0.625rem;
			letter-spacing: 0.02em;
		}
		.prog {
			top: 0.25rem;
			bottom: 0.25rem;
		}
	}
</style>
