<!--
	Create or edit a profile: name, avatar, kids mode, PIN (4 digits, confirmed, stored only
	as hashPin()), audio and subtitle languages in order of preference, subtitles on/off and
	the app language. Existing profiles can be deleted (never the last one).
-->
<script lang="ts">
	import type { LangCode, Profile } from '#lib/types.ts';
	import { goto } from '$app/navigation';
	import { t } from '#lib/i18n/index.svelte.ts';
	import { hashPin, user } from '#lib/stores/user.svelte.ts';
	import Avatar from '#lib/components/Avatar.svelte';
	import Button from '#lib/components/Button.svelte';
	import ChoiceGroup from '#lib/components/ChoiceGroup.svelte';
	import Modal from '#lib/components/Modal.svelte';
	import { AVATAR_PRESETS, avatarLabel } from '#lib/components/avatars.ts';
	import { path } from '#lib/components/links.ts';
	import Toggle from '../settings/ui/Toggle.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import LangOrder from './LangOrder.svelte';
	import { pinDigits } from './session.ts';

	interface Props {
		profile?: Profile;
		/** Where to go after saving / cancelling. */
		backHref?: string;
	}

	let { profile, backHref = '/profiles?manage=1' }: Props = $props();

	const isNew = $derived(!profile);
	// Initial values come from the profile once (the form then owns its state).
	const initial = (() => profile)();
	let name = $state(initial?.name ?? '');
	let avatar = $state(initial?.avatar ?? AVATAR_PRESETS[user.profiles.length % 8]);
	let isKids = $state(initial?.isKids ?? false);
	let audioLangs = $state<LangCode[]>([...(initial?.audioLangs ?? ['nl', 'en'])]);
	let subtitleLangs = $state<LangCode[]>([...(initial?.subtitleLangs ?? ['nl'])]);
	let subtitlesOn = $state(initial?.subtitlesOn ?? false);
	let uiLang = $state<'nl' | 'en'>(initial?.uiLang ?? 'nl');

	/** 'keep' the current PIN state, 'set' a new PIN, or 'remove' it. */
	let pinMode = $state<'keep' | 'set' | 'remove'>('keep');
	let pin1 = $state('');
	let pin2 = $state('');

	let saving = $state(false);
	let nameError = $state('');
	let pinError = $state('');
	let confirmDelete = $state(false);
	let nameInput = $state<HTMLInputElement>();
	let avatarGroup = $state<HTMLDivElement>();

	const hasPin = $derived(!!initial?.pinHash && pinMode !== 'remove');
	const canDelete = $derived(!!profile && user.profiles.length > 1);

	$effect(() => {
		if (isNew) nameInput?.focus();
	});

	function onAvatarKey(e: KeyboardEvent, i: number) {
		const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
		if (!step) return;
		e.preventDefault();
		const n = AVATAR_PRESETS.length;
		const j = (i + step + n) % n;
		avatar = AVATAR_PRESETS[j];
		avatarGroup?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[j]?.focus();
	}

	async function save(e: SubmitEvent) {
		e.preventDefault();
		nameError = '';
		pinError = '';
		const trimmed = name.trim();
		if (!trimmed) {
			nameError = t('profiles.edit.nameRequired');
			nameInput?.focus();
			return;
		}
		const patch: Partial<Profile> = {
			name: trimmed.slice(0, 24),
			avatar,
			isKids,
			audioLangs: [...audioLangs],
			subtitleLangs: [...subtitleLangs],
			subtitlesOn,
			uiLang
		};
		if (pinMode === 'set') {
			if (!/^\d{4}$/.test(pin1)) {
				pinError = t('profiles.edit.pinFormat');
				return;
			}
			if (pin1 !== pin2) {
				pinError = t('profiles.edit.pinMismatch');
				return;
			}
			patch.pinHash = await hashPin(pin1);
		} else if (pinMode === 'remove') {
			patch.pinHash = undefined;
		}
		saving = true;
		try {
			if (profile) await user.updateProfile(profile.id, patch);
			else await user.createProfile(patch);
		} finally {
			saving = false;
			pin1 = pin2 = '';
		}
		await goto(path(backHref));
	}

	async function remove() {
		if (!profile || !canDelete) return;
		confirmDelete = false;
		await user.deleteProfile(profile.id);
		await goto(path('/profiles?manage=1'));
	}
</script>

