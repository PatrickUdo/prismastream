<!--
	Language picker: a ChoiceGroup of languages with localized names (and the native
	name as description). Preferred languages of the active profile are listed first.
-->
<script lang="ts">
	import type { LangCode } from '#lib/types.ts';
	import { languageName, nativeLanguageName } from '#lib/lang.ts';
	import { i18n } from '#lib/i18n/index.svelte.ts';
	import ChoiceGroup, { type ChoiceOption } from './ChoiceGroup.svelte';
	import type { IconName } from './Icon.svelte';
	import { sortLangsByPreference } from './format.ts';

	interface Props {
		label: string;
		languages: LangCode[];
		value?: LangCode;
		onchange?: (lang: LangCode) => void;
		/** Preferred order (profile.audioLangs). */
		preferred?: LangCode[];
		/** Optional trailing hint per language (e.g. number of versions). */
		hints?: Record<LangCode, string>;
		icon?: IconName;
		readonly?: boolean;
		emptyText?: string;
	}

	let {
		label,
		languages,
		value = $bindable(),
		onchange,
		preferred = [],
		hints = {},
		icon = 'globe',
		readonly = false,
		emptyText
	}: Props = $props();

	const options = $derived<ChoiceOption[]>(
		sortLangsByPreference(languages, preferred).map((code) => ({
			value: code,
			label: languageName(code, i18n.locale),
			hint: hints[code],
			description: nativeLanguageName(code)
		}))
	);
</script>

<ChoiceGroup {label} {icon} {options} bind:value {onchange} {readonly} {emptyText} />
