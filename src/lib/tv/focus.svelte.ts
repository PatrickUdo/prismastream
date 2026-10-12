// Global D-pad / keyboard navigation and the back button, wired to window events.
// Call `initTvNavigation()` once from the root layout (in an $effect) and forward
// SvelteKit's beforeNavigate / afterNavigate to `tvBeforeNavigate` / `tvAfterNavigate`.
//
// Rules (see ./navigator.ts for the markup contract):
// - events that are already handled (`defaultPrevented`) are left alone;
// - inside the video player (`.player`) nothing happens: it has its own navigation;
// - inside self-navigating containers (EPG guide, pin pad, `[data-nav="self"]`) the global
//   navigation only moves focus out, when the container did not handle the key itself;
// - in text fields only up/down are used, to leave the field;
// - an open modal (`dialog[open]`, `[aria-modal="true"]`) is a focus trap.

import { goto, type AfterNavigate, type BeforeNavigate } from '$app/navigation';
import { page } from '$app/state';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { path } from '#lib/components/links.ts';
import { backKind, isSelectKey, keyToDir, type Dir } from './spatial.ts';
import {
	activatesNatively,
	findTarget,
	firstLogical,
	focusEl,
	GROUP,
	isCandidate,
	isTextField,
	PLAYER,
	railOf,
	restore,
	reveal,
	ROW,
	rowMemory,
	snapshot,
	topOverlay,
	type FocusSnapshot,
	type NavState
} from './navigator.ts';
import { inputMode } from './mode.svelte.ts';

const EXIT_WINDOW_MS = 2000;

/** "Press again to exit" toast (Android back on the home screen). */
class ExitHint {
	visible = $state(false);
	#timer: ReturnType<typeof setTimeout> | undefined;

