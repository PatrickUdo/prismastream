// Fictional live channels. feeds = "<source><quality>" list (A/B/C + 4/F/H/S).
// shiftOf = this channel is a "+1" time-shift of another tvg id (EPG shifted one hour).
// reuseTvg = sources that (wrongly, like many providers) reuse the main channel's tvg-id
// for the +1 feed; the merge engine must still keep them apart.
// noEpg = the channel has a tvg-id but the guide has no programmes for it (common for small
// local and music channels); shows the "no programme information" state in /live.
import type { LangCode } from '#lib/types.ts';

export interface ChannelSeed {
	name: string;
	tvg: string;
	group:
		| 'Nieuws'
		| 'Sport'
		| 'Films'
		| 'Kids'
		| 'Documentaire'
		| 'Muziek'
		| 'Entertainment'
		| 'Regionaal';
	lang: LangCode;
	num: number;
	feeds: string;
	shiftOf?: string;
	reuseTvg?: string;
	noEpg?: boolean;
}

export const CHANNELS: ChannelSeed[] = [
	{
		name: 'Prisma 1',
		tvg: 'prisma1.nl',
		group: 'Entertainment',
		lang: 'nl',
		num: 1,
		feeds: 'AH BF C4'
	},
	{
		name: 'Prisma 2',
		tvg: 'prisma2.nl',
		group: 'Entertainment',
		lang: 'nl',
		num: 2,
		feeds: 'AH CF'
	},
	{
		name: 'Prisma Nieuws',
		tvg: 'prismanieuws.nl',
		group: 'Nieuws',
		lang: 'nl',
		num: 3,
		feeds: 'AF BH'
	},
	{
		name: 'Kanaal Noord',
		tvg: 'kanaalnoord.nl',
		group: 'Entertainment',
		lang: 'nl',
		num: 4,
		feeds: 'AH C4'
	},
	{
		name: 'Kanaal Noord +1',
		tvg: 'kanaalnoordplus1.nl',
		group: 'Entertainment',
		lang: 'nl',
		num: 5,
		feeds: 'AH',
		shiftOf: 'kanaalnoord.nl'
	},
	{
		name: 'Prisma Sport 1',
		tvg: 'prismasport1.nl',
		group: 'Sport',
		lang: 'nl',
		num: 6,
		feeds: 'AF B4 CH'
	},
	{
		name: 'Prisma Sport 2',
		tvg: 'prismasport2.nl',
		group: 'Sport',
		lang: 'nl',
		num: 7,
		feeds: 'AF'
	},
	{
		name: 'Prisma Cinema',
		tvg: 'prismacinema.nl',
		group: 'Films',
		lang: 'nl',
		num: 8,
		feeds: 'AF CF'
	},
	{
		name: 'Prisma Cinema +1',
		tvg: 'prismacinemaplus1.nl',
		group: 'Films',
		lang: 'nl',
		num: 9,
		feeds: 'AH CH',
		shiftOf: 'prismacinema.nl',
		reuseTvg: 'C'
	},
	{
		name: 'Kidz Planeet',
		tvg: 'kidzplaneet.nl',
		group: 'Kids',
		lang: 'nl',
		num: 10,
		feeds: 'AH BH'
	},
	{
		name: 'Wereld Docu',
		tvg: 'wereldocu.nl',
		group: 'Documentaire',
		lang: 'nl',
		num: 11,
		feeds: 'AF'
	},
	{ name: 'Polder FM TV', tvg: 'polderfm.nl', group: 'Muziek', lang: 'nl', num: 12, feeds: 'AH' },
	{
		name: 'Omroep Lindeburg',
		tvg: 'omroeplindeburg.nl',
		group: 'Regionaal',
		lang: 'nl',
		num: 13,
		feeds: 'AH',
		noEpg: true
	},
	{
		name: 'Neon Hits TV',
		tvg: 'neonhits.uk',
		group: 'Muziek',
		lang: 'en',
		num: 26,
		feeds: 'BH',
		noEpg: true
	},
	{ name: 'Globe 24', tvg: 'globe24.uk', group: 'Nieuws', lang: 'en', num: 20, feeds: 'AH BF' },
	{
		name: 'Arena Sports',
		tvg: 'arenasports.uk',
		group: 'Sport',
		lang: 'en',
		num: 21,
		feeds: 'B4 CF'
	},
	{ name: 'Toontown TV', tvg: 'toontown.us', group: 'Kids', lang: 'en', num: 22, feeds: 'BH' },
	{
		name: 'Discover Earth',
		tvg: 'discoverearth.uk',
		group: 'Documentaire',
		lang: 'en',
		num: 23,
		feeds: 'AF BF'
	},
	{ name: 'Pulse Music', tvg: 'pulsemusic.uk', group: 'Muziek', lang: 'en', num: 24, feeds: 'BH' },
	{
		name: 'Bright TV',
		tvg: 'brighttv.uk',
		group: 'Entertainment',
		lang: 'en',
		num: 25,
		feeds: 'BH CH'
	},
	{
		name: 'Nachrichten Eins',
		tvg: 'nachrichten1.de',
		group: 'Nieuws',
		lang: 'de',
		num: 30,
		feeds: 'BH'
	},
	{ name: 'Kino Klassik', tvg: 'kinoklassik.de', group: 'Films', lang: 'de', num: 31, feeds: 'BF' },
	{ name: 'Info Monde', tvg: 'infomonde.fr', group: 'Nieuws', lang: 'fr', num: 40, feeds: 'BH' },
	{
		name: 'Histoire Plus',
		tvg: 'histoireplus.fr',
		group: 'Documentaire',
		lang: 'fr',
		num: 41,
		feeds: 'BH'
	},
	{ name: 'Deportes Uno', tvg: 'deportes1.es', group: 'Sport', lang: 'es', num: 50, feeds: 'CF' },
	{
		name: 'Ritmo Latino',
		tvg: 'ritmolatino.es',
		group: 'Muziek',
		lang: 'es',
		num: 51,
		feeds: 'CH'
	},
	{
		name: 'Cinema Italia',
		tvg: 'cinemaitalia.it',
		group: 'Films',
		lang: 'it',
		num: 60,
		feeds: 'BH CH'
	},
	{
		name: 'Divertimento',
		tvg: 'divertimento.it',
		group: 'Entertainment',
		lang: 'it',
		num: 61,
		feeds: 'CH'
	},
	{
		name: 'Haber Merkez',
		tvg: 'habermerkez.tr',
		group: 'Nieuws',
		lang: 'tr',
		num: 70,
		feeds: 'CH'
	},
	{
		name: 'Çocuk Dünyası',
		tvg: 'cocukdunyasi.tr',
		group: 'Kids',
		lang: 'tr',
		num: 71,
		feeds: 'CH'
	},
	{ name: 'Al Ufuq News', tvg: 'alufuq.ar', group: 'Nieuws', lang: 'ar', num: 80, feeds: 'CH' },
	{
		name: 'Saba Drama',
		tvg: 'sabadrama.ar',
		group: 'Entertainment',
		lang: 'ar',
		num: 81,
		feeds: 'CF'
	},
	{ name: 'Sport Polska', tvg: 'sportpolska.pl', group: 'Sport', lang: 'pl', num: 90, feeds: 'CF' },
	{ name: 'Cine Lusa', tvg: 'cinelusa.pt', group: 'Films', lang: 'pt', num: 95, feeds: 'CH' }
];
