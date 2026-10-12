<!--
	Live TV: "Nu live" hero (last watched or featured channel), search, language and category
	filters, and two views (remembered per device): a channel list and an EPG guide.
-->
<script lang="ts">
	import type { Channel, EpgProgramme } from '#lib/types.ts';
	import { i18n, t } from '#lib/i18n/index.svelte.ts';
	import { user } from '#lib/stores/user.svelte.ts';
	import { kids } from '#lib/stores/kids.svelte.ts';
	import { library } from '#lib/catalog/library.svelte.ts';
	import CloudBanner from '#lib/components/CloudBanner.svelte';
	import Button from '#lib/components/Button.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import Modal from '#lib/components/Modal.svelte';
	import Skeleton from '#lib/components/Skeleton.svelte';
	import { path } from '#lib/components/links.ts';
	import { tn } from '#lib/components/format.ts';
	import LiveHero from '#lib/components/live/LiveHero.svelte';
	import LiveFilters from '#lib/components/live/LiveFilters.svelte';
	import ChannelRow from '#lib/components/live/ChannelRow.svelte';
	import EpgGuide from '#lib/components/live/EpgGuide.svelte';
	import ChannelSheet from '#lib/components/live/ChannelSheet.svelte';
	import ChannelLogo from '#lib/components/live/ChannelLogo.svelte';
	import {
		HOUR,
		filterChannels,
		formatDay,
		formatTime,
		groupCounts,
		languageCounts,
		programmeAt,
		searchProgrammes
	} from '#lib/components/live/epg.ts';
	import {
		liveClock,
		loadView,
		saveView,
		shortEpg,
		type CategoryOption,
		type LiveView
	} from '#lib/components/live/live.svelte.ts';

	const now = $derived(liveClock.now);
	$effect(() => library.ensureChannels());
	const loading = $derived(!library.initialized || library.channelsLoading);
	const all = $derived(library.channels);

	// ---- filters ---------------------------------------------------------------------------

	let category = $state('all');
	let lang = $state('');
	let query = $state('');
	let view = $state<LiveView>(
		loadView() ?? (matchMedia('(max-width: 799.98px)').matches ? 'list' : 'guide')
	);

	function setView(v: LiveView) {
		view = v;
		saveView(v);
	}

	const languages = $derived(languageCounts(all));
	const byLang = $derived(lang ? all.filter((c) => c.languages.includes(lang)) : all);
	const searched = $derived(
		query.trim() ? filterChannels(byLang, query, shortEpg.programmes, now) : byLang
	);
	const favs = $derived(new Set(user.data.favoriteChannels));
	const groups = $derived(groupCounts(byLang));
	const categories = $derived.by<CategoryOption[]>(() => {
		const counts = new Map(groupCounts(searched).map((g) => [g.group, g.count]));
		return [
			{ id: 'all', label: t('live.all'), count: searched.length },
			{
				id: 'fav',
				label: t('live.favorites'),
				count: searched.filter((c) => favs.has(c.id)).length,
				icon: 'star'
			},
			...groups.map((g) => ({
				id: `g:${g.group}`,
				label: g.group,
				count: counts.get(g.group) ?? 0
			}))
		];
	});
	/** The chosen category, or 'all' when it no longer exists (e.g. after a language change). */
	const cat = $derived(categories.some((c) => c.id === category) ? category : 'all');
	const shown = $derived(
		cat === 'all'
			? searched
			: cat === 'fav'
				? searched.filter((c) => favs.has(c.id))
				: searched.filter((c) => `g:${c.group}` === cat)
	);
	const filtered = $derived(!!query.trim() || !!lang || cat !== 'all');

	// Upcoming programmes that match the search ("Straks in de gids").
	const hits = $derived(
		query.trim().length >= 2
			? searchProgrammes(byLang, shortEpg.programmes, query, now, now + 24 * HOUR, 40)
					.filter((h) => h.programme.start > now)
					.slice(0, 8)
			: []
	);

	function resetFilters() {
		query = '';
		lang = '';
		category = 'all';
	}

	// ---- hero ------------------------------------------------------------------------------

	const lastChannel = $derived.by(() => {
		const id = user.data.lastChannelId;
		const ch = id ? library.getChannel(id) : undefined;
		return ch && kids.isChannelAllowed(ch) ? ch : undefined;
	});
	const featured = $derived.by(() => {
		if (lastChannel || !all.length) return undefined;
		const onAir = (c: Channel) => !!programmeAt(shortEpg.programmes(c), now);
		return (
			all.find((c) => favs.has(c.id) && onAir(c)) ??
			all.find((c) => favs.has(c.id)) ??
			all.find(onAir) ??
			all[0]
		);
	});
	const hero = $derived(lastChannel ?? featured);

	// ---- detail sheet ----------------------------------------------------------------------

	interface SheetState {
		channel: Channel;
		slot?: { start: number; stop: number; programme?: EpgProgramme };
		sources?: boolean;
	}
	let sheet = $state<SheetState | null>(null);
	let sheetOpen = $state(false);

	function openSheet(s: SheetState) {
		sheet = s;
		sheetOpen = true;
	}
	const openSources = (channel: Channel) => openSheet({ channel, sources: true });
	const openInfo = (channel: Channel) => openSheet({ channel });

	const sheetLabel = $derived(
		sheet ? (sheet.slot?.programme?.title ?? sheet.channel.name) : t('live.title')
	);
