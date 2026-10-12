<script lang="ts">
	import type { Channel } from '#lib/types.ts';
	import { t } from '#lib/i18n/index.svelte.ts';
	import { user } from '#lib/stores/user.svelte.ts';
	import { library } from '#lib/catalog/library.svelte.ts';
	import Icon from './Icon.svelte';

	interface Props {
		channels: Channel[];
		currentId?: string;
		/** Epoch ms used for now/next (refreshed by the page). */
		now: number;
		onSelect: (ch: Channel) => void;
	}

	let { channels, currentId, now, onSelect }: Props = $props();

	let tab = $state<'all' | 'fav'>('all');
	const list = $derived(
		tab === 'fav' ? channels.filter((c) => user.isFavoriteChannel(c.id)) : channels
	);

	$effect(() => {
		// Keep the current channel in view when the panel opens.
		void list;
		const el = document.querySelector<HTMLElement>('[data-channel-current]');
		el?.scrollIntoView({ block: 'center' });
	});
</script>

<div class="tabs" role="tablist">
	<button
		type="button"
		role="tab"
		data-focusable
		aria-selected={tab === 'all'}
		onclick={() => (tab = 'all')}>{t('player.all')}</button
	>
	<button
		type="button"
		role="tab"
		data-focusable
		aria-selected={tab === 'fav'}
		onclick={() => (tab = 'fav')}>{t('player.favorites')}</button
	>
</div>

{#if !list.length}
	<p class="empty">{t('player.noFavorites')}</p>
{/if}

<ul>
	{#each list as ch (ch.id)}
		{@const nn = library.nowNext(ch, now)}
		{@const fav = user.isFavoriteChannel(ch.id)}
		<li class:current={ch.id === currentId}>
			<button
				type="button"
				class="ch"
				data-focusable
				data-channel-current={ch.id === currentId ? '' : undefined}
				aria-current={ch.id === currentId ? 'true' : undefined}
				onclick={() => onSelect(ch)}
			>
				<span class="logo">
					{#if ch.logoUrl}<img src={ch.logoUrl} alt="" loading="lazy" />{:else}{ch.name.slice(
							0,
							2
						)}{/if}
				</span>
				<span class="text">
					<strong
						>{#if ch.number}<span class="no">{ch.number}</span>{/if}{ch.name}</strong
					>
					<span class="prog">{nn.now?.title ?? t('player.noEpg')}</span>
					{#if nn.now}
						<span class="bar"
							><span
								style:width="{Math.min(
									100,
									((now - nn.now.start) / Math.max(1, nn.now.stop - nn.now.start)) * 100
								)}%"
							></span></span
						>
					{/if}
				</span>
			</button>
			<button
				type="button"
				class="star"
				class:on={fav}
				data-focusable
				aria-label={fav ? t('player.removeFavorite') : t('player.addFavorite')}
				aria-pressed={fav}
				onclick={() => user.toggleFavoriteChannel(ch.id)}
			>
				<Icon name={fav ? 'starFilled' : 'star'} size={22} />
			</button>
		</li>
	{/each}
</ul>

<style>
	.tabs {
		display: flex;
		gap: 6px;
		padding: 2px 6px 10px;
	}
	.tabs button {
		padding: 8px 16px;
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-pill);
		background: transparent;
		font-size: 13px;
		font-weight: 700;
		cursor: pointer;
	}
	.tabs button[aria-selected='true'] {
		background: var(--text);
		color: var(--bg);
		border-color: transparent;
	}
	.empty {
		margin: 12px 14px;
		color: var(--text-3);
		font-size: 14px;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 2px;
	}
	li {
		display: flex;
		align-items: center;
		gap: 4px;
		border-radius: var(--radius-m);
	}
	li.current {
		background: var(--accent-soft);
	}
	.ch {
		flex: 1;
		display: flex;
		align-items: center;
		gap: 12px;
		min-width: 0;
		padding: 8px;
		border: 0;
		border-radius: var(--radius-m);
		background: transparent;
		text-align: left;
		cursor: pointer;
	}
	.ch:hover,
	.ch:focus-visible {
		background: var(--line);
	}
	.logo {
		flex: none;
		display: grid;
		place-items: center;
		width: 64px;
		height: 40px;
		border-radius: var(--radius-s);
		background: var(--bg-elev-3);
		font-size: 13px;
		font-weight: 800;
		text-transform: uppercase;
		color: var(--text-2);
		overflow: hidden;
	}
	.logo img {
		max-width: 86%;
		max-height: 80%;
		object-fit: contain;
	}
	.text {
		display: grid;
		gap: 3px;
		min-width: 0;
		flex: 1;
	}
	strong {
		font-size: 14px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.no {
		margin-right: 8px;
		color: var(--text-3);
		font-variant-numeric: tabular-nums;
	}
	.prog {
		font-size: 12px;
		color: var(--text-2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.bar {
		height: 3px;
		border-radius: var(--radius-pill);
		background: var(--line-strong);
		overflow: hidden;
	}
	.bar span {
		display: block;
		height: 100%;
		background: var(--accent);
	}
	.star {
		flex: none;
		display: grid;
		place-items: center;
		width: 44px;
		height: 44px;
		border: 0;
		border-radius: 50%;
		background: transparent;
		color: var(--text-3);
		cursor: pointer;
	}
	.star:hover {
		background: var(--line);
	}
	.star.on {
		color: var(--accent);
	}
</style>
