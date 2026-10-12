// Catalog store: loads raw catalogs from all sources, merges them, exposes lookups.
// Owned by the merge engine (Phase 3); the API below is the contract for the UI:
//   catalog.titles, catalog.channels, getTitle(id), getChannel(id), refresh({ force }),
//   ensureSeasons(id), nowNext(channel), status, error
// plus byGenre(genre), genres, genresFor(kind), refreshing, enriching.
// Searching lives in #lib/search (index per catalog, built by the search page).
//
// init(): shows the cached merged catalog (IndexedDB) right away, then refreshes in the
// background. TMDB enrichment (optional API key) runs afterwards in batches and triggers
// a rebuild so translated titles merge on their tmdb id.
import type {
	Catalog,
	Channel,
	EpgProgramme,
	LangCode,
	RawCatalog,
	RawEpisode,
	RawSeries,
	Title
} from '#lib/types.ts';
import {
	analyzeRaw,
	mergeSeasons,
	normalizeGenres,
	withSeasons,
	type BuildOptions
} from '#lib/merge/index.ts';
import { buildCatalogAsync } from '#lib/merge/run.ts';
import type { EpisodeSource } from '#lib/merge/series.ts';
import { loadRawCatalogs, loadSeriesInfo, sourceNames } from '#lib/sources/index.svelte.ts';
import {
	SAMPLE_EXTRA_SOURCES,
	SAMPLE_SOURCE,
	SAMPLE_SOURCE_NAMES,
	isSampleSourceId,
	sampleExtraCatalogs
} from '#lib/sample/index.ts';
import { user } from '#lib/stores/user.svelte.ts';
import { i18n } from '#lib/i18n/index.svelte.ts';
import type { TmdbIndex } from '#lib/tmdb/types.ts';

const EMPTY: Catalog = { titles: [], channels: [], epg: {}, builtAt: 0 };
const CACHE_KEY = 'catalog:built:v1';

type IdbModule = typeof import('idb-keyval');
let idbPromise: Promise<{ mod: IdbModule; store: ReturnType<IdbModule['createStore']> }> | null =
	null;
function idb() {
	idbPromise ??= import('idb-keyval').then((mod) => ({
		mod,
		store: mod.createStore('ps-catalog', 'kv')
	}));
	return idbPromise;
}
async function cacheGet<T>(key: string): Promise<T | undefined> {
	if (typeof indexedDB === 'undefined') return undefined;
	try {
		const { mod, store } = await idb();
		return (await mod.get(key, store)) as T | undefined;
	} catch {
		return undefined;
	}
}
async function cacheSet(key: string, value: unknown): Promise<void> {
	if (typeof indexedDB === 'undefined') return;
	try {
		const { mod, store } = await idb();
		await mod.set(key, value, store);
	} catch {
		// quota / private mode: the cache is only an optimisation
	}
}

/**
 * The demo source delivers three catalogs (three fictional providers). If the sources module
 * only loaded the primary one, add the others so the demo shows real merging.
 */
function withSampleExtras(raws: RawCatalog[]): RawCatalog[] {
	const primary = raws.find((r) => r.sourceId === SAMPLE_SOURCE.id);
	if (!primary) return raws;
	const have = new Set(raws.map((r) => r.sourceId));
	if (SAMPLE_EXTRA_SOURCES.every((s) => have.has(s.id))) return raws;
	return [...raws, ...sampleExtraCatalogs(primary.fetchedAt).filter((c) => !have.has(c.sourceId))];
}

function refKey(sourceId: string, providerId: string): string {
	return `${sourceId}:${providerId}`;
}

class CatalogStore {
	catalog = $state.raw<Catalog>(EMPTY);
	status = $state<'idle' | 'loading' | 'ready' | 'error'>('idle');
	error = $state<string | null>(null);
	/** True while a background refresh runs (the current catalog stays visible). */
	refreshing = $state(false);
	/** True while TMDB enrichment runs. */
	enriching = $state(false);

