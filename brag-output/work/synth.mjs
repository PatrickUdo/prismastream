// Synthesises the soundtrack (music + SFX as one mix) to audio.wav: 48 kHz stereo, 23 s.
// Key D minor, 96 BPM. Effects share the music's reverb bus and key.
import { writeFileSync } from 'node:fs';

const SR = 48000;
const DUR = 23.0;
const N = Math.round(SR * DUR);
const L = new Float32Array(N);
const R = new Float32Array(N);
const sendL = new Float32Array(N); // reverb bus
const sendR = new Float32Array(N);

const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);
const BEAT = 60 / 96;
let seed = 1234567;
const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296) * 2 - 1;

function add(i, l, r, send = 0) {
	if (i < 0 || i >= N) return;
	L[i] += l;
	R[i] += r;
	sendL[i] += l * send;
	sendR[i] += r * send;
}
const panLR = (pan) => [Math.cos(((pan + 1) * Math.PI) / 4), Math.sin(((pan + 1) * Math.PI) / 4)];

/** Soft pad note: few detuned partials, slow attack/release, gentle lowpass via partial weights. */
function pad(m, t0, t1, amp, pan = 0) {
	const [gl, gr] = panLR(pan);
	const f = midi(m);
	const atk = 0.9;
	const rel = 1.2;
	const i0 = Math.floor(t0 * SR);
	const i1 = Math.min(N, Math.floor((t1 + rel) * SR));
	const partials = [
		[1, 1],
		[2, 0.32],
		[3, 0.12],
		[4, 0.05]
	];
	for (let i = i0; i < i1; i++) {
		const t = i / SR - t0;
		const env = Math.min(1, t / atk) * (i / SR > t1 ? Math.max(0, 1 - (i / SR - t1) / rel) : 1);
		let s = 0;
		for (const [h, w] of partials) {
			s += w * Math.sin(2 * Math.PI * f * h * 1.0015 * t) + w * Math.sin(2 * Math.PI * f * h * 0.9985 * t + 1.3);
		}
		const lfo = 0.85 + 0.15 * Math.sin(2 * Math.PI * 0.23 * t + m);
		const v = s * env * amp * lfo * 0.5;
		add(i, v * gl, v * gr, 0.55);
	}
}

/** Plucked/bell tone with exponential decay. */
function bell(m, t0, amp, decay = 1.2, pan = 0, send = 0.6, bright = 0.25) {
	const [gl, gr] = panLR(pan);
	const f = midi(m);
	const i0 = Math.floor(t0 * SR);
	const len = Math.floor(decay * 4 * SR);
	for (let k = 0; k < len; k++) {
		const t = k / SR;
		const env = Math.exp(-t / decay) * Math.min(1, t / 0.004);
		const s =
			Math.sin(2 * Math.PI * f * t) +
			bright * Math.sin(2 * Math.PI * f * 2.0 * t) * Math.exp(-t / (decay * 0.4)) +
			bright * 0.5 * Math.sin(2 * Math.PI * f * 3.01 * t) * Math.exp(-t / (decay * 0.2));
		const v = s * env * amp;
		add(i0 + k, v * gl, v * gr, send);
	}
}

/** Soft kick: sine sweep 110 -> 45 Hz. */
function kick(t0, amp) {
	const i0 = Math.floor(t0 * SR);
	let ph = 0;
	for (let k = 0; k < SR * 0.45; k++) {
		const t = k / SR;
		const f = 45 + 65 * Math.exp(-t / 0.035);
		ph += (2 * Math.PI * f) / SR;
		const v = Math.sin(ph) * Math.exp(-t / 0.16) * Math.min(1, t / 0.002) * amp;
		add(i0 + k, v, v, 0.05);
	}
}

/** Filtered noise burst (hats, whooshes, ticks). One-pole bandpass approximation. */
function noise(t0, dur, amp, { hp = 0.9, lp = 0.3, attack = 0.002, shape = 'exp', pan = 0, send = 0.3, sweep = null }) {
	const [gl, gr] = panLR(pan);
	const i0 = Math.floor(t0 * SR);
	const len = Math.floor(dur * SR);
	let lpState = 0;
	let hpPrev = 0;
	let hpState = 0;
	for (let k = 0; k < len; k++) {
		const t = k / SR;
		const x = rnd();
		const lpk = sweep ? sweep(k / len) : lp;
		lpState += lpk * (x - lpState);
		hpState = hp * (hpState + lpState - hpPrev);
		hpPrev = lpState;
		let env;
		if (shape === 'swell') env = Math.pow(Math.sin(Math.PI * (k / len)), 2);
		else if (shape === 'rise') env = Math.pow(k / len, 2.2);
		else env = Math.exp(-t / (dur / 5)) * Math.min(1, t / attack);
		const v = hpState * env * amp;
		add(i0 + k, v * gl, v * gr, send);
	}
}

