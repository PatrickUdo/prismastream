// Demo source descriptors without the demo data, so app code can recognise demo sources
// without bundling the fictional library (that is loaded through a dynamic import, see
// #lib/demo.ts and ./index.ts).
import type { SampleSource } from '#lib/types.ts';

export const SAMPLE_SOURCE: SampleSource = {
	id: 'sample',
	name: 'Demo-bibliotheek',
	type: 'sample',
	enabled: true,
	addedAt: 0
};

/** Extra demo sources that come along with SAMPLE_SOURCE (same 'sample' type). */
export const SAMPLE_EXTRA_SOURCES: SampleSource[] = [
	{ id: 'sample-world', name: 'Demo World', type: 'sample', enabled: true, addedAt: 0 },
	{ id: 'sample-plus', name: 'Demo Plus', type: 'sample', enabled: true, addedAt: 0 }
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
