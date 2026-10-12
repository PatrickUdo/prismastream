// Genre normalisation: every provider spelling ("Action", "Acción", "Aksiyon", "أكشن")
// maps to one Dutch canonical name ("Actie"). The UI can translate via t(`catalog.genre.${slug}`).
import type { LangCode } from '#lib/types.ts';
import { foldText } from './normalize.ts';

interface GenreDef {
	slug: string;
	/** Canonical (Dutch) name. */
	nl: string;
	en: string;
	/** Localised names per language (used by the sample library and as synonyms). */
	loc: Partial<Record<LangCode, string>>;
	syn?: string[];
}

export const GENRES: GenreDef[] = [
	{
		slug: 'action',
		nl: 'Actie',
		en: 'Action',
		loc: {
			de: 'Action',
			fr: 'Action',
			es: 'Acción',
			it: 'Azione',
			tr: 'Aksiyon',
			ar: 'أكشن',
			pl: 'Akcja',
			pt: 'Ação'
		},
		syn: ['اكشن', 'боевик', 'toiminta', 'actiefilm']
	},
	{
		slug: 'adventure',
		nl: 'Avontuur',
		en: 'Adventure',
		loc: {
			de: 'Abenteuer',
			fr: 'Aventure',
			es: 'Aventura',
			it: 'Avventura',
			tr: 'Macera',
			ar: 'مغامرة',
			pl: 'Przygodowy',
			pt: 'Aventura'
		},
		syn: ['przygoda', 'приключения', 'avonturenfilm']
	},
	{
		slug: 'animation',
		nl: 'Animatie',
		en: 'Animation',
		loc: {
			de: 'Animation',
			fr: 'Animation',
			es: 'Animación',
			it: 'Animazione',
			tr: 'Animasyon',
			ar: 'رسوم متحركة',
			pl: 'Animacja',
			pt: 'Animação'
		},
		syn: ['animated', 'cartoon', 'tekenfilm', 'zeichentrick', 'анимация', 'мультфильм']
	},
	{
		slug: 'comedy',
		nl: 'Komedie',
		en: 'Comedy',
		loc: {
			de: 'Komödie',
			fr: 'Comédie',
			es: 'Comedia',
			it: 'Commedia',
			tr: 'Komedi',
			ar: 'كوميديا',
			pl: 'Komedia',
			pt: 'Comédia'
		},
		syn: ['humor', 'комедия', 'comedy drama']
	},
	{
		slug: 'crime',
		nl: 'Misdaad',
		en: 'Crime',
		loc: {
			de: 'Krimi',
			fr: 'Policier',
			es: 'Crimen',
			it: 'Crimine',
			tr: 'Suç',
			ar: 'جريمة',
			pl: 'Kryminał',
			pt: 'Crime'
		},
		syn: ['poliziesco', 'policial', 'криминал', 'misdaadfilm', 'krimi drama']
	},
	{
		slug: 'documentary',
		nl: 'Documentaire',
		en: 'Documentary',
		loc: {
			de: 'Dokumentarfilm',
			fr: 'Documentaire',
			es: 'Documental',
			it: 'Documentario',
			tr: 'Belgesel',
			ar: 'وثائقي',
			pl: 'Dokumentalny',
			pt: 'Documentário'
		},
		syn: ['dokumentation', 'docu', 'documentaires', 'документальный', 'doku']
	},
	{
		slug: 'drama',
		nl: 'Drama',
		en: 'Drama',
		loc: {
			de: 'Drama',
			fr: 'Drame',
			es: 'Drama',
			it: 'Dramma',
			tr: 'Dram',
			ar: 'دراما',
			pl: 'Dramat',
			pt: 'Drama'
		},
		syn: ['драма', 'dramafilm']
	},
	{
		slug: 'family',
		nl: 'Familie',
		en: 'Family',
		loc: {
			de: 'Familie',
			fr: 'Familial',
			es: 'Familia',
			it: 'Famiglia',
			tr: 'Aile',
			ar: 'عائلي',
			pl: 'Familijny',
			pt: 'Família'
		},
		syn: ['familiefilm', 'семейный', 'family film']
	},
	{
		slug: 'fantasy',
		nl: 'Fantasy',
		en: 'Fantasy',
		loc: {
			de: 'Fantasy',
			fr: 'Fantastique',
			es: 'Fantasía',
			it: 'Fantasy',
			tr: 'Fantastik',
			ar: 'فانتازيا',
			pl: 'Fantasy',
			pt: 'Fantasia'
		},
		syn: ['фэнтези']
	},
	{
		slug: 'history',
		nl: 'Geschiedenis',
		en: 'History',
		loc: {
			de: 'Historie',
			fr: 'Histoire',
			es: 'Historia',
			it: 'Storia',
			tr: 'Tarih',
			ar: 'تاريخ',
			pl: 'Historyczny',
			pt: 'História'
		},
		syn: ['historisch', 'historical', 'historique', 'storico', 'история', 'period drama']
	},
	{
		slug: 'horror',
		nl: 'Horror',
		en: 'Horror',
		loc: {
			de: 'Horror',
			fr: 'Horreur',
			es: 'Terror',
			it: 'Horror',
			tr: 'Korku',
			ar: 'رعب',
			pl: 'Horror',
			pt: 'Terror'
		},
		syn: ['epouvante', 'epouvante horreur', 'orrore', 'ужасы', 'griezel']
	},
	{
		slug: 'music',
		nl: 'Muziek',
		en: 'Music',
		loc: {
			de: 'Musik',
			fr: 'Musique',
			es: 'Música',
			it: 'Musica',
			tr: 'Müzik',
			ar: 'موسيقى',
			pl: 'Muzyczny',
			pt: 'Música'
		},
		syn: ['музыка', 'muziekfilm']
	},
	{
		slug: 'musical',
		nl: 'Musical',
		en: 'Musical',
		loc: { fr: 'Comédie musicale', es: 'Musical', it: 'Musical', tr: 'Müzikal', pl: 'Musical' }
	},
	{
		slug: 'mystery',
		nl: 'Mysterie',
		en: 'Mystery',
		loc: {
			de: 'Mystery',
			fr: 'Mystère',
			es: 'Misterio',
			it: 'Mistero',
			tr: 'Gizem',
			ar: 'غموض',
			pl: 'Tajemnica',
			pt: 'Mistério'
		},
		syn: ['детектив', 'mysteriefilm', 'giallo']
	},
	{
		slug: 'romance',
		nl: 'Romantiek',
		en: 'Romance',
		loc: {
			de: 'Liebesfilm',
			fr: 'Romance',
			es: 'Romance',
			it: 'Sentimentale',
			tr: 'Romantik',
			ar: 'رومانسي',
			pl: 'Romans',
			pt: 'Romance'
		},
		syn: ['romantisch', 'romantic', 'romantique', 'romantico', 'romantiek', 'мелодрама', 'romcom']
	},
	{
		slug: 'scifi',
		nl: 'Sciencefiction',
		en: 'Science Fiction',
		loc: {
			de: 'Science-Fiction',
			fr: 'Science-fiction',
			es: 'Ciencia ficción',
			it: 'Fantascienza',
			tr: 'Bilim Kurgu',
			ar: 'خيال علمي',
			pl: 'Sci-Fi',
			pt: 'Ficção científica'
		},
		syn: ['sci-fi', 'scifi', 'sf', 'fantastyka naukowa', 'фантастика', 'science fiction film']
	},
	{
		slug: 'thriller',
		nl: 'Thriller',
		en: 'Thriller',
		loc: {
			de: 'Thriller',
			fr: 'Thriller',
			es: 'Suspense',
			it: 'Thriller',
			tr: 'Gerilim',
			ar: 'إثارة',
			pl: 'Thriller',
			pt: 'Suspense'
		},
		syn: ['suspenso', 'dreszczowiec', 'триллер', 'spanning']
	},
	{
		slug: 'war',
		nl: 'Oorlog',
		en: 'War',
		loc: {
			de: 'Kriegsfilm',
			fr: 'Guerre',
			es: 'Bélica',
			it: 'Guerra',
			tr: 'Savaş',
			ar: 'حرب',
			pl: 'Wojenny',
			pt: 'Guerra'
		},
		syn: ['krieg', 'военный', 'oorlogsfilm', 'war politics']
	},
	{
		slug: 'western',
		nl: 'Western',
		en: 'Western',
		loc: { es: 'Western', it: 'Western', tr: 'Kovboy', pl: 'Western', pt: 'Faroeste' }
	},
	{
		slug: 'kids',
		nl: 'Kinderen',
		en: 'Kids',
		loc: {
			de: 'Kinder',
			fr: 'Enfants',
			es: 'Infantil',
			it: 'Bambini',
			tr: 'Çocuk',
			ar: 'أطفال',
			pl: 'Dla dzieci',
			pt: 'Infantil'
		},
		syn: ['kinder', 'children', 'jeugd', 'детский', 'kids family', 'kinderfilm']
	},
	{
		slug: 'reality',
		nl: 'Reality',
		en: 'Reality',
		loc: {},
		syn: ['reality tv', 'realityshow', 'reality show']
	},
	{ slug: 'talk', nl: 'Talkshow', en: 'Talk', loc: {}, syn: ['talk show'] },
	{
		slug: 'news',
		nl: 'Nieuws',
		en: 'News',
		loc: {
			de: 'Nachrichten',
			fr: 'Actualités',
			es: 'Noticias',
			it: 'Notizie',
			tr: 'Haber',
			ar: 'أخبار',
			pl: 'Wiadomości',
			pt: 'Notícias'
		}
	},
	{
		slug: 'sport',
		nl: 'Sport',
		en: 'Sports',
		loc: { es: 'Deportes', it: 'Sport', tr: 'Spor', ar: 'رياضة', pt: 'Esportes' },
		syn: ['sport']
	},
	{
		slug: 'biography',
		nl: 'Biografie',
		en: 'Biography',
		loc: {
			de: 'Biografie',
			fr: 'Biographie',
			es: 'Biografía',
			it: 'Biografico',
			tr: 'Biyografi',
			pl: 'Biograficzny',
			pt: 'Biografia'
		},
		syn: ['biopic']
	},
	{
		slug: 'tvmovie',
		nl: 'Tv-film',
		en: 'TV Movie',
		loc: { de: 'TV-Film', fr: 'Téléfilm', it: 'Film TV' },
		syn: ['telefilm', 'fernsehfilm']
	},
	{ slug: 'anime', nl: 'Anime', en: 'Anime', loc: {} },
	{ slug: 'soap', nl: 'Soap', en: 'Soap', loc: {}, syn: ['telenovela'] }
];

