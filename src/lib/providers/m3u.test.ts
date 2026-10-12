import { describe, expect, it } from 'vitest';
import {
	classify,
	looksLikeM3U,
	M3UParser,
	parseEpisodeName,
	parseExtinf,
	parseM3U,
	parseM3UStream
} from '#lib/providers/m3u.ts';
import { hashString } from '#lib/providers/util.ts';

const SRC = { sourceId: 'm3u-test' };

describe('parseExtinf', () => {
	it('reads duration, attributes and display name', () => {
		const r = parseExtinf(
			'#EXTINF:-1 tvg-id="npo1.nl" tvg-name="NPO 1" tvg-logo="http://x/l.png" group-title="NL | Algemeen",NPO 1 HD'
		);
		expect(r.duration).toBe(-1);
		expect(r.attrs['tvg-id']).toBe('npo1.nl');
		expect(r.attrs['group-title']).toBe('NL | Algemeen');
		expect(r.name).toBe('NPO 1 HD');
	});

	it('keeps commas inside quoted attributes and in the name', () => {
		const r = parseExtinf('#EXTINF:0 tvg-name="Good, Bad" group-title="A,B",Good, the Bad (1966)');
		expect(r.attrs['tvg-name']).toBe('Good, Bad');
		expect(r.attrs['group-title']).toBe('A,B');
		expect(r.name).toBe('Good, the Bad (1966)');
	});

	it('handles messy attributes: no spaces, single quotes, unquoted, uppercase keys', () => {
		const r = parseExtinf(
			'#EXTINF:-1 tvg-id="a"tvg-name=\'B\' TVG-LOGO=http://l/x.png group-title="" ,  Name  '
		);
		expect(r.attrs['tvg-id']).toBe('a');
		expect(r.attrs['tvg-name']).toBe('B');
		expect(r.attrs['tvg-logo']).toBe('http://l/x.png');
		expect(r.attrs['group-title']).toBe('');
		expect(r.name).toBe('Name');
	});

	it('falls back to the last comma when a quote is never closed', () => {
		const r = parseExtinf('#EXTINF:-1 tvg-name="Broken group-title="X",Channel One');
		expect(r.name).toBe('Channel One');
	});

	it('works without attributes', () => {
		expect(parseExtinf('#EXTINF:123,Plain').name).toBe('Plain');
		expect(parseExtinf('#EXTINF:123,Plain').duration).toBe(123);
	});
});

describe('parseEpisodeName', () => {
	it.each([
		['Breaking Code S01E02 The Pilot', 'Breaking Code', 1, 2, 'The Pilot'],
		['Breaking Code - S01 E02', 'Breaking Code', 1, 2, undefined],
		['NL - De Brug S2E10', 'NL - De Brug', 2, 10, undefined],
		['Show.Name.S03.E04.720p', 'Show.Name', 3, 4, '720p'],
		['The Office 2x05', 'The Office', 2, 5, undefined],
		['Dark Season 1 Episode 3', 'Dark', 1, 3, undefined],
		['Flikken Seizoen 4 Aflevering 12', 'Flikken', 4, 12, undefined]
	])('%s', (name, series, season, episode, title) => {
		const m = parseEpisodeName(name);
		expect(m).toMatchObject({ series, season, episode });
		expect(m?.title).toBe(title);
	});

	it('does not match resolutions or plain titles', () => {
		expect(parseEpisodeName('Movie 1920x1080')).toBeUndefined();
		expect(parseEpisodeName('Seven (1995)')).toBeUndefined();
		expect(parseEpisodeName('S01E02')).toBeUndefined(); // no series name
	});
});

describe('classify', () => {
	const e = (name: string, url: string, group?: string, duration = -1, attrs = {}) => ({
		name,
		url,
		group,
		duration,
		attrs
	});
	it('uses Xtream-style paths', () => {
		expect(classify(e('X', 'http://h:8080/movie/u/p/1.mkv'))).toBe('movie');
		expect(classify(e('X S01E01', 'http://h:8080/series/u/p/2.mp4'))).toBe('episode');
		expect(classify(e('X', 'http://h:8080/live/u/p/3.ts'))).toBe('live');
		expect(classify(e('X', 'http://h:8080/u/p/3'))).toBe('live');
	});
	it('uses extensions, duration and groups', () => {
		expect(classify(e('Film', 'http://h/a.mp4?token=1'))).toBe('movie');
		expect(classify(e('Film', 'http://h/stream', 'Movies', 5400))).toBe('movie');
		expect(classify(e('Film1 HD', 'http://h/stream.ts', 'NL | Films'))).toBe('live');
		expect(classify(e('Film1 HD', 'http://h/stream.m3u8', 'Films'))).toBe('live');
		expect(classify(e('Some Movie', 'http://h/stream.m3u8', 'VOD NL'))).toBe('movie');
		expect(classify(e('Show S01E01', 'http://h/ep.mkv', 'Series'))).toBe('episode');
	});
	it('respects tvg-type', () => {
		expect(classify(e('X', 'http://h/x.mp4', undefined, -1, { 'tvg-type': 'live' }))).toBe('live');
		expect(classify(e('X', 'http://h/x', undefined, -1, { 'tvg-type': 'movie' }))).toBe('movie');
	});
});

