// PlayerEngine: one reactive abstraction over a <video> element.
//
// - HLS via hls.js (ABR, manual quality, audio and subtitle tracks, error recovery).
// - Native HLS when hls.js/MSE is unavailable but the element plays HLS itself (iOS WebView).
// - Progressive files (.mp4/.mkv/.webm) directly through <video>.
// - MPEG-TS (.ts) live: first the .m3u8 twin of the url, then the raw url (see source.ts).
//
// One engine lives as long as the player page; `load()` swaps the stream on the same
// <video> element (fast zapping, variant switches). `destroy()` releases everything.
import Hls, {
	ErrorDetails,
	ErrorTypes,
	Events,
	type ErrorData,
	type HlsConfig,
	type MediaPlaylist
} from 'hls.js';
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import type { LangCode } from '#lib/types.ts';
import { loadJSON, saveJSON } from '#lib/storage.ts';
import { streamCandidates, type StreamCandidate } from './source.ts';
import { normalizeLang, type TrackInfo } from './tracks.ts';
import { clamp } from './format.ts';
import { createNativeFallbackLoader, hostMemo, type LoaderCtor } from './native-loader.ts';

export type EngineErrorKind = 'network' | 'media' | 'unsupported' | 'unknown';

export interface QualityLevel {
	/** hls.js level index. */
	index: number;
	height: number;
	width: number;
	bitrate: number;
}

export interface LoadRequest {
	url: string;
	containerExt?: string;
	live: boolean;
	/** Seconds to start at (VOD only). */
	startAt?: number;
	/** Start playing automatically (default true). */
	autoplay?: boolean;
	/** Ordered preferred audio languages for multi-audio streams. */
	pickAudio?: (tracks: TrackInfo[]) => number;
	/** Called once per load when subtitle tracks become known; returns a track id or -1. */
	pickSubtitle?: (tracks: TrackInfo[], audioLang: LangCode | undefined) => number;
}

interface NativeAudioTrack {
	id: string;
	kind: string;
	label: string;
	language: string;
	enabled: boolean;
}
interface NativeAudioTrackList extends EventTarget {
	readonly length: number;
	[index: number]: NativeAudioTrack;
}

function nativeAudio(v: HTMLVideoElement): NativeAudioTrackList | undefined {
	return (v as HTMLVideoElement & { audioTracks?: NativeAudioTrackList }).audioTracks;
}

let fallbackLoaderClass: LoaderCtor | null = null;

/** hls.js loader that retries CORS-blocked requests through CapacitorHttp (native only). */
function fallbackLoader(): LoaderCtor {
	fallbackLoaderClass ??= createNativeFallbackLoader(Hls.DefaultConfig.loader, {
		isNative: () => Capacitor.isNativePlatform(),
		memo: hostMemo,
		request: async (r) => {
			const res = await CapacitorHttp.request({
				url: r.url,
				method: 'GET',
				headers: r.headers,
				responseType: r.responseType,
				connectTimeout: r.connectTimeout,
				readTimeout: r.readTimeout
			});
			return { status: res.status, data: res.data, headers: res.headers, url: res.url };
		}
	});
	return fallbackLoaderClass;
}

const NET_RETRIES = 3;
const STALL_MS = 12_000;
const VOLUME_KEY = 'player:volume';

type Mode = 'none' | 'hls' | 'native-hls' | 'progressive';

export class PlayerEngine {
	// ---- reactive state ---------------------------------------------------
	/** A <video> element is attached; load() may be called. */
	attached = $state(false);
	/** Stream is being opened (manifest/metadata not ready). */
	loading = $state(false);
	/** Waiting for data while playing (spinner). */
	buffering = $state(false);
	paused = $state(true);
	ended = $state(false);
	currentTime = $state(0);
	duration = $state(0);
	/** End of the buffered range around currentTime. */
	bufferedEnd = $state(0);
	volume = $state(1);
	muted = $state(false);
	rate = $state(1);
	live = $state(false);
	/** Seconds behind the live edge (live hls.js streams only). */
	liveLatency = $state(0);

