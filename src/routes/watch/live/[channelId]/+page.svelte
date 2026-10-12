<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { page } from '$app/state';
	import { afterNavigate } from '$app/navigation';
	import type { Channel, LangCode, StreamVariant } from '#lib/types.ts';
	import { i18n, t } from '#lib/i18n/index.svelte.ts';
	import { library } from '#lib/catalog/library.svelte.ts';
	import { playableVariant } from '#lib/player/play-url.ts';
	import { user } from '#lib/stores/user.svelte.ts';
	import { kids } from '#lib/stores/kids.svelte.ts';
	import { PlayerEngine } from '#lib/player/engine.svelte.ts';
	import Player from '#lib/player/Player.svelte';
	import ChannelsPanel from '#lib/player/ChannelsPanel.svelte';
	import StatusScreen from '#lib/player/StatusScreen.svelte';
	import { chooseStartVariant, primaryLang } from '#lib/player/variants.ts';
	import { chooseAudioTrack, chooseSubtitleTrack } from '#lib/player/tracks.ts';
	import { leave, livePath, markEntry, replaceIn } from '#lib/player/nav.ts';

	const engine = new PlayerEngine();
	let player: Player | undefined = $state();

	let entered = false;
	afterNavigate(({ from }) => {
		if (entered) return;
		entered = true;
		markEntry(from);
	});

	const channelId = $derived(page.params.channelId ?? '');
	const variantParam = $derived(page.url.searchParams.get('v'));
	// Kids mode: only kids channels in the list and the zap order, and no direct url access.
	const channels = $derived(library.channels);
	const channel = $derived(library.getChannel(channelId));
	$effect(() => library.ensureChannels());
	const blocked = $derived(!!channel && !kids.isChannelAllowed(channel));

	const prefs = $derived({
		audioLangs: user.active?.audioLangs ?? ['nl', 'en'],
		subtitleLangs: user.active?.subtitleLangs ?? [],
		subtitlesOn: user.active?.subtitlesOn ?? false
	});

	const current = $derived(
		user.ready && channel && !blocked
			? chooseStartVariant(
					channel.variants,
					variantParam,
					untrack(() => prefs)
				)
			: undefined
	);

	const status = $derived.by(() => {
		if (!user.ready) return 'loading';
		if (!channel) {
			if (!library.initialized || library.channelsLoading || library.status === 'loading')
				return 'loading';
			if (library.channelsError || library.status === 'error') return 'catalog-error';
			return 'not-found';
		}
		if (blocked) return 'kids-blocked';
		return current ? 'ready' : 'no-variants';
	});

	// ---- EPG clock -------------------------------------------------------------

	let now = $state(Date.now());
	$effect(() => {
		const id = setInterval(() => (now = Date.now()), 30_000);
		return () => clearInterval(id);
	});

	// ---- playback ----------------------------------------------------------------

	let loadedKey = '';
	let loadedChannel = '';
	let preferredLang: LangCode | undefined;
	let subtitleChoice: LangCode | null | undefined;
	const failedIds = new SvelteSet<string>();

	function start(ch: Channel, v: StreamVariant) {
		const key = `${ch.id}|${v.id}`;
		if (key === loadedKey) return;
		loadedKey = key;
		if (loadedChannel !== ch.id) {
			loadedChannel = ch.id;
			user.setLastChannel(ch.id);
			preferredLang = undefined;
			player?.reveal();
		}
		const profile = user.active;
		engine.load({
			url: v.url,
			containerExt: v.containerExt,
			altUrls: v.altUrls,
			live: true,
			pickAudio: (tracks) =>
				chooseAudioTrack(tracks, [
					...(preferredLang ? [preferredLang] : []),
					...(profile?.audioLangs ?? []),
					...v.audioLangs
				]),
			pickSubtitle: (tracks, audioLang) =>
				chooseSubtitleTrack(
					tracks,
					{
						subtitlesOn: profile?.subtitlesOn ?? false,
						subtitleLangs: profile?.subtitleLangs ?? [],
						audioLangs: profile?.audioLangs ?? [],
						uiLang: profile?.uiLang ?? i18n.locale,
						sessionChoice: subtitleChoice
					},
					audioLang && audioLang !== 'und' ? audioLang : primaryLang(v)
				)
		});
	}

	$effect(() => {
		if (!engine.attached) {
			loadedKey = '';
			return;
		}
		if (status !== 'ready' || !channel || !current) return;
		const ch = channel;
		const v = playableVariant(current);
		untrack(() => start(ch, v));
	});

	$effect(() => {
		if (engine.error && current) {
			const id = current.id;
			untrack(() => failedIds.add(id));
		}
	});

	// ---- zapping -----------------------------------------------------------------

	/** Channel shown while zapping quickly (the stream switches once the keys settle). */
	let zapTarget = $state<Channel | null>(null);
	let zapTimer: ReturnType<typeof setTimeout> | undefined;
	let lastZapAt = 0;

	function zap(dir: 1 | -1) {
		const list = channels;
		if (list.length < 2) return;
		const from = zapTarget ?? channel;
		const i = list.findIndex((c) => c.id === from?.id);
		const target = list[((((i === -1 ? 0 : i) + dir) % list.length) + list.length) % list.length];
		zapTarget = target;
		player?.reveal();
		const t0 = performance.now();
		const quick = t0 - lastZapAt < 600;
		lastZapAt = t0;
		clearTimeout(zapTimer);
		zapTimer = setTimeout(() => go(target), quick ? 350 : 0);
	}

	function go(target: Channel) {
		if (target.id === channelId) {
			zapTarget = null;
			return;
		}
		void replaceIn(livePath(target.id)).finally(() => {
			if (zapTarget?.id === target.id) zapTarget = null;
		});
	}

	function selectVariant(v: StreamVariant, lang: LangCode) {
		preferredLang = lang;
		if (v.id === current?.id && engine.error) {
			engine.retry();
			return;
		}
		void replaceIn(livePath(channelId, v.id));
	}

	onDestroy(() => clearTimeout(zapTimer));

	// ---- presentation ------------------------------------------------------------

	const shownChannel = $derived(zapTarget ?? channel);
	const nn = $derived(shownChannel ? library.nowNext(shownChannel, now) : {});
	const progress = $derived(
		nn.now
			? Math.min(100, ((now - nn.now.start) / Math.max(1, nn.now.stop - nn.now.start)) * 100)
			: 0
	);
	const clock = (ms: number) =>
		new Date(ms).toLocaleTimeString(i18n.locale === 'nl' ? 'nl-NL' : 'en-GB', {
			hour: '2-digit',
			minute: '2-digit'
		});

	const meta = $derived({
		title: channel?.name ?? '',
		artist: nn.now?.title,
		artworkUrl: channel?.logoUrl
	});

	const statusMessage = $derived(
		status === 'kids-blocked'
			? t('profiles.kids.blocked')
			: status === 'catalog-error'
				? t('player.catalogError')
				: status === 'not-found'
					? t('player.channelNotFound')
					: status === 'no-variants'
						? t('player.noVariants')
						: null
	);
