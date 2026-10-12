<!--
	Library page body for movies or series: genre chips, sort and audio-language filter
	(all in the query string: ?genre=&sort=&lang=) above an incrementally rendered grid.
-->
<script lang="ts">
	import type { Title } from '#lib/types.ts';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { languageName } from '#lib/lang.ts';
	import { i18n, t } from '#lib/i18n/index.svelte.ts';
	import { catalog } from '#lib/stores/catalog.svelte.ts';
	import { kids } from '#lib/stores/kids.svelte.ts';
	import { genreCounts, languageCounts } from '#lib/recommend.ts';
	import PosterGrid from './PosterGrid.svelte';
	import Chip from './Chip.svelte';
	import Icon from './Icon.svelte';
	import EmptyState from './EmptyState.svelte';
	import Button from './Button.svelte';
	import { libraryHref } from './links.ts';
	import { displayTitle } from './titles.ts';
	import { profilePrefs } from './play.ts';

	type Sort = 'popular' | 'new' | 'az' | 'year';
	const SORTS: Sort[] = ['popular', 'new', 'az', 'year'];

	interface Props {
		kind: 'movie' | 'series';
	}

	let { kind }: Props = $props();

	const params = $derived(page.url.searchParams);
	const genre = $derived(params.get('genre') ?? '');
	const lang = $derived(params.get('lang') ?? '');
	const sort = $derived<Sort>(
		SORTS.includes(params.get('sort') as Sort) ? (params.get('sort') as Sort) : 'popular'
	);

	const loading = $derived(catalog.status === 'idle' || catalog.status === 'loading');
	const base = $derived(kids.visibleTitles.filter((t) => t.kind === kind));
	const genres = $derived(genreCounts(base));
	const langs = $derived.by(() => {
		const preferred = profilePrefs().audioLangs;
		return languageCounts(base).sort((a, b) => {
			const pa = preferred.indexOf(a.code);
			const pb = preferred.indexOf(b.code);
			if (pa !== pb) return (pa === -1 ? 99 : pa) - (pb === -1 ? 99 : pb);
			return b.count - a.count;
		});
	});

	const collator = $derived(new Intl.Collator(i18n.locale, { sensitivity: 'base', numeric: true }));
	const filtered = $derived.by(() => {
		let list = base;
		if (genre) list = list.filter((t) => t.genres.includes(genre));
		if (lang) list = list.filter((t) => t.languages.includes(lang));
		const sorted = [...list];
		const cmp: Record<Sort, (a: Title, b: Title) => number> = {
			popular: (a, b) => b.popularity - a.popularity,
			new: (a, b) => b.addedAt - a.addedAt,
			az: (a, b) => collator.compare(displayTitle(a), displayTitle(b)),
			year: (a, b) =>
				(b.year ?? 0) - (a.year ?? 0) || collator.compare(displayTitle(a), displayTitle(b))
		};
		return sorted.sort(cmp[sort]);
	});

	function href(next: { genre?: string; sort?: string; lang?: string }) {
		const merged = { genre, sort: sort === 'popular' ? '' : sort, lang, ...next };
		if (merged.sort === 'popular') merged.sort = '';
		return libraryHref(kind, merged);
	}

	function update(next: { genre?: string; sort?: string; lang?: string }) {
		void goto(href(next), { replace: true, reset: false });
	}

	const heading = $derived(kind === 'movie' ? t('nav.movies') : t('nav.series'));
	const countText = $derived(
		new Intl.NumberFormat(i18n.locale).format(filtered.length) +
			' ' +
			(filtered.length === 1 ? t('ui.title') : t('ui.titles'))
	);
</script>

<svelte:head>
	<title>{heading} · PrismaStream</title>
</svelte:head>

