// DOM layer of the global spatial navigation: which elements are candidates, zones (rail,
// content, modal), rows with memory, and revealing the target. Event wiring lives in
// ./focus.svelte.ts; the geometry in ./spatial.ts.
//
// Markup contract (other modules opt in with these attributes):
//   [data-focusable]        explicit candidate (any natively focusable element also counts)
//   [data-nav-row]          horizontal row/track: left/right stays inside, up/down remembers
//   [data-nav-group]        block (e.g. the hero): entering it returns to the last focused
//                           element inside, else its [data-nav-primary]
//   [data-nav-zone="rail"]  the side navigation (left of the content)
//   [data-nav-primary]      preferred element to focus after a page navigation
//   [data-nav="self"]       container with its own arrow-key navigation (EPG, pin pad, …)
//   [data-nav-ignore]       never a candidate (e.g. the skip link)

import { nearestOnAxis, pickCandidate, RowMemory, type Dir, type Rect } from './spatial.ts';

export const FOCUSABLE =
	'[data-focusable], a[href], button, input:not([type="hidden"]), select, textarea, summary, [tabindex]';
/** Containers that run their own arrow-key navigation. Global nav only moves focus out. */
export const SELF_NAV = '.guide, .pinpad, [data-nav="self"]';
/** The video player has its own navigation and keys; the global nav stays out entirely. */
export const PLAYER = '.player';
export const OVERLAY = 'dialog[open], [aria-modal="true"]';
export const RAIL = '[data-nav-zone="rail"]';
export const ROW = '[data-nav-row]';
export const GROUP = '[data-nav-group]';
export const PRIMARY = '[data-nav-primary]';
const TEXT_FIELD = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';
const NON_TEXT_INPUT = /^(button|submit|reset|checkbox|radio|range|color|file|image)$/;

export const rowMemory = new RowMemory<Element, HTMLElement>();

// ---- Candidates ---------------------------------------------------------------------------

export function isCandidate(el: Element): el is HTMLElement {
	if (!(el instanceof HTMLElement) || !el.matches(FOCUSABLE)) return false;
	if (el.getAttribute('tabindex') === '-1' && !el.hasAttribute('data-focusable')) return false;
	if ((el as HTMLButtonElement).disabled) return false;
	if (el.closest('[inert], [aria-hidden="true"], [data-nav-ignore]')) return false;
	const r = el.getBoundingClientRect();
	if (r.width <= 0 || r.height <= 0) return false;
	if (typeof el.checkVisibility === 'function' && !el.checkVisibility({ visibilityProperty: true }))
		return false;
	return true;
}

export function candidatesIn(root: ParentNode): HTMLElement[] {
	return [...root.querySelectorAll(FOCUSABLE)].filter(isCandidate);
}

/** Topmost open modal / overlay (focus trap), or null. */
export function topOverlay(doc: Document = document): HTMLElement | null {
	const open = [...doc.querySelectorAll<HTMLElement>(OVERLAY)].filter(
		(el) => el.getClientRects().length > 0 || (el instanceof HTMLDialogElement && el.open)
	);
	return open.at(-1) ?? null;
}

export function railOf(doc: Document = document): HTMLElement | null {
	const rail = doc.querySelector<HTMLElement>(RAIL);
	return rail && rail.getBoundingClientRect().width > 0 ? rail : null;
}

/** Text-like form field (arrows move the caret / value there). */
export function isTextField(el: Element | null): boolean {
	if (!el || !el.matches(TEXT_FIELD)) return false;
	if (el instanceof HTMLInputElement) return !NON_TEXT_INPUT.test(el.type);
	return true;
}

/** Elements that the browser activates natively on Enter. */
export function activatesNatively(el: Element): boolean {
	if (el instanceof HTMLAnchorElement) return el.hasAttribute('href');
	if (el instanceof HTMLButtonElement || el instanceof HTMLSelectElement) return true;
	if (el instanceof HTMLTextAreaElement || el.tagName === 'SUMMARY') return true;
	if (el instanceof HTMLInputElement) return !/^(checkbox|radio|color|file)$/.test(el.type);
	return false;
}

// ---- First logical element ----------------------------------------------------------------

function inViewport(r: DOMRect, vh: number): boolean {
	return r.bottom > 0 && r.top < vh;
}

/**
 * What to focus when entering a scope (page, modal): `[data-autofocus]`, the primary button
 * (`[data-nav-primary]`, e.g. "Afspelen" in the hero), a visible play link, else the first
 * candidate in view.
 */
export function firstLogical(scope: ParentNode, doc: Document = document): HTMLElement | null {
	const vh = doc.defaultView?.innerHeight ?? 1080;
	for (const sel of ['[data-autofocus]', '[autofocus]', PRIMARY]) {
		const el = [...scope.querySelectorAll(sel)].find(isCandidate);
		if (el) return el;
	}
	// Media pages: a visible play link ("Afspelen" on the detail page) is the obvious start.
	const play = [...scope.querySelectorAll<HTMLAnchorElement>('a[href*="/watch/"]')].find(
		(el) => isCandidate(el) && inViewport(el.getBoundingClientRect(), vh)
	);
	if (play) return play;
	const all = candidatesIn(scope);
	return all.find((el) => inViewport(el.getBoundingClientRect(), vh)) ?? all[0] ?? null;
}

