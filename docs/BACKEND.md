# PrismaStream-backend: server-side catalogus

**Doel:** apparaten slaan bijna niets meer op. De server (`backend.prismastream.patrickudo.nl`) haalt de IPTV-bronnen op, voegt ze samen met dezelfde TypeScript-engine en cachet alles. Apparaten vragen alleen op wat op het scherm staat, en houden lokaal hooguit een kleine cache aan (doel: < 5 MB per apparaat).

**Privacy-keuze van de gebruiker:** de server kent de IPTV-inloggegevens. Die worden versleuteld opgeslagen met een serversleutel (AES-256-GCM, sleutel uit `SERVER_KEY` / `SERVER_KEY_FILE`, nooit in git). Profielen, favorieten, voortgang en geschiedenis blijven **end-to-end versleuteld** via de bestaande `/v1/docs`-sync. Inloggegevens komen nooit in logs, foutmeldingen of api-responses terecht.

## Productie

| Wat                                                   | Waar                                                                                                                                        |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Web-app (statische SPA)                               | `https://prismastream.patrickudo.nl` (nginx-container)                                                                                      |
| Backend (API, catalogus, sync, play-redirects, proxy) | `https://backend.prismastream.patrickudo.nl` (Node-container, poort 8787)                                                                   |
| Host                                                  | `vps.prisma-scripts.com` (x86_64, ±1 GB RAM vrij!), Docker, Nginx Proxy Manager op het netwerk `proxy`, stack in `/opt/stacks/prismastream` |

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
type TitleCard = Pick<
	Title,
	| 'id'
	| 'kind'
	| 'title'
	| 'originalTitle'
	| 'year'
	| 'genres'
	| 'rating'
	| 'runtimeMin'
	| 'posterUrl'
	| 'backdropUrl'
	| 'logoUrl'
	| 'addedAt'
	| 'popularity'
	| 'languages'
	| 'subtitleLanguages'
	| 'qualities'
	| 'certification'
	| 'kidsSafe'
	| 'originalLang'
> & {
	altTitles: { title: string; lang?: string }[]; // max. 12 (voor displayTitle en zoeken)
	overview?: string; // max. 280 tekens
	seasonCount?: number;
};
```

| Methode en pad               | Wat                                                                                                                                                                                                                                                               |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /v1/sources`            | Bronnen van het account, zonder secrets: `{ id, type, name, enabled, serverUrl?, username?, playlistUrl?(gemaskeerd), epgUrl?, addedAt, lastSyncAt?, lastError?, stats?, account? }[]`. De ingebouwde demo-bron (`sample`) staat erbij en is aan/uit te zetten.   |
| `POST /v1/sources/test`      | Body: `{ type, serverUrl?, username?, password?, playlistUrl?, epgUrl? }`. Test zonder op te slaan. Geeft `{ ok, movies, series, channels, expiresAt?, status?, warnings? }` of `{ ok:false, code, message }`.                                                    |
| `POST /v1/sources`           | Dezelfde body plus `name`. Slaat op (wachtwoord versleuteld) en start een refresh. Geeft de bron terug.                                                                                                                                                           |
| `PATCH /v1/sources/:id`      | Naam, enabled, urls of een nieuw wachtwoord wijzigen.                                                                                                                                                                                                             |
| `DELETE /v1/sources/:id`     | Verwijdert de bron, zijn cache en zijn secrets.                                                                                                                                                                                                                   |
| `POST /v1/catalog/refresh`   | Body `{ force?: boolean, sourceId?: string }`. Zet een refresh in de wachtrij. Geeft `202` met de status.                                                                                                                                                         |
| `GET /v1/catalog/meta`       | `{ builtAt, status: 'empty'\|'building'\|'ready'\|'error', progress?, error?, counts: { movies, series, channels, programmes }, genres: { slug, name, count }[], languages: { lang, count }[], groups: { name, count }[] }`                                       |
| `GET /v1/catalog/home`       | Query `?kids=1&limit=20`. Geeft `{ featured: TitleCard[], recent, popularMovies, trendingSeries, genres: {slug,name,count}[], live: ChannelCard[] }`. Persoonlijke rijen (verder kijken, mijn lijst, aanbevolen) vult de client met `ids=`- en `recommend`-calls. |
| `GET /v1/catalog/titles`     | Query `?kind=movie\|series&genre=<slug>&lang=<code>&sort=popular\|new\|az\|year&kids=1&limit=60&cursor=<opaque>` of `?ids=a,b,c` (max. 100). Geeft `{ items: TitleCard[], nextCursor?: string, total }`.                                                          |
| `GET /v1/catalog/titles/:id` | De volledige `Title`, met `variants` en (bij series) `seasons`. Series worden server-side lazy geladen en gecachet. Alle `StreamVariant.url` zijn **play-urls** (zie onder). Plus `similar: TitleCard[]` (max. 20).                                               |
| `GET /v1/catalog/search`     | Query `?q=&limit=&kids=1`. Geeft `{ query, total, movies: TitleCard[], series: TitleCard[], people: { name, titles: TitleCard[] }[], channels: ChannelCard[], genres: {slug,name}[], akas: Record<id,string> }`.                                                  |
| `POST /v1/catalog/recommend` | Body `{ history: string[], favorites: string[], limit?, kids? }`. Geeft `{ items: TitleCard[] }`.                                                                                                                                                                 |
| `GET /v1/catalog/channels`   | Query `?group=&lang=&kids=1`. Geeft `{ items: Channel[] }`. Varianten met play-urls; geen EPG. `ChannelCard` = `Channel` zonder `variants` (alleen `variantCount`).                                                                                               |
| `GET /v1/catalog/epg`        | Query `?channels=<epgId,…>&from=<ms>&to=<ms>` (max. 50 zenders en 48 uur). Geeft `Record<epgId, EpgProgramme[]>`.                                                                                                                                                 |
| `GET /v1/catalog/nownext`    | Query `?channels=<channelId,…>`. Geeft `Record<channelId, { now?, next? }>`.                                                                                                                                                                                      |

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

