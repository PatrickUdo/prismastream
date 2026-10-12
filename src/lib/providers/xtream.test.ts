import { describe, expect, it, vi } from 'vitest';
import {
	categoryMap,
	liveTsUrl,
	loadXtreamCatalog,
	mapLiveStream,
	mapSeries,
	mapSeriesInfo,
	mapShortEpg,
	mapVodStream,
	normalizeServerUrl,
	parseAccount,
	parseXtreamUrl,
	XtreamClient
} from '#lib/providers/xtream.ts';
import { HttpError } from '#lib/providers/http.ts';

// Fictional server and credentials. No real IPTV servers are contacted.
const creds = {
	serverUrl: 'http://panel.example:8080/',
	username: 'demo_user',
	password: 's3cr3t!'
};
const P = encodeURIComponent('s3cr3t!');

const ACCOUNT = {
	user_info: {
		username: 'demo_user',
		password: 's3cr3t!',
		message: '',
		auth: 1,
		status: 'Active',
		exp_date: '4102444800', // 2100-01-01
		is_trial: '0',
		active_cons: '1',
		created_at: '1700000000',
		max_connections: '2',
		allowed_output_formats: ['m3u8', 'ts']
	},
	server_info: { url: 'panel.example', port: '8080', timezone: 'Europe/Amsterdam' }
};

const VOD_CATS = [
	{ category_id: '10', category_name: 'NL | Films', parent_id: 0 },
	{ category_id: 11, category_name: 'EN | Movies 4K', parent_id: 0 },
	{ category_id: '12', category_name: '' }
];

const VOD = [
	{
		num: 1,
		name: 'NL - De Matrix (1999)',
		stream_type: 'movie',
		stream_id: 5001,
		stream_icon: 'http://img.example/matrix.jpg',
		rating: '8.7',
		rating_5based: 4.35,
		tmdb: '603',
		added: '1704067200',
		category_id: '10',
		container_extension: 'mkv',
		custom_sid: null,
		direct_source: '',
		plot: 'Een hacker ontdekt de waarheid.',
		cast: 'Keanu Reeves, Laurence Fishburne ,Carrie-Anne Moss',
		director: 'Lana Wachowski',
		genre: 'Actie, Sci-Fi',
		releaseDate: '1999-03-31',
		youtube_trailer: 'vKQi3bBA1y8',
		episode_run_time: '136',
		backdrop_path: ['https://img.example/backdrop.jpg']
	},
	{
		// messy: strings for numbers, empty fields, null, weird extension, no category
		num: '2',
		name: 'EN - The Matrix [4K]',
		stream_id: '5002',
		stream_icon: '',
		rating: '',
		rating_5based: '4.5',
		tmdb_id: 603,
		added: '',
		category_id: '11',
		container_extension: '.MP4',
		year: '1999',
		backdrop_path: [],
		youtube_trailer: 'https://www.youtube.com/watch?v=abc123def',
		duration_secs: 8160
	},
	{ name: 'No id' },
	{ stream_id: 9, name: '' },
	null,
	{ stream_id: '5003', title: 'Only Title', container_extension: null, tmdb: '0', rating: 0 }
];

const SERIES = [
	{
		num: 1,
		name: 'NL - De Brug',
		series_id: 300,
		cover: 'http://img.example/brug.jpg',
		plot: 'Een lijk op de grens.',
		cast: 'Sofia Helin',
		director: '',
		genre: 'Drama / Misdaad',
		releaseDate: '2011-09-21',
		last_modified: '1700000000',
		rating: '8',
		backdrop_path: ['', 'http://img.example/brug-bd.jpg'],
		youtube_trailer: '',
		episode_run_time: '58',
		category_id: '20'
	},
	{ series_id: '301', name: 'Messy', cover: null, release_date: '2020', rating: 'N/A' }
];

const SERIES_INFO = {
	seasons: [{ season_number: 1, name: 'Seizoen 1' }],
	info: {
		name: 'NL - De Brug',
		cover: 'http://img.example/brug.jpg',
		plot: 'Een lijk op de grens.',
		genre: 'Drama, Misdaad',
		releaseDate: '2011-09-21',
		rating: '8.1',
		backdrop_path: ['http://img.example/brug-bd.jpg'],
		tmdb: '45016',
		episode_run_time: '58'
	},
	episodes: {
		'2': [
			{
				id: '7003',
				episode_num: '1',
				title: 'De Brug S02E01',
				container_extension: 'mp4',
				info: { duration_secs: '3480', movie_image: 'http://img.example/s2e1.jpg', plot: 'Terug.' },
				season: 2
			}
		],
		'1': [
			{
				id: '7002',
				episode_num: 2,
				title: 'De Brug S01E02',
				container_extension: 'mkv',
				info: { duration: '00:58:30', releasedate: '2011-09-28' },
				season: '1'
			},
			{ id: '7001', episode_num: 1, title: '', container_extension: 'mkv', info: [], season: 1 },
			{ id: '7001', episode_num: 1, title: 'duplicate', container_extension: 'mkv', info: {} }
		]
	}
};

