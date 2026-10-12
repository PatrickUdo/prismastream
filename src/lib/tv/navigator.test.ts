// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { candidatesIn, findTarget, firstLogical, rowMemory, type NavState } from './navigator.ts';

// jsdom has no layout: every element reports the rect from its data-rect="left,top,w,h".
const original = Element.prototype.getBoundingClientRect;
beforeEach(() => {
	Element.prototype.getBoundingClientRect = function (this: Element) {
		const [x, y, w, h] = (this.getAttribute('data-rect') ?? '0,0,0,0').split(',').map(Number);
		return {
			x,
			y,
			left: x,
			top: y,
			width: w,
			height: h,
			right: x + w,
			bottom: y + h,
			toJSON: () => ({})
		} as DOMRect;
	};
	Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true });
	Object.defineProperty(window, 'innerHeight', { value: 768, configurable: true });
	document.body.innerHTML = PAGE;
});
afterEach(() => {
	Element.prototype.getBoundingClientRect = original;
	document.body.innerHTML = '';
});

const cards = (row: number, top: number) =>
	Array.from(
		{ length: 7 },
		(_, i) =>
			`<li><a href="/t/${row}-${i}" id="r${row}c${i}" data-focusable data-rect="${120 + i * 160},${top},150,180"></a></li>`
	).join('');

const PAGE = `
<a class="skip" href="#main" data-nav-ignore data-rect="400,-60,120,40">skip</a>
<nav data-nav-zone="rail" data-rect="0,0,80,768">
	<a id="nav-home" href="/" aria-current="page" data-focusable data-rect="10,200,60,50"></a>
	<a id="nav-movies" href="/movies" data-focusable data-rect="10,260,60,50"></a>
	<a id="nav-settings" href="/settings" data-focusable data-rect="10,680,60,50"></a>
</nav>
<main tabindex="-1" data-rect="0,0,1024,2000">
	<section class="hero" data-nav-group data-rect="0,0,1024,420">
		<a id="play" href="/watch/1" data-focusable data-nav-primary data-rect="120,330,150,50"></a>
		<a id="info" href="/title/1" data-focusable data-rect="290,330,150,50"></a>
		<div inert><a id="inert" href="/x" data-rect="120,330,150,50"></a></div>
	</section>
	<section class="row"><ul id="row1" data-nav-row data-rect="80,440,944,200">${cards(1, 450)}</ul>
		<button id="arrow" tabindex="-1" data-rect="980,450,40,180"></button>
	</section>
	<section class="row"><a id="all2" href="/all" data-rect="900,655,100,20"></a>
		<ul id="row2" data-nav-row data-rect="80,680,944,200">${cards(2, 690)}</ul></section>
	<div class="guide" data-rect="80,900,944,200">
		<button id="g1" data-focusable data-rect="120,910,150,40"></button>
		<button id="g2" data-focusable data-rect="120,960,150,40"></button>
	</div>
	<button id="below" data-rect="120,1120,150,40"></button>
</main>`;

const $ = (id: string) => document.getElementById(id)!;
const fresh = (): NavState => ({ lastContent: null });

describe('candidates', () => {
	it('skips inert, ignored, zero-size and tabindex=-1 elements', () => {
		const ids = candidatesIn(document.body).map((el) => el.id);
		expect(ids).toContain('play');
		expect(ids).not.toContain('inert');
		expect(ids).not.toContain('arrow');
		expect(ids).not.toContain('');
		expect(document.querySelector('.skip')).not.toBeNull();
		expect(candidatesIn(document.body)).not.toContain(document.querySelector('.skip'));
	});

	it('first logical element is the primary button', () => {
		expect(firstLogical(document.querySelector('main')!)?.id).toBe('play');
	});
});

describe('findTarget', () => {
	it('focuses the first logical element when nothing is focused', () => {
		expect(findTarget(document.body, 'down', fresh())?.el.id).toBe('play');
	});

	it('moves from the hero down into the first row, aligned on x', () => {
		const t = findTarget($('play'), 'down', fresh());
		expect(t?.el.id).toBe('r1c0');
		expect(t?.enteredRow).toBe(true);
		expect(findTarget($('info'), 'down', fresh())?.el.id).toBe('r1c1');
	});

	it('left/right stays inside the row', () => {
		expect(findTarget($('r1c0'), 'right', fresh())?.el.id).toBe('r1c1');
		expect(findTarget($('r1c3'), 'left', fresh())?.el.id).toBe('r1c2');
		// The last card (partly off-screen) is still reachable inside its row.
		expect(findTarget($('r1c5'), 'right', fresh())?.el.id).toBe('r1c6');
		expect(findTarget($('r1c6'), 'right', fresh())).toBeNull();
	});

	it('left from the first card goes to the rail (current page)', () => {
		expect(findTarget($('r1c0'), 'left', fresh())?.el.id).toBe('nav-home');
		expect(findTarget($('play'), 'left', fresh())?.el.id).toBe('nav-home');
	});

	it('remembers the last focused card per row', () => {
		rowMemory.remember($('row1'), $('r1c4'));
		expect(findTarget($('r2c0'), 'up', fresh())?.el.id).toBe('r1c4');
		// Without memory, the visible card nearest on x is chosen.
		rowMemory.forget($('row2'));
		expect(findTarget($('r1c2'), 'down', fresh())?.el.id).toBe('r2c2');
	});

	it('ignores a stale remembered card', () => {
		rowMemory.remember($('row2'), $('r2c3'));
		$('r2c3').remove();
		expect(findTarget($('r1c1'), 'down', fresh())?.el.id).toBe('r2c1');
	});

	it('rail: up/down stay in the rail, right returns to the last content element', () => {
		expect(findTarget($('nav-home'), 'down', fresh())?.el.id).toBe('nav-movies');
		expect(findTarget($('nav-home'), 'left', fresh())).toBeNull();
		expect(findTarget($('nav-movies'), 'right', { lastContent: $('r2c5') })?.el.id).toBe('r2c5');
		expect(findTarget($('nav-movies'), 'right', fresh())?.el.id).toBe('play');
	});

	it('self-navigating containers are only left, never walked by the global nav', () => {
		expect(findTarget($('g1'), 'down', fresh())?.el.id).toBe('below');
		expect(findTarget($('r2c0'), 'down', fresh())?.el.id).toBe('g1'); // entering is fine
	});

	it('entering a group (hero) returns to its last focused element, else its primary', () => {
		expect(findTarget($('r1c1'), 'up', fresh())?.el.id).toBe('play');
		rowMemory.remember(document.querySelector('.hero')!, $('info'));
		expect(findTarget($('r1c0'), 'up', fresh())?.el.id).toBe('info');
	});

	it('down into a row skips its header link; up from the row reaches it', () => {
		expect(findTarget($('r1c5'), 'down', fresh())?.el.id).toBe('r2c4'); // r2c5 is off-screen
		expect(findTarget($('r2c5'), 'up', fresh())?.el.id).toBe('all2');
	});

	it('an open dialog is a focus trap', () => {
		document.body.insertAdjacentHTML(
			'beforeend',
			`<dialog open data-rect="300,200,400,300">
				<button id="d1" data-rect="320,220,100,40"></button>
				<button id="d2" data-rect="320,280,100,40"></button>
			</dialog>`
		);
		expect(findTarget($('play'), 'down', fresh())?.el.id).toBe('d1');
		expect(findTarget($('d1'), 'down', fresh())?.el.id).toBe('d2');
		expect(findTarget($('d2'), 'down', fresh())).toBeNull();
		expect(findTarget($('d1'), 'left', fresh())).toBeNull();
	});
});
