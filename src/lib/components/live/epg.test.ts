import { describe, expect, it } from 'vitest';
import type { Channel, EpgProgramme, StreamVariant } from '#lib/types.ts';
import {
	HOUR,
	MINUTE,
	addDays,
	ceilHalfHour,
	epgBounds,
	fillGaps,
	filterChannels,
	floorHalfHour,
	fold,
	formatDay,
	formatTime,
	formatTimeRange,
	groupCounts,
	groupVariantsByLanguage,
	guideRange,
	halfHourTicks,
	languageCounts,
	nowNext,
	programmeAt,
	programmesInWindow,
	progressAt,
	searchProgrammes,
	slotIndexAt,
	sourceCount,
	visibleRows
} from './epg.ts';

// Local 9 October 2026, 20:00.
const T0 = new Date(2026, 9, 9, 20, 0).getTime();
const at = (h: number, m = 0) => T0 + (h - 20) * HOUR + m * MINUTE;

function prog(channelId: string, start: number, stop: number, title: string): EpgProgramme {
	return { channelId, start, stop, title };
}

const list: EpgProgramme[] = [
	prog('a', at(19), at(20), 'Journaal'),
	prog('a', at(20), at(21, 30), 'Film: De Óverval'),
	prog('a', at(21, 30), at(22), 'Sport'),
	// gap 22:00 – 23:00
	prog('a', at(23), at(24), 'Nachtprogramma')
];

function channel(p: Partial<Channel> & { id: string }): Channel {
	return { name: p.id, group: 'Overig', languages: [], variants: [], ...p };
}

function variant(id: string, sourceId: string, lang: string, quality: StreamVariant['quality']) {
	return {
		id,
		sourceId,
		url: `https://example.test/${id}.m3u8`,
		audioLangs: [lang],
		subtitleLangs: [],
		quality,
		label: id
	} satisfies StreamVariant;
}

describe('window and now/next', () => {
	it('returns programmes overlapping a window', () => {
		expect(programmesInWindow(list, at(20, 15), at(21, 45)).map((p) => p.title)).toEqual([
			'Film: De Óverval',
			'Sport'
		]);
		expect(programmesInWindow(list, at(22), at(23))).toEqual([]);
		expect(programmesInWindow([], at(0), at(1))).toEqual([]);
	});

	it('finds the current and next programme', () => {
		expect(programmeAt(list, at(20, 45))?.title).toBe('Film: De Óverval');
		expect(programmeAt(list, at(22, 30))).toBeUndefined();
		expect(nowNext(list, at(20)).now?.title).toBe('Film: De Óverval');
		expect(nowNext(list, at(20)).next?.title).toBe('Sport');
		expect(nowNext(list, at(22, 30))).toEqual({ next: list[3] });
		expect(nowNext(list, at(25))).toEqual({});
	});

	it('computes progress, clamped to 0..1', () => {
		const p = list[1];
		expect(progressAt(p, at(20, 45))).toBeCloseTo(0.5);
		expect(progressAt(p, at(19))).toBe(0);
		expect(progressAt(p, at(23))).toBe(1);
		expect(progressAt({ start: 5, stop: 5 }, 4)).toBe(0);
	});
});

describe('fillGaps', () => {
	it('fills holes and the edges with "no information" slots', () => {
		const slots = fillGaps(list, at(21), at(23, 30));
		expect(slots.map((s) => [s.programme?.title ?? '-', s.start, s.stop])).toEqual([
			['Film: De Óverval', at(20), at(21, 30)],
			['Sport', at(21, 30), at(22)],
			['-', at(22), at(23)],
			['Nachtprogramma', at(23), at(24)]
		]);
	});

	it('covers a channel without EPG with aligned, window-independent pieces', () => {
		const a = fillGaps([], at(20, 10), at(23, 50), { split: HOUR });
		expect(a.length).toBe(4);
		expect(a[0].start).toBe(at(20, 10));
		expect(a[a.length - 1].stop).toBe(at(23, 50));
		for (let i = 1; i < a.length; i++) expect(a[i].start).toBe(a[i - 1].stop);
		// Scrolling the window keeps the keys of the pieces that stay visible.
		const b = fillGaps([], at(21, 20), at(24, 40), { split: HOUR });
		const shared = a.filter((s) => b.some((x) => x.key === s.key));
		expect(shared.length).toBeGreaterThanOrEqual(2);
		expect(new Set(a.map((s) => s.key)).size).toBe(a.length);
	});

	it('ignores tiny holes and returns nothing for an empty window', () => {
		const tight = [prog('x', at(20), at(20, 30), 'A'), prog('x', at(20, 30), at(21), 'B')];
		tight[1] = { ...tight[1], start: tight[1].start + 20_000 };
		expect(fillGaps(tight, at(20), at(21)).filter((s) => !s.programme)).toEqual([]);
		expect(fillGaps(list, at(21), at(21))).toEqual([]);
	});

	it('locates the slot at a time', () => {
		const slots = fillGaps(list, at(19), at(24));
		expect(slots[slotIndexAt(slots, at(22, 15))].programme).toBeUndefined();
		expect(slots[slotIndexAt(slots, at(21, 40))].programme?.title).toBe('Sport');
		expect(slotIndexAt([], at(20))).toBe(-1);
	});
});

