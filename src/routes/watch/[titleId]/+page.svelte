<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { page } from '$app/state';
	import { afterNavigate, beforeNavigate } from '$app/navigation';
	import type { Episode, LangCode, StreamVariant, Title } from '#lib/types.ts';
	import { i18n, t } from '#lib/i18n/index.svelte.ts';
	import { catalog } from '#lib/stores/catalog.svelte.ts';
	import { user } from '#lib/stores/user.svelte.ts';
	import { kids } from '#lib/stores/kids.svelte.ts';
	import { displayTitle } from '#lib/components/titles.ts';
	import type { SubtitleParam } from '#lib/components/links.ts';
	import { PlayerEngine } from '#lib/player/engine.svelte.ts';
	import Player, { type PlayerToast } from '#lib/player/Player.svelte';
	import NextEpisodeCard from '#lib/player/NextEpisodeCard.svelte';
	import EpisodesPanel from '#lib/player/EpisodesPanel.svelte';
	import StatusScreen from '#lib/player/StatusScreen.svelte';
	import { findEpisode, firstEpisode, nextEpisode } from '#lib/player/episodes.ts';
	import { chooseStartVariant, pickVariantForLang, primaryLang } from '#lib/player/variants.ts';
	import { chooseAudioTrack, chooseSubtitleTrack, parseSubtitleParam } from '#lib/player/tracks.ts';
	import {
		NEXT_COUNTDOWN_SEC,
		resumePosition,
		shouldSaveProgress,
		showNextCard
	} from '#lib/player/resume.ts';
	import { formatTime } from '#lib/player/format.ts';
	import { leave, markEntry, replaceIn, watchPath } from '#lib/player/nav.ts';

	const engine = new PlayerEngine();

	let entered = false;
	afterNavigate(({ from }) => {
		if (entered) return;
		entered = true;
		markEntry(from);
	});

	// ---- route state ----------------------------------------------------------

	const titleId = $derived(page.params.titleId ?? '');
	const episodeParam = $derived(page.url.searchParams.get('e'));
	const variantParam = $derived(page.url.searchParams.get('v'));
	/** Subtitle choice from the detail page (?s=<lang|off>); kept on in-player navigation. */
	const requestedSub = $derived(parseSubtitleParam(page.url.searchParams.get('s')));
	const subtitleParam = $derived<SubtitleParam | undefined>(
		requestedSub === null ? 'off' : requestedSub
	);

	const prefs = $derived({
		audioLangs: user.active?.audioLangs ?? ['nl', 'en'],
		subtitleLangs: user.active?.subtitleLangs ?? [],
		subtitlesOn: user.active?.subtitlesOn ?? false
	});

	// Series episodes may be loaded lazily (Xtream): ensureSeasons() once per title.
	let lazyTitle = $state.raw<Title | undefined>();
	let seasonsRequested = '';
	let seasonsDone = $state('');

	const baseTitle = $derived(catalog.getTitle(titleId));
	// Kids mode: a title that is not kids-safe cannot be opened through the url either.
	const blocked = $derived(!!baseTitle && !kids.isAllowed(baseTitle));
	const title = $derived(
		baseTitle?.kind === 'series' && !baseTitle.seasons && lazyTitle?.id === titleId
			? lazyTitle
			: baseTitle
	);
	const isSeries = $derived(title?.kind === 'series');

	$effect(() => {
		const id = titleId;
		if (!baseTitle || baseTitle.kind !== 'series' || baseTitle.seasons || blocked) return;
		if (seasonsRequested === id) return;
		seasonsRequested = id;
		catalog
			.ensureSeasons(id)
			.then((loaded) => {
				if (loaded?.id === id) lazyTitle = loaded;
			})
			.catch((err: unknown) => console.warn('[watch] ensureSeasons failed', err))
			.finally(() => (seasonsDone = id));
	});

	const episode = $derived<Episode | undefined>(
		isSeries && title?.seasons
			? episodeParam
				? findEpisode(title.seasons, episodeParam)
				: firstEpisode(title.seasons)
			: undefined
	);
	const variants = $derived<StreamVariant[]>(
		isSeries ? (episode?.variants ?? []) : (title?.variants ?? [])
	);
	const current = $derived(
		user.ready
			? chooseStartVariant(
					variants,
					// ?v= wins; otherwise continue in the version saved with the progress.
					variantParam ?? untrack(() => user.getProgress(titleId, episode?.id)?.variantId),
					untrack(() => prefs)
				)
			: undefined
	);

	const status = $derived.by(() => {
		if (!user.ready) return 'loading';
		if (!title) {
			if (catalog.status === 'error') return 'catalog-error';
			return catalog.status === 'ready' ? 'not-found' : 'loading';
		}
		if (blocked) return 'kids-blocked';
		if (isSeries && !title.seasons) return seasonsDone === titleId ? 'no-variants' : 'loading';
		if (isSeries && episodeParam && !episode) return 'episode-not-found';
		if (!current) return 'no-variants';
		return 'ready';
	});

	// ---- playback session ------------------------------------------------------

	interface Session {
		titleId: string;
		episodeId?: string;
		variantId: string;
	}
	let session: Session | null = null;
	let loadedKey = '';
	let lastPos = 0;
	let lastDur = 0;
	/** Audio language explicitly chosen (menu) or carried over to the next episode. */
	let preferredLang: LangCode | undefined;
	/** Subtitle choice made in this session (language, null = off, undefined = profile default). */
	let subtitleChoice: LangCode | null | undefined;
	const failedIds = new SvelteSet<string>();

	let toast = $state<PlayerToast | null>(null);
	let toastTimer: ReturnType<typeof setTimeout> | undefined;

	function showToast(next: PlayerToast | null, ms = 7000) {
		clearTimeout(toastTimer);
		toast = next;
		if (next) toastTimer = setTimeout(() => (toast = null), ms);
	}

	function persist() {
		if (!session || !shouldSaveProgress(lastPos, lastDur)) return;
		user.saveProgress({
			titleId: session.titleId,
			episodeId: session.episodeId,
			variantId: session.variantId,
			positionSec: Math.floor(lastPos),
			durationSec: Math.floor(lastDur)
		});
	}

	function currentAudioLang(): LangCode | undefined {
		const tr = engine.audioTracks.find((x) => x.id === engine.audioTrack);
		return tr && tr.lang !== 'und' ? tr.lang : primaryLang(current);
	}

	function start(tl: Title, ep: Episode | undefined, v: StreamVariant) {
		const key = `${tl.id}|${ep?.id ?? ''}|${v.id}`;
		if (key === loadedKey) return;
		const sameItem = !!session && session.titleId === tl.id && session.episodeId === ep?.id;
		let startAt: number;
		let autoplay = true;
		if (sameItem) {
			// Variant switch: keep the position and the play/pause state.
			startAt = engine.currentTime;
			autoplay = !engine.paused || engine.loading;
		} else {
			persist();
			const resume = resumePosition(user.getProgress(tl.id, ep?.id));
			startAt = resume ?? 0;
			dismissedNext = false;
			showToast(
				resume !== null
					? {
							text: t('player.resumeFrom', { time: formatTime(resume) }),
							action: {
								label: t('player.startOver'),
								run: () => {
									engine.seek(0);
									engine.play();
									showToast(null);
								}
							}
						}
					: null
			);
		}
		loadedKey = key;
		session = { titleId: tl.id, episodeId: ep?.id, variantId: v.id };
		lastPos = startAt;
		lastDur = 0;
		const profile = user.active;
		engine.load({
			url: v.url,
			containerExt: v.containerExt,
			live: false,
			startAt,
			autoplay,
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
						sessionChoice: subtitleChoice,
						requested: requestedSub
					},
					audioLang && audioLang !== 'und' ? audioLang : primaryLang(v)
				)
		});
	}

	$effect(() => {
		if (!engine.attached) {
			// Player (re)mounting: force a reload of the current item once it attaches again.
			loadedKey = '';
			return;
		}
		if (status !== 'ready' || !title || !current) return;
		const tl = title;
		const ep = episode;
		const v = current;
		untrack(() => start(tl, ep, v));
	});

	// Track the position without making persist() reactive.
	$effect(() => {
		lastPos = engine.currentTime;
		if (engine.duration > 0) lastDur = engine.duration;
	});

	$effect(() => {
		const id = setInterval(() => {
			if (!engine.paused) persist();
		}, 5000);
		const onHide = () => {
			if (document.visibilityState === 'hidden') persist();
		};
		document.addEventListener('visibilitychange', onHide);
		window.addEventListener('pagehide', persist);
		return () => {
			clearInterval(id);
			document.removeEventListener('visibilitychange', onHide);
			window.removeEventListener('pagehide', persist);
		};
	});

	$effect(() => {
		if (engine.paused || engine.ended) untrack(persist);
	});

	$effect(() => {
		if (engine.error && current) {
			const id = current.id;
			untrack(() => failedIds.add(id));
		}
	});

	beforeNavigate(() => persist());
	onDestroy(() => {
		persist();
		clearTimeout(toastTimer);
	});

	// ---- next episode ----------------------------------------------------------

	const next = $derived(
		isSeries && title?.seasons ? nextEpisode(title.seasons, episode?.id) : undefined
	);
	let dismissedNext = $state(false);
	const nextVisible = $derived(
		!!next &&
			!dismissedNext &&
			!engine.error &&
			!engine.loading &&
			showNextCard(engine.currentTime, engine.duration, engine.ended)
	);
	let countdown = $state<number | null>(null);

	$effect(() => {
		if (!nextVisible || !user.settings.autoplayNext) {
			countdown = null;
			return;
		}
		countdown = NEXT_COUNTDOWN_SEC;
		const id = setInterval(() => {
			if (engine.paused && !engine.ended) return;
			const left = (countdown ?? NEXT_COUNTDOWN_SEC) - 1;
			countdown = left;
			if (left <= 0) {
				clearInterval(id);
				if (next) playEpisode(next);
			}
		}, 1000);
		return () => clearInterval(id);
	});

	function playEpisode(ep: Episode) {
		const lang = currentAudioLang();
		const v = pickVariantForLang(ep.variants, lang, prefs, current?.sourceId);
		preferredLang = lang;
		countdown = null;
		void replaceIn(watchPath(titleId, ep.id, v?.id, subtitleParam));
	}

	function selectVariant(v: StreamVariant, lang: LangCode) {
		preferredLang = lang;
		if (v.id === current?.id && engine.error) {
			engine.retry();
			return;
		}
		void replaceIn(watchPath(titleId, episode?.id, v.id, subtitleParam));
	}

	function back() {
		persist();
		leave(blocked ? '/' : `/title/${encodeURIComponent(titleId)}`);
	}

	// ---- presentation ----------------------------------------------------------

	/** Title in the profile language ("Het Laatste Licht" for a Dutch profile). */
	const name = $derived(title ? displayTitle(title) : '');

	const episodeCode = $derived(
		episode ? t('player.episodeCode', { s: episode.season, e: episode.episode }) : ''
	);
	const subheading = $derived(
		episode ? `${episodeCode} · ${episode.title}` : title?.year ? String(title.year) : undefined
	);
	const meta = $derived({
		title: episode ? episode.title : name,
		artist: episode ? `${name} · ${episodeCode}` : title?.year?.toString(),
		artworkUrl: episode?.stillUrl ?? title?.posterUrl
	});
	const statusMessage = $derived(
		status === 'kids-blocked'
			? t('profiles.kids.blocked')
			: status === 'catalog-error'
				? t('player.catalogError')
				: status === 'not-found'
					? t('player.notFound')
					: status === 'episode-not-found'
						? t('player.episodeNotFound')
						: status === 'no-variants'
							? t('player.noVariants')
							: null
	);
