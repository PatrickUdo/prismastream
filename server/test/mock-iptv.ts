// A local fake IPTV provider for tests: Xtream Codes API (player_api.php, xmltv.php, stream
// paths), an M3U playlist and HLS/MPEG-TS/VOD streams. Records every request url, so tests can
// check what the server fetched. Only reachable because tests set proxyAllowPrivate.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';

export const USER = 'mockuser';
export const PASS = 'S3cr3t-Pa55word';

export interface MockOptions {
	movies?: number;
	series?: number;
	channels?: number;
	/** Serve xmltv.php gzip-compressed (as a .gz file, no content-encoding). */
	gzipEpg?: boolean;
	/** Status for every player_api call (e.g. 403 to simulate a banned IP). */
	apiStatus?: number;
	expired?: boolean;
	/** Movie list items with plot/cast/etc. (default true). Real Xtream VOD lists have none. */
	rich?: boolean;
	/** Channels with XMLTV programmes (default min(channels, 50)). */
	epgChannels?: number;
	/** Programme length in hours (default 1); 72 hours are generated. */
	epgHours?: number;
	/** Every 50th VOD item appears twice (another category), like real panels. */
	duplicates?: boolean;
	/** Awkward VOD names (U+2028, U+2029, lone \r, quotes, braces, emoji) and one broken item. */
	tricky?: boolean;
}

// A realistic plot length (real panels send 200-600 characters).
const PLOT =
	'Wanneer een onverwachte ontdekking het leven van een kleine gemeenschap op zijn kop zet, moeten de bewoners kiezen tussen veiligheid en de waarheid. Een verhaal over vriendschap, verlies en de moed om opnieuw te beginnen.';
const GENRES = ['Action', 'Drama', 'Comedy', 'Animation, Family', 'Horror', 'Thriller'];
const LANGS = ['NL', 'EN', 'DE', 'FR'];

export interface MockIptv {
	url: string;
	requests: string[];
	opts: MockOptions;
	close(): Promise<void>;
}

