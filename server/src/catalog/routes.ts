// HTTP routes for sources and the catalog API (docs/BACKEND.md). The server is never in the path
// of a video stream: detail and channel responses carry the real upstream urls (credentials filled
// in per request, `Cache-Control: private, no-store`), and devices stream directly from the provider.
import { createHash } from 'node:crypto';
import type { Context, Hono, MiddlewareHandler } from 'hono';
import type { Env } from '../env.ts';
import type { Config } from '../config.ts';
import type { RateLimiter } from '../ratelimit.ts';
import { redactText } from './core.ts';
import { toSourceError, SourceError } from './fetch.ts';
import { epgCandidates, loadM3U, loadXtream, type TestResult } from './providers.ts';
import type { CatalogService } from './service.ts';
import {
	SAMPLE_ID,
	secretList,
	validateInput,
	type ResolvedSource,
	type SourceInput
} from './sources.ts';

export interface CatalogRouteDeps {
	config: Config;
	catalog: CatalogService;
	limiter: RateLimiter;
	auth: MiddlewareHandler<Env>;
	readJson: (c: Context) => Promise<Record<string, unknown>>;
	err: (c: Context, status: number, error: string, message?: string, extra?: object) => Response;
	tooMany: (c: Context, retry: number) => Response;
}

const JSON_TYPE = 'application/json; charset=UTF-8';
const LIST_CACHE = 'private, no-cache';

function etagOf(body: string): string {
	return `W/"${createHash('sha1').update(body).digest('base64url').slice(0, 27)}"`;
}

/**
 * JSON that contains stream urls with credentials: never cached anywhere, no ETag (an ETag would
 * let caches and conditional requests keep a copy), only for the authenticated account.
 */
export function sendPrivate(c: Context, body: string): Response {
	c.header('Cache-Control', 'private, no-store');
	c.header('Vary', 'Authorization');
	return c.body(body, 200, { 'content-type': JSON_TYPE });
}

/** JSON body with ETag; `If-None-Match` → 304. */
export function sendJson(c: Context, body: string, cache = LIST_CACHE): Response {
	const etag = etagOf(body);
	c.header('ETag', etag);
	c.header('Cache-Control', cache);
	c.header('Vary', 'Authorization');
	const inm = c.req.header('if-none-match');
	if (inm && inm.split(',').some((t) => t.trim() === etag)) return c.body(null, 304);
	return c.body(body, 200, { 'content-type': JSON_TYPE });
}

const kidsOf = (c: Context) => ['1', 'true', 'yes'].includes(c.req.query('kids') ?? '');
const intOf = (v: string | undefined, def: number, min: number, max: number) => {
	const n = Math.floor(Number(v));
	return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};
const listOf = (v: string | undefined, max: number, re = /^[^,]{1,200}$/) =>
	(v ?? '')
		.split(',')
		.map((s) => s.trim())
		.filter((s) => s && re.test(s))
		.slice(0, max);
const SLUG_RE = /^[a-z0-9-]{1,64}$/;
const LANG_RE = /^[a-z]{2,3}$/;

let testRunning: Promise<unknown> = Promise.resolve();

