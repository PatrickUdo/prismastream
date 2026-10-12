// Small pure formatting helpers for the player UI.

/** 75 → "1:15", 3723 → "1:02:03". Negative or non-finite input → "0:00". */
export function formatTime(sec: number): string {
	if (!Number.isFinite(sec) || sec < 0) sec = 0;
	const s = Math.floor(sec);
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const r = s % 60;
	const ss = String(r).padStart(2, '0');
	return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Clamp `v` into [min, max]. */
export function clamp(v: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, v));
}

/** Human label for an HLS rendition height ("2160" → "4K", "1080" → "1080p"). */
export function heightLabel(height: number): string {
	if (height >= 2000) return '4K';
	if (height >= 1400) return '1440p';
	return height > 0 ? `${height}p` : '';
}
