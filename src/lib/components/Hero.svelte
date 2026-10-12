<!--
	Fullscreen hero banner. Rotates slowly between featured titles with a crossfade and a
	gentle drift; pauses on hover/focus, when the tab is hidden and with reduced motion.
-->
<script lang="ts">
	import type { TitleCard as Card } from '#lib/types.ts';
	import { prefersReducedMotion } from 'svelte/motion';
	import { languageName } from '#lib/lang.ts';
	import { i18n, t } from '#lib/i18n/index.svelte.ts';
	import { user } from '#lib/stores/user.svelte.ts';
	import Backdrop from './Backdrop.svelte';
	import Button from './Button.svelte';
	import Icon from './Icon.svelte';
	import QualityBadge from './QualityBadge.svelte';
	import { titleHref } from './links.ts';
	import { displayTitle } from './titles.ts';
	import { bestQuality, knownLangs, sortLangsByPreference, titleMeta } from './format.ts';
	import { playAction, profilePrefs } from './play.ts';

	interface Props {
		titles: Card[];
		/** Milliseconds per slide. */
		interval?: number;
	}

	let { titles, interval = 9000 }: Props = $props();

	let index = $state(0);
	let hovering = $state(false);
	let focusWithin = $state(false);
	let userPaused = $state(false);
	let hidden = $state(false);

	const reduce = $derived(prefersReducedMotion.current || user.settings.reduceMotion);
	const running = $derived(
		titles.length > 1 && !hovering && !focusWithin && !userPaused && !hidden && !reduce
	);
	const current = $derived(titles[Math.min(index, titles.length - 1)]);

	$effect(() => {
		if (index >= titles.length) index = 0;
	});

	$effect(() => {
		if (!running) return;
		const id = setTimeout(() => (index = (index + 1) % titles.length), interval);
		return () => clearTimeout(id);
	});

	$effect(() => {
		const onVis = () => (hidden = document.hidden);
		document.addEventListener('visibilitychange', onVis);
		return () => document.removeEventListener('visibilitychange', onVis);
	});

	function langLine(title: Card): string {
		const langs = sortLangsByPreference(knownLangs(title.languages), profilePrefs().audioLangs);
		const names = langs.slice(0, 3).map((l) => languageName(l, i18n.locale));
		const more = langs.length - names.length;
		return names.join(' · ') + (more > 0 ? ` +${more}` : '');
	}
</script>

