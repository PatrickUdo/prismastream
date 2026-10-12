# PrismaStream-backend

De server achter `https://backend.prismastream.patrickudo.nl`. Hij doet vier dingen:

1. **Accounts en sync**: één account met e-mail en wachtwoord (zero-knowledge-login), apparaten,
   tv-login met een code, en end-to-end versleutelde persoonlijke data (`/v1/docs`).
2. **Server-side catalogus**: haalt per account de IPTV-bronnen op (Xtream Codes, M3U, XMLTV),
   voegt alles samen met dezelfde TypeScript-engine als de apps, en cachet het. Apparaten vragen
   alleen op wat op het scherm staat.
3. **Nooit in het pad van video**: streamen gebeurt uitsluitend op het apparaat, rechtstreeks bij
   de IPTV-provider. De detail- en zender-antwoorden bevatten daarvoor de echte stream-urls, met de
   inloggegevens op het moment van het verzoek ingevuld (`Cache-Control: private, no-store`).
4. De oude **CORS-proxy** (`/v1/proxy/…`) staat standaard **uit** (`PROXY_ENABLED=false`); de
   routes bestaan dan niet (404). Hij is alleen nog bedoeld voor de lokale modus van de webversie
   (playlists en API's ophalen), nooit voor video.

Techniek: Node 26 (draait TypeScript direct), [Hono](https://hono.dev), `node:sqlite` (WAL),
worker threads voor catalogus-builds. Het contract staat in [`docs/BACKEND.md`](../docs/BACKEND.md).

## Starten (ontwikkeling)

```bash
# eenmalig in de repo-root: de gedeelde kern bundelen naar server/vendor/prisma-core.mjs
npm run build:core:node

cd server
npm install
npm run dev        # poort 8787, data in ./data (een ontwikkelsleutel wordt daar aangemaakt)
npm test           # node:test: accounts, auth, invites, bronnen, catalogus, stream-urls, proxy, 50k
npm run typecheck
```

`server/vendor/prisma-core.mjs` staat in git, zodat de server en de tests zonder root-build
werken. **Bouw hem opnieuw** na elke wijziging in `src/lib/{merge,providers,sample,search,tmdb}`
of `src/core/node.ts`. De Dockerfile bouwt hem altijd opnieuw uit de bron (stage 1), dus de image
loopt nooit achter. De typen staan in `server/vendor/prisma-core.d.mts` (met de hand
bijgehouden; `src/core/node.test.ts` controleert dat de exports overeenkomen).

## Configuratie (omgevingsvariabelen)

| Variabele | Standaard | Betekenis |
| --- | --- | --- |
| `NODE_ENV` | | `production`: strengere standaarden (geen open aanmelding, geen demo, `SERVER_KEY` verplicht) |
| `PORT` / `HOST` | `8787` / `0.0.0.0` | Luisteradres |
| `DATA_DIR` | `./data` (image: `/data`) | Alle data: sync-database, `catalog.db`, `cache/`, ontwikkelsleutel |
| `DB_PATH` | `$DATA_DIR/prismastream-sync.db` | Sync-database (accounts, apparaten, docs, bronnen) |
| `SERVER_KEY` | | Base64 van 32 bytes (`openssl rand -base64 32`). Versleutelt IPTV-wachtwoorden en leidt de nep-salts af. **Verplicht in productie** |
| `SERVER_KEY_FILE` | | Pad naar een bestand met die sleutel (Docker secret), in plaats van `SERVER_KEY` |
| `PUBLIC_URL` | (uit het verzoek) | Publiek adres, bv. `https://backend.prismastream.patrickudo.nl`. Gebruikt door de (standaard uitgeschakelde) CORS-proxy |
| `CORS_ORIGINS` | | Extra origins (kommagescheiden). Productie: `https://prismastream.patrickudo.nl`. De Capacitor-origins (`capacitor://localhost`, `https://localhost`, `http://localhost`, `ionic://localhost`) staan er standaard al in |
| `TRUST_PROXY` | `false` | `true` achter Nginx Proxy Manager (`X-Forwarded-For/-Proto/-Host`) |
| `ALLOW_SIGNUP` | `true` (dev), `false` (productie) | Open aanmelding zonder code |
| `SIGNUP_CODE` | | Hoofdcode voor `POST /v1/auth/register` (en de legacy `POST /v1/accounts`): onbeperkt herbruikbaar, timing-safe vergeleken. Daarnaast werken eenmalige uitnodigingscodes (zie *Beheer*) |
| `DEMO_SOURCE` | `true` (dev), `false` (productie) | De fictieve demobibliotheek als bron per account |
| `VERIFY_URL` | `https://prismastream.patrickudo.nl/activate` | Url die een tv bij de inlogcode toont |
| `TMDB_API_KEY` | | Optioneel: server-side TMDB-verrijking, gedeelde cache. `TMDB_MAX_TITLES` (400) per build |
| `CATALOG_ENABLED` | `true` | Catalogus en bronnen aan/uit |
| `CATALOG_LANG` | `nl` | Taal voor overzichten en afleveringstitels in de samengevoegde catalogus |
| `CATALOG_REFRESH_HOURS` | `12` | Automatisch vernieuwen per account met bronnen (gespreid, `0` = uit) |
| `CATALOG_BUILD_MEMORY_MB` | `256` | Heap-limiet van de build-worker (300.000 items passen ruim; verhogen is niet nodig) |
| `M3U_MAX_BYTES` / `JSON_MAX_BYTES` / `XMLTV_MAX_BYTES` | 200 / 200 / 300 MB | Maximale downloadgroottes (na uitpakken) |
| `FETCH_TIMEOUT_MS` | `30000` | Time-out voor verbinden en headers naar IPTV-servers |
| `FETCH_USER_AGENT` | `PrismaStream/1.0` | User-Agent richting IPTV-servers |
| `PROXY_ENABLED` | `false` | Oude CORS-proxy `/v1/proxy` (alleen lokale modus van de webversie, nooit video). Uit = routes bestaan niet |
| `PROXY_ALLOW_PRIVATE` | `false` | **Gevaarlijk.** Privé-/loopback-adressen toestaan (alleen tests of een gesloten LAN) |
| `PROXY_MAX_BYTES` / `PROXY_TIMEOUT_MS` | 100 MB / 20 s | Limieten van `/v1/proxy` |
| `RATE_LIMIT_PER_MIN` / `PROXY_RATE_LIMIT_PER_MIN` | 600 / 1200 | Verzoeken per minuut per IP (API) en per apparaat (proxy) |
| `BODY_LIMIT_BYTES`, `MAX_DOCS_PER_ACCOUNT`, `MAX_DEVICES_PER_ACCOUNT`, `LOG` | 2 MB, 1000, 20, `true` | Overige limieten en het toegangslog |

## Endpoints

Alle antwoorden zijn JSON; fouten: `{ "error": "<code>", "message": "…" }`. Auth = `Authorization: Bearer pst_…`.

**Accounts en apparaten**

| Methode en pad | Auth | Wat |
| --- | --- | --- |
| `GET /v1/health` | nee | `{ ok, service, version, time }` |
| `POST /v1/auth/prelogin` | nee | `{ email }` → `{ salt, iterations, kdf }`. Onbekend e-mailadres: deterministische nep-salt |
| `POST /v1/auth/register` | nee | `{ email, authKey, salt, iterations, signupCode, deviceName }` → `201 { accountId, token, deviceId, salt, kdf }` |
| `POST /v1/auth/login` | nee | `{ email, authKey, deviceName }` → `{ accountId, token, deviceId, salt, kdf }`; altijd dezelfde fout `401 invalid_credentials` |
| `POST /v1/auth/logout` | ja | Trekt het token van dit apparaat in |
| `POST /v1/auth/password` | ja | `{ oldAuthKey, newAuthKey, newSalt, newIterations }` → `{ ok, revokedDevices, salt, kdf }`; andere apparaten worden afgemeld |
| `POST /v1/auth/device-code` | nee | Tv: `{ publicKey, deviceName }` → `201 { userCode, deviceCode, verifyUrl, verifyUrlComplete, expiresIn: 600, interval: 3 }` |
| `GET /v1/auth/device-code/:userCode` | ja | `{ userCode, deviceName, publicKey, expiresAt }` |
| `POST /v1/auth/device-code/:userCode/approve` | ja | `{ sealedKey, ephemeralPublicKey }` → `{ ok }` |
| `POST /v1/auth/device-token` | nee | Tv pollt `{ deviceCode }` → `400 authorization_pending / slow_down / expired_token / invalid_grant`, of `{ accountId, token, deviceId, sealedKey, ephemeralPublicKey, salt, kdf }` |
| `GET /v1/me`, `DELETE /v1/account` | ja | Account-info; account met alles verwijderen |
| `GET /v1/devices`, `DELETE /v1/devices/:id` | ja | Apparaten bekijken en afmelden |
| `POST /v1/accounts`, `/v1/pairing-codes`, `/v1/devices/pair` | | Legacy (wachtwoordzin-flow); `POST /v1/accounts` vraagt nu ook om `signupCode` als aanmelden dicht is |
| `GET/PUT /v1/docs…`, `GET /v1/events` | ja | E2E-versleutelde documenten en long-poll (ongewijzigd) |

**Bronnen en catalogus** (zie `docs/BACKEND.md` voor de vormen)

| Methode en pad | Wat |
| --- | --- |
| `GET /v1/sources` | Bronnen zonder secrets (playlist- en EPG-url gemaskeerd), met `lastSyncAt`, `lastError`, `errorCode`, `lastWarning`, `stats`, `account` |
| `POST /v1/sources/test` | Test zonder opslaan: `{ ok, movies, series, channels, expiresAt?, status?, warnings }` of `{ ok:false, code, message, expiresAt? }` |
| `POST /v1/sources`, `PATCH /v1/sources/:id`, `DELETE /v1/sources/:id` | Opslaan (wachtwoord versleuteld) en vernieuwen; `DELETE sample` zet de demo alleen uit |
| `POST /v1/catalog/refresh` | `{ force?, sourceId? }` → `202` |
| `GET /v1/catalog/meta` | Status, aantallen, genres, talen, groepen (`?kids=1`) |
| `GET /v1/catalog/home` | `?kids=1&limit=20` |
| `GET /v1/catalog/titles` | `?kind&genre&lang&sort=popular\|new\|az\|year&kids&limit&cursor` of `?ids=a,b` |
| `GET /v1/catalog/titles/:id` | Volledige titel met directe stream-urls (inloggegevens ingevuld), `upstreamHttp` per variant en `similar`. `Cache-Control: private, no-store`, geen ETag |
| `GET /v1/catalog/search` | `?q&limit&kids` |
| `POST /v1/catalog/recommend` | `{ history, favorites, limit?, kids? }` |
| `GET /v1/catalog/channels` | `?group&lang&kids`, met directe stream-urls (`private, no-store`, geen ETag) |
| `GET /v1/catalog/epg` | `?channels=<epgId,…>&from&to` (max. 50 zenders, 48 uur) |
| `GET /v1/catalog/nownext` | `?channels=<channelId,…>` |
| `POST /v1/proxy-token`, `GET /v1/proxy/:token?url=` | Oude CORS-proxy, alleen met `PROXY_ENABLED=true` |

Lijsten (titles, home, search, recommend) geven alleen lichte `TitleCard`s, nooit stream-urls.
Die catalogus-GETs hebben een `ETag` (`If-None-Match` → `304`) en `Cache-Control: private,
no-cache`. Antwoorden mét stream-urls (`titles/:id`, `channels`) krijgen `private, no-store` en
geen ETag.

## Architectuur van de catalogus

```
bron-urls ──(worker thread, 1 tegelijk)──▶ cache/<account>/<bron>/items.ndjson.gz + meta.json (12 u)
 (Xtream, M3U)    item voor item, gemaskeerd                                 (geen grote JSON)
 XMLTV ───────────── streamend, direct naar SQLite ───────────────▶ cat_epg   + epg.ndjson.gz (6 u)
                                                     │
        films, dan series, dan zenders; per soort in batches van onafhankelijke titelgroepen
        buildCatalog() uit de gedeelde kern (server/vendor/prisma-core.mjs)
                                                     │  transacties van 5.000 rijen
                                                     ▼
 catalog.db, generatie <account>@<gen>: cat_titles (TitleCard-JSON + kolommen kind, genres, talen,
             populariteit, addedAt, jaar, sorteertitel, kids), cat_details (volledige titel, deflate),
             cat_variants (variant-id → gemaskeerde url), cat_channels, cat_epg
 + cat_state (actieve generatie, meta, fout), cat_series (lazy afleveringen), tmdb_* (gedeeld)
                                                     │
 hoofdthread: SQL voor lijsten/filters/cursor, LRU (max. 2 accounts) met een compacte titellijst
             en de zoekindex, lazy Xtream-series bij /titles/:id, stream-urls invullen
```

- **Waarom SQLite:** lijsten, filters en cursor-paginering zijn indexqueries over lichte rijen,
  een detailpagina leest één gecomprimeerde rij, en niets hoeft de hele catalogus in het
  geheugen te hebben. `catalog.db` is een cache: weggooien kost alleen een nieuwe build.
- **Nooit alles tegelijk in het geheugen:**
  - Downloads worden item voor item naar de cache geschreven (Xtream-lijsten uit de JSON-stroom,
    dubbele stream-ids één keer). XMLTV gaat met saxes (gzip herkend), gefilterd op het venster
    (nu − 6 u … nu + 48 u) en op bestaande zenders, rechtstreeks naar SQLite.
  - Films, series en zenders worden na elkaar samengevoegd; alleen die soort wordt uit de cache
    gelezen.
  - Binnen een soort wordt eerst met compacte gegevens (hashes, een `Int32Array`-union-find)
    bepaald welke items ooit met elkaar kunnen matchen (zelfde tmdb-/imdb-id of titelsleutel).
    Zulke groepen blijven samen in één batch van ± 25.000 items; elke batch gaat door dezelfde
    `buildCatalog()` en geeft dus dezelfde titels als één grote merge (getest). Na het schrijven
    wordt de batch vrijgegeven.
  - Rijen gaan in transacties van 5.000 naar een **nieuwe generatie**. Lezers gebruiken de oude
    tot één kleine transactie de actieve generatie omzet; daarna wordt de oude verwijderd en de
    ruimte teruggegeven (`auto_vacuum = INCREMENTAL`).
- **Mislukte build:** de nieuwe generatie wordt weggegooid, de vorige blijft actief. `meta` geeft
  dan `status: 'error'`, `error` (begrijpelijke tekst) en `errorCode` (`too_large`, `timeout` of
  `build_failed`), met de aantallen van de nog actieve catalogus.
- **Wachtrij:** maximaal één build tegelijk, in een eigen worker thread met een eigen heap-limiet
  (`CATALOG_BUILD_MEMORY_MB`, standaard 256). Een te grote catalogus laat dus de worker falen,
  niet de API. Tijdens de build gooit de hoofdthread de geheugenlijsten van dat account weg
  (`--expose-gc` in de image ruimt ze direct op).
- **Vernieuwen:** elke 12 uur per account met echte bronnen (gespreid met een vaste jitter per
  account; accounts zonder activiteit in 30 dagen worden overgeslagen), plus op verzoek. Bij een
  storing bij de provider blijft de oude cache in gebruik (`lastError` staat op de bron).
- **Lazy series:** Xtream-afleveringen (`get_series_info`) worden bij het eerste
  `GET /titles/:id` opgehaald, samengevoegd met dezelfde logica als de apps, en 12 uur bewaard
  (ook over builds heen).
- **TMDB:** met `TMDB_API_KEY` zoekt de build na afloop de populairste titels op (uit de
  opgeslagen kaarten, niet uit het geheugen). Resultaten staan gedeeld in `tmdb_cache`,
  `tmdb_meta` en `tmdb_keys`; als er iets nieuws gevonden is, volgt één extra build die de ids
  gebruikt.

**Gemeten met 300.000 items**: 180.000 VOD-items met echte Xtream-velden, in twee taalversies,
met dubbele vermeldingen en lege categorieën; 45.000 series met plot en cast; 30.000 zenders; en
XMLTV voor alle 30.000 zenders (840.000 programma's in het venster). Test `test/memory.test.ts`,
met de mock-provider in een apart proces.

| Meting | Resultaat |
| --- | --- |
| Lokaal (macOS): build | ± 16 s |
| Lokaal: piek-RSS van het hele serverproces, incl. worker en queries | 455–480 MB (macOS geeft vrijgegeven geheugen traag terug) |
| Lokaal: queries | lijstpagina 5 ms, gefilterd en gesorteerd ± 160 ms, detail 5 ms, home ± 330 ms (laadt de compacte lijst), eerste zoekopdracht ± 0,9 s (bouwt de index), daarna ± 13 ms |
| Docker (`--memory 768m`, Linux): eerste build incl. ophalen | 25 s, piek-RSS (VmHWM) 361 MB |
| Docker: na home, zoeken en alle 30.000 zenders | 401 MB |
| Docker: geforceerde rebuild met geladen zoekindex, daarna opnieuw home en zoeken | 39 s, piek 447 MB (doel < 500 MB) |
| `catalog.db` | ± 430 MB (840.000 EPG-rijen) |

Ter vergelijking: de oude build (alles in één keer) liep met deze omvang uit het geheugen, ook met
560 MB heap.

## Beveiligingsmodel

**Wat de server ziet (bewuste keuze):** de IPTV-inloggegevens. Hij moet de bronnen zelf
ophalen. Wachtwoorden en volledige playlist-/EPG-urls staan versleuteld in de tabel `sources`
(AES-256-GCM met een subsleutel van `SERVER_KEY`, gebonden aan account en bron). In de caches en
in `catalog.db` staan stream-urls **gemaskeerd**: de inloggegevens zijn vervangen door
plaatshouders en worden pas ingevuld in het antwoord op `titles/:id` of `channels` van het eigen
account. Wie de schijf heeft maar niet de `SERVER_KEY`, kan de wachtwoorden dus niet lezen. Wie
de draaiende server (of de sleutel en de schijf) heeft, wel. De server ziet welke catalogus een
account heeft en welke titels een apparaat opent, maar **niet** wat er bekeken wordt: video gaat
rechtstreeks van de provider naar het apparaat. Het apparaat krijgt de stream-urls (met de
inloggegevens) alleen in het geheugen; de antwoorden zijn `no-store`.

**Wat de server niet ziet:** het accountwachtwoord en de E2E-sleutel. De client stuurt alleen
`authKey` (HKDF uit de PBKDF2-hoofdsleutel); de server bewaart `scrypt(authKey)`. Profielen,
favorieten, voortgang en geschiedenis blijven end-to-end versleuteld in `/v1/docs`. Bij de
tv-login reist de hoofdsleutel alleen ECDH-versleuteld naar de publieke sleutel van de tv.

**Inloggen:** generieke foutmelding, nep-salt voor onbekende e-mailadressen (geen
account-enumeratie), scrypt ook voor onbekende adressen (gelijke tijd), lockout na 10 mislukte
pogingen per e-mailadres (15 min) en rate-limits per IP. Aanmelden alleen met `SIGNUP_CODE` of een eenmalige uitnodigingscode (alleen de SHA-256-hash wordt bewaard; de code wordt in dezelfde transactie als het account als gebruikt gemarkeerd, dus twee gelijktijdige aanmeldingen met één code leveren precies één account op).

**Apparaten:** API-tokens (`pst_`) alleen in de `Authorization`-header en als SHA-256-hash
opgeslagen. Een apparaat afmelden trekt zijn token direct in.

**Geen urls in logs:** het toegangslog schrijft alleen methode, pad (zonder query; de
detail-route als `/v1/catalog/titles/:id`, zonder proxy-tokens), status en duur. Fout- en
waarschuwingsregels gaan door `scrubUrls`: elke url wordt `<url>`, ook bij fouten. Foutmeldingen
van bronnen in API-antwoorden gaan door `redactUrl`/`redactText` (user/pass in paden, query's en
userinfo worden `***`). Afbeeldingsurls waarin een wachtwoord zit, worden weggelaten.

**SSRF:** bron-urls zijn bewust externe servers, maar privé-, loopback-, link-local- (cloud
metadata) en gereserveerde adressen worden geweigerd, bij elke redirect opnieuw en via de
DNS-lookup van de verbinding zelf (geen DNS-rebinding). `PROXY_ALLOW_PRIVATE` zet dit uit
(alleen voor tests).

**Overig:** body-limit, rate-limits (API per IP, proxy per apparaat, bron-tests per
account), `Cache-Control` op alles, `X-Content-Type-Options: nosniff`,
`Referrer-Policy: no-referrer`. Draait als non-root.

## Deployen (Docker)

Build-context is de **repo-root** (de gedeelde kern wordt in de image gebundeld):

```bash
docker build -f server/Dockerfile -t prismastream-server .
```

Voorbeeld (Compose, achter Nginx Proxy Manager op het netwerk `proxy`):

```yaml
services:
  backend:
    image: prismastream-server
    restart: unless-stopped
    mem_limit: 768m
    environment:
      NODE_ENV: production
      PUBLIC_URL: https://backend.prismastream.patrickudo.nl
      CORS_ORIGINS: https://prismastream.patrickudo.nl
      TRUST_PROXY: "true"
      DEMO_SOURCE: "false"
      SIGNUP_CODE: ${SIGNUP_CODE}
      SERVER_KEY_FILE: /run/secrets/server_key
      # TMDB_API_KEY: ${TMDB_API_KEY}
    secrets: [server_key]
    volumes: [backend-data:/data]
    networks: [proxy]
secrets:
  server_key:
    file: ./server_key.txt     # openssl rand -base64 32 > server_key.txt; chmod 600
volumes:
  backend-data:
networks:
  proxy:
    external: true
```

In Nginx Proxy Manager: proxy host `backend.prismastream.patrickudo.nl` → `backend:8787`,
SSL aan, en bij *Advanced* `proxy_read_timeout 120s;` (long-poll). Er lopen geen videostreams
via de backend. De image zet `NODE_OPTIONS=--max-old-space-size=512`, start met `--expose-gc` en heeft een healthcheck.

## Beheer (CLI): uitnodigingen en accounts

De CLI werkt rechtstreeks op de databases in `DATA_DIR` (geen HTTP), ook terwijl de server draait.
Lokaal: `node src/cli.ts …` in `server/`. In de container:

```bash
# Eenmalige uitnodigingscode maken (standaard 30 dagen geldig; --days 0 = verloopt nooit).
# De code (XXXXX-XXXXX) wordt één keer getoond; geef hem door aan de genodigde.
docker exec prismastream-backend node src/cli.ts invite create --note "Jan"
docker exec prismastream-backend node src/cli.ts invite create --days 7 --note "Familie"

# Overzicht (zonder de codes zelf): id, status (open, gebruikt, verlopen, ingetrokken),
# notitie, aangemaakt, verloopt, gebruikt op en door welk e-mailadres.
docker exec prismastream-backend node src/cli.ts invite list

# Een ongebruikte code intrekken (id uit de lijst).
docker exec prismastream-backend node src/cli.ts invite revoke inv_XXXXXXXX

# Accounts: e-mail, aangemaakt, aantal apparaten, laatste activiteit.
docker exec prismastream-backend node src/cli.ts accounts list

# Account verwijderen, met apparaten, gesynchroniseerde data, bronnen en catalogus.
# Zonder --yes toont hij alleen wat er zou gebeuren.
docker exec prismastream-backend node src/cli.ts accounts delete jan@example.com --yes
```

Codes zijn 10 tekens Crockford-base32 (zonder I, L, O en U). Hoofdletters, spaties en streepjes
maken niet uit, en I/L en O worden als 1 en 0 gelezen. De hoofdcode `SIGNUP_CODE` blijft
onbeperkt bruikbaar. De rate-limit op aanmelden (10 per uur per IP) geldt voor beide.

## Back-up

- **Belangrijk:** `/data/prismastream-sync.db` (accounts, apparaten, E2E-docs, bronnen met
  versleutelde wachtwoorden) **en de `SERVER_KEY`**. Zonder de sleutel zijn de opgeslagen
  IPTV-wachtwoorden niet meer te ontsleutelen (de gebruiker moet ze dan opnieuw invoeren). Bewaar
  de sleutel apart van de back-up van de data.
- **Niet nodig:** `/data/catalog.db` en `/data/cache/` (worden opnieuw opgebouwd).
- Consistente kopie terwijl de server draait:
  `docker compose exec backend node -e "new (require('node:sqlite').DatabaseSync)('/data/prismastream-sync.db').exec(\"VACUUM INTO '/data/backup.db'\")"`
  en kopieer daarna `/data/backup.db`.

## Testen

`npm test` draait alles tegen in-memory sync-databases, een tijdelijke `DATA_DIR` en een lokale
nep-IPTV-server (`test/mock-iptv.ts`: Xtream, M3U, XMLTV, HLS, VOD met Range). Alleen de tests
zetten `PROXY_ALLOW_PRIVATE`. Gedekt: accounts, zero-knowledge-login (nep-salt, generieke
fouten, lockout), wachtwoord wijzigen, tv-login met echte ECDH (WebCrypto), bronnen-CRUD met
versleuteling (geen wachtwoord in database, caches of antwoorden), foutcodes van bronnen,
Xtream- en M3U-fetch, catalogus-build, paginering, filters en cursors, kindermodus, zoeken,
aanbevelingen, EPG-venster en now/next, ETag/304, directe stream-urls (`no-store`, geen ETag,
alleen voor het eigen account), geen play- of proxy-routes standaard (404), geen urls in de logs,
uitnodigingscodes en de CLI, aanmelden met code, de bestaande sync- en proxytests (met
`proxyEnabled`), en het geheugen bij 50.000 items.