</script>

<svelte:head>
	<title>{t('nav.live')} · PrismaStream</title>
</svelte:head>

<div class="page">
	<header class="head">
		<div>
			{#if !loading && all.length}
				<p class="eyebrow">{tn('live.channelCount', all.length)}</p>
			{/if}
			<h1>{t('live.title')}</h1>
		</div>
		{#if library.refreshing && !loading}
			<span class="refreshing" role="status">{t('live.refreshing')}</span>
		{/if}
	</header>

	<CloudBanner />
	{#if loading}
		<div class="skeleton" aria-busy="true" aria-label={t('common.loading')}>
			<div class="sk-hero">
				<Skeleton shape="backdrop" radius="var(--radius-l)" />
				<div class="sk-lines">
					<Skeleton shape="line" width="7rem" />
					<Skeleton shape="block" width="min(26rem, 90%)" height="2.4rem" />
					<Skeleton shape="line" width="min(20rem, 70%)" />
					<Skeleton shape="block" width="10rem" height="3.25rem" radius="999px" />
				</div>
			</div>
			<div class="sk-chips">
				{#each { length: 6 }, i (i)}
					<Skeleton shape="block" width="6.5rem" height="2.25rem" radius="999px" />
				{/each}
			</div>
			<div class="list">
				{#each { length: 8 }, i (i)}
					<Skeleton shape="block" height="7rem" radius="var(--radius-l)" />
				{/each}
			</div>
		</div>
	{:else if library.channelsError && !all.length}
		<EmptyState
			icon="alert"
			tone="error"
			title={t('live.errorTitle')}
			body={library.channelsError ?? t('common.error')}
		>
			{#snippet actions()}
				<Button
					variant="primary"
					icon="refresh"
					onclick={() =>
						library.mode === 'remote' ? library.ensureChannels(true) : library.refresh()}
				>
					{t('common.retry')}
				</Button>
			{/snippet}
		</EmptyState>
	{:else if !all.length}
		<EmptyState icon="live" title={t('live.emptyTitle')} body={t('live.emptyBody')}>
			{#snippet actions()}
				<Button variant="primary" icon="source" href={path('/settings/sources')}>
					{t('live.addSource')}
				</Button>
			{/snippet}
		</EmptyState>
	{:else}
		{#if hero}
			<LiveHero
				channel={hero}
				{now}
				kind={lastChannel ? 'last' : 'featured'}
				onsources={openSources}
				oninfo={openInfo}
			/>
		{/if}

		<section class="browse" aria-label={t('live.channels')}>
			<LiveFilters
				{categories}
				bind:category={() => cat, (v) => (category = v)}
				{languages}
				bind:lang
				bind:query
				{view}
				onview={setView}
			/>

			{#if hits.length}
				<section class="hits" aria-labelledby="live-hits-h">
					<h2 id="live-hits-h" class="eyebrow">{t('live.laterInGuide')}</h2>
					<ul>
						{#each hits as h (h.channel.id + h.programme.start)}
							<li>
								<button
									type="button"
									class="hit"
									data-focusable
									onclick={() =>
										openSheet({
											channel: h.channel,
											slot: {
												start: h.programme.start,
												stop: h.programme.stop,
												programme: h.programme
											}
										})}
								>
									<ChannelLogo channel={h.channel} width="2.75rem" />
									<span class="hit-text">
										<span class="hit-title">{h.programme.title}</span>
										<span class="hit-meta">
											{formatDay(h.programme.start, now, i18n.locale)} · {formatTime(
												h.programme.start,
												i18n.locale
											)} · {h.channel.name}
										</span>
									</span>
								</button>
							</li>
						{/each}
					</ul>
				</section>
			{/if}

			{#if !shown.length}
				{#if cat === 'fav' && !query.trim() && !lang}
					<EmptyState icon="star" title={t('live.noFavorites')} body={t('live.noFavoritesBody')} />
				{:else}
					<EmptyState icon="search" title={t('live.noResults')} body={t('live.noResultsBody')}>
						{#snippet actions()}
							{#if filtered}
								<Button variant="glass" onclick={resetFilters}>{t('live.resetFilters')}</Button>
							{/if}
						{/snippet}
					</EmptyState>
				{/if}
			{:else if view === 'guide'}
				<EpgGuide channels={shown} {now} onopen={(channel, slot) => openSheet({ channel, slot })} />
			{:else}
				<ul class="list" aria-label={t('live.channels')}>
					{#each shown as channel (channel.id)}
						<li>
							<ChannelRow
								{channel}
								{now}
								current={channel.id === user.data.lastChannelId}
								onsources={openSources}
								oninfo={openInfo}
							/>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	{/if}
</div>

<Modal bind:open={sheetOpen} label={sheetLabel}>
	{#if sheet}
		<ChannelSheet channel={sheet.channel} slot={sheet.slot} {now} focusSources={sheet.sources} />
	{/if}
</Modal>

<style>
	.head {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 1.5rem;
	}
	.head > div {
		display: grid;
		gap: 0.35rem;
	}
	h1 {
		font-size: var(--text-2xl);
		font-weight: 800;
	}
	.refreshing {
		font-size: var(--text-xs);
		color: var(--text-3);
	}
	.browse {
		display: grid;
		gap: 1.25rem;
		margin-top: 2rem;
		min-width: 0;
	}
	.list {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 25rem), 1fr));
		gap: 0.75rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	/* ---- programme hits ---- */
	.hits {
		display: grid;
		gap: 0.6rem;
	}
	.hits ul {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 17rem), 1fr));
		gap: 0.5rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.hit {
		display: flex;
		align-items: center;
		gap: 0.7rem;
		width: 100%;
		padding: 0.5rem 0.75rem 0.5rem 0.5rem;
		border-radius: var(--radius-m);
		border: 1px solid var(--line);
		background: var(--bg-elev-1);
		text-align: left;
		transition:
			background-color var(--dur) var(--ease-out),
			border-color var(--dur) var(--ease-out);
	}
	.hit:hover {
		background: var(--bg-elev-2);
		border-color: var(--line-strong);
	}
	.hit-text {
		display: grid;
		min-width: 0;
	}
	.hit-title {
		font-size: var(--text-s);
		font-weight: 700;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.hit-meta {
		font-size: var(--text-xs);
		color: var(--text-3);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	/* ---- skeleton ---- */
	.skeleton {
		display: grid;
		gap: 1.5rem;
	}
	.sk-hero {
		display: grid;
		gap: 1.25rem;
		padding: 1.25rem;
		border-radius: var(--radius-xl);
		border: 1px solid var(--line);
	}
	.sk-hero > :global(:first-child) {
		max-width: 22rem;
	}
	.sk-lines {
		display: grid;
		gap: 0.8rem;
		align-content: center;
	}
	.sk-chips {
		display: flex;
		gap: 0.45rem;
		overflow: hidden;
	}
	@media (min-width: 720px) {
		.sk-hero {
			grid-template-columns: minmax(14rem, 22rem) minmax(0, 1fr);
			gap: 2rem;
			padding: 1.75rem;
		}
	}
</style>
