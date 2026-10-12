import { describe, expect, it } from 'vitest';
import { encodeQr, qrPath } from './qr.ts';

// The output was verified against a real decoder (CoreImage CIDetector) for versions 1, 4, 8
// and 10; these tests guard the structure.
function finderAt(m: boolean[][], x: number, y: number): boolean {
	for (let dy = 0; dy < 7; dy++)
		for (let dx = 0; dx < 7; dx++) {
			const ring = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
			if (m[y + dy][x + dx] !== (ring !== 2)) return false;
		}
	return true;
}

describe('encodeQr', () => {
	it('picks the smallest version and draws the finder patterns', () => {
		for (const [text, size] of [
			['HELLO', 21],
			['https://prismastream.patrickudo.nl/activate?code=ABCD-1234', 33]
		] as const) {
			const m = encodeQr(text);
			expect(m).toHaveLength(size);
			expect(finderAt(m, 0, 0)).toBe(true);
			expect(finderAt(m, size - 7, 0)).toBe(true);
			expect(finderAt(m, 0, size - 7)).toBe(true);
			// Timing pattern and the dark module.
			for (let i = 8; i < size - 8; i++) expect(m[6][i]).toBe(i % 2 === 0);
			expect(m[size - 8][8]).toBe(true);
		}
	});

	it('supports up to 213 bytes (version 10) and rejects longer text', () => {
		expect(encodeQr('x'.repeat(213))).toHaveLength(57);
		expect(() => encodeQr('x'.repeat(214))).toThrow();
	});

	it('renders an SVG path with a quiet zone', () => {
		const p = qrPath(encodeQr('A'), 4);
		expect(p.size).toBe(29);
		expect(p.d.startsWith('M4 4h1v1h-1z')).toBe(true);
	});
});