</script>

<svelte:head>
	<title>{channel && !blocked ? channel.name : 'PrismaStream'}</title>
</svelte:head>

{#snippet channelsPanel(close: () => void)}
	<ChannelsPanel
		{channels}
		currentId={channel?.id}
		{now}
		onSelect={(ch) => {
			close();
			go(ch);
		}}
	/>
{/snippet}

{#snippet liveInfo({ visible }: { visible: boolean })}
	{#if shownChannel && (visible || zapTarget)}
		<section class="info" class:zapping={!!zapTarget} aria-live="polite">
			<div class="logo">
				{#if shownChannel.logoUrl}
					<img src={shownChannel.logoUrl} alt="" />
				{:else}
					<span>{shownChannel.name.slice(0, 3)}</span>
				{/if}
			</div>
			<div class="text">
				<div class="name">
					{#if shownChannel.number}<span class="no">{shownChannel.number}</span>{/if}
					{shownChannel.name}
				</div>
				{#if nn.now}
					<div class="prog">
						<span class="tag">{t('player.now')}</span>
						<strong>{nn.now.title}</strong>
						<span class="times">{clock(nn.now.start)} – {clock(nn.now.stop)}</span>
					</div>
					<div class="bar"><span style:width="{progress}%"></span></div>
				{:else}
					<div class="prog muted">{t('player.noEpg')}</div>
				{/if}
				{#if nn.next}
					<div class="prog next">
						<span class="tag">{t('player.later')}</span>
						<span>{clock(nn.next.start)} · {nn.next.title}</span>
					</div>
				{/if}
			</div>
		</section>
	{/if}
{/snippet}

{#if status === 'ready' && channel}
	<Player
		bind:this={player}
		{engine}
		live
		heading={shownChannel?.name ?? channel.name}
		subheading={nn.now?.title}
		variants={channel.variants}
		{current}
		{failedIds}
		{meta}
		onBack={() => leave('/live')}
		onSelectVariant={selectVariant}
		onSubtitleChoice={(lang) => (subtitleChoice = lang)}
		onChannel={zap}
		side={{ label: t('player.channels'), icon: 'channels', content: channelsPanel }}
		extras={liveInfo}
	/>
{:else}
	<StatusScreen
		message={statusMessage}
		kind={status === 'kids-blocked' ? 'blocked' : 'error'}
		detail={status === 'kids-blocked' ? t('player.kidsChannelBlocked') : undefined}
		onBack={() => leave('/live')}
		onRetry={status === 'catalog-error'
			? () => (library.mode === 'remote' ? library.ensureChannels(true) : library.refresh())
			: undefined}
	/>
{/if}

<style>
	.info {
		position: absolute;
		z-index: 14;
		left: max(var(--gutter), env(safe-area-inset-left, 0px));
		bottom: calc(var(--safe-bottom) + 132px);
		display: flex;
		gap: 16px;
		align-items: flex-start;
		width: min(560px, calc(100vw - 2 * var(--gutter)));
		padding: 16px;
		border-radius: var(--radius-l);
		background: color-mix(in oklab, var(--bg-elev-2) 76%, transparent);
		border: 1px solid var(--line);
		backdrop-filter: blur(26px) saturate(1.4);
		-webkit-backdrop-filter: blur(26px) saturate(1.4);
		pointer-events: none;
		animation: in var(--dur) var(--ease-out);
	}
	.info.zapping {
		border-color: var(--accent);
	}
	.logo {
		flex: none;
		display: grid;
		place-items: center;
		width: 84px;
		height: 56px;
		border-radius: var(--radius-m);
		background: var(--bg-elev-3);
		overflow: hidden;
		font-weight: 800;
		text-transform: uppercase;
		color: var(--text-2);
	}
	.logo img {
		max-width: 86%;
		max-height: 80%;
		object-fit: contain;
	}
	.text {
		display: grid;
		gap: 6px;
		min-width: 0;
		flex: 1;
	}
	.name {
		font-size: 18px;
		font-weight: 750;
	}
	.no {
		margin-right: 10px;
		color: var(--accent);
		font-variant-numeric: tabular-nums;
	}
	.prog {
		display: flex;
		align-items: baseline;
		gap: 8px;
		min-width: 0;
		font-size: 14px;
		color: var(--text-2);
	}
	.prog strong {
		color: var(--text);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.prog.next span:last-child {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.prog.muted {
		color: var(--text-3);
	}
	.tag {
		flex: none;
		font-size: 11px;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-3);
	}
	.times {
		flex: none;
		margin-left: auto;
		font-size: 12px;
		font-variant-numeric: tabular-nums;
		color: var(--text-3);
	}
	.bar {
		height: 3px;
		border-radius: var(--radius-pill);
		background: var(--line-strong);
		overflow: hidden;
	}
	.bar span {
		display: block;
		height: 100%;
		background: var(--accent);
	}
	@keyframes in {
		from {
			opacity: 0;
			transform: translateY(10px);
		}
	}
	@media (max-height: 480px) {
		.info {
			bottom: calc(var(--safe-bottom) + 100px);
			padding: 10px 12px;
		}
		.prog.next {
			display: none;
		}
	}
</style>
