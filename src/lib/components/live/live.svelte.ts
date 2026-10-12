// Shared state and small helpers for the live TV browser and guide:
// a minute clock, lazily fetched Xtream short EPG for channels without a guide,
// and source names (including the built-in demo sources).
import { createSubscriber, SvelteMap } from 'svelte/reactivity';
import type { IconName } from '#lib/components/Icon.svelte';
import type { Channel, EpgProgramme } from '#lib/types.ts';
import { catalog } from '#lib/stores/catalog.svelte.ts';
import { library } from '#lib/catalog/library.svelte.ts';
import { loadShortEpg, sourceName, sources } from '#lib/sources/index.svelte.ts';
import { SAMPLE_SOURCE_NAMES } from '#lib/sample/meta.ts';
import { MINUTE, nowNext, programmesOf } from './epg.ts';

// ---------------------------------------------------------------------------
// Clock: ticks on every minute boundary while something reads it.
// ---------------------------------------------------------------------------

class MinuteClock {
	#now = $state(Date.now());
	#subscribe = createSubscriber(() => {
		let timer: ReturnType<typeof setTimeout> | undefined;
		const update = () => (this.#now = Date.now());
		const schedule = () => {
			timer = setTimeout(
				() => {
					update();
					schedule();
				},
				MINUTE - (Date.now() % MINUTE) + 50
			);
		};
		const onVisible = () => {
			if (document.visibilityState === 'visible') update();
		};
		queueMicrotask(update);
		schedule();
		document.addEventListener('visibilitychange', onVisible);
		return () => {
			clearTimeout(timer);
			document.removeEventListener('visibilitychange', onVisible);
		};
	});

	/** Current time (epoch ms), refreshed every minute. */
	get now(): number {
		this.#subscribe();
		return this.#now;
	}
}

export const liveClock = new MinuteClock();

// ---------------------------------------------------------------------------
// Short EPG (Xtream get_short_epg) for channels the XMLTV guide does not cover.
// ---------------------------------------------------------------------------

const NONE: readonly EpgProgramme[] = Object.freeze([]);
const CONCURRENCY = 3;

class ShortEpgCache {
	#lists = new SvelteMap<string, readonly EpgProgramme[]>();
	#requested = new Set<string>();
	#queue: Channel[] = [];
	#active = 0;

	/**
	 * Programmes for a channel: the catalog guide, else the short EPG once loaded.
	 * Remote mode: the guide loaded from the backend so far (see request()).
	 */
	programmes = (channel: Channel): readonly EpgProgramme[] => {
		if (library.mode === 'remote') return library.programmes(channel);
		const list = programmesOf(channel, catalog.epg);
		if (list.length) return list;
		return this.#lists.get(channel.id) ?? NONE;
	};

	/**
	 * Local: fetch the short EPG for channels without a guide (Xtream only, deduplicated).
	 * Remote: load the guide of the channel for [from, to) (default: around now).
	 */
	request(channel: Channel, from?: number, to?: number) {
		if (library.mode === 'remote') return library.requestEpg(channel, from, to);
		if (this.#requested.has(channel.id)) return;
		this.#requested.add(channel.id);
		if (programmesOf(channel, catalog.epg).length) return;
		if (!channel.variants.some((v) => sources.get(v.sourceId)?.type === 'xtream')) return;
		this.#queue.push(channel);
		this.#pump();
	}

	/** Now and next for a channel (remote: loaded guide, else the batched /nownext). */
	nowNext = (channel: Channel, at: number) =>
		library.mode === 'remote'
			? library.nowNext(channel, at)
			: nowNext(this.programmes(channel), at);

	/** A list row: local short EPG; remote rows only use now/next (no guide per row). */
	requestRow(channel: Channel) {
		if (library.mode !== 'remote') this.request(channel);
	}

	#pump() {
		while (this.#active < CONCURRENCY && this.#queue.length) {
			const channel = this.#queue.shift()!;
			const v = channel.variants.find((x) => sources.get(x.sourceId)?.type === 'xtream');
			if (!v) continue;
			this.#active++;
			const providerId = v.id.slice(v.sourceId.length + 1);
			loadShortEpg(v.sourceId, providerId, channel.epgId ?? channel.id)
				.then((list) => {
					if (list.length)
						this.#lists.set(
							channel.id,
							[...list].sort((a, b) => a.start - b.start)
						);
				})
				.catch(() => {
					// A missing short EPG simply leaves the "no information" slots in place.
				})
				.finally(() => {
					this.#active--;
					this.#pump();
				});
		}
	}
}

export const shortEpg = new ShortEpgCache();

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

/** Display name of a source, including the built-in demo providers. */
export function sourceLabel(id: string): string {
	const name = sourceName(id);
	return name === id ? (SAMPLE_SOURCE_NAMES[id] ?? id) : name;
}

// ---------------------------------------------------------------------------
// Remembered view (per device)
// ---------------------------------------------------------------------------

export type LiveView = 'list' | 'guide';

/** A category chip: 'all', 'fav' or 'g:<group>'. */
export interface CategoryOption {
	id: string;
	label: string;
	count: number;
	icon?: IconName;
}
const VIEW_KEY = 'ps.live.view';

export function loadView(): LiveView | null {
	try {
		const v = localStorage.getItem(VIEW_KEY);
		return v === 'list' || v === 'guide' ? v : null;
	} catch {
		return null;
	}
}

export function saveView(view: LiveView) {
	try {
		localStorage.setItem(VIEW_KEY, view);
	} catch {
		// private mode: the choice simply is not remembered
	}
}