## Status (server, Agent L)

Gebouwd en getest (`cd server && npm test`: 72 tests; root `npm test` en `npm run check` groen):

- **Kern op Node:** `src/core/node.ts` (object-API) → `npm run build:core:node` → `server/vendor/prisma-core.mjs` (ESM, node24, saxes inbegrepen). Types: `server/vendor/prisma-core.d.mts` (met de hand; `src/core/node.test.ts` bewaakt dat de exports gelijk blijven). De bundel staat in git (server en tests werken zonder root-build); de Dockerfile bouwt hem altijd opnieuw uit de bron.
- **Accounts:** e-mail + zero-knowledge-login, tv-login met ECDH-verzegelde sleutel, `signupCode`, lockout. Legacy `/v1/accounts` en pairing werken nog.
- **Bronnen en catalogus:** alle endpoints uit dit document; opslag in SQLite (`DATA_DIR/catalog.db`) plus ruwe gzip-NDJSON per bron in `DATA_DIR/cache/<account>/<bron>/`. Builds in een worker thread (1 tegelijk), streamend en in batches, met een nieuwe generatie per build, scheduler elke 12 uur, lazy Xtream-series, optionele TMDB-verrijking met gedeelde cache.
- **Stream-urls:** de server zit nooit in het pad van video. `titles/:id` en `channels` geven de echte provider-urls (inloggegevens per verzoek ingevuld, `Cache-Control: private, no-store`, geen ETag); de apparaten streamen zelf. Play-routes, play-tokens en de stream-proxy zijn verwijderd; de oude CORS-proxy staat standaard uit.
- **Gemeten (300.000 items + 840.000 EPG-programma's):** build ± 16 s lokaal en 25 s in de container. Piek-RSS van het serverproces 455–480 MB lokaal (macOS) en 361–447 MB in de container (`--memory 768m`, incl. queries en een geforceerde rebuild). De build draait in batches, per soort, met een eigen generatie in SQLite. Zie `server/README.md`.
- **Docker:** `docker build -f server/Dockerfile -t prismastream-server .` (context = repo-root), non-root, healthcheck, `NODE_OPTIONS=--max-old-space-size=512`.

## Wijzigingen

Aanvullingen en precisering van het contract door de server (alles additief, tenzij anders vermeld):

1. ~~**Play-urls:**~~ *Vervallen, zie 14.* formaat `${PUBLIC_URL}/v1/play/<playToken>/<base64url(variantId)>[~n][.ext]`. `~n` = `altUrls[n-1]` (live: de `.ts`-tweeling van een Xtream-`.m3u8`); `.ext` is de extensie van de echte stream (helpt AVPlayer/ExoPlayer bij het herkennen van HLS). De client hoeft dit niet zelf te bouwen: elke `variants[].url`/`altUrls` in `titles/:id` en `channels` is al een play-url voor het apparaat dat de aanvraag doet.
2. ~~**Play-token:**~~ *Vervallen, zie 14.* `GET /v1/play-token` → `{ playToken, prefix }` (huidig), `POST /v1/play-token` → nieuw token; alle oude play-urls van dat apparaat vervallen. Afmelden van het apparaat trekt ze ook in. `?via=proxy` werkt op elke play-url (ook HEAD en Range); segmenten lopen via `/v1/play/<token>/s/<verzegeld>` (intern, niet zelf bouwen).
3. **`StreamVariant.upstreamHttp: boolean`** (alleen in API-antwoorden): `true` als de echte stream `http:` is. Dan heeft de https-webversie `?via=proxy` nodig.
4. **Series in `titles/:id`** hebben altijd `seasons` (eventueel `[]` als de provider faalde; de server probeert het na 5 minuten opnieuw). `?kids=1` op `titles/:id` geeft `403 kids_restricted` voor titels die niet kindveilig zijn.
5. **Bronnen:** extra velden `errorCode`, `lastWarning`, `epgSyncAt`; `account` bevat ook `activeConnections` en `isTrial`. `DELETE /v1/sources/sample` verwijdert de demo niet maar zet hem uit (`{ ok: true, disabled: true }`); andere bronnen: `200 { ok: true }`. `POST`/`PATCH` geven bij ongeldige invoer `400 invalid_source` of `400 blocked_address`.
6. **Foutcodes van bronnen** (`POST /v1/sources/test` → `{ ok:false, code, message, expiresAt? }`, en `errorCode` op de bron): `unreachable`, `timeout`, `auth`, `expired` (met `expiresAt`), `banned_ip` (HTTP 403 van de provider; vaak een geblokkeerd datacenter-IP), `invalid_response`, `too_large`, `blocked_address`, `http`, `config`. Een geslaagde test geeft ook `maxConnections`, `activeConnections`, `epgSuggestion` (M3U, gemaskeerd) en `warnings`. Max. 10 tests per 10 minuten per account.
7. **Catalogus:** `meta` accepteert `?kids=1` en geeft tijdens een build ook `phase`. `refresh` geeft `202 { queued: true, status: 'building', state }`; met `force` of `sourceId` max. 6 per uur. `titles?ids=` behoudt de volgorde van `ids`. `sort=year` is aflopend. `search.genres[]` heeft ook `movies`, `series` en `count`. `epg` zonder `from`/`to`: `now − 2 u` tot `from + 24 u`; het venster wordt op 48 uur afgekapt. `nownext` max. 200 zenders, `Cache-Control: private, max-age=30`.
8. **Auth:** `register`/`login` geven ook `salt` en `kdf`; `iterations` minimaal 600.000. `register` → `409 email_taken` bij een bestaand adres, `403 invalid_signup_code` zonder geldige code. `login` → `429` (met `Retry-After`) na 10 mislukte pogingen per e-mailadres in 15 minuten, `409 device_limit` bij te veel apparaten. `password` meldt **alle andere apparaten af** en geeft `{ ok, revokedDevices, salt, kdf }`. Uitloggen van het laatste apparaat verwijdert een e-mailaccount niet (legacy-accounts wel, zoals voorheen).
9. **Tv-login:** `device-code` geeft ook `verifyUrlComplete` (`verifyUrl?code=ABCD-EFGH`; de code komt uit een alfabet zonder 0/O/1/I/L). `publicKey` en `ephemeralPublicKey`: P-256 als base64 van het ruwe punt (65 bytes, aanbevolen: `exportKey('raw')`), SPKI-DER, of een JWK-string. `GET device-code/:userCode` geeft ook `userCode` en `expiresAt`. Pollen: `400 { error: 'authorization_pending' | 'slow_down' | 'expired_token' | 'invalid_grant', interval? }`. `sealedKey` is voor de server een ondoorzichtige base64-string (aanbevolen: `iv(12) ‖ AES-GCM-ciphertext` met een sleutel uit ECDH + HKDF-SHA256, info `prismastream-device-v1`, zoals in `server/test/auth.test.ts`).
10. **Aanmelden:** de legacy `POST /v1/accounts` accepteert ook `signupCode` en weigert zonder code als `ALLOW_SIGNUP=false`.
11. **CORS:** `PATCH` en de header `If-None-Match` zijn toegestaan.
12. **Nieuwe env:** `DEMO_SOURCE`, `DATA_DIR`, `SERVER_KEY(_FILE)`, `SIGNUP_CODE`, `TMDB_API_KEY`, `VERIFY_URL`, `CATALOG_*`, `*_MAX_BYTES`, `FETCH_*` (zie `server/README.md`).
13. **Uitnodigingscodes:** `signupCode` in `POST /v1/auth/register` (en de legacy `POST /v1/accounts`) mag de hoofdcode `SIGNUP_CODE` zijn (herbruikbaar) of een eenmalige uitnodigingscode (`XXXXX-XXXXX`, Crockford-base32; hoofdletters, spaties en streepjes maken niet uit). Een gebruikte, verlopen of ingetrokken code geeft `403 invalid_signup_code` (legacy: `403 signup_disabled`). Codes maak je met de CLI (`node src/cli.ts invite create`, zie `server/README.md`).
14. **De server zit nooit in het pad van videostreams** (besluit gebruiker; vervangt de sectie "Play-urls" hierboven en de punten 1 en 2):
    - `/v1/play/:token/:variant` (302 en `?via=proxy`), het HLS-herschrijven, de segment-proxy en `GET`/`POST /v1/play-token` zijn verwijderd (404). Play-tokens bestaan niet meer.
    - `GET /v1/catalog/titles/:id` en `GET /v1/catalog/channels` geven in `StreamVariant.url` en `altUrls` de **echte upstream-urls**, met de inloggegevens van de bron op het moment van het verzoek ingevuld, alleen voor het geauthenticeerde account. Deze antwoorden hebben `Cache-Control: private, no-store` en **geen ETag** (dus ook geen 304). `upstreamHttp` blijft. Varianten waarvan de bron niet meer bestaat, vallen weg.
    - Lijsten (`titles`, `home`, `search`, `recommend`) bevatten nooit stream-urls (alleen TitleCards en ChannelCards).
    - De oude CORS-proxy `/v1/proxy/:token` en `POST /v1/proxy-token` staan standaard **uit** (`PROXY_ENABLED=false`, ook in productie): de routes bestaan dan niet (404). Hij wordt alleen nog gebruikt door de lokale modus van de webversie (`src/lib/sources` via `getSyncProxyPrefix()` in `src/lib/sync`) om playlists en API's op te halen; de client moet een 404 op `/v1/proxy-token` netjes opvangen (geen proxy).
    - Logs: alleen methode, pad zonder query (de detail-route als `/v1/catalog/titles/:id`), status en duur; fout- en waarschuwingsregels bevatten nooit urls (`<url>`).
15. **Grote catalogi (geheugenzuinige build):** `GET /v1/catalog/meta` geeft na een mislukte build `status: 'error'` met `error` (begrijpelijke tekst) en `errorCode` (`too_large` | `timeout` | `build_failed`). `counts`, `genres` enzovoort horen dan bij de vorige, nog actieve catalogus, en alle catalogus-endpoints blijven die serveren. Een lege 'ready' komt dus niet meer voor als de build faalde. Bij een geslaagde build verdwijnen `error` en `errorCode`. Verder:
    - de build verwerkt films, series en zenders na elkaar en in batches;
    - de EPG gaat streamend naar SQLite; per zender en starttijd wordt één programma bewaard;
    - `CATALOG_BUILD_MEMORY_MB` is standaard 256;
    - gemeten met 300.000 items + 840.000 EPG-programma's: zie `server/README.md`.
