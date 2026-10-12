<!--
	Home rows editor: show/hide each row of user.data.homeRows and reorder them (drag the
	grip, or the up/down buttons for remotes and assistive tech). "Restore defaults" resets
	to DEFAULT_HOME_ROWS.
-->
<script lang="ts">
	import type { HomeRowConfig, HomeRowId } from '#lib/types.ts';
	import { t } from '#lib/i18n/index.svelte.ts';
	import { DEFAULT_HOME_ROWS, user } from '#lib/stores/user.svelte.ts';
	import Button from '#lib/components/Button.svelte';
	import Icon, { type IconName } from '#lib/components/Icon.svelte';
	import ReorderList from './ReorderList.svelte';

	const LABEL_KEYS: Record<HomeRowId, string> = {
		continue: 'home.row.continue',
		favorites: 'home.row.favorites',
		recommended: 'home.row.recommended',
		recent: 'home.row.recent',
		'popular-movies': 'home.row.popularMovies',
		'trending-series': 'home.row.trendingSeries',
		live: 'home.row.live',
		genres: 'home.row.genres'
	};
	const ICONS: Record<HomeRowId, IconName> = {
		continue: 'play-circle',
		favorites: 'bookmark',
		recommended: 'sparkle',
		recent: 'clock',
		'popular-movies': 'film',
		'trending-series': 'series',
		live: 'live',
		genres: 'grid'
	};

	/** Stored rows plus any row ids added later (so every row can be configured). */
	const rows = $derived.by<HomeRowConfig[]>(() => {
		const list = user.data.homeRows.filter((r) => r.id in LABEL_KEYS);
		for (const d of DEFAULT_HOME_ROWS)
			if (!list.some((r) => r.id === d.id)) list.push({ id: d.id, visible: false });
		return list;
	});
	const label = (r: HomeRowConfig) => t(LABEL_KEYS[r.id]);
	const visibleCount = $derived(rows.filter((r) => r.visible).length);
	const isDefault = $derived(
		rows.length === DEFAULT_HOME_ROWS.length &&
			rows.every((r, i) => r.id === DEFAULT_HOME_ROWS[i].id && r.visible)
	);

	function setVisible(id: HomeRowId, visible: boolean) {
		user.setHomeRows(rows.map((r) => (r.id === id ? { ...r, visible } : { ...r })));
	}

	function reset() {
		user.setHomeRows(structuredClone(DEFAULT_HOME_ROWS));
	}
</script>

<div class="editor">
	<ReorderList
		items={rows}
		key={(r) => r.id}
		{label}
		ariaLabel={t('settings.home.title')}
		muted={(r) => !r.visible}
		onreorder={(next) => user.setHomeRows(next.map((r) => ({ ...r })))}
	>
		{#snippet row(r)}
			<span class="row-label">
				<span class="ico"><Icon name={ICONS[r.id]} size="1.05rem" /></span>
				<span class="text">{label(r)}</span>
			</span>
		{/snippet}
		{#snippet trailing(r)}
			<button
				type="button"
				class="switch"
				role="switch"
				aria-checked={r.visible}
				aria-label={t('settings.home.show', { row: label(r) })}
				data-focusable
				onclick={() => setVisible(r.id, !r.visible)}
			>
				<span class="thumb"></span>
			</button>
		{/snippet}
	</ReorderList>

	<div class="foot">
		<span class="count">{t('settings.home.count', { n: visibleCount, total: rows.length })}</span>
		<Button
			variant="ghost"
			size="s"
			icon="refresh"
			disabled={isDefault}
			onclick={reset}
			data-focusable
		>
			{t('settings.home.reset')}
		</Button>
	</div>
</div>

<style>
	.editor {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 0.75rem;
	}
	.row-label {
		display: flex;
		align-items: center;
		gap: 0.65rem;
		min-width: 0;
	}
	.ico {
		display: grid;
		place-items: center;
		flex: none;
		width: 2rem;
		height: 2rem;
		border-radius: var(--radius-s);
		background: rgb(255 255 255 / 0.06);
		color: var(--text-2);
	}
	.text {
		font-weight: 650;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	@media (max-width: 420px) {
		.ico {
			display: none;
		}
	}
	.switch {
		position: relative;
		width: 2.75rem;
		height: 1.6rem;
		margin-right: 0.25rem;
		border: 0;
		border-radius: var(--radius-pill);
		background: rgb(255 255 255 / 0.14);
		box-shadow: inset 0 0 0 1px var(--line);
		transition: background-color var(--dur) var(--ease-out);
	}
	.thumb {
		position: absolute;
		top: 0.2rem;
		left: 0.2rem;
		width: 1.2rem;
		height: 1.2rem;
		border-radius: 50%;
		background: #fff;
		box-shadow: var(--shadow-1);
		transition: transform var(--dur) var(--ease-out);
	}
	.switch[aria-checked='true'] {
		background: var(--accent);
	}
	.switch[aria-checked='true'] .thumb {
		transform: translateX(1.15rem);
	}
	.foot {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}
	.count {
		font-size: var(--text-s);
		color: var(--text-3);
	}
</style>
