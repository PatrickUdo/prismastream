// Authenticated streaming CORS proxy for the web build (IPTV servers rarely send CORS headers).
// Only GET/HEAD, only http(s), only public addresses (DNS is resolved and checked on connect),
// manual redirects (re-validated), a response size cap, timeouts, and HLS playlist rewriting so
// relative segment urls keep going through the proxy.
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { Readable, Transform } from 'node:stream';
import { BlockedAddressError, createSafeLookup, hostAllowed } from './ssrf.ts';

export interface ProxyOptions {
	allowPrivate: boolean;
	maxBytes: number;
	timeoutMs: number;
	/** e.g. https://sync.example.com/v1/proxy/<token>?url= */
	selfPrefix: string;
	rewriteHls: boolean;
	method: 'GET' | 'HEAD';
	headers: Record<string, string | undefined>;
	signal?: AbortSignal;
}

export class ProxyError extends Error {
	status: number;
	code: string;
	constructor(status: number, code: string, message: string) {
		super(message);
		this.status = status;
		this.code = code;
	}
}

const FORWARD_REQ = [
	'range',
	'if-range',
	'if-none-match',
	'if-modified-since',
	'accept',
	'user-agent'
];
const FORWARD_RES = [
	'content-type',
	'content-length',
	'content-range',
	'accept-ranges',
	'content-encoding',
	'last-modified',
	'etag',
	'cache-control',
	'expires'
];
const MAX_REDIRECTS = 5;
const HLS_MAX_BYTES = 8 * 1024 * 1024;

export function parseTarget(raw: string | undefined, allowPrivate: boolean): URL {
	if (!raw) throw new ProxyError(400, 'missing_url', 'Query parameter "url" is required');
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		throw new ProxyError(400, 'invalid_url', 'Invalid url');
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:')
		throw new ProxyError(400, 'invalid_scheme', 'Only http and https are allowed');
	if (!hostAllowed(url.hostname, allowPrivate))
		throw new ProxyError(403, 'blocked_address', 'Target address is not allowed');
	return url;
}

function doRequest(url: URL, opts: ProxyOptions): Promise<IncomingMessage> {
	return new Promise((resolve, reject) => {
		const headers: Record<string, string> = {};
		for (const h of FORWARD_REQ) {
			const v = opts.headers[h];
			if (v) headers[h] = v;
		}
		headers['accept-encoding'] = 'identity';
		if (!headers['user-agent']) headers['user-agent'] = 'PrismaStream-Proxy/1.0';
		const fn = url.protocol === 'https:' ? httpsRequest : httpRequest;
		const req = fn(url, {
			method: opts.method,
			headers,
			lookup: createSafeLookup(opts.allowPrivate) as never,
			timeout: opts.timeoutMs,
			signal: opts.signal
		});
		req.on('timeout', () =>
			req.destroy(new ProxyError(504, 'upstream_timeout', 'Upstream timeout'))
		);
		req.on('response', resolve);
		req.on('error', (err) => {
			if (err instanceof ProxyError) return reject(err);
			if (err instanceof BlockedAddressError || (err as { code?: string }).code === 'EBLOCKED')
				return reject(new ProxyError(403, 'blocked_address', 'Target address is not allowed'));
			if ((err as { name?: string }).name === 'AbortError')
				return reject(new ProxyError(499, 'client_closed', 'Client closed request'));
			reject(new ProxyError(502, 'upstream_error', 'Upstream request failed'));
		});
		req.end();
	});
}

function isHlsCandidate(res: IncomingMessage, url: URL): boolean {
	const ct = String(res.headers['content-type'] ?? '').toLowerCase();
	if (res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity')
		return false;
	if (ct.includes('mpegurl')) return true;
	return /\.m3u8$/i.test(url.pathname) && !ct.startsWith('video/');
}

/** Rewrites every URI in an HLS playlist to an absolute url that goes through the proxy. */
export function rewritePlaylist(text: string, base: URL, selfPrefix: string): string {
	const wrap = (ref: string) => {
		let abs: string;
		try {
			abs = new URL(ref, base).toString();
		} catch {
			return ref;
		}
		if (abs.startsWith(selfPrefix.split('?')[0])) return abs;
		return selfPrefix + encodeURIComponent(abs);
	};
	return text
		.split(/\r?\n/)
		.map((line) => {
			const l = line.trim();
			if (!l) return line;
			if (l.startsWith('#')) return line.replace(/URI="([^"]+)"/g, (_m, u) => `URI="${wrap(u)}"`);
			return wrap(l);
		})
		.join('\n');
}

