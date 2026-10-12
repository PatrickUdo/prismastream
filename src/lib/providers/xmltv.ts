// Streaming XMLTV parser (saxes). Never builds a DOM, so 100+ MB guides are fine.
// Input can be a string, a byte stream (Response.body) or bytes; gzip (.xml.gz) is
// detected by its magic bytes and decompressed with DecompressionStream when available.
// Programmes are filtered to a time window and (optionally) a set of channel ids while
// parsing, so only what is needed stays in memory.
import { SaxesParser, type SaxesTagPlain } from 'saxes';
import type { EpgProgramme } from '#lib/types.ts';

export interface XmltvChannel {
	id: string;
	displayName?: string;
	icon?: string;
}

export interface XmltvOptions {
	/** Keep programmes that end after this (epoch ms). Default: now - 6 h. */
	from?: number;
	/** Keep programmes that start before this (epoch ms). Default: now + 48 h. */
	to?: number;
	/** Only keep programmes for these channel ids (case-sensitive XMLTV ids). */
	channelIds?: Set<string>;
	/** Called with the number of compressed/raw bytes consumed so far. */
	onBytes?: (n: number) => void;
	/**
	 * Streaming mode: every kept programme is handed to this callback instead of being collected
	 * (the result's `programmes` stays empty). Lets huge guides go straight to storage.
	 */
	onProgramme?: (p: EpgProgramme) => void;
	signal?: AbortSignal;
}

export interface XmltvResult {
	programmes: EpgProgramme[];
	channels: XmltvChannel[];
	/** Number of XML errors that were skipped (malformed entities etc.). */
	errors: number;
}

/**
 * XMLTV time → epoch ms. Accepts "20240101120000 +0100", "20240101120000+0100",
 * "202401011200", "20240101120000 Z" and no offset (= UTC). Returns NaN if invalid.
 */
export function parseXmltvTime(v: string | undefined): number {
	if (!v) return NaN;
	const s = v.trim();
	if (s.length < 12) return NaN;
	const d = (a: number, b: number) => {
		let n = 0;
		for (let i = a; i < b; i++) {
			const c = s.charCodeAt(i) - 48;
			if (c < 0 || c > 9) return NaN;
			n = n * 10 + c;
		}
		return n;
	};
	const Y = d(0, 4);
	const M = d(4, 6);
	const D = d(6, 8);
	const h = d(8, 10);
	const m = d(10, 12);
	let i = 12;
	let sec = 0;
	if (s.length >= 14 && /\d\d/.test(s.slice(12, 14))) {
		sec = d(12, 14);
		i = 14;
	}
	let ms = Date.UTC(Y, M - 1, D, h, m, sec);
	if (Number.isNaN(ms)) return NaN;
	const tz = s.slice(i).trim();
	const om = /^([+-])(\d{2}):?(\d{2})$/.exec(tz);
	if (om) {
		const off = (Number(om[2]) * 60 + Number(om[3])) * 60_000;
		ms -= om[1] === '+' ? off : -off;
	}
	return ms;
}

type ByteSource = ReadableStream<Uint8Array> | Uint8Array | ArrayBuffer;

async function* iterBytes(src: ByteSource): AsyncGenerator<Uint8Array> {
	if (src instanceof Uint8Array) {
		yield src;
		return;
	}
	if (src instanceof ArrayBuffer) {
		yield new Uint8Array(src);
		return;
	}
	const reader = src.getReader();
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) return;
			if (value?.byteLength) yield value;
		}
	} finally {
		reader.releaseLock();
	}
}

/** Re-wrap an async iterator of bytes as a ReadableStream. */
function toStream(first: Uint8Array, rest: AsyncGenerator<Uint8Array>): ReadableStream<Uint8Array> {
	let sentFirst = false;
	return new ReadableStream<Uint8Array>({
		async pull(ctrl) {
			if (!sentFirst) {
				sentFirst = true;
				ctrl.enqueue(first);
				return;
			}
			const { done, value } = await rest.next();
			if (done) ctrl.close();
			else ctrl.enqueue(value);
		},
		async cancel() {
			await rest.return(undefined);
		}
	});
}

