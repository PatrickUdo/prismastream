<!-- My list: the active profile's favorites as a poster grid, with an empty state. -->
<script lang="ts">
	import type { Title } from '#lib/types.ts';
	import { t } from '#lib/i18n/index.svelte.ts';
	import { user } from '#lib/stores/user.svelte.ts';
	import { catalog } from '#lib/stores/catalog.svelte.ts';
	import { kids } from '#lib/stores/kids.svelte.ts';
	import PosterGrid from '#lib/components/PosterGrid.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import Button from '#lib/components/Button.svelte';
	import { path } from '#lib/components/links.ts';
	import { tn } from '#lib/components/format.ts';

	const loading = $derived(catalog.status === 'idle' || catalog.status === 'loading');
	const found = $derived(
		user.data.favorites.map((id) => catalog.getTitle(id)).filter((x): x is Title => !!x)
	);
	// Kids profiles only see kids-safe titles.
	const titles = $derived(kids.filterTitles(found));
	const missing = $derived(loading ? 0 : user.data.favorites.length - found.length);
</script>

<svelte:head>
	<title>{t('nav.myList')} · PrismaStream</title>
</svelte:head>

<div class="page">
	<header class="head">
		{#if user.active}
			<span class="eyebrow">{t('ui.profileOf', { name: user.active.name })}</span>
		{/if}
		<h1>{t('nav.myList')}</h1>
		{#if titles.length}
			<p class="count">{tn('ui.titlesCount', titles.length)}</p>
		{/if}
	</header>

	{#if !loading && titles.length === 0}
		<EmptyState icon="bookmark" title={t('ui.myListEmpty')} body={t('ui.myListEmptyBody')}>
			{#snippet actions()}
				<Button variant="primary" icon="film" href={path('/movies')}>{t('ui.browseMovies')}</Button>
				<Button variant="glass" icon="series" href={path('/series')}>{t('ui.browseSeries')}</Button>
			{/snippet}
		</EmptyState>
	{:else}
		<PosterGrid {titles} {loading} />
	{/if}

	{#if missing > 0}
		<p class="missing">{tn('ui.myListMissing', missing)}</p>
	{/if}
</div>

<style>
	.head {
		display: grid;
		gap: 0.35rem;
		margin-bottom: 2rem;
	}
	h1 {
		font-size: var(--text-2xl);
		font-weight: 800;
	}
	.count {
		color: var(--text-3);
		font-size: var(--text-s);
		font-weight: 600;
	}
	.missing {
		margin-top: 2rem;
		color: var(--text-3);
		font-size: var(--text-s);
	}
</style>