	levels = $state<QualityLevel[]>([]);
	/** Selected level, -1 = automatic (ABR). */
	selectedLevel = $state(-1);
	/** Level currently playing (what ABR picked). */
	playingLevel = $state(-1);
	/** Whether manual quality choice is possible (hls.js only). */
	qualitySelectable = $state(false);

	audioTracks = $state<TrackInfo[]>([]);
	audioTrack = $state(-1);
	subtitleTracks = $state<TrackInfo[]>([]);
	subtitleTrack = $state(-1);

	pip = $state(false);
	error = $state<{ kind: EngineErrorKind; detail: string } | null>(null);
	/** Playback could not start without a user gesture (autoplay policy). */
	needsGesture = $state(false);

	// ---- internals --------------------------------------------------------
	#video: HTMLVideoElement | null = null;
	#hls: Hls | null = null;
	#mode: Mode = 'none';
	#req: LoadRequest | null = null;
	#candidates: StreamCandidate[] = [];
	#candidateIndex = 0;
	#gen = 0;
	#netRetries = 0;
	#mediaRetries = 0;
	#lastMediaRecovery = 0;
	#progressiveRetries = 0;
	#subsPicked = false;
	/** Subtitle track we want (null = not decided yet); hls.js auto-selection is overridden. */
	#subWanted: number | null = null;
	#audioPicked = false;
	#stallTimer: ReturnType<typeof setTimeout> | undefined;
	#retryTimer: ReturnType<typeof setTimeout> | undefined;
	#cleanup: (() => void)[] = [];
	#everPlayed = false;

	constructor() {
		void loadJSON<{ volume: number; muted: boolean } | null>(VOLUME_KEY, null).then((v) => {
			if (!v) return;
			this.volume = clamp(v.volume, 0, 1);
			this.muted = v.muted;
			if (this.#video) {
				this.#video.volume = this.volume;
				this.#video.muted = this.muted;
			}
		});
	}

	get video(): HTMLVideoElement | null {
		return this.#video;
	}

	/** True while a stream is attached and not failed. */
	get active(): boolean {
		return this.#mode !== 'none' && !this.error;
	}

	// ---- element lifecycle ------------------------------------------------

