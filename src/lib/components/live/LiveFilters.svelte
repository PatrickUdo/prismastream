<!--
	Live TV toolbar: instant search (channel name and current programme), language filter,
	list/guide switch and category chips (Alle, Favorieten, channel groups) with counts.
-->
<script lang="ts">
	import type { LangCode } from '#lib/types.ts';
	import { languageName } from '#lib/lang.ts';
	import { i18n, t } from '#lib/i18n/index.svelte.ts';
	import Chip from '#lib/components/Chip.svelte';
	import Icon, { type IconName } from '#lib/components/Icon.svelte';
	import type { CategoryOption, LiveView } from './live.svelte.ts';

	interface Props {
		categories: CategoryOption[];
		category: string;
		languages: { lang: LangCode; count: number }[];
		lang: string;
		query: string;
		view: LiveView;
		onview?: (view: LiveView) => void;
	}

	let {
		categories,
		category = $bindable(),
		languages,
		lang = $bindable(),
		query = $bindable(),
		view,
		onview
	}: Props = $props();

	const id = $props.id();
	let input = $state<HTMLInputElement>();

	const views: { id: LiveView; icon: IconName; label: string }[] = $derived([
		{ id: 'list', icon: 'list', label: t('live.viewList') },
		{ id: 'guide', icon: 'clock', label: t('live.viewGuide') }
	]);
</script>

<div class="filters">
	<div class="top">
		<div class="search">
			<label for="{id}-q" class="sr-only">{t('live.searchLabel')}</label>
			<Icon name="search" size="1.1rem" />
			<input
				id="{id}-q"
				bind:this={input}
				type="search"
				placeholder={t('live.searchPlaceholder')}
				autocomplete="off"
				spellcheck="false"
				enterkeyhint="search"
				data-focusable
				bind:value={query}
				onkeydown={(e) => {
					if (e.key === 'Escape' && query) {
						e.preventDefault();
						query = '';
					}
				}}
			/>
			{#if query}
				<button
					type="button"
					class="clear"
					aria-label={t('live.clearSearch')}
					data-focusable
					onclick={() => {
						query = '';
						input?.focus();
					}}
				>
					<Icon name="close" size="1rem" />
				</button>
			{/if}
		</div>

		{#if languages.length > 1}
			<div class="lang">
				<label for="{id}-lang" class="sr-only">{t('live.languageLabel')}</label>
				<Icon name="globe" size="1.05rem" />
				<select id="{id}-lang" bind:value={lang} data-focusable>
					<option value="">{t('live.allLanguages')}</option>
					{#each languages as l (l.lang)}
						<option value={l.lang}>{languageName(l.lang, i18n.locale)} ({l.count})</option>
					{/each}
				</select>
				<Icon name="chevron-down" size="0.95rem" class="caret" />
			</div>
		{/if}

		<div class="views" role="group" aria-label={t('live.viewLabel')}>
			{#each views as v (v.id)}
				<button
					type="button"
					class="view"
					aria-pressed={view === v.id}
					aria-label={v.label}
					data-focusable
					onclick={() => onview?.(v.id)}
				>
					<Icon name={v.icon} size="1.05rem" />
					<span>{v.label}</span>
				</button>
			{/each}
		</div>
	</div>

	<div class="chips" role="group" aria-label={t('live.categoriesLabel')}>
		{#each categories as c (c.id)}
			<Chip
				selected={category === c.id}
				icon={c.icon}
				hint={c.count}
				aria-pressed={category === c.id}
				data-focusable
				onclick={() => (category = c.id)}
			>
				{c.label}
			</Chip>
		{/each}
	</div>
</div>

<style>
	.filters {
		display: grid;
		gap: 0.85rem;
		min-width: 0;
	}
	.top {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.6rem;
	}
	.search,
	.lang {
		position: relative;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		height: 2.75rem;
		padding: 0 0.9rem;
		border-radius: var(--radius-pill);
		border: 1px solid var(--line);
		background: rgb(255 255 255 / 0.04);
		color: var(--text-3);
		transition:
			border-color var(--dur) var(--ease-out),
			background-color var(--dur) var(--ease-out);
	}
	.search {
		flex: 1 1 16rem;
		min-width: 0;
	}
	.search:focus-within,
	.lang:focus-within {
		border-color: color-mix(in oklab, var(--accent) 60%, transparent);
		background: rgb(255 255 255 / 0.06);
		box-shadow: var(--focus-ring);
	}
	input,
	select {
		flex: 1;
		min-width: 0;
		height: 100%;
		border: 0;
		outline: none;
		background: transparent;
		color: var(--text);
		font-size: var(--text-m);
	}
	input:focus-visible,
	select:focus-visible {
		box-shadow: none;
	}
	input::placeholder {
		color: var(--text-3);
	}
	input::-webkit-search-cancel-button {
		display: none;
	}
	.clear {
		display: grid;
		place-items: center;
		width: 1.9rem;
		height: 1.9rem;
		margin-right: -0.5rem;
		border: 0;
		border-radius: 50%;
		background: var(--bg-hover);
		color: var(--text-2);
	}
	.clear:hover {
		background: var(--bg-press);
		color: var(--text);
	}
	.lang {
		flex: 0 1 auto;
		padding-right: 0.7rem;
	}
	select {
		appearance: none;
		padding-right: 1.4rem;
		margin-right: -1.4rem;
		cursor: pointer;
		font-size: var(--text-s);
		font-weight: 650;
	}
	select option {
		background: var(--bg-elev-2);
		color: var(--text);
	}
	.lang :global(.caret) {
		pointer-events: none;
	}
	.views {
		display: inline-flex;
		padding: 0.2rem;
		border-radius: var(--radius-pill);
		border: 1px solid var(--line);
		background: rgb(255 255 255 / 0.04);
	}
	.view {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		height: 2.25rem;
		padding: 0 0.9rem;
		border: 0;
		border-radius: var(--radius-pill);
		background: transparent;
		color: var(--text-3);
		font-size: var(--text-s);
		font-weight: 700;
		transition:
			background-color var(--dur) var(--ease-out),
			color var(--dur) var(--ease-out);
	}
	.view:hover {
		color: var(--text);
	}
	.view[aria-pressed='true'] {
		background: var(--accent-soft);
		color: var(--text);
	}
	.chips {
		display: flex;
		gap: 0.45rem;
		overflow-x: auto;
		scrollbar-width: none;
		margin-inline: calc(-1 * var(--page-end));
		padding: 0.25rem var(--page-end);
		scroll-padding-inline: var(--page-end);
	}
	.chips::-webkit-scrollbar {
		display: none;
	}
	@media (min-width: 800px) {
		.chips {
			flex-wrap: wrap;
			overflow: visible;
			margin-inline: 0;
			padding-inline: 0;
		}
	}
	@media (max-width: 520px) {
		.search {
			flex-basis: 100%;
		}
		.lang {
			flex: 1 1 auto;
		}
		.view span {
			display: none;
		}
	}
</style>
