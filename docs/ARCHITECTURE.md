# PrismaStream: architectuur en afspraken

Premium IPTV- en streamingapp. SvelteKit 3 (Svelte 5 runes, TypeScript) als SPA (`ssr = false`), verpakt met Capacitor 8 voor iOS en Android. Voor desktop en web draait dezelfde build in de browser.

## Conventies (verplicht voor alle agents)

- **Imports:** gebruik `#lib/...` met een expliciete extensie: `#lib/types.ts`, `#lib/stores/user.svelte.ts`, `#lib/merge/index.ts`. `$lib` werkt niet in SvelteKit 3.
- **Svelte 5 runes:** gebruik `$state`, `$derived`, `$effect` en `$props`, geen legacy stores. Gedeelde state staat in `*.svelte.ts`-klassen met `$state`-velden en wordt als singleton geëxporteerd.
- **Types:** alle domeintypes staan in `src/lib/types.ts`. Wijzig die alleen additief (velden toevoegen); hernoem of verwijder niets.
- **Teksten:** gebruik `t('area.key')` uit `#lib/i18n/index.svelte.ts`. Elke feature heeft een eigen bestand `src/lib/i18n/messages/<area>.ts` met `export default { nl: {...}, en: {...} }`. Nederlands is leidend.
- **Kleuren en maten:** gebruik alleen de CSS-variabelen uit `src/app.css` (`--accent`, `--bg-elev-*`, `--text-*`, `--radius-*`, `--dur*`, `--gutter`, enz.). De accentkleur is instelbaar via `user.settings.accent`.
- **Opslag:** kleine JSON-data via `#lib/storage.ts` (Capacitor Preferences of localStorage). Grote data, zoals de catalogus-cache en EPG, via `idb-keyval` (IndexedDB). Wachtwoorden en tokens alleen via secure storage (`@aparajita/capacitor-secure-storage`), nooit in Preferences, localStorage of logs.
- **Tests:** logica (parsers, merge, matching) krijgt vitest-tests als `src/**/*.test.ts`. Draai `npm test`.
- **Kwaliteit:** `npm run check` en `npm run lint` moeten slagen. Draai `npx prettier --write <jouw bestanden>` op je eigen bestanden.
- **npm install:** de gedeelde dependencies zijn al geïnstalleerd (hls.js, idb-keyval, saxes, @capacitor/preferences, @aparajita/capacitor-secure-storage, @capacitor/screen-orientation, @fontsource-variable/manrope, vitest, jsdom). Installeer alleen iets extra als het echt nodig is, en meld het in je rapport.
- **Eigendom:** elke agent wijzigt alleen bestanden in zijn eigen gebied (zie TODO.md). Heb je een wijziging buiten je gebied nodig? Meld die in je eindrapport in plaats van hem zelf te doen.
- **Content:** voorbeeldcontent is fictief. Gebruik als videostreams alleen publieke testpaden (Mux, Apple en Bitmovin demo-HLS). De app speelt alleen bronnen af die de gebruiker zelf toevoegt.

## Datastroom

```
SourceConfig[] ──(providers: xtream / m3u / xmltv / sample)──▶ RawCatalog[]
       │                                                            │
  secure storage (wachtwoorden)                  merge engine: normaliseren, taal-detectie,
                                                 matching (tmdb/imdb/titel+jaar), samenvoegen
                                                                    │
                                                                    ▼
                                    Catalog { titles: Title[], channels: Channel[], epg }
                                                                    │
                                     catalog store (#lib/stores/catalog.svelte.ts)
                                                                    │
                     UI: home · detail · speler · live · zoeken  ◀── user store (profielen,
                                                                     favorieten, voortgang)
```

## Contracten tussen modules

