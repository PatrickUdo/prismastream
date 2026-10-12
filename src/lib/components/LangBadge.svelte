<!-- Compact language badge: "NL EN DE +3". Full names in the accessible label. -->
<script lang="ts">
	import type { LangCode } from '#lib/types.ts';
	import { languageName } from '#lib/lang.ts';
	import { i18n, t } from '#lib/i18n/index.svelte.ts';
	import { knownLangs, langSummary } from './format.ts';

	interface Props {
		languages: LangCode[];
		max?: number;
		/** "glass" for on top of artwork, "plain" inline in text. */
		tone?: 'glass' | 'plain';
	}

	let { languages, max = 3, tone = 'glass' }: Props = $props();
	const summary = $derived(langSummary(languages, max));
	const full = $derived(
		t('ui.audioLanguages', {
			list: knownLangs(languages)
				.map((l) => languageName(l, i18n.locale))
				.join(', ')
		})
	);
</script>

{#if summary.shown.length}
	<span class="badge {tone}" title={full}>
		<span class="sr-only">{full}</span>
		<span class="codes" aria-hidden="true">
			{#each summary.shown as code (code)}<span>{code}</span>{/each}
			{#if summary.more > 0}<span class="more">+{summary.more}</span>{/if}
		</span>
	</span>
{/if}

<style>
	.badge {
		display: inline-flex;
		align-items: center;
		min-height: 1.4rem;
		padding: 0 0.45rem;
		border-radius: var(--radius-xs);
		font-size: 0.6875rem;
		font-weight: 750;
		letter-spacing: 0.06em;
		line-height: 1;
	}
	.glass {
		background: rgb(10 10 16 / 0.55);
		border: 1px solid rgb(255 255 255 / 0.12);
		backdrop-filter: blur(10px);
		-webkit-backdrop-filter: blur(10px);
		color: var(--text-on-media);
	}
	.plain {
		border: 1px solid var(--line-strong);
		color: var(--text-2);
	}
	.codes {
		display: inline-flex;
		gap: 0.4em;
	}
	.more {
		color: var(--accent-strong);
	}
	.plain .more {
		color: var(--text-3);
	}
</style>