	#titleIndex = $derived(new Map(this.catalog.titles.map((t) => [t.id, t])));
	#channelIndex = $derived(new Map(this.catalog.channels.map((c) => [c.id, c])));
	#genreCounts = $derived.by(() => countGenres(this.catalog.titles));

	#raws: RawCatalog[] = [];
	#tmdb: TmdbIndex | undefined;
	/** Lazily loaded episodes per raw series, re-used by every rebuild. */
	#episodes = new Map<string, RawEpisode[]>();
	#seasonJobs = new Map<string, Promise<Title | undefined>>();
	#refreshJob: Promise<void> | null = null;
	#buildSeq = 0;
	#enrichAbort: AbortController | null = null;
	#subscribed = false;

	get titles(): Title[] {
		return this.catalog.titles;
	}
	get channels(): Channel[] {
		return this.catalog.channels;
	}
	get epg(): Record<string, EpgProgramme[]> {
		return this.catalog.epg;
	}

	getTitle(id: string): Title | undefined {
		return this.#titleIndex.get(id);
	}
	getChannel(id: string): Channel | undefined {
		return this.#channelIndex.get(id);
	}

	/** Show the cached catalog immediately, then refresh in the background. */
	async init() {
		if (this.status !== 'idle') return;
		this.status = 'loading';
		if (!this.#subscribed) {
			this.#subscribed = true;
			user.onChange((c) => {
				if (c === 'settings' && user.settings.tmdbApiKey && this.#raws.length) void this.#enrich();
			});
		}
		const [cached, tmdb] = await Promise.all([
			cacheGet<Catalog>(CACHE_KEY),
			import('#lib/tmdb/index.ts').then((m) => m.loadTmdbIndex()).catch(() => undefined)
		]);
		this.#tmdb = tmdb && Object.keys(tmdb.byKey).length ? tmdb : undefined;
		if (cached?.titles?.length && this.catalog.builtAt === 0) {
			this.catalog = cached;
			this.status = 'ready';
			void this.refresh();
			return;
		}
		await this.refresh();
	}

	/**
	 * Reload every source and rebuild. `force` bypasses the source caches
	 * (loadRawCatalogs({ force: true })) and does not join a refresh that is already running.
	 */
	refresh(opts: { force?: boolean } = {}): Promise<void> {
		if (this.#refreshJob && !opts.force) return this.#refreshJob;
		const job = this.#doRefresh(!!opts.force).finally(() => {
			if (this.#refreshJob === job) this.#refreshJob = null;
		});
		this.#refreshJob = job;
		return job;
	}

	async #doRefresh(force: boolean) {
		this.refreshing = true;
		this.error = null;
		if (!this.catalog.titles.length && !this.catalog.channels.length) this.status = 'loading';
		try {
			this.#raws = withSampleExtras(await loadRawCatalogs({ force }));
			await this.#rebuild();
			this.status = 'ready';
			void cacheSet(CACHE_KEY, this.catalog);
			if (user.settings.tmdbApiKey) void this.#enrich();
		} catch (err) {
			this.error = err instanceof Error ? err.message : String(err);
			this.status = this.catalog.titles.length ? 'ready' : 'error';
		} finally {
			this.refreshing = false;
		}
	}

