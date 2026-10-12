# PrismaStream-backend: server-side catalogus

**Doel:** apparaten slaan bijna niets meer op. De server (`backend.prismastream.patrickudo.nl`) haalt de IPTV-bronnen op, voegt ze samen met dezelfde TypeScript-engine en cachet alles. Apparaten vragen alleen op wat op het scherm staat, en houden lokaal hooguit een kleine cache aan (doel: < 5 MB per apparaat).

**Privacy-keuze van de gebruiker:** de server kent de IPTV-inloggegevens. Die worden versleuteld opgeslagen met een serversleutel (AES-256-GCM, sleutel uit `SERVER_KEY` / `SERVER_KEY_FILE`, nooit in git). Profielen, favorieten, voortgang en geschiedenis blijven **end-to-end versleuteld** via de bestaande `/v1/docs`-sync. Inloggegevens komen nooit in logs, foutmeldingen of api-responses terecht.

## Productie

| Wat | Waar |
|---|---|
| Web-app (statische SPA) | `https://prismastream.patrickudo.nl` (nginx-container) |
| Backend (API, catalogus, sync, play-redirects, proxy) | `https://backend.prismastream.patrickudo.nl` (Node-container, poort 8787) |
| Host | `vps.prisma-scripts.com` (x86_64, ±1 GB RAM vrij!), Docker, Nginx Proxy Manager op het netwerk `proxy`, stack in `/opt/stacks/prismastream` |

**Resourcebudget:** de backend-container krijgt `mem_limit: 768m` en Node `--max-old-space-size=512`. Er draait maximaal 1 catalogus-build tegelijk (wachtrij). Streams en grote downloads gaan streamend door, niet in het geheugen.

## Authenticatie

- **Bearer-token:** dezelfde accounts en apparaat-tokens als de sync (`POST /v1/accounts`, `POST /v1/devices/pair`).
- **Accounts aanmaken:** alleen met een uitnodigingscode. `ALLOW_SIGNUP=false`, en `POST /v1/accounts` accepteert `{ signupCode }` als die overeenkomt met env `SIGNUP_CODE`. Anders kan iedereen de server als IPTV-fetcher of proxy gebruiken.
- **Account-salt:** de E2E-salt voor de persoonlijke data blijft zoals hij is.

## Shared core op de server

`src/core/node.ts` exporteert de pure functies als objecten, zonder JSON-strings: `buildCatalog`, `mergeSeasons`, `parseM3U`, `xtreamMap`, `parseXmltvText`, `pickVariant`, `displayTitleFor`, de search-index en `recommend`. Een build (`npm run build:core:node`) maakt `server/vendor/prisma-core.mjs` (ESM, Node). De server importeert die. De Dockerfile bouwt hem in een build-stage, zodat er in de runtime-image alleen JS staat.

## API v1 (catalogus)

Alle responses zijn JSON, met `Cache-Control` en een `ETag` waar dat zinvol is (`If-None-Match` geeft dan `304`). Een **TitleCard** is een lichte titel. Hij bevat **geen** `variants` en **geen** `seasons`:

```ts
type TitleCard = Pick<Title, 'id'|'kind'|'title'|'originalTitle'|'year'|'genres'|'rating'|'runtimeMin'
  |'posterUrl'|'backdropUrl'|'logoUrl'|'addedAt'|'popularity'|'languages'|'subtitleLanguages'|'qualities'
  |'certification'|'kidsSafe'|'originalLang'> & {
  altTitles: { title: string; lang?: string }[];   // max. 12 (voor displayTitle en zoeken)
  overview?: string;                               // max. 280 tekens
  seasonCount?: number;
};
```

