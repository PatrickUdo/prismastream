<!--
	Sources in remote mode (PrismaStream Cloud): managed through /v1/sources. Credentials go
	over TLS to the server and are never kept on this device. Shows the server build status,
	lets you add (with a test), edit, enable/disable, refresh and remove sources, and offers
	once to move sources that still live on this device to the cloud.
-->
<script lang="ts">
	import { onDestroy } from 'svelte';
	import { t, i18n } from '#lib/i18n/index.svelte.ts';
	import { library } from '#lib/catalog/library.svelte.ts';
	import type { RemoteSource, SourceInputBody, SourceTestResponse } from '#lib/backend/types.ts';
	import {
		sourceErrorFromException,
		sourceErrorFromText,
		sourceErrorMessage,
		type ErrorMessage
	} from '#lib/backend/errors.ts';
	import { sources, removeSource, type SourceEntry } from '#lib/sources/index.svelte.ts';
	import { credentials } from '#lib/sources/credentials.ts';
	import Button from '#lib/components/Button.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import Modal from '#lib/components/Modal.svelte';
	import ErrorDetails from '#lib/components/ErrorDetails.svelte';

	interface FormState {
		id?: string;
		type: 'xtream' | 'm3u';
		name: string;
		serverUrl: string;
		username: string;
		password: string;
		playlistUrl: string;
		epgUrl: string;
	}

	let list = $state<RemoteSource[] | null>(null);
	let loadError = $state<ErrorMessage | null>(null);
	let form = $state<FormState | null>(null);
	let formOpen = $state(false);
	let formError = $state<ErrorMessage | null>(null);
	let test = $state<SourceTestResponse | null>(null);
	let testing = $state(false);
	let saving = $state(false);
	let busy = $state<Record<string, boolean>>({});
	let confirmTarget = $state<RemoteSource | null>(null);
	let confirmOpen = $state(false);

	function msg(m: ErrorMessage | null): string {
		if (!m) return '';
		const text = t(m.key, m.params);
		return m.fallback && m.key === 'cloud.source.error.generic' ? `${text} (${m.fallback})` : text;
	}

	async function load() {
		try {
			list = (await library.client.sources()).filter((s) => s && s.type !== 'sample');
			loadError = null;
		} catch (err) {
			loadError = sourceErrorFromException(err, i18n.locale);
		}
	}

	$effect(() => {
		void library.version;
		void load();
	});

	// While the server builds, refresh the list (status, counts) every few seconds.
	const building = $derived(library.meta?.status === 'building');
	let timer: ReturnType<typeof setInterval> | undefined;
	$effect(() => {
		clearInterval(timer);
		if (building) timer = setInterval(() => void load(), 5000);
		return () => clearInterval(timer);
	});
	onDestroy(() => clearInterval(timer));

	function fmtDate(ms: number): string {
		return new Intl.DateTimeFormat(i18n.locale === 'nl' ? 'nl-NL' : 'en-GB', {
			dateStyle: 'medium',
			timeStyle: 'short'
		}).format(new Date(ms));
	}
	const fmtNum = (n: number) => new Intl.NumberFormat(i18n.locale).format(n);

	function errorOf(s: RemoteSource): string | null {
		if (!s.lastError) return null;
		const coded = sourceErrorMessage(s.lastError, {
			expiresAt: s.account?.expiresAt,
			locale: i18n.locale
		});
		if (coded.key !== 'cloud.source.error.generic') return t(coded.key, coded.params);
		const fromText = sourceErrorFromText(s.lastError);
		return fromText ? t(fromText.key, fromText.params) : s.lastError;
	}

	// ---- form ------------------------------------------------------------------------------

	function openAdd(type: 'xtream' | 'm3u' = 'xtream') {
		form = {
			type,
			name: '',
			serverUrl: '',
			username: '',
			password: '',
			playlistUrl: '',
			epgUrl: ''
		};
		formError = null;
		test = null;
		formOpen = true;
	}

	function openEdit(s: RemoteSource) {
		form = {
			id: s.id,
			type: s.type === 'm3u' ? 'm3u' : 'xtream',
			name: s.name,
			serverUrl: s.serverUrl ?? '',
			username: s.username ?? '',
			password: '',
			playlistUrl: '',
			epgUrl: s.epgUrl ?? ''
		};
		formError = null;
		test = null;
		formOpen = true;
	}

	function bodyOf(f: FormState): SourceInputBody {
		const trim = (v: string) => v.trim() || undefined;
		return f.type === 'xtream'
			? {
					type: 'xtream',
					name: trim(f.name),
					serverUrl: trim(f.serverUrl),
					username: trim(f.username),
					password: f.password || undefined,
					epgUrl: trim(f.epgUrl)
				}
			: {
					type: 'm3u',
					name: trim(f.name),
					playlistUrl: trim(f.playlistUrl),
					epgUrl: trim(f.epgUrl)
				};
	}

	function validate(f: FormState): ErrorMessage | null {
		const url = (v: string) => /^https?:\/\/\S+$/i.test(v.trim());
		if (f.type === 'xtream') {
			if (!url(f.serverUrl)) return { key: 'cloud.source.error.url' };
			if (!f.username.trim()) return { key: 'cloud.source.form.needUser' };
			if (!f.id && !f.password) return { key: 'cloud.source.form.needPassword' };
		} else if (!f.id && !url(f.playlistUrl)) return { key: 'cloud.source.error.url' };
		if (f.epgUrl.trim() && !url(f.epgUrl)) return { key: 'cloud.source.error.url' };
		return null;
	}

	async function runTest() {
		if (!form) return;
		formError = validate(form);
		if (formError) return;
		testing = true;
		test = null;
		try {
			test = await library.client.testSource(bodyOf(form));
		} catch (err) {
			formError = sourceErrorFromException(err, i18n.locale);
		} finally {
			testing = false;
		}
	}

	async function save(e: SubmitEvent) {
		e.preventDefault();
		if (!form) return;
		formError = validate(form);
		if (formError) return;
		saving = true;
		try {
			const body = bodyOf(form);
			if (form.id) {
				const patch: Record<string, unknown> = { name: body.name, epgUrl: body.epgUrl ?? '' };
				if (form.type === 'xtream') {
					patch.serverUrl = body.serverUrl;
					patch.username = body.username;
					if (body.password) patch.password = body.password;
				} else if (body.playlistUrl) patch.playlistUrl = body.playlistUrl;
				await library.client.updateSource(form.id, patch);
			} else {
				await library.client.addSource({
					...body,
					name: body.name || defaultName(form)
				});
			}
			formOpen = false;
			form = null;
			await load();
			library.poke();
		} catch (err) {
			formError = sourceErrorFromException(err, i18n.locale);
		} finally {
			saving = false;
		}
	}

	function defaultName(f: FormState): string {
		try {
			return new URL(f.type === 'xtream' ? f.serverUrl : f.playlistUrl).hostname;
		} catch {
			return f.type === 'xtream' ? 'Xtream' : 'M3U';
		}
	}

	async function act(s: RemoteSource, fn: () => Promise<unknown>) {
		busy = { ...busy, [s.id]: true };
		try {
			await fn();
			await load();
			library.poke();
		} catch (err) {
			loadError = sourceErrorFromException(err, i18n.locale);
		} finally {
			busy = { ...busy, [s.id]: false };
		}
	}

	const toggle = (s: RemoteSource) =>
		act(s, () => library.client.updateSource(s.id, { enabled: !s.enabled }));
	const refreshOne = (s: RemoteSource) =>
		act(s, () => library.client.refreshCatalog({ sourceId: s.id, force: true }));

	async function confirmRemove() {
		const target = confirmTarget;
		confirmOpen = false;
		confirmTarget = null;
		if (target) await act(target, () => library.client.removeSource(target.id));
	}

	let refreshingAll = $state(false);
	async function refreshAll() {
		refreshingAll = true;
		try {
			await library.refresh({ force: true });
		} catch (err) {
			loadError = sourceErrorFromException(err, i18n.locale);
		} finally {
			refreshingAll = false;
		}
	}

	// ---- move local sources to the cloud (once) -------------------------------------------

	const MOVE_KEY = 'ps:sources:moveDismissed';
	let moveDismissed = $state(readDismissed());
	function readDismissed() {
		try {
			return localStorage.getItem(MOVE_KEY) === '1';
		} catch {
			return false;
		}
	}
	const localSources = $derived(
		sources.list.filter(
			(s) =>
				s.type !== 'sample' &&
				!(s.type === 'm3u' && (s.localFileName || s.playlistUrl?.startsWith('local:')))
		)
	);
	let moving = $state(false);
	let moveConfirm = $state(false);
	let moveResult = $state<{ ok: number; failed: string[] } | null>(null);

	async function moveToCloud() {
		moveConfirm = false;
		moving = true;
		const failed: string[] = [];
		let ok = 0;
		for (const s of $state.snapshot(localSources) as SourceEntry[]) {
			try {
				const secret = await credentials.load(s.id);
				const body: SourceInputBody & { name: string } =
					s.type === 'xtream'
						? {
								type: 'xtream',
								name: s.name,
								serverUrl: s.serverUrl,
								username: s.username,
								password: secret.password,
								epgUrl: secret.epgUrl ?? s.epgUrl
							}
						: {
								type: 'm3u',
								name: s.name,
								playlistUrl: secret.playlistUrl ?? (s.type === 'm3u' ? s.playlistUrl : ''),
								epgUrl: secret.epgUrl ?? (s.type === 'm3u' ? s.epgUrl : undefined)
							};
				await library.client.addSource(body);
				// Only after the server has it: remove it (and its password) from this device.
				await removeSource(s.id);
				ok++;
			} catch {
				failed.push(s.name);
			}
		}
		moving = false;
		moveResult = { ok, failed };
		if (!failed.length) dismissMove();
		await load();
		library.poke();
	}

	function dismissMove() {
		moveDismissed = true;
		try {
			localStorage.setItem(MOVE_KEY, '1');
		} catch {
			// ignore
		}
	}

	const progress = $derived(
		typeof library.meta?.progress === 'number' ? Math.round(library.meta.progress * 100) : null
	);