| Module        | Bestand                                   | Publieke API                                                                                                                                                                                                                                                                                   |
| ------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Types         | `src/lib/types.ts`                        | alle domeintypes                                                                                                                                                                                                                                                                               |
| User store    | `src/lib/stores/user.svelte.ts`           | `user.active`, `user.profiles`, `user.data`, `user.settings`, `toggleFavorite`, `saveProgress`, `getProgress`, `latestProgress`, `continueWatching`, `setHomeRows`, `updateSettings`, `selectProfile`, `createProfile`, `updateProfile`, `deleteProfile`, `onChange`, `replaceData`, `hashPin` |
| Catalog store | `src/lib/stores/catalog.svelte.ts`        | `catalog.titles`, `catalog.channels`, `getTitle(id)`, `getChannel(id)`, `refresh({ force? })`, `ensureSeasons(id)`, `nowNext(channel)`, `status`, `error`                                                                                                                                      |
| Merge engine  | `src/lib/merge/index.ts`                  | `buildCatalog(raws, opts): Catalog`, en ook helpers zoals `pickVariant(variants, profile)`                                                                                                                                                                                                     |
| Sources       | `src/lib/sources/index.svelte.ts`         | `sources.list`, `loadRawCatalogs()`, `loadSeriesEpisodes(sourceId, providerId)`, plus add/remove/update en credentials                                                                                                                                                                         |
| Providers     | `src/lib/providers/{xtream,m3u,xmltv}.ts` | pure parsers en clients die `RawCatalog`-delen opleveren                                                                                                                                                                                                                                       |
| Speler        | `src/lib/player/` + `src/routes/watch/`   | route `/watch/[titleId]?e=<episodeId>&v=<variantId>&s=<lang                                                                                                                                                                                                                                    | off>`en`/watch/live/[channelId]?v=<variantId>` |
| i18n          | `src/lib/i18n/index.svelte.ts`            | `t(key, params)`, `i18n.locale`                                                                                                                                                                                                                                                                |
| Talen         | `src/lib/lang.ts`                         | `languageName`, `nativeLanguageName`, `qualityRank`, `KNOWN_LANGS`                                                                                                                                                                                                                             |

## Routes

| Route                     | Inhoud                                                       |
| ------------------------- | ------------------------------------------------------------ |
| `/`                       | Home: hero en rijen (volgorde per profiel)                   |
| `/movies`, `/series`      | Bibliotheek met genre-filter                                 |
| `/title/[id]`             | Detailpagina voor films en series: versies, talen, seizoenen |
| `/watch/[titleId]`        | Speler (`?e=` aflevering, `?v=` variant)                     |
| `/watch/live/[channelId]` | Live-speler met zenderwissel                                 |
| `/live`                   | Live TV met EPG                                              |
| `/search`                 | Globaal zoeken                                               |
| `/my-list`                | Favorieten                                                   |
| `/profiles`               | Profielkeuze en -beheer                                      |
| `/settings`               | Instellingen: bronnen, uiterlijk, home-rijen, taal, sync     |

## Aanvullingen (ronde 2 en 3)

- **Zoeken:** `src/lib/search/` (`searchIndexFor(...)`) is de enige zoekimplementatie; de catalog store heeft geen `search`.
- **Weergavetitel:** `displayTitle(title, profile?)` uit `src/lib/components/titles.ts` geeft de titel in de profieltaal. Gebruik die overal waar een titel wordt getoond.
- **Kindermodus:** `src/lib/stores/kids.svelte.ts` (`visibleTitles`, `visibleChannels`, `isAllowed`, `isChannelAllowed`, `filterTitles`, `filterChannels`). Elke route die titels of zenders toont of afspeelt, filtert hiermee.
- **Spelerroutes:** `/watch/[titleId]?e=<episodeId>&v=<variantId>&s=<lang|off>` en `/watch/live/[channelId]?v=<variantId>`. Bouw links via `watchHref` en `liveHref` uit `src/lib/components/links.ts`.
- **Sync:** `initSync()` wordt in `src/routes/+layout.svelte` aangeroepen na `user.init()`. De server staat in `server/` (zie `server/README.md`).
- **Layout-regel:** een grid- of flex-container rond carrousels krijgt kolommen `minmax(0, 1fr)`; `.row` heeft `contain: inline-size`, en `html` heeft `overflow-x: clip`. De pagina mag nooit horizontaal scrollen.
