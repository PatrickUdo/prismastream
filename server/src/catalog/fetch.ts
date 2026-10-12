// Upstream HTTP for IPTV sources (Xtream API, M3U, XMLTV, get_series_info).
//
// - Only http(s); every hop (redirects included, max 5) is SSRF-checked: literal IPs before
//   connecting and resolved addresses inside the socket lookup (no DNS-rebinding window).
//   PROXY_ALLOW_PRIVATE lifts the check (tests / closed LAN only).
// - Timeouts for connect+headers and for an idle body; retries with backoff for network
//   errors, 5xx and 429 (only before the body starts).
// - Bodies are streamed (gzip/deflate/br decoded) with a hard byte cap.
// - Errors carry a UI-friendly code and never contain credentials (urls are redacted).
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { Readable, Transform } from 'node:stream';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import { BlockedAddressError, createSafeLookup, hostAllowed } from '../ssrf.ts';
import { HttpError, redactText, redactUrl } from './core.ts';

export type SourceErrorCode =
	| 'unreachable'
	| 'timeout'
	| 'auth'
	| 'expired'
	| 'banned_ip'
	| 'invalid_response'
	| 'too_large'
	| 'blocked_address'
	| 'http'
	| 'aborted'
	| 'config';

/** Error with a code the UI can turn into text. `message` never contains credentials. */
export class SourceError extends Error {
	readonly code: SourceErrorCode;
	readonly status?: number;
	/** For 'expired': when the account expired (epoch ms), if known. */
	readonly expiresAt?: number;
	constructor(
		code: SourceErrorCode,
		message: string,
		opts: { status?: number; expiresAt?: number } = {}
	) {
		super(message);
		this.name = 'SourceError';
		this.code = code;
		this.status = opts.status;
		this.expiresAt = opts.expiresAt;
	}
}

/** Any thrown value → SourceError with a credential-free message. */
export function toSourceError(err: unknown, secrets: string[] = []): SourceError {
	if (err instanceof SourceError) return err;
	if (err instanceof HttpError) {
		const map: Record<string, SourceErrorCode> = {
			auth: 'auth',
			expired: 'expired',
			unreachable: 'unreachable',
			timeout: 'timeout',
			invalid: 'invalid_response',
			http: 'http',
			aborted: 'aborted'
		};
		return new SourceError(map[err.code] ?? 'http', redactText(err.message, secrets), {
			status: err.status
		});
	}
	const msg = err instanceof Error ? err.message : String(err);
	return new SourceError('invalid_response', redactText(msg, secrets).slice(0, 300));
}

export interface FetchOptions {
	allowPrivate: boolean;
	/** Connect + response headers (per attempt). The idle body timeout is 2×. */
	timeoutMs: number;
	/** Cap on the decoded body. */
	maxBytes: number;
	/** Extra strings to mask in error messages. */
	secrets?: string[];
	userAgent?: string;
	/** Extra attempts after the first (network errors, 5xx, 429). Default 2. */
	retries?: number;
	signal?: AbortSignal;
	accept?: string;
}

export interface Upstream {
	body: Readable;
	url: URL;
	status: number;
	headers: IncomingMessage['headers'];
}

const MAX_REDIRECTS = 5;

function checkTarget(raw: string, allowPrivate: boolean, safe: string): URL {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		throw new SourceError('config', `Ongeldige url: ${safe}`);
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:')
		throw new SourceError('config', `Alleen http en https: ${safe}`);
	if (!hostAllowed(url.hostname, allowPrivate))
		throw new SourceError('blocked_address', `Adres niet toegestaan: ${safe}`);
	return url;
}

function rawRequest(url: URL, opts: FetchOptions, safe: string): Promise<IncomingMessage> {
	return new Promise((resolve, reject) => {
		const fn = url.protocol === 'https:' ? httpsRequest : httpRequest;
		const headers: Record<string, string> = {
			'user-agent': opts.userAgent ?? 'PrismaStream/1.0',
			accept: opts.accept ?? '*/*',
			'accept-encoding': 'gzip, deflate, br'
		};
		// Userinfo (http://user:pass@host/...) becomes basic auth, as browsers do.
		if (url.username || url.password)
			headers.authorization =
				'Basic ' +
				Buffer.from(
					`${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`
				).toString('base64');
		const req = fn(url, {
			method: 'GET',
			headers,
			lookup: createSafeLookup(opts.allowPrivate) as never,
			timeout: opts.timeoutMs,
			signal: opts.signal
		});
		const timer = setTimeout(
			() => req.destroy(new SourceError('timeout', `Time-out na ${opts.timeoutMs} ms: ${safe}`)),
			opts.timeoutMs
		);
		req.on('timeout', () =>
			req.destroy(new SourceError('timeout', `Time-out na ${opts.timeoutMs} ms: ${safe}`))
		);
		req.on('response', (res) => {
			clearTimeout(timer);
			resolve(res);
		});
		req.on('error', (err) => {
			clearTimeout(timer);
			if (err instanceof SourceError) return reject(err);
			if (err instanceof BlockedAddressError || (err as { code?: string }).code === 'EBLOCKED')
				return reject(new SourceError('blocked_address', `Adres niet toegestaan: ${safe}`));
			if ((err as { name?: string }).name === 'AbortError')
				return reject(new SourceError('aborted', 'Afgebroken'));
			const code = (err as { code?: string }).code ?? '';
			if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT')
				return reject(new SourceError('timeout', `Time-out: ${safe}`));
			reject(
				new SourceError(
					'unreachable',
					`Server niet bereikbaar (${code || 'netwerkfout'}): ${safe}`
				)
			);
		});
		req.end();
	});
}

