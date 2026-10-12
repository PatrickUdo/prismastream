<!--
	Settings → Sources: list, add, edit, test, refresh and remove IPTV sources.
	Passwords are only held in this component while the form is open; they go
	straight to secure storage via the sources module.
-->
<script lang="ts">
	import { t, i18n } from '#lib/i18n/index.svelte.ts';
	import {
		sources,
		addSource,
		updateSource,
		removeSource,
		refreshSource,
		testSource,
		loadRawCatalogs,
		validateInput,
		type SourceEntry,
		type SourceInput,
		type SourcePatch,
		type TestResult
	} from '#lib/sources/index.svelte.ts';
	import { credentials } from '#lib/sources/credentials.ts';
	import Button from '#lib/components/Button.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import { library } from '#lib/catalog/library.svelte.ts';
	import { path } from '#lib/components/links.ts';
	import RemoteSources from './RemoteSources.svelte';
	import { kids } from '#lib/stores/kids.svelte.ts';
	import KidsLock from '#lib/components/KidsLock.svelte';

	/**
	 * Web build with a backend: IPTV servers are usually plain http and never send CORS
	 * headers, so a direct fetch from the browser fails. Sources are managed on the backend
	 * (remote mode); without an account we ask to log in first.
	 */
	const webGate = $derived(!sources.native && library.mode === 'local' && !!library.backendUrl);

	interface FormState {
		id?: string;
		type: 'xtream' | 'm3u';
		name: string;
		serverUrl: string;
		username: string;
		password: string;
		epgUrl: string;
		mode: 'url' | 'file';
		playlistUrl: string;
		file?: { name: string; text: string };
		proxyUrl: string;
	}

	let form = $state<FormState | null>(null);
	let formError = $state<string | null>(null);
	let testResult = $state<TestResult | null>(null);
	let testing = $state(false);
	let saving = $state(false);
	let showPassword = $state(false);
	let confirmTarget = $state<SourceEntry | null>(null);
	let refreshing = $state<Record<string, boolean>>({});
	let refreshingAll = $state(false);
	let proxyDraft = $state('');
	let proxySaved = $state(false);

	let formDialog = $state<HTMLDialogElement>();
	let confirmDialog = $state<HTMLDialogElement>();

	$effect(() => {
		void sources.ready.then(() => (proxyDraft = sources.proxyUrl));
	});

	$effect(() => {
		if (form && formDialog && !formDialog.open) formDialog.showModal();
		if (!form && formDialog?.open) formDialog.close();
	});
	$effect(() => {
		if (confirmTarget && confirmDialog && !confirmDialog.open) confirmDialog.showModal();
		if (!confirmTarget && confirmDialog?.open) confirmDialog.close();
	});

	const userSources = $derived(sources.list.filter((s) => s.type !== 'sample'));
	const sampleSource = $derived(sources.list.find((s) => s.type === 'sample'));

	function relTime(ms: number | undefined): string {
		if (!ms) return '';
		const diff = Date.now() - ms;
		const min = Math.round(diff / 60_000);
		if (min < 1) return t('sources.time.justNow');
		if (min < 60) return t('sources.time.minutes', { n: min });
		const h = Math.round(min / 60);
		if (h < 48) return t('sources.time.hours', { n: h });
		return t('sources.time.days', { n: Math.round(h / 24) });
	}

	function fmtDate(ms: number): string {
		return new Intl.DateTimeFormat(i18n.locale === 'nl' ? 'nl-NL' : 'en-GB', {
			day: 'numeric',
			month: 'long',
			year: 'numeric'
		}).format(ms);
	}

	function fmtNum(n: number): string {
		return new Intl.NumberFormat(i18n.locale === 'nl' ? 'nl-NL' : 'en-GB').format(n);
	}

	type Status = 'loading' | 'off' | 'error' | 'ok' | 'never';
	function statusOf(s: SourceEntry): Status {
		const p = sources.progress[s.id];
		if (refreshing[s.id] || (p && p.phase !== 'done' && p.phase !== 'error')) return 'loading';
		if (!s.enabled) return 'off';
		if (s.lastError) return 'error';
		if (s.lastSyncAt) return 'ok';
		return 'never';
	}

	function openAdd() {
		formError = null;
		testResult = null;
		showPassword = false;
		form = {
			type: 'xtream',
			name: '',
			serverUrl: '',
			username: '',
			password: '',
			epgUrl: '',
			mode: 'url',
			playlistUrl: '',
			proxyUrl: ''
		};
	}

	function openEdit(s: SourceEntry) {
		if (s.type === 'sample') return;
		formError = null;
		testResult = null;
		showPassword = false;
		form = {
			id: s.id,
			type: s.type,
			name: s.name,
			serverUrl: s.type === 'xtream' ? s.serverUrl : '',
			username: s.type === 'xtream' ? s.username : '',
			password: '',
			epgUrl: s.epgUrl ?? '',
			mode:
				s.type === 'm3u' && (s.localFileName || s.playlistUrl.startsWith('local:'))
					? 'file'
					: 'url',
			playlistUrl: s.type === 'm3u' && !s.playlistUrl.startsWith('local:') ? s.playlistUrl : '',
			proxyUrl: s.proxyUrl ?? ''
		};
	}

	function closeForm() {
		form = null;
		testResult = null;
		formError = null;
	}

	async function onFile(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!form || !file) return;
		form.file = { name: file.name, text: await file.text() };
		if (!form.name) form.name = file.name.replace(/\.(m3u8?|txt)$/i, '');
	}

	function toInput(f: FormState): SourceInput {
		if (f.type === 'xtream') {
			return {
				type: 'xtream',
				name: f.name,
				serverUrl: f.serverUrl,
				username: f.username,
				password: f.password,
				epgUrl: f.epgUrl || undefined,
				proxyUrl: f.proxyUrl || undefined
			};
		}
		return {
			type: 'm3u',
			name: f.name,
			playlistUrl: f.mode === 'url' ? f.playlistUrl : undefined,
			file: f.mode === 'file' ? f.file : undefined,
			epgUrl: f.epgUrl || undefined,
			proxyUrl: f.proxyUrl || undefined
		};
	}

	function toPatch(f: FormState): SourcePatch {
		const p: SourcePatch = { name: f.name, epgUrl: f.epgUrl, proxyUrl: f.proxyUrl };
		if (f.type === 'xtream') {
			p.serverUrl = f.serverUrl;
			p.username = f.username;
			if (f.password) p.password = f.password;
		} else if (f.mode === 'file') {
			if (f.file) p.file = f.file;
		} else {
			p.playlistUrl = f.playlistUrl;
		}
		return p;
	}

	function validate(f: FormState): string | null {
		if (f.id) {
			if (f.type === 'm3u' && f.mode === 'file' && !f.file) {
				const cur = sources.get(f.id);
				if (!(cur?.type === 'm3u' && cur.playlistUrl.startsWith('local:')))
					return t('sources.val.playlist');
				return null;
			}
			return validateInput({ ...toPatch(f), type: f.type }, false);
		}
		return validateInput(toInput(f), true);
	}

	async function runTest() {
		if (!form) return;
		formError = validate(form);
		testResult = null;
		if (formError) return;
		testing = true;
		try {
			const input = toInput(form);
			testResult = form.id
				? await testSource(
						{ ...input, id: form.id } as Parameters<typeof testSource>[0],
						form.password || undefined
					)
				: await testSource(input);
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
			if (form.id) await updateSource(form.id, toPatch(form));
			else await addSource(toInput(form));
			closeForm();
			void library.refresh();
		} catch (err) {
			formError = err instanceof Error ? err.message : String(err);
		} finally {
			saving = false;
		}
	}

	async function toggle(s: SourceEntry) {
		await updateSource(s.id, { enabled: !s.enabled });
		void library.refresh();
	}

	async function refreshOne(s: SourceEntry) {
		refreshing[s.id] = true;
		try {
			await refreshSource(s.id);
			await library.refresh();
		} finally {
			refreshing[s.id] = false;
		}
	}

	async function refreshAll() {
		refreshingAll = true;
		try {
			await loadRawCatalogs({ force: true });
			await library.refresh();
		} finally {
			refreshingAll = false;
		}
	}

	async function confirmRemove() {
		const target = confirmTarget;
		confirmTarget = null;
		if (!target) return;
		await removeSource(target.id);
		void library.refresh();
	}

	async function saveProxy(e: SubmitEvent) {
		e.preventDefault();
		await sources.setProxyUrl(proxyDraft);
		proxySaved = true;
		setTimeout(() => (proxySaved = false), 2000);
	}