<div class="page">
	<header class="head">
		<div>
			<span class="eyebrow">{t('ui.library')}</span>
			<h1>{heading}</h1>
		</div>
		{#if !loading}<p class="count" aria-live="polite">{countText}</p>{/if}
	</header>

	<div class="filters" data-sveltekit-reset="false" data-sveltekit-replacestate>
		<nav class="genres" aria-label={t('ui.filterGenre')} data-nav-row>
			<Chip href={href({ genre: '' })} selected={!genre} data-focusable>{t('ui.allGenres')}</Chip>
			{#each genres as g (g.genre)}
				<Chip
					href={href({ genre: g.genre })}
					selected={genre === g.genre}
					hint={g.count}
					data-focusable
				>
					{g.genre}
				</Chip>
			{/each}
		</nav>

		<div class="controls">
			<div class="segmented" role="group" aria-label={t('ui.sortBy')}>
				<Icon name="sort" size="1rem" />
				{#each SORTS as s (s)}
					<button
						type="button"
						aria-pressed={sort === s}
						data-focusable
						onclick={() => update({ sort: s })}
					>
						{t(`ui.sort.${s}`)}
					</button>
				{/each}
			</div>

			<label class="select">
				<Icon name="globe" size="1rem" />
				<span class="sr-only">{t('ui.filterLanguage')}</span>
				<select
					value={lang}
					onchange={(e) => update({ lang: e.currentTarget.value })}
					data-focusable
				>
					<option value="">{t('ui.allLanguages')}</option>
					{#each langs as l (l.code)}
						<option value={l.code}>{languageName(l.code, i18n.locale)} ({l.count})</option>
					{/each}
				</select>
				<Icon name="chevron-down" size="0.9rem" />
			</label>
		</div>
	</div>

	{#if !loading && filtered.length === 0}
		<EmptyState
			icon="film"
			title={base.length ? t('ui.noResults') : t('ui.libraryEmpty')}
			body={base.length ? t('ui.noResultsBody') : t('home.emptyBody')}
		>
			{#snippet actions()}
				{#if base.length}
					<Button variant="glass" href={libraryHref(kind)}>{t('ui.clearFilters')}</Button>
				{/if}
			{/snippet}
		</EmptyState>
	{:else}
		<PosterGrid titles={filtered} {loading} resetKey="{kind}|{genre}|{lang}|{sort}" />
	{/if}
</div>

<style>
	.head {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 1.5rem;
	}
	h1 {
		font-size: var(--text-2xl);
		font-weight: 800;
		margin-top: 0.35rem;
	}
	.count {
		color: var(--text-3);
		font-size: var(--text-s);
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}

	.filters {
		position: sticky;
		top: calc(var(--safe-top) + var(--topbar-h));
		z-index: 5;
		display: grid;
		gap: 0.85rem;
		margin: 0 calc(-1 * var(--page-end)) 1.75rem calc(-1 * var(--page-start) + var(--shell-left));
		padding: 0.85rem var(--page-end) 0.85rem calc(var(--page-start) - var(--shell-left));
		background: linear-gradient(180deg, rgb(7 7 11 / 0.92) 70%, rgb(7 7 11 / 0));
	}
	@media (min-width: 800px) {
		.filters {
			top: 0;
		}
	}
	.genres {
		display: flex;
		gap: 0.5rem;
		overflow-x: auto;
		scrollbar-width: none;
		margin: -0.35rem calc(-1 * var(--page-end)) -0.35rem 0;
		padding: 0.35rem var(--page-end) 0.35rem 0.25rem;
		mask: linear-gradient(90deg, #000 calc(100% - 3rem), transparent);
	}
	.genres::-webkit-scrollbar {
		display: none;
	}
	.controls {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		align-items: center;
	}
	.segmented {
		display: inline-flex;
		align-items: center;
		gap: 0.15rem;
		padding: 0.25rem 0.25rem 0.25rem 0.75rem;
		border-radius: var(--radius-pill);
		background: rgb(255 255 255 / 0.04);
		border: 1px solid var(--line);
		color: var(--text-3);
	}
	.segmented :global(.icon) {
		margin-right: 0.35rem;
	}
	.segmented button {
		min-height: 2rem;
		padding: 0 0.85rem;
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
	@media (hover: hover) {
		.segmented button:hover {
			color: var(--text);
		}
	}
	/* Touch: extend the 32 px segments to a 44 px hit area without changing the look. */
	@media (pointer: coarse) {
		.segmented button {
			position: relative;
		}
		.segmented button::after {
			content: '';
			position: absolute;
			inset: -0.4rem 0;
		}
		.select {
			min-height: 2.75rem;
		}
	}
	.segmented button[aria-pressed='true'] {
		background: var(--bg-elev-3);
		color: var(--text);
		box-shadow:
			inset 0 1px 0 rgb(255 255 255 / 0.08),
			var(--shadow-1);
	}
	.select {
		position: relative;
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		min-height: 2.6rem;
		padding: 0 0.85rem;
		border-radius: var(--radius-pill);
		background: rgb(255 255 255 / 0.04);
		border: 1px solid var(--line);
		color: var(--text-3);
	}
	.select:focus-within {
		box-shadow: var(--focus-ring);
	}
	select {
		/* Fill the pill so the whole 44 px control is the tap target. */
		align-self: stretch;
		appearance: none;
		border: 0;
		background: transparent;
		color: var(--text);
		font-size: var(--text-s);
		font-weight: 650;
		padding-right: 0.25rem;
		cursor: pointer;
		outline: none;
	}
	select:focus-visible,
	:global(html[data-input='remote']) select:focus {
		box-shadow: none;
	}
	option {
		background: var(--bg-elev-2);
		color: var(--text);
	}
	@media (max-width: 599.98px) {
		.segmented {
			width: 100%;
			justify-content: space-between;
		}
		.segmented button {
			padding: 0 0.6rem;
		}
	}
</style>
