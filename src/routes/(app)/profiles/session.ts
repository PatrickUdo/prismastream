// Per app-session profile state: whether a profile was chosen in this session (the
// "Who's watching?" gate) and which locked profiles were unlocked for editing.

const CHOSEN_KEY = 'ps:profileChosen';

export function profileChosen(): boolean {
	try {
		return sessionStorage.getItem(CHOSEN_KEY) === '1';
	} catch {
		return true;
	}
}

export function markProfileChosen() {
	try {
		sessionStorage.setItem(CHOSEN_KEY, '1');
	} catch {
		// ignore
	}
}

/** Profiles whose PIN was entered in this session to edit them. */
const editUnlocked = new Set<string>();

export function isEditUnlocked(id: string): boolean {
	return editUnlocked.has(id);
}

export function unlockEdit(id: string) {
	editUnlocked.add(id);
}

/** Profiles that may still be added (keeps the picker tidy). */
export const MAX_PROFILES = 8;

/** Sanitise a PIN input: digits only, at most 4. */
export function pinDigits(s: string): string {
	return s.replace(/\D/g, '').slice(0, 4);
}
