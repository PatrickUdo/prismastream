// Minimal spatial navigation for the player overlay (arrow keys / TV remote).
// `pickNeighbor` is pure; `moveFocus` applies it to [data-focusable] elements in a root.

export type Dir = 'left' | 'right' | 'up' | 'down';

export interface Rect {
	left: number;
	top: number;
	width: number;
	height: number;
}

/** Index of the best candidate in direction `dir` from `from`, or -1. */
export function pickNeighbor(from: Rect, candidates: Rect[], dir: Dir): number {
	const fc = { x: from.left + from.width / 2, y: from.top + from.height / 2 };
	let best = -1;
	let bestScore = Infinity;
	candidates.forEach((r, i) => {
		const c = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
		const dx = c.x - fc.x;
		const dy = c.y - fc.y;
		let primary: number;
		let ortho: number;
		switch (dir) {
			case 'left':
				primary = from.left - (r.left + r.width);
				ortho = Math.abs(dy);
				if (dx >= -1) return;
				break;
			case 'right':
				primary = r.left - (from.left + from.width);
				ortho = Math.abs(dy);
				if (dx <= 1) return;
				break;
			case 'up':
				primary = from.top - (r.top + r.height);
				ortho = Math.abs(dx);
				if (dy >= -1) return;
				break;
			case 'down':
				primary = r.top - (from.top + from.height);
				ortho = Math.abs(dx);
				if (dy <= 1) return;
				break;
		}
		const score = Math.max(0, primary) + ortho * 2;
		if (score < bestScore) {
			bestScore = score;
			best = i;
		}
	});
	return best;
}

function visible(el: HTMLElement): boolean {
	if (el.closest('[inert]')) return false;
	const r = el.getBoundingClientRect();
	return r.width > 0 && r.height > 0;
}

/** Move focus from the active element to its neighbour inside `root`. Returns true if moved. */
export function moveFocus(root: HTMLElement, dir: Dir): boolean {
	const active = document.activeElement as HTMLElement | null;
	const all = [...root.querySelectorAll<HTMLElement>('[data-focusable]')].filter(
		(el) => el !== active && visible(el)
	);
	if (!all.length) return false;
	if (!active || !root.contains(active)) {
		all[0].focus();
		return true;
	}
	const i = pickNeighbor(
		active.getBoundingClientRect(),
		all.map((el) => el.getBoundingClientRect()),
		dir
	);
	if (i === -1) return false;
	all[i].focus();
	all[i].scrollIntoView({ block: 'nearest', inline: 'nearest' });
	return true;
}
