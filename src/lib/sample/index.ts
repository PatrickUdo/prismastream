// Built-in fictional demo library. Three demo "providers" deliver the same films and series
// in different languages, notations and qualities, so the merge engine has realistic chaos
// to work with. All titles, people and channels are invented; streams are public test HLS.
import type { RawCatalog } from '#lib/types.ts';
import { buildSampleCatalogs } from './build.ts';

export {
	SAMPLE_SOURCE,
	SAMPLE_EXTRA_SOURCES,
	SAMPLE_SOURCE_IDS,
	SAMPLE_SOURCE_NAMES,
	isSampleSourceId
} from './meta.ts';

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
