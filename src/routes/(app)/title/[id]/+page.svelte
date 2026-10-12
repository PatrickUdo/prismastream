<!--
	Title detail (movies and series): cinematic backdrop, info, actions, trailer, the
	version picker (audio, subtitles, quality, source), seasons and episodes, cast and
	similar titles.
-->
<script lang="ts">
	import type { LangCode, Quality, Title } from '#lib/types.ts';
	import { page } from '$app/state';
	import { languageName, nativeLanguageName } from '#lib/lang.ts';
	import { i18n, t } from '#lib/i18n/index.svelte.ts';
	import { user } from '#lib/stores/user.svelte.ts';
	import { catalog } from '#lib/stores/catalog.svelte.ts';
	import { kids } from '#lib/stores/kids.svelte.ts';
	import { sourceName } from '#lib/sources/index.svelte.ts';
	import { similarTitles } from '#lib/recommend.ts';
	import Backdrop from '#lib/components/Backdrop.svelte';
	import Poster from '#lib/components/Poster.svelte';
	import Button from '#lib/components/Button.svelte';
	import Chip from '#lib/components/Chip.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import Row from '#lib/components/Row.svelte';
	import TitleCard from '#lib/components/TitleCard.svelte';
	import CastCard from '#lib/components/CastCard.svelte';
	import EpisodeItem from '#lib/components/EpisodeItem.svelte';
	import LanguagePicker from '#lib/components/LanguagePicker.svelte';
	import ChoiceGroup, { type ChoiceOption } from '#lib/components/ChoiceGroup.svelte';
	import QualityBadge from '#lib/components/QualityBadge.svelte';
	import Modal from '#lib/components/Modal.svelte';
	import Skeleton from '#lib/components/Skeleton.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import { libraryHref, path, watchHref, type SubtitleParam } from '#lib/components/links.ts';
	import {
		bestQuality,
		formatDate,
		formatRuntime,
		knownLangs,
		sortLangsByPreference,
		tn
	} from '#lib/components/format.ts';
	import { displayTitle, secondaryTitles } from '#lib/components/titles.ts';
	import { bestSubtitle } from '#lib/merge/pick.ts';
	import { playAction, profilePrefs } from '#lib/components/play.ts';
	import {
		allVariants,
		resolveVariant,
		versionOptions,
		type VersionChoice
	} from '#lib/components/versions.ts';

	const id = $derived(page.params.id ?? '');
	const loading = $derived(catalog.status === 'idle' || catalog.status === 'loading');
	const found = $derived(catalog.getTitle(id));
	// Kids mode: titles that are not kids-safe are not shown (see the blocked state below).
	const blocked = $derived(!!found && !kids.isAllowed(found));
	const title = $derived(blocked ? undefined : found);
	/** Title in the profile language, with the original/English title as subtitle. */
	const name = $derived(title ? displayTitle(title) : '');
	const otherNames = $derived(
		title ? secondaryTitles(title, name) : { titles: [], original: false }
	);

	// ---- Series: lazy seasons ----------------------------------------------
	let seasonsLoading = $state(false);
	let requested = '';
	$effect(() => {
		const tt = title;
		if (!tt || tt.kind !== 'series' || requested === tt.id) return;
		requested = tt.id;
		seasonsLoading = !tt.seasons;
		void catalog.ensureSeasons(tt.id).finally(() => (seasonsLoading = false));
	});

	// ---- Versions ------------------------------------------------------------
	const prefs = $derived(profilePrefs());
	const variants = $derived(title ? allVariants(title) : []);
	const progress = $derived(title ? user.latestProgress(title.id) : undefined);

	/** Keep the requested audio language when the resolved stream carries several. */
	function toChoice(v: ReturnType<typeof resolveVariant>, audio?: LangCode): VersionChoice {
		if (!v) return { audio };
		return {
			audio: audio && v.audioLangs.includes(audio) ? audio : v.audioLangs[0],
			quality: v.quality,
			sourceId: v.sourceId
		};
	}

	const defaultChoice = $derived.by<VersionChoice>(() => {
		const last = progress && variants.find((v) => v.id === progress.variantId);
		return toChoice(last ?? resolveVariant(variants, {}, prefs));
	});
	let override = $state<{ id: string; choice: VersionChoice } | null>(null);
	const choice = $derived(override && override.id === id ? override.choice : defaultChoice);
	const options = $derived(versionOptions(variants, choice));
	const selected = $derived(
		title?.kind === 'movie' ? resolveVariant(variants, choice, prefs) : undefined
	);

	function choose(next: VersionChoice) {
		const v = resolveVariant(variants, next, prefs);
		override = { id, choice: toChoice(v, next.audio) };
	}

	const qualityLabel = (q: Quality) => t(`detail.quality.${q}`);

	const audioHints = $derived(
		Object.fromEntries(
			options.audio.filter((a) => a.count > 1).map((a) => [a.lang, String(a.count)])
		) as Record<LangCode, string>
	);
	const qualityOptions = $derived<ChoiceOption[]>(
		options.qualities.map((q) => ({ value: q, label: qualityLabel(q) }))
	);
	const sourceOptions = $derived<ChoiceOption[]>(
		options.sources.map((s) => ({ value: s, label: sourceName(s) }))
	);
	const versionCount = $derived(variants.length);
	const sourceCount = $derived(new Set(variants.map((v) => v.sourceId)).size);

	// ---- Play ----------------------------------------------------------------
	const play = $derived(title ? playAction(title) : undefined);
	/** The stream the play button starts (resumed version, or the chosen one). */
	const playVariant = $derived.by(() => {
		if (!title || !play) return undefined;
		const custom = override && override.id === id;
		const list = title.kind === 'movie' ? variants : (play.episode?.variants ?? []);
		const resumed =
			play.resume && !custom ? list.find((v) => v.id === progress?.variantId) : undefined;
		return resumed ?? (title.kind === 'movie' ? selected : resolveVariant(list, choice, prefs));
	});

	// ---- Subtitles -------------------------------------------------------------
	// Default: the profile rule (bestSubtitle). An explicit choice goes to the player as ?s=.
	const subtitleLangs = $derived(knownLangs(playVariant?.subtitleLangs ?? []));
	const defaultSubtitle = $derived<SubtitleParam>(
		(playVariant && bestSubtitle(playVariant, prefs)) || 'off'
	);
	let subOverride = $state<{ id: string; value: SubtitleParam } | null>(null);
	/** Explicit choice, when it is still available for the current version. */
	const subtitleChoice = $derived(
		subOverride &&
			subOverride.id === id &&
			(subOverride.value === 'off' || subtitleLangs.includes(subOverride.value))
			? subOverride.value
			: undefined
	);
	const subtitleValue = $derived(subtitleChoice ?? defaultSubtitle);
	const subtitleOptions = $derived<ChoiceOption[]>([
		{ value: 'off', label: t('detail.subtitlesOff') },
		...sortLangsByPreference(subtitleLangs, prefs.subtitleLangs).map((code) => ({
			value: code,
			label: languageName(code, i18n.locale),
			description: nativeLanguageName(code)
		}))
	]);

	const playHref = $derived.by(() => {
		if (!title || !play) return undefined;
		if (title.kind === 'series' && !play.episode) return undefined;
		return watchHref(title.id, {
			episodeId: play.episode?.id,
			variantId: playVariant?.id,
			subtitle: subtitleChoice
		});
	});
	const playLabel = $derived.by(() => {
		if (!play) return t('common.play');
		if (play.episode && title?.kind === 'series') {
			const ep = t('ui.episodeShort', { s: play.episode.season, e: play.episode.episode });
			return play.resume ? t('detail.resumeEpisode', { ep }) : t('detail.playEpisode', { ep });
		}
		return play.resume ? t('common.resume') : t('common.play');
	});

	// ---- Seasons ---------------------------------------------------------------
	const seasons = $derived(
		[...(title?.seasons ?? [])].filter((s) => s.episodes.length).sort((a, b) => a.number - b.number)
	);
	let seasonOverride = $state<{ id: string; n: number } | null>(null);
	const activeSeason = $derived.by(() => {
		if (seasonOverride && seasonOverride.id === id) {
			const s = seasons.find((x) => x.number === seasonOverride?.n);
			if (s) return s;
		}
		if (play?.episode) {
			const s = seasons.find((x) => x.number === play.episode?.season);
			if (s) return s;
		}
		return seasons.find((s) => s.number > 0) ?? seasons[0];
	});
	const episodes = $derived(
		[...(activeSeason?.episodes ?? [])].sort((a, b) => a.episode - b.episode)
	);
	let tablist = $state<HTMLDivElement>();
	function seasonKey(e: KeyboardEvent, i: number) {
		const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
		if (!step) return;
		e.preventDefault();
		const next = seasons[(i + step + seasons.length) % seasons.length];
		seasonOverride = { id, n: next.number };
		tablist
			?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
			[(i + step + seasons.length) % seasons.length]?.focus();
	}
	const seasonLabel = (n: number) => (n === 0 ? t('detail.specials') : t('detail.season', { n }));

	// ---- Extra info ------------------------------------------------------------
	const similar = $derived(title ? similarTitles(title, kids.visibleTitles, 18) : []);
	const favorite = $derived(title ? user.isFavorite(title.id) : false);
	const langNames = (langs: LangCode[]) =>
		knownLangs(langs)
			.map((l) => languageName(l, i18n.locale))
			.join(', ');
	const altTitles = $derived(
		title
			? [
					...new Map(
						title.altTitles
							.filter(
								(a) =>
									a.title !== title.title && a.title !== title.originalTitle && a.title !== name
							)
							.map((a) => [a.title, a])
					).values()
				].slice(0, 6)
			: []
	);
	const runtimeOrSeasons = $derived.by(() => {
		if (!title) return '';
		if (title.kind === 'movie') return formatRuntime(title.runtimeMin);
		if (seasons.length) return tn('ui.seasons', seasons.length);
		return t('common.series');
	});

	// ---- Trailer ---------------------------------------------------------------
	let trailerOpen = $state(false);
	function youtubeId(url: string): string | null {
		try {
			const u = new URL(url);
			const host = u.hostname.replace(/^www\.|^m\./, '');
			if (host === 'youtu.be') return u.pathname.slice(1).split('/')[0] || null;
			if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
				if (u.searchParams.get('v')) return u.searchParams.get('v');
				const m = u.pathname.match(/^\/(?:embed|shorts|v)\/([^/?#]+)/);
				return m ? m[1] : null;
			}
		} catch {
			return null;
		}
		return null;
	}
	const trailerYt = $derived(title?.trailerUrl ? youtubeId(title.trailerUrl) : null);
</script>

<svelte:head>
	<title>{title ? `${name} · PrismaStream` : 'PrismaStream'}</title>
</svelte:head>

{#if !title && loading}
	<div class="skeleton-hero" aria-busy="true" aria-label={t('common.loading')}>
		<div class="sk-copy">
			<Skeleton shape="line" width="6rem" />
			<Skeleton shape="block" width="min(30rem, 85%)" height="4rem" />
			<Skeleton shape="line" width="18rem" />
			<Skeleton shape="block" width="min(36rem, 90%)" height="4.5rem" />
		</div>
	</div>
{:else if blocked}
	<div class="page">
		<EmptyState
			icon="user"
			title={t('profiles.kids.blocked')}
			body={t('profiles.kids.blockedBody')}
		>
			{#snippet actions()}
				<Button variant="primary" icon="home" href={path('/')}>{t('detail.backHome')}</Button>
			{/snippet}
		</EmptyState>
	</div>
{:else if !title}
	<div class="page">
		<EmptyState icon="film" title={t('detail.notFound')} body={t('detail.notFoundBody')}>
			{#snippet actions()}
				<Button variant="primary" icon="home" href={path('/')}>{t('detail.backHome')}</Button>
			{/snippet}
		</EmptyState>
	</div>
{:else}
	{#key title.id}
		<article class="detail">
			<!-- Hero ----------------------------------------------------------- -->
			<section class="hero">
				<div class="art grain">
					<Backdrop seed={title.id} genres={title.genres} url={title.backdropUrl} eager fill />
				</div>
				<div class="scrim" aria-hidden="true"></div>

				<div class="hero-inner">
					<div class="poster">
						<Poster {title} eager />
					</div>
					<div class="info">
						<span class="eyebrow kind">
							{title.kind === 'movie' ? t('common.movie') : t('common.series')}
						</span>
						<h1>{name}</h1>
						{#if otherNames.titles.length}
							<p class="original">
								{#if otherNames.original}{t('detail.originalTitle')}:
								{/if}<span>{otherNames.titles.join(' · ')}</span>
							</p>
						{/if}
						<p class="meta">
							{#if title.year}<span>{title.year}</span>{/if}
							{#if runtimeOrSeasons}<span class="sep" aria-hidden="true">·</span><span
									>{runtimeOrSeasons}</span
								>{/if}
							{#if title.rating}
								<span class="sep" aria-hidden="true">·</span>
								<span class="rating">
									<Icon name="star" size="0.9rem" />{title.rating.toFixed(1)}
									<span class="sr-only">{t('detail.rating')}</span>
								</span>
							{/if}
							<QualityBadge quality={bestQuality(title.qualities)} tone="plain" />
						</p>
						{#if title.genres.length}
							<ul class="genres" aria-label={t('detail.genres')}>
								{#each title.genres as g (g)}
									<li>
										<Chip size="s" href={libraryHref(title.kind, { genre: g })}>{g}</Chip>
									</li>
								{/each}
							</ul>
						{/if}

						<div class="actions">
							{#if playHref}
								<Button
									variant="light"
									size="l"
									icon="play"
									href={playHref}
									progress={play?.resume ? play.ratio : undefined}
									data-focusable
								>
									{playLabel}
								</Button>
							{:else if title.kind === 'series' && seasonsLoading}
								<Button variant="light" size="l" icon="play" disabled>{t('common.loading')}</Button>
							{/if}
							<Button
								variant="glass"
								size="l"
								icon={favorite ? 'check' : 'plus'}
								pressed={favorite}
								onclick={() => user.toggleFavorite(title.id)}
								data-focusable
							>
								{favorite ? t('detail.inFavorites') : t('detail.addFavorite')}
							</Button>
							{#if title.trailerUrl}
								<Button
									variant="glass"
									size="l"
									icon="play-circle"
									onclick={() => (trailerOpen = true)}
									data-focusable
								>
									{t('detail.trailer')}
								</Button>
							{/if}
						</div>

						{#if title.overview}
							<p class="overview">{title.overview}</p>
						{/if}
					</div>
				</div>
			</section>

			<div class="body">
				<!-- Versions + details ----------------------------------------- -->
				<div class="split">
					<section class="versions glass" aria-labelledby="versions-h">
						<header>
							<div>
								<span class="eyebrow">{t('detail.versionsEyebrow')}</span>
								<h2 id="versions-h">{t('detail.versions')}</h2>
							</div>
							<p class="vcount">
								{tn('detail.versionCount', versionCount)} · {tn('detail.sourceCount', sourceCount)}
							</p>
						</header>

						{#if variants.length === 0}
							<p class="muted">
								{seasonsLoading ? t('detail.loadingEpisodes') : t('detail.noVersions')}
							</p>
						{:else}
							<LanguagePicker
								label={t('detail.audio')}
								languages={options.audio.map((a) => a.lang)}
								value={choice.audio}
								preferred={prefs.audioLangs}
								hints={audioHints}
								onchange={(lang) => choose({ audio: lang })}
							/>
							{#if subtitleLangs.length}
								<ChoiceGroup
									label={t('detail.subtitles')}
									icon="subtitles"
									options={subtitleOptions}
									value={subtitleValue}
									onchange={(v) => (subOverride = { id, value: v })}
								/>
							{:else}
								<LanguagePicker
									label={t('detail.subtitles')}
									icon="subtitles"
									languages={[]}
									readonly
									emptyText={t('detail.noSubtitles')}
								/>
							{/if}
							<div class="two">
								<ChoiceGroup
									label={t('detail.qualityLabel')}
									icon="monitor"
									options={qualityOptions}
									value={choice.quality}
									onchange={(q) => choose({ audio: choice.audio, quality: q as Quality })}
								/>
								<ChoiceGroup
									label={t('detail.source')}
									icon="source"
									options={sourceOptions}
									value={choice.sourceId}
									onchange={(s) =>
										choose({ audio: choice.audio, quality: choice.quality, sourceId: s })}
								/>
							</div>
							<footer>
								{#if selected}
									<Icon name="check" size="1rem" />
									<span>
										{t('detail.selected', {
											lang: languageName(choice.audio ?? 'und', i18n.locale),
											quality: qualityLabel(selected.quality),
											source: sourceName(selected.sourceId)
										})}
									</span>
									<code title={t('detail.streamLabel')}>{selected.label}</code>
								{:else}
									<Icon name="info" size="1rem" />
									<span>{t('detail.seriesVersionHint')}</span>
								{/if}
							</footer>
						{/if}
					</section>

					<section class="facts" aria-labelledby="facts-h">
						<h2 id="facts-h" class="sr-only">{t('detail.details')}</h2>
						<dl>
							{#if title.director}
								<div>
									<dt>{t('detail.director')}</dt>
									<dd>{title.director}</dd>
								</div>
							{/if}
							{#if title.releaseDate}
								<div>
									<dt>{t('detail.releaseDate')}</dt>
									<dd>{formatDate(title.releaseDate)}</dd>
								</div>
							{/if}
							{#if title.cast.length}
								<div>
									<dt>{t('detail.starring')}</dt>
									<dd>
										{title.cast
											.slice(0, 4)
											.map((p) => p.name)
											.join(', ')}
									</dd>
								</div>
							{/if}
							{#if knownLangs(title.languages).length}
								<div>
									<dt>{t('detail.audio')}</dt>
									<dd>{langNames(title.languages)}</dd>
								</div>
							{/if}
							{#if knownLangs(title.subtitleLanguages).length}
								<div>
									<dt>{t('detail.subtitles')}</dt>
									<dd>{langNames(title.subtitleLanguages)}</dd>
								</div>
							{/if}
							{#if title.sourceIds.length}
								<div>
									<dt>{t('detail.sources')}</dt>
									<dd>{title.sourceIds.map(sourceName).join(', ')}</dd>
								</div>
							{/if}
							{#if altTitles.length}
								<div>
									<dt>{t('detail.alsoKnownAs')}</dt>
									<dd>
										{#each altTitles as a, i (a.title)}
											{#if i > 0},
											{/if}{a.title}{#if a.lang && a.lang !== 'und'}<span class="lang">
													{a.lang.toUpperCase()}</span
												>{/if}
										{/each}
									</dd>
								</div>
							{/if}
						</dl>
					</section>
				</div>

				<!-- Seasons & episodes ------------------------------------------ -->
				{#if title.kind === 'series'}
					<section class="episodes" aria-labelledby="episodes-h">
						<div class="ep-head">
							<h2 id="episodes-h">{t('detail.episodes')}</h2>
							{#if seasons.length > 1}
								<div
									class="tabs"
									role="tablist"
									aria-label={t('detail.seasons')}
									bind:this={tablist}
								>
									{#each seasons as s, i (s.number)}
										<button
											type="button"
											role="tab"
											id="season-tab-{s.number}"
											aria-selected={activeSeason?.number === s.number}
											aria-controls="season-panel"
											tabindex={activeSeason?.number === s.number ? 0 : -1}
											data-focusable
											onclick={() => (seasonOverride = { id, n: s.number })}
											onkeydown={(e) => seasonKey(e, i)}
										>
											{seasonLabel(s.number)}
										</button>
									{/each}
								</div>
							{:else if activeSeason}
								<span class="single-season">{seasonLabel(activeSeason.number)}</span>
							{/if}
						</div>

						{#if seasonsLoading && seasons.length === 0}
							<div class="ep-skeletons" aria-busy="true">
								{#each [0, 1, 2] as i (i)}
									<div class="ep-sk">
										<Skeleton shape="backdrop" />
										<div class="ep-sk-text">
											<Skeleton shape="line" width="60%" />
											<Skeleton shape="line" width="90%" />
											<Skeleton shape="line" width="40%" />
										</div>
									</div>
								{/each}
							</div>
						{:else if episodes.length === 0}
							<p class="muted">{t('detail.noEpisodes')}</p>
						{:else}
							<ol
								class="ep-list"
								id="season-panel"
								role={seasons.length > 1 ? 'tabpanel' : undefined}
								aria-labelledby={seasons.length > 1
									? `season-tab-${activeSeason?.number}`
									: undefined}
							>
								{#each episodes as ep (ep.id)}
									<li>
										<EpisodeItem
											titleId={title.id}
											episode={ep}
											genres={title.genres}
											variant={resolveVariant(ep.variants, choice, prefs)}
											progress={user.getProgress(title.id, ep.id)}
											subtitle={subtitleChoice}
										/>
									</li>
								{/each}
							</ol>
						{/if}
					</section>
				{/if}
			</div>

			<!-- Cast ---------------------------------------------------------- -->
			{#if title.cast.length}
				<div class="row-wrap">
					<Row
						title={t('detail.cast')}
						items={title.cast}
						key={(p) => p.name + (p.character ?? '')}
						variant="cast"
					>
						{#snippet item(person)}
							<CastCard {person} />
						{/snippet}
					</Row>
				</div>
			{/if}

			<!-- Similar ------------------------------------------------------- -->
			{#if similar.length}
				<div class="row-wrap">
					<Row title={t('detail.similar')} items={similar} key={(x: Title) => x.id}>
						{#snippet item(x)}
							<TitleCard title={x} />
						{/snippet}
					</Row>
				</div>
			{/if}
		</article>

		{#if title.trailerUrl}
			<Modal bind:open={trailerOpen} label={t('detail.trailerOf', { title: name })} variant="media">
				{#if trailerYt}
					<iframe
						src="https://www.youtube-nocookie.com/embed/{trailerYt}?autoplay=1&rel=0&modestbranding=1&playsinline=1"
						title={t('detail.trailerOf', { title: name })}
						allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
						allowfullscreen
					></iframe>
				{:else}
					<!-- svelte-ignore a11y_media_has_caption -->
					<video src={title.trailerUrl} controls autoplay playsinline></video>
				{/if}
			</Modal>
		{/if}
	{/key}
{/if}

<style>
	/* ---- Hero ---------------------------------------------------------------- */
	.hero {
		position: relative;
		min-height: clamp(36rem, 88svh, 62rem);
		display: flex;
		align-items: flex-end;
		isolation: isolate;
	}
	.art {
		position: absolute;
		inset: 0;
		z-index: -2;
		overflow: hidden;
	}
	/* Fade artwork and scrim out so they blend into the page background. */
	.art,
	.scrim {
		mask-image: linear-gradient(180deg, #000 60%, transparent 100%);
	}
	.scrim {
		position: absolute;
		inset: 0;
		z-index: -1;
		background:
			linear-gradient(90deg, rgb(7 7 11 / 0.92) 0%, rgb(7 7 11 / 0.62) 38%, rgb(7 7 11 / 0.1) 75%),
			linear-gradient(0deg, var(--bg) 0%, rgb(7 7 11 / 0.7) 25%, rgb(7 7 11 / 0) 60%),
			linear-gradient(180deg, rgb(7 7 11 / 0.6) 0%, rgb(7 7 11 / 0) 20%);
	}
	.hero-inner {
		display: grid;
		grid-template-columns: clamp(11rem, 8rem + 8vw, 17rem) minmax(0, 46rem);
		gap: clamp(1.5rem, 1rem + 2vw, 3rem);
		align-items: end;
		width: 100%;
		padding: calc(var(--safe-top) + var(--topbar-h) + 3rem) var(--page-end) 2.5rem var(--page-start);
	}
	.poster {
		border-radius: var(--radius-l);
		box-shadow:
			var(--shadow-3),
			0 30px 80px -30px var(--accent-glow);
		overflow: hidden;
	}
	.poster :global(.poster) {
		border-radius: var(--radius-l);
	}
	.info {
		display: grid;
		justify-items: start;
		gap: 0.85rem;
		min-width: 0;
	}
	.kind {
		color: var(--accent-strong);
	}
	h1 {
		font-size: var(--text-display);
		font-weight: 800;
		letter-spacing: -0.035em;
		line-height: 0.98;
		text-shadow: 0 4px 40px rgb(0 0 0 / 0.35);
	}
	.original {
		color: var(--text-3);
		font-size: var(--text-s);
	}
	.original span {
		color: var(--text-2);
		font-style: italic;
	}
	.meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		color: var(--text-2);
		font-weight: 600;
	}
	.sep {
		color: var(--text-3);
	}
	.rating {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		color: var(--rating);
	}
	.genres {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		margin-top: 0.4rem;
	}
	.overview {
		max-width: 42rem;
		color: var(--text-2);
		font-size: clamp(0.95rem, 0.88rem + 0.25vw, 1.08rem);
		line-height: 1.65;
	}
	@media (max-width: 799.98px) {
		.hero {
			min-height: auto;
		}
		.hero-inner {
			grid-template-columns: 1fr;
			padding-top: calc(var(--safe-top) + var(--topbar-h) + 44vw);
		}
		.poster {
			display: none;
		}
		.scrim {
			background:
				linear-gradient(
					0deg,
					var(--bg) 0%,
					var(--bg) 35%,
					rgb(7 7 11 / 0.55) 65%,
					rgb(7 7 11 / 0.2) 100%
				),
				linear-gradient(180deg, rgb(7 7 11 / 0.6) 0%, rgb(7 7 11 / 0) 20%);
		}
		.art {
			bottom: auto;
			height: min(70vh, 34rem);
		}
	}

	@media (max-width: 599.98px) {
		.actions > :global(:first-child) {
			flex: 1 1 100%;
		}
		.actions > :global(.btn) {
			flex: 1 1 auto;
		}
	}

	/* ---- Body ---------------------------------------------------------------- */
	.body {
		display: grid;
		gap: clamp(2.5rem, 2rem + 2vw, 4rem);
		padding: 1.5rem var(--page-end) 1rem var(--page-start);
	}
	.split {
		display: grid;
		grid-template-columns: minmax(0, 1.35fr) minmax(16rem, 1fr);
		gap: clamp(1.5rem, 1rem + 2vw, 3rem);
		align-items: start;
	}
	@media (max-width: 1099.98px) {
		.split {
			grid-template-columns: 1fr;
		}
	}

	.versions {
		position: relative;
		display: grid;
		gap: 1.5rem;
		padding: clamp(1.25rem, 1rem + 1vw, 2rem);
		border-radius: var(--radius-xl);
		box-shadow: var(--shadow-2);
		overflow: hidden;
	}
	.versions::before {
		content: '';
		position: absolute;
		inset: 0 0 auto 0;
		height: 1px;
		background: var(--spectrum);
		opacity: 0.45;
	}
	.versions::after {
		content: '';
		position: absolute;
		inset: -40% -20% auto auto;
		width: 60%;
		height: 80%;
		background: var(--spectrum-soft);
		filter: blur(60px);
		opacity: 0.6;
		pointer-events: none;
		z-index: -1;
	}
	.versions header {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
	}
	.versions h2 {
		font-size: var(--text-xl);
		margin-top: 0.25rem;
	}
	.vcount {
		color: var(--text-3);
		font-size: var(--text-s);
		font-weight: 600;
	}
	.two {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
		gap: 1.5rem;
	}
	.versions footer {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem 0.6rem;
		padding-top: 1.1rem;
		border-top: 1px solid var(--line);
		color: var(--text-2);
		font-size: var(--text-s);
	}
	.versions footer :global(.icon) {
		color: var(--accent-strong);
	}
	code {
		flex-basis: 100%;
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: var(--text-xs);
		color: var(--text-3);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.muted {
		color: var(--text-3);
	}

	.facts dl {
		display: grid;
		gap: 1.1rem;
		margin: 0;
	}
	.facts dl > div {
		display: grid;
		gap: 0.2rem;
	}
	dt {
		font-size: var(--text-xs);
		font-weight: 700;
		letter-spacing: var(--tracking-caps);
		text-transform: uppercase;
		color: var(--text-3);
	}
	dd {
		margin: 0;
		color: var(--text-2);
		line-height: 1.55;
	}
	.lang {
		margin-left: 0.25rem;
		font-size: 0.7em;
		font-weight: 750;
		letter-spacing: 0.06em;
		color: var(--text-3);
	}

	/* ---- Episodes -------------------------------------------------------------- */
	.ep-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 1rem;
		margin-bottom: 1rem;
	}
	.ep-head h2 {
		font-size: var(--text-xl);
	}
	.tabs {
		display: flex;
		gap: 0.3rem;
		max-width: 100%;
		padding: 0.25rem;
		border-radius: var(--radius-pill);
		background: rgb(255 255 255 / 0.04);
		border: 1px solid var(--line);
		overflow-x: auto;
		scrollbar-width: none;
	}
	.tabs button {
		flex: none;
		min-height: 2.25rem;
		padding: 0 1rem;
		border: 0;
		border-radius: var(--radius-pill);
		background: none;
		color: var(--text-2);
		font-size: var(--text-s);
		font-weight: 650;
		transition:
			background-color var(--dur) var(--ease-out),
			color var(--dur) var(--ease-out);
	}
	.tabs button:hover {
		color: var(--text);
	}
	.tabs button[aria-selected='true'] {
		background: var(--accent);
		color: var(--accent-contrast);
		box-shadow: 0 6px 20px -8px var(--accent-glow);
	}
	.single-season {
		color: var(--text-3);
		font-weight: 650;
	}
	.ep-list {
		display: grid;
		gap: 0.25rem;
		margin: 0 -0.75rem;
		padding: 0;
		list-style: none;
	}
	.ep-skeletons {
		display: grid;
		gap: 1rem;
	}
	.ep-sk {
		display: grid;
		grid-template-columns: minmax(8.5rem, 16rem) 1fr;
		gap: 1.25rem;
		align-items: center;
	}
	.ep-sk-text {
		display: grid;
		gap: 0.6rem;
	}

	.row-wrap {
		margin-top: 1rem;
	}

	/* ---- Loading ------------------------------------------------------------ */
	.skeleton-hero {
		position: relative;
		height: clamp(32rem, 80svh, 56rem);
		background:
			radial-gradient(60rem 30rem at 70% 30%, var(--accent-faint), transparent 70%),
			linear-gradient(180deg, var(--bg-elev-1), var(--bg));
	}
	.sk-copy {
		position: absolute;
		left: var(--page-start);
		right: var(--page-end);
		bottom: 3rem;
		display: grid;
		gap: 1rem;
	}

	iframe,
	video {
		display: block;
		width: 100%;
		height: 100%;
		border: 0;
		background: #000;
	}
</style>