describe('time', () => {
	it('aligns to half hours and builds ticks', () => {
		expect(floorHalfHour(at(20, 44))).toBe(at(20, 30));
		expect(ceilHalfHour(at(20, 44))).toBe(at(21));
		expect(ceilHalfHour(at(21))).toBe(at(21));
		expect(halfHourTicks(at(20, 10), at(21, 30))).toEqual([at(20, 30), at(21), at(21, 30)]);
	});

	it('derives the guide range from the EPG and now', () => {
		const bounds = epgBounds([list, []]);
		expect(bounds).toEqual({ start: at(19), stop: at(24) });
		expect(epgBounds([[], []])).toBeNull();
		const r = guideRange(bounds, at(20, 10));
		expect(r.from).toBe(at(18));
		expect(r.to).toBe(at(26, 30));
		const empty = guideRange(null, at(20, 10), { before: HOUR, after: 2 * HOUR });
		expect(empty).toEqual({ from: at(19), to: at(22, 30) });
	});

	it('formats 24-hour times in Dutch and English', () => {
		expect(formatTime(at(21, 30), 'nl')).toBe('21:30');
		expect(formatTime(at(9, 5), 'nl')).toBe('09:05');
		expect(formatTime(at(21, 30), 'en')).toBe('21:30');
		expect(formatTimeRange(at(20), at(21, 30), 'nl')).toBe('20:00 – 21:30');
	});

	it('labels days relative to today', () => {
		expect(formatDay(at(23), T0, 'nl')).toBe('Vandaag');
		expect(formatDay(addDays(T0, 1), T0, 'nl')).toBe('Morgen');
		expect(formatDay(addDays(T0, -1), T0, 'en')).toBe('Yesterday');
		expect(formatDay(addDays(T0, 3), T0, 'nl')).toMatch(/^Ma 12 okt/);
	});
});

describe('search and filters', () => {
	const epg = { 'a.nl': list };
	const channels = [
		channel({
			id: 'a',
			name: 'Prisma Één',
			number: 1,
			epgId: 'a.nl',
			group: 'Films',
			languages: ['nl']
		}),
		channel({ id: 'b', name: 'Globe 24', number: 20, group: 'Nieuws', languages: ['en', 'und'] }),
		channel({ id: 'c', name: 'Arena', group: 'Films', languages: ['en', 'nl'] })
	];

	it('folds case and diacritics', () => {
		expect(fold('  Één  Overval ')).toBe('een overval');
	});

	it('filters channels on name, number and the current programme', () => {
		expect(filterChannels(channels, 'prisma een', epg, at(20)).map((c) => c.id)).toEqual(['a']);
		expect(filterChannels(channels, 'OVERVAL', epg, at(20, 30)).map((c) => c.id)).toEqual(['a']);
		expect(filterChannels(channels, 'overval', epg, at(21, 45))).toEqual([]);
		expect(filterChannels(channels, '20', epg, at(20)).map((c) => c.id)).toEqual(['b']);
		expect(filterChannels(channels, '  ', epg, at(20)).length).toBe(3);
	});

	it('searches programmes in a window', () => {
		const hits = searchProgrammes(channels, epg, 'sport', at(18), at(24));
		expect(hits.map((h) => [h.channel.id, h.programme.title])).toEqual([['a', 'Sport']]);
		expect(searchProgrammes(channels, epg, '', at(18), at(24))).toEqual([]);
	});

	it('counts groups and languages', () => {
		expect(groupCounts(channels)).toEqual([
			{ group: 'Films', count: 2 },
			{ group: 'Nieuws', count: 1 }
		]);
		expect(languageCounts(channels)).toEqual([
			{ lang: 'en', count: 2 },
			{ lang: 'nl', count: 2 }
		]);
	});
});

describe('variants', () => {
	const variants = [
		variant('s1:1', 's1', 'en', 'HD'),
		variant('s2:7', 's2', 'nl', 'SD'),
		variant('s3:9', 's3', 'nl', '4K'),
		variant('s1:2', 's1', 'und', 'FHD')
	];

	it('groups by language, preferred first, best quality first', () => {
		const groups = groupVariantsByLanguage(variants, ['nl']);
		expect(groups.map((g) => g.lang)).toEqual(['nl', 'en', 'und']);
		expect(groups[0].variants.map((v) => v.id)).toEqual(['s3:9', 's2:7']);
	});

	it('counts distinct sources', () => {
		expect(sourceCount({ variants })).toBe(3);
		expect(sourceCount({ variants: [] })).toBe(0);
	});
});

describe('visibleRows', () => {
	it('returns the visible rows plus overscan, clamped', () => {
		expect(visibleRows(0, 400, 80, 500, 2)).toEqual({ start: 0, end: 7 });
		expect(visibleRows(8000, 400, 80, 500, 2)).toEqual({ start: 98, end: 107 });
		expect(visibleRows(1e9, 400, 80, 500, 2)).toEqual({ start: 500, end: 500 });
		expect(visibleRows(0, 400, 80, 0)).toEqual({ start: 0, end: 0 });
	});
});
