<!--
	Channel in the list view: logo/monogram, number, name, "Nu" with progress, "Hierna" with time,
	favourite star and, for merged channels, quality/language badges and a "3 bronnen" button.
	The whole row links to the live player (stretched link); the buttons sit above it.
-->
<script lang="ts">
	import type { Channel } from '#lib/types.ts';
	import { i18n, t } from '#lib/i18n/index.svelte.ts';
	import { user } from '#lib/stores/user.svelte.ts';
	import Icon from '#lib/components/Icon.svelte';
	import ProgressBar from '#lib/components/ProgressBar.svelte';
	import QualityBadge from '#lib/components/QualityBadge.svelte';
	import LangBadge from '#lib/components/LangBadge.svelte';
	import { bestQuality, tn } from '#lib/components/format.ts';
	import ChannelLogo from './ChannelLogo.svelte';
	import { formatTime, formatTimeRange, progressAt, sourceCount } from './epg.ts';
	import { shortEpg } from './live.svelte.ts';
	import { liveHref } from '#lib/components/links.ts';

	interface Props {
		channel: Channel;
		now: number;
		/** Mark as the channel watched last. */
		current?: boolean;
		onsources?: (channel: Channel) => void;
		oninfo?: (channel: Channel) => void;
	}

	let { channel, now, current = false, onsources, oninfo }: Props = $props();

	const nn = $derived(shortEpg.nowNext(channel, now));
	const fav = $derived(user.isFavoriteChannel(channel.id));
	const multi = $derived(channel.variants.length > 1);
	const nSources = $derived(sourceCount(channel));
	const quality = $derived(bestQuality(channel.variants.map((v) => v.quality)));
	const label = $derived(
		[
			channel.number != null ? `${channel.number}` : '',
			channel.name,
			nn.now ? t('live.nowOn', { title: nn.now.title }) : ''
		]
			.filter(Boolean)
			.join(', ')
	);

	$effect(() => {
		shortEpg.requestRow(channel);
	});
</script>

