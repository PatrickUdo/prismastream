# PrismaStream: takenbord

Status: ⬜ open · 🔄 bezig · ✅ klaar · ⚠️ aandacht nodig
Afspraken en contracten staan in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Fase 0: fundament (coördinator) ✅

- ✅ SvelteKit 3 + Capacitor 8 (iOS en Android), SPA-modus
- ✅ Gedeelde types (`src/lib/types.ts`)
- ✅ Opslag, i18n, talen, user store (profielen, favorieten, voortgang, instellingen)
- ✅ Catalog store-contract met placeholders voor merge, sources en sample
- ✅ Design-tokens (`src/app.css`)

## Ronde 1 (parallel)

### Agent A: UI en design (fase 1)

Eigendom: `src/app.css`, `src/routes/+layout.svelte`, `src/routes/(app)/+layout.svelte`, `src/routes/(app)/+page.svelte`, `src/routes/(app)/{title,movies,series,my-list}/`, `src/lib/components/`, `src/lib/i18n/messages/{ui,home,detail}.ts`, `src/lib/recommend.ts`

- ✅ App-shell: navigatie (zijbalk op desktop/tv, tabbalk op mobiel), profielavatar
- ✅ Hero-banner fullscreen, horizontale carrousels, kaarten met animaties
- ✅ Generatieve posters en backdrops voor fictieve content zonder afbeeldingen
- ✅ Home met alle rijen (verder kijken, favorieten, aanbevolen, recent, populair, trending, live, genres) volgens `user.data.homeRows`
- ✅ Detailpagina voor films en series: info, cast, trailer, seizoenen en afleveringen, versiekeuze (taal, ondertitels, kwaliteit, bron), vergelijkbare titels
- ✅ Bibliotheekpagina's voor films, series en Mijn lijst

### Agent B: videospeler (fase 1)

Eigendom: `src/lib/player/`, `src/routes/watch/`, `src/lib/i18n/messages/player.ts`

- ✅ HLS (hls.js, met native HLS als fallback op iOS), automatische kwaliteit en handmatige keuze
- ✅ Audiotracks, ondertitels, afspeelsnelheid, fullscreen, PiP
- ✅ Automatisch hervatten en voortgang opslaan
- ✅ Tijdens het kijken wisselen van bron of taalversie
- ✅ Volgende aflevering, toetsenbord en afstandsbediening
- ✅ Vervolg: hls.js-loader met native fallback bij een CORS-fout

### Agent C: IPTV-integraties (fase 2)

Eigendom: `src/lib/providers/`, `src/lib/sources/`, `src/routes/(app)/settings/sources/`, `src/lib/i18n/messages/sources.ts`, `capacitor.config.ts`, native config (cleartext/ATS)

- ✅ Xtream Codes API-client (films, series lazy, live, EPG)
- ✅ M3U/M3U8-parser (tvg-attributen, groepen, VOD-herkenning)
- ✅ XMLTV EPG-parser (streaming, grote bestanden)
- ✅ Sources store: meerdere accounts, toevoegen en verwijderen, refresh, IndexedDB-cache
- ✅ Veilige opslag van inloggegevens
- ✅ CORS en cleartext op native (CapacitorHttp, ATS, Android network config)
- ✅ Vervolg: CapacitorHttp expliciet aanroepen in plaats van globaal patchen (sneller HLS)

### Agent D: samenvoeg-engine (fase 3)

Eigendom: `src/lib/merge/`, `src/lib/sample/`, `src/lib/tmdb/`, `src/lib/stores/catalog.svelte.ts`, `src/lib/i18n/messages/catalog.ts`

- ✅ Titelnormalisatie: taalprefixen, kwaliteitstags, jaartallen, leestekens, diakrieten
- ✅ Taal- en kwaliteitsdetectie per stream
- ✅ Matching op tmdb/imdb-id, titel+jaar, alt-titels en vertaalde titels; geen valse merges
- ✅ Series samenvoegen per seizoen en aflevering
- ✅ Zenders samenvoegen
- ✅ Variantkeuze volgens profieltaal, met fallback
- ✅ TMDB-verrijking (optionele API-sleutel, cache)
- ✅ Rijke fictieve voorbeeldbibliotheek met bewuste dubbelen in 10 talen
- ✅ Vitest-testsuite

