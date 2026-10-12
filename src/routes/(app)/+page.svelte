<!--
	Home: fullscreen hero, then rows in the order and visibility of user.data.homeRows.
	Empty rows are hidden; each title appears at most once per row.
-->
<script lang="ts">
	import type { HomeRowId, TitleCard as Card, WatchProgress } from '#lib/types.ts';
	import { t } from '#lib/i18n/index.svelte.ts';
	import { user } from '#lib/stores/user.svelte.ts';
	import { kids } from '#lib/stores/kids.svelte.ts';
	import { errorText, library } from '#lib/catalog/library.svelte.ts';
	import { resource } from '#lib/catalog/resource.svelte.ts';
	import { emptyHome } from '#lib/catalog/provider.ts';
	import Hero from '#lib/components/Hero.svelte';
	import Row from '#lib/components/Row.svelte';
	import TitleCard from '#lib/components/TitleCard.svelte';
	import ContinueCard from '#lib/components/ContinueCard.svelte';
	import ChannelCard from '#lib/components/ChannelCard.svelte';
	import GenreTile from '#lib/components/GenreTile.svelte';
	import Skeleton from '#lib/components/Skeleton.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import Button from '#lib/components/Button.svelte';
	import CloudBanner from '#lib/components/CloudBanner.svelte';
	import ErrorDetails from '#lib/components/ErrorDetails.svelte';
	import { libraryHref, path } from '#lib/components/links.ts';

	const ROW_LIMIT = 24;

	// Shared rows (hero, recent, popular, trending, genres, live) in one request.
	const home = resource(
		() => (library.initialized ? `${library.version}|${kids.active}` : null),
		(_k, signal) => library.provider.home({ kids: kids.active, limit: ROW_LIMIT }, signal)
	);
	const data = $derived(home.value ?? emptyHome());

	// Personal rows: cards for the ids in the profile's (E2E-synced) data.
	const progressList = $derived(user.continueWatching().slice(0, ROW_LIMIT));
	const continueIds = $derived(progressList.map((p) => p.titleId));
	const favoriteIds = $derived(user.data.favorites.slice(0, ROW_LIMIT));
	const personal = resource(
		() =>
			library.initialized
				? `${library.version}|${kids.active}|${continueIds.join(',')}|${favoriteIds.join(',')}`
				: null,
		(_k, signal) =>
			library.provider.cards([...continueIds, ...favoriteIds], { kids: kids.active }, signal)
	);
	const byId = $derived(new Map((personal.value ?? []).map((c) => [c.id, c])));

	const recommendedRes = resource(
		() =>
			library.initialized && rows.includes('recommended')
				? `${library.version}|${kids.active}|${user.activeId}|${user.data.favorites.length}|${user.data.history.length}`
				: null,
		(_k, signal) =>
			library.provider.recommend(
				{
					history: user.data.history.map((h) => h.titleId),
					favorites: user.data.favorites,
					kids: kids.active,
					limit: ROW_LIMIT
				},
				signal
			)
	);

	const loading = $derived(
		library.status === 'loading' || (!home.value && (home.loading || !library.initialized))
	);
	const failed = $derived(!home.value && !!home.error && !home.loading);
	const rows = $derived(user.data.homeRows.filter((r) => r.visible).map((r) => r.id));
	const heroTitles = $derived(kids.filterTitles(data.featured).slice(0, 5));

	const continueItems = $derived(
		progressList
			.map((progress) => ({ progress, title: byId.get(progress.titleId) }))
			.filter(
				(x): x is { progress: WatchProgress; title: Card } => !!x.title && kids.isAllowed(x.title)
			)
	);
	const favorites = $derived(
		kids.filterTitles(favoriteIds.map((id) => byId.get(id)).filter((c): c is Card => !!c))
	);
	const recommended = $derived(kids.filterTitles(recommendedRes.value ?? []));
	const recentTitles = $derived(kids.filterTitles(data.recent));
	const popularMovies = $derived(kids.filterTitles(data.popularMovies));
	const trendingSeries = $derived(kids.filterTitles(data.trendingSeries));
	const channels = $derived.by(() => {
		const fav = new Set(user.data.favoriteChannels);
		return kids
			.filterChannels(data.live)
			.sort((a, b) => Number(fav.has(b.id)) - Number(fav.has(a.id)))
			.slice(0, ROW_LIMIT);
	});
	const genres = $derived(data.genres.slice(0, 16));
	const nothing = $derived(
		!heroTitles.length &&
			!recentTitles.length &&
			!popularMovies.length &&
			!trendingSeries.length &&
			!channels.length
	);
	const building = $derived(library.mode === 'remote' && library.meta?.status === 'building');

	// Clock for "now on TV".
	let now = $state(Date.now());
	$effect(() => {
		const id = setInterval(() => (now = Date.now()), 30_000);
		return () => clearInterval(id);
	});

	function isEmpty(id: HomeRowId): boolean {
		switch (id) {
			case 'continue':
				return continueItems.length === 0;
			case 'favorites':
				return favorites.length === 0;
			case 'recommended':
				return recommended.length === 0;
			case 'recent':
				return recentTitles.length === 0;
			case 'popular-movies':
				return popularMovies.length === 0;
			case 'trending-series':
				return trendingSeries.length === 0;
			case 'live':
				return channels.length === 0;
			case 'genres':
				return genres.length === 0;
		}
	}

	const titleKey = (t: Card) => t.id;
