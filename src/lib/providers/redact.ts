// Masking of credentials in urls and messages, so nothing secret ends up in logs,
// error messages or persisted state. IPTV urls carry credentials in many places:
//   http://host/get.php?username=U&password=P&type=m3u_plus      (query)
//   http://host/movie/U/P/123.mkv, /series/U/P/…, /live/U/P/…    (Xtream path)
//   http://U:P@host/playlist.m3u                                   (userinfo)

const MASK = '***';

/** Query parameter names whose values are treated as secret. */
const SECRET_PARAMS = new Set([
	'username',
	'password',
	'user',
	'pass',
	'pwd',
	'passwd',
	'token',
	'auth',
	'key',
	'apikey',
	'api_key',
	'access_token',
	'signature',
	'sig'
]);

/** Path prefixes of Xtream stream urls: /<kind>/<user>/<pass>/<id>.<ext>. */
const XTREAM_PATH = /\/(live|movie|series|timeshift|hls|play)\/([^/?#]+)\/([^/?#]+)\//i;

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Replace every occurrence of the given secret strings in `text` with `***`.
 * Also tries the url-encoded form. Secrets shorter than 3 characters are ignored
 * (masking them would garble the whole message without adding protection).
 */
export function redactSecrets(text: string, secrets: (string | undefined | null)[] = []): string {
	const list = new Set<string>();
	for (const s of secrets) {
		if (!s || s.length < 3) continue;
		list.add(s);
		const enc = encodeURIComponent(s);
		if (enc !== s) list.add(enc);
	}
	if (!list.size) return text;
	const re = new RegExp(
		[...list]
			.sort((a, b) => b.length - a.length)
			.map(escapeRegExp)
			.join('|'),
		'g'
	);
	return text.replace(re, MASK);
}

/**
 * Mask credentials in a url: userinfo, secret query parameters and the user/pass
 * segments of Xtream-style stream paths. Extra known secrets are masked too.
 * Works on anything (returns the input with secrets masked if it is not a url).
 */
export function redactUrl(url: string, secrets: (string | undefined | null)[] = []): string {
	if (!url) return url;
	let out = url;
	try {
		const u = new URL(url);
		let changed = false;
		if (u.username || u.password) {
			if (u.username) u.username = MASK;
			if (u.password) u.password = MASK;
			changed = true;
		}
		for (const name of [...u.searchParams.keys()]) {
			if (SECRET_PARAMS.has(name.toLowerCase()) && u.searchParams.get(name)) {
				u.searchParams.set(name, MASK);
				changed = true;
			}
		}
		const m = XTREAM_PATH.exec(u.pathname);
		if (m) {
			u.pathname = u.pathname.replace(XTREAM_PATH, `/${m[1]}/${MASK}/${MASK}/`);
			changed = true;
		}
		if (changed) out = u.toString().replaceAll('%2A', '*');
	} catch {
		// Not a parseable url: fall back to a textual pass for query-like fragments.
		out = out.replace(
			/([?&](?:username|password|user|pass|pwd|token|auth|key)=)[^&#\s]*/gi,
			`$1${MASK}`
		);
	}
	return redactSecrets(out, secrets);
}

/** Mask every url inside a free-form message (e.g. an error from fetch). */
export function redactText(text: string, secrets: (string | undefined | null)[] = []): string {
	const withUrls = text.replace(/\b(?:https?|rtmp|rtsp):\/\/[^\s"'<>]+/gi, (u) => redactUrl(u));
	return redactSecrets(withUrls, secrets);
}

/** Extract credential-like values from a url (query params, userinfo, Xtream path). */
export function secretsFromUrl(url: string): string[] {
	const out: string[] = [];
	try {
		const u = new URL(url);
		if (u.username) out.push(decodeURIComponent(u.username));
		if (u.password) out.push(decodeURIComponent(u.password));
		for (const [k, v] of u.searchParams) if (v && SECRET_PARAMS.has(k.toLowerCase())) out.push(v);
		const m = XTREAM_PATH.exec(u.pathname);
		if (m) out.push(decodeURIComponent(m[2]), decodeURIComponent(m[3]));
	} catch {
		// ignore
	}
	return [...new Set(out.filter(Boolean))];
}

/** True when the url contains something `redactUrl` would mask. */
export function urlHasSecrets(url: string): boolean {
	return redactUrl(url) !== url;
}