</script>

<svelte:head>
	<title
		>{title && !blocked ? `${name}${episode ? ` · ${episodeCode}` : ''}` : 'PrismaStream'}</title
	>
</svelte:head>

{#snippet episodesPanel(close: () => void)}
	{#if title?.seasons}
		<EpisodesPanel
			titleId={title.id}
			seasons={title.seasons}
			currentId={episode?.id}
			onSelect={(ep) => {
				close();
				if (ep.id !== episode?.id) playEpisode(ep);
			}}
		/>
	{/if}
{/snippet}

{#snippet nextCard()}
	{#if nextVisible && next}
		<NextEpisodeCard
			episode={next}
			{countdown}
			total={NEXT_COUNTDOWN_SEC}
			onPlay={() => playEpisode(next)}
			onDismiss={() => (dismissedNext = true)}
		/>
	{/if}
{/snippet}

{#if status === 'ready' && title}
	<Player
		{engine}
		heading={name}
		{subheading}
		{variants}
		{current}
		{failedIds}
		{meta}
		{toast}
		onBack={back}
		onSelectVariant={selectVariant}
		onSubtitleChoice={(lang) => (subtitleChoice = lang)}
		onNext={next ? () => next && playEpisode(next) : undefined}
		side={isSeries && title.seasons
			? { label: t('player.episodes'), icon: 'episodes', content: episodesPanel }
			: undefined}
		extras={nextCard}
	/>
{:else}
	<StatusScreen
		message={statusMessage}
		kind={status === 'kids-blocked' ? 'blocked' : 'error'}
		detail={status === 'kids-blocked' ? t('profiles.kids.blockedBody') : undefined}
		onBack={back}
		onRetry={status === 'catalog-error' ? () => catalog.refresh() : undefined}
	/>
{/if}