</script>

<svelte:head>
	<title>{t('nav.home')} · PrismaStream</title>
</svelte:head>

<h1 class="sr-only">{t('nav.home')}</h1>

{#snippet titleCard(title: Card, i: number)}
	<TitleCard {title} eager={i < 8} />
{/snippet}

{#if loading}
	<div class="hero-skeleton" aria-hidden="true">
		<div class="hs-copy">
			<Skeleton shape="line" width="8rem" />
			<Skeleton shape="block" width="min(28rem, 80%)" height="4.5rem" />
			<Skeleton shape="line" width="16rem" />
			<div class="hs-actions">
				<Skeleton shape="block" width="10rem" height="3.25rem" radius="999px" />
				<Skeleton shape="block" width="9rem" height="3.25rem" radius="999px" />
			</div>
		</div>
	</div>
	<div class="rows" aria-busy="true" aria-label={t('common.loading')}>
		{#each [0, 1, 2] as r (r)}
			<div class="skeleton-row">
				<Skeleton shape="line" width="12rem" height="1.25rem" />
				<div class="sk-track">
					{#each Array.from({ length: 9 }, (_, i) => i) as i (i)}
						<Skeleton shape="poster" />
					{/each}
				</div>
			</div>
		{/each}
	</div>
{:else if failed || (library.status === 'error' && nothing)}
	<div class="page">
		<CloudBanner />
		<EmptyState
			icon="alert"
			tone="error"
			title={t('common.error')}
			body={home.error ? t(errorText(home.error)) : (library.error ?? t('cloud.error.unknown'))}
		>
			{#snippet actions()}
				<ErrorDetails error={home.error} text={home.error ? null : library.errorDetail} />
				<Button
					variant="primary"
					icon="refresh"
					onclick={() => (
						library.mode === 'remote' ? library.poke() : library.refresh(),
						home.reload()
					)}
				>
					{t('common.retry')}
				</Button>
			{/snippet}
		</EmptyState>
	</div>
{:else if nothing}
	<div class="page">
		<CloudBanner />
		<EmptyState
			icon="source"
			title={building ? t('cloud.building.title') : t('cloud.empty.title')}
			body={building ? t('cloud.building.body') : t('cloud.empty.body')}
		>
			{#snippet actions()}
				<Button variant="primary" icon="plus" href={path('/settings/sources')}>
					{t('cloud.empty.add')}
				</Button>
				{#if library.backendUrl && !library.hasAccount}
					<Button variant="glass" icon="user" href={path('/settings/sync')}>
						{t('cloud.login')}
					</Button>
				{/if}
			{/snippet}
		</EmptyState>
	</div>
{:else}
	{#if heroTitles.length}
		<Hero titles={heroTitles} />
	{/if}

	<div class="rows" class:no-hero={heroTitles.length === 0}>
		<CloudBanner inset />
		{#each rows as id (id)}
			{#if !isEmpty(id)}
				{#if id === 'continue'}
					<Row
						title={t('home.row.continue')}
						items={continueItems}
						key={(x) => x.progress.titleId}
						variant="wide"
					>
						{#snippet item(x)}
							<ContinueCard title={x.title} progress={x.progress} />
						{/snippet}
					</Row>
				{:else if id === 'favorites'}
					<Row
						title={t('home.row.favorites')}
						items={favorites}
						key={titleKey}
						item={titleCard}
						href={path('/my-list')}
					/>
				{:else if id === 'recommended'}
					<Row
						title={t('home.row.recommended')}
						eyebrow={t('home.row.recommendedEyebrow')}
						items={recommended}
						key={titleKey}
						item={titleCard}
					/>
				{:else if id === 'recent'}
					<Row title={t('home.row.recent')} items={recentTitles} key={titleKey} item={titleCard} />
				{:else if id === 'popular-movies'}
					<Row
						title={t('home.row.popularMovies')}
						items={popularMovies}
						key={titleKey}
						item={titleCard}
						href={libraryHref('movie', { sort: 'popular' })}
					/>
				{:else if id === 'trending-series'}
					<Row
						title={t('home.row.trendingSeries')}
						items={trendingSeries}
						key={titleKey}
						item={titleCard}
						href={libraryHref('series', { sort: 'popular' })}
					/>
				{:else if id === 'live'}
					<Row
						title={t('home.row.live')}
						items={channels}
						key={(c) => c.id}
						variant="channel"
						href={path('/live')}
					>
						{#snippet item(channel)}
							<ChannelCard {channel} {now} />
						{/snippet}
					</Row>
				{:else if id === 'genres'}
					<Row title={t('home.row.genres')} items={genres} key={(g) => g.slug} variant="tile">
						{#snippet item(g)}
							<GenreTile
								genre={g.name}
								count={g.count}
								href={libraryHref('movie', { genre: g.slug })}
							/>
						{/snippet}
					</Row>
				{/if}
			{/if}
		{/each}

		<div class="customize">
			<Button variant="ghost" size="s" icon="sliders" href={path('/settings')}>
				{t('home.customizeRows')}
			</Button>
		</div>
	</div>
{/if}

<style>
	.rows {
		position: relative;
		z-index: 1;
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: clamp(0.75rem, 0.4rem + 1vw, 1.5rem);
		margin-top: clamp(-7rem, -8vh, -3rem);
		padding-bottom: calc(var(--shell-bottom) + 3rem);
	}
	@media (max-width: 799.98px) {
		.rows {
			margin-top: 0;
		}
	}
	.rows.no-hero {
		margin-top: 0;
		padding-top: calc(var(--safe-top) + var(--topbar-h) + 2rem);
	}
	@media (min-width: 800px) {
		.rows.no-hero {
			padding-top: calc(var(--safe-top) + 3rem);
		}
	}
	.customize {
		display: flex;
		justify-content: center;
		padding: 1.5rem var(--page-end) 0 var(--page-start);
	}

	.hero-skeleton {
		position: relative;
		height: clamp(32rem, 86svh, 60rem);
		background:
			radial-gradient(60rem 30rem at 70% 30%, var(--accent-faint), transparent 70%),
			linear-gradient(180deg, var(--bg-elev-1), var(--bg));
	}
	.hs-copy {
		position: absolute;
		left: var(--page-start);
		right: var(--page-end);
		bottom: clamp(4.5rem, 12vh, 9rem);
		display: grid;
		gap: 1rem;
	}
	.hs-actions {
		display: flex;
		gap: 0.75rem;
	}
	.skeleton-row {
		display: grid;
		gap: 1.25rem;
		padding-inline: var(--page-start) 0;
		overflow: hidden;
	}
	.sk-track {
		display: grid;
		grid-auto-flow: column;
		grid-auto-columns: var(--card-w);
		gap: clamp(0.6rem, 0.4rem + 0.6vw, 1rem);
	}
</style>