## Ronde 2

- ✅ Agent E: Live TV-interface en EPG-gids (`/live`, live-speler-integratie)
- ✅ Agent F: profielen (avatar, kindermodus met pincode), zoeken, instellingen (uiterlijk, home-rijen ordenen, taal)
- ✅ Agent G: sync-server (Node, E2E-versleuteld) en client-sync (fase 4), vervroegd gestart

## Ronde 3

- ✅ Agent H: smart-tv en afstandsbediening (spatiële navigatie, Android TV, terugknop), tablet en mobiel (fase 5)
- ✅ Agent I: integratie en afwerking
  - Kindermodus ook afdwingen in /live en de spelerroutes (nu via de url te omzeilen)
  - Weergavetitel in de profieltaal (bv. "Het Laatste Licht" voor een Nederlands profiel)
  - Ondertitelkeuze vanaf de detailpagina doorgeven aan de speler (`?s=`)
  - Iconen samenvoegen in Icon.svelte (MiniIcon weg), `liveHref` met variantId
  - `catalog.refresh({ force })` in de signatuur, demozenders zonder EPG
- ✅ displayTitle in TitleCard, Hero, ContinueCard en Library (Agent H)
- ✅ Launchvideo (`brag-output/brag.mp4`)
- ✅ iOS: koude start getest in de simulator (iOS 27), opstartscherm donker met logo, geen witte flits
- ⬜ Tv-navigatie afwerken: `data-nav-*` op detail, live en pin-pad, `will-change` alleen tijdens animatie, radiogroepen over meerdere regels
- ✅ Apple TV (tvOS) fase A+B: native SwiftUI-app met gedeelde TypeScript-kern via JavaScriptCore (zie docs/TVOS.md)
  - ✅ Agent J: kern bundelen (`npm run build:core` → `tvos/PrismaStream/Resources/prisma-core.js`)
  - ✅ Agent K: SwiftUI-app (home, detail met versies, AVPlayer met "Taal en bron", live/EPG, zoeken, profielen, bronnen in de Keychain)
  - ⬜ Fase C: sync met de bestaande server (E2E-crypto in Swift met CryptoKit)
  - ⬜ tvOS: profielkiezer bij het opstarten, kindermodus met pincode, Top Shelf-extensie
  - ✅ Dode demostream (Sintel, 403) vervangen door Apple bipbop (TS, multi-audio en ondertitels)
## Ronde 4: PrismaStream Cloud (server-side catalogus en hosting)

- ✅ Keuze gebruiker: de server haalt bronnen op (inloggegevens versleuteld op de server), persoonlijke data blijft E2E; contract in docs/BACKEND.md
- ✅ Code op GitHub (PatrickUdo/prismastream)
- 🔄 Agent L: server-side bronnen, catalogus-build en cache (SQLite en gzip), catalog-API, play-redirects, signup met uitnodigingscode, Docker
- 🔄 Agent M: web-client remote-modus (kleine LRU-cache, paginering), onboarding, bronnen via de server, opslagbeheer, Android-fout en E2E-robuustheid
- ✅ Deploy-bestanden: deploy/web.Dockerfile (nginx-SPA, lokaal getest), deploy/compose.yaml, deploy/deploy.sh
- ⬜ DNS-records in Cloudflare (gebruiker) en proxy hosts in Nginx Proxy Manager (gebruiker)
- ⬜ Deploy naar vps.prisma-scripts.com en end-to-end-test op https://prismastream.patrickudo.nl
- 🔄 Eenvoudige sync: één account met e-mail en wachtwoord (zero-knowledge), tv koppelen met een code en goedkeuring op de telefoon (L: server, M: client)
- 🔄 Geen demobibliotheek online (DEMO_SOURCE=false op de server, VITE_DEMO=false in de productiebuild)
- ⬜ tvOS-app naar remote-modus en tv-login met code (Agent N)
- ⬜ Eindcontrole: code-review, regressie op horizontale scroll, build, iOS- en Android-sync
