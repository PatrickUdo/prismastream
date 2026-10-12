<script lang="ts">
	import '../app.css';
	import favicon from '#lib/assets/favicon.svg';
	import type { LayoutProps } from './$types';
	import { afterNavigate, beforeNavigate, goto, onNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import { untrack } from 'svelte';
	import { prefersReducedMotion } from 'svelte/motion';
	import { user } from '#lib/stores/user.svelte.ts';
	import { library } from '#lib/catalog/library.svelte.ts';
	import { i18n } from '#lib/i18n/index.svelte.ts';
	import { luminance } from '#lib/components/art.ts';
	import { initTvNavigation, tvAfterNavigate, tvBeforeNavigate } from '#lib/tv/focus.svelte.ts';
	import ExitToast from '#lib/tv/ExitToast.svelte';
	import { REQUIRE_LOGIN, isPublicPath, session } from '#lib/session.svelte.ts';
	import { syncEngine } from '#lib/sync/index.ts';
	import { path } from '#lib/components/links.ts';

	let { children }: LayoutProps = $props();

	// User data, sync and the catalog in the right mode (local or remote, see library).
	$effect(() => {
		void library.init();
	});

	// ---- Login gate (production) ------------------------------------------------------
	const publicRoute = $derived(isPublicPath(page.url.pathname));
	/** Render the route: no gate, a public route, or a logged-in account. */
	const allowed = $derived(
		!REQUIRE_LOGIN || publicRoute || (library.initialized && session.loggedIn)
	);

	// A rejected token ends the session (the account is forgotten here; profiles stay).
	$effect(() => {
		if (REQUIRE_LOGIN && syncEngine.configured && syncEngine.error === 'unauthorized')
			untrack(() => void session.expire());
	});

	// Not logged in: everything except the public routes goes to the welcome screen, with the
	// original url to come back to after logging in.
	$effect(() => {
		if (!REQUIRE_LOGIN || !library.initialized || publicRoute || session.loggedIn) return;
		const next = page.url.pathname + page.url.search;
		untrack(() => {
			const parts: string[] = [];
			if (next !== '/') parts.push(`next=${encodeURIComponent(next)}`);
			if (session.notice) parts.push(`reason=${session.notice}`);
			const qs = parts.join('&');
			void goto(path(`/welcome${qs ? `?${qs}` : ''}`), { replaceState: true }).catch(() => {});
		});
	});

	// Back online or back in the app: check the backend again (remote mode).
	$effect(() => {
		const poke = () => {
			if (document.visibilityState === 'visible') library.poke();
		};
		window.addEventListener('online', poke);
		document.addEventListener('visibilitychange', poke);
		return () => {
			window.removeEventListener('online', poke);
			document.removeEventListener('visibilitychange', poke);
		};
	});

	// Accent colour from settings (+ a readable foreground for it).
	$effect(() => {
		const root = document.documentElement.style;
		const accent = user.settings.accent;
		root.setProperty('--accent', accent);
		const lum = luminance(accent);
		root.setProperty('--accent-contrast', !Number.isNaN(lum) && lum > 0.45 ? '#0b0b10' : '#ffffff');
	});

	$effect(() => {
		document.documentElement.lang = i18n.locale;
	});

	// Smart TV / remote control: global D-pad navigation, input mode, back button.
	$effect(() => untrack(initTvNavigation));
	beforeNavigate(tvBeforeNavigate);
	afterNavigate(tvAfterNavigate);

	const reduceMotion = $derived(user.settings.reduceMotion || prefersReducedMotion.current);

	$effect(() => {
		document.documentElement.toggleAttribute('data-reduce-motion', user.settings.reduceMotion);
	});

	// Page transitions with the View Transitions API (when available).
	onNavigate((navigation) => {
		if (!document.startViewTransition || reduceMotion) return;
		// A hidden tab never renders the transition, so navigation would hang until it is shown.
		if (document.visibilityState === 'hidden') return;
		// Same page with other query params (filters): no page transition.
		const from = navigation.from?.url.pathname ?? '';
		const to = navigation.to?.url.pathname ?? '';
		if (from === to) return;
		// The player (and channel zapping inside it) handles its own transitions.
		if (from.startsWith('/watch/') || to.startsWith('/watch/')) return;
		return new Promise((resolve) => {
			// Without rendered frames (background tab, hidden WebView) the transition would never
			// start and the navigation would hang: give up on it after a short wait.
			const fallback = setTimeout(() => {
				resolve();
				vt.skipTransition();
			}, 300);
			const vt = document.startViewTransition(async () => {
				clearTimeout(fallback);
				resolve();
				await navigation.complete;
			});
			// A newer navigation may abort this transition; that is fine.
			vt.ready.catch(() => {});
			vt.finished.catch(() => {});
		});
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<meta name="theme-color" content="#07070b" />
	<title>PrismaStream</title>
</svelte:head>

{#if allowed}
	{@render children()}
{:else}
	<div class="boot" aria-busy="true"></div>
{/if}

<ExitToast />

<style>
	.boot {
		min-height: 100svh;
		background: var(--bg);
	}
</style>
