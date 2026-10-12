// Pure spatial-navigation helpers for the global D-pad / keyboard navigation (smart TV,
// Android TV, Fire TV, webOS, Tizen and desktop keyboards). No DOM access in this file:
// the DOM layer lives in ./navigator.ts, the event wiring in ./focus.svelte.ts.

export type Dir = 'left' | 'right' | 'up' | 'down';

export interface Rect {
	left: number;
	top: number;
	width: number;
	height: number;
}

/** Weight of the deviation on the perpendicular axis (edge gap) in the score. */
const ORTHO_GAP_WEIGHT = 20;
/** Weight of the centre offset on the perpendicular axis (tie-breaker within a band). */
const ORTHO_CENTER_WEIGHT = 0.6;
/** Rects may overlap this much (px) on the main axis and still count as "in that direction". */
const OVERLAP_TOLERANCE = 2;

const right = (r: Rect) => r.left + r.width;
const bottom = (r: Rect) => r.top + r.height;
const cx = (r: Rect) => r.left + r.width / 2;
const cy = (r: Rect) => r.top + r.height / 2;

/** Gap between two 1-D ranges (0 when they overlap). */
function rangeGap(a0: number, a1: number, b0: number, b1: number): number {
	return Math.max(0, Math.max(a0, b0) - Math.min(a1, b1));
}

/**
 * Score of `to` as a target when moving from `from` in `dir`; `Infinity` when it does not
 * lie in that direction. Lower is better: the distance along the main axis (edge to edge)
 * plus a penalty for deviation on the perpendicular axis (edge gap, then centre offset).
 */
export function score(from: Rect, to: Rect, dir: Dir): number {
	let primary: number;
	let gap: number;
	let offset: number;
	switch (dir) {
		case 'right':
			if (cx(to) <= cx(from) + 1 || right(to) <= right(from) + OVERLAP_TOLERANCE) return Infinity;
			primary = to.left - right(from);
			gap = rangeGap(from.top, bottom(from), to.top, bottom(to));
			offset = Math.abs(cy(to) - cy(from));
			break;
		case 'left':
			if (cx(to) >= cx(from) - 1 || to.left >= from.left - OVERLAP_TOLERANCE) return Infinity;
			primary = from.left - right(to);
			gap = rangeGap(from.top, bottom(from), to.top, bottom(to));
			offset = Math.abs(cy(to) - cy(from));
			break;
		case 'down':
			if (cy(to) <= cy(from) + 1 || bottom(to) <= bottom(from) + OVERLAP_TOLERANCE) return Infinity;
			primary = to.top - bottom(from);
			gap = rangeGap(from.left, right(from), to.left, right(to));
			offset = Math.abs(cx(to) - cx(from));
			break;
		case 'up':
			if (cy(to) >= cy(from) - 1 || to.top >= from.top - OVERLAP_TOLERANCE) return Infinity;
			primary = from.top - bottom(to);
			gap = rangeGap(from.left, right(from), to.left, right(to));
			offset = Math.abs(cx(to) - cx(from));
			break;
	}
	return Math.max(0, primary) + gap * ORTHO_GAP_WEIGHT + offset * ORTHO_CENTER_WEIGHT;
}

/** Index of the best candidate in direction `dir` from `from`, or -1 when there is none. */
export function pickCandidate(from: Rect, candidates: readonly Rect[], dir: Dir): number {
	let best = -1;
	let bestScore = Infinity;
	for (let i = 0; i < candidates.length; i++) {
		const s = score(from, candidates[i], dir);
		if (s < bestScore) {
			bestScore = s;
			best = i;
		}
	}
	return best;
}

/** Index of the rect whose centre is closest to `from`'s centre on one axis, or -1. */
export function nearestOnAxis(from: Rect, candidates: readonly Rect[], axis: 'x' | 'y'): number {
	const c = axis === 'x' ? cx(from) : cy(from);
	let best = -1;
	let bestDist = Infinity;
	candidates.forEach((r, i) => {
		const d = Math.abs((axis === 'x' ? cx(r) : cy(r)) - c);
		if (d < bestDist) {
			bestDist = d;
			best = i;
		}
	});
	return best;
}

// ---- Keys ---------------------------------------------------------------------------------

/** Legacy keyCodes still sent by some smart-TV browsers (key === 'Unidentified'). */
const KEYCODE_DIR: Record<number, Dir> = { 37: 'left', 38: 'up', 39: 'right', 40: 'down' };
const KEY_DIR: Record<string, Dir> = {
	ArrowLeft: 'left',
	ArrowUp: 'up',
	ArrowRight: 'right',
	ArrowDown: 'down',
	// Old Edge / some TV browsers.
	Left: 'left',
	Up: 'up',
	Right: 'right',
	Down: 'down'
};

export interface KeyLike {
	key: string;
	keyCode?: number;
}

/** Direction for an arrow / D-pad key, or null. */
export function keyToDir(e: KeyLike): Dir | null {
	return KEY_DIR[e.key] ?? (e.keyCode ? (KEYCODE_DIR[e.keyCode] ?? null) : null);
}

/** OK / Enter / Select on keyboards and remotes. */
export function isSelectKey(e: KeyLike): boolean {
	return e.key === 'Enter' || e.key === 'Select' || e.key === 'Accept' || e.keyCode === 13;
}

export type BackKind = 'escape' | 'backspace' | 'remote';

/**
 * Back keys: Escape, Backspace, GoBack/BrowserBack, webOS (461) and Tizen (10009) back.
 * 'remote' keys have no other meaning and can be handled immediately.
 */
export function backKind(e: KeyLike): BackKind | null {
	if (e.key === 'Escape' || e.key === 'Esc') return 'escape';
	if (e.key === 'Backspace') return 'backspace';
	if (
		e.key === 'GoBack' ||
		e.key === 'BrowserBack' ||
		e.key === 'XF86Back' ||
		e.keyCode === 461 ||
		e.keyCode === 10009
	)
		return 'remote';
	return null;
}

// ---- Row memory -----------------------------------------------------------------------------

/**
 * Remembers the last focused item per row (like Netflix): moving up/down into a row returns
 * to where you were. Keys are row objects (DOM elements in practice) and are held weakly.
 */
export class RowMemory<R extends object, I> {
	#map = new WeakMap<R, I>();

	remember(row: R, item: I): void {
		this.#map.set(row, item);
	}

	/** The remembered item, if it still passes `valid` (e.g. still in the DOM and visible). */
	recall(row: R, valid: (item: I) => boolean = () => true): I | undefined {
		const item = this.#map.get(row);
		if (item === undefined) return undefined;
		if (!valid(item)) {
			this.#map.delete(row);
			return undefined;
		}
		return item;
	}

	forget(row: R): void {
		this.#map.delete(row);
	}
}
