// Incremental splitter for big JSON lists (Xtream get_vod_streams & co.): feeds text or bytes in
// arbitrary chunks and hands out every element of the root container as soon as it is complete,
// without ever holding the whole document.
//
// - A small state machine tracks strings and escapes (`\"`, `\\`, `\/`, `\uXXXX`) across chunk
//   boundaries, so braces/brackets inside strings never count.
// - Bytes are decoded with a streaming UTF-8 decoder (multi-byte characters split over chunks).
// - Root may be an array (`[{…},{…}]`) or an object whose values are the items
//   (`{"1":{…},"2":{…}}`). Only object/array elements are reported.
// - A single element that does not parse is skipped and counted (its byte offset is kept for
//   logging, never its content). A broken overall structure (not JSON, or cut off) is an error.
import { StringDecoder } from 'node:string_decoder';

export class JsonListError extends Error {
	/** Start of the body (for a "not JSON" message); empty otherwise. */
	readonly head: string;
	constructor(message: string, head = '') {
		super(message);
		this.name = 'JsonListError';
		this.head = head;
	}
}

export class JsonListSplitter {
	readonly #onItem: (item: unknown) => void;
	#decoder = new StringDecoder('utf8');
	#buf = '';
	#pos = 0;
	/** Characters consumed before #buf[0] (for offsets in messages). */
	#base = 0;
	#depth = 0;
	#inStr = false;
	#esc = false;
	#started = false;
	#done = false;
	#itemStart = -1;
	#head = '';
	count = 0;
	skipped = 0;
	/** Character offsets of skipped elements (at most 20). */
	skippedAt: number[] = [];

	constructor(onItem: (item: unknown) => void) {
		this.#onItem = onItem;
	}

	get done(): boolean {
		return this.#done;
	}

	/** Feed bytes (decoded as streaming UTF-8) or already decoded text. */
	push(chunk: Uint8Array | string) {
		const text = typeof chunk === 'string' ? chunk : this.#decoder.write(chunk as Buffer);
		if (!text || this.#done) return;
		if (!this.#started && this.#head.length < 200) this.#head += text.slice(0, 200);
		this.#buf += text;
		this.#scan();
	}

	#scan() {
		const buf = this.#buf;
		let pos = this.#pos;
		for (; pos < buf.length; pos++) {
			const c = buf.charCodeAt(pos);
			if (this.#inStr) {
				if (this.#esc) this.#esc = false;
				else if (c === 92 /* \ */) this.#esc = true;
				else if (c === 34 /* " */) this.#inStr = false;
				continue;
			}
			if (!this.#started) {
				if (c === 0xfeff || c === 32 || c === 9 || c === 10 || c === 13) continue;
				if (c === 91 /* [ */ || c === 123 /* { */) {
					this.#started = true;
					this.#depth = 1;
					continue;
				}
				throw new JsonListError('not a JSON list', this.#head);
			}
			if (c === 34) {
				this.#inStr = true;
				continue;
			}
			if (c === 123 || c === 91) {
				if (this.#depth === 1) this.#itemStart = pos;
				this.#depth++;
			} else if (c === 125 /* } */ || c === 93 /* ] */) {
				this.#depth--;
				if (this.#depth === 1 && this.#itemStart >= 0) {
					const text = buf.slice(this.#itemStart, pos + 1);
					const at = this.#base + this.#itemStart;
					this.#itemStart = -1;
					let item: unknown;
					let ok = true;
					try {
						item = JSON.parse(text);
					} catch {
						ok = false;
						this.skipped++;
						if (this.skippedAt.length < 20) this.skippedAt.push(at);
					}
					if (ok) {
						this.count++;
						this.#onItem(item);
					}
				} else if (this.#depth === 0) {
					this.#done = true;
					this.#buf = '';
					this.#pos = 0;
					return;
				} else if (this.#depth < 0) {
					throw new JsonListError('unbalanced JSON');
				}
			}
		}
		// Keep only the unfinished element.
		if (this.#itemStart >= 0) {
			this.#base += this.#itemStart;
			this.#buf = buf.slice(this.#itemStart);
			this.#pos = pos - this.#itemStart;
			this.#itemStart = 0;
		} else {
			this.#base += buf.length;
			this.#buf = '';
			this.#pos = 0;
		}
	}

	/** End of input: throws when the document was not JSON or was cut off. */
	end(): { count: number; skipped: number } {
		const tail = this.#decoder.end();
		if (tail) this.push(tail);
		if (!this.#started) throw new JsonListError('empty or not JSON', this.#head);
		if (!this.#done) throw new JsonListError('JSON list is cut off');
		return { count: this.count, skipped: this.skipped };
	}
}