const LIVE = `#EXTM3U url-tvg="http://epg.example/guide.xml.gz" x-tvg-url="http://epg2.example/a.xml"
#EXTINF:-1 tvg-id="npo1.nl" tvg-name="NPO 1" tvg-logo="http://logo/npo1.png" group-title="NL | Algemeen" tvg-language="Dutch" tvg-country="NL" tvg-chno="1" catchup-days="7",NL: NPO 1 HD
#EXTVLCOPT:http-user-agent=Foo
http://iptv.example/live/user/pass/101.ts
#EXTINF:-1 tvg-id="bbc1.uk" tvg-language="English;French",BBC One
#EXTGRP:UK
http://iptv.example/live/user/pass/102.m3u8
#EXTINF:-1,No Group Channel
http://iptv.example/live/user/pass/103.ts
`;

describe('parseM3U: live playlist', () => {
	const r = parseM3U(LIVE, SRC);
	it('reads header epg urls', () => {
		expect(r.epgUrls).toEqual(['http://epg.example/guide.xml.gz', 'http://epg2.example/a.xml']);
	});
	it('maps channels with all attributes', () => {
		expect(r.channels).toHaveLength(3);
		const [npo, bbc, nog] = r.channels;
		expect(npo).toMatchObject({
			kind: 'live',
			sourceId: 'm3u-test',
			rawName: 'NL: NPO 1 HD',
			tvgId: 'npo1.nl',
			tvgName: 'NPO 1',
			logoUrl: 'http://logo/npo1.png',
			group: 'NL | Algemeen',
			number: 1,
			langHint: 'nl',
			catchupDays: 7,
			url: 'http://iptv.example/live/user/pass/101.ts'
		});
		expect(npo.providerId).toBe(hashString(npo.url));
		expect(bbc.group).toBe('UK'); // from #EXTGRP
		expect(bbc.langHint).toBe('en');
		expect(nog.group).toBeUndefined();
		expect(r.movies).toHaveLength(0);
	});
	it('produces stable ids', () => {
		const again = parseM3U(LIVE, SRC);
		expect(again.channels.map((c) => c.providerId)).toEqual(r.channels.map((c) => c.providerId));
	});
});

const VOD = `#EXTM3U
#EXTINF:-1 tvg-id="" tvg-name="NL - De Matrix (1999)" tvg-logo="http://img/matrix.jpg" group-title="NL | Films",NL - De Matrix (1999)
http://srv.example:8080/movie/user/pass/5001.mkv
#EXTINF:-1 tvg-name="EN - The Matrix (1999) [4K]" tvg-logo="" group-title="EN | Movies 4K",EN - The Matrix (1999) [4K]
http://srv.example:8080/movie/user/pass/5002.mp4
#EXTINF:-1 tvg-logo="http://img/brug.jpg" group-title="NL | Series",De Brug S01E01
http://srv.example:8080/series/user/pass/7001.mkv
#EXTINF:-1 group-title="NL | Series",De Brug S01E02 De Val
http://srv.example:8080/series/user/pass/7002.mkv
#EXTINF:-1 group-title="NL | Series",De Brug S02E01
http://srv.example:8080/series/user/pass/7003.mkv
#EXTINF:-1 group-title="EN | Series",De Brug S01E01
http://srv.example:8080/series/user/pass/7101.mkv
`;

describe('parseM3U: Xtream-style VOD and series', () => {
	const r = parseM3U(VOD, SRC);
	it('detects movies with metadata hints', () => {
		expect(r.movies).toHaveLength(2);
		expect(r.movies[0]).toMatchObject({
			kind: 'movie',
			rawTitle: 'NL - De Matrix (1999)',
			category: 'NL | Films',
			year: 1999,
			posterUrl: 'http://img/matrix.jpg',
			containerExt: 'mkv'
		});
		expect(r.movies[1].posterUrl).toBeUndefined(); // empty tvg-logo
	});
	it('groups episodes per series name and group', () => {
		expect(r.series).toHaveLength(2);
		const nl = r.series.find((s) => s.category === 'NL | Series')!;
		expect(nl.rawTitle).toBe('De Brug');
		expect(nl.posterUrl).toBe('http://img/brug.jpg');
		expect(nl.episodes!.map((e) => [e.season, e.episode])).toEqual([
			[1, 1],
			[1, 2],
			[2, 1]
		]);
		expect(nl.episodes![1].title).toBe('De Val');
		expect(nl.episodes![0].containerExt).toBe('mkv');
		const en = r.series.find((s) => s.category === 'EN | Series')!;
		expect(en.providerId).not.toBe(nl.providerId);
	});
});

