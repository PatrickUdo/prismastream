// Season/episode merging: episodes from every source and language version are joined on
// (season, episode). Each Episode keeps the variants of all versions.
import type { Episode, LangCode, Quality, RawEpisode, Season, StreamVariant } from '#lib/types.ts';
import { isGenericEpisodeTitle, parseTitle } from './normalize.ts';

/** Episodes of one raw series (one source, one language version). */
export interface EpisodeSource {
	sourceId: string;
	audio: LangCode[];
	subs: LangCode[];
	quality: Quality;
	/** Clean series title (to recognise episode titles that just repeat it). */
	seriesTitle: string;
	episodes: RawEpisode[];
}

interface Acc {
	season: number;
	episode: number;
	title?: { text: string; rank: number };
	overview?: { text: string; rank: number };
	durations: number[];
	airDate?: string;
	stillUrl?: string;
	variants: Map<string, StreamVariant>;
}

function langRank(lang: LangCode | undefined, prefer: LangCode): number {
	if (lang === prefer) return 0;
	if (lang === 'en') return 1;
	return 2;
}

export function episodeFallbackTitle(episode: number, prefer: LangCode): string {
	return prefer === 'nl' ? `Aflevering ${episode}` : `Episode ${episode}`;
}

function pad(n: number): string {
	return String(n).padStart(2, '0');
}

/**
 * Merge episode lists into seasons. `existing` (already merged seasons) is kept and extended,
 * so lazily loaded sources can be added later with the same logic.
 */
export function mergeSeasons(
	titleId: string,
	sources: EpisodeSource[],
	prefer: LangCode,
	existing?: Season[]
): Season[] {
	const map = new Map<string, Acc>();
	const get = (season: number, episode: number): Acc => {
		const key = `${season}x${episode}`;
		let acc = map.get(key);
		if (!acc) {
			acc = { season, episode, durations: [], variants: new Map() };
			map.set(key, acc);
		}
		return acc;
	};

	for (const season of existing ?? []) {
		for (const ep of season.episodes) {
			const acc = get(ep.season, ep.episode);
			const generic = isGenericEpisodeTitle(ep.title);
			acc.title = { text: ep.title, rank: generic ? 9 : 0.5 };
			if (ep.overview) acc.overview = { text: ep.overview, rank: 0.5 };
			if (ep.runtimeMin) acc.durations.push(ep.runtimeMin * 60);
			acc.airDate = ep.airDate;
			acc.stillUrl = ep.stillUrl;
			for (const v of ep.variants) acc.variants.set(v.id, v);
		}
	}

	for (const src of sources) {
		for (const ep of src.episodes) {
			if (!Number.isFinite(ep.season) || !Number.isFinite(ep.episode)) continue;
			const acc = get(ep.season, ep.episode);
			let audio = src.audio;
			let quality = src.quality;
			let text: string | undefined;
			if (ep.title) {
				const p = parseTitle(ep.title);
				if (p.langs.length) audio = p.langs;
				if (p.quality !== 'unknown') quality = p.quality;
				text = p.season !== undefined ? p.episodeTitle : p.cleanTitle;
			}
			const generic = isGenericEpisodeTitle(text, src.seriesTitle);
			const lang = audio[0];
			if (text && !generic) {
				const rank = langRank(lang, prefer);
				if (!acc.title || rank < acc.title.rank) acc.title = { text, rank };
			}
			if (ep.plot) {
				const rank = langRank(lang, prefer);
				if (
					!acc.overview ||
					rank < acc.overview.rank ||
					(rank === acc.overview.rank && ep.plot.length > acc.overview.text.length)
				)
					acc.overview = { text: ep.plot, rank };
			}
			if (ep.durationSec) acc.durations.push(ep.durationSec);
			if (ep.airDate && (!acc.airDate || ep.airDate < acc.airDate)) acc.airDate = ep.airDate;
			acc.stillUrl ??= ep.stillUrl;
			const id = `${src.sourceId}:${ep.providerId}`;
			if (!acc.variants.has(id)) {
				acc.variants.set(id, {
					id,
					sourceId: src.sourceId,
					url: ep.url,
					audioLangs: audio,
					subtitleLangs: src.subs,
					quality,
					label: ep.title || `${src.seriesTitle} S${pad(ep.season)}E${pad(ep.episode)}`,
					containerExt: ep.containerExt
				});
			}
		}
	}

	const seasons = new Map<number, Episode[]>();
	for (const acc of map.values()) {
		const durations = acc.durations.sort((a, b) => a - b);
		const median = durations.length ? durations[Math.floor(durations.length / 2)] : undefined;
		const episode: Episode = {
			id: `${titleId}/s${acc.season}e${acc.episode}`,
			season: acc.season,
			episode: acc.episode,
			title:
				acc.title && acc.title.rank < 9
					? acc.title.text
					: episodeFallbackTitle(acc.episode, prefer),
			overview: acc.overview?.text,
			runtimeMin: median ? Math.round(median / 60) : undefined,
			stillUrl: acc.stillUrl,
			airDate: acc.airDate,
			variants: [...acc.variants.values()]
		};
		const list = seasons.get(acc.season);
		if (list) list.push(episode);
		else seasons.set(acc.season, [episode]);
	}
	return [...seasons.entries()]
		.sort((a, b) => a[0] - b[0])
		.map(([number, episodes]) => ({
			number,
			episodes: episodes.sort((a, b) => a.episode - b.episode)
		}));
}
