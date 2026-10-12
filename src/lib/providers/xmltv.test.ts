import { describe, expect, it } from 'vitest';
import { gzipSync } from 'node:zlib';
import { isGzip, parseXmltv, parseXmltvTime } from '#lib/providers/xmltv.ts';

describe('parseXmltvTime', () => {
	it('handles offsets', () => {
		expect(parseXmltvTime('20240101120000 +0100')).toBe(Date.UTC(2024, 0, 1, 11, 0, 0));
		expect(parseXmltvTime('20240101120000 -0500')).toBe(Date.UTC(2024, 0, 1, 17, 0, 0));
		expect(parseXmltvTime('20240101120000+0530')).toBe(Date.UTC(2024, 0, 1, 6, 30, 0));
		expect(parseXmltvTime('20240101120000 +01:00')).toBe(Date.UTC(2024, 0, 1, 11, 0, 0));
	});
	it('treats a missing offset or Z as UTC, and accepts minutes precision', () => {
		expect(parseXmltvTime('20240101120000')).toBe(Date.UTC(2024, 0, 1, 12, 0, 0));
		expect(parseXmltvTime('20240101120000 Z')).toBe(Date.UTC(2024, 0, 1, 12, 0, 0));
		expect(parseXmltvTime('202401011230')).toBe(Date.UTC(2024, 0, 1, 12, 30, 0));
	});
	it('rejects garbage', () => {
		expect(parseXmltvTime('')).toBeNaN();
		expect(parseXmltvTime('2024-01-01')).toBeNaN();
		expect(parseXmltvTime(undefined)).toBeNaN();
	});
});

const BASE = Date.UTC(2024, 5, 1, 12, 0, 0); // 2024-06-01 12:00 UTC
const fmt = (ms: number, tz = '+0000') => {
	const d = new Date(ms);
	const p = (n: number) => String(n).padStart(2, '0');
	return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}00 ${tz}`;
};
const H = 3600_000;

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE tv SYSTEM "xmltv.dtd">
<tv generator-info-name="test">
  <channel id="npo1.nl"><display-name lang="nl">NPO 1</display-name><icon src="http://logo/npo1.png"/></channel>
  <channel id="bbc1.uk"><display-name>BBC One</display-name></channel>
  <programme start="${fmt(BASE - 10 * H)}" stop="${fmt(BASE - 9 * H)}" channel="npo1.nl"><title>Too old</title></programme>
  <programme start="${fmt(BASE - H)}" stop="${fmt(BASE)}" channel="npo1.nl">
    <title lang="nl">Journaal &amp; Weer</title><title lang="en">News</title>
    <desc lang="nl"><![CDATA[Het <b>nieuws</b>.]]></desc>
    <category lang="nl">Nieuws</category><category>News</category>
    <icon src="http://img/journaal.jpg"/>
  </programme>
  <programme start="${fmt(BASE + H, '+0200')}" stop="${fmt(BASE + 2 * H, '+0200')}" channel="npo1.nl"><title>Met tijdzone</title></programme>
  <programme start="${fmt(BASE)}" stop="${fmt(BASE + H)}" channel="bbc1.uk"><title>EastEnders</title></programme>
  <programme start="${fmt(BASE + 72 * H)}" stop="${fmt(BASE + 73 * H)}" channel="bbc1.uk"><title>Too far</title></programme>
  <programme start="${fmt(BASE)}" channel="other"><title>No stop</title></programme>
  <programme start="${fmt(BASE)}" stop="${fmt(BASE + H)}" channel="npo1.nl"><title>Broken &nbsp; entity</title></programme>
</tv>`;

const window = { from: BASE - 6 * H, to: BASE + 48 * H };