	#buildOptions(): BuildOptions {
		let names: Record<string, string> = {};
		try {
			names = sourceNames();
		} catch {
			// sources store not ready
		}
		return {
			sourceNames: { ...SAMPLE_SOURCE_NAMES, ...names },
			preferLang: this.#preferLang(),
			tmdb: this.#tmdb
		};
	}

	#preferLang(): LangCode {
		return user.active?.uiLang ?? i18n.locale ?? 'nl';
	}

	/** Raw catalogs with lazily loaded episodes filled in. */
	#rawsWithEpisodes(): RawCatalog[] {
		if (!this.#episodes.size) return this.#raws;
		return this.#raws.map((raw) => ({
			...raw,
			series: raw.series.map((s) => {
				if (s.episodes) return s;
				const eps = this.#episodes.get(refKey(s.sourceId, s.providerId));
				return eps ? { ...s, episodes: eps } : s;
			})
		}));
	}

	async #rebuild() {
		const seq = ++this.#buildSeq;
		const built = await buildCatalogAsync(this.#rawsWithEpisodes(), this.#buildOptions());
		if (seq !== this.#buildSeq) return;
		this.catalog = built;
	}

	async #enrich() {
		const apiKey = user.settings.tmdbApiKey?.trim();
		if (!apiKey || this.enriching) return;
		this.#enrichAbort?.abort();
		const abort = new AbortController();
		this.#enrichAbort = abort;
		this.enriching = true;
		try {
			const tmdb = await import('#lib/tmdb/index.ts');
			const index = this.#tmdb ?? (await tmdb.loadTmdbIndex());
			let dirty = false;
			let timer: ReturnType<typeof setTimeout> | undefined;
			const flush = async () => {
				if (!dirty || abort.signal.aborted) return;
				dirty = false;
				this.#tmdb = index;
				await tmdb.saveTmdbIndex(index);
				await this.#rebuild();
				void cacheSet(CACHE_KEY, this.catalog);
			};
			await tmdb.enrichTitles({
				apiKey,
				lang: this.#preferLang(),
				titles: this.catalog.titles,
				index,
				signal: abort.signal,
				skipSource: isSampleSourceId,
				onBatch: (_idx, changed) => {
					if (!changed) return;
					dirty = true;
					clearTimeout(timer);
					timer = setTimeout(() => void flush(), 1500);
				}
			});
			clearTimeout(timer);
			await flush();
		} catch (err) {
			console.warn('[catalog] TMDB enrichment stopped', err instanceof Error ? err.message : err);
		} finally {
			this.enriching = false;
		}
	}

	/**
	 * Ensure a series has its seasons loaded (lazy Xtream). Loads the episodes of every merged
	 * raw series that has none yet, merges them with the build logic and returns the updated title.
	 */
	ensureSeasons(id: string): Promise<Title | undefined> {
		const running = this.#seasonJobs.get(id);
		if (running) return running;
		const job = this.#loadSeasons(id).finally(() => this.#seasonJobs.delete(id));
		this.#seasonJobs.set(id, job);
		return job;
	}

	async #loadSeasons(id: string): Promise<Title | undefined> {
		const title = this.getTitle(id);
		if (!title || title.kind !== 'series') return title;
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local lookup, not state
		const rawSeries = new Map<string, RawSeries>();
		for (const raw of this.#raws)
			for (const s of raw.series) rawSeries.set(refKey(s.sourceId, s.providerId), s);
		const pending = title.rawRefs.filter((ref) => {
			const key = refKey(ref.sourceId, ref.providerId);
			if (this.#episodes.has(key)) return false;
			const raw = rawSeries.get(key);
			return raw ? raw.episodes === undefined : title.seasons === undefined;
		});
		if (!pending.length) return title;

		const results = await Promise.all(
			pending.map(async (ref) => {
				try {
					return { ref, ...(await loadSeriesInfo(ref.sourceId, ref.providerId)) };
				} catch {
					return { ref, info: {} as Partial<RawSeries>, episodes: [] as RawEpisode[] };
				}
			})
		);

		const opts = this.#buildOptions();
		const prefer = opts.preferLang ?? 'nl';
		const inputs: EpisodeSource[] = [];
		const info: Partial<RawSeries> = {};
		for (const r of results) {
			const key = refKey(r.ref.sourceId, r.ref.providerId);
			if (r.episodes.length) this.#episodes.set(key, r.episodes);
			for (const [k, v] of Object.entries(r.info ?? {}))
				if (v != null && v !== '' && info[k as keyof RawSeries] == null)
					(info as Record<string, unknown>)[k] = v;
			if (!r.episodes.length) continue;
			const raw = rawSeries.get(key);
			const analyzed = raw ? analyzeRaw(raw, opts) : undefined;
			inputs.push({
				sourceId: r.ref.sourceId,
				audio: analyzed?.audio ?? r.ref.langs,
				subs: analyzed?.subs ?? [],
				quality: analyzed?.quality ?? 'unknown',
				seriesTitle: analyzed?.parsed.cleanTitle ?? title.title,
				episodes: r.episodes
			});
		}

		// The catalog may have been rebuilt meanwhile: merge into the current version.
		const current = this.getTitle(id) ?? title;
		const seasons = inputs.length
			? mergeSeasons(current.id, inputs, prefer, current.seasons)
			: (current.seasons ?? []);
		const updated: Title = {
			...withSeasons(current, seasons),
			overview: current.overview ?? info.plot,
			posterUrl: current.posterUrl ?? info.posterUrl,
			backdropUrl: current.backdropUrl ?? info.backdropUrl,
			trailerUrl: current.trailerUrl ?? info.trailerUrl,
			rating: current.rating ?? info.rating,
			director: current.director ?? info.director,
			releaseDate: current.releaseDate ?? info.releaseDate,
			genres: current.genres.length ? current.genres : normalizeGenres(info.genres),
			cast: current.cast.length ? current.cast : (info.cast ?? []).map((name) => ({ name }))
		};
		if (this.getTitle(id)) {
			this.catalog = {
				...this.catalog,
				titles: this.catalog.titles.map((t) => (t.id === id ? updated : t))
			};
		}
		return updated;
	}

	/** Current and next programme for a channel at `at` (epoch ms). */
	nowNext(channel: Channel, at = Date.now()): { now?: EpgProgramme; next?: EpgProgramme } {
		const list = channel.epgId ? this.catalog.epg[channel.epgId] : undefined;
		if (!list?.length) return {};
		// Binary search: last programme starting at or before `at`.
		let lo = 0;
		let hi = list.length - 1;
		let idx = -1;
		while (lo <= hi) {
			const mid = (lo + hi) >> 1;
			if (list[mid].start <= at) {
				idx = mid;
				lo = mid + 1;
			} else hi = mid - 1;
		}
		if (idx !== -1 && list[idx].stop > at) return { now: list[idx], next: list[idx + 1] };
		return { next: list[idx + 1] };
	}

	/** Programmes of a channel between `from` and `to` (epoch ms). */
	programmes(channel: Channel, from: number, to: number): EpgProgramme[] {
		const list = channel.epgId ? this.catalog.epg[channel.epgId] : undefined;
		return list ? list.filter((p) => p.stop > from && p.start < to) : [];
	}

	/** Titles in a (canonical, Dutch) genre, most popular first. */
	byGenre(genre: string, kind?: 'movie' | 'series'): Title[] {
		return this.catalog.titles
			.filter((t) => t.genres.includes(genre) && (!kind || t.kind === kind))
			.sort((a, b) => b.popularity - a.popularity);
	}

	/** All genres with their number of titles, most common first. */
	get genres(): { name: string; count: number }[] {
		return this.#genreCounts;
	}

	/** Genres with counts for one kind of title. */
	genresFor(kind: 'movie' | 'series'): { name: string; count: number }[] {
		return countGenres(this.catalog.titles.filter((t) => t.kind === kind));
	}
}

function countGenres(titles: Title[]): { name: string; count: number }[] {
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local counter, not state
	const counts = new Map<string, number>();
	for (const t of titles) for (const g of t.genres) counts.set(g, (counts.get(g) ?? 0) + 1);
	return [...counts.entries()]
		.map(([name, count]) => ({ name, count }))
		.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export const catalog = new CatalogStore();
