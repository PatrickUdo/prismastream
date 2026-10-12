<!--
	Live channel card: logo (or monogram), name and what is on now (via library.nowNext)
	with the programme's progress and what comes next.
-->
<script lang="ts">
	import type { Channel, ChannelCard } from '#lib/types.ts';
	import { library } from '#lib/catalog/library.svelte.ts';
	import { t } from '#lib/i18n/index.svelte.ts';
	import ProgressBar from './ProgressBar.svelte';
	import { liveHref } from './links.ts';
	import { formatClock, initials } from './format.ts';
	import { hashString } from './art.ts';

	interface Props {
		channel: Channel | ChannelCard;
		/** Current time (epoch ms); pass a ticking value to keep "now" fresh. */
		now?: number;
	}

	let { channel, now = Date.now() }: Props = $props();

	let logoFailed = $state(false);
	const nn = $derived(library.nowNext(channel, now));
	const progress = $derived(
		nn.now ? (now - nn.now.start) / Math.max(1, nn.now.stop - nn.now.start) : 0
	);
	const hue = $derived(hashString(channel.id) % 360);
	const label = $derived(
		[channel.name, nn.now ? t('ui.nowOn', { title: nn.now.title }) : ''].filter(Boolean).join(', ')
	);
</script>

<a class="card" href={liveHref(channel.id)} aria-label={label} data-focusable>
	<div class="logo" style:--hue={hue}>
		{#if channel.logoUrl && !logoFailed}
			<img
				src={channel.logoUrl}
				alt=""
				loading="lazy"
				decoding="async"
				onerror={() => (logoFailed = true)}
			/>
		{:else}
			<span class="mono" aria-hidden="true">{initials(channel.name)}</span>
		{/if}
		<span class="live" aria-hidden="true"><span class="dot"></span>{t('common.live')}</span>
		{#if channel.number}<span class="num" aria-hidden="true">{channel.number}</span>{/if}
	</div>
	<div class="body" aria-hidden="true">
		<strong class="name">{channel.name}</strong>
		{#if nn.now}
			<span class="prog">{nn.now.title}</span>
			<span class="time">{formatClock(nn.now.start)} – {formatClock(nn.now.stop)}</span>
			<ProgressBar value={progress} />
			{#if nn.next}<span class="next">{t('ui.upNext', { title: nn.next.title })}</span>{/if}
		{:else}
			<span class="prog muted">{channel.group}</span>
		{/if}
	</div>
</a>

<style>
	.card {
		display: grid;
		gap: 0.65rem;
		padding: 0.5rem 0.5rem 0.8rem;
		border-radius: var(--radius-l);
		background: var(--bg-elev-1);
		border: 1px solid var(--line);
		transition:
			transform var(--dur) var(--ease-out),
			box-shadow var(--dur) var(--ease-out),
			border-color var(--dur) var(--ease-out),
			background-color var(--dur) var(--ease-out);
	}
	.logo {
		position: relative;
		display: grid;
		place-items: center;
		aspect-ratio: 16 / 9;
		border-radius: var(--radius-m);
		overflow: hidden;
		background:
			radial-gradient(120% 90% at 30% 20%, hsl(var(--hue) 55% 30% / 0.55), transparent 70%),
			linear-gradient(160deg, var(--bg-elev-3), var(--bg-elev-2));
	}
	img {
		max-width: 62%;
		max-height: 58%;
		object-fit: contain;
		filter: drop-shadow(0 4px 12px rgb(0 0 0 / 0.5));
	}
	.mono {
		font-size: 1.75rem;
		font-weight: 800;
		letter-spacing: -0.03em;
		color: hsl(var(--hue) 70% 88%);
	}
	.live {
		position: absolute;
		top: 0.5rem;
		left: 0.5rem;
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.2rem 0.45rem;
		border-radius: var(--radius-xs);
		background: rgb(10 10 16 / 0.6);
		font-size: 0.625rem;
		font-weight: 800;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}
	.dot {
		width: 0.4rem;
		height: 0.4rem;
		border-radius: 50%;
		background: var(--live);
		box-shadow: 0 0 8px var(--live);
	}
	.num {
		position: absolute;
		top: 0.5rem;
		right: 0.6rem;
		font-size: var(--text-xs);
		font-weight: 700;
		color: var(--text-3);
		font-variant-numeric: tabular-nums;
	}
	.body {
		display: grid;
		gap: 0.3rem;
		padding-inline: 0.3rem;
		min-width: 0;
	}
	.name {
		font-size: var(--text-s);
		font-weight: 750;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.prog {
		font-size: var(--text-s);
		color: var(--text-2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.muted {
		color: var(--text-3);
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
	@media (hover: hover) {
		:global(html:not([data-device='tv'])) .card:hover {
			transform: translateY(-4px);
			background: var(--bg-elev-2);
			border-color: var(--line-strong);
			box-shadow: var(--shadow-2), var(--glow);
		}
	}
	.card:focus-visible,
	:global(html[data-input='remote']) .card:focus {
		transform: translateY(-4px);
		box-shadow: var(--focus-ring), var(--glow);
	}
	:global(html[data-input='remote']) .card:focus {
		transform: translateY(-4px) scale(1.04);
		background: var(--bg-elev-2);
	}
</style>
