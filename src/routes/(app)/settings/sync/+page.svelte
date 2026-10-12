<!--
	Settings → Sync: set up end-to-end encrypted sync, link devices with a one-time code,
	show status and turn sync off. The passphrase only lives in this component while a form
	is open; it is handed to the sync engine for key derivation and never stored.
-->
<script lang="ts">
	import { onDestroy } from 'svelte';
	import { t, i18n } from '#lib/i18n/index.svelte.ts';
	import { user } from '#lib/stores/user.svelte.ts';
	import { syncEngine, SyncFailure, defaultDeviceName, initSync } from '#lib/sync/index.ts';
	import type { DeviceInfo } from '#lib/sync/api.ts';
	import { isInsecureUrl, normalizeServerUrl } from '#lib/sync/api.ts';
	import {
		generatePassphrase,
		passphraseStrength,
		MIN_PASSPHRASE_LENGTH
	} from '#lib/sync/crypto.ts';
	import Button from '#lib/components/Button.svelte';
	import Icon from '#lib/components/Icon.svelte';

	type Mode = 'new' | 'pair';

	let mode = $state<Mode>('new');
	let serverUrl = $state(user.settings.syncServerUrl ?? '');
	let deviceName = $state(defaultDeviceName());
	let passphrase = $state('');
	let confirmPass = $state('');
	let savedAck = $state(false);
	let showPass = $state(false);
	let code = $state('');
	let unlockPass = $state('');

	let busy = $state(false);
	let formError = $state<string | null>(null);
	let notice = $state<string | null>(null);

	let pairing = $state<{ code: string; expiresAt: number } | null>(null);
	let now = $state(Date.now());
	let devices = $state<DeviceInfo[] | null>(null);
	let devicesBusy = $state(false);
	let confirming = $state<'unlink' | 'delete' | null>(null);
	let confirmBox = $state<HTMLElement>();

	// Bring the confirmation into view (it can be triggered from the device list).
	$effect(() => {
		if (confirming && confirmBox) {
			confirmBox.scrollIntoView({ block: 'center', behavior: 'smooth' });
			confirmBox.focus({ preventScroll: true });
		}
	});

	const strength = $derived(passphraseStrength(passphrase));
	const insecure = $derived(isInsecureUrl(serverUrl.trim()));
	const configured = $derived(syncEngine.configured);

	// initSync() is idempotent; calling it here keeps this page working even before the
	// app shell starts sync.
	$effect(() => {
		void initSync();
	});

	const tick = setInterval(() => (now = Date.now()), 1000);
	onDestroy(() => clearInterval(tick));

	$effect(() => {
		if (!serverUrl && user.settings.syncServerUrl) serverUrl = user.settings.syncServerUrl;
	});

	function errorText(err: unknown): string {
		if (err instanceof SyncFailure) return t('sync.error.' + err.code);
		return t('sync.error.unknown');
	}

	function relTime(ms: number | null | undefined): string {
		if (!ms) return '';
		const diff = Math.round((ms - now) / 1000);
		const rtf = new Intl.RelativeTimeFormat(i18n.locale, { numeric: 'auto' });
		const abs = Math.abs(diff);
		if (abs < 60) return rtf.format(diff, 'second');
		if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
		if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
		return rtf.format(Math.round(diff / 86400), 'day');
	}

	function countdown(expiresAt: number): string {
		const s = Math.max(0, Math.round((expiresAt - now) / 1000));
		return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
	}

	function formatCode(c: string): string {
		return c.length === 8 ? `${c.slice(0, 4)}-${c.slice(4)}` : c;
	}

	function resetSecrets() {
		passphrase = '';
		confirmPass = '';
		unlockPass = '';
		code = '';
		savedAck = false;
		showPass = false;
	}

	function checkUrl(): string | null {
		const url = normalizeServerUrl(serverUrl);
		if (!url) {
			formError = t('sync.error.invalidUrl');
			return null;
		}
		return url;
	}

	async function createAccount(e: SubmitEvent) {
		e.preventDefault();
		formError = null;
		notice = null;
		const url = checkUrl();
		if (!url) return;
		if (!strength.acceptable) return void (formError = t('sync.passphrase.tooWeak'));
		if (passphrase !== confirmPass) return void (formError = t('sync.passphrase.mismatch'));
		if (!savedAck) return void (formError = t('sync.passphrase.savedRequired'));
		busy = true;
		try {
			await syncEngine.createAccount(url, passphrase, deviceName.trim() || defaultDeviceName());
			resetSecrets();
			notice = t('sync.done.created');
		} catch (err) {
			formError = errorText(err);
		} finally {
			busy = false;
		}
	}

	async function pairDevice(e: SubmitEvent) {
		e.preventDefault();
		formError = null;
		notice = null;
		const url = checkUrl();
		if (!url) return;
		const clean = code.toUpperCase().replace(/[\s-]/g, '');
		if (clean.length !== 8) return void (formError = t('sync.code.invalid'));
		if (!passphrase) return void (formError = t('sync.passphrase.tooWeak'));
		busy = true;
		try {
			const ok = await syncEngine.pairDevice(
				url,
				clean,
				passphrase,
				deviceName.trim() || defaultDeviceName()
			);
			resetSecrets();
			if (ok) notice = t('sync.done.paired');
			else formError = t('sync.error.wrongPassphrase');
		} catch (err) {
			formError = errorText(err);
		} finally {
			busy = false;
		}
	}

	async function unlock(e: SubmitEvent) {
		e.preventDefault();
		formError = null;
		busy = true;
		try {
			const ok = await syncEngine.unlock(unlockPass);
			if (ok) resetSecrets();
			else formError = t('sync.error.wrongPassphrase');
		} catch (err) {
			formError = errorText(err);
		} finally {
			busy = false;
		}
	}

	async function makeCode() {
		formError = null;
		busy = true;
		try {
			pairing = await syncEngine.createPairingCode();
		} catch (err) {
			formError = errorText(err);
		} finally {
			busy = false;
		}
	}

	async function loadDevices() {
		devicesBusy = true;
		formError = null;
		try {
			devices = await syncEngine.listDevices();
		} catch (err) {
			formError = errorText(err);
		} finally {
			devicesBusy = false;
		}
	}

	async function removeDevice(d: DeviceInfo) {
		if (d.current) {
			confirming = 'unlink';
			return;
		}
		devicesBusy = true;
		try {
			await syncEngine.removeDevice(d.id);
			notice = t('sync.devices.removed', { name: d.name });
			devices = await syncEngine.listDevices();
		} catch (err) {
			formError = errorText(err);
		} finally {
			devicesBusy = false;
		}
	}

	async function disable(kind: 'unlink' | 'delete') {
		formError = null;
		busy = true;
		try {
			await syncEngine.disable(kind === 'delete' ? 'deleteAccount' : 'unlink');
			confirming = null;
			pairing = null;
			devices = null;
			notice = t('sync.disable.done');
		} catch (err) {
			formError = errorText(err);
		} finally {
			busy = false;
		}
	}

	function suggest() {
		passphrase = generatePassphrase();
		confirmPass = '';
		showPass = true;
	}

	const statusText = $derived(t('sync.status.' + syncEngine.status));
	const engineError = $derived(
		syncEngine.error && syncEngine.status !== 'idle' ? t('sync.error.' + syncEngine.error) : null
	);
	const codeExpired = $derived(pairing ? pairing.expiresAt <= now : false);
