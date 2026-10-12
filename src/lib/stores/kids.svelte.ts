// Kids mode: content filtering for kids profiles, and the PIN guard for leaving kids mode
// (switching to another profile or opening the full settings).
//
// Filtering: only titles with `kidsSafe === true` (unknown = hidden) and channels in a
// kids-friendly group (Kids, Kinderen, Jeugd, Family, Animatie, ...). Use `filterTitles`,
// `isAllowed`, `filterChannels` or the derived `visibleTitles` / `visibleChannels`.
import type { Channel, Profile, Title } from '#lib/types.ts';
import { hashPin, user } from '#lib/stores/user.svelte.ts';
import { catalog } from '#lib/stores/catalog.svelte.ts';

/** Words (folded, lowercase) in a channel group that mark it as kids-friendly. */
const KIDS_GROUP =
	/(^|[^\p{L}])(kids?|kinder(en)?|kind|jeugd|junior|family|familie|famille|familia|animati(e|on)|cartoons?|toons?|enfants?|jeunesse|ninos|infantil|bambini|cocuk)([^\p{L}]|$)/u;

function foldGroup(s: string): string {
	return s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
}

export function isKidsTitle(title: Pick<Title, 'kidsSafe'>): boolean {
	return title.kidsSafe === true;
}

export function isKidsChannel(channel: Pick<Channel, 'group'>): boolean {
	return KIDS_GROUP.test(foldGroup(channel.group ?? ''));
}

// ---- PIN attempts --------------------------------------------------------------------

export const MAX_PIN_ATTEMPTS = 5;
export const PIN_LOCK_MS = 30_000;
const LOCK_KEY = 'ps:pinLock';

interface LockState {
	fails: number;
	until: number;
}

function loadLock(): LockState {
	try {
		const raw = localStorage.getItem(LOCK_KEY);
		if (raw) return { fails: 0, until: 0, ...JSON.parse(raw) };
	} catch {
		// ignore
	}
	return { fails: 0, until: 0 };
}

class KidsStore {
	/** The active profile is a kids profile. */
	active = $derived(user.active?.isKids === true);

	/** An adult PIN was entered while in kids mode (until another profile is selected). */
	#unlockedFor = $state<string | null>(null);

	/** Failed PIN attempts and lock-out (persisted so a reload does not reset it). */
	#lock = $state<LockState>(loadLock());

	visibleTitles = $derived(this.active ? catalog.titles.filter(isKidsTitle) : catalog.titles);
	visibleChannels = $derived(
		this.active ? catalog.channels.filter(isKidsChannel) : catalog.channels
	);

	/** Adult profiles that have a PIN (their PIN unlocks kids mode). */
	get adultPinProfiles(): Profile[] {
		return user.profiles.filter((p) => !p.isKids && !!p.pinHash);
	}

	/** Kids mode is active and an adult PIN is needed to leave it. */
	get locked(): boolean {
		return this.active && this.adultPinProfiles.length > 0 && this.#unlockedFor !== user.activeId;
	}

	/** Kids mode is active and not unlocked (the restricted settings view applies). */
	get restricted(): boolean {
		return this.active && this.#unlockedFor !== user.activeId;
	}

	isAllowed(title: Pick<Title, 'kidsSafe'> | undefined): boolean {
		if (!title) return false;
		return !this.active || isKidsTitle(title);
	}

	/** Kids-safe titles only in kids mode; undefined entries are always dropped. */
	filterTitles<T extends Pick<Title, 'kidsSafe'>>(titles: (T | undefined)[]): T[] {
		return titles.filter((t): t is T => !!t && (!this.active || isKidsTitle(t)));
	}

	isChannelAllowed(channel: Pick<Channel, 'group'> | undefined): boolean {
		if (!channel) return false;
		return !this.active || isKidsChannel(channel);
	}

	filterChannels<T extends Pick<Channel, 'group'>>(channels: T[]): T[] {
		return this.active
			? channels.filter((c) => !!c && isKidsChannel(c))
			: channels.filter((c) => !!c);
	}

	/** Unlock kids mode for this session without a PIN (no adult PIN exists). */
	unlock() {
		this.#unlockedFor = user.activeId;
	}

	/** Forget an unlock (e.g. when the kids profile is re-selected). */
	relock() {
		this.#unlockedFor = null;
	}

	// ---- PIN attempts ---------------------------------------------------------------

	/** Epoch ms until which PIN entry is blocked (0 = not blocked). */
	get lockedUntil(): number {
		return this.#lock.until;
	}

	get attemptsLeft(): number {
		return Math.max(0, MAX_PIN_ATTEMPTS - this.#lock.fails);
	}

	#saveLock() {
		try {
			localStorage.setItem(LOCK_KEY, JSON.stringify(this.#lock));
		} catch {
			// ignore
		}
	}

	/**
	 * Check `pin` against one of `hashes`. Counts failures; after 5 failures entry is
	 * blocked for 30 s. Returns 'ok', 'wrong' or 'blocked'.
	 */
	async checkPin(pin: string, hashes: string[]): Promise<'ok' | 'wrong' | 'blocked'> {
		const now = Date.now();
		if (this.#lock.until > now) return 'blocked';
		if (this.#lock.until && this.#lock.until <= now) this.#lock = { fails: 0, until: 0 };
		const h = await hashPin(pin);
		if (hashes.includes(h)) {
			this.#lock = { fails: 0, until: 0 };
			this.#saveLock();
			return 'ok';
		}
		const fails = this.#lock.fails + 1;
		this.#lock =
			fails >= MAX_PIN_ATTEMPTS ? { fails: 0, until: now + PIN_LOCK_MS } : { fails, until: 0 };
		this.#saveLock();
		return this.#lock.until ? 'blocked' : 'wrong';
	}

	/** Verify an adult PIN and unlock kids mode for the active profile. */
	async unlockWithPin(pin: string): Promise<'ok' | 'wrong' | 'blocked'> {
		const r = await this.checkPin(
			pin,
			this.adultPinProfiles.map((p) => p.pinHash!)
		);
		if (r === 'ok') this.unlock();
		return r;
	}

	/**
	 * PIN hashes that are accepted to switch to `target`, or null when no PIN is needed.
	 * A locked profile needs its own PIN; leaving kids mode for an adult profile needs the
	 * PIN of any adult profile with a PIN (when one exists).
	 */
	pinsToSelect(target: Profile): string[] | null {
		if (target.pinHash) return [target.pinHash];
		const leavingKids = this.locked && !target.isKids;
		return leavingKids ? this.adultPinProfiles.map((p) => p.pinHash!) : null;
	}
}

export const kids = new KidsStore();
