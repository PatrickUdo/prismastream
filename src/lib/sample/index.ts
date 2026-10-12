// Built-in fictional demo library. Three demo "providers" deliver the same films and series
// in different languages, notations and qualities, so the merge engine has realistic chaos
// to work with. All titles, people and channels are invented; streams are public test HLS.
import type { RawCatalog, SampleSource } from '#lib/types.ts';
import { buildSampleCatalogs, SOURCE_IDS } from './build.ts';

export const SAMPLE_SOURCE: SampleSource = {
	id: 'sample',
	name: 'Demo-bibliotheek',
	type: 'sample',
	enabled: true,
	addedAt: 0
};

/** Extra demo sources that come along with SAMPLE_SOURCE (same 'sample' type). */
export const SAMPLE_EXTRA_SOURCES: SampleSource[] = [
	{ id: SOURCE_IDS.B, name: 'Demo World', type: 'sample', enabled: true, addedAt: 0 },
	{ id: SOURCE_IDS.C, name: 'Demo Plus', type: 'sample', enabled: true, addedAt: 0 }
];

export const SAMPLE_SOURCE_IDS: string[] = [
	SAMPLE_SOURCE.id,
	...SAMPLE_EXTRA_SOURCES.map((s) => s.id)
];

export const SAMPLE_SOURCE_NAMES: Record<string, string> = Object.fromEntries(
	[SAMPLE_SOURCE, ...SAMPLE_EXTRA_SOURCES].map((s) => [s.id, s.name])
);

export function isSampleSourceId(id: string): boolean {
	return SAMPLE_SOURCE_IDS.includes(id);
}

/** Every demo source (primary + extras) as raw catalogs. Use this for the 'sample' source type. */
export function sampleCatalogs(now = Date.now()): RawCatalog[] {
	return buildSampleCatalogs(now);
}

/** Only the primary demo source ('sample'). Prefer sampleCatalogs() for the full demo. */
export function sampleCatalog(now = Date.now()): RawCatalog {
	return buildSampleCatalogs(now)[0];
}

/** Only the extra demo sources (used by the catalog store when a caller only loaded the primary). */
export function sampleExtraCatalogs(now = Date.now()): RawCatalog[] {
	return buildSampleCatalogs(now).slice(1);
}
