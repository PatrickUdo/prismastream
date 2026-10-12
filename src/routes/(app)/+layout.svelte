<!--
	App shell. Desktop/TV: a slim glass rail on the left that expands on hover/focus.
	Mobile: a top bar that turns to glass when scrolling, and a bottom tab bar with safe-area.
-->
<script lang="ts">
	import type { LayoutProps } from './$types';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { t } from '#lib/i18n/index.svelte.ts';
	import { user } from '#lib/stores/user.svelte.ts';
	import { library } from '#lib/catalog/library.svelte.ts';
	import { kids } from '#lib/stores/kids.svelte.ts';
	import Icon, { type IconName } from '#lib/components/Icon.svelte';
	import Avatar from '#lib/components/Avatar.svelte';
	import Logo from '#lib/components/Logo.svelte';
	import { path } from '#lib/components/links.ts';
	import { markProfileChosen, profileChosen } from './profiles/session.ts';

	let { children }: LayoutProps = $props();

	type Section =
		'home' | 'movies' | 'series' | 'live' | 'search' | 'my-list' | 'settings' | 'profiles';

	interface NavItem {
		id: Section;
		href: string;
		icon: IconName;
		label: string;
	}

	const main = $derived<NavItem[]>([
		{ id: 'home', href: '/', icon: 'home', label: t('nav.home') },
		{ id: 'movies', href: '/movies', icon: 'film', label: t('nav.movies') },
		{ id: 'series', href: '/series', icon: 'series', label: t('nav.series') },
		{ id: 'live', href: '/live', icon: 'live', label: t('nav.live') },
		{ id: 'search', href: '/search', icon: 'search', label: t('nav.search') },
		{ id: 'my-list', href: '/my-list', icon: 'bookmark', label: t('nav.myList') }
	]);
	const tabs = $derived(main.filter((i) => i.id !== 'search'));

	/** Which nav section the current route belongs to. */
	const section = $derived.by<Section | null>(() => {
		const p = page.url.pathname;
		if (p === '/' || p === '') return 'home';
		const titleId = (page.params as Record<string, string | undefined>).id;
		if (p.startsWith('/title/') && titleId) {
			const kind = library.peekKind(titleId);
			return kind === 'series' ? 'series' : 'movies';
		}
		const first = p.split('/')[1] as Section;
		return ['movies', 'series', 'live', 'search', 'my-list', 'settings', 'profiles'].includes(first)
			? first
			: null;
	});
	const isDetail = $derived(page.url.pathname.startsWith('/title/'));

	let scrolled = $state(false);
	$effect(() => {
		const onScroll = () => (scrolled = window.scrollY > 8);
		onScroll();
		window.addEventListener('scroll', onScroll, { passive: true });
		return () => window.removeEventListener('scroll', onScroll);
	});

	const profileName = $derived(user.active?.name ?? t('nav.profiles'));

	// Profile gate: with several profiles, ask "Who's watching?" once per app session.
	$effect(() => {
		if (!user.ready) return;
		if (user.profiles.length <= 1) return markProfileChosen();
		if (page.route.id?.startsWith('/(app)/profiles')) return;
		if (profileChosen()) return;
		// Keep the requested page (deep link) to continue there after choosing a profile.
		const next = page.url.pathname + page.url.search;
		void goto(path(next === '/' ? '/profiles' : `/profiles?next=${encodeURIComponent(next)}`), {
			replaceState: true
		});
	});
</script>

<a class="skip" href="#main" data-nav-ignore>{t('ui.skipToContent')}</a>