	/** Bind the engine to its <video>. Returns a detach function (use in $effect/onMount). */
	attach(video: HTMLVideoElement): () => void {
		this.#video = video;
		this.attached = true;
		video.volume = this.volume;
		video.muted = this.muted;
		video.playbackRate = this.rate;
		const on = <K extends keyof HTMLVideoElementEventMap>(
			target: HTMLVideoElement,
			type: K,
			fn: (e: HTMLVideoElementEventMap[K]) => void
		) => {
			target.addEventListener(type, fn);
			this.#cleanup.push(() => target.removeEventListener(type, fn));
		};
		on(video, 'play', () => {
			this.paused = false;
			this.needsGesture = false;
		});
		on(video, 'playing', () => {
			this.paused = false;
			this.buffering = false;
			this.loading = false;
			this.ended = false;
			this.#everPlayed = true;
			this.#clearStall();
		});
		on(video, 'pause', () => {
			this.paused = true;
			this.#clearStall();
		});
		on(video, 'waiting', () => {
			this.buffering = true;
			this.#armStall();
		});
		on(video, 'seeking', () => (this.buffering = true));
		on(video, 'seeked', () => (this.buffering = false));
		on(video, 'canplay', () => {
			this.buffering = false;
			this.loading = false;
		});
		on(video, 'ended', () => {
			this.ended = true;
			this.paused = true;
		});
		on(video, 'timeupdate', () => this.#onTime());
		on(video, 'progress', () => this.#updateBuffered());
		on(video, 'durationchange', () => this.#updateDuration());
		on(video, 'loadedmetadata', () => {
			this.#updateDuration();
			if (this.#mode !== 'hls') this.#onNativeMetadata();
		});
		on(video, 'volumechange', () => {
			this.volume = video.volume;
			this.muted = video.muted;
			void saveJSON(VOLUME_KEY, { volume: this.volume, muted: this.muted });
		});
		on(video, 'ratechange', () => (this.rate = video.playbackRate));
		on(video, 'error', () => this.#onVideoError());
		on(video, 'enterpictureinpicture', () => (this.pip = true));
		on(video, 'leavepictureinpicture', () => (this.pip = false));
		const presentation = () => {
			const mode = (video as HTMLVideoElement & { webkitPresentationMode?: string })
				.webkitPresentationMode;
			this.pip = mode === 'picture-in-picture';
		};
		video.addEventListener('webkitpresentationmodechanged', presentation);
		this.#cleanup.push(() =>
			video.removeEventListener('webkitpresentationmodechanged', presentation)
		);

		// Native track lists (Safari / native HLS / progressive multi-audio).
		const tracksChanged = () => {
			if (this.#mode !== 'hls') this.#syncNativeTracks();
		};
		video.textTracks.addEventListener('addtrack', tracksChanged);
		video.textTracks.addEventListener('removetrack', tracksChanged);
		this.#cleanup.push(() => {
			video.textTracks.removeEventListener('addtrack', tracksChanged);
			video.textTracks.removeEventListener('removetrack', tracksChanged);
		});
		const audio = nativeAudio(video);
		if (audio) {
			audio.addEventListener('addtrack', tracksChanged);
			audio.addEventListener('change', tracksChanged);
			this.#cleanup.push(() => {
				audio.removeEventListener('addtrack', tracksChanged);
				audio.removeEventListener('change', tracksChanged);
			});
		}
		return () => this.destroy();
	}

	/** Release the stream, hls.js instance, timers and listeners. */
	destroy() {
		this.#teardown();
		for (const fn of this.#cleanup.splice(0)) fn();
		this.#video = null;
		this.#req = null;
		this.attached = false;
	}

	// ---- loading ----------------------------------------------------------

	/** Open a stream (replaces the current one on the same element). */
	load(req: LoadRequest) {
		const video = this.#video;
		if (!video) throw new Error('PlayerEngine.load() before attach()');
		this.#teardown();
		this.#req = req;
		this.live = req.live;
		this.#candidates = streamCandidates(req.url, req.containerExt);
		this.#candidateIndex = 0;
		this.#resetState();
		this.#openCandidate();
	}

	/** Retry the current request from scratch (after an error). */
	retry() {
		if (!this.#req) return;
		const resumeAt = this.live ? undefined : this.currentTime || this.#req.startAt;
		this.load({ ...this.#req, startAt: resumeAt, autoplay: true });
	}

	#resetState() {
		this.loading = true;
		this.buffering = false;
		this.ended = false;
		this.error = null;
		this.needsGesture = false;
		this.currentTime = this.#req?.startAt ?? 0;
		this.duration = 0;
		this.bufferedEnd = 0;
		this.liveLatency = 0;
		this.levels = [];
		this.selectedLevel = -1;
		this.playingLevel = -1;
		this.qualitySelectable = false;
		this.audioTracks = [];
		this.audioTrack = -1;
		this.subtitleTracks = [];
		this.subtitleTrack = -1;
		this.#netRetries = 0;
		this.#mediaRetries = 0;
		this.#progressiveRetries = 0;
		this.#subsPicked = false;
		this.#subWanted = null;
		this.#audioPicked = false;
		this.#everPlayed = false;
	}

	#teardown() {
		this.#gen++;
		this.#clearStall();
		clearTimeout(this.#retryTimer);
		if (this.#hls) {
			this.#hls.destroy();
			this.#hls = null;
		}
		const video = this.#video;
		if (video && this.#mode !== 'none') {
			video.pause();
			video.removeAttribute('src');
			video.load();
		}
		this.#mode = 'none';
	}

	#openCandidate() {
		const video = this.#video;
		const req = this.#req;
		const cand = this.#candidates[this.#candidateIndex];
		if (!video || !req || !cand) return;
		const gen = ++this.#gen;
		const startAt = !req.live && req.startAt && req.startAt > 0 ? req.startAt : 0;

		if (cand.kind === 'hls') {
			if (Hls.isSupported()) {
				this.#openHls(cand.url, startAt, gen);
				return;
			}
			if (video.canPlayType('application/vnd.apple.mpegurl')) {
				this.#mode = 'native-hls';
				this.#openNative(cand.url, startAt, gen);
				return;
			}
			this.#nextCandidate('unsupported', 'HLS not supported');
			return;
		}
		this.#mode = 'progressive';
		this.#openNative(cand.url, startAt, gen);
	}

	#openNative(url: string, startAt: number, gen: number) {
		const video = this.#video!;
		this.#pendingStart = startAt;
		video.src = url;
		video.load();
		this.#autoplay(gen);
	}

	#pendingStart = 0;

	#openHls(url: string, startAt: number, gen: number) {
		const video = this.#video!;
		const live = this.live;
		const config: Partial<HlsConfig> = {
			enableWorker: true,
			startPosition: startAt > 0 ? startAt : -1,
			capLevelToPlayerSize: true,
			backBufferLength: live ? 30 : 60,
			maxBufferLength: 30,
			liveDurationInfinity: true,
			lowLatencyMode: false,
			enableCEA708Captions: false,
			renderTextTracksNatively: true,
			// Native apps: fall back to CapacitorHttp for servers without CORS headers.
			...(Capacitor.isNativePlatform() ? { loader: fallbackLoader() } : {})
		};
		const hls = new Hls(config);
		this.#hls = hls;
		this.#mode = 'hls';
		this.qualitySelectable = true;
		const alive = () => gen === this.#gen && this.#hls === hls;

		hls.on(Events.MANIFEST_PARSED, (_e, data) => {
			if (!alive()) return;
			this.levels = data.levels
				.map((l, index) => ({ index, height: l.height, width: l.width, bitrate: l.bitrate }))
				.sort((a, b) => b.height - a.height || b.bitrate - a.bitrate);
			this.#autoplay(gen);
		});
		hls.on(Events.LEVEL_SWITCHED, (_e, data) => {
			if (alive()) this.playingLevel = data.level;
		});
		hls.on(Events.AUDIO_TRACKS_UPDATED, (_e, data) => {
			if (!alive()) return;
			this.audioTracks = data.audioTracks.map(toTrackInfo);
			this.audioTrack = hls.audioTrack;
			if (!this.#audioPicked && this.#req?.pickAudio && this.audioTracks.length > 1) {
				this.#audioPicked = true;
				const id = this.#req.pickAudio(this.audioTracks);
				if (id >= 0 && id !== hls.audioTrack) hls.audioTrack = id;
			}
		});
		hls.on(Events.AUDIO_TRACK_SWITCHED, (_e, data) => {
			if (alive()) this.audioTrack = data.id;
		});
		hls.on(Events.SUBTITLE_TRACKS_UPDATED, (_e, data) => {
			if (!alive()) return;
			this.subtitleTracks = data.subtitleTracks.map(toTrackInfo);
			if (!this.#subsPicked && this.subtitleTracks.length) {
				this.#subsPicked = true;
				const id = this.#req?.pickSubtitle?.(this.subtitleTracks, this.#audioLang()) ?? -1;
				this.setSubtitleTrack(id);
			}
		});
		hls.on(Events.SUBTITLE_TRACK_SWITCH, (_e, data) => {
			if (!alive()) return;
			const wanted = this.#subWanted;
			if (wanted !== null && data.id !== wanted) {
				// hls.js auto-selected a DEFAULT/AUTOSELECT track; restore our choice.
				queueMicrotask(() => {
					if (alive() && hls.subtitleTrack !== wanted) {
						hls.subtitleDisplay = wanted >= 0;
						hls.subtitleTrack = wanted;
					}
				});
				return;
			}
			this.subtitleTrack = data.id;
		});
		hls.on(Events.FRAG_LOADED, () => {
			if (alive()) this.#netRetries = 0;
		});
		hls.on(Events.ERROR, (_e, data) => {
			if (alive()) this.#onHlsError(hls, data);
		});

		hls.attachMedia(video);
		hls.loadSource(url);
	}

	#autoplay(gen: number) {
		const video = this.#video;
		if (!video || this.#req?.autoplay === false) {
			this.loading = false;
			return;
		}
		video.play().catch((err: unknown) => {
			if (gen !== this.#gen) return;
			if (err instanceof DOMException && err.name === 'NotAllowedError') {
				this.needsGesture = true;
				this.loading = false;
				this.paused = true;
			}
			// AbortError (load interrupted by a new load) is expected while zapping.
		});
	}

	#nextCandidate(kind: EngineErrorKind, detail: string) {
		if (this.#candidateIndex + 1 < this.#candidates.length) {
			this.#teardownStreamOnly();
			this.#candidateIndex++;
			this.#netRetries = 0;
			this.#mediaRetries = 0;
			this.#progressiveRetries = 0;
			this.#openCandidate();
			return;
		}
		this.#fail(kind, detail);
	}

