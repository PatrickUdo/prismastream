// Credential masking for cached catalogs.
//
// Xtream stream urls (and Xtream-style M3U urls) embed the username and password:
//   http://host/movie/USER/PASS/123.mkv
// The IndexedDB cache must not contain them in clear text. Before writing, every url
// field is rewritten with placeholders (U+E000 <index> U+E000, a private-use character) for the source's secrets;
// after reading, the placeholders are replaced with the current secrets from secure
// storage. This is a single-pass, exact inverse (placeholders are never re-scanned and
// cannot occur in real urls), and it is cheap enough for 100k+ items.
import type { RawCatalog, RawEpisode, RawSeries } from '#lib/types.ts';

export interface Masker {
	mask(s: string): string;
	unmask(s: string): string;
	/** True if there is nothing to mask (masking is the identity). */
	readonly noop: boolean;
}

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build a masker for the given secrets. The ORDER of `secrets` defines the
 * placeholder indices, so callers must pass them in a stable order
 * (e.g. [password, username, ...extracted]); encoded variants are added automatically.
 */
export function createMasker(secrets: (string | undefined | null)[]): Masker {
	const values: string[] = [];
	for (const s of secrets) {
		if (!s) continue;
		values.push(s);
		const enc = encodeURIComponent(s);
		values.push(enc !== s ? enc : '');
	}
	const indexed = values.map((v, i) => [v, i] as const).filter(([v]) => v.length > 0);
	if (!indexed.length) return { mask: (s) => s, unmask: (s) => s, noop: true };
	const lookup = new Map<string, number>();
	for (const [v, i] of indexed) if (!lookup.has(v)) lookup.set(v, i);
	const re = new RegExp(
		[...lookup.keys()]
			.sort((a, b) => b.length - a.length)
			.map(escapeRegExp)
			.join('|'),
		'g'
	);
	const back = /\uE000(\d+)\uE000/g;
	return {
		noop: false,
		mask: (s) => (s ? s.replace(re, (m) => `\uE000${lookup.get(m)}\uE000`) : s),
		unmask: (s) =>
			s && s.includes('\uE000') ? s.replace(back, (_, i) => values[Number(i)] ?? '') : s
	};
}

type Fn = (s: string) => string;

function mapEpisodes(eps: RawEpisode[] | undefined, f: Fn): RawEpisode[] | undefined {
	if (!eps) return eps;
	return eps.map((e) => ({ ...e, url: f(e.url), stillUrl: e.stillUrl && f(e.stillUrl) }));
}

export function mapSeriesUrls(s: RawSeries, f: Fn): RawSeries {
	return {
		...s,
		posterUrl: s.posterUrl && f(s.posterUrl),
		backdropUrl: s.backdropUrl && f(s.backdropUrl),
		episodes: mapEpisodes(s.episodes, f)
	};
}

/** Apply `f` to every url-like field of a catalog (returns a new object). */
export function mapCatalogUrls<T extends Pick<RawCatalog, 'movies' | 'series' | 'channels'>>(
	cat: T,
	f: Fn
): T {
	return {
		...cat,
		movies: cat.movies.map((m) => ({
			...m,
			url: f(m.url),
			posterUrl: m.posterUrl && f(m.posterUrl),
			backdropUrl: m.backdropUrl && f(m.backdropUrl)
		})),
		series: cat.series.map((s) => mapSeriesUrls(s, f)),
		channels: cat.channels.map((c) => ({ ...c, url: f(c.url), logoUrl: c.logoUrl && f(c.logoUrl) }))
	};
}

export function maskEpisodes(eps: RawEpisode[], m: Masker): RawEpisode[] {
	return m.noop ? eps : (mapEpisodes(eps, m.mask) ?? []);
}
export function unmaskEpisodes(eps: RawEpisode[], m: Masker): RawEpisode[] {
	return m.noop ? eps : (mapEpisodes(eps, m.unmask) ?? []);
}
