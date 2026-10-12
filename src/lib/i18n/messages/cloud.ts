// PrismaStream Cloud: remote catalog, account (e-mail + password), tv login, cloud sources,
// storage. Owned by Agent M.
export default {
	nl: {
		'common.details': 'Details',
		'cloud.error.timeout': 'PrismaStream Cloud reageert niet op tijd. Probeer het zo opnieuw.',
		'cloud.error.internal': 'Er ging iets mis op dit apparaat. Probeer het opnieuw.',
		'cloud.error.storage':
			'De opslag van deze browser reageert niet. Sluit andere PrismaStream-tabbladen en probeer het opnieuw.',
		'player.app.title': 'Deze stream speel je af in de PrismaStream-app',
		'player.app.bodyMixed':
			'Je IPTV-provider levert deze stream via http. Browsers spelen dat op een beveiligde pagina niet af. In de app voor iPhone, iPad, Android of Apple TV werkt hij wel, rechtstreeks bij je provider.',
		'player.app.bodyError':
			'Deze stream laat zich niet in de browser afspelen (de provider blokkeert het of de verbinding mislukt). In de app voor iPhone, iPad, Android of Apple TV speelt hij rechtstreeks bij je provider.',
		'player.app.ios': 'App voor iPhone en iPad',
		'player.app.android': 'App voor Android',
		'player.app.appletv': 'App voor Apple TV',
		'player.app.vlc': 'Open in VLC',
		'player.app.detailAll': 'Deze titel speel je af in de PrismaStream-app (de streams zijn http).',
		'player.app.detailSome':
			'Sommige versies speel je alleen in de PrismaStream-app af (http-streams).',
		'welcome.eyebrow': 'PrismaStream',
		'welcome.title': 'Al je tv op één plek',
		'welcome.lead':
			'Films, series en live tv van al je IPTV-bronnen, samengevoegd en in jouw taal. Log in om te beginnen.',
		'welcome.point.merge': 'Eén titel per film of serie, in elke taal en kwaliteit',
		'welcome.point.devices': 'Verder kijken op je telefoon, tablet, computer en tv',
		'welcome.point.private': 'Je profielen en voortgang zijn end-to-end versleuteld',
		'welcome.expired': 'Je sessie is verlopen of dit apparaat is afgemeld. Log opnieuw in.',
		'welcome.loggedOut': 'Je bent uitgelogd.',
		'welcome.finishing': 'Je gegevens worden opgehaald…',
		'cloud.name': 'PrismaStream Cloud',
		'cloud.login': 'Inloggen',

		'cloud.banner.title': 'Verbind met PrismaStream Cloud',
		'cloud.banner.body':
			'Log in en je bibliotheek, voortgang en profielen staan op al je apparaten. Dit apparaat bewaart dan bijna niets.',
		'cloud.banner.action': 'Inloggen of account maken',
		'cloud.banner.dismiss': 'Melding sluiten',

		'cloud.offline.title': 'Geen verbinding.',
		'cloud.offline.body':
			'Je ziet wat er op dit apparaat bewaard is. Afspelen lukt pas weer online.',

		'cloud.empty.title': 'Voeg je IPTV-bron toe',
		'cloud.empty.body':
			'Voeg je Xtream Codes-account of M3U-afspeellijst toe. PrismaStream voegt films, series en zenders van al je bronnen samen.',
		'cloud.empty.add': 'Bron toevoegen',
		'cloud.building.title': 'Je bibliotheek wordt opgebouwd',
		'cloud.building.body':
			'De server haalt je bronnen op en voegt ze samen. Dit duurt meestal minder dan een minuut.',

		'cloud.error.offline':
			'Kan PrismaStream Cloud niet bereiken. Controleer je internetverbinding.',
		'cloud.error.unauthorized': 'Dit apparaat is afgemeld. Log opnieuw in.',
		'cloud.error.rateLimited': 'Te veel verzoeken. Probeer het over een minuut opnieuw.',
		'cloud.error.server': 'Er ging iets mis op de server. Probeer het later opnieuw.',
		'cloud.error.request': 'Het verzoek werd geweigerd.',
		'cloud.error.unknown': 'Er ging iets mis.',

		'cloud.build.building': 'Catalogus wordt opgebouwd…',
		'cloud.build.ready': 'Catalogus klaar: {movies} films · {series} series · {channels} zenders',
		'cloud.build.error': 'De catalogus kon niet worden opgebouwd.',
		'cloud.build.empty': 'Nog geen bronnen. Voeg er een toe om te beginnen.',

		'cloud.sources.subtitle':
			'Je bronnen staan in PrismaStream Cloud. De server haalt ze op, voegt ze samen en houdt ze actueel.',
		'cloud.sources.privacy':
			'Je inloggegevens gaan versleuteld (TLS) naar de server en worden daar versleuteld bewaard. Op dit apparaat worden ze niet opgeslagen.',
		'cloud.sources.emptyBody': 'Kies het type van je IPTV-abonnement.',
		'cloud.sources.loginTitle': 'Log in om bronnen toe te voegen',
		'cloud.sources.loginBody':
			'In de browser beheert PrismaStream Cloud je bronnen, zodat ook http-servers werken. Log in of maak een account met je uitnodigingscode.',

		'cloud.source.state.on': 'Actief',
		'cloud.source.state.off': 'Uit',
		'cloud.source.state.error': 'Probleem',
		'cloud.source.enable': 'Aanzetten',
		'cloud.source.disable': 'Uitzetten',
		'cloud.source.refresh': 'Nu vernieuwen',
		'cloud.source.edit': 'Wijzigen',
		'cloud.source.remove': 'Verwijderen',
		'cloud.source.removeBody':
			'“{name}” en alles wat de server ervan bewaart (ook het wachtwoord) worden verwijderd.',
		'cloud.source.expires': 'Abonnement geldig tot {date}',
		'cloud.source.synced': 'Bijgewerkt op {date}',
		'cloud.source.test': 'Verbinding testen',
		'cloud.source.testing': 'Testen…',
		'cloud.source.saving': 'Opslaan…',
		'cloud.source.form.type': 'Soort bron',
		'cloud.source.form.name': 'Naam (optioneel)',
		'cloud.source.form.server': 'Server-url',
		'cloud.source.form.username': 'Gebruikersnaam',
		'cloud.source.form.password': 'Wachtwoord',
		'cloud.source.form.passwordKeep': 'Leeg laten om het huidige te houden',
		'cloud.source.form.playlist': 'Afspeellijst-url (M3U)',
		'cloud.source.form.playlistKeep': 'Leeg laten om de huidige te houden',
		'cloud.source.form.epg': 'Gids-url (XMLTV, optioneel)',
		'cloud.source.form.needUser': 'Vul je gebruikersnaam in.',
		'cloud.source.form.needPassword': 'Vul je wachtwoord in.',

		'cloud.source.error.auth': 'Gebruikersnaam of wachtwoord onjuist.',
		'cloud.source.error.expired': 'Dit IPTV-account is verlopen of geblokkeerd.',
		'cloud.source.error.expiredOn': 'Account verlopen op {date}.',
		'cloud.source.error.unreachable':
			'Kan de IPTV-server niet bereiken. Controleer het adres (inclusief poort).',
		'cloud.source.error.timeout':
			'De IPTV-server reageert niet op tijd. Probeer het later opnieuw.',
		'cloud.source.error.tls': 'Beveiligde verbinding mislukt (certificaat van de IPTV-server).',
		'cloud.source.error.invalid':
			'De server gaf een onverwacht antwoord. Klopt het adres en is het een Xtream- of M3U-bron?',
		'cloud.source.error.notFound': 'Afspeellijst of server-pagina niet gevonden (404).',
		'cloud.source.error.empty': 'De bron is leeg: geen films, series of zenders gevonden.',
		'cloud.source.error.tooLarge': 'De afspeellijst is te groot.',
		'cloud.source.error.blocked': 'Dit adres is niet toegestaan (lokaal of privé-netwerk).',
		'cloud.source.error.url': 'Vul een geldige url in die begint met http:// of https://.',
		'cloud.source.error.connections':
			'Het maximale aantal verbindingen van dit account is bereikt.',
		'cloud.source.error.limit': 'Je hebt het maximale aantal bronnen bereikt.',
		'cloud.source.error.http': 'De IPTV-server gaf een fout (HTTP {status}).',
		'cloud.source.error.generic': 'Verbinding mislukt.',
		'cloud.source.error.secret':
			'De opgeslagen inloggegevens konden niet worden gelezen. Wijzig de bron en vul het wachtwoord opnieuw in.',

		'cloud.move.title': 'Verplaats naar PrismaStream Cloud',
		'cloud.move.body':
			'Er staan nog {n} bronnen op dit apparaat. Verplaats ze naar de cloud: dan werken ze op al je apparaten en verdwijnen de wachtwoorden van dit apparaat.',
		'cloud.move.action': 'Verplaatsen',
		'cloud.move.confirm': 'Ja, verplaats en verwijder hier',
		'cloud.move.busy': 'Verplaatsen…',
		'cloud.move.later': 'Niet nu',
		'cloud.move.result': '{n} verplaatst.',
		'cloud.move.failed': ' Niet gelukt: {names}.',

		'cloud.settings.pitch': 'Eén account voor al je apparaten.',
		'cloud.settings.account': 'Account en synchronisatie',
		'cloud.settings.notConnected': 'Niet ingelogd',
		'cloud.settings.remote': 'catalogus in de cloud',
		'cloud.settings.sourcesRemote': 'Beheerd in PrismaStream Cloud',
		'cloud.settings.metadataRemote':
			'De server vult titels aan met posters en beschrijvingen. Je kunt de catalogus hier opnieuw laten opbouwen.',

		'cloud.storage.title': 'Opslag',
		'cloud.storage.bodyRemote':
			'Dit apparaat bewaart alleen een kleine cache (recent bekeken titels en het startscherm).',
		'cloud.storage.bodyLocal':
			'In lokale modus bewaart dit apparaat de catalogi en gidsen van je bronnen.',
		'cloud.storage.used': 'Gebruikt door PrismaStream',
		'cloud.storage.cache': 'Cache',
		'cloud.storage.cacheItems': '{n} items · {size}',
		'cloud.storage.clear': 'Lokale cache wissen',
		'cloud.storage.clearing': 'Wissen…',
		'cloud.storage.cleared': 'Cache gewist',

		'account.eyebrow': 'PrismaStream Cloud',
		'account.title': 'Account',
		'account.lead':
			'Log in met je e-mailadres en wachtwoord. Je profielen, lijst en voortgang staan dan op al je apparaten, end-to-end versleuteld.',
		'account.leadIn': 'Je bent ingelogd. Alles synchroniseert automatisch.',
		'account.tab.login': 'Inloggen',
		'account.tab.register': 'Account aanmaken',
		'account.tab.tv': 'Met code (tv)',
		'account.email': 'E-mailadres',
		'account.password': 'Wachtwoord',
		'account.passwordConfirm': 'Herhaal het wachtwoord',
		'account.password.rule': 'minstens 10 tekens',
		'account.password.tooWeak': 'Kies een sterker wachtwoord (minstens 10 tekens).',
		'account.password.mismatch': 'De wachtwoorden zijn niet gelijk.',
		'account.password.e2e':
			'Je wachtwoord verlaat dit apparaat niet: de server krijgt alleen een afgeleide sleutel. Kwijt is kwijt: zonder wachtwoord zijn je versleutelde gegevens niet terug te halen.',
		'account.signupCode': 'Uitnodigingscode',
		'account.signupCode.hint': 'Nieuwe accounts kunnen alleen met een uitnodigingscode.',
		'account.signupCode.required': 'Vul je uitnodigingscode in.',
		'account.loginAction': 'Inloggen',
		'account.loggingIn': 'Inloggen…',
		'account.registerAction': 'Account aanmaken',
		'account.creating': 'Account aanmaken…',
		'account.noServer': 'Er is geen server ingesteld. Vul hem in onder Geavanceerd.',
		'account.status': 'Status',
		'account.legacy': 'Ouder account (wachtwoordzin)',
		'account.done.login': 'Ingelogd. Je gegevens worden gesynchroniseerd.',
		'account.done.register': 'Account aangemaakt. Synchroniseren is gestart.',
		'account.done.unlocked': 'Ontgrendeld.',
		'account.done.passwordChanged': 'Wachtwoord gewijzigd.',
		'account.done.logout': 'Uitgelogd op dit apparaat.',
		'account.unlock.title': 'Voer je wachtwoord opnieuw in',
		'account.unlock.body':
			'Je wachtwoord is op een ander apparaat gewijzigd, of dit apparaat heeft de sleutel niet meer.',
		'account.loggedOut.title': 'Dit apparaat is afgemeld',
		'account.loggedOut.body': 'Log opnieuw in om verder te synchroniseren.',
		'account.loggedOut.action': 'Opnieuw inloggen',
		'account.change.title': 'Wachtwoord wijzigen',
		'account.change.open': 'Wijzigen',
		'account.change.old': 'Huidig wachtwoord',
		'account.change.new': 'Nieuw wachtwoord',
		'account.change.hint':
			'Je gegevens worden opnieuw versleuteld. Andere apparaten vragen daarna om het nieuwe wachtwoord.',
		'account.change.action': 'Wachtwoord wijzigen',
		'account.change.busy': 'Opnieuw versleutelen…',
		'account.logout.title': 'Uitloggen',
		'account.logout.body':
			'Profielen en instellingen blijven op dit apparaat staan; synchroniseren stopt.',
		'account.logout.action': 'Uitloggen',
		'account.logout.confirm': 'Ja, uitloggen',
		'account.what.sources': 'IPTV-bronnen (op de server, niet op je apparaten)',
		'account.e2e':
			'Profielen, favorieten en voortgang zijn end-to-end versleuteld: de server kan ze niet lezen.',
		'account.advanced.title': 'Geavanceerd',
		'account.advanced.server': 'Server',
		'account.advanced.hint': 'Leeg laten voor de standaardserver.',
		'account.advanced.locked': 'Log eerst uit om een andere server te kiezen.',

		'account.tv.title': 'Inloggen met een code',
		'account.tv.qr': 'QR-code om dit apparaat te koppelen',
		'account.tv.step1': 'Pak je telefoon of computer waarop je bent ingelogd.',
		'account.tv.step2': 'Scan de QR-code of ga naar',
		'account.tv.step3': 'en voer deze code in:',
		'account.tv.waiting': 'Wachten op goedkeuring',
		'account.tv.newCode': 'Nieuwe code',
		'account.tv.link': 'Tv koppelen',

		'account.activate.title': 'Tv koppelen',
		'account.activate.lead': 'Voer de code in die op je tv (of ander apparaat) staat.',
		'account.activate.code': 'Code',
		'account.activate.next': 'Verder',
		'account.activate.invalid': 'Een code heeft 8 tekens, bijvoorbeeld ABCD-1234.',
		'account.activate.notFound':
			'Deze code is onbekend of verlopen. Vraag een nieuwe code op de tv.',
		'account.activate.confirmTitle': 'Dit apparaat wil inloggen',
		'account.activate.confirmBody':
			'Keur alleen goed als je dit apparaat zelf voor je hebt. Het krijgt toegang tot je account en je versleutelde gegevens.',
		'account.activate.passwordHint': 'Ter bevestiging: je wachtwoord blijft op dit apparaat.',
		'account.activate.approve': 'Goedkeuren',
		'account.activate.busy': 'Goedkeuren…',
		'account.activate.done': '{name} is gekoppeld.',
		'account.activate.loginFirst':
			'Log eerst in met je PrismaStream-account. Daarna keur je de tv goed.',
		'account.activate.toApp': 'Naar PrismaStream',
		'account.activate.legacy':
			'Tv koppelen kan met een account met e-mail en wachtwoord. Log uit en log in met je e-mailadres.',

		'sync.error.invalidSignupCode': 'Uitnodigingscode ongeldig of al gebruikt.',
		'sync.error.invalidLogin': 'E-mail of wachtwoord onjuist.',
		'sync.error.emailTaken': 'Er bestaat al een account met dit e-mailadres. Log in.',
		'sync.error.invalidEmail': 'Vul een geldig e-mailadres in.',
		'sync.error.wrongPassword': 'Dit wachtwoord klopt niet.',
		'sync.error.codeExpired': 'De code is verlopen.',
		'sync.error.denied': 'De koppeling is geweigerd.',
		'sync.error.needPassword': 'Voer je wachtwoord in.'
	},
	en: {
		'common.details': 'Details',
		'cloud.error.timeout': 'PrismaStream Cloud does not respond in time. Try again shortly.',
		'cloud.error.internal': 'Something went wrong on this device. Try again.',
		'cloud.error.storage':
			'The storage of this browser does not respond. Close other PrismaStream tabs and try again.',
		'player.app.title': 'Play this stream in the PrismaStream app',
		'player.app.bodyMixed':
			'Your IPTV provider delivers this stream over http. Browsers do not play that on a secure page. The app for iPhone, iPad, Android or Apple TV plays it, straight from your provider.',
		'player.app.bodyError':
			'This stream cannot play in the browser (the provider blocks it or the connection fails). The app for iPhone, iPad, Android or Apple TV plays it straight from your provider.',
		'player.app.ios': 'App for iPhone and iPad',
		'player.app.android': 'App for Android',
		'player.app.appletv': 'App for Apple TV',
		'player.app.vlc': 'Open in VLC',
		'player.app.detailAll': 'Play this title in the PrismaStream app (the streams are http).',
		'player.app.detailSome': 'Some versions only play in the PrismaStream app (http streams).',
		'welcome.eyebrow': 'PrismaStream',
		'welcome.title': 'All your TV in one place',
		'welcome.lead':
			'Movies, series and live TV from all your IPTV sources, merged and in your language. Log in to get started.',
		'welcome.point.merge': 'One title per movie or series, in every language and quality',
		'welcome.point.devices': 'Keep watching on your phone, tablet, computer and TV',
		'welcome.point.private': 'Your profiles and progress are end-to-end encrypted',
		'welcome.expired': 'Your session expired or this device was signed out. Log in again.',
		'welcome.loggedOut': 'You are logged out.',
		'welcome.finishing': 'Fetching your data…',
		'cloud.name': 'PrismaStream Cloud',
		'cloud.login': 'Log in',

		'cloud.banner.title': 'Connect to PrismaStream Cloud',
		'cloud.banner.body':
			'Log in and your library, progress and profiles are on all your devices. This device then stores almost nothing.',
		'cloud.banner.action': 'Log in or create an account',
		'cloud.banner.dismiss': 'Dismiss',

		'cloud.offline.title': 'No connection.',
		'cloud.offline.body':
			'You see what is stored on this device. Playback works again once online.',

		'cloud.empty.title': 'Add your IPTV source',
		'cloud.empty.body':
			'Add your Xtream Codes account or M3U playlist. PrismaStream merges movies, series and channels from all your sources.',
		'cloud.empty.add': 'Add source',
		'cloud.building.title': 'Your library is being built',
		'cloud.building.body':
			'The server fetches and merges your sources. This usually takes less than a minute.',

		'cloud.error.offline': 'Cannot reach PrismaStream Cloud. Check your internet connection.',
		'cloud.error.unauthorized': 'This device was signed out. Log in again.',
		'cloud.error.rateLimited': 'Too many requests. Try again in a minute.',
		'cloud.error.server': 'Something went wrong on the server. Try again later.',
		'cloud.error.request': 'The request was refused.',
		'cloud.error.unknown': 'Something went wrong.',

		'cloud.build.building': 'Building the catalog…',
		'cloud.build.ready': 'Catalog ready: {movies} movies · {series} series · {channels} channels',
		'cloud.build.error': 'The catalog could not be built.',
		'cloud.build.empty': 'No sources yet. Add one to get started.',

		'cloud.sources.subtitle':
			'Your sources live in PrismaStream Cloud. The server fetches, merges and refreshes them.',
		'cloud.sources.privacy':
			'Your login details travel encrypted (TLS) to the server and are stored encrypted there. They are not stored on this device.',
		'cloud.sources.emptyBody': 'Choose the type of your IPTV subscription.',
		'cloud.sources.loginTitle': 'Log in to add sources',
		'cloud.sources.loginBody':
			'In the browser, PrismaStream Cloud manages your sources, so http servers work too. Log in or create an account with your invitation code.',

		'cloud.source.state.on': 'Active',
		'cloud.source.state.off': 'Off',
		'cloud.source.state.error': 'Problem',
		'cloud.source.enable': 'Turn on',
		'cloud.source.disable': 'Turn off',
		'cloud.source.refresh': 'Refresh now',
		'cloud.source.edit': 'Edit',
		'cloud.source.remove': 'Remove',
		'cloud.source.removeBody':
			'“{name}” and everything the server keeps for it (including the password) will be removed.',
		'cloud.source.expires': 'Subscription valid until {date}',
		'cloud.source.synced': 'Updated {date}',
		'cloud.source.test': 'Test connection',
		'cloud.source.testing': 'Testing…',
		'cloud.source.saving': 'Saving…',
		'cloud.source.form.type': 'Source type',
		'cloud.source.form.name': 'Name (optional)',
		'cloud.source.form.server': 'Server url',
		'cloud.source.form.username': 'Username',
		'cloud.source.form.password': 'Password',
		'cloud.source.form.passwordKeep': 'Leave empty to keep the current one',
		'cloud.source.form.playlist': 'Playlist url (M3U)',
		'cloud.source.form.playlistKeep': 'Leave empty to keep the current one',
		'cloud.source.form.epg': 'Guide url (XMLTV, optional)',
		'cloud.source.form.needUser': 'Enter your username.',
		'cloud.source.form.needPassword': 'Enter your password.',

		'cloud.source.error.auth': 'Wrong username or password.',
		'cloud.source.error.expired': 'This IPTV account has expired or is blocked.',
		'cloud.source.error.expiredOn': 'Account expired on {date}.',
		'cloud.source.error.unreachable':
			'Cannot reach the IPTV server. Check the address (including the port).',
		'cloud.source.error.timeout': 'The IPTV server does not respond in time. Try again later.',
		'cloud.source.error.tls': 'Secure connection failed (certificate of the IPTV server).',
		'cloud.source.error.invalid':
			'The server sent an unexpected answer. Is the address right, and is it an Xtream or M3U source?',
		'cloud.source.error.notFound': 'Playlist or server page not found (404).',
		'cloud.source.error.empty': 'The source is empty: no movies, series or channels found.',
		'cloud.source.error.tooLarge': 'The playlist is too large.',
		'cloud.source.error.blocked': 'This address is not allowed (local or private network).',
		'cloud.source.error.url': 'Enter a valid url starting with http:// or https://.',
		'cloud.source.error.connections': 'This account reached its maximum number of connections.',
		'cloud.source.error.limit': 'You reached the maximum number of sources.',
		'cloud.source.error.http': 'The IPTV server returned an error (HTTP {status}).',
		'cloud.source.error.generic': 'Connection failed.',
		'cloud.source.error.secret':
			'The stored login details could not be read. Edit the source and enter the password again.',

		'cloud.move.title': 'Move to PrismaStream Cloud',
		'cloud.move.body':
			'{n} sources are still stored on this device. Move them to the cloud: they then work on all your devices and the passwords leave this device.',
		'cloud.move.action': 'Move',
		'cloud.move.confirm': 'Yes, move and remove here',
		'cloud.move.busy': 'Moving…',
		'cloud.move.later': 'Not now',
		'cloud.move.result': '{n} moved.',
		'cloud.move.failed': ' Failed: {names}.',

		'cloud.settings.pitch': 'One account for all your devices.',
		'cloud.settings.account': 'Account and sync',
		'cloud.settings.notConnected': 'Not logged in',
		'cloud.settings.remote': 'catalog in the cloud',
		'cloud.settings.sourcesRemote': 'Managed in PrismaStream Cloud',
		'cloud.settings.metadataRemote':
			'The server adds posters and descriptions. You can have the catalog rebuilt here.',

		'cloud.storage.title': 'Storage',
		'cloud.storage.bodyRemote':
			'This device only keeps a small cache (recently viewed titles and the home screen).',
		'cloud.storage.bodyLocal':
			'In local mode this device stores the catalogs and guides of your sources.',
		'cloud.storage.used': 'Used by PrismaStream',
		'cloud.storage.cache': 'Cache',
		'cloud.storage.cacheItems': '{n} items · {size}',
		'cloud.storage.clear': 'Clear local cache',
		'cloud.storage.clearing': 'Clearing…',
		'cloud.storage.cleared': 'Cache cleared',

		'account.eyebrow': 'PrismaStream Cloud',
		'account.title': 'Account',
		'account.lead':
			'Log in with your e-mail address and password. Your profiles, list and progress are then on all your devices, end-to-end encrypted.',
		'account.leadIn': 'You are logged in. Everything syncs automatically.',
		'account.tab.login': 'Log in',
		'account.tab.register': 'Create account',
		'account.tab.tv': 'With a code (TV)',
		'account.email': 'E-mail address',
		'account.password': 'Password',
		'account.passwordConfirm': 'Repeat the password',
		'account.password.rule': 'at least 10 characters',
		'account.password.tooWeak': 'Choose a stronger password (at least 10 characters).',
		'account.password.mismatch': 'The passwords do not match.',
		'account.password.e2e':
			'Your password never leaves this device: the server only receives a derived key. Lost is lost: without the password your encrypted data cannot be recovered.',
		'account.signupCode': 'Invitation code',
		'account.signupCode.hint': 'New accounts need an invitation code.',
		'account.signupCode.required': 'Enter your invitation code.',
		'account.loginAction': 'Log in',
		'account.loggingIn': 'Logging in…',
		'account.registerAction': 'Create account',
		'account.creating': 'Creating account…',
		'account.noServer': 'No server is set. Enter it under Advanced.',
		'account.status': 'Status',
		'account.legacy': 'Older account (passphrase)',
		'account.done.login': 'Logged in. Your data is being synced.',
		'account.done.register': 'Account created. Sync has started.',
		'account.done.unlocked': 'Unlocked.',
		'account.done.passwordChanged': 'Password changed.',
		'account.done.logout': 'Logged out on this device.',
		'account.unlock.title': 'Enter your password again',
		'account.unlock.body':
			'Your password was changed on another device, or this device no longer has the key.',
		'account.loggedOut.title': 'This device was signed out',
		'account.loggedOut.body': 'Log in again to keep syncing.',
		'account.loggedOut.action': 'Log in again',
		'account.change.title': 'Change password',
		'account.change.open': 'Change',
		'account.change.old': 'Current password',
		'account.change.new': 'New password',
		'account.change.hint':
			'Your data is encrypted again. Other devices will then ask for the new password.',
		'account.change.action': 'Change password',
		'account.change.busy': 'Re-encrypting…',
		'account.logout.title': 'Log out',
		'account.logout.body': 'Profiles and settings stay on this device; syncing stops.',
		'account.logout.action': 'Log out',
		'account.logout.confirm': 'Yes, log out',
		'account.what.sources': 'IPTV sources (on the server, not on your devices)',
		'account.e2e':
			'Profiles, favorites and progress are end-to-end encrypted: the server cannot read them.',
		'account.advanced.title': 'Advanced',
		'account.advanced.server': 'Server',
		'account.advanced.hint': 'Leave empty for the default server.',
		'account.advanced.locked': 'Log out first to choose another server.',

		'account.tv.title': 'Log in with a code',
		'account.tv.qr': 'QR code to link this device',
		'account.tv.step1': 'Take your phone or computer where you are logged in.',
		'account.tv.step2': 'Scan the QR code or go to',
		'account.tv.step3': 'and enter this code:',
		'account.tv.waiting': 'Waiting for approval',
		'account.tv.newCode': 'New code',
		'account.tv.link': 'Link a TV',

		'account.activate.title': 'Link a TV',
		'account.activate.lead': 'Enter the code shown on your TV (or other device).',
		'account.activate.code': 'Code',
		'account.activate.next': 'Next',
		'account.activate.invalid': 'A code has 8 characters, for example ABCD-1234.',
		'account.activate.notFound': 'This code is unknown or expired. Get a new code on the TV.',
		'account.activate.confirmTitle': 'This device wants to log in',
		'account.activate.confirmBody':
			'Only approve when the device is in front of you. It gets access to your account and your encrypted data.',
		'account.activate.passwordHint': 'To confirm: your password stays on this device.',
		'account.activate.approve': 'Approve',
		'account.activate.busy': 'Approving…',
		'account.activate.done': '{name} is linked.',
		'account.activate.loginFirst':
			'Log in with your PrismaStream account first. Then approve the TV.',
		'account.activate.toApp': 'Go to PrismaStream',
		'account.activate.legacy':
			'Linking a TV needs an account with e-mail and password. Log out and log in with your e-mail address.',

		'sync.error.invalidSignupCode': 'Invitation code invalid or already used.',
		'sync.error.invalidLogin': 'Wrong e-mail or password.',
		'sync.error.emailTaken': 'An account with this e-mail address exists. Log in.',
		'sync.error.invalidEmail': 'Enter a valid e-mail address.',
		'sync.error.wrongPassword': 'This password is not correct.',
		'sync.error.codeExpired': 'The code has expired.',
		'sync.error.denied': 'The link was refused.',
		'sync.error.needPassword': 'Enter your password.'
	}
};