/** Pitched riser: sine sliding up an octave. */
function riser(t0, t1, m0, m1, amp) {
	const i0 = Math.floor(t0 * SR);
	const len = Math.floor((t1 - t0) * SR);
	let ph = 0;
	for (let k = 0; k < len; k++) {
		const u = k / len;
		const f = midi(m0 + (m1 - m0) * u * u);
		ph += (2 * Math.PI * f) / SR;
		const v = (Math.sin(ph) + 0.3 * Math.sin(2 * ph)) * Math.pow(u, 2) * amp;
		add(i0 + k, v * 0.9, v, 0.7);
	}
}

// ---------------------------------------------------------------- arrangement
// D minor: D=62 (D4). Chords as MIDI note sets (voiced low-mid).
const Dm9 = [38, 50, 57, 60, 64, 65];
const Bbmaj7 = [34, 46, 53, 57, 62, 65];
const Gm9 = [31, 43, 50, 57, 58, 62];
const Asus = [33, 45, 52, 57, 62, 64];
const Dadd9 = [38, 50, 57, 62, 64, 65];

// Hook: low drone + tension
pad(26, 0, 3.4, 0.05);
pad(38, 0.0, 3.4, 0.04, -0.2);
pad(57, 0.6, 3.3, 0.016, 0.3);
// Plucks for each raw stream appearing (D minor pentatonic), panned by column.
const penta = [74, 77, 79, 81, 84, 86, 89, 91];
for (let i = 0; i < 16; i++) {
	const pan = [-0.55, 0, 0.55][i % 3];
	bell(penta[(i * 3) % penta.length], 0.2 + i * 0.1, 0.045, 0.35, pan, 0.45, 0.18);
}
noise(2.1, 1.3, 0.05, { shape: 'rise', sweep: (u) => 0.01 + 0.16 * u * u, send: 0.6 });
riser(2.2, 3.38, 62, 74, 0.03);

// Impact at the merge (3.4 s)
kick(3.4, 0.55);
pad(26, 3.4, 4.6, 0.06);
[62, 65, 69, 72, 76, 81].forEach((m, k) => bell(m + 12, 3.42 + k * 0.055, 0.05, 1.4, -0.4 + k * 0.16, 0.8, 0.3));
noise(3.36, 1.1, 0.03, { lp: 0.25, hp: 0.95, send: 0.9 });

// Body: chords + bass + soft beat
const sections = [
	[3.4, 6.8, Dm9],
	[6.8, 10.3, Bbmaj7],
	[10.3, 13.5, Gm9],
	[13.5, 16.7, Dm9],
	[16.7, 18.3, Bbmaj7],
	[18.3, 20.1, Asus],
	[20.1, 22.6, Dadd9]
];
for (const [a, b, chord] of sections) {
	chord.forEach((m, k) => {
		const amp = k === 0 ? 0.045 : k === 1 ? 0.03 : 0.018;
		pad(m, a, b, amp, -0.45 + (k / (chord.length - 1)) * 0.9);
	});
}
// Bass pulses on beats 1 & 3 following the chord roots.
for (const [a, b, chord] of sections.slice(0, 6)) {
	for (let t = a; t < b - 0.05; t += BEAT * 2) bell(chord[0] + 12, t, 0.07, 0.5, 0, 0.1, 0.08);
}
// Soft kick on every beat 3.4 → 20.1, hats on offbeats from 6.8.
for (let t = 3.4 + BEAT; t < 20.0; t += BEAT) kick(t, 0.22);
for (let t = 6.8 + BEAT / 2; t < 20.0; t += BEAT) noise(t, 0.06, 0.018, { lp: 0.6, hp: 0.98, send: 0.15, pan: 0.25 });
// A sparse melodic motif (prism shimmer) over the body.
const motif = [
	[5.0, 81],
	[5.6, 79],
	[6.2, 77],
	[8.6, 77],
	[9.2, 81],
	[11.0, 79],
	[11.6, 77],
	[14.0, 81],
	[17.1, 77],
	[17.6, 79],
	[19.0, 76]
];
for (const [t, m] of motif) bell(m, t, 0.03, 0.9, 0.35, 0.7, 0.2);