{#if current}
	<section
		class="hero"
		data-nav-group
		aria-roledescription={t('ui.carousel')}
		aria-label={t('home.featured')}
		onpointerenter={() => (hovering = true)}
		onpointerleave={() => (hovering = false)}
		onfocusin={() => (focusWithin = true)}
		onfocusout={() => (focusWithin = false)}
	>
		<div class="stage" aria-hidden="true">
			{#each titles as title, i (title.id)}
				<div class="slide" class:active={i === index} class:drift={!reduce}>
					<Backdrop
						seed={title.id}
						genres={title.genres}
						url={title.backdropUrl}
						eager={i === 0}
						fill
					/>
				</div>
			{/each}
		</div>
		<div class="scrim" aria-hidden="true"></div>
		<div class="grain-layer grain" aria-hidden="true"></div>

		<div class="content">
			{#each titles as title, i (title.id)}
				{@const play = playAction(title)}
				{@const fav = user.isFavorite(title.id)}
				{@const langs = langLine(title)}
				<div
					class="copy"
					class:active={i === index}
					inert={i !== index}
					aria-hidden={i !== index}
					aria-roledescription={t('ui.slide')}
					aria-label={t('ui.slideOf', { n: i + 1, total: titles.length })}
				>
					<span class="eyebrow">
						<Icon name="sparkle" size="0.85rem" />
						{title.kind === 'movie' ? t('home.featuredMovie') : t('home.featuredSeries')}
					</span>
					<h2 class="title">{displayTitle(title)}</h2>
					<p class="meta">
						{#each titleMeta(title, { genres: 2 }) as part, k (k)}
							{#if k > 0}<span class="sep" aria-hidden="true">·</span>{/if}<span>{part}</span>
						{/each}
						{#if title.rating}
							<span class="sep" aria-hidden="true">·</span>
							<span class="rating"
								><Icon name="star" size="0.85rem" />{title.rating.toFixed(1)}</span
							>
						{/if}
						<QualityBadge quality={bestQuality(title.qualities)} tone="plain" />
					</p>
					{#if langs}
						<p class="langs">
							<Icon name="globe" size="0.95rem" />
							<span class="sr-only">{t('ui.languages')}:</span>
							{langs}
						</p>
					{/if}
					{#if title.overview}<p class="overview">{title.overview}</p>{/if}
					<div class="actions">
						<Button
							variant="light"
							size="l"
							icon="play"
							href={play.playable ? play.href : titleHref(title.id)}
							progress={play.resume ? play.ratio : undefined}
							data-focusable
							data-nav-primary
						>
							{play.resume ? t('common.resume') : t('common.play')}
						</Button>
						<Button variant="glass" size="l" icon="info" href={titleHref(title.id)} data-focusable>
							{t('ui.moreInfo')}
						</Button>
						<Button
							variant="icon"
							size="l"
							icon={fav ? 'check' : 'plus'}
							pressed={fav}
							label={fav ? t('ui.removeFromList') : t('ui.addToList')}
							onclick={() => user.toggleFavorite(title.id)}
							data-focusable
						/>
					</div>
				</div>
			{/each}
		</div>

		{#if titles.length > 1}
			<div class="dots">
				{#if !reduce}
					<button
						type="button"
						class="pause"
						aria-label={userPaused ? t('ui.resumeRotation') : t('ui.pauseRotation')}
						onclick={() => (userPaused = !userPaused)}
					>
						<Icon name={userPaused ? 'play' : 'pause'} size="0.8rem" />
					</button>
				{/if}
				{#each titles as title, i (title.id)}
					<button
						type="button"
						class="dot"
						class:active={i === index}
						class:running
						style:--interval="{interval}ms"
						aria-label={t('ui.showSlide', { title: displayTitle(title) })}
						aria-current={i === index ? 'true' : undefined}
						onclick={() => (index = i)}
					>
						<span></span>
					</button>
				{/each}
			</div>
		{/if}
	</section>
{/if}

<style>
	.hero {
		--hero-copy-bottom: clamp(6.5rem, 17vh, 12rem);
		position: relative;
		height: clamp(34rem, 94svh, 66rem);
		overflow: hidden;
		isolation: isolate;
	}
	@media (max-width: 799.98px) {
		.hero {
			--hero-copy-bottom: 3.75rem;
			height: clamp(32rem, 86svh, 50rem);
		}
	}

	/* Fade the artwork out at the bottom so it blends into any page background. */
	.stage,
	.scrim,
	.grain-layer {
		mask-image: linear-gradient(180deg, #000 62%, transparent 100%);
	}
	.stage,
	.slide {
		position: absolute;
		inset: 0;
	}
	.slide {
		opacity: 0;
		transition: opacity var(--dur-xslow) var(--ease-in-out);
	}
	.slide.active {
		opacity: 1;
	}
	.slide.drift.active :global(.backdrop) {
		animation: drift 18s linear both;
	}
	/* TV hardware: no continuous full-screen transform animation. */
	:global(html[data-device='tv']) .slide.drift.active :global(.backdrop) {
		animation: none;
	}
	@keyframes drift {
		from {
			transform: scale(1.02) translate3d(0, 0, 0);
		}
		to {
			transform: scale(1.09) translate3d(-1.2%, -0.6%, 0);
		}
	}

	.scrim {
		position: absolute;
		inset: 0;
		background:
			linear-gradient(90deg, rgb(7 7 11 / 0.9) 0%, rgb(7 7 11 / 0.55) 32%, rgb(7 7 11 / 0) 62%),
			linear-gradient(0deg, var(--bg) 0%, rgb(7 7 11 / 0.6) 22%, rgb(7 7 11 / 0) 48%),
			linear-gradient(180deg, rgb(7 7 11 / 0.55) 0%, rgb(7 7 11 / 0) 18%);
	}
	@media (max-width: 799.98px) {
		.scrim {
			background:
				linear-gradient(0deg, var(--bg) 4%, rgb(7 7 11 / 0.82) 34%, rgb(7 7 11 / 0) 70%),
				linear-gradient(180deg, rgb(7 7 11 / 0.6) 0%, rgb(7 7 11 / 0) 22%);
		}
	}
	.grain-layer {
		position: absolute;
		inset: 0;
		pointer-events: none;
	}

	.content {
		position: absolute;
		inset: auto var(--page-end) var(--hero-copy-bottom) var(--page-start);
		display: grid;
	}
	.copy {
		grid-area: 1 / 1;
		align-self: end;
		display: grid;
		justify-items: start;
		gap: 0.9rem;
		max-width: min(40rem, 100%);
		opacity: 0;
		transform: translateY(1rem);
		transition:
			opacity var(--dur-slow) var(--ease-out),
			transform var(--dur-slow) var(--ease-out);
	}
	.copy.active {
		opacity: 1;
		transform: none;
		transition-delay: 250ms;
	}
	.eyebrow {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		color: var(--accent-strong);
	}
	.title {
		font-size: var(--text-display);
		font-weight: 800;
		letter-spacing: -0.035em;
		line-height: 0.98;
		max-width: 15ch;
		text-shadow: 0 4px 40px rgb(0 0 0 / 0.35);
	}
	.meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		color: var(--text-2);
		font-weight: 600;
		font-size: var(--text-m);
	}
	.sep {
		color: var(--text-3);
	}
	.rating {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		color: var(--rating);
	}
	.langs {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.35rem 0.75rem;
		border-radius: var(--radius-pill);
		background: rgb(255 255 255 / 0.07);
		border: 1px solid rgb(255 255 255 / 0.1);
		backdrop-filter: blur(12px);
		-webkit-backdrop-filter: blur(12px);
		font-size: var(--text-s);
		font-weight: 650;
		color: var(--text);
	}
	.overview {
		color: var(--text-2);
		font-size: clamp(0.95rem, 0.85rem + 0.3vw, 1.1rem);
		line-height: 1.55;
		max-width: 36rem;
		display: -webkit-box;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	@media (max-width: 599.98px) {
		.overview {
			-webkit-line-clamp: 2;
			line-clamp: 2;
		}
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		margin-top: 0.5rem;
	}
	@media (max-width: 599.98px) {
		.actions {
			flex-wrap: nowrap;
			gap: 0.6rem;
		}
		.actions :global(.btn) {
			--h: 2.9rem;
			padding: 0 1.1rem;
			font-size: var(--text-m);
		}
		.actions :global(.btn.icon) {
			padding: 0;
		}
	}

	.dots {
		position: absolute;
		right: var(--page-end);
		bottom: var(--hero-copy-bottom);
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}
	@media (max-width: 799.98px) {
		.dots {
			bottom: 1.1rem;
			left: var(--page-start);
			right: auto;
		}
	}
	.pause {
		display: grid;
		place-items: center;
		width: 1.75rem;
		height: 1.75rem;
		margin-right: 0.35rem;
		border: 1px solid rgb(255 255 255 / 0.18);
		border-radius: 50%;
		background: rgb(10 10 16 / 0.4);
		color: var(--text-2);
		transition: color var(--dur) var(--ease-out);
	}
	@media (hover: hover) {
		.pause:hover {
			color: var(--text);
		}
		.dot:hover span {
			background: rgb(255 255 255 / 0.5);
		}
	}
	/* Touch: 44 px hit areas around the small dots and the pause button. */
	@media (pointer: coarse) {
		.dots {
			gap: 0;
		}
		.dots .pause {
			width: 2.75rem;
			height: 2.75rem;
			margin-right: 0;
			border-color: transparent;
			background: none;
			position: relative;
			isolation: isolate;
		}
		.dots .pause::before {
			content: '';
			position: absolute;
			inset: 0.5rem;
			border: 1px solid rgb(255 255 255 / 0.18);
			border-radius: 50%;
			background: rgb(10 10 16 / 0.4);
			z-index: -1;
		}
		.dots .dot {
			height: 2.75rem;
			padding-inline: 0.35rem;
			width: 2.3rem;
		}
		.dots .dot.active {
			width: 3.7rem;
		}
	}
	.dot {
		display: grid;
		align-items: center;
		width: 1.6rem;
		height: 1.75rem;
		padding: 0;
		border: 0;
		background: none;
		transition: width var(--dur-slow) var(--ease-out);
	}
	.dot.active {
		width: 3rem;
	}
	.dot span {
		position: relative;
		display: block;
		height: 3px;
		border-radius: 3px;
		background: rgb(255 255 255 / 0.28);
		overflow: hidden;
	}
	.dot.active span::after {
		content: '';
		position: absolute;
		inset: 0;
		background: var(--text);
		transform-origin: left;
	}
	.dot.active.running span::after {
		animation: fill var(--interval) linear both;
	}
	@keyframes fill {
		from {
			transform: scaleX(0);
		}
	}
</style>