	show(): void {
		this.visible = true;
		clearTimeout(this.#timer);
		this.#timer = setTimeout(() => (this.visible = false), EXIT_WINDOW_MS);
	}

	hide(): void {
		clearTimeout(this.#timer);
		this.visible = false;
	}
}

export const exitHint = new ExitHint();

const state: NavState = { lastContent: null };
/** Events we dispatched ourselves to ask an overlay to close (never handled twice). */
const ownEvents = new WeakSet<Event>();
/** Focus positions per url, to restore after "back" (bookkeeping, not reactive state). */
// eslint-disable-next-line svelte/prefer-svelte-reactivity
const snapshots = new Map<string, FocusSnapshot>();
/** In-app history depth (fallback when the Navigation API is missing). */
let depth = 0;
let navToken = 0;

const urlKey = (u: URL) => u.pathname + u.search;

function canGoBack(): boolean {
	const nav = (window as unknown as { navigation?: { canGoBack?: boolean } }).navigation;
	if (typeof nav?.canGoBack === 'boolean') return nav.canGoBack && depth > 0;
	return depth > 0;
}

function isHome(): boolean {
	const p = page.url.pathname;
	return p === path('/') || p === '' || p === '/';
}

// ---- Back --------------------------------------------------------------------------------

function closeOverlay(overlay: HTMLElement): void {
	if (overlay instanceof HTMLDialogElement) {
		overlay.close();
		return;
	}
	const close = overlay.querySelector<HTMLElement>('[data-nav-close], [data-close], .close');
	if (close) {
		close.click();
		return;
	}
	const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
	ownEvents.add(esc);
	overlay.dispatchEvent(esc);
}

/** Back: close the top overlay, else go back in history; on home, (double press) exit. */
export function performBack(): void {
	const overlay = topOverlay();
	if (overlay) return closeOverlay(overlay);

	const atRoot = isHome() || (page.url.pathname.startsWith(path('/profiles')) && !canGoBack());
	if (atRoot) {
		if (!Capacitor.isNativePlatform()) return;
		if (exitHint.visible) {
			exitHint.hide();
			void App.exitApp();
		} else exitHint.show();
		return;
	}
	if (canGoBack()) history.back();
	else void goto(path('/'), { replaceState: true });
}

function onBackKey(e: KeyboardEvent, kind: NonNullable<ReturnType<typeof backKind>>): void {
	if (ownEvents.has(e)) return;
	const active = document.activeElement;
	if (kind === 'backspace' && (e.defaultPrevented || isTextField(active))) return;

	if (kind === 'remote') {
		// GoBack / BrowserBack / webOS / Tizen back: no other meaning, handle right away.
		if (e.defaultPrevented) return;
		e.preventDefault();
		performBack();
		return;
	}

	// Escape / Backspace may be used by the page itself (pin pad, search field), possibly via
	// listeners that run after this one: decide once the event has been fully dispatched.
	const overlay = topOverlay();
	const nativeDialogEscape =
		kind === 'escape' && e.isTrusted && overlay instanceof HTMLDialogElement;
	setTimeout(() => {
		if (e.defaultPrevented || nativeDialogEscape) return; // handled, or the browser closes it
		performBack();
	}, 0);
}

/** Android hardware back: offer it to the page as Escape first (player, menus, search). */
function hardwareBack(): void {
	const target = document.activeElement ?? document.body;
	target.dispatchEvent(
		new KeyboardEvent('keydown', {
			key: 'Escape',
			code: 'Escape',
			keyCode: 27,
			bubbles: true,
			cancelable: true
		})
	);
}

// ---- Arrows and OK -----------------------------------------------------------------------

function canLeaveField(el: Element, dir: Dir): boolean {
	if (dir === 'left' || dir === 'right') return false;
	if (el instanceof HTMLTextAreaElement) {
		const pos = dir === 'up' ? el.selectionStart : el.selectionEnd;
		return dir === 'up'
			? !el.value.slice(0, pos).includes('\n')
			: !el.value.slice(pos).includes('\n');
	}
	return true;
}

function move(active: Element | null, dir: Dir, e: KeyboardEvent): void {
	const t = findTarget(active, dir, state);
	if (!t) return; // nothing there: let the browser scroll the page as usual
	e.preventDefault();
	focusEl(t.el);
	reveal(t, dir);
}

/**
 * Radio groups and similar widgets in one line handle all four arrows themselves (radio
 * semantics), which traps a remote. Up/down there move out of the group instead.
 */
function onCaptureKeydown(e: KeyboardEvent): void {
	if (e.altKey || e.ctrlKey || e.metaKey || document.querySelector(PLAYER)) return;
	const dir = keyToDir(e);
	if (dir !== 'up' && dir !== 'down') return;
	const target = e.target instanceof Element ? e.target : null;
	const group = target?.closest('[role="radiogroup"]');
	if (!target || !group || !target.matches('[role="radio"]')) return;
	const tops = [...group.querySelectorAll('[role="radio"]')].map(
		(el) => el.getBoundingClientRect().top
	);
	if (Math.max(...tops) - Math.min(...tops) > 4) return; // multi-line group: leave it be
	const t = findTarget(target, dir, state);
	if (!t || group.contains(t.el)) return;
	e.preventDefault();
	e.stopPropagation();
	focusEl(t.el);
	reveal(t, dir);
}

function onKeydown(e: KeyboardEvent): void {
	if (e.altKey || e.ctrlKey || e.metaKey) return;
	// The player owns every key (incl. back) while it is on screen.
	if (document.querySelector(PLAYER)) return;

	const back = backKind(e);
	if (back) return onBackKey(e, back);
	if (e.defaultPrevented) return;

	const active = document.activeElement;
	const dir = keyToDir(e);
	if (dir) {
		if (active && isTextField(active) && !canLeaveField(active, dir)) return;
		move(active, dir, e);
		return;
	}

	if (isSelectKey(e)) {
		if (!active || active === document.body || active.tagName === 'MAIN') {
			const first = firstLogical(topOverlay() ?? document.querySelector('main') ?? document.body);
			if (first) {
				e.preventDefault();
				focusEl(first);
			}
			return;
		}
		if (isTextField(active)) return;
		if (e.key === 'Enter' && activatesNatively(active)) return;
		if (active instanceof HTMLElement && (isCandidate(active) || activatesNatively(active))) {
			e.preventDefault();
			active.click();
		}
	}
}

function onFocusIn(e: FocusEvent): void {
	const el = e.target;
	if (!(el instanceof HTMLElement)) return;
	const row = el.closest(ROW);
	if (row) rowMemory.remember(row, el);
	const group = el.closest(GROUP);
	if (group) rowMemory.remember(group, el);
	const rail = railOf();
	if (!rail?.contains(el) && !topOverlay()?.contains(el) && el.closest('main')) {
		state.lastContent = el;
	}
}

// ---- Page navigation ---------------------------------------------------------------------

export function tvBeforeNavigate(nav: BeforeNavigate): void {
	if (!nav.from) return;
	const snap = snapshot();
	if (!snap) return;
	snapshots.set(urlKey(nav.from.url), snap);
	if (snapshots.size > 40) snapshots.delete(snapshots.keys().next().value!);
}

/** A short pause (not rAF: that never fires in a background tab or a hidden WebView). */
const nextFrame = () => new Promise<void>((r) => setTimeout(r, 50));

/** Focus the first logical element (or the restored one) once the page has content. */
async function autofocus(snap: FocusSnapshot | undefined): Promise<void> {
	const token = ++navToken;
	const deadline = performance.now() + 4000;
	while (performance.now() < deadline) {
		await nextFrame();
		if (token !== navToken) return;
		if (!inputMode.started) continue; // first load: the mode is detected in an effect
		if (!inputMode.remote) return;
		const active = document.activeElement;
		const free =
			!active ||
			active === document.body ||
			active.tagName === 'MAIN' ||
			!active.isConnected ||
			!!railOf()?.contains(active);
		if (!free) return; // the page (or the user) already placed focus
		const main = document.querySelector<HTMLElement>('main');
		if (!main) return;
		const restored = snap ? restore(snap) : null;
		const el = restored ?? firstLogical(topOverlay() ?? main);
		if (!el) continue;
		focusEl(el);
		reveal({ el, row: el.closest(ROW), enteredRow: false }, null, document, 'auto');
		return;
	}
}

export function tvAfterNavigate(nav: AfterNavigate): void {
	if (nav.type === 'enter') depth = 0;
	else if (nav.type === 'popstate') depth = Math.max(0, depth + (nav.delta ?? -1));
	else depth++;
	exitHint.hide();

	const to = nav.to?.url;
	if (!to || to.pathname.startsWith(path('/watch'))) return;
	const snap = nav.type === 'popstate' ? snapshots.get(urlKey(to)) : undefined;
	void autofocus(snap);
}

// ---- Setup -------------------------------------------------------------------------------

/** Install the global listeners; returns a cleanup function. */
export function initTvNavigation(): () => void {
	const stopMode = inputMode.init();
	window.addEventListener('keydown', onCaptureKeydown, true);
	window.addEventListener('keydown', onKeydown);
	document.addEventListener('focusin', onFocusIn);

	let removeBack: (() => void) | undefined;
	let cancelled = false;
	if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') {
		void App.addListener('backButton', hardwareBack).then((handle) => {
			if (cancelled) void handle.remove();
			else removeBack = () => void handle.remove();
		});
	}

	return () => {
		cancelled = true;
		stopMode();
		window.removeEventListener('keydown', onCaptureKeydown, true);
		window.removeEventListener('keydown', onKeydown);
		document.removeEventListener('focusin', onFocusIn);
		removeBack?.();
	};
}