const LIVE_CATS = [{ category_id: '1', category_name: 'NL | Algemeen' }];
const LIVE = [
	{
		num: 1,
		name: 'NL: NPO 1 HD',
		stream_type: 'live',
		stream_id: 101,
		stream_icon: 'http://logo.example/npo1.png',
		epg_channel_id: 'npo1.nl',
		added: '1600000000',
		category_id: '1',
		tv_archive: 1,
		tv_archive_duration: '7'
	},
	{
		num: '0',
		name: 'NL: No EPG',
		stream_id: '102',
		epg_channel_id: null,
		stream_icon: '',
		tv_archive: 0,
		tv_archive_duration: 3
	}
];

describe('url helpers', () => {
	it('normalises server urls', () => {
		expect(normalizeServerUrl('panel.example:8080')).toBe('http://panel.example:8080');
		expect(normalizeServerUrl('https://panel.example/')).toBe('https://panel.example');
		expect(normalizeServerUrl('http://panel.example:8080/player_api.php')).toBe(
			'http://panel.example:8080'
		);
		expect(normalizeServerUrl(' http://panel.example/sub/get.php ')).toBe(
			'http://panel.example/sub'
		);
	});
	it('extracts credentials from a pasted get.php url', () => {
		expect(
			parseXtreamUrl('http://panel.example:8080/get.php?username=u1&password=p1&type=m3u_plus')
		).toEqual({ serverUrl: 'http://panel.example:8080', username: 'u1', password: 'p1' });
		expect(parseXtreamUrl('http://panel.example:8080')).toBeUndefined();
	});
	it('offers a .ts alternative for live urls', () => {
		expect(liveTsUrl('http://h/live/u/p/101.m3u8')).toBe('http://h/live/u/p/101.ts');
		expect(liveTsUrl('http://h/movie/u/p/1.mp4')).toBeUndefined();
	});
});

describe('parseAccount', () => {
	it('maps user_info', () => {
		const a = parseAccount(ACCOUNT);
		expect(a).toMatchObject({
			status: 'Active',
			expiresAt: 4102444800000,
			maxConnections: 2,
			activeConnections: 1,
			isTrial: false,
			timezone: 'Europe/Amsterdam',
			allowedFormats: ['m3u8', 'ts']
		});
	});
	it('treats null exp_date as unlimited', () => {
		expect(
			parseAccount({ user_info: { auth: 1, status: 'Active', exp_date: null } }).expiresAt
		).toBeUndefined();
	});
	it('throws typed errors', () => {
		expect(() => parseAccount({ user_info: { auth: 0 } })).toThrow(HttpError);
		try {
			parseAccount({ user_info: { auth: '0' } });
		} catch (e) {
			expect((e as HttpError).code).toBe('auth');
		}
		try {
			parseAccount({ user_info: { auth: 1, status: 'Expired', exp_date: '1000000000' } });
		} catch (e) {
			expect((e as HttpError).code).toBe('expired');
		}
		try {
			parseAccount('<html>');
		} catch (e) {
			expect((e as HttpError).code).toBe('invalid');
		}
	});
});

