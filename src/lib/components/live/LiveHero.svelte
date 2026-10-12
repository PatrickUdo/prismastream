<!--
	"Nu live" hero: the channel watched last (or a featured one) with the current programme,
	its progress, what is on later, and 'Kijk live'.
-->
<script lang="ts">
	import type { Channel } from '#lib/types.ts';
	import { i18n, t } from '#lib/i18n/index.svelte.ts';
	import { user } from '#lib/stores/user.svelte.ts';
	import Button from '#lib/components/Button.svelte';
	import ProgressBar from '#lib/components/ProgressBar.svelte';
	import QualityBadge from '#lib/components/QualityBadge.svelte';
	import LangBadge from '#lib/components/LangBadge.svelte';
	import { hashString } from '#lib/components/art.ts';
	import { bestQuality, tn } from '#lib/components/format.ts';
	import ChannelLogo from './ChannelLogo.svelte';
	import { formatTime, formatTimeRange, minutesLeft, progressAt, sourceCount } from './epg.ts';
	import { shortEpg } from './live.svelte.ts';
	import { liveHref } from '#lib/components/links.ts';

	interface Props {
		channel: Channel;
		now: number;
		kind: 'last' | 'featured';
		onsources?: (channel: Channel) => void;
		oninfo?: (channel: Channel) => void;
	}

	let { channel, now, kind, onsources, oninfo }: Props = $props();

	const nn = $derived(shortEpg.nowNext(channel, now));
	const fav = $derived(user.isFavoriteChannel(channel.id));
	const hue = $derived(hashString(channel.id) % 360);
	const quality = $derived(bestQuality(channel.variants.map((v) => v.quality)));
	const nSources = $derived(sourceCount(channel));
	const id = $props.id();

	$effect(() => {
		shortEpg.request(channel);
	});
</script>

