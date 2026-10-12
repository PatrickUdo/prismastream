// Typed provider errors with credential-free messages. Kept free of platform imports so the
// pure mappers (and the Apple TV core bundle) can throw them without pulling in Capacitor.

export type HttpErrorCode =
	/** Credentials rejected (401/403, or Xtream auth: 0). */
	| 'auth'
	/** Account exists but is expired / disabled / banned. */
	| 'expired'
	/** DNS, refused connection, offline, or (in the browser) blocked by CORS/mixed content. */
	| 'unreachable'
	| 'timeout'
	/** Response arrived but is not what we expected (HTML instead of JSON, empty, malformed). */
	| 'invalid'
	/** Any other non-2xx status. */
	| 'http'
	| 'aborted';

export class HttpError extends Error {
	readonly code: HttpErrorCode;
	readonly status?: number;
	/** The request url with credentials masked. */
	readonly url?: string;

	constructor(code: HttpErrorCode, message: string, opts: { status?: number; url?: string } = {}) {
		super(message);
		this.name = 'HttpError';
		this.code = code;
		this.status = opts.status;
		this.url = opts.url;
	}
}