function statusError(status: number, safe: string): SourceError {
	if (status === 401) return new SourceError('auth', `HTTP 401 (inloggen geweigerd): ${safe}`, { status });
	if (status === 403)
		return new SourceError(
			'banned_ip',
			`HTTP 403 (toegang geweigerd; mogelijk is het IP-adres van de server geblokkeerd): ${safe}`,
			{ status }
		);
	if (status === 404) return new SourceError('http', `HTTP 404 (niet gevonden): ${safe}`, { status });
	return new SourceError('http', `HTTP ${status}: ${safe}`, { status });
}

function retryable(e: SourceError): boolean {
	if (e.code === 'unreachable' || e.code === 'timeout') return true;
	return e.code === 'http' && !!e.status && (e.status >= 500 || e.status === 429 || e.status === 408);
}

function limiter(max: number, safe: string) {
	let seen = 0;
	return new Transform({
		transform(chunk: Buffer, _enc, cb) {
			seen += chunk.length;
			if (seen > max)
				return cb(
					new SourceError('too_large', `Antwoord groter dan ${Math.round(max / 1048576)} MB: ${safe}`)
				);
			cb(null, chunk);
		}
	});
}

/** One GET (redirects followed and re-checked), 2xx only. The body is decoded and capped. */
async function openOnce(raw: string, opts: FetchOptions): Promise<Upstream> {
	const secrets = opts.secrets ?? [];
	let safe = redactUrl(raw, secrets);
	let url = checkTarget(raw, opts.allowPrivate, safe);
	let res: IncomingMessage;
	for (let hop = 0; ; hop++) {
		res = await rawRequest(url, opts, safe);
		const status = res.statusCode ?? 502;
		if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) {
			res.resume();
			if (hop >= MAX_REDIRECTS) throw new SourceError('http', `Te veel redirects: ${safe}`);
			const next = new URL(res.headers.location, url).toString();
			safe = redactUrl(next, secrets);
			url = checkTarget(next, opts.allowPrivate, safe);
			continue;
		}
		break;
	}
	const status = res.statusCode ?? 502;
	if (status < 200 || status >= 300) {
		res.resume();
		throw statusError(status, safe);
	}
	const len = Number(res.headers['content-length']);
	const enc = String(res.headers['content-encoding'] ?? '').toLowerCase();
	if (!enc && Number.isFinite(len) && len > opts.maxBytes) {
		res.destroy();
		throw new SourceError('too_large', `Antwoord groter dan ${Math.round(opts.maxBytes / 1048576)} MB: ${safe}`);
	}
	res.setTimeout(opts.timeoutMs * 2, () =>
		res.destroy(new SourceError('timeout', `Download stokt: ${safe}`))
	);
	let body: Readable = res;
	const decoder =
		enc === 'gzip' || enc === 'x-gzip'
			? createGunzip()
			: enc === 'deflate'
				? createInflate()
				: enc === 'br'
					? createBrotliDecompress()
					: undefined;
	if (decoder) {
		res.on('error', (e) => decoder.destroy(e));
		body = res.pipe(decoder);
	}
	const capped = limiter(opts.maxBytes, safe);
	body.on('error', (e) => capped.destroy(e instanceof SourceError ? e : toSourceError(e, secrets)));
	body.pipe(capped);
	return { body: capped, url, status, headers: res.headers };
}

/** GET with retries; resolves once headers arrived (the body is a stream). */
export async function openUpstream(url: string, opts: FetchOptions): Promise<Upstream> {
	const retries = opts.retries ?? 2;
	let last: SourceError | undefined;
	for (let i = 0; i <= retries; i++) {
		try {
			return await openOnce(url, opts);
		} catch (err) {
			last = toSourceError(err, opts.secrets);
			if (i === retries || !retryable(last) || opts.signal?.aborted) break;
			await new Promise((r) => setTimeout(r, 500 * 2 ** i * (0.75 + Math.random() * 0.5)));
		}
	}
	throw last!;
}

