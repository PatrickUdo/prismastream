// Fictional series. Same availability notation as films.ts; s = episodes per season.
import type { LangCode } from '#lib/types.ts';

export interface SeriesSeed {
	y: number;
	o: LangCode;
	t: Partial<Record<LangCode, string>>;
	g: string[];
	d: string;
	r: number;
	/** Episode runtime in minutes. */
	m: number;
	c: string[];
	a: number;
	p: string;
	v: string;
	s: number[];
}

export const SERIES: SeriesSeed[] = [
	{
		y: 2016,
		o: 'nl',
		t: { nl: 'De Grens', en: 'The Border', de: 'Die Grenze', tr: 'Sınır' },
		g: ['Misdaad', 'Drama'],
		d: 'Bart Schouten',
		r: 8.0,
		m: 48,
		c: ['rechercheur Ilse Maas', 'Yusuf Kaya', 'commissaris Dekker'],
		a: 10,
		p: 'In het grensgebied tussen Limburg en België verdwijnt een jonge douanier. Rechercheur Ilse Maas stuit op een smokkelnetwerk dat beide landen liever onzichtbaar houden.',
		v: 'nl:AC en:B de:C tr:C',
		s: [8, 8, 6]
	},
	{
		y: 2019,
		o: 'nl',
		t: { nl: 'Polderlicht', en: 'Polder Light', de: 'Polderlicht' },
		g: ['Drama'],
		d: 'Mirjam Kooistra',
		r: 7.6,
		m: 45,
		c: ['Anke Hoogeveen', 'Gerrit Hoogeveen', 'Sjoerd'],
		a: 29,
		p: 'Een boerenfamilie in de Noordoostpolder vecht voor het voortbestaan van haar bedrijf. Dan keert de jongste dochter terug uit de stad, met plannen die niemand wil horen.',
		v: 'nl:A en:AB de:B',
		s: [6, 6]
	},
	{
		y: 2022,
		o: 'en',
		t: {
			nl: 'Het Signaal',
			en: 'The Signal',
			fr: 'Le Signal',
			es: 'La Señal',
			pl: 'Sygnał'
		},
		g: ['Sciencefiction', 'Mysterie'],
		d: 'Owen Achterberg',
		r: 8.2,
		m: 52,
		c: ['dr. Maya Collins', 'Theo Brandt', 'agent Kessler'],
		a: 3,
		p: 'Een radiotelescoop in de Atacamawoestijn vangt een signaal op dat elke nacht een minuut eerder komt. Astronome Maya Collins ontdekt dat de boodschap gaat over gebeurtenissen die nog moeten plaatsvinden.',
		v: 'nl:A en:A4B fr:B es:C pl:C',
		s: [8, 8]
	},
	{
		y: 2018,
		o: 'nl',
		t: { nl: 'Kantoor 13', en: 'Office 13' },
		g: ['Komedie'],
		d: 'Thijs Rademaker',
		r: 7.4,
		m: 25,
		c: ['Ronald Smit', 'Fatima Bouzid', 'Henk van Facilitair'],
		a: 38,
		p: 'Op de dertiende verdieping van een gemeentekantoor in Almere draait niets zoals het hoort. Teamleider Ronald probeert met een ploeg eigenwijze ambtenaren de zoveelste reorganisatie te overleven.',
		v: 'nl:AC en:B',
		s: [6, 6, 6, 6]
	},
	{
		y: 2020,
		o: 'de',
		t: { de: 'Das Archiv', en: 'The Archive', nl: 'Het Archief', it: "L'Archivio" },
		g: ['Thriller', 'Geschiedenis'],
		d: 'Katrin Vogel',
		r: 8.0,
		m: 50,
		c: ['Lena Hartmann', 'Paul Richter', 'dr. Seidel'],
		a: 24,
		p: 'Archivaris Lena Hartmann vindt in een vergeten kelder in Leipzig dossiers die nooit vernietigd hadden mogen worden. Elke map die ze opent, brengt iemand in de huidige regering in gevaar.',
		v: 'de:B nl:A en:B it:C',
		s: [6, 6, 6]
	},
	{
		y: 2017,
		o: 'tr',
		t: {
			tr: 'Denizin Sultanı',
			en: 'Sultan of the Sea',
			nl: 'Sultan van de Zee',
			ar: 'سلطان البحر'
		},
		g: ['Avontuur', 'Drama', 'Geschiedenis'],
		d: 'Serkan Yıldız',
		r: 7.7,
		m: 55,
		c: ['kapitein Barış', 'Nilüfer', 'vizier Ahmet'],
		a: 42,
		p: 'In de zestiende eeuw groeit een vissersjongen uit Izmir uit tot de meest gevreesde kapitein van de Middellandse Zee. Maar aan het hof in Istanbul wachten vijanden die gevaarlijker zijn dan elke storm.',
		v: 'tr:C ar:C en:B nl:A',
		s: [10, 10]
	},
	{
		y: 2021,
		o: 'nl',
		t: {
			nl: 'Havenstad',
			en: 'Harbour City',
			pl: 'Miasto Portowe',
			pt: 'Cidade Portuária'
		},
		g: ['Misdaad', 'Thriller'],
		d: 'Rachid Benali',
		r: 8.1,
		m: 47,
		c: ['douanier Sanne Kroes', 'Mo Benali', 'de Admiraal'],
		a: 7,
		p: 'In de Rotterdamse haven verdwijnen elke week containers zonder een spoor achter te laten. Douanier Sanne Kroes raakt verstrikt in een netwerk waarin haar eigen broer een sleutelrol speelt.',
		v: 'nl:A4C en:B pl:C pt:C',
		s: [8, 8, 8]
	},
	{
		y: 2023,
		o: 'nl',
		t: {
			nl: 'De Uitvinders',
			en: 'The Inventors',
			fr: 'Les Inventeurs',
			es: 'Los Inventores',
			it: 'Gli Inventori'
		},
		g: ['Animatie', 'Familie', 'Kinderen'],
		d: 'Noor Huisman',
		r: 7.5,
		m: 22,
		c: ['Fien', 'Bolt de robot', 'professor Klok'],
		a: 5,
		p: 'Fien en haar robot Bolt bouwen in een schuurtje de gekste uitvindingen, van een wolkenstofzuiger tot een vertaalmachine voor katten. En elke aflevering loopt er iets heerlijk mis.',
		v: 'nl:A en:A fr:B es:C it:B',
		s: [10, 10]
	},
	{
		y: 2019,
		o: 'ar',
		t: { ar: 'وردة الصحراء', en: 'Desert Rose', nl: 'Woestijnroos', fr: 'Rose des Sables' },
		g: ['Romantiek', 'Drama'],
		d: 'Laila Haddad',
		r: 7.3,
		m: 46,
		c: ['Noor', 'Tariq', 'oum Khaled'],
		a: 32,
		p: 'Een jonge architecte keert terug naar haar geboortestad aan de rand van de woestijn om het hotel van haar grootmoeder te redden. Daar ontmoet ze de man die het wil slopen.',
		v: 'ar:C fr:B en:B nl:A',
		s: [8, 8]
	},
	{
		y: 2021,
		o: 'en',
		t: { nl: 'De Holle Hoeve', en: 'Hollow Farm', de: 'Der Hohle Hof' },
		g: ['Horror', 'Mysterie'],
		d: 'Callum Rhys',
		r: 7.0,
		m: 44,
		c: ['Beth Harlow', 'oude Jeb', 'dominee Wynn'],
		a: 35,
		p: 'Als de familie Harlow een oude boerderij in Wales koopt, vinden ze in de kelder een deur die van binnenuit op slot zit. Elke nacht klinkt er geklop, en elke ochtend is iemand een herinnering kwijt.',
		v: 'en:B nl:A de:B',
		s: [6, 6]
	},
	{
		y: 2024,
		o: 'en',
		t: { nl: 'Oceaan Diep', en: 'Deep Ocean', fr: 'Océan Profond', pt: 'Oceano Profundo' },
		g: ['Documentaire'],
		d: 'Nora Fieldstone',
		r: 8.6,
		m: 50,
		c: ['Verteller'],
		a: 13,
		p: 'Een documentairereeks naar de diepste, donkerste en vreemdste plekken van onze planeet. Met nieuwe duikrobots komen beelden boven die nog niemand eerder zag.',
		v: 'en:A nl:A fr:B pt:C',
		s: [5, 5]
	},
	{
		y: 2025,
		o: 'en',
		t: {
			nl: 'De Tijdbewakers',
			en: 'The Time Keepers',
			de: 'Die Zeitwächter',
			es: 'Los Guardianes del Tiempo',
			it: 'I Guardiani del Tempo'
		},
		g: ['Fantasy', 'Avontuur'],
		d: 'Aria Monroe',
		r: 7.9,
		m: 49,
		c: ['Juno Blake', 'meester Orrin', 'de Holle Koning'],
		a: 1,
		p: 'Een tienermeisje uit Bristol erft een zakhorloge waarmee ze tussen eeuwen kan reizen. Ze ontdekt dat een geheim genootschap al eeuwen de geschiedenis bijstuurt, en dat zij de volgende in de rij is.',
		v: 'en:AB nl:A de:B es:C it:C',
		s: [8, 8]
	},
	{
		y: 2020,
		o: 'es',
		t: {
			es: 'Hermanas del Sur',
			en: 'Sisters of the South',
			nl: 'Zussen van het Zuiden',
			pt: 'Irmãs do Sul'
		},
		g: ['Drama', 'Romantiek'],
		d: 'Verónica Saldaña',
		r: 7.1,
		m: 42,
		c: ['Lucía Montero', 'Paloma Montero', 'don Esteban'],
		a: 26,
		p: 'Na de dood van hun vader erven drie zussen een noodlijdende wijngaard in Andalusië. Oude rivaliteit, een verdwenen testament en een charmante buurman maken van de oogst een slagveld.',
		v: 'es:C pt:C en:B nl:A',
		s: [10, 10, 8]
	}
];