describe('parseM3U: robustness', () => {
	it('handles Windows line endings, BOM and a missing header', () => {
		const text =
			'﻿#EXTINF:-1 tvg-id="a",Chan A\r\nhttp://h/a.ts\r\n\r\n#EXTINF:-1,Film.mp4\r\nhttp://h/film.mp4\r\n';
		const r = parseM3U(text, SRC);
		expect(r.channels).toHaveLength(1);
		expect(r.channels[0].rawName).toBe('Chan A');
		expect(r.channels[0].url).toBe('http://h/a.ts');
		expect(r.movies).toHaveLength(1);
	});

	it('accepts bare url lines without #EXTINF', () => {
		const r = parseM3U('http://h/one.ts\nhttp://h/My%20Movie.mp4\n', SRC);
		expect(r.channels[0].rawName).toBe('one');
		expect(r.movies[0].rawTitle).toBe('My Movie');
	});

	it('skips junk lines and EXTINF without url', () => {
		const r = parseM3U(
			'#EXTM3U\n#EXTINF:-1,Orphan\n#EXTINF:-1,Real\nnot a url\n#EXTINF:-1,Real2\nhttp://h/r.ts',
			SRC
		);
		expect(r.channels.map((c) => c.rawName)).toEqual(['Real2']);
	});

	it('parses identically when fed in arbitrary chunks', () => {
		const p = new M3UParser(SRC);
		for (let i = 0; i < VOD.length; i += 7) p.push(VOD.slice(i, i + 7));
		const chunked = p.end();
		const whole = parseM3U(VOD, SRC);
		expect(chunked).toEqual(whole);
	});

	it('parses a byte stream', async () => {
		const bytes = new TextEncoder().encode(LIVE);
		const stream = new ReadableStream<Uint8Array>({
			start(c) {
				for (let i = 0; i < bytes.length; i += 50) c.enqueue(bytes.slice(i, i + 50));
				c.close();
			}
		});
		const r = await parseM3UStream(stream, SRC);
		expect(r.channels).toHaveLength(3);
		expect(r.channels[0].rawName).toBe('NL: NPO 1 HD');
	});

	it('recognises M3U content', () => {
		expect(looksLikeM3U('#EXTM3U\n')).toBe(true);
		expect(looksLikeM3U('﻿  #EXTM3U')).toBe(true);
		expect(looksLikeM3U('<html>')).toBe(false);
	});
});

describe('parseM3U: performance', () => {
	it('parses 100,000 entries in under 2 s', () => {
		const lines: string[] = ['#EXTM3U url-tvg="http://epg/x.xml"'];
		for (let i = 0; i < 100_000; i++) {
			const k = i % 4;
			if (k === 0)
				lines.push(
					`#EXTINF:-1 tvg-id="ch${i}.nl" tvg-name="Channel ${i}" tvg-logo="http://logo.example/${i}.png" group-title="NL | Group ${i % 50}" tvg-language="Dutch",NL: Channel ${i} HD`,
					`http://iptv.example:8080/live/user/pass/${i}.ts`
				);
			else if (k === 1)
				lines.push(
					`#EXTINF:-1 tvg-name="Movie ${i} (2001)" tvg-logo="http://img.example/${i}.jpg" group-title="EN | Movies",EN - Movie ${i} (2001) [FHD]`,
					`http://iptv.example:8080/movie/user/pass/${i}.mkv`
				);
			else
				lines.push(
					`#EXTINF:-1 tvg-logo="http://img.example/s${i % 500}.jpg" group-title="EN | Series",Show ${i % 500} S0${(i % 9) + 1}E${i % 30}`,
					`http://iptv.example:8080/series/user/pass/${i}.mp4`
				);
		}
		const text = lines.join('\n');
		const t0 = performance.now();
		const r = parseM3U(text, SRC);
		const ms = performance.now() - t0;
		expect(r.entryCount).toBe(100_000);
		expect(r.channels).toHaveLength(25_000);
		expect(r.movies).toHaveLength(25_000);
		expect(r.series).toHaveLength(250); // i % 500 with i % 4 in {2,3}
		expect(ms).toBeLessThan(2000);
	});
});
