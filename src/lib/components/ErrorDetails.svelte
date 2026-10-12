<!-- Small "Details" disclosure with the technical reason of an error (never contains tokens). -->
<script lang="ts">
	import { t } from '#lib/i18n/index.svelte.ts';
	import { errorDetail, redactDetail } from '#lib/backend/errors.ts';

	interface Props {
		/** An error object, or an already formatted technical text. */
		error?: unknown;
		text?: string | null;
	}

	let { error, text }: Props = $props();

	const detail = $derived(text ? redactDetail(text) : error ? errorDetail(error) : '');
</script>

{#if detail}
	<details class="details">
		<summary data-focusable>{t('common.details')}</summary>
		<code>{detail}</code>
	</details>
{/if}

<style>
	.details {
		max-width: 100%;
		min-width: 0;
		color: var(--text-3);
		font-size: var(--text-s);
		text-align: start;
	}
	summary {
		cursor: pointer;
		width: fit-content;
		margin-inline: auto;
	}
	code {
		display: block;
		margin-top: 0.4rem;
		padding: 0.6rem 0.75rem;
		border-radius: var(--radius-m, 12px);
		background: rgb(255 255 255 / 0.05);
		font-size: 0.78rem;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
</style>
