// Pure resume / progress / end-of-episode decisions.
import type { WatchProgress } from '#lib/types.ts';

export const RESUME_MIN_SEC = 30;
export const RESUME_MAX_RATIO = 0.95;
/** Seconds before the end at which the "next episode" card appears. */
export const NEXT_CARD_SEC = 20;
/** Default autoplay countdown in seconds. */
export const NEXT_COUNTDOWN_SEC = 10;

/** Position to resume from, or null to start at the beginning. */
export function resumePosition(p: WatchProgress | undefined): number | null {
	if (!p) return null;
	if (!Number.isFinite(p.positionSec) || p.positionSec < RESUME_MIN_SEC) return null;
	if (p.durationSec > 0 && p.positionSec / p.durationSec >= RESUME_MAX_RATIO) return null;
	return p.positionSec;
}

/** Whether a position is worth persisting (avoid filling the history with accidental starts). */
export function shouldSaveProgress(positionSec: number, durationSec: number): boolean {
	if (!Number.isFinite(positionSec) || positionSec < 5) return false;
	return !(Number.isFinite(durationSec) && durationSec > 0 && positionSec > durationSec + 1);
}

/** Whether the "next episode" card should be visible. */
export function showNextCard(
	positionSec: number,
	durationSec: number,
	ended: boolean,
	threshold = NEXT_CARD_SEC
): boolean {
	if (ended) return true;
	if (!Number.isFinite(durationSec) || durationSec <= threshold * 3) return false;
	return durationSec - positionSec <= threshold;
}
