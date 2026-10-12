// Generative artwork engine. Pure and deterministic: the same id always yields the same
// poster/backdrop. Produces a small scene graph (gradients + shapes) that
// GenerativeArt.svelte renders as inline SVG. No canvas, no external images.

// ---------------------------------------------------------------------------
// Seeded randomness
// ---------------------------------------------------------------------------

/** FNV-1a 32-bit hash. */
export function hashString(s: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return h >>> 0;
}

/** mulberry32 PRNG in [0, 1). */
export function rng(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

type Rand = () => number;
const between = (r: Rand, a: number, b: number) => a + (b - a) * r();
const pick = <T>(r: Rand, list: readonly T[]): T => list[Math.floor(r() * list.length)];
const round = (n: number) => Math.round(n * 10) / 10;

// ---------------------------------------------------------------------------
// Colour helpers
// ---------------------------------------------------------------------------

function hexToRgb(hex: string): [number, number, number] {
	const h = hex.replace('#', '');
	const n = parseInt(
		h.length === 3
			? h
					.split('')
					.map((c) => c + c)
					.join('')
			: h,
		16
	);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Linear mix of two hex colours (t = 0 → a, t = 1 → b). */
export function mixHex(a: string, b: string, t: number): string {
	const [r1, g1, b1] = hexToRgb(a);
	const [r2, g2, b2] = hexToRgb(b);
	const m = (x: number, y: number) =>
		Math.round(x + (y - x) * t)
			.toString(16)
			.padStart(2, '0');
	return `#${m(r1, r2)}${m(g1, g2)}${m(b1, b2)}`;
}

/** Relative luminance (0..1) of a hex colour; NaN when not parseable. */
export function luminance(hex: string): number {
	if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex.trim())) return NaN;
	const lin = (c: number) => {
		const s = c / 255;
		return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	};
	const [r, g, b] = hexToRgb(hex.trim());
	return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

// ---------------------------------------------------------------------------
// Genre palettes
// ---------------------------------------------------------------------------

export type GenreFamily =
	| 'scifi'
	| 'horror'
	| 'comedy'
	| 'drama'
	| 'action'
	| 'thriller'
	| 'romance'
	| 'fantasy'
	| 'animation'
	| 'documentary'
	| 'music'
	| 'western'
	| 'prisma';

export interface Palette {
	/** Background gradient: top → bottom. */
	bg: [string, string];
	/** Three mid tones used for light and shapes. */
	tones: [string, string, string];
	/** Brightest light colour. */
	glow: string;
	/** Text colour on the artwork. */
	ink: string;
}

const PALETTES: Record<GenreFamily, Palette[]> = {
	scifi: [
		{
			bg: ['#05071a', '#0c0826'],
			tones: ['#3b5bff', '#8f5cff', '#28d7ff'],
			glow: '#9ff0ff',
			ink: '#eef4ff'
		},
		{
			bg: ['#03060c', '#06192a'],
			tones: ['#1f9dff', '#5b4bff', '#7ff2ff'],
			glow: '#d2f8ff',
			ink: '#eaf7ff'
		}
	],
	horror: [
		{
			bg: ['#050102', '#160306'],
			tones: ['#6e0913', '#c8162a', '#3a0710'],
			glow: '#ff5a44',
			ink: '#f6e9e6'
		},
		{
			bg: ['#030303', '#0d0a0a'],
			tones: ['#4f0b10', '#8d877e', '#220406'],
			glow: '#ebe5d6',
			ink: '#efe9df'
		}
	],
	comedy: [
		{
			bg: ['#1c0b06', '#2b1305'],
			tones: ['#ff8a3d', '#ffd166', '#ff5d8f'],
			glow: '#fff1c2',
			ink: '#fff8ee'
		},
		{
			bg: ['#120b22', '#2a1040'],
			tones: ['#ffb547', '#ff6f91', '#7ad7ff'],
			glow: '#fff3d6',
			ink: '#fff7f0'
		}
	],
	drama: [
		{
			bg: ['#0b0c10', '#15171d'],
			tones: ['#4b5568', '#b08f86', '#d8c7a8'],
			glow: '#f3e9d6',
			ink: '#f4f0e9'
		},
		{
			bg: ['#090c0c', '#121a1a'],
			tones: ['#3f5a5a', '#9fb3a6', '#c9a68a'],
			glow: '#eef0e2',
			ink: '#f1f2ec'
		}
	],
	action: [
		{
			bg: ['#0a0604', '#170b05'],
			tones: ['#ff6a13', '#ffb347', '#2a3b4f'],
			glow: '#ffdcaa',
			ink: '#fff6ea'
		},
		{
			bg: ['#05070a', '#0c1119'],
			tones: ['#ff3d2e', '#ffae00', '#3a4d63'],
			glow: '#ffe1b0',
			ink: '#fff4ea'
		}
	],
	thriller: [
		{
			bg: ['#03080a', '#071416'],
			tones: ['#0e4a4c', '#2fb3a2', '#bfe8e1'],
			glow: '#a9f7ea',
			ink: '#ecfbf8'
		},
		{
			bg: ['#06070a', '#0d1118'],
			tones: ['#1d2b45', '#d4a24c', '#5d7ea8'],
			glow: '#ffe2a6',
			ink: '#f5efe2'
		}
	],
	romance: [
		{
			bg: ['#13060c', '#220a17'],
			tones: ['#e2557a', '#ffb4a2', '#9b6bff'],
			glow: '#ffe3e8',
			ink: '#fff2f4'
		},
		{
			bg: ['#100812', '#1f0d22'],
			tones: ['#c0587e', '#f5c2a8', '#6e5bd6'],
			glow: '#fff0ea',
			ink: '#fff4f1'
		}
	],
	fantasy: [
		{
			bg: ['#03100c', '#06201a'],
			tones: ['#1f7a63', '#d4af37', '#7fd1b9'],
			glow: '#ffeeb3',
			ink: '#f6f4e6'
		},
		{
			bg: ['#070a18', '#0f1830'],
			tones: ['#2f5bb3', '#c79bff', '#e7c873'],
			glow: '#fff3cf',
			ink: '#f4f1ff'
		}
	],
	animation: [
		{
			bg: ['#0b1030', '#16194c'],
			tones: ['#4f8cff', '#ffcf5c', '#ff6fb5'],
			glow: '#ffffff',
			ink: '#ffffff'
		},
		{
			bg: ['#08222a', '#0c3340'],
			tones: ['#2ad4b0', '#ffd65c', '#ff7a59'],
			glow: '#ffffff',
			ink: '#ffffff'
		}
	],
	documentary: [
		{
			bg: ['#0d0c0a', '#1a1712'],
			tones: ['#6b5b45', '#c8a96a', '#e8e0d0'],
			glow: '#fff6e0',
			ink: '#f7f2e8'
		},
		{
			bg: ['#070c0b', '#0f1a17'],
			tones: ['#3b5e52', '#a7c4a0', '#e1d9b8'],
			glow: '#f5f7e6',
			ink: '#f2f5ec'
		}
	],
	music: [
		{
			bg: ['#0b0614', '#1a0a2a'],
			tones: ['#d946ef', '#22d3ee', '#f472b6'],
			glow: '#fbe7ff',
			ink: '#fdf5ff'
		}
	],
	western: [
		{
			bg: ['#0d0a06', '#1c1309'],
			tones: ['#7a5a2e', '#c2763a', '#e8c48c'],
			glow: '#ffe4b5',
			ink: '#fbf1e2'
		}
	],
	prisma: [
		{
			bg: ['#07070d', '#110c24'],
			tones: ['#5b45d6', '#4fd1c5', '#e57bff'],
			glow: '#ece8ff',
			ink: '#f6f4ff'
		},
		{
			bg: ['#06080d', '#0b1424'],
			tones: ['#3f6bd8', '#9a7bff', '#ff9bc0'],
			glow: '#f0f4ff',
			ink: '#f4f6ff'
		}
	]
};

/** Keyword → family, in priority order (most distinctive first). */
const FAMILY_KEYWORDS: [GenreFamily, string[]][] = [
	['horror', ['horror', 'griezel', 'eng']],
	['scifi', ['sci', 'science', 'ruimte', 'space', 'cyber', 'toekomst']],
	['animation', ['anim', 'famil', 'kind', 'kids', 'jeugd', 'tekenfilm']],
	['fantasy', ['fantasy', 'fantas', 'avontuur', 'adventure', 'sprookje', 'magie']],
	['music', ['muziek', 'music', 'musical', 'concert']],
	['comedy', ['komed', 'comed', 'humor', 'sitcom']],
	['romance', ['roman', 'liefde', 'love']],
	['thriller', ['thriller', 'misdaad', 'crime', 'myster', 'spanning', 'detective', 'noir']],
	['action', ['actie', 'action', 'superheld', 'superhero', 'martial']],
	['western', ['western', 'oorlog', 'war']],
	['documentary', ['docu', 'histor', 'geschied', 'natuur', 'nature', 'biogra', 'reality']],
	['drama', ['drama', 'soap']]
];

export function genreFamily(genres: readonly string[]): GenreFamily {
	const lower = genres.map((g) => g.toLowerCase());
	for (const [family, keys] of FAMILY_KEYWORDS)
		if (lower.some((g) => keys.some((k) => g.includes(k)))) return family;
	return 'prisma';
}

// ---------------------------------------------------------------------------
// Scene graph
// ---------------------------------------------------------------------------

export interface GradientStop {
	offset: number;
	color: string;
	opacity?: number;
}

export interface Gradient {
	id: string;
	type: 'linear' | 'radial';
	stops: GradientStop[];
	/** Linear: direction in objectBoundingBox units. */
	x1?: number;
	y1?: number;
	x2?: number;
	y2?: number;
	/** Radial: centre/radius in objectBoundingBox units. */
	cx?: number;
	cy?: number;
	r?: number;
}

/** Fills/strokes may reference a gradient as "grad:<id>". */
export type Paint = string;

interface ShapeBase {
	fill?: Paint;
	stroke?: Paint;
	strokeWidth?: number;
	opacity?: number;
	blend?: 'screen' | 'overlay' | 'soft-light' | 'plus-lighter';
	transform?: string;
}

export type Shape =
	| (ShapeBase & { t: 'rect'; x: number; y: number; w: number; h: number })
	| (ShapeBase & { t: 'circle'; cx: number; cy: number; r: number })
	| (ShapeBase & { t: 'ellipse'; cx: number; cy: number; rx: number; ry: number })
	| (ShapeBase & { t: 'path'; d: string });

export type Motif = 'prism' | 'eclipse' | 'horizon' | 'shafts' | 'orbits' | 'bloom' | 'slash';

const FAMILY_MOTIFS: Record<GenreFamily, Motif[]> = {
	scifi: ['prism', 'orbits', 'eclipse'],
	horror: ['shafts', 'eclipse', 'horizon'],
	comedy: ['bloom', 'prism', 'orbits'],
	drama: ['horizon', 'eclipse', 'shafts'],
	action: ['slash', 'eclipse', 'horizon'],
	thriller: ['shafts', 'slash', 'eclipse'],
	romance: ['bloom', 'eclipse', 'horizon'],
	fantasy: ['horizon', 'eclipse', 'orbits'],
	animation: ['bloom', 'orbits', 'prism'],
	documentary: ['horizon', 'orbits', 'eclipse'],
	music: ['prism', 'bloom', 'orbits'],
	western: ['horizon', 'eclipse'],
	prisma: ['prism', 'bloom', 'eclipse', 'orbits']
};

export const SPECTRUM = [
	'#ff5f7e',
	'#ffa25c',
	'#ffe27a',
	'#6dffb8',
	'#5cc8ff',
	'#8a74ff',
	'#df6bff'
];

export type ArtFormat = 'poster' | 'backdrop';

export interface Scene {
	w: number;
	h: number;
	palette: Palette;
	family: GenreFamily;
	motif: Motif;
	gradients: Gradient[];
	shapes: Shape[];
	/** Typographic layout for posters. */
	align: 'start' | 'middle';
	caps: boolean;
}

export const FORMAT_SIZE: Record<ArtFormat, { w: number; h: number }> = {
	poster: { w: 200, h: 300 },
	backdrop: { w: 320, h: 180 }
};

/** Smooth path through points using quadratic curves between midpoints. */
function smoothPath(points: [number, number][]): string {
	let d = `M${round(points[0][0])} ${round(points[0][1])}`;
	for (let i = 1; i < points.length - 1; i++) {
		const [x, y] = points[i];
		const [nx, ny] = points[i + 1];
		d += ` Q${round(x)} ${round(y)} ${round((x + nx) / 2)} ${round((y + ny) / 2)}`;
	}
	const last = points[points.length - 1];
	return d + ` L${round(last[0])} ${round(last[1])}`;
}

interface Ctx {
	r: Rand;
	w: number;
	h: number;
	p: Palette;
	poster: boolean;
	g: Gradient[];
	s: Shape[];
}

function radial(ctx: Ctx, id: string, color: string, inner = 0.7, fadeAt = 1): string {
	ctx.g.push({
		id,
		type: 'radial',
		cx: 0.5,
		cy: 0.5,
		r: 0.5,
		stops: [
			{ offset: 0, color, opacity: inner },
			{ offset: fadeAt, color, opacity: 0 }
		]
	});
	return `grad:${id}`;
}

function motifPrism(ctx: Ctx) {
	const { r, w, h, p, poster } = ctx;
	const size = Math.min(w, h) * between(r, 0.26, 0.34);
	const cx = w * (poster ? between(r, 0.42, 0.58) : between(r, 0.48, 0.62));
	const cy = h * (poster ? between(r, 0.3, 0.4) : between(r, 0.42, 0.52));
	const tri = (k: number) => {
		const a = -Math.PI / 2 + (k * 2 * Math.PI) / 3;
		return [cx + Math.cos(a) * size, cy + Math.sin(a) * size] as const;
	};
	const [ax, ay] = tri(0);
	const [bx, by] = tri(1);
	const [qx, qy] = tri(2);
	const inX = (ax + qx) / 2;
	const inY = (ay + qy) / 2;
	const outX = (ax + bx) / 2;
	const outY = (ay + by) / 2;

	// Halo behind the prism.
	ctx.s.push({ t: 'circle', cx, cy, r: size * 2.4, fill: radial(ctx, 'halo', p.glow, 0.22) });
	// Incoming white beam.
	const beamY = inY + between(r, -0.08, 0.12) * h;
	ctx.g.push({
		id: 'beam',
		type: 'linear',
		x1: 0,
		y1: 0,
		x2: 1,
		y2: 0,
		stops: [
			{ offset: 0, color: p.glow, opacity: 0 },
			{ offset: 1, color: p.glow, opacity: 0.95 }
		]
	});
	ctx.s.push({
		t: 'path',
		d: `M0 ${round(beamY - 1.2)} L${round(inX)} ${round(inY - 0.6)} L${round(inX)} ${round(inY + 0.6)} L0 ${round(beamY + 1.2)} Z`,
		fill: 'grad:beam'
	});
	// Refracted spectrum fan.
	const spread = h * between(r, 0.34, 0.5);
	const centre = outY + h * between(r, 0.08, 0.2);
	const farX = w + 20;
	const bands = SPECTRUM.length;
	for (let i = 0; i < bands; i++) {
		const y1 = centre - spread / 2 + (spread / bands) * i;
		const y2 = y1 + spread / bands + 0.6;
		ctx.g.push({
			id: `band${i}`,
			type: 'linear',
			x1: 0,
			y1: 0,
			x2: 1,
			y2: 0,
			stops: [
				{ offset: 0, color: SPECTRUM[i], opacity: 0.9 },
				{ offset: 1, color: SPECTRUM[i], opacity: 0.25 }
			]
		});
		ctx.s.push({
			t: 'path',
			d: `M${round(outX)} ${round(outY)} L${farX} ${round(y1)} L${farX} ${round(y2)} Z`,
			fill: `grad:band${i}`,
			opacity: 0.62,
			blend: 'screen'
		});
	}
	// The prism itself: a glass triangle.
	ctx.g.push({
		id: 'glass',
		type: 'linear',
		x1: 0,
		y1: 0,
		x2: 1,
		y2: 1,
		stops: [
			{ offset: 0, color: '#ffffff', opacity: 0.2 },
			{ offset: 0.55, color: p.tones[0], opacity: 0.12 },
			{ offset: 1, color: '#ffffff', opacity: 0.04 }
		]
	});
	ctx.s.push({
		t: 'path',
		d: `M${round(ax)} ${round(ay)} L${round(bx)} ${round(by)} L${round(qx)} ${round(qy)} Z`,
		fill: 'grad:glass',
		stroke: p.glow,
		strokeWidth: 0.7,
		opacity: 0.95
	});
	ctx.s.push({ t: 'circle', cx: outX, cy: outY, r: 7, fill: radial(ctx, 'spark', '#ffffff', 0.9) });
}

function motifEclipse(ctx: Ctx) {
	const { r, w, h, p, poster } = ctx;
	const R = Math.min(w, h) * between(r, 0.2, 0.28);
	const cx = w * (poster ? between(r, 0.36, 0.64) : between(r, 0.56, 0.74));
	const cy = h * (poster ? between(r, 0.28, 0.38) : between(r, 0.4, 0.5));
	ctx.s.push({ t: 'circle', cx, cy, r: R * 2.6, fill: radial(ctx, 'corona', p.tones[1], 0.5) });
	ctx.s.push({ t: 'circle', cx, cy, r: R * 1.5, fill: radial(ctx, 'inner', p.glow, 0.45) });
	ctx.s.push({ t: 'circle', cx, cy, r: R, fill: p.glow, opacity: 0.95 });
	const dx = R * between(r, -0.12, 0.12);
	const dy = R * between(r, -0.1, 0.04);
	ctx.g.push({
		id: 'disc',
		type: 'radial',
		cx: 0.4,
		cy: 0.35,
		r: 0.75,
		stops: [
			{ offset: 0, color: mixHex(p.bg[1], p.tones[0], 0.25) },
			{ offset: 1, color: p.bg[0] }
		]
	});
	ctx.s.push({ t: 'circle', cx: cx + dx, cy: cy + dy, r: R * 0.985, fill: 'grad:disc' });
	// Horizon hairline.
	ctx.s.push({
		t: 'rect',
		x: 0,
		y: round(cy + R * between(r, 1.6, 2.1)),
		w,
		h: 0.6,
		fill: p.glow,
		opacity: 0.22
	});
}

function motifHorizon(ctx: Ctx) {
	const { r, w, h, p, poster } = ctx;
	const sunR = Math.min(w, h) * between(r, 0.12, 0.18);
	const sx = w * between(r, 0.28, 0.72);
	const horizon = h * (poster ? between(r, 0.46, 0.56) : between(r, 0.55, 0.65));
	const sy = horizon - sunR * between(r, 0.2, 0.9);
	ctx.s.push({
		t: 'circle',
		cx: sx,
		cy: sy,
		r: sunR * 4,
		fill: radial(ctx, 'sunhalo', p.tones[1], 0.45)
	});
	ctx.g.push({
		id: 'sun',
		type: 'linear',
		x1: 0,
		y1: 0,
		x2: 0,
		y2: 1,
		stops: [
			{ offset: 0, color: p.glow },
			{ offset: 1, color: p.tones[1] }
		]
	});
	ctx.s.push({ t: 'circle', cx: sx, cy: sy, r: sunR, fill: 'grad:sun' });
	const layers = 4;
	for (let i = 0; i < layers; i++) {
		const base = horizon + i * h * (poster ? 0.07 : 0.085);
		const amp = h * between(r, 0.03, 0.09) * (1 - i * 0.15);
		const n = 7 + Math.floor(r() * 4);
		const pts: [number, number][] = [];
		for (let k = 0; k <= n; k++) pts.push([(w * k) / n, base - r() * amp]);
		const d = smoothPath(pts) + ` L${w} ${h} L0 ${h} Z`;
		const tone = mixHex(p.tones[0], p.bg[0], 0.25 + (i / (layers - 1)) * 0.72);
		ctx.s.push({ t: 'path', d, fill: tone, opacity: i === 0 ? 0.8 : 1 });
	}
	// Atmospheric haze over the far ridge.
	ctx.g.push({
		id: 'haze',
		type: 'linear',
		x1: 0,
		y1: 0,
		x2: 0,
		y2: 1,
		stops: [
			{ offset: 0, color: p.tones[2], opacity: 0 },
			{ offset: 1, color: p.tones[2], opacity: 0.18 }
		]
	});
	ctx.s.push({ t: 'rect', x: 0, y: horizon - h * 0.12, w, h: h * 0.14, fill: 'grad:haze' });
}

function motifShafts(ctx: Ctx) {
	const { r, w, h, p } = ctx;
	const src = w * between(r, 0.3, 0.7);
	ctx.s.push({
		t: 'circle',
		cx: src,
		cy: -h * 0.05,
		r: w * 0.75,
		fill: radial(ctx, 'source', p.glow, 0.32)
	});
	ctx.g.push({
		id: 'shaft',
		type: 'linear',
		x1: 0,
		y1: 0,
		x2: 0,
		y2: 1,
		stops: [
			{ offset: 0, color: p.glow, opacity: 0.85 },
			{ offset: 0.85, color: p.glow, opacity: 0 }
		]
	});
	const count = 5 + Math.floor(r() * 4);
	for (let i = 0; i < count; i++) {
		const top = src + between(r, -0.25, 0.25) * w;
		const tw = between(r, 1, 5);
		const spreadX = between(r, -0.45, 0.45) * w;
		const bw = between(r, 14, 42);
		const bottom = top + spreadX;
		ctx.s.push({
			t: 'path',
			d: `M${round(top - tw)} 0 L${round(top + tw)} 0 L${round(bottom + bw)} ${h} L${round(bottom - bw)} ${h} Z`,
			fill: 'grad:shaft',
			opacity: between(r, 0.12, 0.32),
			blend: 'screen'
		});
	}
	// Ground fog.
	ctx.s.push({
		t: 'ellipse',
		cx: w / 2,
		cy: h * 0.9,
		rx: w * 0.9,
		ry: h * 0.16,
		fill: radial(ctx, 'fog', p.tones[1], 0.35)
	});
}

function motifOrbits(ctx: Ctx) {
	const { r, w, h, p, poster } = ctx;
	const cx = w * between(r, 0.32, 0.68);
	const cy = h * (poster ? between(r, 0.3, 0.42) : between(r, 0.42, 0.55));
	const tilt = between(r, -22, 22);
	// Star field.
	const stars = 40 + Math.floor(r() * 30);
	for (let i = 0; i < stars; i++)
		ctx.s.push({
			t: 'circle',
			cx: round(r() * w),
			cy: round(r() * h * 0.85),
			r: round(between(r, 0.2, 0.75)),
			fill: '#ffffff',
			opacity: round(between(r, 0.2, 0.8))
		});
	const rings = 4 + Math.floor(r() * 3);
	for (let i = 0; i < rings; i++) {
		const rx = Math.min(w, h) * (0.22 + i * between(r, 0.1, 0.16));
		ctx.s.push({
			t: 'ellipse',
			cx,
			cy,
			rx,
			ry: rx * between(r, 0.26, 0.38),
			fill: 'none',
			stroke: i % 2 ? p.tones[2] : p.glow,
			strokeWidth: round(between(r, 0.4, 1)),
			opacity: round(between(r, 0.16, 0.5)),
			transform: `rotate(${round(tilt)} ${round(cx)} ${round(cy)})`
		});
	}
	const pr = Math.min(w, h) * between(r, 0.1, 0.14);
	ctx.s.push({ t: 'circle', cx, cy, r: pr * 3, fill: radial(ctx, 'atmo', p.tones[0], 0.55) });
	ctx.g.push({
		id: 'planet',
		type: 'radial',
		cx: 0.32,
		cy: 0.3,
		r: 0.85,
		stops: [
			{ offset: 0, color: p.glow },
			{ offset: 0.45, color: p.tones[2] },
			{ offset: 1, color: p.bg[0] }
		]
	});
	ctx.s.push({ t: 'circle', cx, cy, r: pr, fill: 'grad:planet' });
	// A couple of moons.
	for (let i = 0; i < 2; i++) {
		const a = r() * Math.PI * 2;
		const d = pr * between(r, 2, 4);
		ctx.s.push({
			t: 'circle',
			cx: round(cx + Math.cos(a) * d),
			cy: round(cy + Math.sin(a) * d * 0.35),
			r: round(between(r, 1.2, 3)),
			fill: p.tones[i],
			opacity: 0.9
		});
	}
}

function motifBloom(ctx: Ctx) {
	const { r, w, h, p, poster } = ctx;
	const count = 4 + Math.floor(r() * 3);
	for (let i = 0; i < count; i++) {
		const color = p.tones[i % 3];
		ctx.s.push({
			t: 'circle',
			cx: round(w * between(r, 0.05, 0.95)),
			cy: round(h * (poster ? between(r, 0.08, 0.62) : between(r, 0.1, 0.9))),
			r: round(Math.min(w, h) * between(r, 0.28, 0.55)),
			fill: radial(ctx, `bloom${i}`, color, between(r, 0.55, 0.85)),
			blend: 'screen'
		});
	}
	const rings = 2 + Math.floor(r() * 2);
	for (let i = 0; i < rings; i++)
		ctx.s.push({
			t: 'circle',
			cx: round(w * between(r, 0.2, 0.8)),
			cy: round(h * (poster ? between(r, 0.15, 0.5) : between(r, 0.2, 0.8))),
			r: round(Math.min(w, h) * between(r, 0.12, 0.3)),
			fill: 'none',
			stroke: p.glow,
			strokeWidth: round(between(r, 0.5, 1.4)),
			opacity: round(between(r, 0.25, 0.55))
		});
	const dots = 10 + Math.floor(r() * 14);
	for (let i = 0; i < dots; i++)
		ctx.s.push({
			t: 'circle',
			cx: round(r() * w),
			cy: round(r() * h * (poster ? 0.7 : 1)),
			r: round(between(r, 0.6, 2.2)),
			fill: pick(r, [p.glow, ...p.tones]),
			opacity: round(between(r, 0.4, 0.9))
		});
}

function motifSlash(ctx: Ctx) {
	const { r, w, h, p } = ctx;
	const angle = between(r, -34, -18);
	const tan = Math.tan((angle * Math.PI) / 180);
	const bands = 3 + Math.floor(r() * 3);
	for (let i = 0; i < bands; i++) {
		const y = h * between(r, 0.05, 0.75);
		const bw = h * between(r, 0.015, 0.12);
		const color = p.tones[i % 3];
		ctx.g.push({
			id: `slash${i}`,
			type: 'linear',
			x1: 0,
			y1: 0,
			x2: 1,
			y2: 0,
			stops: [
				{ offset: 0, color, opacity: 0 },
				{ offset: between(r, 0.35, 0.65), color, opacity: 0.85 },
				{ offset: 1, color, opacity: 0 }
			]
		});
		const dy = tan * w;
		ctx.s.push({
			t: 'path',
			d: `M0 ${round(y)} L${w} ${round(y + dy)} L${w} ${round(y + dy + bw)} L0 ${round(y + bw)} Z`,
			fill: `grad:slash${i}`,
			opacity: round(between(r, 0.4, 0.85)),
			blend: 'screen'
		});
	}
	// Bright cut line with flare.
	const ly = h * between(r, 0.2, 0.5);
	const fx = w * between(r, 0.3, 0.7);
	ctx.s.push({
		t: 'path',
		d: `M0 ${round(ly)} L${w} ${round(ly + tan * w)}`,
		stroke: p.glow,
		strokeWidth: 0.8,
		opacity: 0.9
	});
	ctx.s.push({
		t: 'circle',
		cx: fx,
		cy: ly + tan * fx,
		r: Math.min(w, h) * 0.35,
		fill: radial(ctx, 'flare', p.glow, 0.5)
	});
	const sparks = 14 + Math.floor(r() * 10);
	for (let i = 0; i < sparks; i++) {
		const sx = fx + between(r, -0.35, 0.35) * w;
		const sy = ly + tan * sx + between(r, -0.18, 0.18) * h;
		const len = between(r, 2, 7);
		ctx.s.push({
			t: 'path',
			d: `M${round(sx)} ${round(sy)} l${round(len)} ${round(len * tan)}`,
			stroke: pick(r, [p.glow, p.tones[1]]),
			strokeWidth: 0.6,
			opacity: round(between(r, 0.4, 0.9))
		});
	}
}

const MOTIFS: Record<Motif, (ctx: Ctx) => void> = {
	prism: motifPrism,
	eclipse: motifEclipse,
	horizon: motifHorizon,
	shafts: motifShafts,
	orbits: motifOrbits,
	bloom: motifBloom,
	slash: motifSlash
};

export interface SceneOptions {
	format: ArtFormat;
	genres?: readonly string[];
	/** Force a family (e.g. genre tiles). */
	family?: GenreFamily;
	/** Force a motif. */
	motif?: Motif;
}

/** Build a deterministic scene for `seedKey` (usually title.id). */
export function buildScene(seedKey: string, opts: SceneOptions): Scene {
	const r = rng(hashString(seedKey));
	const family = opts.family ?? genreFamily(opts.genres ?? []);
	const palette = pick(r, PALETTES[family]);
	const motif = opts.motif ?? pick(r, FAMILY_MOTIFS[family]);
	const { w, h } = FORMAT_SIZE[opts.format];
	const ctx: Ctx = { r, w, h, p: palette, poster: opts.format === 'poster', g: [], s: [] };

	// Base: angled background gradient.
	const tilt = between(r, -0.25, 0.25);
	ctx.g.push({
		id: 'base',
		type: 'linear',
		x1: 0.5 + tilt,
		y1: 0,
		x2: 0.5 - tilt,
		y2: 1,
		stops: [
			{ offset: 0, color: palette.bg[0] },
			{ offset: 0.55, color: palette.bg[1] },
			{ offset: 1, color: palette.bg[0] }
		]
	});
	ctx.s.push({ t: 'rect', x: 0, y: 0, w, h, fill: 'grad:base' });

	// Ambient colour light.
	const a = pick(r, [0, 1, 2] as const);
	ctx.s.push({
		t: 'circle',
		cx: round(w * between(r, -0.1, 1.1)),
		cy: round(h * between(r, -0.1, 0.6)),
		r: round(Math.max(w, h) * between(r, 0.7, 1)),
		fill: radial(ctx, 'amb1', palette.tones[a], 0.42)
	});
	ctx.s.push({
		t: 'circle',
		cx: round(w * between(r, -0.1, 1.1)),
		cy: round(h * between(r, 0.4, 1.1)),
		r: round(Math.max(w, h) * between(r, 0.5, 0.8)),
		fill: radial(ctx, 'amb2', palette.tones[(a + 1) % 3], 0.26)
	});

	MOTIFS[motif](ctx);

	// Vignette.
	ctx.g.push({
		id: 'vignette',
		type: 'radial',
		cx: 0.5,
		cy: 0.45,
		r: 0.75,
		stops: [
			{ offset: 0.55, color: '#000000', opacity: 0 },
			{ offset: 1, color: '#000000', opacity: 0.55 }
		]
	});
	ctx.s.push({ t: 'rect', x: 0, y: 0, w, h, fill: 'grad:vignette' });

	return {
		w,
		h,
		palette,
		family,
		motif,
		gradients: ctx.g,
		shapes: ctx.s,
		align: r() < 0.55 ? 'middle' : 'start',
		caps: r() < 0.6
	};
}

// ---------------------------------------------------------------------------
// Poster typography
// ---------------------------------------------------------------------------

export interface TitleLayout {
	lines: string[];
	size: number;
	lineHeight: number;
	tracking: number;
}

/** Fit a title into `maxWidth` SVG units with up to 4 lines, largest size first. */
export function layoutTitle(title: string, maxWidth: number, caps: boolean): TitleLayout {
	const text = caps ? title.toUpperCase() : title;
	const words = text.split(/\s+/).filter(Boolean);
	const charW = caps ? 0.7 : 0.58;
	const tracking = caps ? 0.04 : -0.02;
	for (const maxLines of [3, 4]) {
		for (let size = 34; size >= 11; size--) {
			const maxChars = Math.floor(maxWidth / (size * (charW + tracking)));
			if (words.some((w) => w.length > maxChars)) continue;
			const lines: string[] = [];
			let cur = '';
			for (const word of words) {
				const next = cur ? `${cur} ${word}` : word;
				if (next.length > maxChars && cur) {
					lines.push(cur);
					cur = word;
				} else cur = next;
			}
			if (cur) lines.push(cur);
			if (lines.length <= maxLines)
				return { lines, size, lineHeight: caps ? 0.96 : 1.04, tracking };
		}
	}
	return { lines: [text], size: 11, lineHeight: 1, tracking };
}