// Scene whooshes (low in the mix)
for (const t of [6.65, 10.15, 13.35, 16.55, 18.15, 19.95]) {
	noise(t - 0.15, 0.55, 0.022, { shape: 'swell', sweep: (u) => 0.02 + 0.12 * Math.sin(Math.PI * u), send: 0.6, pan: 0 });
}
// UI clicks (soft "tock" in key, A5) at the simulated clicks.
for (const t of [12.06, 14.24, 15.14]) {
	bell(81, t, 0.05, 0.08, 0.3, 0.5, 0.05);
	noise(t, 0.03, 0.02, { lp: 0.3, hp: 0.9, send: 0.4, pan: 0.3 });
}
// Typing ticks in search (very quiet).
for (let i = 0; i < 16; i++) noise(18.5 + i * 0.045, 0.02, 0.012, { lp: 0.4, hp: 0.95, send: 0.2, pan: -0.2 });

// Outro chime + resolve
[62, 69, 74, 76, 81].forEach((m, k) => bell(m + 12, 20.25 + k * 0.09, 0.045, 2.2, -0.3 + k * 0.15, 0.85, 0.25));
kick(20.15, 0.4);
pad(26, 20.1, 22.4, 0.05);

// ---------------------------------------------------------------- reverb (Schroeder)
function reverb(input, combs, aps) {
	const out = new Float32Array(N);
	for (const [d, g] of combs) {
		const buf = new Float32Array(d);
		let idx = 0;
		let lp = 0;
		for (let i = 0; i < N; i++) {
			const y = buf[idx];
			lp = y * 0.7 + lp * 0.3; // damping
			buf[idx] = input[i] + lp * g;
			idx = (idx + 1) % d;
			out[i] += y;
		}
	}
	for (const [d, g] of aps) {
		const buf = new Float32Array(d);
		let idx = 0;
		for (let i = 0; i < N; i++) {
			const b = buf[idx];
			const y = -g * out[i] + b;
			buf[idx] = out[i] + g * y;
			idx = (idx + 1) % d;
			out[i] = y;
		}
	}
	return out;
}
const rvL = reverb(sendL, [[1557, 0.84], [1617, 0.83], [1491, 0.84], [1422, 0.85]], [[225, 0.5], [556, 0.5]]);
const rvR = reverb(sendR, [[1580, 0.84], [1640, 0.83], [1514, 0.84], [1445, 0.85]], [[248, 0.5], [579, 0.5]]);

// ---------------------------------------------------------------- mix, fade, soft-clip, write
const out = new Int16Array(N * 2);
let peak = 0;
const mixL = new Float32Array(N);
const mixR = new Float32Array(N);
for (let i = 0; i < N; i++) {
	const t = i / SR;
	const fade = Math.min(1, t / 0.05) * (t > 21.6 ? Math.max(0, 1 - (t - 21.6) / 1.4) : 1);
	mixL[i] = (L[i] + rvL[i] * 0.16) * fade;
	mixR[i] = (R[i] + rvR[i] * 0.16) * fade;
	peak = Math.max(peak, Math.abs(mixL[i]), Math.abs(mixR[i]));
}
const gain = 0.89 / peak;
for (let i = 0; i < N; i++) {
	out[i * 2] = Math.round(Math.tanh(mixL[i] * gain) * 32767);
	out[i * 2 + 1] = Math.round(Math.tanh(mixR[i] * gain) * 32767);
}
const header = Buffer.alloc(44);
header.write('RIFF', 0);
header.writeUInt32LE(36 + out.byteLength, 4);
header.write('WAVE', 8);
header.write('fmt ', 12);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20);
header.writeUInt16LE(2, 22);
header.writeUInt32LE(SR, 24);
header.writeUInt32LE(SR * 4, 28);
header.writeUInt16LE(4, 32);
header.writeUInt16LE(16, 34);
header.write('data', 36);
header.writeUInt32LE(out.byteLength, 40);
writeFileSync(new URL('./audio.wav', import.meta.url), Buffer.concat([header, Buffer.from(out.buffer)]));
console.log('peak', peak.toFixed(3), 'gain', gain.toFixed(3));
