<!--
	Search: large field with autofocus, instant results (120 ms debounce, ?q= in the url),
	grouped in movies, series, people, channels and genres. Each merged title appears once
	and also matches alternative/translated titles ("Also known as"). Without a query:
	recent searches (per profile), popular genres and trending titles.
-->
<script lang="ts">
	import type { TitleCard as Card } from '#lib/types.ts';
	import { afterNavigate, replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { i18n, t } from '#lib/i18n/index.svelte.ts';
	import { user } from '#lib/stores/user.svelte.ts';
	import { kids } from '#lib/stores/kids.svelte.ts';
	import { library } from '#lib/catalog/library.svelte.ts';
	import { resource } from '#lib/catalog/resource.svelte.ts';
	import { addRecent, clearRecent, loadRecent, removeRecent } from '#lib/search/recent.ts';
	import TitleCard from '#lib/components/TitleCard.svelte';
	import ChannelCard from '#lib/components/ChannelCard.svelte';
	import CastCard from '#lib/components/CastCard.svelte';
	import GenreTile from '#lib/components/GenreTile.svelte';
	import Chip from '#lib/components/Chip.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import Button from '#lib/components/Button.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import Skeleton from '#lib/components/Skeleton.svelte';
	import { libraryHref, path, titleHref } from '#lib/components/links.ts';
	import { displayTitle } from '#lib/components/titles.ts';

	const PAGE = 18;

	let input = $state<HTMLInputElement>();
	let resultsEl = $state<HTMLDivElement>();
	let text = $state(page.url.searchParams.get('q') ?? '');
	let query = $state(page.url.searchParams.get('q') ?? '');
	let timer: ReturnType<typeof setTimeout> | undefined;

	// Back/forward or a link to /search?q=… while this page is open.
	afterNavigate(() => {
		const q = page.url.searchParams.get('q') ?? '';
		if (q !== query) text = query = q;
	});

	$effect(() => {
		input?.focus();
		return () => clearTimeout(timer);
	});

	function commit(value: string) {
		clearTimeout(timer);
		query = value;
		const q = value.trim();
		try {
			replaceState(path(q ? `/search?q=${encodeURIComponent(q)}` : '/search'), page.state);
		} catch {
			// Router not ready yet; the url just stays behind.
		}
	}

	function oninput() {
		clearTimeout(timer);
		timer = setTimeout(() => commit(text), 120);
	}

	function setQuery(q: string) {
		text = q;
		commit(q);
		input?.focus();
	}

	// ---- Results (local index or the backend search; previous request aborted) --------------
	const q = $derived(query.trim());
	const search = resource(
		() => (library.initialized && q ? `${library.version}|${kids.active}|${q}` : null),
		async (_k, signal) => {
			// The input is debounced already; remote mode waits a little more per keystroke.
			if (library.mode === 'remote')
				await new Promise<void>((resolve, reject) => {
					const timer = setTimeout(resolve, 180);
					signal.addEventListener('abort', () => {
						clearTimeout(timer);
						reject(new DOMException('Aborted', 'AbortError'));
					});
				});
			return library.provider.search(q, { kids: kids.active }, signal);
		}
	);
	const results = $derived(
		q && search.value && search.key?.endsWith(`|${q}`) ? search.value : null
	);
	const loading = $derived(!!q && !results && (search.loading || library.status === 'loading'));

	type GroupId = 'movies' | 'series' | 'people' | 'channels' | 'genres';
	const groups = $derived.by(() => {
		if (!results) return [];
		const list: { id: GroupId; count: number; score: number }[] = [
			{ id: 'movies', count: results.movies.length, score: results.movies[0]?.score ?? 0 },
			{ id: 'series', count: results.series.length, score: results.series[0]?.score ?? 0 },
			{ id: 'people', count: results.people.length, score: results.people[0]?.score ?? 0 },
			{ id: 'channels', count: results.channels.length, score: results.channels[0]?.score ?? 0 },
			{ id: 'genres', count: results.genres.length, score: results.genres[0]?.score ?? 0 }
		];
		// Strongest group first (e.g. an actor's name puts "People" on top).
		return list.filter((g) => g.count > 0).sort((a, b) => b.score - a.score);
	});
	const totalShown = $derived(groups.reduce((n, g) => n + g.count, 0));

	// Expanded groups; reset for every new query.
	let expanded = $derived.by<Record<string, boolean>>(() => {
		void q;
		return {};
	});

	// ---- Without a query ----------------------------------------------------------
	let recent = $derived(loadRecent(user.activeId));
	const facets = resource(
		() => (library.initialized ? `${library.version}|${kids.active}` : null),
		(_k, signal) => library.provider.facets({ kids: kids.active }, signal)
	);
	const genres = $derived(
		[...(facets.value?.genres ?? [])].sort((a, b) => (b.count ?? 0) - (a.count ?? 0)).slice(0, 14)
	);
	const popular = resource(
		() => (library.initialized ? `${library.version}|${kids.active}` : null),
		(_k, signal) =>
			library.provider.titles({ sort: 'popular', limit: 12, kids: kids.active }, signal)
	);
	const trending = $derived(kids.filterTitles(popular.value?.items ?? []).slice(0, 12));

	function remember() {
		if (q) recent = addRecent(user.activeId, q);
	}

	// ---- Live "now" for channel cards -------------------------------------------------
	let now = $state(Date.now());
	$effect(() => {
		const id = setInterval(() => (now = Date.now()), 30_000);
		return () => clearInterval(id);
	});

	// ---- Keyboard -------------------------------------------------------------------
	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'ArrowDown') {
			const first = resultsEl?.querySelector<HTMLElement>('[data-focusable]');
			if (first) {
				e.preventDefault();
				first.focus();
			}
		} else if (e.key === 'Enter') {
			commit(text);
			remember();
		} else if (e.key === 'Escape' && text) {
			e.preventDefault();
			setQuery('');
		}
	}

	function onresultsclick(e: MouseEvent) {
		if ((e.target as HTMLElement).closest('a')) remember();
	}

	const genreHref = (g: { slug: string; movies: number }) =>
		libraryHref(g.movies > 0 ? 'movie' : 'series', { genre: g.slug });
	const fmt = (n: number) => new Intl.NumberFormat(i18n.locale).format(n);
