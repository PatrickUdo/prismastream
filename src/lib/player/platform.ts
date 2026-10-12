// Browser / native platform helpers for the player: fullscreen, Picture-in-Picture,
// orientation lock, status bar, screen wake lock and the Media Session API.
// Everything degrades silently when an API is missing.
import { Capacitor } from '@capacitor/core';

type WebkitDocument = Document & {
	webkitFullscreenElement?: Element | null;
	webkitExitFullscreen?: () => void;
};
type WebkitElement = HTMLElement & { webkitRequestFullscreen?: () => void };
type WebkitVideo = HTMLVideoElement & {
	webkitEnterFullscreen?: () => void;
	webkitExitFullscreen?: () => void;
	webkitDisplayingFullscreen?: boolean;
	webkitSupportsPresentationMode?: (mode: string) => boolean;
	webkitSetPresentationMode?: (mode: string) => void;
	webkitPresentationMode?: string;
};

export function isNative(): boolean {
	return Capacitor.isNativePlatform();
}

// ---- fullscreen -----------------------------------------------------------

export function fullscreenElement(): Element | null {
	const d = document as WebkitDocument;
	return document.fullscreenElement ?? d.webkitFullscreenElement ?? null;
}

export function isFullscreen(video?: HTMLVideoElement | null): boolean {
	return !!fullscreenElement() || !!(video as WebkitVideo | null)?.webkitDisplayingFullscreen;
}

/** Fullscreen the whole player (keeps our overlay); iOS falls back to native video fullscreen. */
export async function enterFullscreen(container: HTMLElement, video: HTMLVideoElement) {
	const el = container as WebkitElement;
	try {
		if (el.requestFullscreen) {
			await el.requestFullscreen({ navigationUI: 'hide' });
			return;
		}
		if (el.webkitRequestFullscreen) {
			el.webkitRequestFullscreen();
			return;
		}
	} catch {
		// fall through to the video element
	}
	(video as WebkitVideo).webkitEnterFullscreen?.();
}

export async function exitFullscreen(video?: HTMLVideoElement | null) {
	const d = document as WebkitDocument;
	try {
		if (document.fullscreenElement) await document.exitFullscreen();
		else if (d.webkitFullscreenElement) d.webkitExitFullscreen?.();
		else (video as WebkitVideo | null)?.webkitExitFullscreen?.();
	} catch {
		// ignore
	}
}

export function onFullscreenChange(cb: () => void): () => void {
	document.addEventListener('fullscreenchange', cb);
	document.addEventListener('webkitfullscreenchange', cb);
	return () => {
		document.removeEventListener('fullscreenchange', cb);
		document.removeEventListener('webkitfullscreenchange', cb);
	};
}

export function fullscreenSupported(video: HTMLVideoElement | null): boolean {
	const el = document.documentElement as WebkitElement;
	return (
		!!document.fullscreenEnabled ||
		!!el.webkitRequestFullscreen ||
		!!(video as WebkitVideo | null)?.webkitEnterFullscreen
	);
}

// ---- picture-in-picture ---------------------------------------------------

export function pipSupported(video: HTMLVideoElement | null): boolean {
	if (!video) return false;
	if (document.pictureInPictureEnabled && !video.disablePictureInPicture) return true;
	const v = video as WebkitVideo;
	return !!v.webkitSupportsPresentationMode?.('picture-in-picture');
}

export async function togglePip(video: HTMLVideoElement) {
	const v = video as WebkitVideo;
	try {
		if (document.pictureInPictureEnabled) {
			if (document.pictureInPictureElement) await document.exitPictureInPicture();
			else await video.requestPictureInPicture();
			return;
		}
		if (v.webkitSetPresentationMode) {
			v.webkitSetPresentationMode(
				v.webkitPresentationMode === 'picture-in-picture' ? 'inline' : 'picture-in-picture'
			);
		}
	} catch (err) {
		console.warn('[player] PiP failed', err);
	}
}

// ---- native mobile: orientation & status bar ------------------------------

/** Lock landscape and hide the status bar on native mobile. Returns the restore function. */
export async function enterPlaybackMode(): Promise<() => Promise<void>> {
	if (!isNative()) return async () => {};
	const [{ ScreenOrientation }, { StatusBar }] = await Promise.all([
		import('@capacitor/screen-orientation'),
		import('@capacitor/status-bar')
	]);
	await ScreenOrientation.lock({ orientation: 'landscape' }).catch(() => {});
	await StatusBar.hide().catch(() => {});
	return async () => {
		await ScreenOrientation.unlock().catch(() => {});
		await StatusBar.show().catch(() => {});
	};
}

// ---- screen wake lock (web) -----------------------------------------------

export class WakeLock {
	#sentinel: WakeLockSentinel | null = null;
	#want = false;

	async set(on: boolean) {
		this.#want = on;
		if (!('wakeLock' in navigator)) return;
		try {
			if (on && !this.#sentinel) {
				const s = await navigator.wakeLock.request('screen');
				if (!this.#want) {
					void s.release();
					return;
				}
				this.#sentinel = s;
				s.addEventListener('release', () => {
					if (this.#sentinel === s) this.#sentinel = null;
				});
			} else if (!on && this.#sentinel) {
				const s = this.#sentinel;
				this.#sentinel = null;
				await s.release();
			}
		} catch {
			// Not allowed (e.g. page hidden); ignore.
		}
	}
}

// ---- Media Session --------------------------------------------------------

export interface MediaSessionInfo {
	title: string;
	artist?: string;
	album?: string;
	artworkUrl?: string;
}

export interface MediaSessionHandlers {
	play: () => void;
	pause: () => void;
	seekBy?: (delta: number) => void;
	seekTo?: (sec: number) => void;
	next?: () => void;
	previous?: () => void;
}

export function setMediaSession(info: MediaSessionInfo, h: MediaSessionHandlers): () => void {
	if (!('mediaSession' in navigator)) return () => {};
	const ms = navigator.mediaSession;
	try {
		ms.metadata = new MediaMetadata({
			title: info.title,
			artist: info.artist ?? '',
			album: info.album ?? '',
			artwork: info.artworkUrl ? [{ src: info.artworkUrl, sizes: '512x512' }] : []
		});
	} catch {
		// MediaMetadata unsupported
	}
	const set = (action: MediaSessionAction, fn: MediaSessionActionHandler | null) => {
		try {
			ms.setActionHandler(action, fn);
		} catch {
			// action unsupported
		}
	};
	set('play', () => h.play());
	set('pause', () => h.pause());
	set('seekbackward', h.seekBy ? (d) => h.seekBy!(-(d.seekOffset ?? 10)) : null);
	set('seekforward', h.seekBy ? (d) => h.seekBy!(d.seekOffset ?? 10) : null);
	set('seekto', h.seekTo ? (d) => d.seekTime != null && h.seekTo!(d.seekTime) : null);
	set('nexttrack', h.next ?? null);
	set('previoustrack', h.previous ?? null);
	return () => {
		for (const a of [
			'play',
			'pause',
			'seekbackward',
			'seekforward',
			'seekto',
			'nexttrack',
			'previoustrack'
		] as MediaSessionAction[])
			set(a, null);
		try {
			ms.metadata = null;
		} catch {
			// ignore
		}
	};
}

export function setMediaPosition(position: number, duration: number, rate: number) {
	if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
	try {
		if (Number.isFinite(duration) && duration > 0)
			navigator.mediaSession.setPositionState({
				duration,
				position: Math.min(Math.max(0, position), duration),
				playbackRate: rate || 1
			});
	} catch {
		// ignore invalid state
	}
}