function fold(s: string): string {
	return foldText(s).replace(/\s+/g, '');
}

const LOOKUP = new Map<string, GenreDef>();
for (const g of GENRES) {
	for (const name of [g.nl, g.en, g.slug, ...Object.values(g.loc), ...(g.syn ?? [])]) {
		if (!name) continue;
		const key = fold(name);
		if (key && !LOOKUP.has(key)) LOOKUP.set(key, g);
	}
}
const BY_NL = new Map(GENRES.map((g) => [g.nl, g]));

const SPLIT = /\s*(?:&|,|\/|\||;|\+|\band\b|\ben\b|\bund\b|\bet\b|\by\b|\be\b)\s*/i;
const cache = new Map<string, string[]>();

/** Normalise one provider genre string into zero or more canonical (Dutch) genre names. */
export function normalizeGenre(raw: string): string[] {
	const cached = cache.get(raw);
	if (cached) return cached;
	const out: string[] = [];
	const whole = LOOKUP.get(fold(raw));
	if (whole) out.push(whole.nl);
	else {
		for (const part of raw.split(SPLIT)) {
			const p = part.trim();
			if (!p) continue;
			const def = LOOKUP.get(fold(p));
			if (def) out.push(def.nl);
			else if (p.length > 1 && p.length < 30) out.push(p.charAt(0).toUpperCase() + p.slice(1));
		}
	}
	const result = [...new Set(out)];
	cache.set(raw, result);
	return result;
}

/** Normalise and de-duplicate a list of genres (order of first appearance). */
export function normalizeGenres(list: string[] | undefined): string[] {
	if (!list?.length) return [];
	const out = new Set<string>();
	for (const g of list) for (const n of normalizeGenre(g)) out.add(n);
	return [...out];
}

/** i18n slug for a canonical genre name ('Sciencefiction' → 'scifi'); undefined for unknown genres. */
export function genreSlug(name: string): string | undefined {
	return (BY_NL.get(name) ?? LOOKUP.get(fold(name)))?.slug;
}

/** Localised genre name (used for sample data and display fallbacks). */
export function localizedGenre(nlName: string, lang: LangCode): string {
	const def = BY_NL.get(nlName);
	if (!def) return nlName;
	if (lang === 'nl') return def.nl;
	if (lang === 'en') return def.en;
	return def.loc[lang] ?? def.en;
}
