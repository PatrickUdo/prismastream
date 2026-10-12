// Minimal i18n. Each feature area adds its own file in ./messages/<area>.ts exporting
// `export default { nl: {...}, en: {...} }` with keys prefixed by the area ("home.continue").
// Dutch is the source language; missing English keys fall back to Dutch, then to the key.

type Dict = Record<string, string>;
type Bundle = { nl: Dict; en: Dict };

const modules = import.meta.glob<{ default: Bundle }>('./messages/*.ts', { eager: true });

const dicts: Bundle = { nl: {}, en: {} };
for (const mod of Object.values(modules)) {
	Object.assign(dicts.nl, mod.default.nl);
	Object.assign(dicts.en, mod.default.en);
}

export type Locale = 'nl' | 'en';

export const i18n = $state<{ locale: Locale }>({ locale: 'nl' });

/** Translate `key`, replacing `{name}` placeholders from `params`. Reactive on i18n.locale. */
export function t(key: string, params?: Record<string, string | number>): string {
	let s = dicts[i18n.locale][key] ?? dicts.nl[key] ?? key;
	if (params) for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, String(v));
	return s;
}
