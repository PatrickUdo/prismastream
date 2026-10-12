<!--
	Fullscreen, on-brand frame for the screens before the app (welcome, tv approval):
	a beam of light through a glass prism, fanning out into the spectrum behind the content.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import Logo from '../Logo.svelte';

	interface Props {
		children: Snippet;
		/** Brand copy beside (desktop) or above (mobile) the card. */
		aside?: Snippet;
	}

	let { children, aside }: Props = $props();
</script>

<div class="shell">
	<svg
		class="light"
		viewBox="0 0 1600 1000"
		preserveAspectRatio="xMidYMid slice"
		aria-hidden="true"
	>
		<defs>
			<linearGradient id="auth-beam" x1="0" x2="1">
				<stop offset="0" stop-color="#fff" stop-opacity="0" />
				<stop offset="1" stop-color="#fff" stop-opacity=".85" />
			</linearGradient>
			<filter id="auth-blur" x="-20%" y="-20%" width="140%" height="140%">
				<feGaussianBlur stdDeviation="14" />
			</filter>
		</defs>
		<path d="M0 560 L610 470" stroke="url(#auth-beam)" stroke-width="3" />
		<g filter="url(#auth-blur)" opacity=".55">
			<path d="M700 455 L1600 180 L1600 300 Z" fill="#ff6b8b" />
			<path d="M700 460 L1600 300 L1600 420 Z" fill="#ffd36b" />
			<path d="M700 465 L1600 420 L1600 540 Z" fill="#6dffb8" />
			<path d="M700 470 L1600 540 L1600 660 Z" fill="#5cc8ff" />
			<path d="M700 475 L1600 660 L1600 790 Z" fill="#a77bff" />
		</g>
		<path
			d="M655 300 L790 560 L520 560 Z"
			fill="rgb(255 255 255 / .04)"
			stroke="rgb(255 255 255 / .55)"
			stroke-width="2"
			stroke-linejoin="round"
		/>
	</svg>
	<div class="veil" aria-hidden="true"></div>

	<header class="brand">
		<Logo size="2.4rem" wordmark />
	</header>

	<main class="content" id="main" tabindex="-1">
		{#if aside}<section class="aside">{@render aside()}</section>{/if}
		<section class="card glass">{@render children()}</section>
	</main>
</div>

<style>
	.shell {
		position: relative;
		min-height: 100svh;
		display: grid;
		grid-template-rows: auto minmax(0, 1fr);
		padding: calc(var(--safe-top) + 1.25rem) calc(var(--safe-right, 0px) + 1rem)
			calc(var(--safe-bottom, 0px) + 1.5rem) calc(var(--safe-left, 0px) + 1rem);
		overflow: hidden;
		isolation: isolate;
		background: var(--bg);
	}
	.light {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		z-index: -2;
	}
	@media (max-width: 899.98px) {
		.light {
			opacity: 0.45;
		}
	}
	.veil {
		position: absolute;
		inset: 0;
		z-index: -1;
		background:
			radial-gradient(60rem 40rem at 20% 110%, var(--accent-faint), transparent 70%),
			linear-gradient(180deg, rgb(7 7 11 / 0.2), rgb(7 7 11 / 0.75));
	}
	.brand {
		display: flex;
		justify-content: center;
	}
	.content {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		align-content: center;
		justify-items: center;
		gap: 2rem;
		width: 100%;
		max-width: 68rem;
		margin: 0 auto;
		padding-block: 2rem;
		outline: none;
	}
	@media (min-width: 900px) {
		.brand {
			justify-content: flex-start;
			padding-left: 1rem;
		}
		.content:has(.aside) {
			grid-template-columns: minmax(0, 1fr) minmax(0, 28rem);
			justify-items: stretch;
			align-items: center;
			gap: 4rem;
		}
	}
	.aside {
		min-width: 0;
		max-width: 34rem;
	}
	.card {
		width: 100%;
		max-width: 30rem;
		min-width: 0;
		padding: clamp(1.25rem, 0.9rem + 1.5vw, 2rem);
		border-radius: var(--radius-xl, 28px);
		box-shadow: var(--shadow-2);
	}
</style>