</script>

<svelte:head>
	<title>{t('sources.title')} · PrismaStream</title>
</svelte:head>

{#snippet sourceCard(s: SourceEntry)}
	{@const status = statusOf(s)}
	{@const p = sources.progress[s.id]}
	<li class="card glass" class:off={!s.enabled}>
		<div class="card-head">
			<div class="type-icon" aria-hidden="true">
				<Icon name={s.type === 'xtream' ? 'monitor' : s.type === 'm3u' ? 'source' : 'sparkle'} />
			</div>
			<div class="card-title">
				<h3>{s.name}</h3>
				<p class="meta">
					<span>{t(`sources.type.${s.type}`)}</span>
					<span class="status {status}" role="status">
						<span class="dot" aria-hidden="true"></span>
						{#if status === 'loading'}
							{p ? t(`sources.phase.${p.phase}`) : t('sources.status.loading')}
							{#if p?.bytes}<span class="bytes">({(p.bytes / 1_048_576).toFixed(1)} MB)</span>{/if}
						{:else}
							{t(`sources.status.${status}`)}
						{/if}
					</span>
				</p>
			</div>
			<label class="switch">
				<input
					type="checkbox"
					role="switch"
					checked={s.enabled}
					onchange={() => toggle(s)}
					aria-label={t('sources.toggle', { name: s.name })}
					data-focusable
				/>
				<span class="track" aria-hidden="true"><span class="thumb"></span></span>
			</label>
		</div>

		{#if status === 'loading' && p && p.ratio > 0}
			<div class="bar" aria-hidden="true">
				<span style:width="{Math.round(p.ratio * 100)}%"></span>
			</div>
		{/if}

		{#if s.stats}
			<ul class="counts">
				<li>{t('sources.count.movies', { n: fmtNum(s.stats.movies) })}</li>
				<li>{t('sources.count.series', { n: fmtNum(s.stats.series) })}</li>
				<li>{t('sources.count.channels', { n: fmtNum(s.stats.channels) })}</li>
				{#if s.stats.programmes}
					<li>{t('sources.count.programmes', { n: fmtNum(s.stats.programmes) })}</li>
				{/if}
			</ul>
		{/if}

		<div class="details">
			{#if s.lastSyncAt && s.type !== 'sample'}
				<span>{t('sources.lastSync', { when: relTime(s.lastSyncAt) })}</span>
			{/if}
			{#if s.account}
				<span>
					{s.account.expiresAt
						? t('sources.expires', { date: fmtDate(s.account.expiresAt) })
						: t('sources.expiresNever')}
				</span>
				{#if s.account.maxConnections}
					<span>
						{t('sources.connections', {
							active: s.account.activeConnections ?? 0,
							max: s.account.maxConnections
						})}
					</span>
				{/if}
			{/if}
		</div>

		{#if s.lastError}
			<p class="msg error"><Icon name="alert" size="1rem" /> <span>{s.lastError}</span></p>
		{/if}
		{#if s.lastWarning && !s.lastError}
			<p class="msg warn"><Icon name="info" size="1rem" /> <span>{s.lastWarning}</span></p>
		{/if}

		{#if s.type !== 'sample'}
			<div class="actions">
				<Button
					size="s"
					icon="refresh"
					disabled={!s.enabled || status === 'loading'}
					onclick={() => refreshOne(s)}
					data-focusable>{t('sources.refresh')}</Button
				>
				<Button size="s" icon="sliders" onclick={() => openEdit(s)} data-focusable
					>{t('sources.edit')}</Button
				>
				<Button
					size="s"
					variant="ghost"
					icon="close"
					onclick={() => (confirmTarget = s)}
					data-focusable>{t('sources.remove')}</Button
				>
			</div>
		{/if}
	</li>
{/snippet}

{#if kids.restricted}
	<KidsLock />
{:else if library.mode === 'remote'}
	<RemoteSources />
{:else if webGate}
	<div class="page sources-page">
		<header class="head">
			<div>
				<p class="eyebrow">{t('nav.settings')}</p>
				<h1>{t('sources.title')}</h1>
				<p class="sub">{t('sources.subtitle')}</p>
			</div>
		</header>
		<div class="empty glass">
			<Icon name="lock" size="2rem" />
			<p><strong>{t('cloud.sources.loginTitle')}</strong></p>
			<p>{t('cloud.sources.loginBody')}</p>
			<Button variant="primary" icon="user" href={path('/settings/sync')} data-focusable>
				{t('cloud.login')}
			</Button>
		</div>
		{#if sampleSource}
			<ul class="list sample">
				{@render sourceCard(sampleSource)}
			</ul>
		{/if}
	</div>
{:else}
	<div class="page sources-page">
		<header class="head">
			<div>
				<p class="eyebrow">{t('nav.settings')}</p>
				<h1>{t('sources.title')}</h1>
				<p class="sub">{t('sources.subtitle')}</p>
			</div>
			<div class="head-actions">
				<Button
					icon="refresh"
					disabled={refreshingAll || sources.busy}
					onclick={refreshAll}
					data-focusable>{t('sources.refreshAll')}</Button
				>
				<Button variant="primary" icon="plus" onclick={openAdd} data-focusable
					>{t('sources.add')}</Button
				>
			</div>
		</header>

		<p class="notice glass"><Icon name="info" size="1.1rem" /> <span>{t('sources.legal')}</span></p>
		{#if !credentials.persistent}
			<p class="notice warn glass">
				<Icon name="alert" size="1.1rem" /> <span>{t('sources.storage.memoryOnly')}</span>
			</p>
		{/if}

		{#if userSources.length}
			<ul class="list">
				{#each userSources as s (s.id)}
					{@render sourceCard(s)}
				{/each}
			</ul>
		{:else}
			<div class="empty glass">
				<Icon name="source" size="2rem" />
				<p>{t('sources.empty')}</p>
				<Button variant="primary" icon="plus" onclick={openAdd} data-focusable
					>{t('sources.add')}</Button
				>
			</div>
		{/if}

		{#if sampleSource}
			<ul class="list sample">
				{@render sourceCard(sampleSource)}
			</ul>
		{/if}

		{#if !sources.native}
			<details class="proxy glass">
				<summary data-focusable>{t('sources.form.advanced')}</summary>
				<h2 id="proxy-title">{t('sources.proxy.title')}</h2>
				<p class="hint">{t('sources.proxy.body')}</p>
				<form class="proxy-row" onsubmit={saveProxy}>
					<label class="sr-only" for="global-proxy">{t('sources.proxy.title')}</label>
					<input
						id="global-proxy"
						type="url"
						inputmode="url"
						autocomplete="off"
						spellcheck="false"
						placeholder="http://localhost:8787/proxy?url="
						bind:value={proxyDraft}
						data-focusable
					/>
					<Button type="submit" size="s" data-focusable
						>{proxySaved ? t('sources.proxy.saved') : t('sources.proxy.save')}</Button
					>
				</form>
			</details>
		{/if}
	</div>
{/if}

<dialog
	bind:this={formDialog}
	class="dialog glass"
	aria-labelledby="source-form-title"
	onclose={() => (form = null)}
>
	{#if form}
		<form class="form" onsubmit={save} novalidate>
			<header class="dialog-head">
				<h2 id="source-form-title">{form.id ? t('sources.edit') : t('sources.add')}</h2>
				<Button
					variant="icon"
					icon="close"
					label={t('sources.form.cancel')}
					onclick={closeForm}
					data-focusable
				/>
			</header>

			{#if !form.id}
				<fieldset class="seg">
					<legend class="label">{t('sources.form.type')}</legend>
					<label class:active={form.type === 'xtream'}>
						<input type="radio" name="type" value="xtream" bind:group={form.type} data-focusable />
						{t('sources.type.xtream')}
					</label>
					<label class:active={form.type === 'm3u'}>
						<input type="radio" name="type" value="m3u" bind:group={form.type} data-focusable />
						{t('sources.type.m3u')}
					</label>
				</fieldset>
			{/if}

			<div class="field">
				<label for="sf-name" class="label">{t('sources.form.name')}</label>
				<input
					id="sf-name"
					type="text"
					bind:value={form.name}
					placeholder={t('sources.form.namePh')}
					autocomplete="off"
					data-focusable
				/>
			</div>

			{#if form.type === 'xtream'}
				<div class="field">
					<label for="sf-server" class="label">{t('sources.form.server')}</label>
					<input
						id="sf-server"
						type="url"
						inputmode="url"
						required
						autocomplete="off"
						spellcheck="false"
						bind:value={form.serverUrl}
						placeholder="http://"
						aria-describedby="sf-server-hint"
						data-focusable
					/>
					<p id="sf-server-hint" class="hint">{t('sources.form.serverHint')}</p>
				</div>
				<div class="field">
					<label for="sf-user" class="label">{t('sources.form.username')}</label>
					<input
						id="sf-user"
						type="text"
						required
						autocomplete="username"
						autocapitalize="off"
						spellcheck="false"
						bind:value={form.username}
						data-focusable
					/>
				</div>
				<div class="field">
					<label for="sf-pass" class="label">{t('sources.form.password')}</label>
					<div class="with-btn">
						<input
							id="sf-pass"
							type={showPassword ? 'text' : 'password'}
							required={!form.id}
							autocomplete={form.id ? 'current-password' : 'new-password'}
							bind:value={form.password}
							placeholder={form.id ? t('sources.form.passwordKeep') : ''}
							data-focusable
						/>
						<Button
							variant="ghost"
							size="s"
							pressed={showPassword}
							onclick={() => (showPassword = !showPassword)}
							data-focusable
							>{showPassword
								? t('sources.form.hidePassword')
								: t('sources.form.showPassword')}</Button
						>
					</div>
				</div>
			{:else}
				<fieldset class="seg">
					<legend class="label">{t('sources.form.playlistMode')}</legend>
					<label class:active={form.mode === 'url'}>
						<input type="radio" name="mode" value="url" bind:group={form.mode} data-focusable />
						{t('sources.form.modeUrl')}
					</label>
					<label class:active={form.mode === 'file'}>
						<input type="radio" name="mode" value="file" bind:group={form.mode} data-focusable />
						{t('sources.form.modeFile')}
					</label>
				</fieldset>
				{#if form.mode === 'url'}
					<div class="field">
						<label for="sf-playlist" class="label">{t('sources.form.playlist')}</label>
						<input
							id="sf-playlist"
							type="url"
							inputmode="url"
							required
							autocomplete="off"
							spellcheck="false"
							bind:value={form.playlistUrl}
							placeholder="https://…/playlist.m3u"
							data-focusable
						/>
					</div>
				{:else}
					<div class="field">
						<label for="sf-file" class="label">{t('sources.form.file')}</label>
						<input
							id="sf-file"
							type="file"
							accept=".m3u,.m3u8,audio/x-mpegurl,application/x-mpegurl,application/vnd.apple.mpegurl,text/plain"
							onchange={onFile}
							data-focusable
						/>
						{#if form.file}
							<p class="hint">{t('sources.form.fileChosen', { name: form.file.name })}</p>
						{:else if form.id}
							{@const cur = sources.get(form.id)}
							{#if cur?.localFileName}
								<p class="hint">{t('sources.form.fileChosen', { name: cur.localFileName })}</p>
							{/if}
						{/if}
					</div>
				{/if}
			{/if}

			<div class="field">
				<label for="sf-epg" class="label">{t('sources.form.epg')}</label>
				<input
					id="sf-epg"
					type="url"
					inputmode="url"
					autocomplete="off"
					spellcheck="false"
					bind:value={form.epgUrl}
					aria-describedby="sf-epg-hint"
					data-focusable
				/>
				<p id="sf-epg-hint" class="hint">{t('sources.form.epgHint')}</p>
			</div>

			{#if !sources.native}
				<details class="advanced">
					<summary data-focusable>{t('sources.form.advanced')}</summary>
					<div class="field">
						<label for="sf-proxy" class="label">{t('sources.form.proxy')}</label>
						<input
							id="sf-proxy"
							type="url"
							inputmode="url"
							autocomplete="off"
							spellcheck="false"
							bind:value={form.proxyUrl}
							placeholder={sources.proxyUrl || 'http://localhost:8787/proxy?url='}
							aria-describedby="sf-proxy-hint"
							data-focusable
						/>
						<p id="sf-proxy-hint" class="hint">{t('sources.form.proxyHint')}</p>
					</div>
				</details>
			{/if}

			{#if formError}
				<p class="msg error" role="alert">
					<Icon name="alert" size="1rem" /> <span>{formError}</span>
				</p>
			{/if}

			{#if testResult}
				<div class="test {testResult.ok ? 'ok' : 'fail'}" role="status">
					{#if testResult.ok}
						<p class="test-title"><Icon name="check" size="1rem" /> {t('sources.test.ok')}</p>
						<p>
							{t('sources.test.counts', {
								movies: fmtNum(testResult.movies),
								series: fmtNum(testResult.series),
								channels: fmtNum(testResult.channels)
							})}
						</p>
						{#if testResult.status}
							<p>
								{testResult.expiresAt
									? t('sources.expires', { date: fmtDate(testResult.expiresAt) })
									: t('sources.expiresNever')}
							</p>
						{/if}
						{#if testResult.maxConnections}
							<p>
								{t('sources.connections', {
									active: testResult.activeConnections ?? 0,
									max: testResult.maxConnections
								})}
							</p>
						{/if}
						{#if testResult.epgSuggestion}
							<p class="hint">{t('sources.test.epgSuggestion')}</p>
						{/if}
					{:else}
						<p class="test-title"><Icon name="alert" size="1rem" /> {t('sources.test.fail')}</p>
						<p>{testResult.message}</p>
					{/if}
				</div>
			{/if}

			<footer class="dialog-foot">
				<Button onclick={runTest} disabled={testing || saving} data-focusable
					>{testing ? t('sources.form.testing') : t('sources.form.test')}</Button
				>
				<span class="spacer"></span>
				<Button variant="ghost" onclick={closeForm} data-focusable
					>{t('sources.form.cancel')}</Button
				>
				<Button type="submit" variant="primary" disabled={saving} data-focusable
					>{saving ? t('sources.form.saving') : t('sources.form.save')}</Button
				>
			</footer>
		</form>
	{/if}
</dialog>

<dialog
	bind:this={confirmDialog}
	class="dialog confirm glass"
	aria-labelledby="confirm-title"
	aria-describedby="confirm-body"
	onclose={() => (confirmTarget = null)}
>
	{#if confirmTarget}
		<h2 id="confirm-title">{t('sources.confirm.title')}</h2>
		<p id="confirm-body">{t('sources.confirm.body', { name: confirmTarget.name })}</p>
		<footer class="dialog-foot">
			<span class="spacer"></span>
			<Button variant="ghost" onclick={() => (confirmTarget = null)} data-focusable
				>{t('sources.form.cancel')}</Button
			>
			<Button variant="primary" class="danger" onclick={confirmRemove} data-focusable
				>{t('sources.confirm.yes')}</Button
			>
		</footer>
	{/if}
</dialog>

<style>
	.sources-page {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
		max-width: 60rem;
	}
	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		justify-content: space-between;
		gap: 1rem;
	}
	.head h1 {
		font-size: var(--text-2xl);
		margin-top: 0.25rem;
	}
	.sub {
		color: var(--text-2);
		margin-top: 0.4rem;
		max-width: 40rem;
	}
	.head-actions {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	.notice {
		display: flex;
		gap: 0.6rem;
		align-items: flex-start;
		padding: 0.85rem 1rem;
		border-radius: var(--radius-m);
		color: var(--text-2);
		font-size: var(--text-s);
	}
	.notice.warn {
		color: var(--rating);
	}
	.list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.85rem;
	}
	.card {
		border-radius: var(--radius-l);
		padding: 1rem 1.1rem;
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
		transition: opacity var(--dur) var(--ease-out);
	}
	.card.off {
		opacity: 0.62;
	}
	.card-head {
		display: flex;
		align-items: center;
		gap: 0.85rem;
	}
	.type-icon {
		display: grid;
		place-items: center;
		width: 2.6rem;
		height: 2.6rem;
		flex: none;
		border-radius: var(--radius-m);
		background: var(--accent-soft);
		color: var(--accent-strong);
	}
	.card-title {
		flex: 1;
		min-width: 0;
	}
	.card-title h3 {
		font-size: var(--text-l);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.meta {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem 0.9rem;
		color: var(--text-3);
		font-size: var(--text-s);
	}
	.status {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
	}
	.dot {
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
		background: var(--text-3);
	}
	.status.ok .dot {
		background: var(--success);
	}
	.status.error {
		color: var(--danger);
	}
	.status.error .dot {
		background: var(--danger);
	}
	.status.loading .dot {
		background: var(--accent);
		animation: pulse 1.1s var(--ease-in-out) infinite alternate;
	}
	.bytes {
		color: var(--text-3);
	}
	@keyframes pulse {
		to {
			opacity: 0.3;
			transform: scale(0.7);
		}
	}
	.bar {
		height: 3px;
		border-radius: var(--radius-pill);
		background: var(--line);
		overflow: hidden;
	}
	.bar span {
		display: block;
		height: 100%;
		background: var(--accent);
		transition: width var(--dur) var(--ease-out);
	}
	.counts {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}
	.counts li {
		padding: 0.2rem 0.65rem;
		border-radius: var(--radius-pill);
		background: var(--bg-hover);
		border: 1px solid var(--line);
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--text-2);
	}
	.details {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 1rem;
		color: var(--text-3);
		font-size: var(--text-s);
	}
	.details:empty {
		display: none;
	}
	.msg {
		display: flex;
		gap: 0.5rem;
		align-items: flex-start;
		font-size: var(--text-s);
		line-height: 1.4;
	}
	.msg.error {
		color: var(--danger);
	}
	.msg.warn {
		color: var(--text-2);
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}
	.empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: 0.9rem;
		padding: 2rem 1rem;
		border-radius: var(--radius-l);
		color: var(--text-2);
	}

	/* switch */
	.switch {
		position: relative;
		display: inline-flex;
		flex: none;
	}
	.switch input {
		position: absolute;
		inset: 0;
		opacity: 0;
		margin: 0;
		cursor: pointer;
	}
	.track {
		width: 2.75rem;
		height: 1.6rem;
		border-radius: var(--radius-pill);
		background: var(--bg-elev-3);
		border: 1px solid var(--line-strong);
		display: flex;
		align-items: center;
		padding: 2px;
		transition: background var(--dur) var(--ease-out);
	}
	.thumb {
		width: 1.25rem;
		height: 1.25rem;
		border-radius: 50%;
		background: var(--text);
		transition: transform var(--dur) var(--ease-out);
	}
	.switch input:checked + .track {
		background: var(--accent);
		border-color: transparent;
	}
	.switch input:checked + .track .thumb {
		transform: translateX(1.15rem);
	}
	.switch input:focus-visible + .track {
		box-shadow: var(--focus-ring);
	}

	/* proxy */
	.proxy {
		border-radius: var(--radius-l);
		padding: 1rem 1.1rem;
		display: grid;
		gap: 0.6rem;
	}
	.proxy h2 {
		font-size: var(--text-l);
	}
	.proxy-row {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	.proxy-row input {
		flex: 1;
		min-width: 14rem;
	}

	/* form controls */
	input[type='text'],
	input[type='url'],
	input[type='password'],
	input[type='file'] {
		width: 100%;
		min-height: 2.75rem;
		padding: 0.6rem 0.85rem;
		border-radius: var(--radius-m);
		border: 1px solid var(--line-strong);
		background: var(--bg-elev-1);
		color: var(--text);
		transition:
			border-color var(--dur-fast) var(--ease-out),
			box-shadow var(--dur-fast) var(--ease-out);
	}
	input:focus-visible {
		border-color: var(--accent);
	}
	input::placeholder {
		color: var(--text-3);
	}
	.label {
		display: block;
		font-size: var(--text-s);
		font-weight: 700;
		color: var(--text-2);
		margin-bottom: 0.35rem;
	}
	.hint {
		font-size: var(--text-xs);
		color: var(--text-3);
		margin-top: 0.3rem;
	}
	.field {
		display: block;
	}
	.with-btn {
		display: flex;
		gap: 0.4rem;
		align-items: center;
	}
	.with-btn input {
		flex: 1;
		min-width: 0;
	}
	.with-btn > :global(.btn) {
		flex: none;
	}
	.seg {
		border: 0;
		padding: 0;
		margin: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}
	.seg legend {
		width: 100%;
	}
	.seg label {
		position: relative;
		padding: 0.5rem 1rem;
		border-radius: var(--radius-pill);
		border: 1px solid var(--line-strong);
		font-weight: 600;
		font-size: var(--text-s);
		cursor: pointer;
		transition:
			background var(--dur-fast) var(--ease-out),
			border-color var(--dur-fast) var(--ease-out);
	}
	.seg label.active {
		background: var(--accent-soft);
		border-color: var(--accent);
	}
	.seg input {
		position: absolute;
		opacity: 0;
		inset: 0;
		margin: 0;
		cursor: pointer;
	}
	.seg label:has(input:focus-visible) {
		box-shadow: var(--focus-ring);
	}
	.advanced summary {
		cursor: pointer;
		font-weight: 700;
		font-size: var(--text-s);
		color: var(--text-2);
		border-radius: var(--radius-s);
		width: fit-content;
		padding: 0.2rem 0.3rem;
	}
	.advanced[open] summary {
		margin-bottom: 0.6rem;
	}

	/* dialogs */
	.dialog {
		width: min(36rem, calc(100vw - 2rem));
		max-height: calc(100dvh - 2rem);
		overflow: auto;
		padding: 1.25rem;
		border-radius: var(--radius-xl);
		background: var(--bg-glass-strong);
		color: var(--text);
		box-shadow: var(--shadow-3);
	}
	.dialog::backdrop {
		background: rgb(0 0 0 / 0.6);
		backdrop-filter: blur(6px);
	}
	.dialog.confirm {
		width: min(26rem, calc(100vw - 2rem));
		display: grid;
		gap: 0.75rem;
	}
	.dialog.confirm p {
		color: var(--text-2);
	}
	.form {
		display: grid;
		gap: 1rem;
	}
	.dialog-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}
	.dialog-head h2,
	.confirm h2 {
		font-size: var(--text-xl);
	}
	.dialog-foot {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
	}
	.spacer {
		flex: 1;
	}
	.test {
		border-radius: var(--radius-m);
		padding: 0.8rem 1rem;
		border: 1px solid var(--line-strong);
		font-size: var(--text-s);
		display: grid;
		gap: 0.25rem;
	}
	.test.ok {
		border-color: color-mix(in oklab, var(--success) 50%, transparent);
		background: color-mix(in oklab, var(--success) 10%, transparent);
	}
	.test.fail {
		border-color: color-mix(in oklab, var(--danger) 50%, transparent);
		background: color-mix(in oklab, var(--danger) 10%, transparent);
	}
	.test-title {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-weight: 700;
	}
	.confirm :global(.btn.danger) {
		background: var(--danger);
	}
</style>