describe('mapping', () => {
	const ctx = {
		sourceId: 'x1',
		creds: { ...creds, serverUrl: normalizeServerUrl(creds.serverUrl) },
		cats: categoryMap(VOD_CATS)
	};

	it('maps a rich VOD item', () => {
		const m = mapVodStream(VOD[0]!, ctx)!;
		expect(m).toEqual({
			kind: 'movie',
			sourceId: 'x1',
			providerId: '5001',
			rawTitle: 'NL - De Matrix (1999)',
			category: 'NL | Films',
			originalTitle: undefined,
			year: 1999,
			tmdbId: 603,
			imdbId: undefined,
			posterUrl: 'http://img.example/matrix.jpg',
			backdropUrl: 'https://img.example/backdrop.jpg',
			plot: 'Een hacker ontdekt de waarheid.',
			genres: ['Actie', 'Sci-Fi'],
			cast: ['Keanu Reeves', 'Laurence Fishburne', 'Carrie-Anne Moss'],
			director: 'Lana Wachowski',
			releaseDate: '1999-03-31',
			rating: 8.7,
			durationSec: 136 * 60,
			trailerUrl: 'https://www.youtube.com/watch?v=vKQi3bBA1y8',
			addedAt: 1704067200000,
			url: `http://panel.example:8080/movie/demo_user/${P}/5001.mkv`,
			containerExt: 'mkv'
		});
	});

	it('copes with messy VOD items', () => {
		const m = mapVodStream(VOD[1]!, ctx)!;
		expect(m.providerId).toBe('5002');
		expect(m.posterUrl).toBeUndefined();
		expect(m.rating).toBe(9); // from rating_5based
		expect(m.tmdbId).toBe(603);
		expect(m.addedAt).toBeUndefined();
		expect(m.containerExt).toBe('mp4');
		expect(m.year).toBe(1999);
		expect(m.backdropUrl).toBeUndefined();
		expect(m.durationSec).toBe(8160);
		expect(m.trailerUrl).toBe('https://www.youtube.com/watch?v=abc123def');
		expect(mapVodStream(VOD[2]!, ctx)).toBeUndefined();
		expect(mapVodStream(VOD[3]!, ctx)).toBeUndefined();
		const t = mapVodStream(VOD[5]!, ctx)!;
		expect(t.rawTitle).toBe('Only Title');
		expect(t.tmdbId).toBeUndefined();
		expect(t.rating).toBeUndefined();
		expect(t.containerExt).toBe('mp4');
		expect(t.category).toBeUndefined();
	});

	it('maps series', () => {
		const s = mapSeries(SERIES[0], { sourceId: 'x1', cats: new Map([['20', 'NL | Series']]) })!;
		expect(s).toMatchObject({
			kind: 'series',
			providerId: '300',
			rawTitle: 'NL - De Brug',
			category: 'NL | Series',
			year: 2011,
			posterUrl: 'http://img.example/brug.jpg',
			backdropUrl: 'http://img.example/brug-bd.jpg',
			genres: ['Drama', 'Misdaad'],
			cast: ['Sofia Helin'],
			rating: 8,
			durationSec: 58 * 60,
			addedAt: 1700000000000
		});
		expect(s.director).toBeUndefined();
		expect(s.trailerUrl).toBeUndefined();
		expect(s.episodes).toBeUndefined();
		const messy = mapSeries(SERIES[1], { sourceId: 'x1', cats: new Map() })!;
		expect(messy).toMatchObject({ providerId: '301', year: 2020 });
		expect(messy.rating).toBeUndefined();
		expect(messy.posterUrl).toBeUndefined();
	});

	it('maps series info with episodes per season (object form)', () => {
		const r = mapSeriesInfo(SERIES_INFO, { creds: ctx.creds });
		expect(r.episodes.map((e) => [e.providerId, e.season, e.episode])).toEqual([
			['7001', 1, 1],
			['7002', 1, 2],
			['7003', 2, 1]
		]);
		expect(r.episodes[1]).toMatchObject({
			title: 'De Brug S01E02',
			durationSec: 58 * 60 + 30,
			airDate: '2011-09-28',
			url: `http://panel.example:8080/series/demo_user/${P}/7002.mkv`,
			containerExt: 'mkv'
		});
		expect(r.episodes[0].title).toBeUndefined();
		expect(r.episodes[2]).toMatchObject({
			durationSec: 3480,
			stillUrl: 'http://img.example/s2e1.jpg',
			plot: 'Terug.'
		});
		expect(r.info).toMatchObject({
			tmdbId: 45016,
			rating: 8.1,
			year: 2011,
			genres: ['Drama', 'Misdaad']
		});
	});

	it('maps series info with episodes as an array of arrays', () => {
		const r = mapSeriesInfo(
			{
				episodes: [[{ id: 1, episode_num: 1, season: 1 }], [{ id: 2, episode_num: 1, season: 2 }]]
			},
			{ creds: ctx.creds }
		);
		expect(r.episodes.map((e) => e.season)).toEqual([1, 2]);
		expect(mapSeriesInfo(null, { creds: ctx.creds }).episodes).toEqual([]);
		expect(mapSeriesInfo({ episodes: [] }, { creds: ctx.creds }).episodes).toEqual([]);
	});

	it('maps live streams with m3u8 urls', () => {
		const lctx = { ...ctx, cats: categoryMap(LIVE_CATS) };
		const c = mapLiveStream(LIVE[0], lctx)!;
		expect(c).toEqual({
			kind: 'live',
			sourceId: 'x1',
			providerId: '101',
			rawName: 'NL: NPO 1 HD',
			tvgId: 'npo1.nl',
			logoUrl: 'http://logo.example/npo1.png',
			group: 'NL | Algemeen',
			number: 1,
			url: `http://panel.example:8080/live/demo_user/${P}/101.m3u8`,
			catchupDays: 7
		});
		const d = mapLiveStream(LIVE[1], lctx)!;
		expect(d.tvgId).toBeUndefined();
		expect(d.number).toBeUndefined();
		expect(d.catchupDays).toBeUndefined();
		expect(d.logoUrl).toBeUndefined();
	});

	it('decodes base64 short EPG', () => {
		const b64 = (s: string) => Buffer.from(s, 'utf-8').toString('base64');
		const p = mapShortEpg(
			{
				id: '1',
				epg_id: 'npo1.nl',
				title: b64('Het Journaal – één'),
				description: b64('Nieuws'),
				start_timestamp: '1717243200',
				stop_timestamp: '1717246800'
			},
			'101'
		)!;
		expect(p).toEqual({
			channelId: 'npo1.nl',
			start: 1717243200000,
			stop: 1717246800000,
			title: 'Het Journaal – één',
			desc: 'Nieuws'
		});
	});
});

