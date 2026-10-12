<!-- My list: the active profile's favorites as a poster grid, with an empty state. -->
<script lang="ts">
	import type { TitleCard as Card } from '#lib/types.ts';
	import { t } from '#lib/i18n/index.svelte.ts';
	import { user } from '#lib/stores/user.svelte.ts';
	import { kids } from '#lib/stores/kids.svelte.ts';
	import { library } from '#lib/catalog/library.svelte.ts';
	import { isAbortError } from '#lib/backend/client.ts';
	import PosterGrid from '#lib/components/PosterGrid.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import Button from '#lib/components/Button.svelte';
	import { path } from '#lib/components/links.ts';
	import { tn } from '#lib/components/format.ts';

	// Favorites are ids in the (E2E-synced) profile data; cards are fetched page by page.
	const PAGE = 60;
	const ids = $derived([...new Set(user.data.favorites)]);
	let found = $state.raw<Card[]>([]);
	let asked = $state(0);
	let firstLoading = $state(true);
	let loadingMore = $state(false);

	const key = $derived(
		library.initialized ? `${library.version}|${kids.active}|${ids.join(',')}` : null
	);

	$effect(() => {
		const k = key;
		if (k === null) return;
		const ctrl = new AbortController();
		const first = ids.slice(0, Math.max(PAGE, asked));
		library.provider
			.cards(first, { kids: kids.active }, ctrl.signal)
			.then((cards) => {
				if (ctrl.signal.aborted) return;
				found = cards;
				asked = first.length;
				firstLoading = false;
			})
			.catch((err: unknown) => {
				if (ctrl.signal.aborted || isAbortError(err)) return;
				firstLoading = false;
			});
		return () => ctrl.abort();
	});

	function more() {
		if (loadingMore || asked >= ids.length) return;
		loadingMore = true;
		const next = ids.slice(asked, asked + PAGE);
		library.provider
			.cards(next, { kids: kids.active })
			.then((cards) => {
				const have = new Set(found.map((c) => c.id));
				found = [...found, ...cards.filter((c) => !have.has(c.id))];
				asked += next.length;
			})
			.catch(() => undefined)
			.finally(() => (loadingMore = false));
	}

	const loading = $derived(firstLoading && ids.length > 0);
	// Kids profiles only see kids-safe titles.
	const titles = $derived(kids.filterTitles(found));
	const missing = $derived(
		loading || asked < ids.length ? 0 : Math.max(0, ids.length - found.length)
	);
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
		{#if ids.length && !loading}
			<p class="count">{tn('ui.titlesCount', asked >= ids.length ? titles.length : ids.length)}</p>
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
		<PosterGrid {titles} {loading} hasMore={asked < ids.length} {loadingMore} onmore={more} />
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
