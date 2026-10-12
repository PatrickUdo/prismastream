// Plain-language messages for source errors reported by the backend (test, add, refresh).
// The codes follow the provider errors of the shared engine (#lib/providers/errors.ts) plus
// the server's own codes; unknown codes fall back to the server message.
import { BackendError, BackendOfflineError } from './client.ts';

export interface ErrorMessage {
	/** i18n key */
	key: string;
	params?: Record<string, string | number>;
	/** Server text, used when no key fits. */
	fallback?: string;
	/** Technical reason for the "Details" block. */
	detail?: string;
}

const CODE_KEYS: [RegExp, string][] = [
	[
		/^(auth|invalid_credentials|bad_credentials|unauthorized|forbidden_upstream)$/,
		'cloud.source.error.auth'
	],
	[/^(expired|account_expired|disabled|banned)$/, 'cloud.source.error.expired'],
	[
		/^(unreachable|dns|connect|econnrefused|enotfound|network|upstream_error)$/,
		'cloud.source.error.unreachable'
	],
	[/^(timeout|upstream_timeout|etimedout)$/, 'cloud.source.error.timeout'],
	[/^(tls|ssl|certificate)$/, 'cloud.source.error.tls'],
	[/^(invalid|invalid_response|not_xtream|bad_response)$/, 'cloud.source.error.invalid'],
	[/^(not_found|playlist_not_found)$/, 'cloud.source.error.notFound'],
	[/^(empty|empty_playlist|no_content)$/, 'cloud.source.error.empty'],
	[/^(too_large|payload_too_large)$/, 'cloud.source.error.tooLarge'],
	[/^(blocked_address|private_address)$/, 'cloud.source.error.blocked'],
	[/^(invalid_url|invalid_scheme|missing_url)$/, 'cloud.source.error.url'],
	[/^(max_connections|too_many_connections)$/, 'cloud.source.error.connections'],
	[/^(rate_limited)$/, 'cloud.error.rateLimited'],
	[/^(source_limit|too_many_sources|quota_exceeded)$/, 'cloud.source.error.limit']
];

function dateText(ms: number, locale: string): string {
	return new Intl.DateTimeFormat(locale === 'nl' ? 'nl-NL' : 'en-GB', {
		day: 'numeric',
		month: 'long',
		year: 'numeric'
	}).format(new Date(ms));
}

/** Message for an error code (+ optional details such as an HTTP status or expiry date). */
export function sourceErrorMessage(
	code: string | undefined,
	opts: { message?: string; status?: number; expiresAt?: number; locale?: string } = {}
): ErrorMessage {
	const c = (code ?? '').toLowerCase();
	if (c === 'http' || /^http_\d+$/.test(c)) {
		const status = opts.status ?? Number(c.slice(5));
		if (status === 401 || status === 403) return { key: 'cloud.source.error.auth' };
		if (status === 404) return { key: 'cloud.source.error.notFound' };
		return { key: 'cloud.source.error.http', params: { status: status || '?' } };
	}
	for (const [re, key] of CODE_KEYS) {
		if (!re.test(c)) continue;
		if (key === 'cloud.source.error.expired' && opts.expiresAt)
			return {
				key: 'cloud.source.error.expiredOn',
				params: { date: dateText(opts.expiresAt, opts.locale ?? 'nl') }
			};
		return { key };
	}
	return { key: 'cloud.source.error.generic', fallback: opts.message };
}

/** Message for anything thrown while talking to the backend about sources. */
export function sourceErrorFromException(err: unknown, locale = 'nl'): ErrorMessage {
	return { ...sourceErrorBase(err, locale), detail: errorDetail(err) };
}

function sourceErrorBase(err: unknown, locale: string): ErrorMessage {
	if (err instanceof BackendOfflineError)
		return { key: err.reason === 'timeout' ? 'cloud.error.timeout' : 'cloud.error.offline' };
	if (err instanceof BackendError) {
		const b = err.body ?? {};
		const expiresAt = typeof b.expiresAt === 'number' ? b.expiresAt : undefined;
		const status = typeof b.status === 'number' ? b.status : undefined;
		if (err.status === 401 && (err.code === 'unauthorized' || err.code === 'http_401'))
			return { key: 'cloud.error.unauthorized' };
		if (err.status === 429) return { key: 'cloud.error.rateLimited' };
		return sourceErrorMessage(err.code, { message: err.message, status, expiresAt, locale });
	}
	return { key: 'cloud.error.internal', fallback: (err as Error)?.message };
}

const TEXT_CODES: [RegExp, string][] = [
	[
		/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|EHOSTUNREACH|niet bereikbaar|unreachable|fetch failed/i,
		'unreachable'
	],
	[/timeout|time-out|ETIMEDOUT|reageert niet/i, 'timeout'],
	[/certificate|CERT_|SSL|TLS/i, 'tls'],
	[/verlopen|expired|banned|disabled|geblokkeerd/i, 'expired'],
	[/\b(401|403)\b|auth|wachtwoord|password|credentials/i, 'auth'],
	[/\b404\b|not found|niet gevonden/i, 'not_found'],
	[/blocked|privé|private address/i, 'blocked_address'],
	[/ontsleuteld|decrypt/i, 'secret']
];

/**
 * Plain-language text for a free-form `lastError` from the server (it only stores a message).
 * Returns null when no pattern fits (show the server text then).
 */
export function sourceErrorFromText(text: string): ErrorMessage | null {
	for (const [re, code] of TEXT_CODES) {
		if (!re.test(text)) continue;
		if (code === 'secret') return { key: 'cloud.source.error.secret' };
		const m = sourceErrorMessage(code);
		return m.key === 'cloud.source.error.generic' ? null : m;
	}
	return null;
}

/** Remove anything secret-looking from a technical message (tokens, query strings, auth). */
export function redactDetail(text: string): string {
	return text
		.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer ***')
		.replace(/\b(pst|ppx|pt|pdc)_[A-Za-z0-9_-]+/g, '$1_***')
		.replace(/\/v1\/play\/[^/\s]+/g, '/v1/play/***')
		.replace(/\?[^\s"']*/g, '?***')
		.replace(/\/\/[^/\s:@]+:[^/\s@]+@/g, '//***:***@')
		.slice(0, 500);
}

/** Technical reason of an error for the "Details" block (never contains tokens). */
export function errorDetail(err: unknown): string {
	if (!err) return '';
	if (err instanceof BackendOfflineError)
		return redactDetail(`${err.name} (${err.reason}) ${err.detail}`);
	if (err instanceof BackendError) {
		const b = err.body ?? {};
		const msg = typeof b.message === 'string' ? b.message : err.message;
		return redactDetail(`HTTP ${err.status} ${err.code}${msg ? `: ${msg}` : ''}`);
	}
	if (err instanceof Error) return redactDetail(`${err.name}: ${err.message}`);
	return redactDetail(String(err));
}