<article class="row" class:current>
	<a class="hit" href={liveHref(channel.id)} aria-label={label} data-focusable></a>
	<ChannelLogo {channel} width="5.25rem" />
	<div class="body">
		<div class="title">
			{#if channel.number != null}<span class="num">{channel.number}</span>{/if}
			<strong class="name">{channel.name}</strong>
			{#if current}<span class="sr-only">{t('live.lastWatched')}</span>{/if}
		</div>
		{#if nn.now}
			<p class="now">
				<span class="lbl">{t('live.now')}</span>
				<span class="ptitle">{nn.now.title}</span>
			</p>
			<div class="prog">
				<ProgressBar value={progressAt(nn.now, now)} />
				<span class="time">{formatTimeRange(nn.now.start, nn.now.stop, i18n.locale)}</span>
			</div>
			{#if nn.next}
				<p class="next">
					{t('live.next')}: {nn.next.title} · {formatTime(nn.next.start, i18n.locale)}
				</p>
			{/if}
		{:else}
			<p class="now muted">{t('live.noInfo')}</p>
			{#if nn.next}
				<p class="next">
					{t('live.next')}: {nn.next.title} · {formatTime(nn.next.start, i18n.locale)}
				</p>
			{:else}
				<p class="next">{channel.group}</p>
			{/if}
		{/if}
		{#if multi}
			<div class="badges">
				<QualityBadge {quality} tone="plain" />
				{#if channel.languages.length > 1}
					<LangBadge languages={channel.languages} tone="plain" />
				{/if}
				<button
					type="button"
					class="sources"
					data-focusable
					aria-label={t('live.chooseSourceFor', { name: channel.name })}
					onclick={() => onsources?.(channel)}
				>
					<Icon name="source" size="0.9rem" />
					{nSources > 1
						? tn('live.sources', nSources)
						: tn('live.versions', channel.variants.length)}
				</button>
			</div>
		{/if}
	</div>
	<div class="side">
		<button
			type="button"
			class="icon-btn star"
			class:on={fav}
			aria-pressed={fav}
			aria-label={fav ? t('live.unfavorite') : t('live.favorite')}
			data-focusable
			onclick={() => user.toggleFavoriteChannel(channel.id)}
		>
			<Icon name={fav ? 'star' : 'star-outline'} size="1.15rem" />
		</button>
		<button
			type="button"
			class="icon-btn"
			aria-label={t('live.detailsFor', { name: channel.name })}
			data-focusable
			onclick={() => oninfo?.(channel)}
		>
			<Icon name="info" size="1.15rem" />
		</button>
	</div>
</article>

<style>
	.row {
		position: relative;
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		align-items: center;
		gap: 0.9rem;
		padding: 0.75rem 0.5rem 0.75rem 0.75rem;
		border-radius: var(--radius-l);
		background: var(--bg-elev-1);
		border: 1px solid var(--line);
		content-visibility: auto;
		contain-intrinsic-size: auto 7.5rem;
		transition:
			background-color var(--dur) var(--ease-out),
			border-color var(--dur) var(--ease-out),
			box-shadow var(--dur) var(--ease-out);
	}
	.row.current {
		border-color: color-mix(in oklab, var(--accent) 45%, transparent);
		background: linear-gradient(100deg, var(--accent-faint), transparent 60%), var(--bg-elev-1);
	}
	.hit {
		position: absolute;
		inset: 0;
		z-index: 0;
		border-radius: inherit;
	}
	.hit:focus-visible {
		box-shadow: var(--focus-ring);
	}
	@media (hover: hover) {
		.row:hover {
			background: var(--bg-elev-2);
			border-color: var(--line-strong);
		}
	}
	.row:has(.hit:focus-visible) {
		background: var(--bg-elev-2);
	}
	.row > :global(:not(.hit)) {
		position: relative;
		pointer-events: none;
	}
	.body {
		display: grid;
		gap: 0.3rem;
		min-width: 0;
	}
	.title {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		min-width: 0;
	}
	.num {
		font-size: var(--text-xs);
		font-weight: 700;
		color: var(--text-3);
		font-variant-numeric: tabular-nums;
	}
	.name {
		font-size: var(--text-m);
		font-weight: 750;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.now {
		display: flex;
		gap: 0.4rem;
		min-width: 0;
		font-size: var(--text-s);
		color: var(--text-2);
	}
	.lbl {
		flex: none;
		color: var(--accent-strong);
		font-weight: 700;
	}
	.ptitle {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.muted {
		color: var(--text-3);
	}
	.prog {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
		gap: 0.6rem;
	}
	.time,
	.next {
		font-size: var(--text-xs);
		color: var(--text-3);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.badges {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.35rem;
		margin-top: 0.15rem;
	}
	.sources,
	.icon-btn {
		pointer-events: auto;
	}
	.sources {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		min-height: 1.4rem;
		padding: 0 0.5rem;
		border-radius: var(--radius-xs);
		border: 1px solid color-mix(in oklab, var(--accent) 40%, transparent);
		background: var(--accent-faint);
		color: var(--accent-strong);
		font-size: 0.6875rem;
		font-weight: 750;
		letter-spacing: 0.02em;
		transition:
			background-color var(--dur) var(--ease-out),
			color var(--dur) var(--ease-out);
	}
	.sources:hover {
		background: var(--accent-soft);
		color: var(--text);
	}
	.side {
		display: grid;
		gap: 0.25rem;
		align-self: stretch;
		align-content: center;
	}
	.icon-btn {
		display: grid;
		place-items: center;
		width: 2.5rem;
		height: 2.5rem;
		border: 0;
		border-radius: 50%;
		background: transparent;
		color: var(--text-3);
		transition:
			background-color var(--dur) var(--ease-out),
			color var(--dur) var(--ease-out),
			transform var(--dur-fast) var(--ease-out);
	}
	.icon-btn:hover {
		background: var(--bg-hover);
		color: var(--text);
	}
	.icon-btn:active {
		transform: scale(0.92);
	}
	.star.on {
		color: var(--rating);
	}
</style>
