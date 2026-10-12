<script lang="ts">
	import '../app.css';
	import favicon from '#lib/assets/favicon.svg';
	import type { LayoutProps } from './$types';
	import { afterNavigate, beforeNavigate, onNavigate } from '$app/navigation';
	import { untrack } from 'svelte';
	import { prefersReducedMotion } from 'svelte/motion';
	import { user } from '#lib/stores/user.svelte.ts';
	import { catalog } from '#lib/stores/catalog.svelte.ts';
	import { initSync } from '#lib/sync/index.ts';
	import { i18n } from '#lib/i18n/index.svelte.ts';
	import { luminance } from '#lib/components/art.ts';
	import { initTvNavigation, tvAfterNavigate, tvBeforeNavigate } from '#lib/tv/focus.svelte.ts';
	import ExitToast from '#lib/tv/ExitToast.svelte';

	let { children }: LayoutProps = $props();

	$effect(() => {
		void user.init().then(() => initSync());
		void catalog.init();
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

{@render children()}

<ExitToast />