<section class="hero" style:--hue={hue} aria-labelledby="{id}-h">
	<div class="art" aria-hidden="true"></div>
	<div class="logo">
		<ChannelLogo {channel} width="100%" ratio="16 / 10" />
		<span class="live-pill"><span class="dot"></span>{t('common.live')}</span>
	</div>
	<div class="meta">
		<p class="eyebrow">
			{kind === 'last' ? t('live.heroLast') : t('live.heroFeatured')}
		</p>
		<div class="channel">
			{#if channel.number != null}<span class="num">{channel.number}</span>{/if}
			<span class="cname">{channel.name}</span>
			{#if channel.variants.length > 1}
				<QualityBadge {quality} tone="plain" />
				<LangBadge languages={channel.languages} tone="plain" />
			{/if}
		</div>
	</div>
	<div class="content">
		<h2 id="{id}-h">{nn.now?.title ?? channel.name}</h2>
		{#if nn.now}
			<div class="progress">
				<span class="t">{formatTime(nn.now.start, i18n.locale)}</span>
				<ProgressBar
					value={progressAt(nn.now, now)}
					size="m"
					label={t('live.progressLabel', { min: minutesLeft(nn.now, now) })}
				/>
				<span class="t">{formatTime(nn.now.stop, i18n.locale)}</span>
			</div>
			{#if nn.now.desc}<p class="desc">{nn.now.desc}</p>{/if}
		{:else}
			<p class="desc muted">{t('live.noInfoBody')}</p>
		{/if}
		{#if nn.next}
			<p class="later">
				<span class="lbl">{t('live.later')}</span>
				<span class="ltitle">{nn.next.title}</span>
				<span class="ltime">{formatTimeRange(nn.next.start, nn.next.stop, i18n.locale)}</span>
			</p>
		{/if}
		<div class="actions">
			<Button variant="primary" size="l" icon="play" href={liveHref(channel.id)} data-focusable>
				{t('live.watchLive')}
			</Button>
			{#if channel.variants.length > 1}
				<Button
					variant="glass"
					size="l"
					icon="source"
					onclick={() => onsources?.(channel)}
					data-focusable
				>
					{nSources > 1 ? tn('live.sources', nSources) : t('live.chooseSource')}
				</Button>
			{/if}
			<Button
				variant="icon"
				size="l"
				icon={fav ? 'star' : 'star-outline'}
				pressed={fav}
				label={fav ? t('live.unfavorite') : t('live.favorite')}
				onclick={() => user.toggleFavoriteChannel(channel.id)}
				data-focusable
			/>
			<Button
				variant="icon"
				size="l"
				icon="info"
				label={t('live.detailsFor', { name: channel.name })}
				onclick={() => oninfo?.(channel)}
				data-focusable
			/>
		</div>
	</div>
</section>

<style>
	.hero {
		position: relative;
		display: grid;
		grid-template-columns: 6.5rem minmax(0, 1fr);
		grid-template-areas:
			'logo meta'
			'main main';
		gap: 1rem 1rem;
		padding: 1.25rem;
		border-radius: var(--radius-xl);
		border: 1px solid var(--line);
		background: var(--bg-elev-1);
		overflow: hidden;
		isolation: isolate;
	}
	.art {
		position: absolute;
		inset: 0;
		z-index: -1;
		background:
			radial-gradient(60% 90% at 12% 10%, hsl(var(--hue) 70% 45% / 0.28), transparent 70%),
			radial-gradient(50% 80% at 95% 110%, var(--accent-faint), transparent 70%),
			var(--spectrum-soft);
		opacity: 0.85;
	}
	.art::after {
		content: '';
		position: absolute;
		inset: 0;
		background-image: var(--grain);
		background-size: 180px;
		opacity: 0.07;
		mix-blend-mode: overlay;
	}
	.logo {
		grid-area: logo;
		position: relative;
		align-self: center;
		border-radius: var(--radius-l);
		box-shadow: var(--shadow-2);
	}
	.logo :global(.logo) {
		border-radius: var(--radius-l);
	}
	.live-pill {
		display: none;
		position: absolute;
		top: 0.6rem;
		left: 0.6rem;
		align-items: center;
		gap: 0.4rem;
		padding: 0.25rem 0.55rem;
		border-radius: var(--radius-xs);
		background: rgb(10 10 16 / 0.6);
		font-size: 0.6875rem;
		font-weight: 800;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}
	.dot {
		width: 0.45rem;
		height: 0.45rem;
		border-radius: 50%;
		background: var(--live);
		box-shadow: 0 0 8px var(--live);
		animation: pulse 2.4s var(--ease-in-out) infinite;
	}
	.meta {
		grid-area: meta;
		display: grid;
		align-content: center;
		gap: 0.4rem;
		min-width: 0;
	}
	.content {
		grid-area: main;
		display: grid;
		align-content: start;
		gap: 0.7rem;
		min-width: 0;
	}
	.channel {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		color: var(--text-2);
		font-weight: 700;
	}
	.num {
		color: var(--text-3);
		font-variant-numeric: tabular-nums;
	}
	h2 {
		font-size: var(--text-2xl);
	}
	.progress {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		align-items: center;
		gap: 0.75rem;
		max-width: 34rem;
	}
	.t {
		font-size: var(--text-xs);
		color: var(--text-3);
		font-variant-numeric: tabular-nums;
	}
	.desc {
		max-width: 46rem;
		color: var(--text-2);
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.muted {
		color: var(--text-3);
	}
	.later {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.25rem 0.5rem;
		font-size: var(--text-s);
		color: var(--text-3);
	}
	.lbl {
		font-weight: 700;
		color: var(--text-2);
	}
	.ltitle {
		color: var(--text-2);
	}
	.ltime {
		font-variant-numeric: tabular-nums;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.6rem;
		margin-top: 0.4rem;
	}
	@media (min-width: 720px) {
		.hero {
			grid-template-columns: minmax(14rem, 22rem) minmax(0, 1fr);
			grid-template-areas:
				'logo meta'
				'logo main';
			grid-template-rows: auto 1fr;
			gap: 0.7rem 2rem;
			padding: 1.75rem;
		}
		.meta {
			align-self: end;
		}
		.live-pill {
			display: inline-flex;
		}
	}
	@keyframes pulse {
		50% {
			opacity: 0.45;
		}
	}
</style>