</script>

<svelte:head>
	<title>{q ? `${q} · ` : ''}{t('nav.search')} · PrismaStream</title>
</svelte:head>

{#snippet titleGrid(hits: { title: Card; aka?: string }[], id: string)}
	{@const shown = expanded[id] ? hits : hits.slice(0, PAGE)}
	<ul class="grid">
		{#each shown as hit, i (hit.title.id)}
			<li>
				<TitleCard title={hit.title} eager={i < 6} />
				{#if hit.aka && hit.aka !== displayTitle(hit.title)}
					<p class="aka">{t('search.aka', { title: hit.aka })}</p>
				{/if}
			</li>
		{/each}
	</ul>
	{#if hits.length > PAGE && !expanded[id]}
		<div class="more">
			<Button
				variant="glass"
				size="s"
				icon="chevron-down"
				onclick={() => (expanded = { ...expanded, [id]: true })}
				data-focusable
			>
				{t('search.showAll', { n: hits.length })}
			</Button>
		</div>
	{/if}
{/snippet}

<div class="page">
	<form class="bar" role="search" onsubmit={(e) => e.preventDefault()}>
		<label class="sr-only" for="search-input">{t('search.label')}</label>
		<span class="glass-ico" aria-hidden="true"><Icon name="search" size="1.5rem" /></span>
		<input
			id="search-input"
			bind:this={input}
			bind:value={text}
			{oninput}
			{onkeydown}
			type="search"
			enterkeyhint="search"
			autocomplete="off"
			autocapitalize="off"
			spellcheck="false"
			placeholder={kids.active ? t('search.placeholderKids') : t('search.placeholder')}
			aria-describedby="search-status"
			aria-controls="search-results"
			data-focusable
		/>
		{#if text}
			<button
				type="button"
				class="clear"
				aria-label={t('search.clear')}
				onclick={() => setQuery('')}
				data-focusable
			>
				<Icon name="close" size="1.2rem" />
			</button>
		{/if}
	</form>

	<p class="status" id="search-status" aria-live="polite">
		{#if q && results}
			{totalShown === 0
				? t('search.noneShort')
				: t(totalShown === 1 ? 'search.count.one' : 'search.count.other', { n: fmt(totalShown) })}
		{/if}
	</p>

	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="results" id="search-results" bind:this={resultsEl} onclick={onresultsclick}>
		{#if q && loading}
			<ul class="grid" aria-busy="true" aria-label={t('common.loading')}>
				{#each Array.from({ length: 12 }, (_, i) => i) as i (i)}
					<li><Skeleton shape="poster" /></li>
				{/each}
			</ul>
		{:else if q && results && totalShown === 0}
			<EmptyState
				icon="search"
				title={t('search.empty', { q })}
				body={kids.active ? t('search.emptyBodyKids') : t('search.emptyBody')}
			>
				{#snippet actions()}
					<Button variant="glass" icon="close" onclick={() => setQuery('')} data-focusable>
						{t('search.clear')}
					</Button>
				{/snippet}
			</EmptyState>
			{#if genres.length}
				<section class="block">
					<h2 class="bh">{t('search.tryGenre')}</h2>
					<div class="chips">
						{#each genres.slice(0, 8) as g (g.slug)}
							<Chip href={libraryHref('movie', { genre: g.slug })} data-focusable>{g.name}</Chip>
						{/each}
					</div>
				</section>
			{/if}
		{:else if q && results}
			{#each groups as g (g.id)}
				<section class="block" aria-labelledby="g-{g.id}">
					<h2 class="bh" id="g-{g.id}">
						{t(`search.group.${g.id}`)}
						<span class="n">{fmt(g.count)}</span>
					</h2>
					{#if g.id === 'movies'}
						{@render titleGrid(results.movies, 'movies')}
					{:else if g.id === 'series'}
						{@render titleGrid(results.series, 'series')}
					{:else if g.id === 'people'}
						<ul class="people">
							{#each results.people as p (p.name)}
								<li class="person">
									<div class="ph">
										<CastCard person={{ name: p.name, profileUrl: p.profileUrl }} />
									</div>
									<div class="known">
										<span class="eyebrow">{t('search.knownFor')}</span>
										<ul>
											{#each p.titles.slice(0, 4) as tt (tt.id)}
												<li>
													<a href={titleHref(tt.id)} data-focusable>
														{displayTitle(tt)}{#if tt.year}<span class="yr">{tt.year}</span>{/if}
													</a>
												</li>
											{/each}
										</ul>
										{#if p.titles.length > 4}
											<button
												type="button"
												class="link"
												onclick={() => setQuery(p.name)}
												data-focusable
											>
												{t('search.allTitlesOf', { n: p.titles.length })}
											</button>
										{/if}
									</div>
								</li>
							{/each}
						</ul>
					{:else if g.id === 'channels'}
						<ul class="channels">
							{#each results.channels as c (c.channel.id)}
								<li><ChannelCard channel={c.channel} {now} /></li>
							{/each}
						</ul>
					{:else if g.id === 'genres'}
						<ul class="genres">
							{#each results.genres as gg (gg.slug)}
								<li>
									<GenreTile genre={gg.genre} count={gg.movies + gg.series} href={genreHref(gg)} />
								</li>
							{/each}
						</ul>
					{/if}
				</section>
			{/each}
		{:else}
			<!-- No query ------------------------------------------------------------ -->
			{#if recent.length}
				<section class="block">
					<div class="bh-row">
						<h2 class="bh">{t('search.recent')}</h2>
						<Button
							variant="ghost"
							size="s"
							onclick={() => (recent = clearRecent(user.activeId))}
							data-focusable
						>
							{t('search.clearRecent')}
						</Button>
					</div>
					<ul class="recent">
						{#each recent as r (r)}
							<li>
								<button type="button" class="recent-q" onclick={() => setQuery(r)} data-focusable>
									<Icon name="clock" size="1rem" />
									<span>{r}</span>
								</button>
								<button
									type="button"
									class="recent-x"
									aria-label={t('search.removeRecent', { q: r })}
									onclick={() => (recent = removeRecent(user.activeId, r))}
									data-focusable
								>
									<Icon name="close" size="0.9rem" />
								</button>
							</li>
						{/each}
					</ul>
				</section>
			{/if}

			{#if genres.length}
				<section class="block">
					<h2 class="bh">{t('search.popularGenres')}</h2>
					<div class="chips">
						{#each genres as g (g.slug)}
							<Chip href={libraryHref('movie', { genre: g.slug })} hint={g.count} data-focusable>
								{g.name}
							</Chip>
						{/each}
					</div>
				</section>
			{/if}

			{#if trending.length}
				<section class="block">
					<h2 class="bh">{t('search.trending')}</h2>
					<ul class="grid">
						{#each trending as title, i (title.id)}
							<li><TitleCard {title} eager={i < 6} /></li>
						{/each}
					</ul>
				</section>
			{:else if loading}
				<ul class="grid" aria-busy="true" aria-label={t('common.loading')}>
					{#each Array.from({ length: 12 }, (_, i) => i) as i (i)}
						<li><Skeleton shape="poster" /></li>
					{/each}
				</ul>
			{/if}
		{/if}
	</div>
</div>

<style>
	.bar {
		position: relative;
		display: flex;
		align-items: center;
		max-width: 56rem;
		border-radius: var(--radius-xl);
		background: var(--bg-glass);
		backdrop-filter: var(--glass-blur);
		-webkit-backdrop-filter: var(--glass-blur);
		border: 1px solid var(--line-strong);
		box-shadow: var(--shadow-2);
		transition:
			border-color var(--dur) var(--ease-out),
			box-shadow var(--dur) var(--ease-out);
	}
	.bar:focus-within {
		border-color: color-mix(in oklab, var(--accent) 70%, transparent);
		box-shadow:
			var(--shadow-2),
			0 0 0 4px var(--accent-faint),
			0 20px 60px -24px var(--accent-glow);
	}
	.glass-ico {
		position: absolute;
		left: 1.25rem;
		color: var(--text-3);
		pointer-events: none;
	}
	.bar:focus-within .glass-ico {
		color: var(--accent-strong);
	}
	input {
		flex: 1;
		min-width: 0;
		height: clamp(3.5rem, 3rem + 1.6vw, 4.5rem);
		padding: 0 3.5rem 0 3.6rem;
		border: 0;
		background: transparent;
		font-size: clamp(1.15rem, 1rem + 0.8vw, 1.6rem);
		font-weight: 650;
		letter-spacing: -0.01em;
	}
	input:focus,
	input:focus-visible {
		outline: none;
		box-shadow: none;
	}
	input::placeholder {
		color: var(--text-3);
		font-weight: 550;
	}
	input::-webkit-search-cancel-button {
		display: none;
	}
	.clear {
		position: absolute;
		right: 0.75rem;
		display: grid;
		place-items: center;
		width: 2.5rem;
		height: 2.5rem;
		border: 0;
		border-radius: 50%;
		background: rgb(255 255 255 / 0.08);
		color: var(--text-2);
	}
	.clear:hover {
		background: var(--bg-press);
		color: var(--text);
	}
	.status {
		min-height: 1.5rem;
		margin: 0.85rem 0 0.5rem 0.25rem;
		color: var(--text-3);
		font-size: var(--text-s);
		font-weight: 600;
	}
	.results {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: clamp(1.75rem, 1.2rem + 1.5vw, 2.75rem);
		margin-top: 1rem;
	}
	.block {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 1rem;
		animation: fade-up var(--dur-slow) var(--ease-out) both;
	}
	@keyframes fade-up {
		from {
			opacity: 0;
			transform: translateY(8px);
		}
	}
	.bh {
		display: flex;
		align-items: baseline;
		gap: 0.6rem;
		font-size: var(--text-xl);
	}
	.bh .n {
		font-size: var(--text-s);
		font-weight: 700;
		color: var(--text-3);
		font-variant-numeric: tabular-nums;
	}
	.bh-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(var(--card-w), 42vw), 1fr));
		gap: clamp(1rem, 0.6rem + 1.2vw, 1.75rem) clamp(0.6rem, 0.4rem + 0.8vw, 1.1rem);
		margin: 0;
		padding: 0;
		list-style: none;
	}
	@media (max-width: 520px) {
		.grid {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
	}
	.aka {
		margin-top: 0.4rem;
		color: var(--text-3);
		font-size: var(--text-xs);
		font-weight: 600;
		line-height: 1.35;
		overflow: hidden;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
	}
	.more {
		display: flex;
		justify-content: center;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	.people {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(17rem, 100%), 1fr));
		gap: 1rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.person {
		display: grid;
		grid-template-columns: 5.5rem minmax(0, 1fr);
		gap: 1rem;
		align-items: start;
		padding: 1rem;
		border-radius: var(--radius-l);
		background: rgb(255 255 255 / 0.035);
		border: 1px solid var(--line);
	}
	.known {
		display: grid;
		gap: 0.4rem;
		min-width: 0;
	}
	.known ul {
		display: grid;
		gap: 0.15rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.known a {
		display: flex;
		align-items: baseline;
		gap: 0.4rem;
		padding: 0.2rem 0.35rem;
		margin-left: -0.35rem;
		border-radius: var(--radius-xs);
		font-weight: 650;
		font-size: var(--text-s);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.known a:hover {
		background: var(--bg-hover);
		color: var(--accent-strong);
	}
	.yr {
		color: var(--text-3);
		font-weight: 550;
		font-size: var(--text-xs);
	}
	.link {
		justify-self: start;
		padding: 0.2rem 0.35rem;
		margin-left: -0.35rem;
		border: 0;
		border-radius: var(--radius-xs);
		background: none;
		color: var(--accent-strong);
		font-size: var(--text-xs);
		font-weight: 700;
	}
	.channels {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(var(--card-w-wide), 100%), 1fr));
		gap: 1rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.genres {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(15rem, 100%), 1fr));
		gap: 1rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.recent {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.recent li {
		display: flex;
		align-items: center;
		border-radius: var(--radius-pill);
		border: 1px solid var(--line);
		background: rgb(255 255 255 / 0.04);
		transition:
			background-color var(--dur) var(--ease-out),
			border-color var(--dur) var(--ease-out);
	}
	.recent li:hover {
		background: var(--bg-hover);
		border-color: var(--line-strong);
	}
	.recent-q {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-height: 2.5rem;
		padding: 0 0.4rem 0 0.95rem;
		border: 0;
		border-radius: var(--radius-pill);
		background: none;
		color: var(--text-2);
		font-size: var(--text-s);
		font-weight: 650;
	}
	.recent-q:hover {
		color: var(--text);
	}
	.recent-x {
		display: grid;
		place-items: center;
		width: 2.25rem;
		height: 2.25rem;
		margin-right: 0.15rem;
		border: 0;
		border-radius: 50%;
		background: none;
		color: var(--text-3);
	}
	.recent-x:hover {
		color: var(--text);
		background: var(--bg-press);
	}
</style>