</script>

<svelte:head>
	<title>{t('sync.title')} · PrismaStream</title>
</svelte:head>

<div class="page sync">
	<header class="head">
		<p class="eyebrow">{t('sync.eyebrow')}</p>
		<h1>{t('sync.title')}</h1>
		<p class="lead">{t('sync.intro')}</p>
	</header>

	<section class="panel glass e2e" aria-labelledby="e2e-title">
		<div class="e2e-icon" aria-hidden="true">
			<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor"
				><rect x="4.5" y="10.5" width="15" height="10" rx="2.5" stroke-width="1.8" /><path
					d="M8 10.5V7.5a4 4 0 0 1 8 0v3"
					stroke-width="1.8"
					stroke-linecap="round"
				/></svg
			>
		</div>
		<div>
			<h2 id="e2e-title">{t('sync.e2e.title')}</h2>
			<p>{t('sync.e2e.body')}</p>
			<p class="muted">{t('sync.e2e.warning')}</p>
		</div>
	</section>

	<div class="live" aria-live="polite">
		{#if notice}
			<p class="notice"><Icon name="check" size="1.1rem" /> {notice}</p>
		{/if}
		{#if formError}
			<p class="error" role="alert"><Icon name="alert" size="1.1rem" /> {formError}</p>
		{/if}
	</div>

	{#if !configured}
		<section class="panel glass" aria-labelledby="setup-title">
			<h2 id="setup-title">{t('sync.setup.choose')}</h2>

			<div class="field">
				<label for="sync-server">{t('sync.server.label')}</label>
				<input
					id="sync-server"
					type="url"
					inputmode="url"
					autocomplete="url"
					autocapitalize="off"
					spellcheck="false"
					placeholder="https://"
					bind:value={serverUrl}
					aria-describedby="sync-server-hint"
					data-focusable
				/>
				<p id="sync-server-hint" class="hint">{t('sync.server.hint')}</p>
				{#if insecure}
					<p class="warn"><Icon name="alert" size="1rem" /> {t('sync.server.insecure')}</p>
				{/if}
			</div>

			<div class="modes" role="radiogroup" aria-label={t('sync.setup.choose')}>
				<button
					type="button"
					role="radio"
					aria-checked={mode === 'new'}
					class="mode"
					class:active={mode === 'new'}
					onclick={() => ((mode = 'new'), (formError = null))}
					data-focusable
				>
					<span class="mode-title"><Icon name="sparkle" size="1.1rem" /> {t('sync.new.title')}</span
					>
					<span class="mode-desc">{t('sync.new.desc')}</span>
				</button>
				<button
					type="button"
					role="radio"
					aria-checked={mode === 'pair'}
					class="mode"
					class:active={mode === 'pair'}
					onclick={() => ((mode = 'pair'), (formError = null))}
					data-focusable
				>
					<span class="mode-title"
						><Icon name="monitor" size="1.1rem" /> {t('sync.pair.title')}</span
					>
					<span class="mode-desc">{t('sync.pair.desc')}</span>
				</button>
			</div>

			{#if mode === 'new'}
				<form class="form" onsubmit={createAccount} novalidate>
					<div class="field">
						<label for="sync-device">{t('sync.deviceName')}</label>
						<input
							id="sync-device"
							type="text"
							maxlength="64"
							bind:value={deviceName}
							data-focusable
						/>
					</div>

					<div class="field">
						<div class="label-row">
							<label for="sync-pass">{t('sync.passphrase.label')}</label>
							<button type="button" class="link" onclick={suggest} data-focusable>
								{t('sync.passphrase.generate')}
							</button>
						</div>
						<div class="pass">
							<input
								id="sync-pass"
								type={showPass ? 'text' : 'password'}
								autocomplete="new-password"
								autocapitalize="off"
								spellcheck="false"
								minlength={MIN_PASSPHRASE_LENGTH}
								bind:value={passphrase}
								aria-describedby="sync-pass-hint sync-pass-strength"
								data-focusable
							/>
							<button
								type="button"
								class="eye"
								aria-pressed={showPass}
								aria-label={showPass ? t('sync.passphrase.hide') : t('sync.passphrase.show')}
								onclick={() => (showPass = !showPass)}
								data-focusable
							>
								{showPass ? t('sync.passphrase.hideShort') : t('sync.passphrase.showShort')}
							</button>
						</div>
						<div class="meter s{strength.score}" aria-hidden="true">
							{#each [0, 1, 2, 3] as i (i)}
								<span class:on={passphrase && strength.score > i}></span>
							{/each}
						</div>
						<p id="sync-pass-strength" class="hint">
							{passphrase
								? t('sync.strength.label', { level: t('sync.strength.' + strength.score) })
								: ''}
						</p>
						<p id="sync-pass-hint" class="hint">{t('sync.passphrase.hint')}</p>
					</div>

					<div class="field">
						<label for="sync-pass2">{t('sync.passphrase.confirm')}</label>
						<input
							id="sync-pass2"
							type={showPass ? 'text' : 'password'}
							autocomplete="new-password"
							autocapitalize="off"
							spellcheck="false"
							bind:value={confirmPass}
							aria-invalid={confirmPass.length > 0 && confirmPass !== passphrase}
							data-focusable
						/>
						{#if confirmPass && confirmPass !== passphrase}
							<p class="hint bad">{t('sync.passphrase.mismatch')}</p>
						{/if}
					</div>

					<label class="check">
						<input type="checkbox" bind:checked={savedAck} data-focusable />
						<span>{t('sync.passphrase.saved')}</span>
					</label>

					<div class="actions">
						<Button variant="primary" type="submit" disabled={busy} icon="check" data-focusable>
							{busy ? t('sync.creating') : t('sync.create')}
						</Button>
					</div>
				</form>
			{:else}
				<form class="form" onsubmit={pairDevice} novalidate>
					<div class="field">
						<label for="sync-code">{t('sync.code.label')}</label>
						<input
							id="sync-code"
							class="code-input"
							type="text"
							inputmode="text"
							autocomplete="one-time-code"
							autocapitalize="characters"
							spellcheck="false"
							maxlength="9"
							placeholder="ABCD-EFGH"
							bind:value={code}
							aria-describedby="sync-code-hint"
							data-focusable
						/>
						<p id="sync-code-hint" class="hint">{t('sync.code.hint')}</p>
					</div>
					<div class="field">
						<label for="sync-pass-pair">{t('sync.passphrase.label')}</label>
						<div class="pass">
							<input
								id="sync-pass-pair"
								type={showPass ? 'text' : 'password'}
								autocomplete="current-password"
								autocapitalize="off"
								spellcheck="false"
								bind:value={passphrase}
								data-focusable
							/>
							<button
								type="button"
								class="eye"
								aria-pressed={showPass}
								aria-label={showPass ? t('sync.passphrase.hide') : t('sync.passphrase.show')}
								onclick={() => (showPass = !showPass)}
								data-focusable
							>
								{showPass ? t('sync.passphrase.hideShort') : t('sync.passphrase.showShort')}
							</button>
						</div>
					</div>
					<div class="field">
						<label for="sync-device-pair">{t('sync.deviceName')}</label>
						<input
							id="sync-device-pair"
							type="text"
							maxlength="64"
							bind:value={deviceName}
							data-focusable
						/>
					</div>
					<div class="actions">
						<Button variant="primary" type="submit" disabled={busy} icon="check" data-focusable>
							{busy ? t('sync.pairing') : t('sync.pairAction')}
						</Button>
					</div>
				</form>
			{/if}
		</section>
	{:else}
		<section class="panel glass" aria-labelledby="status-title">
			<div class="status-head">
				<h2 id="status-title">{t('sync.status.title')}</h2>
				<span class="badge {syncEngine.status}" role="status">
					<span class="dot" aria-hidden="true"></span>{statusText}
				</span>
			</div>
			<dl class="facts">
				<div>
					<dt>{t('sync.server')}</dt>
					<dd class="mono">{syncEngine.serverUrl}</dd>
				</div>
				<div>
					<dt>{t('sync.thisDevice')}</dt>
					<dd>{syncEngine.deviceName}</dd>
				</div>
			</dl>
			<p class="muted">
				{syncEngine.lastSyncAt
					? t('sync.lastSync', { time: relTime(syncEngine.lastSyncAt) })
					: t('sync.never')}
				{#if syncEngine.pending > 0}
					· {t('sync.pending', { n: syncEngine.pending })}
				{/if}
			</p>
			{#if engineError && !syncEngine.locked}
				<p class="error"><Icon name="alert" size="1.1rem" /> {engineError}</p>
			{/if}
			{#if !syncEngine.locked}
				<div class="actions">
					<Button
						icon="refresh"
						disabled={syncEngine.status === 'syncing'}
						onclick={() => void syncEngine.syncNow()}
						data-focusable
					>
						{t('sync.syncNow')}
					</Button>
				</div>
			{/if}
		</section>

		{#if syncEngine.locked}
			<section class="panel glass" aria-labelledby="unlock-title">
				<h2 id="unlock-title">{t('sync.unlock.title')}</h2>
				<p class="muted">{t('sync.unlock.desc')}</p>
				<form class="form" onsubmit={unlock}>
					<div class="field">
						<label for="sync-unlock">{t('sync.passphrase.label')}</label>
						<input
							id="sync-unlock"
							type="password"
							autocomplete="current-password"
							autocapitalize="off"
							spellcheck="false"
							bind:value={unlockPass}
							data-focusable
						/>
					</div>
					<div class="actions">
						<Button variant="primary" type="submit" disabled={busy || !unlockPass} data-focusable>
							{busy ? t('sync.unlock.busy') : t('sync.unlock.action')}
						</Button>
					</div>
				</form>
			</section>
		{:else}
			<section class="panel glass" aria-labelledby="code-title">
				<h2 id="code-title">{t('sync.code.title')}</h2>
				<p class="muted">{t('sync.code.desc')}</p>
				{#if pairing && !codeExpired}
					<p
						class="code"
						aria-label={t('sync.code.aria', { code: pairing.code.split('').join(' ') })}
					>
						{formatCode(pairing.code)}
					</p>
					<p class="countdown" aria-live="off">
						<Icon name="clock" size="1rem" />
						{t('sync.code.expiresIn', { time: countdown(pairing.expiresAt) })}
					</p>
				{:else if pairing && codeExpired}
					<p class="muted">{t('sync.code.expired')}</p>
				{/if}
				<div class="actions">
					<Button icon="plus" disabled={busy} onclick={makeCode} data-focusable>
						{pairing ? t('sync.code.new') : t('sync.code.create')}
					</Button>
				</div>
			</section>

			<section class="panel glass" aria-labelledby="devices-title">
				<div class="status-head">
					<h2 id="devices-title">{t('sync.devices.title')}</h2>
					<Button
						variant="ghost"
						size="s"
						icon="refresh"
						disabled={devicesBusy}
						onclick={loadDevices}
						data-focusable
					>
						{devices ? t('sync.devices.refresh') : t('sync.devices.show')}
					</Button>
				</div>
				{#if devices}
					<ul class="devices">
						{#each devices as d (d.id)}
							<li>
								<div>
									<p class="dev-name">
										{d.name}
										{#if d.current}<span class="pill">{t('sync.devices.current')}</span>{/if}
									</p>
									<p class="hint">{t('sync.devices.lastSeen', { time: relTime(d.lastSeenAt) })}</p>
								</div>
								<Button
									variant="ghost"
									size="s"
									label={t('sync.devices.removeLabel', { name: d.name })}
									disabled={devicesBusy}
									onclick={() => removeDevice(d)}
									data-focusable
								>
									{t('sync.devices.remove')}
								</Button>
							</li>
						{/each}
					</ul>
				{/if}
			</section>
		{/if}

		<section class="panel glass" aria-labelledby="what-title">
			<h2 id="what-title">{t('sync.what.title')}</h2>
			<ul class="what">
				{#each ['profiles', 'prefs', 'data', 'home', 'settings', 'sources'] as k (k)}
					<li><Icon name="check" size="1rem" /> {t('sync.what.' + k)}</li>
				{/each}
			</ul>
		</section>

		<section class="panel glass danger" aria-labelledby="disable-title">
			<h2 id="disable-title">{t('sync.disable.title')}</h2>
			<p class="muted">{t('sync.disable.desc')}</p>
			{#if confirming}
				<div
					class="confirm"
					role="alertdialog"
					aria-labelledby="confirm-text"
					tabindex="-1"
					bind:this={confirmBox}
				>
					<p id="confirm-text">
						{confirming === 'delete'
							? t('sync.disable.confirmDelete')
							: t('sync.disable.confirmUnlink')}
					</p>
					<div class="actions">
						<Button
							variant="primary"
							class="danger-btn"
							disabled={busy}
							onclick={() => disable(confirming!)}
							data-focusable
						>
							{t('sync.disable.confirm')}
						</Button>
						<Button variant="ghost" onclick={() => (confirming = null)} data-focusable>
							{t('common.cancel')}
						</Button>
					</div>
				</div>
			{:else}
				<div class="actions">
					<Button onclick={() => (confirming = 'unlink')} data-focusable
						>{t('sync.disable.unlink')}</Button
					>
					<Button
						variant="ghost"
						class="danger-text"
						onclick={() => (confirming = 'delete')}
						data-focusable
					>
						{t('sync.disable.delete')}
					</Button>
				</div>
			{/if}
		</section>
	{/if}
</div>

<style>
	.sync {
		max-width: 52rem;
		display: grid;
		gap: 1.25rem;
	}
	.head h1 {
		font-size: var(--text-2xl);
		letter-spacing: var(--tracking-tight);
		margin: 0.35rem 0 0.5rem;
	}
	.lead {
		color: var(--text-2);
		font-size: var(--text-l);
		line-height: 1.5;
		margin: 0;
		max-width: 44rem;
	}
	.panel {
		border-radius: var(--radius-l);
		padding: clamp(1.1rem, 0.8rem + 1.2vw, 1.75rem);
		display: grid;
		gap: 0.9rem;
	}
	.panel h2 {
		font-size: var(--text-l);
		margin: 0;
	}
	.panel p {
		margin: 0;
		line-height: 1.55;
	}
	.muted,
	.hint {
		color: var(--text-3);
	}
	.hint {
		font-size: var(--text-s);
	}
	.e2e {
		grid-template-columns: auto 1fr;
		align-items: start;
		gap: 1rem;
		background: linear-gradient(135deg, var(--accent-faint), transparent 60%), var(--bg-glass);
	}
	.e2e > div {
		display: grid;
		gap: 0.5rem;
	}
	.e2e p {
		color: var(--text-2);
	}
	.e2e .muted {
		color: var(--text-3);
		font-size: var(--text-s);
	}
	.e2e-icon {
		width: 3rem;
		height: 3rem;
		border-radius: var(--radius-m);
		display: grid;
		place-items: center;
		color: var(--accent-strong);
		background: var(--accent-soft);
		box-shadow: var(--glow);
	}
	.live:empty {
		display: none;
	}
	.notice,
	.error,
	.warn {
		display: flex;
		gap: 0.5rem;
		align-items: flex-start;
		border-radius: var(--radius-m);
		padding: 0.75rem 0.9rem;
		font-size: var(--text-m);
		margin: 0;
	}
	.notice {
		background: color-mix(in oklab, var(--success) 14%, transparent);
		color: var(--success);
	}
	.error {
		background: color-mix(in oklab, var(--danger) 14%, transparent);
		color: var(--danger);
	}
	.warn {
		background: color-mix(in oklab, var(--rating) 12%, transparent);
		color: var(--rating);
		font-size: var(--text-s);
	}
	.field {
		display: grid;
		gap: 0.4rem;
	}
	.field label,
	.label-row label {
		font-weight: 600;
		font-size: var(--text-m);
	}
	.label-row {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 1rem;
		flex-wrap: wrap;
	}
	input[type='text'],
	input[type='url'],
	input[type='password'] {
		width: 100%;
		font: inherit;
		color: var(--text);
		background: var(--bg-elev-2);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-m);
		padding: 0.8rem 0.95rem;
		transition: border-color var(--dur-fast) var(--ease-out);
	}
	input:focus-visible {
		border-color: var(--accent);
	}
	input[aria-invalid='true'] {
		border-color: var(--danger);
	}
	.pass {
		position: relative;
	}
	.pass input {
		padding-right: 6.5rem;
	}
	.eye {
		position: absolute;
		right: 0.4rem;
		top: 50%;
		translate: 0 -50%;
		min-width: 2.75rem;
		height: 2.4rem;
		padding: 0 0.7rem;
		font-size: var(--text-s);
		font-weight: 600;
		border: 0;
		border-radius: var(--radius-s);
		background: transparent;
		color: var(--text-2);
		cursor: pointer;
	}
	.eye:hover {
		background: var(--bg-hover);
	}
	.link {
		border: 0;
		background: none;
		color: var(--accent-strong);
		font-size: var(--text-s);
		font-weight: 600;
		cursor: pointer;
		padding: 0.25rem 0;
		border-radius: var(--radius-xs);
	}
	.meter {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 0.3rem;
	}
	.meter span {
		height: 0.3rem;
		border-radius: var(--radius-pill);
		background: var(--line-strong);
		transition: background var(--dur) var(--ease-out);
	}
	.meter.s0 span.on,
	.meter.s1 span.on {
		background: var(--danger);
	}
	.meter.s2 span.on {
		background: var(--rating);
	}
	.meter.s3 span.on,
	.meter.s4 span.on {
		background: var(--success);
	}
	.bad {
		color: var(--danger);
	}
	.check {
		display: flex;
		gap: 0.65rem;
		align-items: flex-start;
		color: var(--text-2);
		cursor: pointer;
		line-height: 1.45;
	}
	.check input {
		width: 1.15rem;
		height: 1.15rem;
		margin-top: 0.15rem;
		accent-color: var(--accent);
		flex: none;
	}
	.form {
		display: grid;
		gap: 1rem;
		margin-top: 0.25rem;
	}
	.modes {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
		gap: 0.75rem;
	}
	.mode {
		text-align: left;
		display: grid;
		gap: 0.35rem;
		padding: 1rem 1.1rem;
		border-radius: var(--radius-m);
		border: 1px solid var(--line-strong);
		background: var(--bg-elev-1);
		cursor: pointer;
		transition:
			border-color var(--dur-fast) var(--ease-out),
			background var(--dur-fast) var(--ease-out);
	}
	.mode:hover {
		background: var(--bg-elev-2);
	}
	.mode.active {
		border-color: var(--accent);
		background: var(--accent-faint);
	}
	.mode-title {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		font-weight: 700;
	}
	.mode-desc {
		color: var(--text-3);
		font-size: var(--text-s);
		line-height: 1.45;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
	}
	.status-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
		flex-wrap: wrap;
	}
	.badge {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		padding: 0.3rem 0.75rem;
		border-radius: var(--radius-pill);
		background: var(--bg-elev-3);
		font-size: var(--text-s);
		font-weight: 600;
	}
	.dot {
		width: 0.55rem;
		height: 0.55rem;
		border-radius: 50%;
		background: var(--text-3);
	}
	.badge.idle .dot {
		background: var(--success);
	}
	.badge.syncing .dot {
		background: var(--accent);
		animation: pulse 1s var(--ease-in-out) infinite alternate;
	}
	.badge.offline .dot {
		background: var(--rating);
	}
	.badge.error .dot {
		background: var(--danger);
	}
	@keyframes pulse {
		to {
			opacity: 0.3;
		}
	}
	.facts {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
		gap: 0.75rem;
		margin: 0;
	}
	.facts dt {
		font-size: var(--text-xs);
		text-transform: uppercase;
		letter-spacing: var(--tracking-caps);
		color: var(--text-3);
		font-weight: 700;
	}
	.facts dd {
		margin: 0.2rem 0 0;
		overflow-wrap: anywhere;
	}
	.mono {
		font-variant-numeric: tabular-nums;
	}
	.code {
		font-size: clamp(2.2rem, 1.4rem + 4vw, 3.6rem);
		font-weight: 800;
		letter-spacing: 0.12em;
		font-variant-numeric: tabular-nums;
		text-align: center;
		padding: 1rem;
		border-radius: var(--radius-m);
		background: var(--bg-elev-1);
		border: 1px solid var(--accent-soft);
		box-shadow: var(--glow);
		user-select: all;
	}
	.countdown {
		display: flex;
		gap: 0.4rem;
		align-items: center;
		justify-content: center;
		color: var(--text-2);
		font-variant-numeric: tabular-nums;
	}
	.devices {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.5rem;
	}
	.devices li {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
		padding: 0.75rem 0.9rem;
		border-radius: var(--radius-m);
		background: var(--bg-elev-1);
	}
	.dev-name {
		font-weight: 600;
		display: flex;
		gap: 0.5rem;
		align-items: center;
		flex-wrap: wrap;
	}
	.pill {
		font-size: var(--text-xs);
		padding: 0.1rem 0.5rem;
		border-radius: var(--radius-pill);
		background: var(--accent-soft);
		color: var(--accent-strong);
	}
	.what {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.5rem;
		color: var(--text-2);
	}
	.what li {
		display: flex;
		gap: 0.55rem;
		align-items: flex-start;
		line-height: 1.45;
	}
	.what :global(svg) {
		color: var(--success);
		flex: none;
		margin-top: 0.2rem;
	}
	.danger {
		border-color: color-mix(in oklab, var(--danger) 25%, var(--line));
	}
	.confirm {
		outline: none;
		display: grid;
		gap: 0.8rem;
		padding: 1rem;
		border-radius: var(--radius-m);
		background: color-mix(in oklab, var(--danger) 10%, transparent);
	}
	.sync :global(.danger-text) {
		color: var(--danger);
	}
	.sync :global(.danger-btn) {
		background: var(--danger);
	}
	@media (max-width: 520px) {
		.e2e {
			grid-template-columns: 1fr;
		}
	}
</style>