/** True if the bytes start with the gzip magic number. */
export function isGzip(bytes: Uint8Array): boolean {
	return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

/** Decode a byte source (gzip-aware) into text chunks. */
async function* textChunks(src: ByteSource, onBytes?: (n: number) => void): AsyncGenerator<string> {
	const it = iterBytes(src);
	const head = await it.next();
	if (head.done) return;
	let total = 0;
	// Raw (possibly compressed) bytes, counted for progress reporting.
	const raw = (async function* () {
		total += head.value.byteLength;
		onBytes?.(total);
		yield head.value;
		for await (const c of it) {
			total += c.byteLength;
			onBytes?.(total);
			yield c;
		}
	})();
	let bytes: AsyncGenerator<Uint8Array> = raw;
	if (isGzip(head.value)) {
		if (typeof DecompressionStream === 'undefined')
			throw new Error('Gzip-compressed XMLTV is not supported on this platform');
		const first = await raw.next();
		if (first.done) return;
		const stream = toStream(first.value, raw).pipeThrough(
			new DecompressionStream('gzip') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>
		);
		bytes = iterBytes(stream);
	}
	const dec = new TextDecoder('utf-8');
	for await (const chunk of bytes) {
		const s = dec.decode(chunk, { stream: true });
		if (s) yield s;
	}
	const tail = dec.decode();
	if (tail) yield tail;
}

/** Incremental XMLTV collector: write() text chunks, then finish(). Synchronous. */
export interface XmltvCollector {
	write(chunk: string): void;
	finish(): XmltvResult;
}

export function createXmltvCollector(opts: XmltvOptions = {}): XmltvCollector {
	const now = Date.now();
	const from = opts.from ?? now - 6 * 3600_000;
	const to = opts.to ?? now + 48 * 3600_000;
	const filter = opts.channelIds && opts.channelIds.size ? opts.channelIds : undefined;

	const programmes: EpgProgramme[] = [];
	const channels: XmltvChannel[] = [];
	let errors = 0;

	// Current element state
	let prog: EpgProgramme | null = null;
	let chan: XmltvChannel | null = null;
	let field: 'title' | 'desc' | 'category' | 'display-name' | null = null;
	let text = '';

	const parser = new SaxesParser({ xmlns: false, position: false });
	parser.on('error', () => {
		errors++;
		if (errors > 10_000) throw new Error('XMLTV: too many XML errors, giving up');
	});
	parser.on('opentag', (tag: SaxesTagPlain) => {
		const a = tag.attributes as Record<string, string>;
		switch (tag.name) {
			case 'programme': {
				const channelId = a.channel?.trim();
				if (!channelId || (filter && !filter.has(channelId))) {
					prog = null;
					return;
				}
				const start = parseXmltvTime(a.start);
				let stop = parseXmltvTime(a.stop);
				if (Number.isNaN(start)) {
					prog = null;
					return;
				}
				if (Number.isNaN(stop)) stop = start + 3600_000; // missing stop: assume 1 h
				if (stop <= from || start >= to) {
					prog = null;
					return;
				}
				prog = { channelId, start, stop, title: '' };
				return;
			}
			case 'channel':
				chan = a.id ? { id: a.id.trim() } : null;
				return;
			case 'title':
			case 'desc':
			case 'category':
				if (prog) {
					field = tag.name;
					text = '';
				}
				return;
			case 'display-name':
				if (chan && !chan.displayName) {
					field = 'display-name';
					text = '';
				}
				return;
			case 'icon':
				if (prog && !prog.icon && a.src) prog.icon = a.src;
				else if (chan && !chan.icon && a.src) chan.icon = a.src;
				return;
		}
	});
	parser.on('text', (t) => {
		if (field) text += t;
	});
	parser.on('cdata', (t) => {
		if (field) text += t;
	});
	parser.on('closetag', (tag: SaxesTagPlain) => {
		switch (tag.name) {
			case 'title':
			case 'desc':
			case 'category':
				if (prog && field === tag.name) {
					const v = text.trim();
					// First value wins (often the primary language).
					if (v && !prog[field]) prog[field] = v;
				}
				field = null;
				return;
			case 'display-name':
				if (chan && field === 'display-name') chan.displayName = text.trim() || undefined;
				field = null;
				return;
			case 'programme':
				if (prog) {
					if (!prog.title) prog.title = '—';
					if (opts.onProgramme) opts.onProgramme(prog);
					else programmes.push(prog);
				}
				prog = null;
				return;
			case 'channel':
				if (chan) channels.push(chan);
				chan = null;
				return;
		}
	});

	return {
		write(chunk: string) {
			parser.write(chunk);
		},
		finish(): XmltvResult {
			parser.close();

			programmes.sort((a, b) =>
				a.channelId < b.channelId ? -1 : a.channelId > b.channelId ? 1 : a.start - b.start
			);
			return { programmes, channels, errors };
		}
	};
}

/** Parse a complete XMLTV string synchronously (no streams; used by the Apple TV core). */
export function parseXmltvText(text: string, opts: XmltvOptions = {}): XmltvResult {
	const c = createXmltvCollector(opts);
	// Feed large strings in slices to keep saxes' internal buffers small.
	const step = 1 << 20;
	for (let i = 0; i < text.length; i += step) {
		if (opts.signal?.aborted) throw new Error('aborted');
		c.write(text.slice(i, i + step));
	}
	return c.finish();
}

/** Parse XMLTV from a string, bytes or a byte stream. */
export async function parseXmltv(
	input: string | ByteSource,
	opts: XmltvOptions = {}
): Promise<XmltvResult> {
	if (typeof input === 'string') return parseXmltvText(input, opts);
	const c = createXmltvCollector(opts);
	for await (const chunk of textChunks(input, opts.onBytes)) {
		if (opts.signal?.aborted) throw new Error('aborted');
		c.write(chunk);
	}
	return c.finish();
}
