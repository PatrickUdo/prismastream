# PrismaStream sync-server

Kleine, zelf te hosten server die PrismaStream-apparaten met elkaar synchroniseert:
profielen, favorieten, kijkgeschiedenis, afspeelposities, taalvoorkeuren, instellingen en
IPTV-accounts. Alles is **end-to-end versleuteld**: de server bewaart alleen onleesbare blokken.
Daarnaast bevat hij een **CORS-proxy** voor de webversie van de app.

- Node 26 (vanaf Node 23.6 draait TypeScript direct, zonder build-stap of `tsx`)
- HTTP: [Hono](https://hono.dev) met `@hono/node-server`
- Opslag: de ingebouwde `node:sqlite` (één bestand, WAL-modus)

## Installeren en starten

```bash
cd server
npm install
npm run dev      # start met --watch op poort 8787
npm start        # productie: node src/main.ts
npm test         # node:test, ± 40 tests (accounts, koppelen, versies, conflicten, auth, SSRF)
npm run typecheck
```

Controleren of hij draait:

```bash
curl http://localhost:8787/v1/health
# {"ok":true,"service":"prismastream-sync","version":1,"time":...}
```

Vul in de app bij **Instellingen → Synchronisatie** het adres van de server in
(bijvoorbeeld `https://sync.voorbeeld.nl`).

## Configuratie (omgevingsvariabelen)

| Variabele                  | Standaard                      | Betekenis                                                                                    |
| -------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------- |
| `PORT`                     | `8787`                         | Poort                                                                                        |
| `HOST`                     | `0.0.0.0`                      | Luisteradres                                                                                 |
| `DB_PATH`                  | `./data/prismastream-sync.db`  | SQLite-bestand (map wordt aangemaakt)                                                        |
| `CORS_ORIGINS`             | (leeg)                         | Extra toegestane origins, kommagescheiden. Globs zoals `http://localhost:*` mogen; `*` = alle |
| `CORS_REPLACE_DEFAULTS`    | `false`                        | `true`: alleen `CORS_ORIGINS` gebruiken, zonder de standaardlijst hieronder                  |
| `PUBLIC_URL`               | (afgeleid uit het verzoek)     | Publiek adres, bv. `https://sync.voorbeeld.nl`; gebruikt in proxy-urls en HLS-herschrijving   |
| `TRUST_PROXY`              | `false`                        | `X-Forwarded-For/-Proto/-Host` vertrouwen. Alleen aanzetten achter je eigen reverse proxy    |
| `ALLOW_SIGNUP`             | `true`                         | `false`: geen nieuwe sync-accounts (bestaande accounts kunnen nog wel apparaten koppelen)    |
| `PROXY_ENABLED`            | `true`                         | CORS-proxy aan of uit                                                                        |
| `PROXY_ALLOW_PRIVATE`      | `false`                        | **Gevaarlijk.** Laat de proxy ook privé-/loopback-adressen benaderen (alleen gesloten LAN)   |
| `PROXY_MAX_BYTES`          | `104857600` (100 MB)           | Maximale grootte van één proxy-antwoord                                                      |
| `PROXY_TIMEOUT_MS`         | `20000`                        | Time-out voor verbinden en headers (de body mag 2× zo lang stil blijven)                     |
| `BODY_LIMIT_BYTES`         | `2097152` (2 MB)               | Maximale grootte van een request-body                                                        |
| `RATE_LIMIT_PER_MIN`       | `600`                          | API-verzoeken per minuut per IP                                                              |
| `PROXY_RATE_LIMIT_PER_MIN` | `1200`                         | Proxy-verzoeken per minuut per apparaat                                                      |
| `MAX_DOCS_PER_ACCOUNT`     | `1000`                         | Maximaal aantal documenten per account                                                       |
| `MAX_DEVICES_PER_ACCOUNT`  | `20`                           | Maximaal aantal gekoppelde apparaten                                                         |
| `LOG`                      | `true`                         | Toegangslog (methode, pad zonder query en zonder proxy-token, status, duur)                  |

Standaard toegestane origins: `capacitor://localhost`, `ionic://localhost`, `http://localhost`,
`https://localhost` (Capacitor op iOS en Android) en `http://localhost:5173` / `:4173`
(Vite dev en preview). Voeg de origin van je eigen webversie toe via `CORS_ORIGINS`.

## Deployen

### Docker

```bash
cd server
docker build -t prismastream-sync .
docker run -d --name prismastream-sync -p 8787:8787 \
  -v prismastream-sync-data:/data \
  -e PUBLIC_URL=https://sync.voorbeeld.nl \
  -e CORS_ORIGINS=https://app.voorbeeld.nl \
  -e TRUST_PROXY=true \
  prismastream-sync
```

De database staat in het volume `/data`. Maak er regelmatig een back-up van (de inhoud is
versleuteld, maar zonder back-up ben je bij verlies alles kwijt).

### Achter een reverse proxy (aanbevolen)

Zet de server altijd achter **HTTPS** (Caddy, nginx, Traefik). Voorbeeld met Caddy:

```
sync.voorbeeld.nl {
	reverse_proxy 127.0.0.1:8787
}
```

Zet dan `TRUST_PROXY=true` en `PUBLIC_URL=https://sync.voorbeeld.nl`. Long-poll-verzoeken
(`/v1/events`) blijven tot 25 seconden open; de standaard time-outs van Caddy en nginx (60 s)
zijn ruim genoeg. De rate-limits zitten in het geheugen van één proces: draai één instantie,
of voeg ook rate-limiting toe in de reverse proxy.

## Beveiligingsmodel

**Wat de server weet:** per account een id, een willekeurige salt (16 bytes) en de
KDF-parameters; per apparaat een naam, aanmaak- en laatst-gezien-tijd en de SHA-256-hash
van zijn token; per document het id (`profiles`, `settings`, `sources`, `data:<profiel-id>`,
`meta:keycheck`), een versienummer, een volgnummer, een tijdstempel en een versleutelde blob.
Het aantal profielen en de grootte van de documenten zijn dus zichtbaar, de inhoud niet.

**Wat de server niet weet:** de wachtwoordzin, de sleutel, en dus niets van profielen,
favorieten, kijkgedrag, instellingen of IPTV-wachtwoorden.

**Versleuteling (in de app):**

1. Wachtwoordzin → PBKDF2-HMAC-SHA256, 600.000 iteraties (minimaal 310.000, afgedwongen
   door client en server), met de salt van het account → 256-bit hoofdsleutel.
2. HKDF-SHA256 leidt daaruit een AES-256-GCM-sleutel (documenten) en een HMAC-sleutel
   (vingerafdrukken van IPTV-wachtwoorden, om wijzigingen te zien zonder ze op te slaan) af.
   Beide zijn niet-exporteerbare `CryptoKey`s, bewaard in IndexedDB van de app.
3. Elk document: willekeurige 96-bit IV, optioneel gzip vóór versleuteling, en
   _additional authenticated data_ `prismastream-sync:v1:<accountId>:<docId>`. De server kan
   documenten dus niet ongemerkt verwisselen of tussen accounts verplaatsen.
4. Een vast controledocument (`meta:keycheck`) laat een nieuw apparaat controleren of de
   ingevoerde wachtwoordzin klopt.

**Authenticatie:** elk apparaat krijgt een eigen bearer-token (256 bits, prefix `pst_`), alleen
in de `Authorization`-header, nooit in een url. De server bewaart alleen de SHA-256-hash. In de
app staat het token in de secure storage (iOS Keychain / Android Keystore) of, in de browser,
in IndexedDB; nooit in localStorage of logs. Een apparaat ontkoppelen trekt het token direct in.
Na 30 mislukte authenticaties binnen 10 minuten blokkeert de server het IP-adres tijdelijk.

**Koppelen:** een ingelogd apparaat vraagt een koppelcode aan (8 tekens uit een alfabet van 31
tekens zonder verwarrende letters, ±39,6 bits). De code is 10 minuten geldig, eenmalig, wordt
gehasht opgeslagen, en per IP zijn er maximaal 10 koppelpogingen per 10 minuten. Per account
zijn er maximaal 5 actieve codes. De wachtwoordzin vult de gebruiker zelf in; die gaat nooit
over het netwerk.

**Overig:** body-limit (2 MB), rate-limits per IP en per apparaat, nette JSON-fouten zonder
stacktraces, `Cache-Control: no-store` op API-antwoorden, `X-Content-Type-Options: nosniff`,
`Referrer-Policy: no-referrer`. Het verwijderen van het laatste apparaat verwijdert het account
met alle documenten.

**Beperkingen:** wie de wachtwoordzin kwijt is, kan de gesynchroniseerde gegevens niet
herstellen (de gegevens op de apparaten blijven wel bestaan). De wachtwoordzin wijzigen wordt
nog niet ondersteund (sync uitzetten en een nieuw account starten kan wel). De server kan
documenten niet lezen, maar wel weigeren of terugzetten naar een oudere versie die hij eerder
heeft gezien (geen bescherming tegen rollback door een kwaadwillende server).

## CORS-proxy voor de webversie

IPTV-servers sturen zelden CORS-headers, dus de webversie heeft een proxy nodig (op iOS en
Android is die niet nodig). De proxy werkt alleen voor geauthenticeerde apparaten, met een
**apart proxy-token** (prefix `ppx_`) dat uitsluitend voor de proxy geldig is. Dat token staat in
de url (een `<video>`-element kan geen headers meesturen); het API-token komt nooit in een url.

```
POST /v1/proxy-token            (Authorization: Bearer pst_…)
→ { "proxyToken": "ppx_…", "prefix": "https://sync.voorbeeld.nl/v1/proxy/ppx_…?url=" }

GET /v1/proxy/<proxyToken>?url=<encodeURIComponent(doel-url)>
```

De prefix werkt met de prefix-stijl van de bronnenmodule: `${prefix}${encodeURIComponent(url)}`.
In de app levert `getSyncProxyPrefix()` uit `#lib/sync/index.ts` deze prefix (of `null` zonder
sync). Een nieuw proxy-token aanvragen maakt het vorige ongeldig.

- Alleen `GET` en `HEAD`, alleen `http:` en `https:`.
- **SSRF-bescherming:** de hostnaam wordt opgelost en _alle_ adressen worden gecontroleerd;
  loopback, privé-netwerken (10/8, 172.16/12, 192.168/16, fc00::/7), link-local (169.254/16,
  inclusief cloud-metadata), CGNAT, multicast, gereserveerde en documentatiebereiken en
  IPv4-in-IPv6-varianten worden geweigerd (`403 blocked_address`). De controle zit in de
  `lookup` van de verbinding zelf, dus DNS-rebinding tussen controle en verbinden werkt niet.
  Redirects (max. 5) worden handmatig gevolgd en opnieuw gecontroleerd.
- Doorgegeven request-headers: `Range`, `If-Range`, `If-None-Match`, `If-Modified-Since`,
  `Accept`, `User-Agent`. Geen cookies of `Authorization`.
- Antwoorden worden streamend doorgegeven (ook `206 Partial Content` voor seeken), maximaal
  `PROXY_MAX_BYTES`, met time-outs.
- **HLS:** een playlist met `#EXT-X-`-tags wordt herschreven zodat segmenten, sub-playlists en
  sleutels (`URI="…"`) ook via de proxy lopen. Gewone IPTV-zenderlijsten (`#EXTINF` zonder
  `#EXT-X-`) blijven ongewijzigd. Zet `raw=1` vóór `url=` om herschrijven uit te zetten:
  `…/v1/proxy/<token>?raw=1&url=…`.
- Let op: met `ALLOW_SIGNUP=true` kan iedereen die de server kan bereiken een account en dus
  een proxy-token aanmaken. Voor een publiek bereikbare server: zet `ALLOW_SIGNUP=false` nadat je
  je account hebt gemaakt, of zet de proxy uit met `PROXY_ENABLED=false`.

## API

Alle antwoorden zijn JSON. Fouten: `{ "error": "<code>", "message": "…" }`.

| Methode en pad              | Auth   | Beschrijving                                                                                                                                                                              |
| --------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /v1/health`            | nee    | `{ ok, service: "prismastream-sync", version }`                                                                                                                                           |
| `POST /v1/accounts`         | nee    | Body `{ deviceName?, kdf? }` → `201 { accountId, deviceId, token, salt, kdf }`                                                                                                             |
| `GET /v1/me`                | ja     | `{ accountId, deviceId, salt, kdf, cursor }`                                                                                                                                               |
| `DELETE /v1/account`        | ja     | Verwijdert account, apparaten en documenten → `204`                                                                                                                                       |
| `POST /v1/pairing-codes`    | ja     | → `201 { code, expiresAt }` (8 tekens, 10 min, eenmalig)                                                                                                                                   |
| `POST /v1/devices/pair`     | nee    | Body `{ code, deviceName? }` (hoofdletters/streepjes maken niet uit) → `201 { accountId, deviceId, token, salt, kdf }`; `400 invalid_code`, `409 device_limit`, `429 rate_limited`           |
| `GET /v1/devices`           | ja     | `{ devices: [{ id, name, createdAt, lastSeenAt, current }] }`                                                                                                                             |
| `DELETE /v1/devices/:id`    | ja     | Ontkoppelt een apparaat van hetzelfde account → `{ ok, accountDeleted }` (laatste apparaat ⇒ account weg)                                                                                  |
| `GET /v1/docs?since=&limit=` | ja    | Gewijzigde documenten na cursor `since` (oplopend): `{ docs: [{ docId, version, updatedAt, deleted, blob }], cursor, more }`; `limit` max. 500                                             |
| `GET /v1/docs/:docId`       | ja     | Eén document of `404`                                                                                                                                                                     |
| `PUT /v1/docs/:docId`       | ja     | Header `If-Match: "<versie>"` (`0` = nieuw), body `{ blob }` of `{ deleted: true }` → `{ docId, version, updatedAt, cursor }`; `409 conflict` met `current` (serverversie); `428` zonder If-Match |
| `GET /v1/events?since=&timeout=` | ja | Long-poll (max. 55 s, standaard 25 s): `{ cursor, changed }` zodra er iets na `since` is gewijzigd                                                                                       |
| `POST /v1/proxy-token`      | ja     | Nieuw proxy-token → `201 { proxyToken, prefix }`                                                                                                                                           |
| `GET /v1/proxy/:token?url=` | proxy  | CORS-proxy, zie hierboven                                                                                                                                                                 |

`docId`: `[A-Za-z0-9:_.-]{1,128}`. `blob`: base64. De cursor is een per account oplopend
volgnummer; elke `PUT` verhoogt hem. Versies beginnen bij 1.

## Testen

```bash
npm test
```

De tests draaien tegen een in-memory database en een lokale upstream-server (voor de
proxytests met `proxyAllowPrivate` alleen binnen de test). Ze dekken: accounts en
KDF-validatie, tokens alleen gehasht, auth-fouten en IP-blokkade, body-limit, koppelen
(eenmalig, verlopen, rate-limit), apparaten ontkoppelen, versiebeheer en `409`-conflicten,
paginering, verwijdermarkeringen, quotum, long-poll, en de proxy (tokens, methodes, schema's,
SSRF-blokkade inclusief DNS, redirects, Range, HLS-herschrijving, maximale grootte).
