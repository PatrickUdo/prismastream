// Input-mode and TV detection. Sets `data-input="pointer|touch|remote"` and (on TVs)
// `data-device="tv"` on <html>; app.css and the components style focus and layout on these.

import { Capacitor } from '@capacitor/core';
import { detectTv, initialMode, modeForEvent, type InputMode } from './detect.ts';
import { isTextField } from './navigator.ts';

const TV_KEY = 'prisma.tv';

function readStored(): string | null {
	try {
		return sessionStorage.getItem(TV_KEY);
	} catch {
		return null;
	}
}

function persist(search: string): void {
	const v = new URLSearchParams(search).get('tv');
	if (v === null) return;
	try {
		sessionStorage.setItem(TV_KEY, v === '1' || v === 'true' ? '1' : '0');
	} catch {
		// Storage unavailable (private mode); the override then only lasts for this load.
	}
}

class InputModeState {
	mode = $state<InputMode>('pointer');
	tv = $state(false);
	#lastKeyAt = -Infinity;
	#started = false;

	get remote(): boolean {
		return this.mode === 'remote';
	}

	/** True once `init()` has detected the device and initial mode. */
	get started(): boolean {
		return this.#started;
	}

	/** Detect the device and start listening; returns a cleanup function. */
	init(): () => void {
		if (this.#started) return () => {};
		this.#started = true;
		const root = document.documentElement;

		persist(location.search);
		this.tv = detectTv({
			userAgent: navigator.userAgent,
			search: location.search,
			stored: readStored(),
			platform: Capacitor.getPlatform(),
			maxTouchPoints: navigator.maxTouchPoints,
			screenWidth: screen.width,
			screenHeight: screen.height
		});
		if (this.tv) root.dataset.device = 'tv';
		else delete root.dataset.device;

		const coarseOnly =
			matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches;
		this.set(initialMode({ tv: this.tv, coarseOnly }));

		const onKey = (e: KeyboardEvent) => {
			const inTextField = isTextField(e.target instanceof Element ? e.target : null);
			const next = modeForEvent(
				{ type: e.type, key: e.key, keyCode: e.keyCode, inTextField },
				performance.now(),
				this.#lastKeyAt
			);
			if (next) {
				this.#lastKeyAt = performance.now();
				this.set(next);
			}
		};
		const onPointer = (e: PointerEvent | MouseEvent | TouchEvent | WheelEvent) => {
			const next = modeForEvent(
				{
					type: e.type,
					pointerType: 'pointerType' in e ? e.pointerType : undefined,
					movementX: 'movementX' in e ? e.movementX : undefined,
					movementY: 'movementY' in e ? e.movementY : undefined
				},
				performance.now(),
				this.#lastKeyAt
			);
			if (next) this.set(next);
		};
		const opts = { capture: true, passive: true } as const;
		window.addEventListener('keydown', onKey, true);
		window.addEventListener('pointerdown', onPointer, opts);
		window.addEventListener('mousemove', onPointer, opts);
		window.addEventListener('touchstart', onPointer, opts);
		window.addEventListener('wheel', onPointer, opts);
		return () => {
			this.#started = false;
			window.removeEventListener('keydown', onKey, true);
			window.removeEventListener('pointerdown', onPointer, opts);
			window.removeEventListener('mousemove', onPointer, opts);
			window.removeEventListener('touchstart', onPointer, opts);
			window.removeEventListener('wheel', onPointer, opts);
		};
	}

	set(mode: InputMode): void {
		if (this.mode === mode && document.documentElement.dataset.input === mode) return;
		this.mode = mode;
		document.documentElement.dataset.input = mode;
	}
}

export const inputMode = new InputModeState();
