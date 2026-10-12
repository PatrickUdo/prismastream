<!--
	Settings overview: profile, appearance (accent, motion, language), home rows, playback,
	sources, metadata (TMDB key, refresh), PrismaStream Cloud (account), storage and about.
	In kids mode the settings are restricted until an adult PIN is entered.
-->
<script lang="ts">
	import { i18n, t } from '#lib/i18n/index.svelte.ts';
	import { user } from '#lib/stores/user.svelte.ts';
	import { library } from '#lib/catalog/library.svelte.ts';
	import { formatBytes, storageEstimate, type StorageUse } from '#lib/catalog/storage.ts';
	import { syncEngine } from '#lib/sync/index.ts';
	import { kids } from '#lib/stores/kids.svelte.ts';
	import { sources } from '#lib/sources/index.svelte.ts';
	import { languageName } from '#lib/lang.ts';
	import Avatar from '#lib/components/Avatar.svelte';
	import Button from '#lib/components/Button.svelte';
	import ChoiceGroup from '#lib/components/ChoiceGroup.svelte';
	import Icon, { type IconName } from '#lib/components/Icon.svelte';
	import { path } from '#lib/components/links.ts';
	import { version } from '../../../../package.json';
	import Toggle from './ui/Toggle.svelte';
	import AccentPicker from './ui/AccentPicker.svelte';
	import HomeRowsEditor from './ui/HomeRowsEditor.svelte';
	import PinDialog from '../profiles/PinDialog.svelte';

	const profile = $derived(user.active);
	const editHref = $derived(
		path(`/profiles/${encodeURIComponent(profile?.id ?? '')}?from=settings`)
	);

	// ---- Kids mode -------------------------------------------------------------
	let pinOpen = $state(false);
	function unlock() {
		if (kids.locked) pinOpen = true;
		else kids.unlock();
	}

	// ---- Appearance ------------------------------------------------------------
	function setUiLang(v: string) {
		if (profile) void user.updateProfile(profile.id, { uiLang: v as 'nl' | 'en' });
	}

	// ---- Playback summary ------------------------------------------------------
	const langList = (codes: string[]) =>
		codes.map((c) => languageName(c, i18n.locale)).join(', ') || '—';

	// ---- Sources ----------------------------------------------------------------
	const userSources = $derived(sources.list.filter((s) => s.type !== 'sample'));
	const enabledCount = $derived(sources.list.filter((s) => s.enabled).length);
	// ---- Metadata ----------------------------------------------------------------
	let tmdbKey = $state(user.settings.tmdbApiKey ?? '');
	let showKey = $state(false);
	let tmdbSaved = $state(false);
	async function saveTmdb(e: SubmitEvent) {
		e.preventDefault();
		await user.updateSettings({ tmdbApiKey: tmdbKey.trim() || undefined });
		tmdbSaved = true;
	}

	let refreshing = $state(false);
	async function refreshCatalog() {
		refreshing = true;
		try {
			await library.refresh({ force: true });
		} catch {
			// The status line shows the error.
		} finally {
			refreshing = false;
		}
	}
	const catalogSummary = $derived(
		t('settings.metadata.summary', {
			titles: new Intl.NumberFormat(i18n.locale).format(library.counts.titles),
			channels: new Intl.NumberFormat(i18n.locale).format(library.counts.channels)
		})
	);

	const remote = $derived(library.mode === 'remote');
	const syncOn = $derived(syncEngine.configured);

	// ---- Storage ---------------------------------------------------------------------
	let storage = $state<StorageUse | null>(null);
	let clearing = $state(false);
	let cleared = $state(false);
	let cacheUse = $state({ items: 0, bytes: 0 });
	async function measure() {
		storage = await storageEstimate();
		cacheUse = library.cacheUse;
	}
	$effect(() => {
		void measure();
	});
	async function clearCache() {
		clearing = true;
		cleared = false;
		try {
			await library.clearLocalCache();
			cleared = true;
		} finally {
			clearing = false;
			// Deleting databases settles asynchronously; measure again a moment later.
			setTimeout(() => void measure(), 600);
		}
	}
</script>

<svelte:head>
	<title>{t('nav.settings')} · PrismaStream</title>
</svelte:head>