<form class="editor" onsubmit={save} novalidate>
	<header class="head">
		<a class="back" href={path(backHref)} data-focusable aria-label={t('common.back')}>
			<svg viewBox="0 0 24 24" width="1.3rem" height="1.3rem" aria-hidden="true">
				<path
					d="M15 5l-7 7 7 7"
					fill="none"
					stroke="currentColor"
					stroke-width="1.9"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
			</svg>
		</a>
		<div>
			<span class="eyebrow">{t('nav.profiles')}</span>
			<h1>{isNew ? t('profiles.edit.newTitle') : t('profiles.edit.title')}</h1>
		</div>
	</header>

	<section class="card glass identity">
		<div class="preview">
			<Avatar preset={avatar} name={name || '?'} size="clamp(5.5rem, 4rem + 5vw, 8rem)" />
			{#if isKids}<span class="kids-badge">{t('profiles.kids.badge')}</span>{/if}
		</div>
		<div class="name-field">
			<label for="profile-name">{t('profiles.edit.name')}</label>
			<input
				id="profile-name"
				class="field"
				bind:this={nameInput}
				bind:value={name}
				maxlength="24"
				autocomplete="off"
				autocapitalize="words"
				placeholder={t('profiles.edit.namePlaceholder')}
				aria-invalid={nameError ? 'true' : undefined}
				aria-describedby={nameError ? 'profile-name-err' : undefined}
				data-focusable
			/>
			{#if nameError}<p class="err" id="profile-name-err">{nameError}</p>{/if}
		</div>
	</section>

	<section class="card glass">
		<h2 id="avatar-h">{t('profiles.edit.avatar')}</h2>
		<div class="avatars" role="radiogroup" aria-labelledby="avatar-h" bind:this={avatarGroup}>
			{#each AVATAR_PRESETS as preset, i (preset)}
				<button
					type="button"
					role="radio"
					class="av"
					aria-checked={avatar === preset}
					aria-label={avatarLabel(preset)}
					tabindex={avatar === preset ? 0 : -1}
					data-focusable
					onclick={() => (avatar = preset)}
					onkeydown={(e) => onAvatarKey(e, i)}
				>
					<Avatar {preset} size="100%" labelled={false} ring={avatar === preset} />
					<span class="av-name">{avatarLabel(preset)}</span>
				</button>
			{/each}
		</div>
	</section>

	<section class="card glass">
		<h2>{t('profiles.edit.safety')}</h2>
		<Toggle
			label={t('profiles.edit.kids')}
			description={t('profiles.edit.kidsHint')}
			bind:checked={isKids}
		/>

		<div class="pin">
			<div class="pin-head">
				<span class="pin-ico"><Icon name="lock" size="1.1rem" /></span>
				<div>
					<strong>{t('profiles.edit.pin')}</strong>
					<p class="muted">
						{hasPin && pinMode !== 'set'
							? t('profiles.edit.pinIsSet')
							: isKids
								? t('profiles.edit.pinHintKids')
								: t('profiles.edit.pinHint')}
					</p>
				</div>
			</div>
			{#if pinMode === 'set'}
				<div class="pin-fields">
					<label>
						<span>{t('profiles.edit.pinNew')}</span>
						<input
							class="field pin-input"
							type="password"
							inputmode="numeric"
							autocomplete="off"
							maxlength="4"
							pattern="[0-9]*"
							value={pin1}
							oninput={(e) => (pin1 = e.currentTarget.value = pinDigits(e.currentTarget.value))}
							data-focusable
						/>
					</label>
					<label>
						<span>{t('profiles.edit.pinConfirm')}</span>
						<input
							class="field pin-input"
							type="password"
							inputmode="numeric"
							autocomplete="off"
							maxlength="4"
							pattern="[0-9]*"
							value={pin2}
							oninput={(e) => (pin2 = e.currentTarget.value = pinDigits(e.currentTarget.value))}
							data-focusable
						/>
					</label>
				</div>
				{#if pinError}<p class="err" role="alert">{pinError}</p>{/if}
				<div class="row-actions">
					<Button
						variant="ghost"
						size="s"
						onclick={() => {
							pinMode = 'keep';
							pin1 = pin2 = '';
							pinError = '';
						}}
						data-focusable>{t('common.cancel')}</Button
					>
				</div>
			{:else}
				<div class="row-actions">
					<Button variant="glass" size="s" onclick={() => (pinMode = 'set')} data-focusable>
						{hasPin ? t('profiles.edit.pinChange') : t('profiles.edit.pinSet')}
					</Button>
					{#if hasPin}
						<Button variant="ghost" size="s" onclick={() => (pinMode = 'remove')} data-focusable>
							{t('profiles.edit.pinRemove')}
						</Button>
					{:else if pinMode === 'remove'}
						<span class="muted small">{t('profiles.edit.pinWillRemove')}</span>
						<Button variant="ghost" size="s" onclick={() => (pinMode = 'keep')} data-focusable>
							{t('profiles.edit.undo')}
						</Button>
					{/if}
				</div>
			{/if}
		</div>
	</section>

	<section class="card glass">
		<h2>{t('profiles.edit.languages')}</h2>
		<LangOrder
			label={t('profiles.edit.audio')}
			hint={t('profiles.edit.audioHint')}
			bind:value={audioLangs}
		/>
		<div class="divider"></div>
		<LangOrder
			label={t('profiles.edit.subtitles')}
			hint={t('profiles.edit.subtitlesHint')}
			bind:value={subtitleLangs}
		/>
		<Toggle
			label={t('profiles.edit.subtitlesOn')}
			description={t('profiles.edit.subtitlesOnHint')}
			bind:checked={subtitlesOn}
		/>
		<div class="divider"></div>
		<ChoiceGroup
			label={t('profiles.edit.uiLang')}
			icon="globe"
			options={[
				{ value: 'nl', label: 'Nederlands' },
				{ value: 'en', label: 'English' }
			]}
			value={uiLang}
			onchange={(v) => (uiLang = v as 'nl' | 'en')}
		/>
	</section>

	{#if profile}
		<section class="card glass danger">
			<div>
				<h2>{t('profiles.edit.deleteTitle')}</h2>
				<p class="muted">
					{canDelete ? t('profiles.edit.deleteHint') : t('profiles.edit.deleteLast')}
				</p>
			</div>
			<Button
				variant="glass"
				disabled={!canDelete}
				onclick={() => (confirmDelete = true)}
				data-focusable
			>
				<Icon name="trash" size="1.1rem" />
				{t('profiles.edit.delete')}
			</Button>
		</section>
	{/if}

	<div class="actions">
		<Button variant="ghost" href={path(backHref)} data-focusable>{t('common.cancel')}</Button>
		<Button variant="primary" type="submit" icon="check" disabled={saving} data-focusable>
			{isNew ? t('profiles.edit.create') : t('common.save')}
		</Button>
	</div>
</form>

<Modal bind:open={confirmDelete} label={t('profiles.edit.deleteTitle')}>
	<div class="confirm">
		<Avatar preset={avatar} name={profile?.name ?? ''} size="4rem" />
		<h2>{t('profiles.edit.deleteConfirm', { name: profile?.name ?? '' })}</h2>
		<p class="muted">{t('profiles.edit.deleteConfirmBody')}</p>
		<div class="confirm-actions">
			<Button variant="glass" onclick={() => (confirmDelete = false)} data-focusable>
				{t('common.cancel')}
			</Button>
			<Button variant="primary" class="danger-btn" onclick={remove} data-focusable>
				{t('profiles.edit.delete')}
			</Button>
		</div>
	</div>
</Modal>

<style>
	.editor {
		display: grid;
		gap: 1.25rem;
		max-width: 46rem;
		margin: 0 auto;
	}
	.head {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin-bottom: 0.5rem;
	}
	.head h1 {
		font-size: var(--text-2xl);
		font-weight: 800;
	}
	.back {
		display: grid;
		place-items: center;
		flex: none;
		width: 2.75rem;
		height: 2.75rem;
		border-radius: 50%;
		border: 1px solid var(--line);
		background: rgb(255 255 255 / 0.05);
		transition: background-color var(--dur) var(--ease-out);
	}
	.back:hover {
		background: var(--bg-hover);
	}
	.card {
		display: grid;
		gap: 1rem;
		grid-template-columns: minmax(0, 1fr);
		padding: clamp(1.1rem, 0.8rem + 1.2vw, 1.75rem);
		border-radius: var(--radius-l);
	}
	.card h2 {
		font-size: var(--text-l);
	}
	.identity {
		grid-template-columns: auto minmax(0, 1fr);
		align-items: center;
		gap: clamp(1rem, 0.5rem + 2vw, 2rem);
	}
	@media (max-width: 480px) {
		.identity {
			grid-template-columns: minmax(0, 1fr);
			justify-items: center;
		}
		.name-field {
			width: 100%;
		}
	}
	.preview {
		position: relative;
	}
	.preview :global(.avatar) {
		box-shadow:
			0 0 0 1px rgb(255 255 255 / 0.12),
			0 20px 50px -18px var(--accent-glow);
	}
	.kids-badge {
		position: absolute;
		left: 50%;
		bottom: -0.6rem;
		transform: translateX(-50%);
		padding: 0.15rem 0.6rem;
		border-radius: var(--radius-pill);
		background: linear-gradient(90deg, #ffd166, #ff8fab);
		color: #2b1530;
		font-size: var(--text-xs);
		font-weight: 800;
		letter-spacing: 0.04em;
		box-shadow: var(--shadow-1);
	}
	.name-field {
		display: grid;
		gap: 0.45rem;
	}
	.name-field label,
	.pin-fields span {
		font-size: var(--text-xs);
		font-weight: 700;
		letter-spacing: var(--tracking-caps);
		text-transform: uppercase;
		color: var(--text-3);
	}
	.field {
		width: 100%;
		min-height: 3rem;
		padding: 0 1rem;
		border-radius: var(--radius-m);
		border: 1px solid var(--line-strong);
		background: rgb(0 0 0 / 0.25);
		font-size: var(--text-l);
		font-weight: 650;
		transition:
			border-color var(--dur) var(--ease-out),
			box-shadow var(--dur) var(--ease-out);
	}
	.field:focus-visible,
	.field:focus {
		outline: none;
		border-color: var(--accent);
		box-shadow: 0 0 0 3px var(--accent-soft);
	}
	.field[aria-invalid='true'] {
		border-color: var(--danger);
	}
	.err {
		color: var(--danger);
		font-size: var(--text-s);
		font-weight: 650;
	}
	.muted {
		color: var(--text-3);
		font-size: var(--text-s);
	}
	.small {
		font-size: var(--text-xs);
	}

	.avatars {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(4.75rem, 1fr));
		gap: 0.75rem;
	}
	.av {
		display: grid;
		justify-items: center;
		gap: 0.45rem;
		padding: 0.5rem 0.25rem;
		border: 0;
		border-radius: var(--radius-m);
		background: none;
		color: var(--text-3);
		font-size: var(--text-xs);
		font-weight: 650;
		transition:
			color var(--dur) var(--ease-out),
			background-color var(--dur) var(--ease-out);
	}
	.av :global(.avatar) {
		width: min(4.25rem, 100%);
		height: auto;
		aspect-ratio: 1;
		transition:
			transform var(--dur) var(--ease-out),
			box-shadow var(--dur) var(--ease-out);
	}
	.av:hover {
		color: var(--text);
	}
	.av:hover :global(.avatar) {
		transform: scale(1.06);
	}
	.av[aria-checked='true'] {
		color: var(--text);
	}

	.pin {
		display: grid;
		gap: 0.85rem;
		padding-top: 0.5rem;
		border-top: 1px solid var(--line);
	}
	.pin-head {
		display: flex;
		gap: 0.75rem;
		align-items: flex-start;
	}
	.pin-ico {
		display: grid;
		place-items: center;
		flex: none;
		width: 2.25rem;
		height: 2.25rem;
		border-radius: var(--radius-s);
		background: var(--accent-soft);
		color: var(--accent-strong);
	}
	.pin-fields {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
		gap: 0.75rem;
	}
	.pin-fields label {
		display: grid;
		gap: 0.4rem;
	}
	.pin-input {
		letter-spacing: 0.6em;
		font-variant-numeric: tabular-nums;
		max-width: 12rem;
	}
	.row-actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
	}
	.divider {
		height: 1px;
		background: var(--line);
		margin: 0.25rem 0;
	}

	.danger {
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
	}
	@media (max-width: 520px) {
		.danger {
			grid-template-columns: minmax(0, 1fr);
		}
	}
	.actions {
		position: sticky;
		bottom: calc(var(--shell-bottom) + 0.75rem);
		z-index: 2;
		display: flex;
		justify-content: flex-end;
		gap: 0.75rem;
		padding: 0.75rem;
		border-radius: var(--radius-pill);
		background: var(--bg-glass-strong);
		backdrop-filter: var(--glass-blur);
		-webkit-backdrop-filter: var(--glass-blur);
		border: 1px solid var(--line);
		box-shadow: var(--shadow-2);
	}

	.confirm {
		display: grid;
		justify-items: center;
		gap: 0.85rem;
		text-align: center;
	}
	.confirm h2 {
		font-size: var(--text-xl);
	}
	.confirm-actions {
		display: flex;
		gap: 0.75rem;
		margin-top: 0.5rem;
	}
	.confirm-actions :global(.danger-btn) {
		background: var(--danger);
		color: #fff;
		box-shadow: 0 10px 30px -10px color-mix(in oklab, var(--danger) 60%, transparent);
	}
</style>
