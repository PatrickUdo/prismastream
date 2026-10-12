<script lang="ts" module>
	export interface PlayerToast {
		text: string;
		action?: { label: string; run: () => void };
	}
	export interface SidePanel {
		label: string;
		icon: IconName;
		content: Snippet<[close: () => void]>;
	}
</script>

<script lang="ts">
	import { flushSync, onMount, untrack, type Snippet } from 'svelte';
	import type { LangCode, StreamVariant } from '#lib/types.ts';
	import { i18n, t } from '#lib/i18n/index.svelte.ts';
	import { languageName } from '#lib/lang.ts';
	import { user } from '#lib/stores/user.svelte.ts';
	import { sourceName } from '#lib/sources/index.svelte.ts';
	import type { PlayerEngine } from './engine.svelte.ts';
	import Icon, { type IconName } from './Icon.svelte';
	import MenuPanel from './MenuPanel.svelte';
	import Scrubber from './Scrubber.svelte';
	import { formatTime, heightLabel } from './format.ts';
	import { keyAction } from './keys.ts';
	import { moveFocus, type Dir } from './spatial.ts';
	import { buildLanguageMenu, primaryLang } from './variants.ts';
	import { chooseSubtitleTrack } from './tracks.ts';
	import {
		enterFullscreen,
		enterPlaybackMode,
		exitFullscreen,
		fullscreenSupported,
		isFullscreen,
		onFullscreenChange,
		pipSupported,
		setMediaPosition,
		setMediaSession,
		togglePip,
		WakeLock,
		type MediaSessionInfo
	} from './platform.ts';

	interface Props {
		engine: PlayerEngine;
		heading: string;
		subheading?: string;
		live?: boolean;
		variants: StreamVariant[];
		current?: StreamVariant;
		/** Variants that failed in this session (marked in the menu). */
		failedIds?: ReadonlySet<string>;
		meta: MediaSessionInfo;
		onBack: () => void;
		onSelectVariant: (v: StreamVariant, lang: LangCode) => void;
		/** Explicit subtitle choice by the viewer (language, or null = off). */
		onSubtitleChoice?: (lang: LangCode | null) => void;
		onChannel?: (dir: 1 | -1) => void;
		onNext?: () => void;
		side?: SidePanel;
		/** Extra overlay content (next-episode card, live info). */
		extras?: Snippet<[{ visible: boolean }]>;
		toast?: PlayerToast | null;
	}

	let {
		engine,
		heading,
		subheading,
		live = false,
		variants,
		current,
		failedIds,
		meta,
		onBack,
		onSelectVariant,
		onSubtitleChoice,
		onChannel,
		onNext,
		side,
		extras,
		toast = null
	}: Props = $props();

	type Menu = 'lang' | 'subs' | 'quality' | 'speed' | 'side';
	const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
	const HIDE_MS = 3000;

	let root: HTMLDivElement | undefined = $state();
	let video: HTMLVideoElement | undefined = $state();
	let panelEl: HTMLElement | undefined = $state();
	let playBtn: HTMLButtonElement | undefined = $state();

	let visible = $state(true);
	let menu = $state<Menu | null>(null);
	let menuOpener: HTMLElement | null = null;
	let fs = $state(false);
	let scrubbing = $state(false);
	let overControls = false;
	let canPip = $state(false);
	let canFs = $state(false);
	let ripple = $state<{ side: 'left' | 'right'; amount: number; n: number } | null>(null);
	let hud = $state<{ kind: 'volume'; n: number } | null>(null);
	let lastSubLang: LangCode | null = null;

	let hideTimer: ReturnType<typeof setTimeout> | undefined;
	let rippleTimer: ReturnType<typeof setTimeout> | undefined;
	let hudTimer: ReturnType<typeof setTimeout> | undefined;
	let tapTimer: ReturnType<typeof setTimeout> | undefined;
	let lastTap = 0;
	let lastPointerType = 'mouse';

	const locale = $derived(i18n.locale);
	const failed = $derived(!!engine.error);
	const showSpinner = $derived(
		!failed && (engine.loading || (engine.buffering && !engine.paused)) && !engine.needsGesture
	);
	const keepVisible = $derived(
		(engine.paused && !engine.loading) || menu !== null || scrubbing || failed
	);
	const shown = $derived(visible || keepVisible);

	// ---- overlay visibility ------------------------------------------------

	function poke() {
		visible = true;
		clearTimeout(hideTimer);
		hideTimer = setTimeout(maybeHide, HIDE_MS);
	}

	function maybeHide() {
		if (keepVisible || overControls) {
			hideTimer = setTimeout(maybeHide, HIDE_MS);
			return;
		}
		hide();
	}

	function hide() {
		clearTimeout(hideTimer);
		visible = false;
		const a = document.activeElement as HTMLElement | null;
		if (a && root?.contains(a) && !panelEl?.contains(a)) a.blur();
	}

	$effect(() => {
		// Re-arm the hide timer whenever playback (re)starts.
		if (!engine.paused) poke();
	});

	/** Show the overlay (used by pages, e.g. after zapping). */
	export function reveal() {
		poke();
	}

	// ---- lifecycle -----------------------------------------------------------

	$effect(() => {
		if (!video) return;
		const detach = engine.attach(video);
		canPip = pipSupported(video);
		canFs = fullscreenSupported(video);
		const v = video;
		const onBegin = () => (fs = true);
		const onEnd = () => (fs = isFullscreen(v));
		v.addEventListener('webkitbeginfullscreen', onBegin);
		v.addEventListener('webkitendfullscreen', onEnd);
		return () => {
			v.removeEventListener('webkitbeginfullscreen', onBegin);
			v.removeEventListener('webkitendfullscreen', onEnd);
			detach();
		};
	});

	onMount(() => {
		poke();
		// Debug handle for development (window.__psEngine).
		if (import.meta.env.DEV) Object.assign(window, { __psEngine: engine });
		const offFs = onFullscreenChange(() => (fs = isFullscreen(video)));
		let restore: (() => Promise<void>) | null = null;
		let gone = false;
		void enterPlaybackMode().then((r) => {
			if (gone) void r();
			else restore = r;
		});
		return () => {
			gone = true;
			offFs();
			void restore?.();
			clearTimeout(hideTimer);
			clearTimeout(rippleTimer);
			clearTimeout(hudTimer);
			clearTimeout(tapTimer);
			if (isFullscreen(video)) void exitFullscreen(video);
		};
	});

	// Screen wake lock while playing.
	const wake = new WakeLock();
	$effect(() => {
		const playing = !engine.paused;
		void wake.set(playing);
		const onVis = () => {
			if (document.visibilityState === 'visible' && !engine.paused) void wake.set(true);
		};
		document.addEventListener('visibilitychange', onVis);
		return () => document.removeEventListener('visibilitychange', onVis);
	});
	$effect(() => () => void wake.set(false));

	// Media Session metadata and actions.
	$effect(() => {
		const info = { ...meta };
		const isLive = live;
		const next = onNext;
		const channel = onChannel;
		return setMediaSession(info, {
			play: () => engine.play(),
			pause: () => engine.pause(),
			seekBy: isLive ? undefined : (d) => engine.seekBy(d),
			seekTo: isLive ? undefined : (s) => engine.seek(s),
			next: isLive ? (channel ? () => channel(1) : undefined) : next,
			previous: isLive && channel ? () => channel(-1) : undefined
		});
	});
	$effect(() => {
		if ('mediaSession' in navigator)
			navigator.mediaSession.playbackState = engine.paused ? 'paused' : 'playing';
	});
	// Coarse Media Session position updates (every 5 s of media time, and on rate/duration changes).
	const positionBucket = $derived(Math.floor(engine.currentTime / 5));
	$effect(() => {
		void positionBucket;
		const duration = engine.duration;
		const rate = engine.rate;
		if (!live) untrack(() => setMediaPosition(engine.currentTime, duration, rate));
	});

	// ---- menus ---------------------------------------------------------------

	function openMenu(m: Menu, e?: Event) {
		if (menu === m) {
			closeMenu();
			return;
		}
		menuOpener = (e?.currentTarget as HTMLElement | null) ?? null;
		menu = m;
		poke();
		flushSync();
		const target =
			panelEl?.querySelector<HTMLElement>('[data-focusable][aria-checked="true"]') ??
			panelEl?.querySelector<HTMLElement>('[data-focusable][aria-current="true"]') ??
			panelEl?.querySelector<HTMLElement>('.body [data-focusable]') ??
			panelEl?.querySelector<HTMLElement>('[data-focusable]');
		target?.focus({ preventScroll: false });
		target?.scrollIntoView({ block: 'nearest' });
	}

	function closeMenu() {
		menu = null;
		const opener = menuOpener;
		menuOpener = null;
		poke();
		flushSync();
		opener?.focus();
	}

	const currentAudioLang = $derived.by(() => {
		const tr = engine.audioTracks.find((x) => x.id === engine.audioTrack);
		return tr && tr.lang !== 'und' ? tr.lang : primaryLang(current);
	});

	const langGroups = $derived(
		buildLanguageMenu({
			variants,
			currentId: current?.id,
			inStreamAudio: engine.audioTracks,
			activeTrackId: engine.audioTrack,
			currentLang: currentAudioLang,
			preferred: user.active?.audioLangs ?? [],
			locale,
			sourceName
		})
	);

	const hasLangMenu = $derived(variants.length > 1 || engine.audioTracks.length > 1);

	function qualityName(q: StreamVariant['quality']) {
		return t(`player.q.${q}`);
	}

	type LangItem = (typeof langGroups)[number]['items'][number];

	function itemDetail(item: LangItem, isFailed: boolean): string {
		const parts: string[] = [];
		if (item.kind === 'track') parts.push(t('player.inStream'), qualityName(item.variant.quality));
		parts.push(item.sourceName);
		if (item.variant.subtitleLangs.length)
			parts.push(
				t('player.subsIncluded', {
					langs: item.variant.subtitleLangs.map((l) => l.toUpperCase()).join(', ')
				})
			);
		if (isFailed) parts.push(t('player.failed'));
		return parts.join(' · ');
	}

	function selectLangItem(item: LangItem) {
		if (item.kind === 'track' && item.trackId !== undefined) {
			engine.setAudioTrack(item.trackId);
		} else if (item.variant.id !== current?.id) {
			onSelectVariant(item.variant, item.lang);
		} else if (engine.audioTracks.length > 1) {
			const tr = engine.audioTracks.find((x) => x.lang === item.lang);
			if (tr) engine.setAudioTrack(tr.id);
		}
		closeMenu();
	}

	function selectSubtitle(id: number) {
		engine.setSubtitleTrack(id);
		const lang = id >= 0 ? (engine.subtitleTracks.find((x) => x.id === id)?.lang ?? null) : null;
		if (lang) lastSubLang = lang;
		onSubtitleChoice?.(lang);
		closeMenu();
	}

	function toggleSubtitles() {
		if (!engine.subtitleTracks.length) return;
		if (engine.subtitleTrack >= 0) {
			engine.setSubtitleTrack(-1);
			onSubtitleChoice?.(null);
			return;
		}
		const p = user.active;
		const id = chooseSubtitleTrack(
			engine.subtitleTracks,
			{
				subtitlesOn: true,
				subtitleLangs: lastSubLang
					? [lastSubLang, ...(p?.subtitleLangs ?? [])]
					: (p?.subtitleLangs ?? []),
				audioLangs: p?.audioLangs ?? [],
				uiLang: locale
			},
			currentAudioLang
		);
		const pick = id >= 0 ? id : engine.subtitleTracks[0].id;
		engine.setSubtitleTrack(pick);
		const lang = engine.subtitleTracks.find((x) => x.id === pick)?.lang ?? null;
		onSubtitleChoice?.(lang);
	}

	const playingLevelLabel = $derived.by(() => {
		const l = engine.levels.find((x) => x.index === engine.playingLevel);
		return l ? heightLabel(l.height) : '';
	});

	const qualityButtonLabel = $derived(
		engine.selectedLevel >= 0
			? heightLabel(engine.levels.find((x) => x.index === engine.selectedLevel)?.height ?? 0)
			: playingLevelLabel
	);

	// ---- actions -------------------------------------------------------------

	async function toggleFs() {
		if (!root || !video) return;
		if (isFullscreen(video)) await exitFullscreen(video);
		else await enterFullscreen(root, video);
		fs = isFullscreen(video);
	}

	function showRipple(sideName: 'left' | 'right', amount: number) {
		const same = ripple && ripple.side === sideName;
		ripple = {
			side: sideName,
			amount: same ? ripple!.amount + amount : amount,
			n: (ripple?.n ?? 0) + 1
		};
		clearTimeout(rippleTimer);
		rippleTimer = setTimeout(() => (ripple = null), 650);
	}

	function seekBy(delta: number) {
		if (live) return;
		engine.seekBy(delta);
		showRipple(delta < 0 ? 'left' : 'right', Math.abs(delta));
	}

	function changeVolume(delta: number) {
		const v = engine.muted ? 0 : engine.volume;
		engine.setVolume(Math.round((v + delta) * 20) / 20);
		if (delta > 0) engine.setMuted(false);
		hud = { kind: 'volume', n: (hud?.n ?? 0) + 1 };
		clearTimeout(hudTimer);
		hudTimer = setTimeout(() => (hud = null), 900);
	}

	// ---- pointer & touch -----------------------------------------------------

	function onRootPointerMove(e: PointerEvent) {
		if (e.pointerType === 'mouse') poke();
	}

	function onGestureDown(e: PointerEvent) {
		lastPointerType = e.pointerType;
	}

	function onGestureUp(e: PointerEvent) {
		if (e.pointerType === 'mouse' || !root) return;
		if (menu) {
			closeMenu();
			return;
		}
		const now = performance.now();
		const r = root.getBoundingClientRect();
		const x = (e.clientX - r.left) / r.width;
		if (now - lastTap < 320 && !live && (x < 0.4 || x > 0.6)) {
			clearTimeout(tapTimer);
			lastTap = now;
			seekBy(x < 0.4 ? -10 : 10);
			return;
		}
		lastTap = now;
		clearTimeout(tapTimer);
		tapTimer = setTimeout(() => (shown && !keepVisible ? hide() : poke()), 260);
	}

	function onGestureClick() {
		if (lastPointerType !== 'mouse') return;
		if (menu) {
			closeMenu();
			return;
		}
		engine.toggle();
		poke();
	}

	// ---- keyboard & remote ---------------------------------------------------

	const ARROWS: Record<string, Dir> = {
		ArrowLeft: 'left',
		ArrowRight: 'right',
		ArrowUp: 'up',
		ArrowDown: 'down'
	};

	function onKeydown(e: KeyboardEvent) {
		if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || !root) return;
		const active = document.activeElement as HTMLElement | null;
		const inField =
			!!active &&
			(active.tagName === 'TEXTAREA' ||
				active.isContentEditable ||
				(active.tagName === 'INPUT' && (active as HTMLInputElement).type !== 'range'));
		if (inField && e.key !== 'Escape') return;

		poke();
		flushSync();

		const action = keyAction(e.key, live);
		const control =
			active &&
			active !== document.body &&
			root.contains(active) &&
			active.matches('[data-focusable]')
				? active
				: null;
		const horizontalWidget =
			!!control &&
			(control.hasAttribute('data-scrubber') || (control as HTMLInputElement).type === 'range');
		const dir = ARROWS[e.key];

		if (action === 'back') {
			e.preventDefault();
			if (menu) closeMenu();
			else onBack();
			return;
		}

		if (dir && menu && panelEl) {
			e.preventDefault();
			if (!control || !panelEl.contains(control)) {
				panelEl.querySelector<HTMLElement>('[data-focusable]')?.focus();
			} else moveFocus(panelEl, dir);
			return;
		}

		if (dir && control && !(horizontalWidget && (dir === 'left' || dir === 'right'))) {
			e.preventDefault();
			moveFocus(root, dir);
			return;
		}

		if ((e.key === 'Enter' || e.key === ' ') && control && !control.hasAttribute('data-scrubber'))
			return; // native activation of the focused control

		if (!action) return;
		if (horizontalWidget && (dir === 'left' || dir === 'right') && control?.tagName === 'INPUT')
			return; // let the range input handle it

		e.preventDefault();
		switch (action) {
			case 'toggle':
				engine.toggle();
				if (e.key === 'Enter' && !control) playBtn?.focus();
				break;
			case 'play':
				engine.play();
				break;
			case 'pause':
				engine.pause();
				break;
			case 'back10':
				seekBy(-10);
				break;
			case 'fwd10':
				seekBy(10);
				break;
			case 'volumeUp':
				changeVolume(0.1);
				break;
			case 'volumeDown':
				changeVolume(-0.1);
				break;
			case 'channelUp':
				onChannel?.(1);
				break;
			case 'channelDown':
				onChannel?.(-1);
				break;
			case 'fullscreen':
				void toggleFs();
				break;
			case 'mute':
				engine.setMuted(!engine.muted);
				break;
			case 'subtitles':
				toggleSubtitles();
				break;
		}
	}

	const errorText = $derived(engine.error ? t(`player.error.${engine.error.kind}`) : '');
	const volumeIcon = $derived<IconName>(
		engine.muted || engine.volume === 0 ? 'mute' : engine.volume < 0.5 ? 'volumeLow' : 'volume'
	);
