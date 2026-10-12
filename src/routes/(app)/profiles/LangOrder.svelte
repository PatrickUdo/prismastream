<!--
	Ordered language preference: chosen languages in order (drag or up/down to reorder,
	remove), plus chips to add any other known language. Names in the UI language with
	the native name alongside.
-->
<script lang="ts">
	import type { LangCode } from '#lib/types.ts';
	import { KNOWN_LANGS, languageName, nativeLanguageName } from '#lib/lang.ts';
	import { i18n, t } from '#lib/i18n/index.svelte.ts';
	import Chip from '#lib/components/Chip.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import ReorderList from '../settings/ui/ReorderList.svelte';

	interface Props {
		label: string;
		hint?: string;
		value: LangCode[];
		/** At least one language must stay selected. */
		min?: number;
	}

	let { label, hint, value = $bindable(), min = 1 }: Props = $props();
	const id = $props.id();

	const rest = $derived(KNOWN_LANGS.filter((l) => !value.includes(l)));
	const name = (code: LangCode) => languageName(code, i18n.locale);

	function remove(code: LangCode) {
		if (value.length <= min) return;
		value = value.filter((l) => l !== code);
	}
</script>

<fieldset class="langs">
	<legend id="{id}-l">{label}</legend>
	{#if hint}<p class="hint">{hint}</p>{/if}

	<ReorderList
		items={value}
		key={(c) => c}
		label={name}
		ariaLabel={label}
		onreorder={(next) => (value = next)}
	>
		{#snippet row(code, i)}
			<span class="lang">
				<strong>{name(code)}</strong>
				{#if nativeLanguageName(code) !== name(code)}
					<span class="native" lang={code}>{nativeLanguageName(code)}</span>
				{/if}
				{#if i === 0}<span class="first">{t('profiles.edit.firstChoice')}</span>{/if}
			</span>
		{/snippet}
		{#snippet trailing(code)}
			<button
				type="button"
				class="remove"
				data-focusable
				disabled={value.length <= min}
				aria-label={t('profiles.edit.removeLang', { lang: name(code) })}
				onclick={() => remove(code)}
			>
				<Icon name="close" size="1rem" />
			</button>
		{/snippet}
	</ReorderList>

	{#if rest.length}
		<div class="add" role="group" aria-label={t('profiles.edit.addLang')}>
			<span class="add-label">{t('profiles.edit.addLang')}</span>
			<div class="chips">
				{#each rest as code (code)}
					<Chip
						size="s"
						icon="plus"
						data-focusable
						title={nativeLanguageName(code)}
						onclick={() => (value = [...value, code])}
					>
						{name(code)}
					</Chip>
				{/each}
			</div>
		</div>
	{/if}
</fieldset>

<style>
	.langs {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 0.75rem;
		margin: 0;
		padding: 0;
		border: 0;
		min-width: 0;
	}
	legend {
		padding: 0;
		margin-bottom: 0.35rem;
		font-weight: 700;
	}
	.hint {
		margin-top: -0.4rem;
		color: var(--text-3);
		font-size: var(--text-s);
	}
	.lang {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.2rem 0.6rem;
	}
	.native {
		color: var(--text-3);
		font-size: var(--text-s);
	}
	.first {
		padding: 0.1rem 0.5rem;
		border-radius: var(--radius-pill);
		background: var(--accent-soft);
		color: var(--accent-strong);
		font-size: var(--text-xs);
		font-weight: 700;
	}
	.remove {
		display: grid;
		place-items: center;
		width: 2.4rem;
		height: 2.4rem;
		border: 0;
		border-radius: 50%;
		background: none;
		color: var(--text-3);
	}
	.remove:hover:not(:disabled) {
		color: var(--danger);
		background: var(--bg-hover);
	}
	.remove:disabled {
		opacity: 0.25;
		cursor: default;
	}
	.add {
		display: grid;
		gap: 0.5rem;
	}
	.add-label {
		font-size: var(--text-xs);
		font-weight: 700;
		letter-spacing: var(--tracking-caps);
		text-transform: uppercase;
		color: var(--text-3);
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}
</style>
