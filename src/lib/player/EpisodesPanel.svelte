<script lang="ts">
	import type { Episode, Season } from '#lib/types.ts';
	import { t } from '#lib/i18n/index.svelte.ts';
	import { user } from '#lib/stores/user.svelte.ts';
	import Icon from './Icon.svelte';

	interface Props {
		titleId: string;
		seasons: Season[];
		currentId?: string;
		onSelect: (ep: Episode) => void;
	}

	let { titleId, seasons, currentId, onSelect }: Props = $props();

	const ordered = $derived(
		[...seasons].sort(
			(a, b) => (a.number || Number.MAX_SAFE_INTEGER) - (b.number || Number.MAX_SAFE_INTEGER)
		)
	);
	const currentSeason = $derived(
		ordered.find((s) => s.episodes.some((e) => e.id === currentId))?.number ?? ordered[0]?.number
	);
	let picked = $state<number | null>(null);
	const season = $derived(picked ?? currentSeason);
	const episodes = $derived(
		[...(ordered.find((s) => s.number === season)?.episodes ?? [])].sort(
			(a, b) => a.episode - b.episode
		)
	);

	function pct(ep: Episode): number {
		const p = user.getProgress(titleId, ep.id);
		if (!p || !p.durationSec) return 0;
		return Math.min(100, (p.positionSec / p.durationSec) * 100);
	}
</script>

{#if ordered.length > 1}
	<div class="seasons" role="tablist">
		{#each ordered as s (s.number)}
			<button
				type="button"
				role="tab"
				data-focusable
				aria-selected={s.number === season}
				onclick={() => (picked = s.number)}
			>
				{t('player.season', { n: s.number })}
			</button>
		{/each}
	</div>
{/if}

<ul>
	{#each episodes as ep (ep.id)}
		{@const progress = pct(ep)}
		<li>
			<button
				type="button"
				class="ep"
				class:current={ep.id === currentId}
				data-focusable
				disabled={!ep.variants.length}
				aria-current={ep.id === currentId ? 'true' : undefined}
				onclick={() => onSelect(ep)}
			>
				<div class="thumb">
					{#if ep.stillUrl}<img src={ep.stillUrl} alt="" loading="lazy" />{/if}
					<span class="num">{ep.episode}</span>
					{#if ep.id === currentId}<span class="playing"><Icon name="play" size={18} /></span>{/if}
					{#if progress > 0}<span class="bar" style:width="{progress}%"></span>{/if}
				</div>
				<div class="text">
					<strong>{ep.title}</strong>
					<span
						>{t('player.episodeCode', { s: ep.season, e: ep.episode })}{#if ep.runtimeMin}
							· {t('player.minutes', { n: ep.runtimeMin })}{/if}</span
					>
					{#if ep.overview}<p>{ep.overview}</p>{/if}
				</div>
			</button>
		</li>
	{/each}
</ul>

<style>
	.seasons {
		display: flex;
		gap: 6px;
		overflow-x: auto;
		padding: 2px 6px 10px;
		scrollbar-width: none;
	}
	.seasons button {
		flex: none;
		padding: 8px 14px;
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-pill);
		background: transparent;
		font-size: 13px;
		font-weight: 700;
		cursor: pointer;
	}
	.seasons button[aria-selected='true'] {
		background: var(--text);
		color: var(--bg);
		border-color: transparent;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 4px;
	}
	.ep {
		display: grid;
		grid-template-columns: 132px 1fr;
		gap: 14px;
		width: 100%;
		padding: 8px;
		border: 0;
		border-radius: var(--radius-m);
		background: transparent;
		text-align: left;
		cursor: pointer;
		transition: background var(--dur-fast);
	}
	.ep:hover,
	.ep:focus-visible {
		background: var(--line);
	}
	.ep.current {
		background: var(--accent-soft);
	}
	.ep:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.thumb {
		position: relative;
		aspect-ratio: 16 / 9;
		border-radius: var(--radius-s);
		overflow: hidden;
		background: linear-gradient(135deg, var(--bg-elev-3), var(--bg-elev-1));
	}
	.thumb img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.num {
		position: absolute;
		left: 8px;
		bottom: 6px;
		font-size: 20px;
		font-weight: 800;
		text-shadow: 0 1px 8px var(--bg);
	}
	.playing {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		background: color-mix(in oklab, var(--bg) 45%, transparent);
		color: var(--text);
	}
	.bar {
		position: absolute;
		left: 0;
		bottom: 0;
		height: 3px;
		background: var(--accent);
	}
	.text {
		display: grid;
		align-content: start;
		gap: 3px;
		min-width: 0;
	}
	strong {
		font-size: 14px;
		line-height: 1.3;
	}
	.text span {
		font-size: 12px;
		color: var(--text-3);
	}
	p {
		margin: 2px 0 0;
		font-size: 12px;
		line-height: 1.45;
		color: var(--text-2);
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
</style>
