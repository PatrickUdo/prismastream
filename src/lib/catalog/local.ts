// LocalProvider: the CatalogProvider on top of the catalog merged on this device
// (demo + local sources, #lib/stores/catalog.svelte.ts). Everything is in memory, so the
// "requests" are cheap; pagination uses an offset cursor so pages behave like remote mode.
import type { Channel, EpgProgramme, NowNext, Title, TitleCard } from '#lib/types.ts';
import { catalog } from '#lib/stores/catalog.svelte.ts';
import { isKidsChannel, isKidsTitle } from '#lib/stores/kids.svelte.ts';
import { user } from '#lib/stores/user.svelte.ts';
import { i18n } from '#lib/i18n/index.svelte.ts';
import {
	featured,
	genreCounts,
	languageCounts,
	popular,
	recent,
	recommend,
	similarTitles,
	trending
} from '#lib/recommend.ts';
import { searchIndexFor } from '#lib/search/index.ts';
import { displayTitle } from '#lib/components/titles.ts';
import type {
	CatalogProvider,
	Facets,
	HomeData,
	SearchView,
	TitleDetail,
	TitlePage,
	TitleQuery
} from './provider.ts';

const PAGE = 60;

async function loaded(): Promise<void> {
	void catalog.init();
	await catalog.whenLoaded();
}

function visibleTitles(kids: boolean): Title[] {
	return kids ? catalog.titles.filter(isKidsTitle) : catalog.titles;
}

function visibleChannels(kids: boolean): Channel[] {
	return kids ? catalog.channels.filter(isKidsChannel) : catalog.channels;
}

export class LocalProvider implements CatalogProvider {
	readonly kind = 'local' as const;

	async home(opts: { kids: boolean; limit?: number }): Promise<HomeData> {
		await loaded();
		const limit = opts.limit ?? 24;
		const titles = visibleTitles(opts.kids);
		return {
			featured: featured(titles, 5),
			recent: recent(titles, limit),
			popularMovies: popular(titles, 'movie', limit),
			trendingSeries: trending(titles, 'series', limit),
			genres: genreCounts(titles, 'movie')
				.slice(0, 16)
				.map((g) => ({ slug: g.genre, name: g.genre, count: g.count })),
			live: visibleChannels(opts.kids).slice(0, 200)
		};
	}

	async facets(opts: { kind?: 'movie' | 'series'; kids: boolean }): Promise<Facets> {
		await loaded();
		const base = visibleTitles(opts.kids).filter((t) => !opts.kind || t.kind === opts.kind);
		return {
			genres: genreCounts(base).map((g) => ({ slug: g.genre, name: g.genre, count: g.count })),
			languages: languageCounts(base).map((l) => ({ code: l.code, count: l.count }))
		};
	}

	async titles(q: TitleQuery): Promise<TitlePage> {
		await loaded();
		let list = visibleTitles(!!q.kids);
		if (q.kind) list = list.filter((t) => t.kind === q.kind);
		if (q.genre) list = list.filter((t) => t.genres.includes(q.genre!));
		if (q.lang) list = list.filter((t) => t.languages.includes(q.lang!));
		const collator = new Intl.Collator(i18n.locale, { sensitivity: 'base', numeric: true });
		const sorted = [...list];
		switch (q.sort ?? 'popular') {
			case 'new':
				sorted.sort((a, b) => b.addedAt - a.addedAt);
				break;
			case 'az':
				sorted.sort((a, b) => collator.compare(displayTitle(a), displayTitle(b)));
				break;
			case 'year':
				sorted.sort(
					(a, b) =>
						(b.year ?? 0) - (a.year ?? 0) || collator.compare(displayTitle(a), displayTitle(b))
				);
				break;
			default:
				sorted.sort((a, b) => b.popularity - a.popularity);
		}
		const offset = Math.max(0, Number(q.cursor) || 0);
		const limit = q.limit ?? PAGE;
		const items = sorted.slice(offset, offset + limit);
		const next = offset + items.length;
		return {
			items,
			total: sorted.length,
			nextCursor: next < sorted.length ? String(next) : undefined
		};
	}

	async cards(ids: string[], opts: { kids: boolean }): Promise<TitleCard[]> {
		await loaded();
		const out: TitleCard[] = [];
		const seen = new Set<string>();
		for (const id of ids) {
			const t = catalog.getTitle(id);
			if (!t || seen.has(id) || (opts.kids && !isKidsTitle(t))) continue;
			seen.add(id);
			out.push(t);
		}
		return out;
	}

	async title(id: string, opts: { similar?: boolean } = {}): Promise<TitleDetail | null> {
		await loaded();
		let t = catalog.getTitle(id);
		if (!t) return null;
		if (t.kind === 'series' && !t.seasons) {
			try {
				t = (await catalog.ensureSeasons(id)) ?? t;
			} catch {
				// Episodes could not be loaded: the page shows "no episodes".
			}
		}
		const kids = user.active?.isKids === true;
		return {
			...t,
			similar: opts.similar ? similarTitles(t, visibleTitles(kids), 18) : []
		};
	}

	async search(q: string, opts: { kids: boolean }): Promise<SearchView> {
		await loaded();
		const titles = visibleTitles(opts.kids);
		const channels = visibleChannels(opts.kids);
		const key = [
			catalog.catalog.builtAt,
			catalog.titles.length,
			catalog.channels.length,
			opts.kids ? 'kids' : 'all'
		].join(':');
		// Yield first so a large index never blocks the keystroke that triggered it.
		await new Promise((r) => setTimeout(r, 0));
		const r = searchIndexFor(key, titles, channels).search(q);
		return {
			query: r.query,
			total: r.total,
			movies: r.movies,
			series: r.series,
			people: r.people,
			channels: r.channels,
			genres: r.genres.map((g) => ({ ...g, slug: g.genre }))
		};
	}

	async recommend(input: {
		history: string[];
		favorites: string[];
		kids: boolean;
		limit?: number;
	}): Promise<TitleCard[]> {
		await loaded();
		const data = user.data;
		return recommend(
			visibleTitles(input.kids),
			{ favorites: data.favorites, history: data.history, progress: data.progress },
			input.limit ?? 24
		);
	}

	async channels(opts: { kids: boolean }): Promise<Channel[]> {
		await loaded();
		return visibleChannels(opts.kids);
	}

	async epg(epgIds: string[], from: number, to: number): Promise<Record<string, EpgProgramme[]>> {
		await loaded();
		const out: Record<string, EpgProgramme[]> = {};
		for (const id of epgIds) {
			const list = catalog.epg[id];
			if (list) out[id] = list.filter((p) => p.stop > from && p.start < to);
		}
		return out;
	}

	async nowNext(channelIds: string[]): Promise<Record<string, NowNext>> {
		await loaded();
		const out: Record<string, NowNext> = {};
		for (const id of channelIds) {
			const ch = catalog.getChannel(id);
			if (ch) out[id] = catalog.nowNext(ch);
		}
		return out;
	}
}