function limiter(max: number) {
	let seen = 0;
	return new Transform({
		transform(chunk: Buffer, _enc, cb) {
			seen += chunk.length;
			if (seen > max) return cb(new ProxyError(502, 'too_large', 'Upstream response too large'));
			cb(null, chunk);
		}
	});
}

/** Performs the upstream request (following redirects) and returns a streaming Response. */
export async function proxyFetch(target: URL, opts: ProxyOptions): Promise<Response> {
	let url = target;
	let res: IncomingMessage | undefined;
	for (let i = 0; ; i++) {
		res = await doRequest(url, opts);
		const status = res.statusCode ?? 502;
		if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) {
			res.resume();
			if (i >= MAX_REDIRECTS) throw new ProxyError(508, 'too_many_redirects', 'Too many redirects');
			url = parseTarget(new URL(res.headers.location, url).toString(), opts.allowPrivate);
			continue;
		}
		break;
	}
	const upstream = res;
	const len = Number(upstream.headers['content-length']);
	if (Number.isFinite(len) && len > opts.maxBytes) {
		upstream.destroy();
		throw new ProxyError(502, 'too_large', 'Upstream response too large');
	}

	const headers = new Headers();
	for (const h of FORWARD_RES) {
		const v = upstream.headers[h];
		if (typeof v === 'string') headers.set(h, v);
	}
	headers.set('x-content-type-options', 'nosniff');
	// Nginx (Proxy Manager): pass video bytes through without buffering them.
	headers.set('x-accel-buffering', 'no');
	const status = upstream.statusCode ?? 502;

	if (opts.method === 'HEAD' || status === 304 || status === 204) {
		upstream.resume();
		return new Response(null, { status, headers });
	}

	// Idle timeout while streaming the body.
	upstream.setTimeout(opts.timeoutMs * 2, () =>
		upstream.destroy(new ProxyError(504, 'upstream_timeout', 'Upstream idle timeout'))
	);

	if (opts.rewriteHls && status === 200 && isHlsCandidate(upstream, url)) {
		const chunks: Buffer[] = [];
		let size = 0;
		let ended = false;
		const it = upstream[Symbol.asyncIterator]();
		while (size <= HLS_MAX_BYTES) {
			const r = await it.next();
			if (r.done) {
				ended = true;
				break;
			}
			chunks.push(r.value as Buffer);
			size += (r.value as Buffer).length;
		}
		const head = Buffer.concat(chunks);
		if (ended) {
			const text = head.toString('utf8');
			if (text.trimStart().startsWith('#EXTM3U') && text.includes('#EXT-X-')) {
				const body = rewritePlaylist(text, url, opts.selfPrefix);
				headers.delete('content-length');
				headers.set('content-type', 'application/vnd.apple.mpegurl');
				headers.set('cache-control', 'no-store');
				return new Response(body, { status, headers });
			}
			return new Response(head, { status, headers });
		}
		// Too large for a playlist: stream what we buffered followed by the rest.
		const rest = Readable.from(
			(async function* () {
				yield head;
				for (let r = await it.next(); !r.done; r = await it.next()) yield r.value as Buffer;
			})()
		);
		return new Response(Readable.toWeb(rest.pipe(limiter(opts.maxBytes))) as ReadableStream, {
			status,
			headers
		});
	}

	const body = upstream.pipe(limiter(opts.maxBytes));
	upstream.on('error', (err) => body.destroy(err));
	return new Response(Readable.toWeb(body) as ReadableStream, { status, headers });
}