function mockFetch(routes: Record<string, unknown | ((u: URL) => Response)>) {
	const calls: string[] = [];
	const fn = vi.fn(async (input: string | URL | Request) => {
		const url = new URL(
			typeof input === 'string' ? input : input instanceof URL ? input : input.url
		);
		calls.push(url.toString());
		const key = url.searchParams.get('action') ?? 'account';
		const route = routes[key];
		if (route === undefined) return new Response('not found', { status: 404 });
		if (typeof route === 'function') return (route as (u: URL) => Response)(url);
		return new Response(JSON.stringify(route), {
			status: 200,
			headers: { 'content-type': 'application/json' }
		});
	});
	return { fn: fn as unknown as typeof fetch, calls };
}

describe('XtreamClient + loadXtreamCatalog (mock fetch)', () => {
	it('loads the whole catalog', async () => {
		const { fn, calls } = mockFetch({
			account: ACCOUNT,
			get_vod_categories: VOD_CATS,
			get_vod_streams: VOD,
			get_series_categories: [{ category_id: '20', category_name: 'NL | Series' }],
			get_series: SERIES,
			get_live_categories: LIVE_CATS,
			get_live_streams: LIVE
		});
		const client = new XtreamClient(creds, { fetch: fn, retries: 0 });
		const steps: string[] = [];
		const r = await loadXtreamCatalog(client, 'x1', (s) => steps.push(s));
		expect(r.account.maxConnections).toBe(2);
		expect(r.movies).toHaveLength(3);
		expect(r.series).toHaveLength(2);
		expect(r.series[0].category).toBe('NL | Series');
		expect(r.channels).toHaveLength(2);
		expect(r.warnings).toEqual([]);
		expect(steps[0]).toBe('auth');
		expect(steps).toHaveLength(4);
		expect(calls[0]).toContain('/player_api.php?username=demo_user&password=');
	});

	it('degrades gracefully when one list fails and keeps secrets out of warnings', async () => {
		const { fn } = mockFetch({
			account: ACCOUNT,
			get_vod_categories: VOD_CATS,
			get_vod_streams: () => new Response('<html>Error</html>', { status: 200 }),
			get_series_categories: [],
			get_series: () => new Response('', { status: 500 }),
			get_live_categories: LIVE_CATS,
			get_live_streams: LIVE
		});
		const client = new XtreamClient(creds, { fetch: fn, retries: 0 });
		const r = await loadXtreamCatalog(client, 'x1');
		expect(r.movies).toEqual([]);
		expect(r.series).toEqual([]);
		expect(r.channels).toHaveLength(2);
		expect(r.warnings).toHaveLength(2);
		for (const w of r.warnings) {
			expect(w).not.toContain('s3cr3t');
			expect(w).not.toContain(P);
			expect(w).not.toContain('demo_user');
		}
	});

	it('reports auth failures as HttpError("auth")', async () => {
		const { fn } = mockFetch({ account: { user_info: { auth: 0 } } });
		const client = new XtreamClient(creds, { fetch: fn, retries: 0 });
		await expect(client.authenticate()).rejects.toMatchObject({ code: 'auth' });
		const { fn: fn403 } = mockFetch({ account: () => new Response('denied', { status: 403 }) });
		await expect(
			new XtreamClient(creds, { fetch: fn403, retries: 0 }).authenticate()
		).rejects.toMatchObject({
			code: 'auth'
		});
	});

	it('fetches lazy series info', async () => {
		const { fn, calls } = mockFetch({ get_series_info: SERIES_INFO });
		const client = new XtreamClient(creds, { fetch: fn, retries: 0 });
		const r = mapSeriesInfo(await client.seriesInfo('300'), { creds: client.creds });
		expect(r.episodes).toHaveLength(3);
		expect(calls[0]).toContain('series_id=300');
	});

	it('builds the xmltv url', () => {
		expect(new XtreamClient(creds).xmltvUrl()).toBe(
			`http://panel.example:8080/xmltv.php?username=demo_user&password=${P}`
		);
	});
});