<!-- Desktop / TV rail -->
<nav class="rail" aria-label={t('ui.mainNav')} data-nav-zone="rail">
	<a class="brand" href={path('/')} aria-label={t('common.appName')}>
		<Logo size="2.1rem" />
		<span class="word">Prisma<span>Stream</span></span>
	</a>
	<ul class="items">
		{#each main as item (item.id)}
			<li>
				<a
					class="item"
					href={path(item.href)}
					aria-current={section === item.id ? 'page' : undefined}
					data-focusable
				>
					<span class="ico"><Icon name={item.icon} size="1.4rem" /></span>
					<span class="label">{item.label}</span>
				</a>
			</li>
		{/each}
	</ul>
	<ul class="items bottom">
		<li>
			<a
				class="item"
				href={path('/settings')}
				aria-current={section === 'settings' ? 'page' : undefined}
				data-focusable
			>
				<span class="ico"><Icon name="settings" size="1.4rem" /></span>
				<span class="label">{t('nav.settings')}</span>
			</a>
		</li>
		<li>
			<a
				class="item profile"
				href={path('/profiles')}
				aria-current={section === 'profiles' ? 'page' : undefined}
				data-focusable
			>
				<span class="ico">
					<Avatar
						preset={user.active?.avatar ?? 'aurora'}
						name={profileName}
						size="2rem"
						labelled={false}
					/>
					{#if kids.active}<span class="kids-badge" aria-hidden="true"
							>{t('profiles.kids.badge')}</span
						>{/if}
				</span>
				<span class="label">
					<span class="pname">{profileName}</span>
					<span class="psub">{kids.active ? t('profiles.kids.mode') : t('ui.switchProfile')}</span>
				</span>
			</a>
		</li>
	</ul>
</nav>

<!-- Mobile top bar -->
<header class="topbar" class:scrolled>
	{#if isDetail}
		<button
			type="button"
			class="tb-btn"
			aria-label={t('common.back')}
			onclick={() => history.back()}
		>
			<Icon name="chevron-left" size="1.4rem" />
		</button>
	{:else}
		<a class="tb-brand" href={path('/')} aria-label={t('common.appName')}>
			<Logo size="1.75rem" wordmark />
		</a>
	{/if}
	<div class="tb-actions">
		<a
			class="tb-btn"
			href={path('/search')}
			aria-label={t('nav.search')}
			aria-current={section === 'search' ? 'page' : undefined}
		>
			<Icon name="search" size="1.3rem" />
		</a>
		<a
			class="tb-btn"
			href={path('/settings')}
			aria-label={t('nav.settings')}
			aria-current={section === 'settings' ? 'page' : undefined}
		>
			<Icon name="settings" size="1.3rem" />
		</a>
		<a
			class="tb-avatar"
			href={path('/profiles')}
			aria-label={t('ui.profileOf', { name: profileName }) +
				(kids.active ? ` (${t('profiles.kids.mode')})` : '')}
		>
			<Avatar
				preset={user.active?.avatar ?? 'aurora'}
				name={profileName}
				size="2rem"
				labelled={false}
			/>
			{#if kids.active}<span class="kids-badge" aria-hidden="true">{t('profiles.kids.badge')}</span
				>{/if}
		</a>
	</div>
</header>

<main id="main" tabindex="-1">
	{@render children()}
</main>

<!-- Mobile tab bar -->
<nav class="tabbar" aria-label={t('ui.mainNav')}>
	{#each tabs as item (item.id)}
		<a class="tab" href={path(item.href)} aria-current={section === item.id ? 'page' : undefined}>
			<Icon name={item.icon} size="1.4rem" />
			<span>{item.label}</span>
		</a>
	{/each}
</nav>

<style>
	.skip {
		position: fixed;
		top: calc(var(--safe-top) + 0.75rem);
		left: 50%;
		z-index: calc(var(--z-modal) + 1);
		padding: 0.6rem 1rem;
		border-radius: var(--radius-pill);
		background: var(--accent);
		color: var(--accent-contrast);
		font-weight: 700;
		transform: translate(-50%, calc(-100% - var(--safe-top) - 1rem));
		transition: transform var(--dur) var(--ease-out);
	}
	.skip:focus-visible {
		transform: translate(-50%, 0);
	}
	main {
		min-height: 100dvh;
		outline: none;
	}
	main:focus-visible {
		box-shadow: none;
	}

	/* ---------------- Rail (≥ 800px) ---------------- */
	.rail {
		position: fixed;
		inset: 0 auto 0 0;
		z-index: var(--z-nav);
		display: none;
		flex-direction: column;
		/* The rail itself is --rail-w wide; the notch / overscan inset is added on the left. */
		width: calc(var(--rail-w) + var(--safe-left));
		padding: calc(var(--safe-top) + 1.4rem) 0.9rem calc(var(--safe-bottom) + 1.25rem)
			calc(var(--safe-left) + 0.9rem);
		background: linear-gradient(90deg, rgb(7 7 11 / 0.82), rgb(7 7 11 / 0.45) 70%, rgb(7 7 11 / 0));
		view-transition-name: shell-nav;
		overflow: hidden;
		transition:
			width var(--dur-slow) var(--ease-out),
			background-color var(--dur) var(--ease-out),
			box-shadow var(--dur) var(--ease-out);
	}
	.rail::before {
		content: '';
		position: absolute;
		inset: 0;
		z-index: -1;
		background: var(--bg-glass-strong);
		backdrop-filter: var(--glass-blur);
		-webkit-backdrop-filter: var(--glass-blur);
		border-right: 1px solid var(--line);
		opacity: 0;
		transition: opacity var(--dur) var(--ease-out);
	}
	/* Spectral hairline along the open rail edge. */
	.rail::after {
		content: '';
		position: absolute;
		top: 12%;
		bottom: 12%;
		right: 0;
		width: 1px;
		background: var(--spectrum);
		opacity: 0;
		mask: linear-gradient(transparent, #000 30%, #000 70%, transparent);
		transition: opacity var(--dur-slow) var(--ease-out);
	}
	@media (min-width: 800px) {
		.rail {
			display: flex;
		}
		.topbar,
		.tabbar {
			display: none !important;
		}
	}
	/* TV: the rail is always there (no touch bars), whatever the reported width. */
	:global(html[data-device='tv']) .rail {
		display: flex;
	}
	:global(html[data-device='tv']) .topbar,
	:global(html[data-device='tv']) .tabbar {
		display: none !important;
	}
	/* Expands on focus (remote / keyboard) and on hover with a mouse; not on TV pointers. */
	@media (hover: hover) {
		:global(html:not([data-device='tv'])) .rail:hover {
			width: calc(var(--rail-w-open) + var(--safe-left));
			box-shadow: 30px 0 80px rgb(0 0 0 / 0.55);
		}
		:global(html:not([data-device='tv'])) .rail:hover::before {
			opacity: 1;
		}
		:global(html:not([data-device='tv'])) .rail:hover::after {
			opacity: 0.4;
		}
		:global(html:not([data-device='tv'])) .rail:hover .label,
		:global(html:not([data-device='tv'])) .rail:hover .word {
			opacity: 1;
			transform: none;
			transition-delay: 60ms;
		}
		.item:hover {
			color: var(--text);
			background: var(--bg-hover);
		}
	}
	.rail:focus-within {
		width: calc(var(--rail-w-open) + var(--safe-left));
		box-shadow: 30px 0 80px rgb(0 0 0 / 0.55);
	}
	.rail:focus-within::before {
		opacity: 1;
	}
	.rail:focus-within::after {
		opacity: 0.4;
	}
	:global(html[data-device='tv']) .rail:focus-within {
		box-shadow: 20px 0 40px rgb(0 0 0 / 0.5);
	}

	.brand {
		display: flex;
		align-items: center;
		gap: 0.85rem;
		height: 3.25rem;
		padding-left: 0.35rem;
		border-radius: var(--radius-m);
		white-space: nowrap;
	}
	.word {
		font-size: 1.1rem;
		font-weight: 800;
		letter-spacing: -0.02em;
		opacity: 0;
		transform: translateX(-0.5rem);
		transition:
			opacity var(--dur) var(--ease-out),
			transform var(--dur) var(--ease-out);
	}
	.word span {
		font-weight: 400;
		color: var(--text-2);
	}

	.items {
		display: grid;
		gap: 0.3rem;
		margin: auto 0;
		padding: 0;
		list-style: none;
	}
	.items.bottom {
		margin: 0;
	}
	.item {
		position: relative;
		display: flex;
		align-items: center;
		gap: 1rem;
		height: 3.25rem;
		padding: 0 0.45rem;
		border-radius: var(--radius-m);
		color: var(--text-3);
		white-space: nowrap;
		transition:
			color var(--dur) var(--ease-out),
			background-color var(--dur) var(--ease-out);
	}
	.ico {
		display: grid;
		place-items: center;
		flex: none;
		width: 2.35rem;
		height: 2.35rem;
		border-radius: var(--radius-s);
		transition:
			background-color var(--dur) var(--ease-out),
			box-shadow var(--dur) var(--ease-out),
			color var(--dur) var(--ease-out);
	}
	.label {
		display: grid;
		font-size: var(--text-m);
		font-weight: 650;
		opacity: 0;
		transform: translateX(-0.5rem);
		transition:
			opacity var(--dur) var(--ease-out),
			transform var(--dur) var(--ease-out);
	}
	.rail:focus-within .label,
	.rail:focus-within .word {
		opacity: 1;
		transform: none;
		transition-delay: 60ms;
	}
	/* Remote: the focused rail item gets a clear pill instead of only a ring. */
	.item:focus-visible,
	:global(html[data-input='remote']) .item:focus {
		color: var(--text);
		background: var(--bg-press);
	}
	.item[aria-current='page'] {
		color: var(--text);
	}
	.item[aria-current='page'] .ico {
		color: var(--accent-strong);
		background: var(--accent-soft);
		box-shadow:
			inset 0 0 0 1px color-mix(in oklab, var(--accent) 40%, transparent),
			0 8px 24px -8px var(--accent-glow);
	}
	.profile .ico {
		background: none !important;
		box-shadow: none !important;
	}
	.profile[aria-current='page'] :global(.avatar) {
		box-shadow:
			0 0 0 2px var(--bg),
			0 0 0 4px var(--accent);
	}
	/* Kids mode indicator on the profile avatar. */
	.kids-badge {
		position: absolute;
		left: 50%;
		bottom: -0.2rem;
		transform: translateX(-50%);
		padding: 0 0.3rem;
		border-radius: var(--radius-pill);
		background: linear-gradient(90deg, #ffd166, #ff8fab);
		color: #2b1530;
		font-size: 0.5625rem;
		font-weight: 800;
		line-height: 1.35;
		letter-spacing: 0.03em;
		box-shadow: 0 0 0 1.5px var(--bg);
		pointer-events: none;
	}
	.profile .ico,
	.tb-avatar {
		position: relative;
	}
	.pname {
		font-weight: 700;
		color: var(--text);
		max-width: 9rem;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.psub {
		font-size: var(--text-xs);
		color: var(--text-3);
		font-weight: 600;
	}

	/* ---------------- Mobile top bar ---------------- */
	.topbar {
		position: fixed;
		inset: 0 0 auto 0;
		z-index: var(--z-nav);
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		height: calc(var(--safe-top) + var(--topbar-h));
		padding: var(--safe-top) calc(var(--safe-right) + 0.75rem) 0 calc(var(--safe-left) + 1rem);
		background: linear-gradient(180deg, rgb(7 7 11 / 0.7), rgb(7 7 11 / 0));
		view-transition-name: shell-nav;
		transition:
			background-color var(--dur) var(--ease-out),
			box-shadow var(--dur) var(--ease-out);
	}
	.topbar::before {
		content: '';
		position: absolute;
		inset: 0;
		z-index: -1;
		background: var(--bg-glass-strong);
		backdrop-filter: var(--glass-blur);
		-webkit-backdrop-filter: var(--glass-blur);
		border-bottom: 1px solid var(--line);
		opacity: 0;
		transition: opacity var(--dur) var(--ease-out);
	}
	.topbar.scrolled::before {
		opacity: 1;
	}
	.tb-brand {
		display: flex;
		align-items: center;
		min-height: 2.75rem;
		border-radius: var(--radius-s);
	}
	.tb-actions {
		display: flex;
		align-items: center;
		gap: 0.15rem;
	}
	.tb-btn {
		display: grid;
		place-items: center;
		width: 2.75rem;
		height: 2.75rem;
		margin-left: -0.5rem;
		border: 0;
		border-radius: 50%;
		background: none;
		color: var(--text);
	}
	.tb-actions .tb-btn {
		margin-left: 0;
	}
	.tb-btn[aria-current='page'] {
		color: var(--accent-strong);
	}
	.tb-avatar {
		display: grid;
		place-items: center;
		width: 2.75rem;
		height: 2.75rem;
		border-radius: 50%;
	}

	/* ---------------- Mobile tab bar ---------------- */
	.tabbar {
		position: fixed;
		inset: auto 0 0 0;
		z-index: var(--z-nav);
		display: grid;
		grid-template-columns: repeat(5, 1fr);
		height: calc(var(--tabbar-h) + var(--safe-bottom));
		padding: 0 calc(var(--safe-right) + 0.25rem) var(--safe-bottom) calc(var(--safe-left) + 0.25rem);
		background: var(--bg-glass-strong);
		backdrop-filter: var(--glass-blur);
		-webkit-backdrop-filter: var(--glass-blur);
		border-top: 1px solid var(--line);
		view-transition-name: shell-tabs;
	}
	.tab {
		position: relative;
		display: grid;
		place-items: center;
		align-content: center;
		gap: 0.2rem;
		color: var(--text-3);
		font-size: 0.6875rem;
		font-weight: 650;
		transition: color var(--dur) var(--ease-out);
	}
	.tab[aria-current='page'] {
		color: var(--text);
	}
	.tab[aria-current='page'] :global(svg) {
		color: var(--accent-strong);
		filter: drop-shadow(0 0 10px var(--accent-glow));
	}
	.tab[aria-current='page']::before {
		content: '';
		position: absolute;
		top: 0;
		left: 30%;
		right: 30%;
		height: 2px;
		border-radius: 0 0 2px 2px;
		background: var(--accent);
		box-shadow: 0 0 12px var(--accent-glow);
	}
	.tab span {
		white-space: nowrap;
	}
</style>