/** Async iterator of UTF-8 text chunks (multi-byte safe). */
export async function* textChunks(body: Readable, secrets: string[] = []): AsyncGenerator<string> {
	body.setEncoding('utf8');
	try {
		for await (const chunk of body) yield chunk as string;
	} catch (err) {
		throw toSourceError(err, secrets);
	}
}

export async function fetchText(url: string, opts: FetchOptions): Promise<string> {
	const up = await openUpstream(url, opts);
	let out = '';
	for await (const c of textChunks(up.body, opts.secrets)) out += c;
	return out;
}

function jsonError(text: string, opts: FetchOptions, url: string): SourceError {
	const safe = redactUrl(url, opts.secrets);
	const head = redactText(text.slice(0, 80).replace(/\s+/g, ' '), opts.secrets);
	return new SourceError('invalid_response', `Geen JSON van de server (${head || 'leeg'}): ${safe}`);
}

/** GET + JSON.parse (BOM tolerant). HTML/empty bodies → invalid_response. */
export async function fetchJson<T = unknown>(url: string, opts: FetchOptions): Promise<T> {
	const text = (await fetchText(url, opts)).replace(/^﻿/, '').trim();
	if (!text || (text[0] !== '{' && text[0] !== '[')) throw jsonError(text, opts, url);
	try {
		return JSON.parse(text) as T;
	} catch {
		throw jsonError(text, opts, url);
	}
}

/**
 * Streams a (large) JSON list and calls `onItem` per element, without holding the whole text
 * or the whole parsed tree in memory. The root may be an array (`[{…},{…}]`) or an object whose
 * values are the items (`{"1":{…},"2":{…}}`, some panels do that). Only object/array items are
 * reported. A non-JSON body throws invalid_response; `{"user_info":…}`-style error objects
 * simply yield their object values (callers validate items).
 */
export async function streamJsonList(
	url: string,
	opts: FetchOptions,
	onItem: (item: unknown) => void
): Promise<number> {
	const up = await openUpstream(url, opts);
	let buf = '';
	let pos = 0;
	let depth = 0;
	let inStr = false;
	let esc = false;
	let started = false;
	let itemStart = -1;
	let count = 0;
	let head = '';
	for await (const chunk of textChunks(up.body, opts.secrets)) {
		buf += chunk;
		if (!started && head.length < 200) head += chunk;
		for (; pos < buf.length; pos++) {
			const c = buf.charCodeAt(pos);
			if (inStr) {
				if (esc) esc = false;
				else if (c === 92) esc = true;
				else if (c === 34) inStr = false;
				continue;
			}
			if (!started) {
				if (c === 0xfeff || c === 32 || c === 9 || c === 10 || c === 13) continue;
				if (c === 91 || c === 123) {
					started = true;
					depth = 1;
					continue;
				}
				up.body.destroy();
				throw jsonError(head, opts, url);
			}
			if (c === 34) {
				inStr = true;
				continue;
			}
			if (c === 123 || c === 91) {
				if (depth === 1) itemStart = pos;
				depth++;
			} else if (c === 125 || c === 93) {
				depth--;
				if (depth === 1 && itemStart >= 0) {
					const text = buf.slice(itemStart, pos + 1);
					itemStart = -1;
					try {
						onItem(JSON.parse(text));
						count++;
					} catch {
						// a malformed element: skip it
					}
				} else if (depth === 0) {
					up.body.destroy();
					return count;
				}
			}
		}
		// Keep only the unfinished item.
		if (itemStart >= 0) {
			buf = buf.slice(itemStart);
			pos -= itemStart;
			itemStart = 0;
		} else {
			buf = '';
			pos = 0;
		}
	}
	if (!started) throw jsonError(head, opts, url);
	return count;
}

/** Body bytes, gunzipped when they start with the gzip magic (e.g. .xml.gz without encoding). */
export async function* maybeGunzipText(
	body: Readable,
	secrets: string[] = [],
	maxBytes = Infinity
): AsyncGenerator<string> {
	const it = body[Symbol.asyncIterator]();
	let first: Buffer | undefined;
	try {
		for (;;) {
			const r = await it.next();
			if (r.done) return;
			const b = r.value as Buffer;
			if (b.length) {
				first = b;
				break;
			}
		}
	} catch (err) {
		throw toSourceError(err, secrets);
	}
	const rest = Readable.from(
		(async function* () {
			yield first!;
			for (let r = await it.next(); !r.done; r = await it.next()) yield r.value as Buffer;
		})()
	);
	let stream: Readable = rest;
	if (first![0] === 0x1f && first![1] === 0x8b) {
		const gz = createGunzip();
		const cap = limiter(maxBytes, 'gzip');
		rest.on('error', (e) => gz.destroy(e));
		gz.on('error', (e) => cap.destroy(e));
		stream = rest.pipe(gz).pipe(cap);
	}
	yield* textChunks(stream, secrets);
}