{#snippet sectionHead(icon: IconName, title: string, body?: string)}
	<header class="sh">
		<span class="sh-ico">
			<Icon name={icon} size="1.15rem" />
		</span>
		<div>
			<h2>{title}</h2>
			{#if body}<p class="muted">{body}</p>{/if}
		</div>
	</header>
{/snippet}

<div class="page">
	<header class="head">
		<span class="eyebrow">PrismaStream</span>
		<h1>{t('nav.settings')}</h1>
	</header>

	<div class="cols">
		<!-- Profile -------------------------------------------------------------- -->
		<section class="card glass">
			{@render sectionHead('user', t('settings.profile.title'))}
			{#if profile}
				<div class="profile">
					<Avatar preset={profile.avatar} name={profile.name} size="3.5rem" />
					<div class="pinfo">
						<strong>{profile.name}</strong>
						<span class="muted">
							{profile.isKids ? t('profiles.kids.mode') : t('settings.profile.standard')}
							{#if profile.pinHash}· {t('profiles.locked')}{/if}
						</span>
					</div>
				</div>
			{/if}
			<div class="btns">
				{#if !kids.restricted}
					<Button variant="glass" size="s" href={editHref} data-focusable>
						<Icon name="edit" size="1rem" />
						{t('settings.profile.edit')}
					</Button>
				{/if}
				<Button variant="glass" size="s" icon="user" href={path('/profiles')} data-focusable>
					{t('ui.switchProfile')}
				</Button>
				{#if !kids.restricted}
					<Button variant="ghost" size="s" href={path('/profiles?manage=1')} data-focusable>
						{t('profiles.manage')}
					</Button>
				{/if}
			</div>
		</section>

		{#if kids.restricted}
			<!-- Kids mode: restricted ---------------------------------------------- -->
			<section class="card glass kids-card">
				{@render sectionHead('lock', t('settings.kids.title'), t('settings.kids.body'))}
				<div class="btns">
					<Button variant="primary" onclick={unlock} data-focusable>
						<Icon name="lock" size="1.05rem" />
						{t('settings.kids.unlock')}
					</Button>
				</div>
				{#if !kids.locked}
					<p class="muted small">{t('settings.kids.noPin')}</p>
				{/if}
			</section>
		{:else}
			<!-- Appearance ----------------------------------------------------------- -->
			<section class="card glass">
				{@render sectionHead('palette', t('settings.appearance.title'))}
				<div class="field-block">
					<span class="label">{t('settings.appearance.accent')}</span>
					<AccentPicker />
				</div>
				<Toggle
					label={t('settings.appearance.reduceMotion')}
					description={t('settings.appearance.reduceMotionHint')}
					checked={user.settings.reduceMotion}
					onchange={(v) => user.updateSettings({ reduceMotion: v })}
				/>
				{#if profile}
					<ChoiceGroup
						label={t('settings.appearance.language')}
						icon="globe"
						options={[
							{ value: 'nl', label: 'Nederlands' },
							{ value: 'en', label: 'English' }
						]}
						value={profile.uiLang}
						onchange={setUiLang}
					/>
				{/if}
			</section>

			<!-- Home rows -------------------------------------------------------------- -->
			<section class="card glass" id="home-rows">
				{@render sectionHead('home', t('settings.home.title'), t('settings.home.body'))}
				<HomeRowsEditor />
			</section>

			<!-- Playback --------------------------------------------------------------- -->
			<section class="card glass">
				{@render sectionHead('play-circle', t('settings.playback.title'))}
				<Toggle
					label={t('settings.playback.autoplayNext')}
					description={t('settings.playback.autoplayNextHint')}
					checked={user.settings.autoplayNext}
					onchange={(v) => user.updateSettings({ autoplayNext: v })}
				/>
				{#if profile}
					<dl class="facts">
						<div>
							<dt>{t('settings.playback.audio')}</dt>
							<dd>{langList(profile.audioLangs)}</dd>
						</div>
						<div>
							<dt>{t('settings.playback.subtitles')}</dt>
							<dd>
								{profile.subtitlesOn
									? langList(profile.subtitleLangs)
									: t('settings.playback.subtitlesOff')}
							</dd>
						</div>
					</dl>
					<div class="btns">
						<Button variant="glass" size="s" icon="globe" href={editHref} data-focusable>
							{t('settings.playback.editLangs')}
						</Button>
					</div>
				{/if}
			</section>

			<!-- Sources ---------------------------------------------------------------- -->
			<section class="card glass">
				{@render sectionHead('source', t('settings.sources.title'))}
				<a class="link-row" href={path('/settings/sources')} data-focusable>
					<span>
						<strong>{t('settings.sources.manage')}</strong>
						<span class="muted">
							{remote
								? t('cloud.settings.sourcesRemote')
								: t('settings.sources.count', { n: userSources.length, enabled: enabledCount })}
						</span>
					</span>
					<Icon name="chevron-right" size="1.2rem" />
				</a>
			</section>

			<!-- Metadata --------------------------------------------------------------- -->
			<section class="card glass">
				{@render sectionHead(
					'key',
					t('settings.metadata.title'),
					remote ? t('cloud.settings.metadataRemote') : t('settings.metadata.body')
				)}
				{#if !remote}
					<form class="field-block" onsubmit={saveTmdb}>
						<label class="label" for="tmdb-key">{t('settings.metadata.key')}</label>
						<div class="inline">
							<div class="secret">
								<input
									id="tmdb-key"
									class="field"
									type={showKey ? 'text' : 'password'}
									autocomplete="off"
									spellcheck="false"
									bind:value={tmdbKey}
									oninput={() => (tmdbSaved = false)}
									placeholder={t('settings.metadata.keyPlaceholder')}
									data-focusable
								/>
								<button
									type="button"
									class="reveal"
									aria-label={showKey ? t('settings.metadata.hide') : t('settings.metadata.show')}
									aria-pressed={showKey}
									data-focusable
									onclick={() => (showKey = !showKey)}
								>
									<Icon name={showKey ? 'eye-off' : 'eye'} size="1.15rem" />
								</button>
							</div>
							<Button variant="glass" type="submit" data-focusable>{t('common.save')}</Button>
						</div>
						<p class="status" aria-live="polite">
							{#if tmdbSaved}<span class="ok">{t('settings.saved')}</span>{/if}
						</p>
						<a
							class="ext"
							href="https://www.themoviedb.org/settings/api"
							target="_blank"
							rel="noopener noreferrer"
							data-focusable
						>
							{t('settings.metadata.getKey')}
							<Icon name="external" size="0.95rem" />
						</a>
					</form>
				{/if}
				<div class="refresh">
					<span class="muted small">{catalogSummary}</span>
					<Button
						variant="glass"
						size="s"
						icon="refresh"
						disabled={refreshing || library.status === 'loading'}
						onclick={refreshCatalog}
						data-focusable
					>
						{refreshing || library.status === 'loading'
							? t('settings.metadata.refreshing')
							: t('settings.metadata.refresh')}
					</Button>
				</div>
			</section>

			<!-- Sync -------------------------------------------------------------------- -->
			<section class="card glass" id="cloud">
				{@render sectionHead(
					'cloud',
					t('cloud.name'),
					syncOn ? undefined : t('cloud.settings.pitch')
				)}
				<a class="link-row" href={path('/settings/sync')} data-focusable>
					<span>
						<strong>{syncOn ? t('cloud.settings.account') : t('cloud.banner.title')}</strong>
						<span class="muted">
							{syncOn
								? (syncEngine.email ?? t('settings.sync.on')) +
									(remote ? ` · ${t('cloud.settings.remote')}` : '')
								: t('cloud.settings.notConnected')}
						</span>
					</span>
					<Icon name="chevron-right" size="1.2rem" />
				</a>
				{#if syncOn && syncEngine.authMode === 'password'}
					<div class="btns">
						<Button variant="glass" size="s" icon="monitor" href={path('/activate')} data-focusable>
							{t('account.tv.link')}
						</Button>
					</div>
				{/if}
			</section>

			<!-- Storage ------------------------------------------------------------------- -->
			<section class="card glass">
				{@render sectionHead(
					'grid',
					t('cloud.storage.title'),
					t(remote ? 'cloud.storage.bodyRemote' : 'cloud.storage.bodyLocal')
				)}
				<dl class="facts">
					<div>
						<dt>{t('cloud.storage.used')}</dt>
						<dd>{storage ? formatBytes(storage.usage, i18n.locale) : '…'}</dd>
					</div>
					{#if remote}
						<div>
							<dt>{t('cloud.storage.cache')}</dt>
							<dd>
								{t('cloud.storage.cacheItems', {
									n: cacheUse.items,
									size: formatBytes(cacheUse.bytes, i18n.locale)
								})}
							</dd>
						</div>
					{/if}
				</dl>
				<div class="btns">
					<Button
						variant="glass"
						size="s"
						icon="trash"
						disabled={clearing}
						onclick={clearCache}
						data-focusable
					>
						{clearing ? t('cloud.storage.clearing') : t('cloud.storage.clear')}
					</Button>
					{#if cleared}<span class="ok" role="status">{t('cloud.storage.cleared')}</span>{/if}
				</div>
			</section>
		{/if}

		<!-- About ------------------------------------------------------------------- -->
		<section class="card glass about">
			{@render sectionHead('info', t('settings.about.title'))}
			<dl class="facts">
				<div>
					<dt>{t('settings.about.version')}</dt>
					<dd>{version}</dd>
				</div>
			</dl>
			<p class="legal">{t('settings.about.legal')}</p>
		</section>
	</div>
</div>

<PinDialog
	bind:open={pinOpen}
	title={t('profiles.kids.unlockTitle')}
	subtitle={t('profiles.kids.unlockBody')}
	hashes={kids.adultPinProfiles.map((p) => p.pinHash!)}
	onsuccess={() => kids.unlock()}
/>

<style>
	.head {
		display: grid;
		gap: 0.35rem;
		margin-bottom: 2rem;
	}
	h1 {
		font-size: var(--text-2xl);
		font-weight: 800;
	}
	.cols {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 1.25rem;
		max-width: 48rem;
	}
	@media (min-width: 1280px) {
		.cols {
			display: block;
			max-width: 96rem;
			columns: 2;
			column-gap: 1.25rem;
		}
		.cols > .card {
			break-inside: avoid;
			margin-bottom: 1.25rem;
		}
	}
	.card {
		display: grid;
		gap: 1.1rem;
		grid-template-columns: minmax(0, 1fr);
		padding: clamp(1.1rem, 0.8rem + 1.2vw, 1.75rem);
		border-radius: var(--radius-l);
		min-width: 0;
	}
	.sh {
		display: flex;
		align-items: flex-start;
		gap: 0.85rem;
	}
	.sh h2 {
		font-size: var(--text-l);
		padding-top: 0.35rem;
	}
	.sh p {
		margin-top: 0.3rem;
	}
	.sh-ico {
		display: grid;
		place-items: center;
		flex: none;
		width: 2.4rem;
		height: 2.4rem;
		border-radius: var(--radius-m);
		background: var(--accent-soft);
		color: var(--accent-strong);
		box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--accent) 30%, transparent);
	}
	.muted {
		color: var(--text-3);
		font-size: var(--text-s);
	}
	.small {
		font-size: var(--text-xs);
	}
	.profile {
		display: flex;
		align-items: center;
		gap: 1rem;
	}
	.pinfo {
		display: grid;
		gap: 0.1rem;
	}
	.pinfo strong {
		font-size: var(--text-l);
	}
	.btns {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	.field-block {
		display: grid;
		gap: 0.55rem;
	}
	.label {
		font-size: var(--text-xs);
		font-weight: 700;
		letter-spacing: var(--tracking-caps);
		text-transform: uppercase;
		color: var(--text-3);
	}
	.inline {
		display: flex;
		gap: 0.5rem;
		align-items: center;
	}
	@media (max-width: 480px) {
		.inline {
			flex-wrap: wrap;
		}
		.inline > :global(*) {
			flex: 1 1 100%;
		}
	}
	.field {
		flex: 1;
		width: 100%;
		min-width: 0;
		min-height: 2.75rem;
		padding: 0 0.95rem;
		border-radius: var(--radius-m);
		border: 1px solid var(--line-strong);
		background: rgb(0 0 0 / 0.25);
		font-size: var(--text-m);
		transition:
			border-color var(--dur) var(--ease-out),
			box-shadow var(--dur) var(--ease-out);
	}
	.field:focus {
		outline: none;
		border-color: var(--accent);
		box-shadow: 0 0 0 3px var(--accent-soft);
	}
	.secret {
		position: relative;
		flex: 1;
		min-width: 0;
		display: flex;
	}
	.secret .field {
		padding-right: 3rem;
	}
	.reveal {
		position: absolute;
		top: 50%;
		right: 0.3rem;
		display: grid;
		place-items: center;
		width: 2.3rem;
		height: 2.3rem;
		transform: translateY(-50%);
		border: 0;
		border-radius: 50%;
		background: none;
		color: var(--text-3);
	}
	.reveal:hover {
		color: var(--text);
		background: var(--bg-hover);
	}
	.status {
		min-height: 1.2em;
		font-size: var(--text-s);
		font-weight: 650;
	}
	.ok {
		color: var(--success);
	}
	.ext {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		justify-self: start;
		color: var(--accent-strong);
		font-weight: 650;
		font-size: var(--text-s);
		border-radius: var(--radius-xs);
	}
	.ext:hover {
		text-decoration: underline;
	}
	.refresh {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding-top: 1rem;
		border-top: 1px solid var(--line);
	}
	.link-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.85rem 1rem;
		border-radius: var(--radius-m);
		border: 1px solid var(--line);
		background: rgb(255 255 255 / 0.035);
		transition:
			background-color var(--dur) var(--ease-out),
			border-color var(--dur) var(--ease-out);
	}
	.link-row > span {
		display: grid;
		gap: 0.1rem;
	}
	.link-row:hover {
		background: var(--bg-hover);
		border-color: var(--line-strong);
	}
	.facts {
		display: grid;
		gap: 0.6rem;
		margin: 0;
	}
	.facts div {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
	}
	.facts dt {
		color: var(--text-3);
		font-size: var(--text-s);
	}
	.facts dd {
		margin: 0;
		font-weight: 650;
		text-align: right;
	}
	.legal {
		padding: 0.85rem 1rem;
		border-radius: var(--radius-m);
		background: rgb(255 255 255 / 0.035);
		border: 1px solid var(--line);
		color: var(--text-2);
		font-size: var(--text-s);
		line-height: 1.6;
	}
	.kids-card .sh-ico {
		background: linear-gradient(135deg, rgb(255 209 102 / 0.25), rgb(255 143 171 / 0.25));
		color: #ffd166;
	}
</style>