// ---- Target selection ---------------------------------------------------------------------

export interface NavState {
	/** Last focused element outside the rail (to return to from the rail). */
	lastContent: HTMLElement | null;
}

export interface Target {
	el: HTMLElement;
	/** Row the target lies in (for scrolling the track and the page). */
	row: Element | null;
	/** True when the move enters a row from outside (vertical move). */
	enteredRow: boolean;
}

const target = (el: HTMLElement, enteredRow = false): Target => ({
	el,
	row: el.closest(ROW),
	enteredRow
});

/** Where focus enters a row: the remembered item, else the visible item nearest on x. */
export function rowEntry(row: Element, from: Rect, doc: Document = document): HTMLElement | null {
	const items = candidatesIn(row);
	if (!items.length) return null;
	const remembered = rowMemory.recall(row, (el) => el.isConnected && items.includes(el));
	if (remembered) return remembered;
	const vw = doc.defaultView?.innerWidth ?? 1920;
	const railRight = railOf(doc)?.getBoundingClientRect().right ?? 0;
	const visible = items.filter((el) => {
		const r = el.getBoundingClientRect();
		return r.left >= railRight - 1 && r.right <= vw + 1;
	});
	const pool = visible.length ? visible : items;
	const i = nearestOnAxis(
		from,
		pool.map((el) => el.getBoundingClientRect()),
		'x'
	);
	return pool[Math.max(0, i)];
}

/** Rail item to focus when moving into the rail: the current page, else the nearest on y. */
function railEntry(rail: HTMLElement, from: Rect): HTMLElement | null {
	const items = candidatesIn(rail);
	const current = items.find((el) => el.getAttribute('aria-current') === 'page');
	if (current) return current;
	const i = nearestOnAxis(
		from,
		items.map((el) => el.getBoundingClientRect()),
		'y'
	);
	return items[i] ?? null;
}

function best(from: Rect, pool: HTMLElement[], dir: Dir): HTMLElement | null {
	const i = pickCandidate(
		from,
		pool.map((el) => el.getBoundingClientRect()),
		dir
	);
	return i === -1 ? null : pool[i];
}

/**
 * The element focus moves to from `active` in `dir`, or null to stay put.
 * Rules: modal trap; rail ↔ content; rows (left/right inside the row, up/down with memory);
 * self-navigating containers are only left, never entered sideways from inside.
 */
export function findTarget(
	active: Element | null,
	dir: Dir,
	state: NavState,
	doc: Document = document
): Target | null {
	const overlay = topOverlay(doc);
	const scope: HTMLElement = overlay ?? doc.body;
	const main = doc.querySelector<HTMLElement>('main') ?? doc.body;

	// Nothing (usable) focused: start at the first logical element. A focused element that is
	// no longer a candidate (e.g. a hero slide that just became inert) still serves as origin.
	const usable =
		!!active &&
		active !== doc.body &&
		active.tagName !== 'MAIN' &&
		scope.contains(active) &&
		active.getBoundingClientRect().width > 0;
	if (!active || !usable) {
		const first = firstLogical(overlay ?? main, doc) ?? firstLogical(scope, doc);
		return first ? target(first) : null;
	}

	const from = active.getBoundingClientRect();
	let pool = candidatesIn(scope).filter((el) => el !== active);

	const self = active.closest(SELF_NAV);
	if (self) pool = pool.filter((el) => !self.contains(el));

	// ---- Rail ----
	const rail = overlay ? null : railOf(doc);
	if (rail?.contains(active)) {
		if (dir === 'left') return null;
		if (dir === 'right') {
			const back = state.lastContent;
			if (back && back.isConnected && !rail.contains(back) && isCandidate(back))
				return target(back);
			const first = firstLogical(main, doc);
			return first ? target(first) : null;
		}
		const el = best(
			from,
			pool.filter((el) => rail.contains(el)),
			dir
		);
		return el ? target(el) : null;
	}
	if (rail) pool = pool.filter((el) => !rail.contains(el));
	const toRail = () => {
		const el = rail && dir === 'left' ? railEntry(rail, from) : null;
		return el ? target(el) : null;
	};

	// ---- Inside a row: left/right stays in the row ----
	const row = active.closest(ROW);
	if (row && (dir === 'left' || dir === 'right')) {
		const el = best(
			from,
			pool.filter((el) => row.contains(el)),
			dir
		);
		return el ? target(el) : toRail();
	}

	// ---- General geometric move (between rows, hero, grids, forms) ----
	const vw = doc.defaultView?.innerWidth ?? 1920;
	const railRight = rail?.getBoundingClientRect().right ?? 0;
	const section = (el: Element) => el.closest('section, [data-nav-section]');
	const activeSection = section(active);
	pool = pool.filter((el) => {
		if (row && row.contains(el)) return false;
		// Moving down into a row lands on its cards, not on its header link ("Alles bekijken");
		// that link is reached with "up" from its own row.
		if (dir === 'down' && !el.closest(ROW)) {
			const s = section(el);
			if (s && s !== activeSection && s.querySelector(ROW)) return false;
		}
		const r = el.getBoundingClientRect();
		// Items scrolled sideways out of view (other rows' off-screen cards) never decide.
		return r.right > railRight + 1 && r.left < vw - 1;
	});
	const el = best(from, pool, dir);
	if (!el) return toRail();

	const targetRow = el.closest(ROW);
	if (targetRow && targetRow !== row && (dir === 'up' || dir === 'down')) {
		const entry = rowEntry(targetRow, from, doc);
		if (entry) return target(entry, true);
	}
	const group = el.closest(GROUP);
	if (group && !group.contains(active)) {
		const entry =
			rowMemory.recall(group, (x) => x.isConnected && group.contains(x) && isCandidate(x)) ??
			[...group.querySelectorAll(PRIMARY)].find(isCandidate);
		if (entry) return target(entry);
	}
	return target(el);
}