describe('parseXmltv', () => {
	it('parses programmes, channels, entities, CDATA and timezones within the window', async () => {
		const r = await parseXmltv(XML, window);
		expect(r.channels).toEqual([
			{ id: 'npo1.nl', displayName: 'NPO 1', icon: 'http://logo/npo1.png' },
			{ id: 'bbc1.uk', displayName: 'BBC One' }
		]);
		const titles = r.programmes.map((p) => p.title);
		expect(titles).not.toContain('Too old');
		expect(titles).not.toContain('Too far');
		const journaal = r.programmes.find((p) => p.title === 'Journaal & Weer')!;
		expect(journaal).toMatchObject({
			channelId: 'npo1.nl',
			start: BASE - H,
			stop: BASE,
			desc: 'Het <b>nieuws</b>.',
			category: 'Nieuws',
			icon: 'http://img/journaal.jpg'
		});
		const tz = r.programmes.find((p) => p.title === 'Met tijdzone')!;
		expect(tz.start).toBe(BASE + H - 2 * H);
		const noStop = r.programmes.find((p) => p.channelId === 'other')!;
		expect(noStop.stop - noStop.start).toBe(H);
		// sorted by channel, then start
		const npo = r.programmes.filter((p) => p.channelId === 'npo1.nl').map((p) => p.start);
		expect(npo).toEqual([...npo].sort((a, b) => a - b));
	});

	it('survives malformed entities', async () => {
		const r = await parseXmltv(XML, window);
		expect(r.errors).toBeGreaterThan(0);
		expect(r.programmes.some((p) => p.title.startsWith('Broken'))).toBe(true);
	});

	it('filters on channel ids', async () => {
		const r = await parseXmltv(XML, { ...window, channelIds: new Set(['bbc1.uk']) });
		expect(r.programmes.map((p) => p.title)).toEqual(['EastEnders']);
	});

	it('parses a chunked byte stream identically', async () => {
		const bytes = new TextEncoder().encode(XML);
		const stream = new ReadableStream<Uint8Array>({
			start(c) {
				for (let i = 0; i < bytes.length; i += 33) c.enqueue(bytes.slice(i, i + 33));
				c.close();
			}
		});
		let seen = 0;
		const a = await parseXmltv(stream, { ...window, onBytes: (n) => (seen = n) });
		const b = await parseXmltv(XML, window);
		expect(a.programmes).toEqual(b.programmes);
		expect(seen).toBe(bytes.byteLength);
	});

	it.runIf(typeof DecompressionStream !== 'undefined')('decompresses .xml.gz', async () => {
		const gz = new Uint8Array(gzipSync(Buffer.from(XML, 'utf-8')));
		expect(isGzip(gz)).toBe(true);
		const stream = new ReadableStream<Uint8Array>({
			start(c) {
				for (let i = 0; i < gz.length; i += 100) c.enqueue(gz.slice(i, i + 100));
				c.close();
			}
		});
		const r = await parseXmltv(stream, window);
		const plain = await parseXmltv(XML, window);
		expect(r.programmes).toEqual(plain.programmes);
	});

	it('handles a large guide quickly', async () => {
		const parts = ['<tv>'];
		for (let c = 0; c < 200; c++) {
			parts.push(`<channel id="c${c}"><display-name>C${c}</display-name></channel>`);
			for (let i = 0; i < 100; i++) {
				const s = BASE + (i - 50) * H;
				parts.push(
					`<programme start="${fmt(s)}" stop="${fmt(s + H)}" channel="c${c}"><title>P ${i}</title><desc>Description ${i}</desc></programme>`
				);
			}
		}
		parts.push('</tv>');
		const t0 = performance.now();
		const r = await parseXmltv(parts.join('\n'), { ...window, channelIds: new Set(['c1', 'c2']) });
		expect(performance.now() - t0).toBeLessThan(3000);
		expect(r.channels).toHaveLength(200);
		// 2 channels × programmes overlapping [-6h, +48h): i = 44..97 → 54 each
		expect(r.programmes).toHaveLength(2 * 54);
	});
});