/** XMLTV as chunks (generated while sending, so a huge guide never sits in memory). */
function* xmltv(channels: number, now: number, hours = 1): Generator<string> {
	const fmt = (ms: number) => {
		const d = new Date(ms);
		const p = (n: number) => String(n).padStart(2, '0');
		return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}00 +0000`;
	};
	yield '<?xml version="1.0" encoding="UTF-8"?>\n<tv>\n';
	const start = Math.floor(now / 3600_000) * 3600_000 - 12 * 3600_000;
	for (let c = 0; c < channels; c++) {
		let out = `<channel id="ch${c}.mock"><display-name>Mock ${c}</display-name></channel>\n`;
		// 72 hours of programmes: the window keeps -6h .. +48h.
		for (let h = 0; h < 72; h += hours) {
			const s = start + h * 3600_000;
			out += `<programme start="${fmt(s)}" stop="${fmt(s + hours * 3600_000)}" channel="ch${c}.mock"><title>Show ${c}-${h}</title><desc>Omschrijving &amp; meer</desc></programme>\n`;
		}
		yield out;
	}
	yield '<programme start="20200101000000 +0000" stop="20200101010000 +0000" channel="unknown.ch"><title>X</title></programme>\n</tv>\n';
}

/** Writes chunks with backpressure. */
async function send(res: ServerResponse, chunks: Iterable<string>) {
	for (const c of chunks) if (!res.write(c)) await new Promise((r) => res.once('drain', r));
	res.end();
}

export async function startMockIptv(opts: MockOptions = {}): Promise<MockIptv> {
	const requests: string[] = [];
	const nMovies = opts.movies ?? 30;
	const nSeries = opts.series ?? 6;
	const nChannels = opts.channels ?? 8;
	const now = Date.now();
	let base = '';

	const json = (res: ServerResponse, v: unknown) => {
		res.writeHead(200, { 'content-type': 'application/json' });
		res.end(JSON.stringify(v));
	};

	const handler = (req: IncomingMessage, res: ServerResponse) => {
		requests.push(req.url ?? '');
		const u = new URL(req.url ?? '/', base);
		const p = u.pathname;
		if (p === '/player_api.php') {
			if (opts.apiStatus) {
				res.writeHead(opts.apiStatus);
				return res.end('nope');
			}
			if (u.searchParams.get('username') !== USER || u.searchParams.get('password') !== PASS)
				return json(res, { user_info: { auth: 0 } });
			const action = u.searchParams.get('action');
			const lang = (i: number) => LANGS[i % LANGS.length];
			switch (action) {
				case null:
					return json(res, {
						user_info: {
							auth: 1,
							status: opts.expired ? 'Expired' : 'Active',
							exp_date: String(Math.floor(now / 1000) + (opts.expired ? -86400 : 86400 * 30)),
							max_connections: '1',
							active_cons: '0',
							is_trial: '0'
						},
						server_info: { timezone: 'Europe/Amsterdam' }
					});
				case 'get_vod_categories':
					return json(res, [
						...LANGS.map((l, i) => ({ category_id: String(i + 1), category_name: `${l} | Films` })),
						// Empty categories exist on real panels.
						{ category_id: '98', category_name: 'XX | Leeg' },
						{ category_id: '99', category_name: '' }
					]);
				case 'get_series_categories':
					return json(res, [{ category_id: '20', category_name: 'NL | Series' }]);
				case 'get_live_categories':
					return json(res, [
						{ category_id: '30', category_name: 'NL | Algemeen' },
						{ category_id: '31', category_name: 'NL | Kids' }
					]);
				case 'get_vod_streams': {
					// Streamed in chunks, like a big panel would.
					res.writeHead(200, { 'content-type': 'application/json' });
					const rich = opts.rich !== false;
					const item = (i: number, cat: number) => {
						const film = Math.floor(i / 2); // two language versions per film
						const l = lang(i);
						return JSON.stringify({
							num: i + 1,
							name:
								`${l} - Mock Film ${film} (${2000 + (film % 24)})` +
								(opts.tricky && i % 3 === 0 ? ' \u2028\u2029\r"}] 🎬 مسلسل' : ''),
							stream_type: 'movie',
							stream_id: 1000 + i,
							stream_icon: `http://img.example/poster/${film}.jpg`,
							rating: String(5 + (film % 5)),
							rating_5based: (5 + (film % 5)) / 2,
							added: String(Math.floor(now / 1000) - film * 3600),
							is_adult: '0',
							category_id: String(cat),
							category_ids: [cat],
							container_extension: 'mkv',
							custom_sid: null,
							direct_source: '',
							tmdb: '',
							trailer: '',
							genre: GENRES[film % GENRES.length],
							...(rich
								? {
										plot: `Plot van film ${film}. Een avontuur met "quotes" en \\ backslashes. ${PLOT}`,
										cast: 'Anna de Vries, Bram Jansen, Carla Bakker, Daan Visser, Eva Smit',
										director: `Regisseur ${film % 300}`,
										backdrop_path: [`http://img.example/backdrop/${film}.jpg`],
										youtube_trailer: 'dQw4w9WgXcQ'
									}
								: {})
						});
					};
					return send(
						res,
						(function* () {
							yield '[';
							if (opts.tricky) yield '{"num":0,"name":"kapot", bad},';
							for (let i = 0; i < nMovies; i++) {
								yield (i ? ',' : '') + item(i, (i % LANGS.length) + 1);
								if (opts.duplicates && i % 50 === 0) yield ',' + item(i, 98);
								if (i % 500 === 499) yield ''; // chunk boundary
							}
							yield ']';
						})()
					);
				}
				case 'get_series':
					return json(
						res,
						Array.from({ length: nSeries }, (_, i) => ({
							num: i + 1,
							name: `NL - Mock Serie ${i}`,
							series_id: 500 + i,
							cover: `http://img.example/series/${i}.jpg`,
							plot: `Serie ${i}. ${PLOT}`,
							cast: 'Anna de Vries, Bram Jansen, Carla Bakker',
							director: `Regisseur ${i % 300}`,
							genre: i % 2 ? 'Animation' : 'Drama',
							releaseDate: `${2000 + (i % 24)}-05-01`,
							rating: String(5 + (i % 5)),
							rating_5based: (5 + (i % 5)) / 2,
							backdrop_path: [`http://img.example/series-bd/${i}.jpg`],
							youtube_trailer: '',
							episode_run_time: '45',
							category_id: '20',
							category_ids: [20],
							last_modified: String(Math.floor(now / 1000) - i * 7200)
						}))
					);
				case 'get_series_info': {
					const id = u.searchParams.get('series_id');
					return json(res, {
						info: { plot: `Serie ${id} info`, cast: 'Anna Actrice, Bob Acteur', director: 'Regisseur X' },
						episodes: {
							'1': [1, 2, 3].map((e) => ({
								id: `${id}${e}`,
								episode_num: e,
								title: `Aflevering ${e}`,
								container_extension: 'mp4',
								info: { duration_secs: 1500, plot: `Ep ${e}` }
							})),
							'2': [{ id: `${id}9`, episode_num: 1, title: 'S2E1', container_extension: 'mp4', info: {} }]
						}
					});
				}
				case 'get_live_streams':
					return json(
						res,
						Array.from({ length: nChannels }, (_, i) => ({
							num: i + 1,
							name: i % 2 ? `NL: Kids Kanaal ${i}` : `NL: Mock Zender ${i}`,
							stream_type: 'live',
							stream_id: 100 + i,
							stream_icon: `http://img.example/logo/${i}.png`,
							epg_channel_id: `ch${i}.mock`,
							category_id: i % 2 ? '31' : '30'
						}))
					);
				default:
					return json(res, []);
			}
		}
		if (p === '/xmltv.php') {
			if (u.searchParams.get('password') !== PASS) {
				res.writeHead(401);
				return res.end();
			}
			const chunks = xmltv(opts.epgChannels ?? Math.min(nChannels, 50), now, opts.epgHours ?? 1);
			if (opts.gzipEpg) {
				res.writeHead(200, { 'content-type': 'application/octet-stream' });
				return res.end(gzipSync(Buffer.from([...chunks].join(''))));
			}
			res.writeHead(200, { 'content-type': 'application/xml' });
			return void send(res, chunks);
		}
		if (p === '/get.php' || p === '/playlist.m3u') {
			if (u.searchParams.get('password') !== PASS) {
				res.writeHead(403);
				return res.end();
			}
			let m3u = `#EXTM3U url-tvg="${base}/xmltv.php?username=${USER}&password=${PASS}"\n`;
			for (let i = 0; i < nChannels; i++)
				m3u += `#EXTINF:-1 tvg-id="ch${i}.mock" tvg-name="Zender ${i}" group-title="NL | ${i % 2 ? 'Kinderen' : 'Nieuws'}",NL: M3U Zender ${i}\n${base}/live/${USER}/${PASS}/${100 + i}.ts\n`;
			for (let i = 0; i < 4; i++)
				m3u += `#EXTINF:-1 tvg-logo="http://img.example/m${i}.jpg" group-title="VOD | EN Movies",EN - M3U Movie ${i} (2019)\n${base}/movie/${USER}/${PASS}/${9000 + i}.mp4\n`;
			m3u += `#EXTINF:-1 group-title="Series NL",Show Een S01E01\n${base}/series/${USER}/${PASS}/7001.mp4\n`;
			m3u += `#EXTINF:-1 group-title="Series NL",Show Een S01E02\n${base}/series/${USER}/${PASS}/7002.mp4\n`;
			res.writeHead(200, { 'content-type': 'audio/x-mpegurl' });
			return res.end(m3u);
		}
		// Streams. Credentials in the path must be right.
		const m = /^\/(movie|series|live)\/([^/]+)\/([^/]+)\/(.+)$/.exec(p);
		if (m) {
			if (m[2] !== USER || m[3] !== PASS) {
				res.writeHead(403);
				return res.end();
			}
			const file = m[4];
			if (file.endsWith('.m3u8')) {
				res.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl' });
				return res.end(
					`#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:6\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXTINF:6,\nseg1.ts\n#EXTINF:6,\n/live/${USER}/${PASS}/seg2.ts\n`
				);
			}
			if (m[1] === 'live' && file.startsWith('redirect')) {
				res.writeHead(302, { location: `/live/${USER}/${PASS}/101.ts` });
				return res.end();
			}
			const data = Buffer.alloc(4096, file.length % 256);
			for (let i = 0; i < data.length; i++) data[i] = i % 251;
			const range = /^bytes=(\d+)-(\d*)$/.exec(String(req.headers.range ?? ''));
			if (range) {
				const start = Number(range[1]);
				const end = range[2] ? Number(range[2]) : data.length - 1;
				res.writeHead(206, {
					'content-type': 'video/x-matroska',
					'content-range': `bytes ${start}-${end}/${data.length}`,
					'accept-ranges': 'bytes',
					'content-length': String(end - start + 1)
				});
				return res.end(data.subarray(start, end + 1));
			}
			res.writeHead(200, { 'content-type': file.endsWith('.ts') ? 'video/mp2t' : 'video/x-matroska', 'accept-ranges': 'bytes' });
			return res.end(data);
		}
		res.writeHead(404);
		res.end();
	};

	const server: Server = createServer(handler);
	await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
	base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	return {
		url: base,
		requests,
		opts,
		close: () =>
			new Promise<void>((r) => {
				server.closeAllConnections();
				server.close(() => r());
			})
	};
}