</script>

<svelte:window onkeydown={onKeydown} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="player"
	class:idle={!shown}
	bind:this={root}
	onpointermove={onRootPointerMove}
	style:--hud-volume={engine.muted ? 0 : engine.volume}
>
	<video bind:this={video} playsinline preload="auto"></video>

	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div
		class="gesture"
		onpointerdown={onGestureDown}
		onpointerup={onGestureUp}
		onclick={onGestureClick}
		ondblclick={() => lastPointerType === 'mouse' && toggleFs()}
	></div>

	{#if showSpinner}
		<div class="spinner" role="status" aria-label={t('player.loading')}><span></span></div>
	{/if}

	{#if ripple}
		{#key ripple.n}
			<div class="ripple {ripple.side}" aria-hidden="true">
				<Icon name={ripple.side === 'left' ? 'back10' : 'fwd10'} size={34} />
				<span>{ripple.side === 'left' ? '−' : '+'}{ripple.amount} s</span>
			</div>
		{/key}
	{/if}

	{#if hud}
		<div class="hud" aria-hidden="true">
			<Icon name={volumeIcon} size={22} />
			<div class="hud-bar"><div></div></div>
		</div>
	{/if}

	{#if engine.needsGesture && !failed}
		<button
			type="button"
			class="big-play"
			data-focusable
			aria-label={t('player.play')}
			onclick={() => engine.play()}
		>
			<Icon name="play" size={44} />
			<span>{t('player.tapToPlay')}</span>
		</button>
	{/if}

	<div class="overlay" class:shown inert={!shown}>
		<div class="scrim top"></div>
		<div class="scrim bottom"></div>

		<header class="topbar">
			<button
				type="button"
				class="icon-btn"
				data-focusable
				aria-label={t('player.back')}
				onclick={onBack}
			>
				<Icon name="back" size={30} />
			</button>
			<div class="heading">
				<h1>{heading}</h1>
				{#if subheading}<p>{subheading}</p>{/if}
			</div>
			{#if live}
				<span class="live-badge"><i></i>{t('player.live')}</span>
			{/if}
		</header>

		{#if !failed && !engine.needsGesture}
			<div class="center">
				{#if !live}
					<button
						type="button"
						class="icon-btn mid"
						data-focusable
						aria-label={t('player.back10')}
						onclick={() => seekBy(-10)}
					>
						<Icon name="back10" size={40} />
					</button>
				{/if}
				<button
					type="button"
					class="icon-btn mid main"
					data-focusable
					aria-label={engine.paused ? t('player.play') : t('player.pause')}
					onclick={() => engine.toggle()}
				>
					<Icon name={engine.paused ? 'play' : 'pause'} size={46} />
				</button>
				{#if !live}
					<button
						type="button"
						class="icon-btn mid"
						data-focusable
						aria-label={t('player.fwd10')}
						onclick={() => seekBy(10)}
					>
						<Icon name="fwd10" size={40} />
					</button>
				{/if}
			</div>
		{/if}

		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="bottom"
			onpointerenter={(e) => e.pointerType === 'mouse' && (overControls = true)}
			onpointerleave={() => (overControls = false)}
		>
			{#if live}
				<div class="live-row">
					<span class="live-badge big"><i></i>{t('player.live')}</span>
					{#if engine.liveLatency > 20}
						<button type="button" class="chip" data-focusable onclick={() => engine.goLive()}>
							{t('player.goLive')}
						</button>
					{/if}
				</div>
			{:else}
				<div class="time-row">
					<Scrubber
						current={engine.currentTime}
						duration={engine.duration}
						buffered={engine.bufferedEnd}
						onSeek={(s) => engine.seek(s)}
						onScrubbing={(a) => (scrubbing = a)}
					/>
					<span class="time"
						>{formatTime(engine.currentTime)}<span class="sep">/</span>{formatTime(
							engine.duration
						)}</span
					>
				</div>
			{/if}

			<div class="controls">
				<div class="group">
					<button
						type="button"
						class="icon-btn desk"
						data-focusable
						bind:this={playBtn}
						aria-label={engine.paused ? t('player.play') : t('player.pause')}
						onclick={() => engine.toggle()}
					>
						<Icon name={engine.paused ? 'play' : 'pause'} size={30} />
					</button>
					{#if !live}
						<button
							type="button"
							class="icon-btn desk"
							data-focusable
							aria-label={t('player.back10')}
							onclick={() => seekBy(-10)}
						>
							<Icon name="back10" size={30} />
						</button>
						<button
							type="button"
							class="icon-btn desk"
							data-focusable
							aria-label={t('player.fwd10')}
							onclick={() => seekBy(10)}
						>
							<Icon name="fwd10" size={30} />
						</button>
					{/if}
					{#if live && onChannel}
						<button
							type="button"
							class="icon-btn"
							data-focusable
							aria-label={t('player.channelDown')}
							onclick={() => onChannel(-1)}
						>
							<Icon name="down" size={28} />
						</button>
						<button
							type="button"
							class="icon-btn"
							data-focusable
							aria-label={t('player.channelUp')}
							onclick={() => onChannel(1)}
						>
							<Icon name="up" size={28} />
						</button>
					{/if}
					<div class="volume">
						<button
							type="button"
							class="icon-btn"
							data-focusable
							aria-label={engine.muted ? t('player.unmute') : t('player.mute')}
							onclick={() => engine.setMuted(!engine.muted)}
						>
							<Icon name={volumeIcon} size={28} />
						</button>
						<input
							type="range"
							min="0"
							max="1"
							step="0.05"
							data-focusable
							aria-label={t('player.volume')}
							value={engine.muted ? 0 : engine.volume}
							oninput={(e) => engine.setVolume(Number(e.currentTarget.value))}
							style:--v={engine.muted ? 0 : engine.volume}
						/>
					</div>
				</div>

				<div class="group right">
					{#if side}
						<button
							type="button"
							class="icon-btn labelled"
							class:on={menu === 'side'}
							data-focusable
							aria-expanded={menu === 'side'}
							onclick={(e) => openMenu('side', e)}
						>
							<Icon name={side.icon} size={26} /><span>{side.label}</span>
						</button>
					{/if}
					{#if hasLangMenu}
						<button
							type="button"
							class="icon-btn labelled"
							class:on={menu === 'lang'}
							data-focusable
							aria-expanded={menu === 'lang'}
							onclick={(e) => openMenu('lang', e)}
						>
							<Icon name="language" size={26} /><span>{t('player.langSource')}</span>
						</button>
					{/if}
					<button
						type="button"
						class="icon-btn"
						class:on={menu === 'subs' || engine.subtitleTrack >= 0}
						data-focusable
						aria-label={t('player.subtitles')}
						aria-expanded={menu === 'subs'}
						onclick={(e) => openMenu('subs', e)}
					>
						<Icon name="subtitles" size={28} />
					</button>
					<button
						type="button"
						class="icon-btn"
						class:on={menu === 'quality'}
						data-focusable
						aria-label={t('player.quality')}
						aria-expanded={menu === 'quality'}
						onclick={(e) => openMenu('quality', e)}
					>
						<Icon name="quality" size={28} />
						{#if qualityButtonLabel}<span class="tag">{qualityButtonLabel}</span>{/if}
					</button>
					{#if !live}
						<button
							type="button"
							class="icon-btn"
							class:on={menu === 'speed'}
							data-focusable
							aria-label={t('player.speed')}
							aria-expanded={menu === 'speed'}
							onclick={(e) => openMenu('speed', e)}
						>
							<Icon name="speed" size={28} />
							{#if engine.rate !== 1}<span class="tag">{engine.rate}×</span>{/if}
						</button>
					{/if}
					{#if canPip}
						<button
							type="button"
							class="icon-btn"
							class:on={engine.pip}
							data-focusable
							aria-label={engine.pip ? t('player.exitPip') : t('player.pip')}
							onclick={() => video && togglePip(video)}
						>
							<Icon name="pip" size={28} />
						</button>
					{/if}
					{#if canFs}
						<button
							type="button"
							class="icon-btn"
							data-focusable
							aria-label={fs ? t('player.exitFullscreen') : t('player.fullscreen')}
							onclick={toggleFs}
						>
							<Icon name={fs ? 'exitFullscreen' : 'fullscreen'} size={28} />
						</button>
					{/if}
				</div>
			</div>
		</div>
	</div>

	{#if extras}
		{@render extras({ visible: shown })}
	{/if}

	{#if toast}
		<div class="toast" class:raised={shown} role="status">
			<span>{toast.text}</span>
			{#if toast.action}
				{@const act = toast.action}
				<button type="button" data-focusable onclick={() => act.run()}>{act.label}</button>
			{/if}
		</div>
	{/if}

	{#if menu === 'lang'}
		<MenuPanel title={t('player.langSource')} onClose={closeMenu} bind:el={panelEl}>
			{#each langGroups as group (group.lang)}
				<section class="group-block">
					<h3>{group.label}</h3>
					<div role="radiogroup" aria-label={group.label}>
						{#each group.items as item (item.key)}
							{@const isFailed = item.kind === 'variant' && failedIds?.has(item.variant.id)}
							<button
								type="button"
								role="radio"
								class="option"
								class:failed={isFailed}
								aria-checked={item.active}
								data-focusable
								title={item.variant.label}
								onclick={() => selectLangItem(item)}
							>
								<span class="option-main">
									<span class="option-title">
										{#if item.kind === 'track'}
											{item.trackName || languageName(item.lang, locale)}
										{:else}
											{qualityName(item.variant.quality)}
										{/if}
									</span>
									<span class="option-sub">{itemDetail(item, !!isFailed)}</span>
								</span>
								{#if item.active}<Icon name="check" size={22} />{/if}
							</button>
						{/each}
					</div>
				</section>
			{/each}
		</MenuPanel>
	{:else if menu === 'subs'}
		<MenuPanel title={t('player.subtitles')} onClose={closeMenu} bind:el={panelEl}>
			<div role="radiogroup" aria-label={t('player.subtitles')}>
				<button
					type="button"
					role="radio"
					class="option"
					aria-checked={engine.subtitleTrack < 0}
					data-focusable
					onclick={() => selectSubtitle(-1)}
				>
					<span class="option-title">{t('player.off')}</span>
					{#if engine.subtitleTrack < 0}<Icon name="check" size={22} />{/if}
				</button>
				{#each engine.subtitleTracks as tr, i (tr.id)}
					{@const label =
						tr.lang !== 'und'
							? languageName(tr.lang, locale)
							: tr.name || t('player.subtitleTrack', { n: i + 1 })}
					<button
						type="button"
						role="radio"
						class="option"
						aria-checked={engine.subtitleTrack === tr.id}
						data-focusable
						onclick={() => selectSubtitle(tr.id)}
					>
						<span class="option-main">
							<span class="option-title">{label}</span>
							{#if tr.name && tr.name !== label}<span class="option-sub">{tr.name}</span>{/if}
						</span>
						{#if engine.subtitleTrack === tr.id}<Icon name="check" size={22} />{/if}
					</button>
				{/each}
			</div>
			{#if !engine.subtitleTracks.length}
				<p class="note">{t('player.noSubtitles')}</p>
			{/if}
		</MenuPanel>
	{:else if menu === 'quality'}
		<MenuPanel title={t('player.quality')} onClose={closeMenu} bind:el={panelEl}>
			<div role="radiogroup" aria-label={t('player.quality')}>
				<button
					type="button"
					role="radio"
					class="option"
					aria-checked={engine.selectedLevel < 0}
					data-focusable
					onclick={() => {
						engine.setLevel(-1);
						closeMenu();
					}}
				>
					<span class="option-title">
						{playingLevelLabel ? t('player.autoWith', { q: playingLevelLabel }) : t('player.auto')}
					</span>
					{#if engine.selectedLevel < 0}<Icon name="check" size={22} />{/if}
				</button>
				{#each engine.levels as lvl (lvl.index)}
					<button
						type="button"
						role="radio"
						class="option"
						aria-checked={engine.selectedLevel === lvl.index}
						data-focusable
						onclick={() => {
							engine.setLevel(lvl.index);
							closeMenu();
						}}
					>
						<span class="option-main">
							<span class="option-title"
								>{heightLabel(lvl.height) || `${Math.round(lvl.bitrate / 1000)} kbps`}</span
							>
							<span class="option-sub">{(lvl.bitrate / 1_000_000).toFixed(1)} Mbit/s</span>
						</span>
						{#if engine.selectedLevel === lvl.index}<Icon name="check" size={22} />{/if}
					</button>
				{/each}
			</div>
			{#if !engine.qualitySelectable}
				<p class="note">{t('player.qualityNative')}</p>
			{/if}
		</MenuPanel>
	{:else if menu === 'speed'}
		<MenuPanel title={t('player.speed')} onClose={closeMenu} bind:el={panelEl}>
			<div role="radiogroup" aria-label={t('player.speed')}>
				{#each SPEEDS as s (s)}
					<button
						type="button"
						role="radio"
						class="option"
						aria-checked={engine.rate === s}
						data-focusable
						onclick={() => {
							engine.setRate(s);
							closeMenu();
						}}
					>
						<span class="option-title">
							{s === 1 ? t('player.normal') : t('player.speedValue', { n: s })}
						</span>
						{#if engine.rate === s}<Icon name="check" size={22} />{/if}
					</button>
				{/each}
			</div>
		</MenuPanel>
	{:else if menu === 'side' && side}
		<MenuPanel title={side.label} wide onClose={closeMenu} bind:el={panelEl}>
			{@render side.content(closeMenu)}
		</MenuPanel>
	{/if}

	{#if failed}
		<div class="error" role="alert">
			<div class="error-card">
				<Icon name="alert" size={40} />
				<h2>{t('player.error.title')}</h2>
				<p>{errorText}</p>
				<div class="error-actions">
					<button type="button" class="btn primary" data-focusable onclick={() => engine.retry()}>
						<Icon name="retry" size={20} />{t('player.retry')}
					</button>
					{#if variants.length > 1}
						<button type="button" class="btn" data-focusable onclick={(e) => openMenu('lang', e)}>
							{t('player.otherSource')}
						</button>
					{/if}
					<button type="button" class="btn ghost" data-focusable onclick={onBack}>
						{t('player.back')}
					</button>
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	.player {
		position: fixed;
		inset: 0;
		background: var(--bg);
		color: var(--text);
		overflow: hidden;
		user-select: none;
		-webkit-user-select: none;
		touch-action: manipulation;
		--pad-x: max(var(--gutter), env(safe-area-inset-left, 0px), env(safe-area-inset-right, 0px));
	}
	.player.idle {
		cursor: none;
	}
	video {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: contain;
		background: var(--bg);
	}
	video::cue {
		font-family: var(--font);
		font-size: clamp(18px, 3.4vmin, 40px);
		font-weight: 600;
		color: var(--text);
		background: color-mix(in oklab, var(--bg) 55%, transparent);
		line-height: 1.3;
	}
	/* Lift subtitles above the controls while the overlay is visible (WebKit/Blink). */
	video::-webkit-media-text-track-container {
		transition: transform var(--dur) var(--ease-out);
	}
	.player:not(.idle) video::-webkit-media-text-track-container {
		transform: translateY(calc(-1 * (var(--safe-bottom) + 96px)));
	}
	.gesture {
		position: absolute;
		inset: 0;
		z-index: 1;
	}

	/* ---- overlay ---- */
	.overlay {
		position: absolute;
		inset: 0;
		z-index: 10;
		pointer-events: none;
		opacity: 0;
		transition: opacity var(--dur) var(--ease-out);
	}
	.overlay.shown {
		opacity: 1;
	}
	.overlay.shown .topbar,
	.overlay.shown .bottom,
	.overlay.shown .center {
		pointer-events: auto;
	}
	.scrim {
		position: absolute;
		left: 0;
		right: 0;
		pointer-events: none;
	}
	.scrim.top {
		top: 0;
		height: 180px;
		background: linear-gradient(
			to bottom,
			color-mix(in oklab, var(--bg) 72%, transparent),
			transparent
		);
	}
	.scrim.bottom {
		bottom: 0;
		height: 260px;
		background: linear-gradient(
			to top,
			color-mix(in oklab, var(--bg) 82%, transparent),
			color-mix(in oklab, var(--bg) 35%, transparent) 55%,
			transparent
		);
	}
	.topbar {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		display: flex;
		align-items: center;
		gap: 14px;
		padding: calc(var(--safe-top) + 18px) var(--pad-x) 0;
		transform: translateY(-8px);
		transition: transform var(--dur) var(--ease-out);
	}
	.overlay.shown .topbar,
	.overlay.shown .bottom {
		transform: none;
	}
	.heading {
		min-width: 0;
		flex: 1;
	}
	.heading h1 {
		margin: 0;
		font-size: clamp(18px, 2.2vw, 26px);
		font-weight: 750;
		letter-spacing: -0.01em;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		text-shadow: 0 1px 12px color-mix(in oklab, var(--bg) 50%, transparent);
	}
	.heading p {
		margin: 2px 0 0;
		font-size: clamp(13px, 1.4vw, 16px);
		color: var(--text-2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.live-badge {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		padding: 5px 11px;
		border-radius: var(--radius-pill);
		background: var(--live);
		color: var(--text);
		font-size: 12px;
		font-weight: 800;
		letter-spacing: 0.1em;
	}
	.live-badge i {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: currentColor;
		animation: pulse 1.6s ease-in-out infinite;
	}
	.live-badge.big {
		font-size: 13px;
	}
	@keyframes pulse {
		50% {
			opacity: 0.35;
		}
	}

	.center {
		position: absolute;
		left: 50%;
		top: 50%;
		transform: translate(-50%, -50%);
		display: none;
		align-items: center;
		gap: clamp(24px, 8vw, 72px);
	}
	.icon-btn.mid {
		width: 64px;
		height: 64px;
		background: color-mix(in oklab, var(--bg) 28%, transparent);
		backdrop-filter: blur(10px);
		-webkit-backdrop-filter: blur(10px);
	}
	.icon-btn.mid.main {
		width: 84px;
		height: 84px;
	}

	.bottom {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		padding: 0 var(--pad-x) calc(var(--safe-bottom) + 14px);
		transform: translateY(8px);
		transition: transform var(--dur) var(--ease-out);
	}
	.time-row {
		display: flex;
		align-items: center;
		gap: 16px;
	}
	.time-row :global(.scrubber) {
		flex: 1;
	}
	.time {
		font-size: 14px;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		color: var(--text-2);
		white-space: nowrap;
	}
	.time .sep {
		margin: 0 5px;
		color: var(--text-3);
	}
	.live-row {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px 0 6px;
	}
	.controls {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}
	.group {
		display: flex;
		align-items: center;
		gap: 4px;
		min-width: 0;
	}
	.group.right {
		justify-content: flex-end;
		flex-wrap: wrap;
	}

	.icon-btn {
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		min-width: 48px;
		height: 48px;
		padding: 0 10px;
		border: 0;
		border-radius: var(--radius-pill);
		background: transparent;
		color: var(--text);
		cursor: pointer;
		transition:
			background var(--dur-fast) var(--ease-out),
			transform var(--dur-fast) var(--ease-out),
			color var(--dur-fast);
	}
	.icon-btn:hover {
		background: color-mix(in oklab, var(--text) 12%, transparent);
	}
	.icon-btn:active {
		transform: scale(0.94);
	}
	.icon-btn:focus-visible {
		background: color-mix(in oklab, var(--text) 16%, transparent);
	}
	.icon-btn.on {
		color: var(--accent);
	}
	.icon-btn.labelled span {
		font-size: 14px;
		font-weight: 650;
	}
	.icon-btn .tag {
		position: absolute;
		top: 2px;
		right: 0;
		padding: 1px 5px;
		border-radius: 6px;
		background: var(--accent);
		color: var(--accent-contrast);
		font-size: 10px;
		font-weight: 800;
		line-height: 1.4;
	}

	.volume {
		display: flex;
		align-items: center;
	}
	.volume input {
		width: 88px;
		margin: 0 8px 0 2px;
		height: 28px;
		appearance: none;
		-webkit-appearance: none;
		background: transparent;
		cursor: pointer;
		opacity: 0.55;
		transform: scaleX(0.92);
		transform-origin: left center;
		transition:
			opacity var(--dur) var(--ease-out),
			transform var(--dur) var(--ease-out);
	}
	.volume:hover input,
	.volume:focus-within input {
		opacity: 1;
		transform: none;
	}
	.volume input::-webkit-slider-runnable-track {
		height: 4px;
		border-radius: var(--radius-pill);
		background: linear-gradient(
			to right,
			var(--text) calc(var(--v) * 100%),
			var(--line-strong) calc(var(--v) * 100%)
		);
	}
	.volume input::-moz-range-track {
		height: 4px;
		border-radius: var(--radius-pill);
		background: linear-gradient(
			to right,
			var(--text) calc(var(--v) * 100%),
			var(--line-strong) calc(var(--v) * 100%)
		);
	}
	.volume input::-webkit-slider-thumb {
		-webkit-appearance: none;
		width: 14px;
		height: 14px;
		margin-top: -5px;
		border-radius: 50%;
		background: var(--text);
		border: 0;
	}
	.volume input::-moz-range-thumb {
		width: 14px;
		height: 14px;
		border-radius: 50%;
		background: var(--text);
		border: 0;
	}
	.volume input:focus-visible {
		box-shadow: none;
		outline: 2px solid var(--accent);
		outline-offset: 4px;
		border-radius: var(--radius-s);
	}

	.chip {
		padding: 7px 14px;
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-pill);
		background: color-mix(in oklab, var(--text) 10%, transparent);
		font-size: 13px;
		font-weight: 700;
		cursor: pointer;
	}

	/* ---- feedback ---- */
	.spinner {
		position: absolute;
		left: 50%;
		top: 50%;
		z-index: 5;
		transform: translate(-50%, -50%);
		pointer-events: none;
	}
	.spinner span {
		display: block;
		width: 64px;
		height: 64px;
		border-radius: 50%;
		border: 4px solid color-mix(in oklab, var(--text) 16%, transparent);
		border-top-color: var(--accent);
		animation: spin 0.9s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	.ripple {
		position: absolute;
		top: 50%;
		z-index: 6;
		display: grid;
		justify-items: center;
		gap: 4px;
		padding: 22px 26px;
		border-radius: 50%;
		background: color-mix(in oklab, var(--text) 12%, transparent);
		backdrop-filter: blur(6px);
		-webkit-backdrop-filter: blur(6px);
		font-weight: 700;
		font-size: 14px;
		pointer-events: none;
		animation: ripple 650ms var(--ease-out) forwards;
	}
	.ripple.left {
		left: 14%;
	}
	.ripple.right {
		right: 14%;
	}
	@keyframes ripple {
		from {
			opacity: 0;
			transform: translateY(-50%) scale(0.8);
		}
		25% {
			opacity: 1;
			transform: translateY(-50%) scale(1);
		}
		to {
			opacity: 0;
			transform: translateY(-50%) scale(1.05);
		}
	}
	.hud {
		position: absolute;
		top: calc(var(--safe-top) + 24px);
		left: 50%;
		z-index: 20;
		transform: translateX(-50%);
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px 16px;
		border-radius: var(--radius-pill);
		background: color-mix(in oklab, var(--bg-elev-2) 80%, transparent);
		backdrop-filter: blur(20px);
		-webkit-backdrop-filter: blur(20px);
		pointer-events: none;
	}
	.hud-bar {
		width: 120px;
		height: 4px;
		border-radius: var(--radius-pill);
		background: var(--line-strong);
		overflow: hidden;
	}
	.hud-bar div {
		height: 100%;
		width: calc(var(--hud-volume) * 100%);
		background: var(--accent);
	}
	.big-play {
		position: absolute;
		left: 50%;
		top: 50%;
		z-index: 12;
		transform: translate(-50%, -50%);
		display: grid;
		justify-items: center;
		gap: 12px;
		padding: 28px 36px;
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-l);
		background: color-mix(in oklab, var(--bg-elev-2) 70%, transparent);
		backdrop-filter: blur(24px);
		-webkit-backdrop-filter: blur(24px);
		font-weight: 700;
		cursor: pointer;
	}
	.toast {
		position: absolute;
		left: var(--pad-x);
		bottom: calc(var(--safe-bottom) + 40px);
		z-index: 15;
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 8px 8px 8px 18px;
		border-radius: var(--radius-pill);
		background: color-mix(in oklab, var(--bg-elev-2) 80%, transparent);
		border: 1px solid var(--line);
		backdrop-filter: blur(24px);
		-webkit-backdrop-filter: blur(24px);
		font-size: 14px;
		font-weight: 600;
		transition: transform var(--dur) var(--ease-out);
		animation: toast-in var(--dur) var(--ease-out);
	}
	.toast.raised {
		transform: translateY(-100px);
	}
	.toast button {
		padding: 8px 14px;
		border: 0;
		border-radius: var(--radius-pill);
		background: color-mix(in oklab, var(--text) 12%, transparent);
		font-weight: 700;
		font-size: 13px;
		cursor: pointer;
	}
	.toast button:hover {
		background: color-mix(in oklab, var(--text) 20%, transparent);
	}
	@keyframes toast-in {
		from {
			opacity: 0;
			transform: translateY(10px);
		}
	}

	/* ---- menus ---- */
	.group-block + .group-block {
		margin-top: 6px;
	}
	.group-block h3 {
		margin: 10px 14px 6px;
		font-size: 12px;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-3);
	}
	.option {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		width: 100%;
		min-height: 52px;
		padding: 10px 14px;
		border: 0;
		border-radius: var(--radius-m);
		background: transparent;
		text-align: left;
		cursor: pointer;
		transition: background var(--dur-fast);
	}
	.option:hover,
	.option:focus-visible {
		background: color-mix(in oklab, var(--text) 8%, transparent);
	}
	.option[aria-checked='true'] {
		background: var(--accent-soft);
	}
	.option[aria-checked='true'] :global(svg) {
		color: var(--accent);
	}
	.option.failed {
		opacity: 0.55;
	}
	.option-main {
		display: grid;
		gap: 2px;
		min-width: 0;
	}
	.option-title {
		font-size: 15px;
		font-weight: 650;
	}
	.option-sub {
		font-size: 13px;
		color: var(--text-2);
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.note {
		margin: 8px 14px;
		font-size: 13px;
		color: var(--text-3);
	}

	/* ---- error ---- */
	.error {
		position: absolute;
		inset: 0;
		z-index: 25;
		display: grid;
		place-items: center;
		padding: var(--pad-x);
		background: color-mix(in oklab, var(--bg) 60%, transparent);
	}
	.error-card {
		display: grid;
		justify-items: center;
		gap: 10px;
		max-width: 460px;
		padding: 32px 28px;
		text-align: center;
		border-radius: var(--radius-l);
		background: color-mix(in oklab, var(--bg-elev-2) 85%, transparent);
		border: 1px solid var(--line-strong);
		backdrop-filter: blur(28px);
		-webkit-backdrop-filter: blur(28px);
	}
	.error-card :global(svg) {
		color: var(--danger);
	}
	.error-card h2 {
		margin: 4px 0 0;
		font-size: 20px;
	}
	.error-card p {
		margin: 0 0 8px;
		color: var(--text-2);
		line-height: 1.5;
	}
	.error-actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 10px;
	}
	.btn {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		min-height: 46px;
		padding: 0 20px;
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-pill);
		background: color-mix(in oklab, var(--text) 8%, transparent);
		font-weight: 700;
		cursor: pointer;
	}
	.btn.primary {
		background: var(--accent);
		border-color: transparent;
		color: var(--accent-contrast);
	}
	.btn.ghost {
		border-color: transparent;
		background: transparent;
		color: var(--text-2);
	}

	/* ---- touch devices: big centre controls, compact bar ---- */
	@media (pointer: coarse) {
		.center {
			display: flex;
		}
		.icon-btn.desk {
			display: none;
		}
		.volume input {
			display: none;
		}
	}
	@media (max-width: 760px) {
		.icon-btn.labelled span {
			display: none;
		}
		.icon-btn {
			min-width: 44px;
			height: 44px;
			padding: 0 8px;
		}
	}
</style>
