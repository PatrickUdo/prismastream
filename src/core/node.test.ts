// The Node core (src/core/node.ts → server/vendor/prisma-core.mjs) and its hand-written type
// declarations (server/vendor/prisma-core.d.mts) must export the same names.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from './node.ts';
import type { Title } from '#lib/types.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('core/node', () => {
	it('every runtime export is declared in server/vendor/prisma-core.d.mts', () => {
		const dts = readFileSync(path.join(root, 'server/vendor/prisma-core.d.mts'), 'utf8');
		const declared = new Set(
			[...dts.matchAll(/^export (?:declare )?(?:function|const|class) (\w+)/gm)].map((m) => m[1])
		);
		const missing = Object.keys(core).filter((k) => !declared.has(k));
		expect(missing).toEqual([]);
		const extra = [...declared].filter((k) => !(k in core));
		expect(extra).toEqual([]);
	});

	it('builds the demo catalog and light cards', () => {
		const catalog = core.buildCatalog(core.sampleCatalogs(Date.UTC(2026, 0, 1)));
		expect(catalog.titles.length).toBeGreaterThan(20);
		const series = catalog.titles.find((t) => t.kind === 'series' && t.seasons?.length)!;
		const card = core.toTitleCard(series) as Record<string, unknown>;
		expect(card.variants).toBeUndefined();
		expect(card.seasons).toBeUndefined();
		expect(card.seasonCount).toBe(series.seasons!.length);
		expect((card.altTitles as unknown[]).length).toBeLessThanOrEqual(12);
		expect(Object.values(card).includes(undefined)).toBe(false);
		const ch = core.toChannelCard(catalog.channels[0]) as Record<string, unknown>;
		expect(ch.variants).toBeUndefined();
		expect(ch.variantCount).toBe(catalog.channels[0].variants.length);
	});

	it('kids channel groups follow the kids-mode rule', () => {
		expect(core.isKidsChannelGroup('NL | Kinderen')).toBe(true);
		expect(core.isKidsChannelGroup('Animation')).toBe(true);
		expect(core.isKidsChannelGroup('Çocuk')).toBe(true);
		expect(core.isKidsChannelGroup('Sport')).toBe(false);
		expect(core.isKidsChannelGroup('Kindred Spirits')).toBe(false);
	});

	it('mergeSeriesEpisodes adds lazily loaded seasons and fills metadata', () => {
		const t: Title = {
			id: 'k-series-x',
			kind: 'series',
			title: 'X',
			altTitles: [],
			genres: [],
			cast: [],
			addedAt: 1,
			popularity: 1,
			variants: [],
			languages: ['nl'],
			subtitleLanguages: [],
			qualities: ['HD'],
			sourceIds: ['s'],
			rawRefs: [{ sourceId: 's', providerId: '1', langs: ['nl'] }]
		};
		const merged = core.mergeSeriesEpisodes(t, [
			{
				sourceId: 's',
				audio: ['nl'],
				subs: [],
				quality: 'HD',
				seriesTitle: 'X',
				info: { plot: 'Plot', genres: ['Drama'], cast: ['A B'] },
				episodes: [
					{ providerId: '11', season: 1, episode: 1, url: 'http://h/series/u/p/11.mp4' },
					{ providerId: '12', season: 1, episode: 2, url: 'http://h/series/u/p/12.mp4' }
				]
			}
		]);
		expect(merged.seasons?.[0].episodes.length).toBe(2);
		expect(merged.overview).toBe('Plot');
		expect(merged.genres).toEqual(['Drama']);
		expect(merged.cast[0].name).toBe('A B');
	});
});