export function registerCatalogRoutes(app: Hono<Env>, d: CatalogRouteDeps) {
	const { catalog, limiter, err, tooMany, readJson, config } = d;
	const auth = d.auth;
	const sources = catalog.sources;
	const acc = (c: Context<Env>) => c.get('device').accountId;

	// ---- sources ----------------------------------------------------------------------

	app.get('/v1/sources', auth, (c) => {
		const list = sources.list(acc(c)).map((s) => sources.toPublic(s));
		c.header('Cache-Control', 'no-store');
		return c.json(list);
	});

	app.post('/v1/sources/test', auth, async (c) => {
		const retry = limiter.hit('srctest:' + acc(c), 10, 10 * 60_000);
		if (retry) return tooMany(c, retry);
		const body = (await readJson(c)) as SourceInput;
		let resolved: ResolvedSource;
		try {
			const v = validateInput(body, config.proxyAllowPrivate);
			resolved = {
				id: 'test',
				type: v.type,
				name: v.name,
				enabled: true,
				serverUrl: v.config.serverUrl,
				username: v.config.username,
				password: v.secret.password,
				playlistUrl: v.secret.playlistUrl,
				epgUrl: v.secret.epgUrl,
				updatedAt: 0
			};
		} catch (e) {
			const se = toSourceError(e);
			return c.json({ ok: false, code: se.code, message: se.message });
		}
		// One test at a time per process (they download whole lists).
		const run = testRunning.then(() => testSource(resolved, catalog));
		testRunning = run.catch(() => undefined);
		const result = await run;
		c.header('Cache-Control', 'no-store');
		return c.json(result);
	});

	app.post('/v1/sources', auth, async (c) => {
		const accountId = acc(c);
		const retry = limiter.hit('srcadd:' + accountId, 20, 10 * 60_000);
		if (retry) return tooMany(c, retry);
		const body = (await readJson(c)) as SourceInput;
		try {
			const v = validateInput(body, config.proxyAllowPrivate);
			const rec = sources.create(accountId, v);
			catalog.refresh(accountId, { sourceId: rec.id });
			return c.json(sources.toPublic(rec), 201);
		} catch (e) {
			const se = toSourceError(e);
			return err(
				c,
				400,
				se.code === 'blocked_address' ? 'blocked_address' : 'invalid_source',
				se.message
			);
		}
	});

	app.patch('/v1/sources/:id', auth, async (c) => {
		const accountId = acc(c);
		const id = c.req.param('id') ?? '';
		if (!sources.get(accountId, id)) return err(c, 404, 'not_found', 'Source not found');
		const body = (await readJson(c)) as SourceInput;
		try {
			const r = sources.update(accountId, id, body);
			if (r.refetch) {
				catalog.purgeSource(accountId, id);
				catalog.refresh(accountId, { sourceId: id });
			} else if (r.toggled || body.name !== undefined) catalog.refresh(accountId);
			return c.json(sources.toPublic(r.record));
		} catch (e) {
			const se = toSourceError(e);
			return err(
				c,
				400,
				se.code === 'blocked_address' ? 'blocked_address' : 'invalid_source',
				se.message
			);
		}
	});

	app.delete('/v1/sources/:id', auth, (c) => {
		const accountId = acc(c);
		const id = c.req.param('id') ?? '';
		const rec = sources.get(accountId, id);
		if (!rec) return err(c, 404, 'not_found', 'Source not found');
		if (rec.type === 'sample' || id === SAMPLE_ID) {
			// The demo library cannot be deleted, only switched off.
			sources.setEnabled(accountId, id, false);
			catalog.refresh(accountId);
			return c.json({ ok: true, disabled: true });
		}
		sources.remove(accountId, id);
		catalog.purgeSource(accountId, id);
		catalog.refresh(accountId);
		return c.json({ ok: true });
	});

	// ---- catalog ----------------------------------------------------------------------

	app.post('/v1/catalog/refresh', auth, async (c) => {
		const accountId = acc(c);
		const body = await readJson(c);
		const force = body.force === true;
		const sourceId = typeof body.sourceId === 'string' ? body.sourceId : undefined;
		if (force || sourceId) {
			const retry = limiter.hit('refresh:' + accountId, 6, 60 * 60_000);
			if (retry) return tooMany(c, retry);
		}
		if (sourceId && !sources.get(accountId, sourceId))
			return err(c, 404, 'not_found', 'Source not found');
		const st = catalog.refresh(accountId, { force, sourceId });
		return c.json({ queued: true, status: 'building', state: st.state }, 202);
	});

	app.get('/v1/catalog/meta', auth, (c) =>
		sendJson(c, JSON.stringify(catalog.meta(acc(c), kidsOf(c))))
	);

	app.get('/v1/catalog/home', auth, (c) =>
		sendJson(c, catalog.home(acc(c), kidsOf(c), intOf(c.req.query('limit'), 20, 1, 50)))
	);

	app.get('/v1/catalog/titles', auth, (c) => {
		const kids = kidsOf(c);
		const idsParam = c.req.query('ids');
		if (idsParam !== undefined)
			return sendJson(c, catalog.titlesByIds(acc(c), listOf(idsParam, 100), kids));
		const sort = c.req.query('sort') ?? 'popular';
		const genre = c.req.query('genre');
		const lang = c.req.query('lang');
		const kind = c.req.query('kind');
		if (genre && !SLUG_RE.test(genre)) return err(c, 400, 'invalid_genre', 'Invalid genre slug');
		if (lang && !LANG_RE.test(lang)) return err(c, 400, 'invalid_lang', 'Invalid language code');
		if (kind && kind !== 'movie' && kind !== 'series')
			return err(c, 400, 'invalid_kind', 'kind must be movie or series');
		return sendJson(
			c,
			catalog.titles(acc(c), {
				kind,
				genre,
				lang,
				sort: ['popular', 'new', 'az', 'year'].includes(sort) ? sort : 'popular',
				kids,
				limit: intOf(c.req.query('limit'), 60, 1, 200),
				cursor: c.req.query('cursor')
			})
		);
	});

	app.get('/v1/catalog/titles/:id', auth, async (c) => {
		const accountId = acc(c);
		const r = await catalog.title(
			accountId,
			c.req.param('id') ?? '',
			kidsOf(c),
			catalog.directMapper(accountId)
		);
		if (r.status === 404) return err(c, 404, 'not_found', 'Title not found');
		if (r.status === 403) return err(c, 403, 'kids_restricted', 'Not available in kids mode');
		return sendPrivate(c, r.body!);
	});

	app.get('/v1/catalog/search', auth, (c) => {
		const q = (c.req.query('q') ?? '').slice(0, 100);
		const limit = intOf(c.req.query('limit'), 24, 1, 48);
		return sendJson(c, JSON.stringify(catalog.search(acc(c), q, limit, kidsOf(c))));
	});

	app.post('/v1/catalog/recommend', auth, async (c) => {
		const body = await readJson(c);
		const ids = (v: unknown, max: number) =>
			(Array.isArray(v) ? v : [])
				.filter((x): x is string => typeof x === 'string' && x.length <= 200)
				.slice(0, max);
		const limit = intOf(String(body.limit ?? ''), 24, 1, 60);
		const kids = body.kids === true || body.kids === 1 || body.kids === '1';
		return sendJson(
			c,
			catalog.recommend(acc(c), ids(body.history, 200), ids(body.favorites, 500), limit, kids)
		);
	});

	app.get('/v1/catalog/channels', auth, (c) => {
		const accountId = acc(c);
		const lang = c.req.query('lang');
		if (lang && !LANG_RE.test(lang)) return err(c, 400, 'invalid_lang', 'Invalid language code');
		return sendPrivate(
			c,
			catalog.channels(
				accountId,
				{ group: c.req.query('group')?.slice(0, 200) || undefined, lang, kids: kidsOf(c) },
				catalog.directMapper(accountId)
			)
		);
	});

	app.get('/v1/catalog/epg', auth, (c) => {
		const ids = listOf(c.req.query('channels'), 50);
		const now = Date.now();
		let from = intOf(c.req.query('from'), now - 2 * 3600_000, 0, 8.64e15);
		let to = intOf(c.req.query('to'), from + 24 * 3600_000, 0, 8.64e15);
		if (to <= from) to = from + 3600_000;
		if (to - from > 48 * 3600_000) to = from + 48 * 3600_000;
		from = Math.max(0, from);
		return sendJson(c, JSON.stringify(catalog.epg(acc(c), ids, from, to)));
	});

	app.get('/v1/catalog/nownext', auth, (c) => {
		const ids = listOf(c.req.query('channels'), 200);
		return sendJson(c, JSON.stringify(catalog.nowNext(acc(c), ids)), 'private, max-age=30');
	});
}

