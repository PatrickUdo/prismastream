// Profiles, per-profile data (favorites, progress, history, home rows) and app settings.
// Single reactive singleton `user`. Persisted through #lib/storage; sync hooks via onChange().
import type {
	AppSettings,
	HomeRowConfig,
	HomeRowId,
	Profile,
	ProfileData,
	WatchProgress
} from '#lib/types.ts';
import { debouncedSaver, loadJSON, saveJSON, uid } from '#lib/storage.ts';
import { i18n } from '#lib/i18n/index.svelte.ts';

export const DEFAULT_HOME_ROWS: HomeRowConfig[] = (
	[
		'continue',
		'favorites',
		'recommended',
		'recent',
		'popular-movies',
		'trending-series',
		'live',
		'genres'
	] as HomeRowId[]
).map((id) => ({ id, visible: true }));

export const DEFAULT_SETTINGS: AppSettings = {
	accent: '#7c5cff',
	autoplayNext: true,
	reduceMotion: false,
	updatedAt: 0
};

function emptyData(): ProfileData {
	return {
		favorites: [],
		favoriteChannels: [],
		progress: {},
		history: [],
		homeRows: structuredClone(DEFAULT_HOME_ROWS),
		updatedAt: Date.now()
	};
}

export function progressKey(titleId: string, episodeId?: string): string {
	return episodeId ? `${titleId}|${episodeId}` : titleId;
}

export async function hashPin(pin: string): Promise<string> {
	const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('ps-pin:' + pin));
	return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export type UserChange = 'profiles' | 'data' | 'settings';

class UserStore {
	ready = $state(false);
	profiles = $state<Profile[]>([]);
	activeId = $state<string | null>(null);
	data = $state<ProfileData>(emptyData());
	settings = $state<AppSettings>({ ...DEFAULT_SETTINGS });

	#listeners = new Set<(c: UserChange) => void>();
	#dataSaver: ReturnType<typeof debouncedSaver> | null = null;

	get active(): Profile | undefined {
		return this.profiles.find((p) => p.id === this.activeId);
	}

	async init() {
		if (this.ready) return;
		this.profiles = await loadJSON<Profile[]>('profiles', []);
		this.settings = { ...DEFAULT_SETTINGS, ...(await loadJSON('settings', {})) };
		if (this.profiles.length === 0) {
			this.profiles = [this.#newProfile({ name: 'Ik' })];
			await saveJSON('profiles', this.profiles);
		}
		const last = await loadJSON<string | null>('activeProfile', null);
		await this.selectProfile(
			last && this.profiles.some((p) => p.id === last) ? last : this.profiles[0].id
		);
		this.ready = true;
	}

	/** Subscribe to persisted changes (used by sync). Returns unsubscribe. */
	onChange(cb: (c: UserChange) => void) {
		this.#listeners.add(cb);
		return () => this.#listeners.delete(cb);
	}

	#emit(c: UserChange) {
		for (const cb of this.#listeners) cb(c);
	}

	#newProfile(p: Partial<Profile>): Profile {
		return {
			id: uid('p_'),
			name: 'Profiel',
			avatar: 'aurora',
			isKids: false,
			audioLangs: ['nl', 'en'],
			subtitleLangs: ['nl'],
			subtitlesOn: false,
			uiLang: 'nl',
			createdAt: Date.now(),
			...p
		};
	}

	// ---- profiles ---------------------------------------------------------

	async selectProfile(id: string) {
		this.#dataSaver?.flush();
		this.activeId = id;
		await saveJSON('activeProfile', id);
		const stored = await loadJSON<ProfileData | null>(`data:${id}`, null);
		this.data = stored ? { ...emptyData(), ...stored } : emptyData();
		this.#dataSaver = debouncedSaver(`data:${id}`);
		i18n.locale = this.active?.uiLang ?? 'nl';
	}

	async createProfile(p: Partial<Profile>): Promise<Profile> {
		const profile = this.#newProfile(p);
		this.profiles = [...this.profiles, profile];
		await this.#saveProfiles();
		return profile;
	}

