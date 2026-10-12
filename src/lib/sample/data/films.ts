// Fictional films. Every title, plot, person and company is invented.
//
// v = availability: "<lang>:<sources>" where sources are A (sample), B (sample-world),
//     C (sample-plus), each optionally followed by a quality: 4 = 4K, F = FHD, H = HD, S = SD.
// x = extra raw entries with a literal provider title: [source, rawTitle, langHint?]
//     (used for the deliberate traps: VOSTFR, NL Subs, MULTI, no year, ±1 year, …).
// noId = the providers know no tmdb id for this film: matching must use titles + years.
import type { LangCode } from '#lib/types.ts';

export interface FilmSeed {
	y: number;
	o: LangCode;
	t: Partial<Record<LangCode, string>>;
	g: string[];
	d: string;
	r: number;
	m: number;
	c: string[];
	a: number;
	p: string;
	v: string;
	x?: [src: 'A' | 'B' | 'C', rawTitle: string, lang?: LangCode][];
	noId?: boolean;
}

export const FILMS: FilmSeed[] = [
	{
		y: 2023,
		o: 'en',
		t: {
			nl: 'Het Laatste Licht',
			en: 'The Last Light',
			de: 'Das Letzte Licht',
			fr: 'La Dernière Lumière',
			es: 'La Última Luz',
			it: "L'Ultima Luce",
			tr: 'Son Işık',
			ar: 'الضوء الأخير',
			pl: 'Ostatnie Światło',
			pt: 'A Última Luz'
		},
		g: ['Sciencefiction', 'Drama'],
		d: 'Imke Brandsma',
		r: 8.1,
		m: 128,
		c: ['Commandant Iris Vos', 'Daan Kepler', 'WACHTER'],
		a: 2,
		p: 'Wanneer de zon van de kolonie Eos onverwacht begint te doven, krijgt commandant Iris Vos twaalf dagen om een uitweg te vinden. Met een haperende scheeps-AI en een bemanning die steeds meer twijfelt, moet ze kiezen tussen haar missie en de mensen die ze liefheeft.',
		v: 'nl:A4C en:A4BF de:BF fr:B es:C it:B tr:C ar:C pl:C pt:C',
		x: [
			['C', 'The Last Light (2023) VOSTFR', 'en'],
			['B', '[EN] The Last Light (2023) NL Subs'],
			['C', 'NL/EN - Het Laatste Licht (2023) MULTI'],
			['C', 'FR: La Derniere Lumiere (2023) HD']
		]
	},
	{
		y: 2021,
		o: 'nl',
		t: { nl: 'Zoutwater', en: 'Saltwater', de: 'Salzwasser' },
		g: ['Drama', 'Thriller'],
		d: 'Joris Ammerlaan',
		r: 7.4,
		m: 112,
		c: ['Femke Dijkhuis', 'Ruben Dijkhuis', 'inspecteur Mol'],
		a: 5,
		p: 'Als de kotter van haar broer Ruben spoorloos verdwijnt voor de Zeeuwse kust, keert Femke na tien jaar terug naar het dorp dat ze ontvluchtte. Terwijl een storm het eiland afsluit, ontdekt ze dat het zwijgen van de dorpelingen dieper gaat dan schaamte.',
		v: 'nl:AF en:B de:B'
	},
	{
		y: 1998,
		o: 'nl',
		t: { nl: 'Nachtwacht', en: 'Night Watch' },
		g: ['Thriller', 'Misdaad'],
		d: 'Hendrik Vermeulen',
		r: 7.0,
		m: 104,
		c: ['Bram Kools', 'Sanne Ritsema', 'Victor Lenz'],
		a: 40,
		p: 'Nachtwaker Bram Kools ziet op een regenachtige nacht in het stadsarchief een inbraak die volgens de politie nooit heeft plaatsgevonden. Samen met journaliste Sanne Ritsema volgt hij een spoor van verdwenen dossiers tot in het stadhuis.',
		v: 'nl:AC en:B',
		noId: true
	},
	{
		y: 2021,
		o: 'nl',
		t: { nl: 'Nachtwacht', en: 'Night Watch', de: 'Nachtwache', fr: 'Veille de Nuit' },
		g: ['Drama', 'Mysterie'],
		d: 'Lotte Zandbergen',
		r: 7.8,
		m: 118,
		c: ['Eva Brink', 'Ward Hoogland', 'Mira'],
		a: 12,
		p: 'Op een afgelegen vuurtoren in de Waddenzee neemt Eva Brink de nachtdienst over van haar overleden vader. Elke nacht vangt de marifoon berichten op van een schip dat al veertig jaar vermist is.',
		v: 'nl:AC en:AB de:C fr:B'
	},
	{
		y: 2014,
		o: 'nl',
		t: { nl: 'Stormvogel', en: 'Stormbird', de: 'Sturmvogel' },
		g: ['Avontuur', 'Familie'],
		d: 'Mees van Dalen',
		r: 6.9,
		m: 97,
		c: ['Jip Wolters', 'opa Kees', 'Storm'],
		a: 55,
		p: 'De elfjarige Jip vindt na een zware storm op Terschelling een gewonde jan-van-gent die ze Storm noemt. Wanneer een projectontwikkelaar het vogelduin wil volbouwen, bedenkt ze samen met haar eigenzinnige opa een plan dat het hele eiland op zijn kop zet.',
		v: 'nl:A en:B de:B'
	},
	{
		y: 2017,
		o: 'nl',
		t: { nl: 'Stormvogel 2', en: 'Stormbird II', de: 'Sturmvogel 2' },
		g: ['Avontuur', 'Familie'],
		d: 'Mees van Dalen',
		r: 6.6,
		m: 94,
		c: ['Jip Wolters', 'opa Kees', 'Storm', 'Ilse Bakker'],
		a: 50,
		p: 'Jip is dertien en Storm is terug, maar dit keer met een hele zwerm vogels die het eiland niet meer kunnen vinden. Een mysterieuze zendmast op de Noordzee lijkt hun kompas te verstoren.',
		v: 'nl:A en:B de:C',
		x: [['C', '|NL| Stormvogel II 2017']],
		noId: true
	},
	{
		y: 2016,
		o: 'nl',
		t: { nl: 'De Grens', en: 'The Border', tr: 'Sınır' },
		g: ['Thriller', 'Drama'],
		d: 'Ayla Demir',
		r: 7.3,
		m: 109,
		c: ['Kemal Arslan', 'Noor Visser', 'Hans de Wit'],
		a: 33,
		p: 'Douanier Kemal Arslan houdt bij de Belgische grens een vrachtwagen aan en vindt een meisje dat geen woord zegt. In één nacht moet hij kiezen tussen de regels die hij twintig jaar heeft gevolgd en het enige juiste dat hij nog kan doen.',
		v: 'nl:AC en:B tr:C'
	},
	{
		y: 2020,
		o: 'nl',
		t: { nl: 'Het Zoutpad', en: 'The Salt Road', fr: 'La Route du Sel' },
		g: ['Avontuur', 'Drama'],
		d: 'Pieter Holleman',
		r: 7.1,
		m: 121,
		c: ['Joost Mertens', 'Amira Haddad', 'Yusuf'],
		a: 20,
		p: 'Een Nederlandse fotograaf en een Marokkaanse gids volgen een eeuwenoude zoutroute dwars door de Sahara. Wat begint als een opdracht voor een reisblad, wordt een tocht die hen allebei dwingt hun verleden onder ogen te zien.',
		v: 'nl:A en:B fr:B',
		x: [['C', 'NL - Het Zoutpad']]
	},
	{
		y: 2019,
		o: 'en',
		t: {
			nl: 'Missie Ares: Rode Planeet',
			en: 'Mission Ares: Red Planet',
			de: 'Mission Ares: Roter Planet',
			es: 'Misión Ares: Planeta Rojo'
		},
		g: ['Sciencefiction', 'Actie'],
		d: 'Carter Lindqvist',
		r: 7.2,
		m: 131,
		c: ['kapitein Lena Okafor', 'Tomasz Wierzbicki', 'ORCA'],
		a: 26,
		p: 'Wanneer de eerste bemande Marsbasis het contact verliest, wordt een reddingsteam onder leiding van kapitein Lena Okafor in allerijl gelanceerd. Op de rode planeet blijkt de stilte geen technisch mankement, maar een bewuste keuze.',
		v: 'nl:A en:A4 de:B es:C',
		x: [['B', '|EN| Mission Ares 2019 FHD']]
	},
	{
		y: 2018,
		o: 'nl',
		t: { nl: 'Lars & Lotte', en: 'Lars & Lotte', de: 'Lars und Lotte' },
		g: ['Komedie', 'Romantiek'],
		d: 'Sophie Kranenburg',
		r: 6.8,
		m: 99,
		c: ['Lars Brouwer', 'Lotte de Haan', 'tante Joke'],
		a: 44,
		p: 'Lars is weddingplanner en gelooft niet in de liefde; Lotte is scheidingsadvocaat en gelooft er juist heilig in. Als ze per ongeluk dezelfde villa in Toscane boeken, staat er een zomer vol misverstanden op het menu.',
		v: 'nl:A en:B de:B',
		x: [['C', 'NL: Lars en Lotte (2018) HD']]
	},
	{
		y: 2015,
		o: 'en',
		t: {
			nl: 'De Glazen Tuin',
			en: 'The Glass Garden',
			fr: 'Le Jardin de Verre',
			it: 'Il Giardino di Vetro'
		},
		g: ['Drama', 'Romantiek'],
		d: 'Eleanor Whitcombe',
		r: 7.6,
		m: 115,
		c: ['Edith Marlow', 'Thomas Avery', 'Lily'],
		a: 58,
		p: 'Een weduwe in het Engeland van 1952 erft een vervallen kas vol zeldzame orchideeën. De jonge botanicus die haar komt helpen, brengt niet alleen de planten weer tot leven.',
		v: 'nl:A en:AB fr:B it:BC',
		x: [['B', 'EN - Glass Garden (2015)']]
	},
	{
		y: 2022,
		o: 'en',
		t: { nl: 'Koraalkoorts', en: 'Coral Fever', es: 'Fiebre de Coral', pt: 'Febre de Coral' },
		g: ['Avontuur', 'Thriller'],
		d: 'Mara Quintero',
		r: 6.7,
		m: 103,
		c: ['Nadia Cole', 'Jonah Reyes', 'kapitein Duarte'],
		a: 9,
		p: 'Twee duikinstructeurs ontdekken bij een afgelegen rif in de Caraïben een wrak vol gesmokkelde kunstschatten. Al snel blijken ze niet de enigen die weten wat er op de bodem ligt.',
		v: 'nl:A es:C pt:C',
		x: [['B', '|EN| Coral Fever 2023']]
	},
	{
		y: 2019,
		o: 'fr',
		t: {
			fr: 'Les Oiseaux de Papier',
			en: 'Paper Birds',
			nl: 'Papieren Vogels',
			de: 'Papiervögel'
		},
		g: ['Drama', 'Familie'],
		d: 'Camille Aubertin',
		r: 7.5,
		m: 106,
		c: ['Henri Delmas', 'Zoé Delmas', 'madame Ferrand'],
		a: 17,
		p: 'Een weduwnaar in Lyon die origamiles geeft, krijgt onverwacht de zorg over zijn kleindochter Zoé. Vouw voor vouw leren ze elkaar kennen, terwijl een oud familiegeheim zich langzaam ontvouwt.',
		v: 'fr:BC nl:A en:B de:C'
	},
	{
		y: 2017,
		o: 'de',
		t: { de: 'Das Uhrwerk', en: 'The Clockwork', nl: 'Het Uurwerk', pl: 'Mechanizm Zegara' },
		g: ['Thriller', 'Mysterie'],
		d: 'Friedrich Albers',
		r: 7.3,
		m: 117,
		c: ['Konrad Weiß', 'Hanna Stein', 'commissaris Brandt'],
		a: 31,
		p: 'Een Berlijnse klokkenmaker ontvangt een eeuwenoud uurwerk dat precies twaalf uur voor een reeks inbraken stilvalt. Rechercheur Hanna Stein vermoedt dat de klokkenmaker meer weet dan hij zegt.',
		v: 'de:B nl:A en:B pl:C'
	},
	{
		y: 2020,
		o: 'es',
		t: {
			es: 'El Jardín de las Lunas',
			en: 'The Garden of Moons',
			nl: 'De Tuin van de Manen',
			pt: 'O Jardim das Luas'
		},
		g: ['Fantasy', 'Drama'],
		d: 'Lucía Ferrer',
		r: 7.9,
		m: 124,
		c: ['Inés Navarro', 'abuela Rosario', 'Mateo'],
		a: 14,
		p: 'In de tuin van haar grootmoeder in Andalusië bloeien bloemen die alleen bij volle maan opengaan. Wanneer Inés ontdekt dat elke bloem een herinnering bewaart, moet ze kiezen welke ze wil vergeten.',
		v: 'es:C en:B nl:A pt:C'
	},
	{
		y: 2016,
		o: 'it',
		t: {
			it: 'La Strada del Ritorno',
			en: 'The Road Back',
			nl: 'De Weg Terug',
			de: 'Der Weg Zurück'
		},
		g: ['Drama', 'Komedie'],
		d: 'Marco Bellandi',
		r: 7.0,
		m: 101,
		c: ['Giorgio Ruffo', 'Luca Ruffo', 'nonna Pia'],
		a: 47,
		p: 'Een vader en zijn volwassen zoon, die al jaren niet meer praten, moeten samen een oude Fiat van Turijn naar Apulië rijden. Onderweg sputtert de motor, en hun zwijgen ook.',
		v: 'it:BC nl:A en:B de:B'
	},
	{
		y: 2021,
		o: 'tr',
		t: {
			tr: 'Yankılar Şehri',
			en: 'City of Echoes',
			nl: "Stad van Echo's",
			ar: 'مدينة الأصداء'
		},
		g: ['Avontuur', 'Mysterie'],
		d: 'Elif Kaya',
		r: 7.2,
		m: 119,
		c: ['Deniz Aydın', 'professor Selim', 'Leyla'],
		a: 22,
		p: 'Een jonge archeologe vindt in Cappadocië een ondergrondse stad waar elk woord drie keer terugkomt, maar steeds een beetje anders. De echo’s lijken haar de weg te wijzen naar iets wat beter verborgen had kunnen blijven.',
		v: 'tr:C ar:C en:B nl:A'
	},
	{
		y: 2018,
		o: 'ar',
		t: {
			ar: 'ظل النخيل',
			en: 'Shadow of the Palms',
			nl: 'Schaduw van de Palmen',
			fr: "L'Ombre des Palmiers"
		},
		g: ['Drama', 'Romantiek'],
		d: 'Karim Mansour',
		r: 7.4,
		m: 112,
		c: ['Salma', 'Youssef', 'hadj Ibrahim'],
		a: 36,
		p: 'In een oase aan de rand van de woestijn wordt Salma uitgehuwelijkt aan de zoon van de rijkste dadelkweker. Op de avond voor de bruiloft keert Youssef, haar jeugdliefde, terug uit Marseille.',
		v: 'ar:C fr:B en:B nl:A'
	},
	{
		y: 2022,
		o: 'pl',
		t: {
			pl: 'Zimowy Pociąg',
			en: 'The Winter Train',
			nl: 'De Wintertrein',
			de: 'Der Winterzug'
		},
		g: ['Drama', 'Geschiedenis'],
		d: 'Agnieszka Wróbel',
		r: 7.7,
		m: 126,
		c: ['Marek Nowicki', 'Ewa Nowicka', 'korporaal Zieliński'],
		a: 19,
		p: 'Polen, december 1981: een trein vol reizigers strandt in de sneeuw wanneer de grenzen plotseling sluiten. In drie dagen worden vreemden bondgenoten, en bondgenoten verraders.',
		v: 'pl:C en:B nl:A de:B'
	},
	{
		y: 2019,
		o: 'pt',
		t: { pt: 'Maré Alta', en: 'High Tide', nl: 'Hoog Water', es: 'Marea Alta' },
		g: ['Thriller', 'Drama'],
		d: 'João Carvalho',
		r: 6.9,
		m: 102,
		c: ['Rita Sousa', 'Tiago Mendes', 'senhor Abreu'],
		a: 28,
		p: 'Een big-wave-surfster in Nazaré ziet tijdens de grootste swell van het jaar iets wat ze niet had mogen zien. Op het land blijkt de stroming nog verraderlijker dan op zee.',
		v: 'pt:C es:C en:B nl:A'
	},
	{
		y: 2024,
		o: 'en',
		t: {
			nl: 'Neon Saints',
			en: 'Neon Saints',
			de: 'Neon Saints',
			es: 'Santos de Neón',
			it: 'Santi al Neon',
			tr: 'Neon Azizler'
		},
		g: ['Actie', 'Misdaad'],
		d: 'Darius Kell',
		r: 7.0,
		m: 116,
		c: ['Vic Moreno', 'rechercheur Ana Ruiz', 'de Bisschop'],
		a: 4,
		p: 'In een stad die nooit slaapt, steelt een groep ex-agenten uitsluitend van criminelen. Wanneer hun nieuwste doelwit een kerk blijkt die drugsgeld witwast, komen ze oog in oog te staan met hun eigen verleden.',
		v: 'nl:A en:A4BF de:B es:C it:C tr:C'
	},
	{
		y: 2025,
		o: 'en',
		t: {
			nl: 'Baan van Stilte',
			en: 'Orbit of Silence',
			de: 'Umlaufbahn der Stille',
			fr: "L'Orbite du Silence",
			pl: 'Orbita Ciszy'
		},
		g: ['Sciencefiction', 'Thriller'],
		d: 'Hiro Tanabe',
		r: 7.8,
		m: 134,
		c: ['astronaut Mae Lindgren', 'dr. Okon', 'CALLA'],
		a: 1,
		p: 'Na een zonnestorm zit astronaut Mae Lindgren alleen in een ruimtestation zonder contact met de aarde. Dan begint de boordcomputer te antwoorden op vragen die ze nog niet heeft gesteld.',
		v: 'nl:A4 en:A4B de:B fr:B pl:C'
	},
	{
		y: 2023,
		o: 'nl',
		t: { nl: 'De Bakkerij van Bas', en: "Bas's Bakery", de: 'Die Bäckerei von Bas' },
		g: ['Komedie', 'Familie'],
		d: 'Ilse Groen',
		r: 6.5,
		m: 95,
		c: ['Bas Verbeek', 'Ans', 'burgemeester Van Dijk'],
		a: 11,
		p: 'Bas erft de noodlijdende bakkerij van zijn tante in een Gelders dorp, maar kan zelf nog geen ei bakken. Met hulp van de strenge Ans en een geheim receptenboek wil hij de dorpsbakwedstrijd winnen.',
		v: 'nl:AC en:B de:B'
	},
	{
		y: 2012,
		o: 'en',
		t: {
			nl: 'Het Holle Koor',
			en: 'The Hollow Choir',
			de: 'Der Hohle Chor',
			es: 'El Coro Hueco',
			tr: 'Boş Koro'
		},
		g: ['Horror', 'Mysterie'],
		d: 'Graham Pell',
		r: 6.4,
		m: 97,
		c: ['pastoor Dunmore', 'Claire Ashby', 'Tobias'],
		a: 39,
		p: 'In een verlaten kerk in Yorkshire zingt elke nacht om drie uur een koor dat niemand kan zien. Muziekdocente Claire Ashby neemt het geluid op, en hoort op de band een stem die haar naam noemt.',
		v: 'en:AB nl:A de:B es:C tr:C'
	},
	{
		y: 2008,
		o: 'en',
		t: {
			nl: 'Pip en de Papieren Maan',
			en: 'Pip and the Paper Moon',
			de: 'Pip und der Papiermond',
			fr: 'Pip et la Lune de Papier',
			es: 'Pip y la Luna de Papel',
			it: 'Pip e la Luna di Carta',
			pt: 'Pip e a Lua de Papel',
			pl: 'Pip i Papierowy Księżyc',
			tr: 'Pip ve Kağıt Ay',
			ar: 'بيب والقمر الورقي'
		},
		g: ['Animatie', 'Familie', 'Avontuur'],
		d: 'Rosalind Fay',
		r: 7.9,
		m: 88,
		c: ['Pip', 'meneer Uil', 'de Maanwachter'],
		a: 6,
		p: 'Als de maan op een nacht van papier blijkt te zijn en scheurt, gaat het muisje Pip met een vlieger op weg om hem te repareren. Samen met de mopperende meneer Uil reist ze langs sterren, wolken en een heel slaperige komeet.',
		v: 'nl:A en:AB de:B fr:B es:C it:C pt:C pl:C tr:C ar:C'
	},
	{
		y: 1987,
		o: 'nl',
		t: { nl: 'Het Verdronken Dorp', en: 'The Drowned Village' },
		g: ['Drama', 'Geschiedenis'],
		d: 'Cor Hoekstra',
		r: 7.5,
		m: 128,
		c: ['Geertje Kloet', 'dominee Ramaker', 'Jan Kloet'],
		a: 59,
		p: 'Februari 1953: in een Zeeuws dorp breekt in de nacht de dijk door. Het aangrijpende verhaal van een familie die in één nacht alles verliest en weer moet leren leven met het water.',
		v: 'nl:A en:B'
	},
	{
		y: 1994,
		o: 'en',
		t: {
			nl: 'Crimson Harbor',
			en: 'Crimson Harbor',
			de: 'Hafen in Rot',
			it: 'Porto Cremisi'
		},
		g: ['Actie', 'Thriller'],
		d: 'Walt Brennan',
		r: 6.8,
		m: 110,
		c: ['Jack Hollis', 'Marla Quinn', 'senator Voss'],
		a: 37,
		p: 'Een havenrechercheur in Baltimore ontdekt dat de containers die hij moet bewaken iets vervoeren wat officieel niet bestaat. Zijn enige bondgenoot is een journaliste die al eens is ontslagen omdat ze te veel wist.',
		v: 'nl:A en:AB de:B it:C'
	},
	{
		y: 2014,
		o: 'fr',
		t: {
			fr: 'Le Grand Déménagement',
			en: 'The Big Move',
			nl: 'De Grote Verhuizing',
			de: 'Der Große Umzug'
		},
		g: ['Komedie'],
		d: 'Bastien Rocher',
		r: 6.6,
		m: 93,
		c: ['Gilles Martin', 'Sophie Martin', 'buurman Paulo'],
		a: 52,
		p: 'Een gezin uit Parijs verhuist naar een dorp in de Provence, met een verhuiswagen die onderweg verdwijnt. Wat volgt is een week vol geleende meubels, nieuwsgierige buren en een geit die niet meer weggaat.',
		v: 'fr:BC nl:A en:B de:C'
	},
	{
		y: 2021,
		o: 'ko',
		t: { ko: '유리 도시', en: 'Glass City', nl: 'Glazen Stad', fr: 'La Cité de Verre' },
		g: ['Thriller', 'Misdaad'],
		d: 'Seo Min-jae',
		r: 7.9,
		m: 125,
		c: ['rechercheur Han', 'Yuna', 'directeur Baek'],
		a: 15,
		p: 'In een futuristische wijk van Seoul, waar alle muren van glas zijn, wordt een moord gepleegd die niemand heeft gezien. Rechercheur Han ontdekt dat transparantie de perfecte schuilplaats is.',
		v: 'ko:B en:B nl:A fr:C'
	},
	{
		y: 2016,
		o: 'en',
		t: {
			nl: 'Rijk van IJs',
			en: 'Kingdom of Ice',
			de: 'Königreich aus Eis',
			fr: 'Royaume de Glace',
			pt: 'Reino de Gelo'
		},
		g: ['Documentaire'],
		d: 'Nora Fieldstone',
		r: 8.3,
		m: 92,
		c: ['Verteller'],
		a: 45,
		p: 'Een jaar lang volgt een cameraploeg het leven op en onder het pakijs van Antarctica. Van keizerspinguïns tot luipaardrobben: een adembenemend portret van een wereld die snel verandert.',
		v: 'nl:A en:AB de:B fr:B pt:C'
	},
	{
		y: 2023,
		o: 'en',
		t: {
			nl: 'De Laatste Imkers',
			en: 'The Last Beekeepers',
			es: 'Los Últimos Apicultores',
			it: 'Gli Ultimi Apicoltori'
		},
		g: ['Documentaire'],
		d: 'Hannah Riis',
		r: 7.9,
		m: 84,
		c: ['Verteller'],
		a: 23,
		p: 'Drie imkers op drie continenten vechten voor het voortbestaan van hun bijenvolken. Een hoopvolle en urgente documentaire over het kleinste werkpaard van onze voedselvoorziening.',
		v: 'nl:A en:B es:C it:C'
	},
	{
		y: 2010,
		o: 'nl',
		t: { nl: 'Zomer in Zeeland', en: 'Summer in Zeeland', de: 'Sommer in Zeeland' },
		g: ['Romantiek', 'Komedie'],
		d: 'Marieke Oosting',
		r: 6.3,
		m: 98,
		c: ['Lisa van Toor', 'Sem Kramer', 'oma Door'],
		a: 57,
		p: 'Een Amsterdamse marketeer moet een zomer lang de camping van haar oma runnen. Tussen de caravans, de mosselfeesten en de koppige strandwacht Sem raakt haar zorgvuldig geplande leven heerlijk in de war.',
		v: 'nl:A en:B de:B'
	},
	{
		y: 2018,
		o: 'en',
		t: {
			nl: 'De Gloeiende Kroon',
			en: 'The Ember Crown',
			de: 'Die Glutkrone',
			fr: 'La Couronne de Braise',
			es: 'La Corona de Brasas',
			pl: 'Żarząca Korona',
			tr: 'Kor Taç'
		},
		g: ['Fantasy', 'Avontuur'],
		d: 'Aldous Wren',
		r: 7.4,
		m: 141,
		c: ['prinses Aveline', 'Corvin de smid', 'koningin Morwen'],
		a: 27,
		p: 'Een prinses die de troon niet wil en een smid die haar wil ontvoeren, moeten samen een kroon terugvinden die het land in vuur zet. Een epische fantasy over macht, lot en de vrijheid om nee te zeggen.',
		v: 'nl:A en:A4B de:B fr:C es:C pl:C tr:C'
	},
	{
		y: 2011,
		o: 'en',
		t: {
			nl: 'Het Negende District',
			en: 'The Ninth Precinct',
			de: 'Das Neunte Revier',
			it: 'Il Nono Distretto'
		},
		g: ['Misdaad', 'Drama'],
		d: 'Ray Calloway',
		r: 7.1,
		m: 118,
		c: ['rechercheur Frank Mulroney', 'Rosa Delgado', 'kapitein Haines'],
		a: 49,
		p: 'Een uitgebluste rechercheur krijgt één week om een reeks overvallen op te lossen voordat zijn bureau wordt gesloten. Zijn nieuwe partner heeft haar eigen redenen om de zaak niet te sluiten.',
		v: 'en:AB nl:A de:B it:C'
	},
	{
		y: 2024,
		o: 'nl',
		t: {
			nl: 'Het Zevende Uur',
			en: 'The Seventh Hour',
			de: 'Die Siebte Stunde',
			fr: 'La Septième Heure',
			tr: 'Yedinci Saat'
		},
		g: ['Thriller', 'Misdaad'],
		d: 'Daan Roozendaal',
		r: 7.6,
		m: 108,
		c: ['officier Lieke Brandt', 'Tarik El Amrani', 'de notaris'],
		a: 3,
		p: 'Om zeven uur ’s ochtends wordt een notaris dood aangetroffen in zijn Utrechtse kantoor, met zeven testamenten op zijn bureau. Officier van justitie Lieke Brandt heeft zeven uur voordat de erfgenamen het land uit zijn.',
		v: 'nl:A4C en:B de:B fr:C tr:C'
	},
	{
		y: 2015,
		o: 'es',
		t: {
			es: 'Mi Tío el Astronauta',
			en: 'My Uncle the Astronaut',
			nl: 'Mijn Oom de Astronaut',
			pt: 'Meu Tio, o Astronauta',
			it: 'Mio Zio Astronauta'
		},
		g: ['Komedie', 'Familie'],
		d: 'Pablo Ortega',
		r: 6.9,
		m: 96,
		c: ['tío Ramón', 'Nico', 'doña Carmen'],
		a: 41,
		p: 'De tienjarige Nico vertelt op school dat zijn oom astronaut is. Dat klopt niet helemaal: oom Ramón is conciërge bij het ruimtevaartcentrum. Maar dan staat er een schoolbezoek op het programma.',
		v: 'es:C en:B nl:A pt:C it:B'
	},
	{
		y: 2020,
		o: 'en',
		t: {
			nl: 'Velden van As',
			en: 'Fields of Ash',
			de: 'Felder aus Asche',
			fr: 'Champs de Cendres',
			pl: 'Pola Popiołu'
		},
		g: ['Oorlog', 'Drama', 'Geschiedenis'],
		d: 'Simon Hartwell',
		r: 7.7,
		m: 137,
		c: ['sergeant Arthur Penn', 'soldaat Eli Rook', 'Marthe'],
		a: 30,
		p: 'Vlaanderen, 1917: twee Britse soldaten raken achter de linies verdwaald en vinden onderdak bij een Belgische boerin. Een ingetogen oorlogsdrama over de kleine menselijkheid te midden van de grote verwoesting.',
		v: 'nl:A en:AB de:B fr:B pl:C'
	},
	{
		y: 2019,
		o: 'tr',
		t: {
			tr: 'Çay Bahçesi',
			en: 'The Tea Garden',
			nl: 'De Theetuin',
			de: 'Der Teegarten',
			ar: 'حديقة الشاي'
		},
		g: ['Komedie', 'Drama'],
		d: 'Murat Öztürk',
		r: 7.3,
		m: 104,
		c: ['oom Hasan', 'Zeynep', 'Emre'],
		a: 25,
		p: 'Oom Hasan runt al veertig jaar een theetuin aan de Bosporus en weigert elk bod van projectontwikkelaars. Wanneer zijn nicht Zeynep uit Duitsland komt om hem op andere gedachten te brengen, wordt ze zelf verleid door de stad.',
		v: 'tr:C ar:C en:B nl:A de:B'
	},
	{
		y: 2022,
		o: 'ar',
		t: {
			ar: 'الرمال المتحركة',
			en: 'Shifting Sands',
			nl: 'Verschuivend Zand',
			fr: 'Sables Mouvants',
			tr: 'Kayan Kumlar'
		},
		g: ['Thriller', 'Avontuur'],
		d: 'Nadia El-Sayed',
		r: 7.0,
		m: 113,
		c: ['Omar', 'Rania', 'de kolonel'],
		a: 18,
		p: 'Een woestijngids en een geologe raken tijdens een zandstorm het spoor kwijt van hun expeditie. Wanneer het zand gaat liggen, staan ze voor een verlaten onderzoeksbasis die op geen enkele kaart voorkomt.',
		v: 'ar:C fr:B en:B nl:A tr:C'
	},
	{
		y: 2018,
		o: 'pl',
		t: {
			pl: 'Dom na Wrzosowym Wzgórzu',
			en: 'The House on Heather Hill',
			nl: 'Het Huis op de Heideheuvel',
			de: 'Das Haus auf dem Heidehügel'
		},
		g: ['Horror'],
		d: 'Paweł Krajewski',
		r: 6.6,
		m: 99,
		c: ['Ola Malinowska', 'oom Stefan', 'het kind in het raam'],
		a: 34,
		p: 'Ola erft het huis van een oom die ze nooit heeft gekend, hoog op een heuvel in de Poolse bergen. In het dorp wil niemand haar de weg wijzen, en in het huis brandt al licht als ze aankomt.',
		v: 'pl:C en:B nl:A de:B'
	},
	{
		y: 2021,
		o: 'pt',
		t: {
			pt: 'Cartas de Lisboa',
			en: 'Letters from Lisbon',
			nl: 'Brieven uit Lissabon',
			es: 'Cartas desde Lisboa',
			fr: 'Lettres de Lisbonne'
		},
		g: ['Romantiek', 'Drama'],
		d: 'Beatriz Lobo',
		r: 7.2,
		m: 110,
		c: ['Inês', 'Daniel', 'dona Amália'],
		a: 16,
		p: 'Een Nederlandse vertaler vindt in een antiquariaat in Lissabon een stapel nooit verstuurde liefdesbrieven. Op zoek naar de geadresseerde ontmoet hij Inês, die meer met de brieven te maken heeft dan ze laat merken.',
		v: 'pt:C nl:A en:B es:C fr:B'
	},
	{
		y: 2023,
		o: 'it',
		t: {
			it: 'Il Silenzio di Napoli',
			en: 'The Silence of Naples',
			nl: 'De Stilte van Napels',
			de: 'Die Stille von Neapel',
			tr: 'Napoli Sessizliği'
		},
		g: ['Misdaad', 'Thriller'],
		d: 'Fabrizio Conti',
		r: 7.5,
		m: 122,
		c: ['commissaris Rocco Esposito', 'Giulia Mancini', 'don Arturo'],
		a: 8,
		p: 'In een Napolitaanse wijk waar iedereen alles weet, zegt niemand iets over de verdwijning van een jonge advocate. Commissaris Esposito moet een stilte doorbreken die al drie generaties duurt.',
		v: 'it:BC nl:A en:B de:B tr:C'
	},
	{
		y: 1999,
		o: 'en',
		t: {
			nl: 'Signaal van Vega',
			en: 'Signal from Vega',
			de: 'Signal von Wega',
			fr: 'Signal de Véga',
			es: 'Señal desde Vega'
		},
		g: ['Sciencefiction', 'Mysterie'],
		d: 'Lionel Marsh',
		r: 7.3,
		m: 112,
		c: ['dr. Ellen Hart', 'Sam Okoro', 'de Stem'],
		a: 53,
		p: 'Een radioastronome vangt een signaal op dat precies klinkt als de stem van haar overleden vader. Terwijl de wereldpers zich op haar stort, probeert ze te ontcijferen wat de boodschap werkelijk betekent.',
		v: 'nl:A en:ABF de:B fr:C es:C'
	},
	{
		y: 2025,
		o: 'nl',
		t: {
			nl: 'De Wonderlijke Reis van Kiki',
			en: 'The Wondrous Voyage of Kiki',
			de: 'Kikis Wundersame Reise',
			fr: 'Le Merveilleux Voyage de Kiki'
		},
		g: ['Animatie', 'Familie', 'Avontuur'],
		d: 'Femke Lammers',
		r: 7.1,
		m: 86,
		c: ['Kiki', 'kapitein Snor', 'Wim de walvis'],
		a: 2,
		p: 'Het eigenwijze zeehondje Kiki raakt haar familie kwijt en zwemt dwars over de Noordzee om ze terug te vinden. Onderweg sluit ze vriendschap met een brombeer van een walvis en een kapitein met een heel grote snor.',
		v: 'nl:A4C en:B de:B fr:B'
	},
	{
		y: 2026,
		o: 'en',
		t: {
			nl: 'Velocity Zero',
			en: 'Velocity Zero',
			de: 'Velocity Zero',
			es: 'Velocidad Cero',
			it: 'Velocità Zero',
			pt: 'Velocidade Zero',
			ar: 'السرعة صفر'
		},
		g: ['Actie', 'Sciencefiction'],
		d: 'Reese Tolland',
		r: 6.9,
		m: 119,
		c: ['Kai Mercer', 'dr. Sela Grant', 'Vortex'],
		a: 0,
		p: 'Een testpiloot overleeft als enige een experimentele vlucht op tien keer de geluidssnelheid, en komt terug met een vertraging van drie seconden ten opzichte van de rest van de wereld. Die drie seconden blijken goud waard.',
		v: 'nl:A en:A4B4 de:B es:C it:C pt:C ar:C'
	},
	{
		y: 2001,
		o: 'fr',
		t: {
			fr: 'Les Enfants du Phare',
			en: 'Children of the Lighthouse',
			nl: 'De Kinderen van de Vuurtoren'
		},
		g: ['Drama', 'Familie'],
		d: 'Hélène Marchais',
		r: 7.6,
		m: 108,
		c: ['Yann', 'Maëlle', 'vuurtorenwachter Corentin'],
		a: 48,
		p: 'Twee kinderen brengen na de scheiding van hun ouders een zomer door bij hun zwijgzame grootvader, de laatste vuurtorenwachter van Bretagne. Als de vuurtoren wordt geautomatiseerd, besluiten ze dat te voorkomen.',
		v: 'fr:B nl:A en:B'
	},
	{
		y: 1989,
		o: 'en',
		t: {
			nl: 'De Toevallige Detective',
			en: 'The Accidental Detective',
			de: 'Der Zufallsdetektiv',
			es: 'El Detective Accidental'
		},
		g: ['Komedie', 'Misdaad'],
		d: 'Marty Gold',
		r: 6.7,
		m: 101,
		c: ['Harvey Pinch', 'Lola Vance', 'inspecteur Graves'],
		a: 56,
		p: 'Een verstrooide boekhouder wordt door een misverstand aangezien voor de beroemdste privédetective van Chicago. Om zijn huid te redden, moet hij een zaak oplossen waar hij niets van begrijpt.',
		v: 'en:AB nl:A de:B es:C'
	},
	{
		y: 2020,
		o: 'de',
		t: {
			de: 'Der Wald der Wölfe',
			en: 'Forest of Wolves',
			nl: 'Het Wolvenwoud',
			pl: 'Las Wilków'
		},
		g: ['Documentaire'],
		d: 'Jana Hofmeister',
		r: 8.0,
		m: 90,
		c: ['Verteller'],
		a: 21,
		p: 'Na honderdvijftig jaar keren wolven terug in de bossen van Midden-Europa. Een jaar lang volgen we een roedel in de grensstreek tussen Duitsland en Polen, en de mensen die met ze moeten leren leven.',
		v: 'de:B nl:A en:B pl:C'
	}
];