/** POST /v1/sources/test: loads the lists without storing anything. */
async function testSource(
	src: ResolvedSource,
	catalog: CatalogService
): Promise<TestResult | { ok: false; code: string; message: string; expiresAt?: number }> {
	try {
		if (src.type === 'xtream') {
			// Counts only: the streamed items are not kept.
			const r = await loadXtream(src, catalog.limits, () => {});
			return {
				ok: true,
				movies: r.counts.movies,
				series: r.counts.series,
				channels: r.counts.channels,
				expiresAt: r.account?.expiresAt,
				status: r.account?.status,
				maxConnections: r.account?.maxConnections,
				activeConnections: r.account?.activeConnections,
				warnings: r.warnings
			};
		}
		const r = await loadM3U(src, catalog.limits, () => {});
		const epg = epgCandidates(src, r.epgUrls)[0];
		return {
			ok: true,
			movies: r.counts.movies,
			series: r.counts.series,
			channels: r.counts.channels,
			epgSuggestion: epg ? redactText(epg) : undefined,
			warnings: r.warnings
		};
	} catch (e) {
		const se = e instanceof SourceError ? e : toSourceError(e, secretList(src));
		const out: { ok: false; code: string; message: string; expiresAt?: number } = {
			ok: false,
			code: se.code,
			message: redactText(se.message, secretList(src))
		};
		if (se.expiresAt) out.expiresAt = se.expiresAt;
		return out;
	}
}