// ---- Revealing the target -----------------------------------------------------------------

export function prefersLessMotion(doc: Document = document): boolean {
	if (doc.documentElement.hasAttribute('data-reduce-motion')) return true;
	return doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

/** Scroll so that `t.el` is comfortably visible; calm (smooth) unless motion is reduced. */
export function reveal(
	t: Target,
	dir: Dir | null,
	doc: Document = document,
	how?: ScrollBehavior
): void {
	const win = doc.defaultView;
	if (!win) return;
	const behavior: ScrollBehavior = how ?? (prefersLessMotion(doc) ? 'auto' : 'smooth');
	const { el, row } = t;

	if (row && dir !== 'up' && dir !== 'down') {
		el.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior });
		return;
	}

	if (row) {
		// Make sure the card is visible inside its track first (instant: it was remembered).
		const tr = row.getBoundingClientRect();
		const r = el.getBoundingClientRect();
		if (r.left < tr.left || r.right > tr.right)
			el.scrollIntoView({ inline: 'nearest', block: 'nearest' });
		// Then bring the whole row (header + track) to the middle of the screen.
		const section = row.closest('section, [data-nav-section]') ?? row;
		scrollBlockIntoView(section, behavior, win);
		return;
	}

	if (el.closest('.hero, [data-nav-top]')) {
		win.scrollTo({ top: 0, behavior });
		return;
	}
	el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior });
}

function scrollBlockIntoView(block: Element, behavior: ScrollBehavior, win: Window): void {
	const r = block.getBoundingClientRect();
	const vh = win.innerHeight;
	const margin = Math.min(96, vh * 0.12);
	if (r.top >= margin && r.bottom <= vh - margin) return;
	const delta = r.height > vh - 2 * margin ? r.top - margin : r.top + r.height / 2 - vh / 2;
	win.scrollBy({ top: delta, behavior });
}

/** Focus without the browser's own (abrupt) scroll; shows the focus ring. */
export function focusEl(el: HTMLElement): void {
	el.focus({ preventScroll: true, focusVisible: true } as FocusOptions);
}

// ---- Position snapshots (restore focus after "back") --------------------------------------

export interface FocusSnapshot {
	/** Index of the focused element among the candidates in <main>. */
	index: number;
	/** Per row (by index): index of the remembered item. */
	rows: [number, number][];
}

export function snapshot(doc: Document = document): FocusSnapshot | null {
	const main = doc.querySelector('main');
	if (!main) return null;
	const all = candidatesIn(main);
	const index = doc.activeElement ? all.indexOf(doc.activeElement as HTMLElement) : -1;
	const rows: [number, number][] = [];
	[...main.querySelectorAll(ROW)].forEach((row, r) => {
		const item = rowMemory.recall(row, (el) => el.isConnected);
		if (!item) return;
		const i = candidatesIn(row).indexOf(item);
		if (i >= 0) rows.push([r, i]);
	});
	return index < 0 && !rows.length ? null : { index, rows };
}

/** Re-apply a snapshot; returns the element to focus (or null when it no longer fits). */
export function restore(snap: FocusSnapshot, doc: Document = document): HTMLElement | null {
	const main = doc.querySelector('main');
	if (!main) return null;
	const rows = [...main.querySelectorAll(ROW)];
	for (const [r, i] of snap.rows) {
		const item = rows[r] ? candidatesIn(rows[r])[i] : undefined;
		if (item) rowMemory.remember(rows[r], item);
	}
	return snap.index >= 0 ? (candidatesIn(main)[snap.index] ?? null) : null;
}