</script>

<div class="page sources-page">
	<header class="head">
		<div>
			<p class="eyebrow">{t('cloud.name')}</p>
			<h1>{t('sources.title')}</h1>
			<p class="sub">{t('cloud.sources.subtitle')}</p>
		</div>
		<div class="head-actions">
			<Button
				icon="refresh"
				disabled={refreshingAll || building}
				onclick={refreshAll}
				data-focusable
			>
				{t('sources.refreshAll')}
			</Button>
			<Button variant="primary" icon="plus" onclick={() => openAdd()} data-focusable>
				{t('sources.add')}
			</Button>
		</div>
	</header>

	{#if library.meta}
		<div class="build glass" role="status">
			{#if library.meta.status === 'building'}
				<span class="spinner" aria-hidden="true"></span>
				<p>
					{t('cloud.build.building')}{#if progress !== null}&nbsp;· {progress}%{/if}
				</p>
				{#if progress !== null}
					<span class="bar" aria-hidden="true"><span style:width="{progress}%"></span></span>
				{/if}
			{:else if library.meta.status === 'error'}
				<Icon name="alert" size="1.1rem" />
				<p>{t('cloud.build.error')} {library.meta.error ?? ''}</p>
			{:else if library.meta.status === 'ready'}
				<Icon name="check" size="1.1rem" />
				<p>
					{t('cloud.build.ready', {
						movies: fmtNum(library.meta.counts.movies),
						series: fmtNum(library.meta.counts.series),
						channels: fmtNum(library.meta.counts.channels)
					})}
					{#if library.meta.builtAt}· {fmtDate(library.meta.builtAt)}{/if}
				</p>
			{:else}
				<Icon name="info" size="1.1rem" />
				<p>{t('cloud.build.empty')}</p>
			{/if}
		</div>
	{/if}

	<p class="notice glass">
		<Icon name="lock" size="1.1rem" /> <span>{t('cloud.sources.privacy')}</span>
	</p>

	{#if localSources.length && !moveDismissed}
		<section class="move glass">
			<h2>{t('cloud.move.title')}</h2>
			<p>{t('cloud.move.body', { n: localSources.length })}</p>
			{#if moveResult}
				<p class={moveResult.failed.length ? 'bad' : 'ok'} role="status">
					{t('cloud.move.result', { n: moveResult.ok })}
					{#if moveResult.failed.length}{t('cloud.move.failed', {
							names: moveResult.failed.join(', ')
						})}{/if}
				</p>
			{/if}
			<div class="actions">
				{#if moveConfirm}
					<Button variant="primary" disabled={moving} onclick={moveToCloud} data-focusable>
						{t('cloud.move.confirm')}
					</Button>
					<Button variant="ghost" onclick={() => (moveConfirm = false)} data-focusable>
						{t('common.cancel')}
					</Button>
				{:else}
					<Button
						variant="primary"
						icon="cloud"
						disabled={moving}
						onclick={() => (moveConfirm = true)}
						data-focusable
					>
						{moving ? t('cloud.move.busy') : t('cloud.move.action')}
					</Button>
					<Button variant="ghost" onclick={dismissMove} data-focusable
						>{t('cloud.move.later')}</Button
					>
				{/if}
			</div>
		</section>
	{/if}

	{#if loadError}
		<p class="notice warn glass" role="alert">
			<Icon name="alert" size="1.1rem" /> <span>{msg(loadError)}</span>
		</p>
		<ErrorDetails text={loadError.detail} />
	{/if}

	{#if list === null && !loadError}
		<p class="muted">{t('common.loading')}</p>
	{:else if list && list.length === 0}
		<div class="empty glass">
			<Icon name="source" size="2rem" />
			<h2>{t('cloud.empty.title')}</h2>
			<p>{t('cloud.sources.emptyBody')}</p>
			<div class="actions">
				<Button variant="primary" icon="plus" onclick={() => openAdd('xtream')} data-focusable
					>Xtream</Button
				>
				<Button variant="glass" icon="plus" onclick={() => openAdd('m3u')} data-focusable
					>M3U</Button
				>
			</div>
		</div>
	{:else if list}
		<ul class="list">
			{#each list as s (s.id)}
				{@const err = errorOf(s)}
				<li class="card glass" class:off={!s.enabled}>
					<div class="top">
						<div class="title">
							<span class="type">{s.type === 'm3u' ? 'M3U' : 'Xtream'}</span>
							<h2>{s.name}</h2>
						</div>
						<span class="state {err ? 'bad' : s.enabled ? 'ok' : ''}">
							{err
								? t('cloud.source.state.error')
								: s.enabled
									? t('cloud.source.state.on')
									: t('cloud.source.state.off')}
						</span>
					</div>
					<p class="meta">
						{#if s.serverUrl}<span>{s.serverUrl}</span>{/if}
						{#if s.playlistUrl}<span>{s.playlistUrl}</span>{/if}
						{#if s.username}<span>{s.username}</span>{/if}
					</p>
					{#if s.stats}
						<p class="meta">
							{t('sources.test.counts', {
								movies: fmtNum(s.stats.movies ?? 0),
								series: fmtNum(s.stats.series ?? 0),
								channels: fmtNum(s.stats.channels ?? 0)
							})}
						</p>
					{/if}
					{#if s.account?.expiresAt}
						<p class="meta">{t('cloud.source.expires', { date: fmtDate(s.account.expiresAt) })}</p>
					{/if}
					{#if s.lastSyncAt}
						<p class="meta">{t('cloud.source.synced', { date: fmtDate(s.lastSyncAt) })}</p>
					{/if}
					{#if err}<p class="bad" title={s.lastError}>
							<Icon name="alert" size="1rem" />
							{err}
						</p>{/if}
					<div class="actions">
						<Button
							size="s"
							variant="glass"
							disabled={busy[s.id]}
							onclick={() => toggle(s)}
							data-focusable
						>
							{s.enabled ? t('cloud.source.disable') : t('cloud.source.enable')}
						</Button>
						<Button
							size="s"
							variant="glass"
							icon="refresh"
							disabled={busy[s.id] || !s.enabled}
							onclick={() => refreshOne(s)}
							data-focusable
						>
							{t('cloud.source.refresh')}
						</Button>
						<Button size="s" variant="glass" icon="edit" onclick={() => openEdit(s)} data-focusable>
							{t('cloud.source.edit')}
						</Button>
						<Button
							size="s"
							variant="ghost"
							icon="trash"
							onclick={() => ((confirmTarget = s), (confirmOpen = true))}
							data-focusable
						>
							{t('cloud.source.remove')}
						</Button>
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<Modal
	bind:open={formOpen}
	label={form?.id ? t('sources.edit') : t('sources.add')}
	onclose={() => (form = null)}
>
	{#if form}
		<form class="form" onsubmit={save} novalidate>
			<h2>{form.id ? t('sources.edit') : t('sources.add')}</h2>
			{#if !form.id}
				<div class="seg" role="radiogroup" aria-label={t('cloud.source.form.type')}>
					{#each ['xtream', 'm3u'] as ty (ty)}
						<button
							type="button"
							role="radio"
							aria-checked={form.type === ty}
							class:active={form.type === ty}
							onclick={() => form && ((form.type = ty as 'xtream' | 'm3u'), (test = null))}
							data-focusable
						>
							{ty === 'xtream' ? 'Xtream Codes' : 'M3U'}
						</button>
					{/each}
				</div>
			{/if}
			<label class="field">
				<span>{t('cloud.source.form.name')}</span>
				<input type="text" bind:value={form.name} autocomplete="off" data-focusable />
			</label>
			{#if form.type === 'xtream'}
				<label class="field">
					<span>{t('cloud.source.form.server')}</span>
					<input
						type="url"
						inputmode="url"
						placeholder="http://"
						bind:value={form.serverUrl}
						autocomplete="off"
						spellcheck="false"
						data-focusable
					/>
				</label>
				<label class="field">
					<span>{t('cloud.source.form.username')}</span>
					<input
						type="text"
						bind:value={form.username}
						autocomplete="off"
						autocapitalize="off"
						spellcheck="false"
						data-focusable
					/>
				</label>
				<label class="field">
					<span>{t('cloud.source.form.password')}</span>
					<input
						type="password"
						bind:value={form.password}
						autocomplete="new-password"
						placeholder={form.id ? t('cloud.source.form.passwordKeep') : ''}
						data-focusable
					/>
				</label>
			{:else}
				<label class="field">
					<span>{t('cloud.source.form.playlist')}</span>
					<input
						type="url"
						inputmode="url"
						placeholder={form.id ? t('cloud.source.form.playlistKeep') : 'https://'}
						bind:value={form.playlistUrl}
						autocomplete="off"
						spellcheck="false"
						data-focusable
					/>
				</label>
			{/if}
			<label class="field">
				<span>{t('cloud.source.form.epg')}</span>
				<input
					type="url"
					inputmode="url"
					bind:value={form.epgUrl}
					autocomplete="off"
					spellcheck="false"
					data-focusable
				/>
			</label>
			<p class="hint">{t('cloud.sources.privacy')}</p>

			{#if formError}
				<p class="bad" role="alert"><Icon name="alert" size="1rem" /> {msg(formError)}</p>
				<ErrorDetails text={formError.detail} />
			{/if}
			{#if test}
				{#if test.ok}
					<p class="ok" role="status">
						<Icon name="check" size="1rem" />
						{t('sources.test.ok')} ·
						{t('sources.test.counts', {
							movies: fmtNum(test.movies),
							series: fmtNum(test.series),
							channels: fmtNum(test.channels)
						})}
						{#if test.expiresAt}· {t('cloud.source.expires', {
								date: fmtDate(test.expiresAt)
							})}{/if}
					</p>
				{:else}
					<p class="bad" role="alert">
						<Icon name="alert" size="1rem" />
						{msg(sourceErrorMessage(test.code, { message: test.message, locale: i18n.locale }))}
					</p>
				{/if}
			{/if}

			<div class="actions">
				<Button variant="glass" disabled={testing || saving} onclick={runTest} data-focusable>
					{testing ? t('cloud.source.testing') : t('cloud.source.test')}
				</Button>
				<Button variant="primary" type="submit" disabled={saving} data-focusable>
					{saving ? t('cloud.source.saving') : t('common.save')}
				</Button>
			</div>
		</form>
	{/if}
</Modal>

<Modal
	bind:open={confirmOpen}
	label={t('sources.confirm.title')}
	onclose={() => (confirmTarget = null)}
>
	<div class="form">
		<h2>{t('sources.confirm.title')}</h2>
		<p>{t('cloud.source.removeBody', { name: confirmTarget?.name ?? '' })}</p>
		<div class="actions">
			<Button variant="primary" onclick={confirmRemove} data-focusable
				>{t('cloud.source.remove')}</Button
			>
			<Button variant="ghost" onclick={() => (confirmOpen = false)} data-focusable
				>{t('common.cancel')}</Button
			>
		</div>
	</div>
</Modal>

<style>
	.sources-page {
		display: grid;
		gap: 1.25rem;
		max-width: 60rem;
	}
	.head {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		align-items: flex-end;
		gap: 1rem;
	}
	h1 {
		font-size: var(--text-2xl);
		margin-top: 0.35rem;
	}
	.sub {
		color: var(--text-2);
		margin-top: 0.4rem;
	}
	.head-actions,
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
	}
	.build,
	.notice {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.6rem;
		padding: 0.8rem 1rem;
		border-radius: var(--radius-m);
		color: var(--text-2);
		min-width: 0;
	}
	.build p,
	.notice span {
		flex: 1 1 12rem;
		min-width: 0;
	}
	.warn {
		color: var(--rating);
	}
	.bar {
		flex: 1 1 100%;
		height: 0.3rem;
		border-radius: 999px;
		background: rgb(255 255 255 / 0.08);
		overflow: hidden;
	}
	.bar span {
		display: block;
		height: 100%;
		background: var(--accent);
		transition: width var(--dur) var(--ease-out);
	}
	.spinner {
		width: 1rem;
		height: 1rem;
		border-radius: 50%;
		border: 2px solid var(--line-strong);
		border-top-color: var(--accent);
		animation: spin 0.9s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	.move,
	.empty {
		display: grid;
		gap: 0.75rem;
		padding: 1.25rem;
		border-radius: var(--radius-l);
		min-width: 0;
	}
	.empty {
		justify-items: center;
		text-align: center;
		padding: 2.5rem 1.25rem;
	}
	.move h2,
	.empty h2 {
		font-size: var(--text-l);
	}
	.list {
		display: grid;
		gap: 0.9rem;
		list-style: none;
		padding: 0;
	}
	.card {
		display: grid;
		gap: 0.5rem;
		padding: 1.1rem 1.25rem;
		border-radius: var(--radius-l);
		min-width: 0;
	}
	.card.off {
		opacity: 0.7;
	}
	.top {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		align-items: flex-start;
	}
	.title {
		min-width: 0;
	}
	.title h2 {
		font-size: var(--text-l);
		overflow-wrap: anywhere;
	}
	.type {
		color: var(--text-3);
		font-size: var(--text-s);
		font-weight: 650;
	}
	.state {
		padding: 0.2rem 0.6rem;
		border-radius: var(--radius-pill);
		background: rgb(255 255 255 / 0.06);
		font-size: var(--text-s);
		font-weight: 650;
		white-space: nowrap;
	}
	.state.ok,
	.ok {
		color: var(--success);
	}
	.state.bad,
	.bad {
		color: var(--danger);
	}
	.ok,
	.bad {
		display: flex;
		gap: 0.4rem;
		align-items: flex-start;
	}
	.meta {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.9rem;
		color: var(--text-3);
		font-size: var(--text-s);
		overflow-wrap: anywhere;
		min-width: 0;
	}
	.muted,
	.hint {
		color: var(--text-3);
		font-size: var(--text-s);
	}
	.form {
		display: grid;
		gap: 0.9rem;
		min-width: 0;
	}
	.form h2 {
		font-size: var(--text-l);
	}
	.field {
		display: grid;
		gap: 0.35rem;
		min-width: 0;
	}
	.field span {
		font-weight: 650;
		font-size: var(--text-s);
	}
	.field input {
		width: 100%;
		min-width: 0;
		min-height: 2.75rem;
		padding: 0 0.9rem;
		border-radius: var(--radius-m);
		border: 1px solid var(--line-strong);
		background: rgb(255 255 255 / 0.04);
		color: var(--text);
		font: inherit;
	}
	.field input:focus-visible {
		outline: none;
		box-shadow: var(--focus-ring);
	}
	.seg {
		display: inline-flex;
		gap: 0.3rem;
		padding: 0.25rem;
		border-radius: var(--radius-pill);
		border: 1px solid var(--line);
		justify-self: start;
	}
	.seg button {
		min-height: 2.4rem;
		padding: 0 1rem;
		border: 0;
		border-radius: var(--radius-pill);
		background: none;
		color: var(--text-2);
		font-weight: 650;
	}
	.seg button.active {
		background: var(--bg-elev-3);
		color: var(--text);
	}
</style>