	async updateProfile(id: string, patch: Partial<Profile>) {
		this.profiles = this.profiles.map((p) => (p.id === id ? { ...p, ...patch, id } : p));
		await this.#saveProfiles();
		if (id === this.activeId) i18n.locale = this.active?.uiLang ?? 'nl';
	}

	async deleteProfile(id: string) {
		if (this.profiles.length <= 1) return;
		this.profiles = this.profiles.filter((p) => p.id !== id);
		await this.#saveProfiles();
		if (this.activeId === id) await this.selectProfile(this.profiles[0].id);
	}

	async #saveProfiles() {
		await saveJSON('profiles', this.profiles);
		this.#emit('profiles');
	}

	// ---- per-profile data -------------------------------------------------

	#touchData() {
		this.data.updatedAt = Date.now();
		this.#dataSaver?.save($state.snapshot(this.data));
		this.#emit('data');
	}

	isFavorite(titleId: string): boolean {
		return this.data.favorites.includes(titleId);
	}

	toggleFavorite(titleId: string) {
		const f = this.data.favorites;
		this.data.favorites = f.includes(titleId) ? f.filter((x) => x !== titleId) : [titleId, ...f];
		this.#touchData();
	}

	isFavoriteChannel(channelId: string): boolean {
		return this.data.favoriteChannels.includes(channelId);
	}

	toggleFavoriteChannel(channelId: string) {
		const f = this.data.favoriteChannels;
		this.data.favoriteChannels = f.includes(channelId)
			? f.filter((x) => x !== channelId)
			: [...f, channelId];
		this.#touchData();
	}

	getProgress(titleId: string, episodeId?: string): WatchProgress | undefined {
		return this.data.progress[progressKey(titleId, episodeId)];
	}

	/** Most recent progress for a title (any episode for series). */
	latestProgress(titleId: string): WatchProgress | undefined {
		let best: WatchProgress | undefined;
		for (const p of Object.values(this.data.progress))
			if (p.titleId === titleId && (!best || p.updatedAt > best.updatedAt)) best = p;
		return best;
	}

	saveProgress(p: Omit<WatchProgress, 'updatedAt'>) {
		const key = progressKey(p.titleId, p.episodeId);
		const isNew = !this.data.progress[key];
		this.data.progress[key] = { ...p, updatedAt: Date.now() };
		if (isNew) {
			this.data.history = [
				{ titleId: p.titleId, episodeId: p.episodeId, at: Date.now() },
				...this.data.history
			].slice(0, 500);
		}
		this.#touchData();
	}

	clearProgress(titleId: string, episodeId?: string) {
		delete this.data.progress[progressKey(titleId, episodeId)];
		this.#touchData();
	}

	/** In-progress items (≥ 30 s watched, < 95 %), newest first, one per title. */
	continueWatching(): WatchProgress[] {
		const byTitle: Record<string, WatchProgress> = {};
		for (const p of Object.values(this.data.progress)) {
			if (p.positionSec < 30 || (p.durationSec > 0 && p.positionSec / p.durationSec > 0.95))
				continue;
			const cur = byTitle[p.titleId];
			if (!cur || p.updatedAt > cur.updatedAt) byTitle[p.titleId] = p;
		}
		return Object.values(byTitle).sort((a, b) => b.updatedAt - a.updatedAt);
	}

	setHomeRows(rows: HomeRowConfig[]) {
		this.data.homeRows = rows;
		this.#touchData();
	}

	setLastChannel(channelId: string) {
		this.data.lastChannelId = channelId;
		this.#touchData();
	}

	/** Replace data wholesale (used by sync when remote is newer). */
	replaceData(next: ProfileData) {
		this.data = { ...emptyData(), ...next };
		this.#dataSaver?.save($state.snapshot(this.data));
	}

	// ---- settings ---------------------------------------------------------

	async updateSettings(patch: Partial<AppSettings>) {
		this.settings = { ...this.settings, ...patch, updatedAt: Date.now() };
		await saveJSON('settings', this.settings);
		this.#emit('settings');
	}
}

export const user = new UserStore();