	#teardownStreamOnly() {
		const hls = this.#hls;
		this.#hls = null;
		hls?.destroy();
		const video = this.#video;
		if (video) {
			video.removeAttribute('src');
			video.load();
		}
		this.#mode = 'none';
	}

	#fail(kind: EngineErrorKind, detail: string) {
		this.#gen++;
		this.#clearStall();
		clearTimeout(this.#retryTimer);
		this.#teardownStreamOnly();
		this.loading = false;
		this.buffering = false;
		this.paused = true;
		this.error = { kind, detail };
	}

	// ---- error handling ---------------------------------------------------

	#onHlsError(hls: Hls, data: ErrorData) {
		if (!data.fatal) return;
		const manifestFailure =
			data.details === ErrorDetails.MANIFEST_LOAD_ERROR ||
			data.details === ErrorDetails.MANIFEST_LOAD_TIMEOUT ||
			data.details === ErrorDetails.MANIFEST_PARSING_ERROR ||
			data.details === ErrorDetails.MANIFEST_INCOMPATIBLE_CODECS_ERROR;
		if (manifestFailure && !this.#everPlayed) {
			this.#nextCandidate(
				data.details === ErrorDetails.MANIFEST_INCOMPATIBLE_CODECS_ERROR
					? 'unsupported'
					: 'network',
				data.details
			);
			return;
		}
		switch (data.type) {
			case ErrorTypes.NETWORK_ERROR: {
				if (this.#netRetries >= NET_RETRIES) {
					this.#fail('network', data.details);
					return;
				}
				this.#netRetries++;
				const gen = this.#gen;
				clearTimeout(this.#retryTimer);
				this.#retryTimer = setTimeout(() => {
					if (gen === this.#gen && this.#hls === hls) hls.startLoad();
				}, 1000 * this.#netRetries);
				return;
			}
			case ErrorTypes.MEDIA_ERROR: {
				const now = Date.now();
				if (now - this.#lastMediaRecovery > 15_000) this.#mediaRetries = 0;
				this.#lastMediaRecovery = now;
				this.#mediaRetries++;
				if (this.#mediaRetries === 1) hls.recoverMediaError();
				else if (this.#mediaRetries === 2) {
					hls.swapAudioCodec();
					hls.recoverMediaError();
				} else this.#nextCandidate('media', data.details);
				return;
			}
			default:
				this.#nextCandidate('unknown', data.details);
		}
	}

	#onVideoError() {
		if (this.#mode === 'hls' || this.#mode === 'none') return;
		const video = this.#video;
		const err = video?.error;
		if (!video || !err) return;
		const code = err.code;
		if (code === MediaError.MEDIA_ERR_ABORTED) return;
		if (code === MediaError.MEDIA_ERR_NETWORK && this.#progressiveRetries < 2 && this.#req) {
			this.#progressiveRetries++;
			const at = this.live ? 0 : video.currentTime;
			const gen = ++this.#gen;
			const url = this.#candidates[this.#candidateIndex]?.url ?? this.#req.url;
			clearTimeout(this.#retryTimer);
			this.#retryTimer = setTimeout(() => {
				if (gen === this.#gen) this.#openNative(url, at, gen);
			}, 1000 * this.#progressiveRetries);
			return;
		}
		const kind: EngineErrorKind =
			code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED
				? 'unsupported'
				: code === MediaError.MEDIA_ERR_DECODE
					? 'media'
					: 'network';
		this.#nextCandidate(kind, err.message || `MediaError ${code}`);
	}

	/** Live streams that stall for long are reloaded (common with IPTV servers). */
	#armStall() {
		this.#clearStall();
		if (!this.live) return;
		const gen = this.#gen;
		this.#stallTimer = setTimeout(() => {
			if (gen !== this.#gen || this.paused) return;
			if (this.#hls) {
				this.#hls.stopLoad();
				this.#hls.startLoad(-1);
			} else this.retry();
		}, STALL_MS);
	}

	#clearStall() {
		clearTimeout(this.#stallTimer);
		this.#stallTimer = undefined;
	}

	// ---- time & tracks ----------------------------------------------------

	#onTime() {
		const video = this.#video;
		// Ignore the timeupdate fired by tearing down a stream (position resets to 0).
		if (!video || this.#mode === 'none' || video.readyState === 0) return;
		this.currentTime = video.currentTime;
		this.#updateBuffered();
		if (this.#hls && this.live) {
			const edge = this.#hls.liveSyncPosition;
			this.liveLatency = edge != null ? Math.max(0, edge - video.currentTime) : 0;
		}
	}

	#updateBuffered() {
		const video = this.#video;
		if (!video) return;
		const b = video.buffered;
		const t = video.currentTime;
		let end = t;
		for (let i = 0; i < b.length; i++) {
			if (b.start(i) <= t + 0.5 && b.end(i) >= t) end = Math.max(end, b.end(i));
		}
		this.bufferedEnd = end;
	}

	#updateDuration() {
		const d = this.#video?.duration ?? 0;
		this.duration = Number.isFinite(d) ? d : 0;
		if (d === Infinity) this.live = true;
	}

	#onNativeMetadata() {
		const video = this.#video;
		if (!video) return;
		if (this.#pendingStart > 0 && !this.live) {
			try {
				video.currentTime = this.#pendingStart;
			} catch {
				// Some streams are not seekable before playback; ignore.
			}
		}
		this.#pendingStart = 0;
		this.#syncNativeTracks();
	}

	#syncNativeTracks() {
		const video = this.#video;
		if (!video) return;
		const audio = nativeAudio(video);
		if (audio) {
			const list: TrackInfo[] = [];
			let active = -1;
			for (let i = 0; i < audio.length; i++) {
				const t = audio[i];
				list.push({
					id: i,
					lang: normalizeLang(t.language, t.label),
					name: t.label,
					isDefault: t.kind === 'main'
				});
				if (t.enabled) active = i;
			}
			this.audioTracks = list;
			this.audioTrack = active;
			if (!this.#audioPicked && list.length > 1 && this.#req?.pickAudio) {
				this.#audioPicked = true;
				const id = this.#req.pickAudio(list);
				if (id >= 0 && id !== active) this.setAudioTrack(id);
			}
		}
		const subs: TrackInfo[] = [];
		const tt = video.textTracks;
		let showing = -1;
		for (let i = 0; i < tt.length; i++) {
			const t = tt[i];
			if (t.kind !== 'subtitles' && t.kind !== 'captions') continue;
			subs.push({ id: i, lang: normalizeLang(t.language, t.label), name: t.label });
			if (t.mode === 'showing') showing = i;
		}
		this.subtitleTracks = subs;
		this.subtitleTrack = showing;
		if (!this.#subsPicked && subs.length) {
			this.#subsPicked = true;
			const id = this.#req?.pickSubtitle?.(subs, this.#audioLang()) ?? -1;
			this.setSubtitleTrack(id);
		}
	}

	#audioLang(): LangCode | undefined {
		return this.audioTracks.find((t) => t.id === this.audioTrack)?.lang;
	}

	// ---- commands ---------------------------------------------------------

	play() {
		const video = this.#video;
		if (!video) return;
		if (this.error) {
			this.retry();
			return;
		}
		if (this.ended && !this.live) video.currentTime = 0;
		video.play().catch(() => {
			/* reported through state */
		});
	}

	pause() {
		this.#video?.pause();
	}

	toggle() {
		if (this.paused) this.play();
		else this.pause();
	}

	seek(sec: number) {
		const video = this.#video;
		if (!video || this.live) return;
		const max = this.duration > 0 ? this.duration - 0.25 : sec;
		const to = clamp(sec, 0, Math.max(0, max));
		video.currentTime = to;
		this.currentTime = to;
		this.ended = false;
	}

	seekBy(delta: number) {
		this.seek((this.#video?.currentTime ?? this.currentTime) + delta);
	}

	/** Jump to the live edge. */
	goLive() {
		const video = this.#video;
		if (!video) return;
		const edge = this.#hls?.liveSyncPosition;
		if (edge != null) video.currentTime = edge;
		else if (video.seekable.length)
			video.currentTime = video.seekable.end(video.seekable.length - 1);
		void video.play().catch(() => {});
	}

	setVolume(v: number) {
		const video = this.#video;
		if (!video) return;
		video.volume = clamp(v, 0, 1);
		if (video.volume > 0 && video.muted) video.muted = false;
	}

	setMuted(m: boolean) {
		if (this.#video) this.#video.muted = m;
	}

	setRate(r: number) {
		if (this.#video) this.#video.playbackRate = clamp(r, 0.25, 4);
	}

	/** -1 = automatic quality. */
	setLevel(index: number) {
		const hls = this.#hls;
		if (!hls) return;
		hls.currentLevel = index;
		this.selectedLevel = index;
	}

	setAudioTrack(id: number) {
		if (this.#hls) {
			this.#hls.audioTrack = id;
			this.audioTrack = id;
			return;
		}
		const video = this.#video;
		const audio = video ? nativeAudio(video) : undefined;
		if (!audio) return;
		for (let i = 0; i < audio.length; i++) audio[i].enabled = i === id;
		this.audioTrack = id;
	}

	/** -1 = subtitles off. */
	setSubtitleTrack(id: number) {
		this.#subWanted = id;
		if (this.#hls) {
			this.#hls.subtitleDisplay = id >= 0;
			this.#hls.subtitleTrack = id;
			this.subtitleTrack = id;
			return;
		}
		const video = this.#video;
		if (!video) return;
		const tt = video.textTracks;
		for (let i = 0; i < tt.length; i++) {
			const t = tt[i];
			if (t.kind !== 'subtitles' && t.kind !== 'captions') continue;
			t.mode = i === id ? 'showing' : 'disabled';
		}
		this.subtitleTrack = id;
	}
}

function toTrackInfo(t: MediaPlaylist): TrackInfo {
	return {
		id: t.id,
		lang: normalizeLang(t.lang, t.name),
		name: t.name,
		isDefault: t.default
	};
}
