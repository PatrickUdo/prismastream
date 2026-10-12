<!--
	"Druk nogmaals om af te sluiten": shown for 2 s after the first back press on home
	(Android / Android TV). A second press within that time exits the app.
-->
<script lang="ts">
	import { t } from '#lib/i18n/index.svelte.ts';
	import { exitHint } from './focus.svelte.ts';
</script>

<div class="tv-toast-region" role="status" aria-live="polite">
	{#if exitHint.visible}
		<div class="tv-toast">{t('tv.exitHint')}</div>
	{/if}
</div>

<style>
	.tv-toast-region {
		position: fixed;
		left: 0;
		right: 0;
		bottom: calc(var(--shell-bottom) + var(--safe-bottom) + 1.5rem);
		z-index: calc(var(--z-modal) + 2);
		display: flex;
		justify-content: center;
		pointer-events: none;
	}
	.tv-toast {
		padding: 0.75rem 1.4rem;
		border-radius: var(--radius-pill);
		background: var(--bg-glass-strong);
		border: 1px solid var(--line-strong);
		box-shadow: var(--shadow-2);
		font-weight: 650;
		animation: tv-toast-in var(--dur) var(--ease-out);
	}
	@keyframes tv-toast-in {
		from {
			opacity: 0;
			transform: translateY(0.75rem);
		}
	}
</style>