| Methode en pad | Wat |
|---|---|
| `GET /v1/sources` | Bronnen van het account, zonder secrets: `{ id, type, name, enabled, serverUrl?, username?, playlistUrl?(gemaskeerd), epgUrl?, addedAt, lastSyncAt?, lastError?, stats?, account? }[]`. De ingebouwde demo-bron (`sample`) staat erbij en is aan/uit te zetten. |
| `POST /v1/sources/test` | Body: `{ type, serverUrl?, username?, password?, playlistUrl?, epgUrl? }`. Test zonder op te slaan. Geeft `{ ok, movies, series, channels, expiresAt?, status?, warnings? }` of `{ ok:false, code, message }`. |
| `POST /v1/sources` | Dezelfde body plus `name`. Slaat op (wachtwoord versleuteld) en start een refresh. Geeft de bron terug. |
| `PATCH /v1/sources/:id` | Naam, enabled, urls of een nieuw wachtwoord wijzigen. |
| `DELETE /v1/sources/:id` | Verwijdert de bron, zijn cache en zijn secrets. |
| `POST /v1/catalog/refresh` | Body `{ force?: boolean, sourceId?: string }`. Zet een refresh in de wachtrij. Geeft `202` met de status. |
| `GET /v1/catalog/meta` | `{ builtAt, status: 'empty'\|'building'\|'ready'\|'error', progress?, error?, counts: { movies, series, channels, programmes }, genres: { slug, name, count }[], languages: { lang, count }[], groups: { name, count }[] }` |
| `GET /v1/catalog/home` | Query `?kids=1&limit=20`. Geeft `{ featured: TitleCard[], recent, popularMovies, trendingSeries, genres: {slug,name,count}[], live: ChannelCard[] }`. Persoonlijke rijen (verder kijken, mijn lijst, aanbevolen) vult de client met `ids=`- en `recommend`-calls. |
| `GET /v1/catalog/titles` | Query `?kind=movie\|series&genre=<slug>&lang=<code>&sort=popular\|new\|az\|year&kids=1&limit=60&cursor=<opaque>` of `?ids=a,b,c` (max. 100). Geeft `{ items: TitleCard[], nextCursor?: string, total }`. |
| `GET /v1/catalog/titles/:id` | De volledige `Title`, met `variants` en (bij series) `seasons`. Series worden server-side lazy geladen en gecachet. Alle `StreamVariant.url` zijn **play-urls** (zie onder). Plus `similar: TitleCard[]` (max. 20). |
| `GET /v1/catalog/search` | Query `?q=&limit=&kids=1`. Geeft `{ query, total, movies: TitleCard[], series: TitleCard[], people: { name, titles: TitleCard[] }[], channels: ChannelCard[], genres: {slug,name}[], akas: Record<id,string> }`. |
| `POST /v1/catalog/recommend` | Body `{ history: string[], favorites: string[], limit?, kids? }`. Geeft `{ items: TitleCard[] }`. |
| `GET /v1/catalog/channels` | Query `?group=&lang=&kids=1`. Geeft `{ items: Channel[] }`. Varianten met play-urls; geen EPG. `ChannelCard` = `Channel` zonder `variants` (alleen `variantCount`). |
| `GET /v1/catalog/epg` | Query `?channels=<epgId,…>&from=<ms>&to=<ms>` (max. 50 zenders en 48 uur). Geeft `Record<epgId, EpgProgramme[]>`. |
| `GET /v1/catalog/nownext` | Query `?channels=<channelId,…>`. Geeft `Record<channelId, { now?, next? }>`. |

### Play-urls (geen inloggegevens op apparaten)

`StreamVariant.url` = `https://backend…/v1/play/<playToken>/<variantId-urlsafe>`. Dit endpoint antwoordt met `302` naar de echte provider-url (waarin de inloggegevens staan). Apparaten slaan dus geen IPTV-gegevens op. Hls.js, AVPlayer en ExoPlayer volgen redirects.

- `playToken`: een laag-geprivilegieerd token per apparaat, hetzelfde soort als de proxy-tokens (`ppx_…`). Het mag in een url staan en is intrekbaar.
- Met `?via=proxy` streamt de server de inhoud door de bestaande proxy (HLS-playlists worden herschreven). Dat is alleen voor de webversie, als CORS of mixed content het afspelen blokkeert. Het kost VPS-bandbreedte en is dus niet de standaard.
- Live-varianten krijgen ook `altUrls` als play-urls (de .ts-fallback).

### Server-side cache

- **Ruwe data per bron:** gzip-JSON in `/data/cache/<accountId>/<sourceId>/`, met een TTL van 12 uur voor de catalogus en 6 uur voor de EPG. Een refresh-scheduler vernieuwt per account gespreid.
- **Samengevoegde catalogus per account:** in het geheugen (LRU, maximaal 2 accounts tegelijk geladen), en op schijf als gzip-JSON plus een snelle index (id → offset, of een SQLite-tabel), zodat `titles/:id` niet de hele catalogus hoeft te laden.
- **EPG:** een SQLite-tabel `epg(account_id, epg_id, start, stop, title, desc, category)` met een index op `(account_id, epg_id, start)`. Programma's ouder dan 6 uur worden opgeruimd.
- **TMDB-verrijking:** server-side met de TMDB-sleutel van de server (`TMDB_API_KEY`, optioneel), gedeeld gecachet (zonder account-koppeling, want metadata is publiek).

## Client (web, Capacitor en tvOS)

- **Backend-url:** standaard `VITE_BACKEND_URL` (in de productiebuild `https://backend.prismastream.patrickudo.nl`), te wijzigen in de instellingen. Zonder backend werkt de app in **lokale modus** (demo plus lokale bronnen, zoals nu).
- **Remote-modus:**
  - de catalog store haalt alles via de API;
  - lokaal staat alleen een LRU-cache van TitleCards en details (max. ±300 items of 5 MB in IndexedDB) plus de laatste home-respons;
  - geen ruwe catalogi en geen IPTV-gegevens op het apparaat.
