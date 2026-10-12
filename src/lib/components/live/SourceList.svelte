<!--
	"Bron kiezen": the variants of a merged channel, grouped by language (preferred languages
	first), each with quality and source name. Every option opens the live player on that variant.
-->
<script lang="ts">
	import type { Channel } from '#lib/types.ts';
	import { languageName } from '#lib/lang.ts';
	import { i18n, t } from '#lib/i18n/index.svelte.ts';
	import { user } from '#lib/stores/user.svelte.ts';
	import QualityBadge from '#lib/components/QualityBadge.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import { groupVariantsByLanguage } from './epg.ts';
	import { sourceLabel } from './live.svelte.ts';
	import { liveHref } from '#lib/components/links.ts';

	interface Props {
		channel: Channel;
	}

	let { channel }: Props = $props();

	const groups = $derived(groupVariantsByLanguage(channel.variants, user.active?.audioLangs ?? []));
	const id = $props.id();
</script>

<div class="sources">
	{#each groups as group (group.lang)}
		<section aria-labelledby="{id}-{group.lang}">
			<h4 id="{id}-{group.lang}" class="eyebrow">
				{group.lang === 'und' ? t('live.langUnknown') : languageName(group.lang, i18n.locale)}
			</h4>
			<ul>
				{#each group.variants as v (v.id)}
					<li>
						<a class="option" href={liveHref(channel.id, v.id)} data-focusable title={v.label}>
							<span class="q">
								{#if v.quality !== 'unknown'}
									<QualityBadge quality={v.quality} tone="plain" />
								{:else}
									<span class="auto">{t('live.qualityAuto')}</span>
								{/if}
							</span>
							<span class="text">
								<span class="src">{sourceLabel(v.sourceId)}</span>
								<span class="label">{v.label}</span>
							</span>
							<Icon name="play" size="1rem" />
						</a>
					</li>
				{/each}
			</ul>
		</section>
	{/each}
</div>

<style>
	.sources {
		display: grid;
		gap: 1rem;
	}
	section {
		display: grid;
		gap: 0.4rem;
	}
	ul {
		display: grid;
		gap: 0.35rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.option {
		display: grid;
		grid-template-columns: 3.25rem minmax(0, 1fr) auto;
		align-items: center;
		gap: 0.75rem;
		min-height: 3.25rem;
		padding: 0.45rem 0.9rem 0.45rem 0.6rem;
		border-radius: var(--radius-m);
		border: 1px solid var(--line);
		background: rgb(255 255 255 / 0.03);
		color: var(--text-2);
		transition:
			background-color var(--dur) var(--ease-out),
			border-color var(--dur) var(--ease-out),
			color var(--dur) var(--ease-out);
	}
	.option:hover,
	.option:focus-visible {
		background: var(--bg-hover);
		border-color: var(--line-strong);
		color: var(--text);
	}
	.q {
		display: flex;
		justify-content: center;
	}
	.auto {
		font-size: var(--text-xs);
		color: var(--text-3);
	}
	.text {
		display: grid;
		min-width: 0;
	}
	.src {
		font-weight: 700;
		color: var(--text);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.label {
		font-size: var(--text-xs);
		color: var(--text-3);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
</style>
