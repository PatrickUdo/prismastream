<!--
	Detail panel for a channel or a programme in the guide: title, day and time, description,
	category, progress, 'Kijk live' when it is on now, favourite toggle and the source picker
	for merged channels. Rendered inside a Modal.
-->
<script lang="ts">
	import type { Channel, EpgProgramme } from '#lib/types.ts';
	import { i18n, t } from '#lib/i18n/index.svelte.ts';
	import { user } from '#lib/stores/user.svelte.ts';
	import Button from '#lib/components/Button.svelte';
	import Chip from '#lib/components/Chip.svelte';
	import ProgressBar from '#lib/components/ProgressBar.svelte';
	import LangBadge from '#lib/components/LangBadge.svelte';
	import { formatRuntime } from '#lib/components/format.ts';
	import ChannelLogo from './ChannelLogo.svelte';
	import SourceList from './SourceList.svelte';
	import { MINUTE, formatDay, formatTimeRange, isLiveAt, minutesLeft, progressAt } from './epg.ts';
	import { shortEpg } from './live.svelte.ts';
	import { liveHref } from '#lib/components/links.ts';

	interface Props {
		channel: Channel;
		/** The selected slot; undefined = what is on now. `programme` undefined = no information. */
		slot?: { start: number; stop: number; programme?: EpgProgramme };
		now: number;
		/** Scroll the source picker into view (opened from a "3 bronnen" badge). */
		focusSources?: boolean;
	}

	let { channel, slot, now, focusSources = false }: Props = $props();

	const nn = $derived(shortEpg.nowNext(channel, now));
	const programme = $derived(slot ? slot.programme : nn.now);
	const span = $derived(slot ?? (nn.now ? { start: nn.now.start, stop: nn.now.stop } : undefined));
	const live = $derived(span ? isLiveAt(span, now) : true);
	const past = $derived(!!span && span.stop <= now);
	const fav = $derived(user.isFavoriteChannel(channel.id));
	const multi = $derived(channel.variants.length > 1);
	const id = $props.id();

	let sourcesEl = $state<HTMLElement>();
	$effect(() => {
		if (!focusSources || !sourcesEl) return;
		const el = sourcesEl;
		// After the dialog has placed its initial focus.
		const raf = requestAnimationFrame(() => {
			el.scrollIntoView({ block: 'nearest' });
			el.querySelector<HTMLElement>('a')?.focus({ preventScroll: true });
		});
		return () => cancelAnimationFrame(raf);
	});

	const status = $derived(live ? t('live.onNow') : past ? t('live.aired') : t('live.upcoming'));
</script>

<article class="sheet" aria-labelledby="{id}-title">
	<header class="channel">
		<ChannelLogo {channel} width="4rem" />
		<div class="ch-text">
			<span class="ch-name">
				{#if channel.number != null}<span class="num">{channel.number}</span>{/if}
				{channel.name}
			</span>
			<span class="ch-meta">
				{channel.group}
				{#if channel.languages.length}<LangBadge languages={channel.languages} tone="plain" />{/if}
			</span>
		</div>
	</header>

	<div class="programme">
		<span class="eyebrow status" class:is-live={live}>
			{#if live}<span class="dot" aria-hidden="true"></span>{/if}
			{status}
		</span>
		<h2 id="{id}-title">{programme?.title ?? t('live.noInfo')}</h2>
		{#if span && programme}
			<p class="time">
				{formatDay(span.start, now, i18n.locale)} · {formatTimeRange(
					span.start,
					span.stop,
					i18n.locale
				)} · {formatRuntime(Math.round((span.stop - span.start) / MINUTE))}
			</p>
		{/if}
		{#if live && span && programme}
			<div class="progress">
				<ProgressBar
					value={progressAt(span, now)}
					size="m"
					label={t('live.progressLabel', { min: minutesLeft(span, now) })}
				/>
				<span>{t('live.minutesLeft', { min: minutesLeft(span, now) })}</span>
			</div>
		{/if}
		{#if programme?.category}
			<div class="cats"><Chip size="s" tone="outline">{programme.category}</Chip></div>
		{/if}
		{#if programme?.desc}
			<p class="desc">{programme.desc}</p>
		{:else if !programme}
			<p class="desc muted">{t('live.noInfoBody')}</p>
		{/if}
		{#if !slot && nn.next}
			<p class="next">
				{t('live.later')}: <strong>{nn.next.title}</strong> · {formatTimeRange(
					nn.next.start,
					nn.next.stop,
					i18n.locale
				)}
			</p>
		{/if}
	</div>

	<div class="actions">
		<Button variant={live ? 'primary' : 'glass'} icon="play" href={liveHref(channel.id)}>
			{live ? t('live.watchLive') : t('live.watchChannel')}
		</Button>
		<Button
			variant="icon"
			icon={fav ? 'star' : 'star-outline'}
			pressed={fav}
			label={fav ? t('live.unfavorite') : t('live.favorite')}
			onclick={() => user.toggleFavoriteChannel(channel.id)}
		/>
	</div>

	{#if multi}
		<section class="pick" bind:this={sourcesEl} aria-labelledby="{id}-src">
			<h3 id="{id}-src">{t('live.chooseSource')}</h3>
			<p class="hint">{t('live.chooseSourceHint')}</p>
			<SourceList {channel} />
		</section>
	{/if}
</article>

<style>
	.sheet {
		display: grid;
		gap: 1.25rem;
		max-height: calc(100dvh - 8rem);
		overflow-y: auto;
		margin: -0.5rem;
		padding: 0.5rem;
		overscroll-behavior: contain;
	}
	.channel {
		display: flex;
		align-items: center;
		gap: 0.85rem;
		padding-right: 2.5rem;
	}
	.ch-text {
		display: grid;
		gap: 0.2rem;
		min-width: 0;
	}
	.ch-name {
		font-weight: 750;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.num {
		margin-right: 0.35rem;
		color: var(--text-3);
		font-variant-numeric: tabular-nums;
	}
	.ch-meta {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: var(--text-s);
		color: var(--text-3);
	}
	.programme {
		display: grid;
		gap: 0.6rem;
	}
	.status {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
	}
	.status.is-live {
		color: var(--text);
	}
	.dot {
		width: 0.45rem;
		height: 0.45rem;
		border-radius: 50%;
		background: var(--live);
		box-shadow: 0 0 8px var(--live);
	}
	h2 {
		font-size: var(--text-2xl);
	}
	.time {
		color: var(--text-2);
		font-variant-numeric: tabular-nums;
	}
	.progress {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
		gap: 0.75rem;
		font-size: var(--text-xs);
		color: var(--text-3);
	}
	.cats {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}
	.desc {
		color: var(--text-2);
		line-height: 1.6;
	}
	.muted {
		color: var(--text-3);
	}
	.next {
		font-size: var(--text-s);
		color: var(--text-3);
	}
	.next strong {
		color: var(--text-2);
		font-weight: 650;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
	}
	.pick {
		display: grid;
		gap: 0.5rem;
		padding-top: 1.25rem;
		border-top: 1px solid var(--line);
	}
	.pick h3 {
		font-size: var(--text-l);
	}
	.hint {
		font-size: var(--text-s);
		color: var(--text-3);
		margin-bottom: 0.25rem;
	}
</style>