- **Bronnenbeheer:** in remote-modus gaat dat via `/v1/sources`. De gegevens gaan via TLS naar de server en worden lokaal niet bewaard.

## Accounts en synchronisatie: eenvoudig (besluit gebruiker, vervangt de wachtwoordzin- en koppelcode-flow als hoofdroute)

De gebruiker wil dat synchroniseren "gewoon" werkt via deze app en deze server: **één account met e-mail en wachtwoord**. Je logt op elk apparaat in en alles synchroniseert. Er is geen losse sync-server-url of wachtwoordzin; de backend-url zit vast in de build.

**Zero-knowledge-login** (zoals Bitwarden en 1Password):
- De client vraagt `POST /v1/auth/prelogin { email }` op en krijgt `{ salt, iterations }`. Voor onbekende e-mails komt er een deterministische nep-salt terug (HMAC van de e-mail met een serversleutel), zodat niet te zien is welke accounts bestaan.
- `masterKey = PBKDF2-SHA256(wachtwoord, salt, ≥ 600.000)`. Daaruit volgen via HKDF `authKey` (32 bytes) en de E2E-sleutels (`encKey` en `macKey`, zoals nu in src/lib/sync/crypto.ts).
- De client stuurt alleen `authKey` (base64) mee. De server bewaart `scrypt(authKey, serverSalt)` en ziet dus nooit het wachtwoord of de E2E-sleutel.

**Endpoints:**
- `POST /v1/auth/register { email, authKey, salt, iterations, signupCode, deviceName }` geeft `{ accountId, token, deviceId }`. Alleen met een geldige `SIGNUP_CODE` (uitnodigingscode).
- `POST /v1/auth/login { email, authKey, deviceName }` geeft `{ accountId, token, deviceId }`. Er zit een rate-limit en lockout per e-mail en per IP op. De fout is altijd generiek: "e-mail of wachtwoord onjuist".
- `POST /v1/auth/logout` trekt het token van dit apparaat in. De bestaande `/v1/devices`-endpoints blijven voor het apparatenoverzicht en het afmelden van een apparaat.
- `POST /v1/auth/password { oldAuthKey, newAuthKey, newSalt, newIterations }`: wachtwoord wijzigen. De client versleutelt eerst alle E2E-docs opnieuw met de nieuwe sleutel.

**Tv-login** (Apple TV, Android TV, en alles zonder fijn toetsenbord), apparaat-flow met overdracht van de E2E-sleutel:
1. De tv maakt een ECDH P-256-sleutelpaar en roept `POST /v1/auth/device-code { publicKey, deviceName }` aan. Hij krijgt `{ userCode: 'ABCD-1234', deviceCode, verifyUrl: 'https://prismastream.patrickudo.nl/activate', expiresIn: 600, interval: 3 }`.
2. De tv toont de code (plus een QR-code van `verifyUrl?code=…`). De gebruiker opent die url op een ingelogd apparaat, of kiest in de app "Tv koppelen", en voert de code in.
3. Het ingelogde apparaat haalt `GET /v1/auth/device-code/:userCode` op (geeft `{ deviceName, publicKey }`), versleutelt de E2E-`masterKey` met ECDH (eigen ephemeral key) + HKDF + AES-GCM naar de publieke sleutel van de tv, en stuurt `POST /v1/auth/device-code/:userCode/approve { sealedKey, ephemeralPublicKey }`.
4. De tv pollt `POST /v1/auth/device-token { deviceCode }` en krijgt na goedkeuring `{ accountId, token, deviceId, sealedKey, ephemeralPublicKey }`. Daarna ontsleutelt hij de masterKey lokaal. De server ziet de sleutel nooit onversleuteld.

**Migratie:** bestaande sync-accounts (wachtwoordzin-flow) blijven werken. Het is prima als `/v1/accounts` en `pairing` alleen nog intern of als legacy bestaan.

## Demo-bibliotheek: niet online

- **Server:** in productie (`DEMO_SOURCE=false`, standaard in de productie-compose) krijgt een account géén `sample`-bron. `GET /v1/sources` toont hem niet, en de catalogus bevat alleen echte bronnen.
- **Productie-web-app** (`VITE_DEMO=false`): geen demobron in lokale modus en geen demodata in de bundel (tree-shaken waar mogelijk). Zonder bronnen staat er een nette lege staat met "Voeg je IPTV-bron toe" (Xtream of M3U).
- **Ontwikkeling en tests:** de demo blijft beschikbaar (`DEMO_SOURCE=true` en `VITE_DEMO=true`, de standaard in dev).
