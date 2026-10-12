import { describe, expect, it } from 'vitest';
import {
	backKind,
	isSelectKey,
	keyToDir,
	nearestOnAxis,
	pickCandidate,
	RowMemory,
	score,
	type Rect
} from './spatial.ts';

const r = (left: number, top: number, width = 100, height = 50): Rect => ({
	left,
	top,
	width,
	height
});

describe('pickCandidate', () => {
	// A 3×3 grid of 100×50 boxes with 20 px gaps.
	const grid = [0, 1, 2].flatMap((row) => [0, 1, 2].map((col) => r(col * 120, row * 70)));
	const center = grid[4];
	const others = grid.filter((g) => g !== center);
	const at = (i: number) => grid.indexOf(others[i]);

	it('picks the direct neighbour in each direction', () => {
		expect(at(pickCandidate(center, others, 'right'))).toBe(5);
		expect(at(pickCandidate(center, others, 'left'))).toBe(3);
		expect(at(pickCandidate(center, others, 'up'))).toBe(1);
		expect(at(pickCandidate(center, others, 'down'))).toBe(7);
	});

	it('returns -1 when nothing lies in that direction', () => {
		expect(pickCandidate(grid[0], grid.slice(1), 'left')).toBe(-1);
		expect(pickCandidate(grid[0], grid.slice(1), 'up')).toBe(-1);
	});

	it('prefers aligned targets over closer but diagonal ones', () => {
		const from = r(0, 0);
		const diagonal = r(110, 60); // close, but one row lower
		const aligned = r(300, 0); // far, same row
		expect(pickCandidate(from, [diagonal, aligned], 'right')).toBe(1);
	});

	it('goes down to the item in the next row whose centre is nearest on x', () => {
		const from = r(240, 0);
		const nextRow = [0, 120, 240, 360].map((x) => r(x, 200));
		expect(pickCandidate(from, nextRow, 'down')).toBe(2);
	});

	it('ignores overlapping elements on the main axis', () => {
		const from = r(0, 0, 200, 50);
		const inside = r(50, 10, 50, 20); // centre to the right, but inside `from`
		expect(score(from, inside, 'right')).toBe(Infinity);
	});

	it('moving up from a wide row reaches the hero button above the left edge', () => {
		const card = r(100, 600, 150, 220);
		const play = r(100, 400, 180, 52);
		const dots = r(1500, 410, 30, 28);
		expect(pickCandidate(card, [dots, play], 'up')).toBe(1);
	});
});

describe('nearestOnAxis', () => {
	it('finds the rect with the closest centre on x', () => {
		expect(nearestOnAxis(r(250, 0), [r(0, 100), r(240, 100), r(480, 100)], 'x')).toBe(1);
	});
	it('returns -1 for no candidates', () => {
		expect(nearestOnAxis(r(0, 0), [], 'y')).toBe(-1);
	});
});

describe('keys', () => {
	it('maps arrows, legacy names and keyCodes to directions', () => {
		expect(keyToDir({ key: 'ArrowLeft' })).toBe('left');
		expect(keyToDir({ key: 'Down' })).toBe('down');
		expect(keyToDir({ key: 'Unidentified', keyCode: 39 })).toBe('right');
		expect(keyToDir({ key: 'a', keyCode: 65 })).toBeNull();
	});
	it('recognises OK keys', () => {
		expect(isSelectKey({ key: 'Enter' })).toBe(true);
		expect(isSelectKey({ key: 'Unidentified', keyCode: 13 })).toBe(true);
		expect(isSelectKey({ key: ' ' })).toBe(false);
	});
	it('classifies back keys', () => {
		expect(backKind({ key: 'Escape' })).toBe('escape');
		expect(backKind({ key: 'Backspace' })).toBe('backspace');
		expect(backKind({ key: 'GoBack' })).toBe('remote');
		expect(backKind({ key: 'BrowserBack' })).toBe('remote');
		expect(backKind({ key: 'Unidentified', keyCode: 461 })).toBe('remote'); // webOS
		expect(backKind({ key: 'XF86Back', keyCode: 10009 })).toBe('remote'); // Tizen
		expect(backKind({ key: 'ArrowLeft' })).toBeNull();
	});
});

describe('RowMemory', () => {
	it('remembers the last item per row', () => {
		const mem = new RowMemory<object, string>();
		const a = {};
		const b = {};
		mem.remember(a, 'a3');
		mem.remember(b, 'b1');
		mem.remember(a, 'a5');
		expect(mem.recall(a)).toBe('a5');
		expect(mem.recall(b)).toBe('b1');
		expect(mem.recall({})).toBeUndefined();
	});

	it('drops items that are no longer valid', () => {
		const mem = new RowMemory<object, string>();
		const row = {};
		mem.remember(row, 'gone');
		expect(mem.recall(row, () => false)).toBeUndefined();
		expect(mem.recall(row)).toBeUndefined();
	});

	it('forgets a row', () => {
		const mem = new RowMemory<object, number>();
		const row = {};
		mem.remember(row, 1);
		mem.forget(row);
		expect(mem.recall(row)).toBeUndefined();
	});
});
