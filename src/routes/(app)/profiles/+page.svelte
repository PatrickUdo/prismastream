<!--
	"Who's watching?": fullscreen profile picker with large avatars, and the manage mode
	(?manage=1) to edit, add or delete profiles. Locked profiles ask for their PIN; leaving
	kids mode asks for an adult PIN (when one exists).
-->
<script lang="ts">
	import type { Profile } from '#lib/types.ts';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { t } from '#lib/i18n/index.svelte.ts';
	import { user } from '#lib/stores/user.svelte.ts';
	import { kids } from '#lib/stores/kids.svelte.ts';
	import Avatar from '#lib/components/Avatar.svelte';
	import Button from '#lib/components/Button.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import Logo from '#lib/components/Logo.svelte';
	import { path } from '#lib/components/links.ts';
	import PinDialog from './PinDialog.svelte';
	import { MAX_PROFILES, isEditUnlocked, markProfileChosen, unlockEdit } from './session.ts';

	const manage = $derived(page.url.searchParams.get('manage') === '1');
	const canAdd = $derived(user.profiles.length < MAX_PROFILES);

	let grid = $state<HTMLUListElement>();
	let pin = $state<{
		open: boolean;
		title: string;
		subtitle?: string;
		hashes: string[];
		then: () => void;
	}>({ open: false, title: '', hashes: [], then: () => {} });

	// Focus the active profile (or the first) when the picker opens.
	$effect(() => {
		if (!user.ready || !grid) return;
		void manage;
		const el =
			grid.querySelector<HTMLElement>('[aria-current="true"]') ??
			grid.querySelector<HTMLElement>('.tile');
		el?.focus({ preventScroll: true });
	});

	function askPin(title: string, subtitle: string | undefined, hashes: string[], then: () => void) {
		pin = { open: true, title, subtitle, hashes, then };
	}

	async function finish(p: Profile) {
		await user.selectProfile(p.id);
		kids.relock();
		markProfileChosen();
		await goto(path('/'));
	}

	function pick(p: Profile) {
		const hashes = kids.pinsToSelect(p);
		if (!hashes) return void finish(p);
		const own = !!p.pinHash;
		askPin(
			own ? t('profiles.pin.enterFor', { name: p.name }) : t('profiles.kids.leaveTitle'),
			own ? undefined : t('profiles.kids.leaveBody'),
			hashes,
			() => void finish(p)
		);
	}

	function edit(p: Profile) {
		const go = () => void goto(path(`/profiles/${encodeURIComponent(p.id)}`));
		if (p.pinHash && p.id !== user.activeId && !isEditUnlocked(p.id)) {
			askPin(
				t('profiles.pin.enterFor', { name: p.name }),
				t('profiles.pin.toEdit'),
				[p.pinHash],
				() => {
					unlockEdit(p.id);
					go();
				}
			);
		} else go();
	}

	function openManage() {
		const go = () => void goto(path('/profiles?manage=1'), { replaceState: true });
		if (kids.locked) {
			askPin(
				t('profiles.kids.unlockTitle'),
				t('profiles.kids.unlockBody'),
				kids.adultPinProfiles.map((p) => p.pinHash!),
				() => {
					kids.unlock();
					go();
				}
			);
		} else go();
	}

	/** Arrow keys move between tiles (remote control / keyboard). */
	function onkeydown(e: KeyboardEvent) {
		if (!grid || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
		const tiles = [...grid.querySelectorAll<HTMLElement>('.tile')];
		const i = tiles.indexOf(document.activeElement as HTMLElement);
		if (i === -1) return;
		const j = i + (e.key === 'ArrowRight' ? 1 : -1);
		if (j < 0 || j >= tiles.length) return;
		e.preventDefault();
		tiles[j].focus();
	}
</script>

<svelte:head>
	<title>{manage ? t('profiles.manageTitle') : t('profiles.whoTitle')} · PrismaStream</title>
</svelte:head>

<div class="screen">
	<div class="glow" aria-hidden="true"></div>
	<header class="brand">
		<Logo size="2rem" wordmark />
	</header>

	<div class="center">
		<h1>{manage ? t('profiles.manageTitle') : t('profiles.whoTitle')}</h1>
		{#if manage}<p class="sub">{t('profiles.manageBody')}</p>{/if}

		{#if user.ready}
			<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
			<ul class="tiles" class:manage bind:this={grid} {onkeydown}>
				{#each user.profiles as p, i (p.id)}
					<li style:--i={i}>
						<button
							type="button"
							class="tile"
							aria-current={p.id === user.activeId ? 'true' : undefined}
							aria-label={[
								manage ? t('profiles.editProfile', { name: p.name }) : p.name,
								p.isKids ? t('profiles.kids.badge') : '',
								p.pinHash ? t('profiles.locked') : ''
							]
								.filter(Boolean)
								.join(', ')}
							data-focusable
							onclick={() => (manage ? edit(p) : pick(p))}
						>
							<span class="av">
								<Avatar preset={p.avatar} name={p.name} size="100%" labelled={false} />
								{#if manage}
									<span class="edit-overlay" aria-hidden="true"
										><Icon name="edit" size="38%" /></span
									>
								{/if}
								{#if p.pinHash}
									<span class="lock" aria-hidden="true"><Icon name="lock" size="0.95rem" /></span>
								{/if}
								{#if p.isKids}
									<span class="kids" aria-hidden="true">{t('profiles.kids.badge')}</span>
								{/if}
							</span>
							<span class="name">{p.name}</span>
						</button>
					</li>
				{/each}
				{#if canAdd && (manage || user.profiles.length < 5)}
					<li style:--i={user.profiles.length}>
						<a class="tile add" href={path('/profiles/new')} data-focusable>
							<span class="av add-av"><Icon name="plus" size="40%" /></span>
							<span class="name">{t('profiles.add')}</span>
						</a>
					</li>
				{/if}
			</ul>

			<div class="foot">
				{#if manage}
					<Button
						variant="primary"
						size="l"
						href={path('/profiles')}
						data-focusable
						data-sveltekit-replacestate>{t('profiles.done')}</Button
					>
				{:else}
					<Button variant="glass" icon="settings" onclick={openManage} data-focusable>
						{t('profiles.manage')}
					</Button>
				{/if}
			</div>
		{/if}
	</div>
</div>

<PinDialog
	bind:open={pin.open}
	title={pin.title}
	subtitle={pin.subtitle}
	hashes={pin.hashes}
	onsuccess={() => pin.then()}
/>

<style>
	.screen {
		position: fixed;
		inset: 0;
		z-index: calc(var(--z-nav) + 2);
		display: grid;
		grid-template-rows: auto 1fr;
		overflow-y: auto;
		padding: calc(var(--safe-top) + 1.25rem) calc(var(--safe-right) + var(--gutter))
			calc(var(--safe-bottom) + 2rem) calc(var(--safe-left) + var(--gutter));
		background: var(--bg);
		isolation: isolate;
	}
	.glow {
		position: fixed;
		inset: 0;
		z-index: -1;
		pointer-events: none;
		background:
			radial-gradient(50rem 30rem at 50% 18%, var(--accent-faint), transparent 70%),
			radial-gradient(40rem 24rem at 15% 100%, rgb(107 200 255 / 0.05), transparent 70%),
			radial-gradient(40rem 24rem at 90% 95%, rgb(255 107 139 / 0.04), transparent 70%);
	}
	.brand {
		display: flex;
		justify-content: center;
	}
	@media (min-width: 800px) {
		.brand {
			justify-content: flex-start;
		}
	}
	.center {
		display: grid;
		align-content: center;
		justify-items: center;
		gap: clamp(1.5rem, 1rem + 2vw, 3rem);
		padding-block: 2rem;
		text-align: center;
	}
	h1 {
		font-weight: 800;
		font-size: clamp(2rem, 1.3rem + 3vw, 4rem);
	}
	.sub {
		margin-top: -1rem;
		color: var(--text-2);
	}
	.tiles {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: clamp(1rem, 0.5rem + 2.2vw, 2.75rem);
		max-width: 72rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.tiles li {
		animation: rise var(--dur-slow) var(--ease-out) both;
		animation-delay: calc(var(--i) * 60ms);
	}
	@keyframes rise {
		from {
			opacity: 0;
			transform: translateY(16px) scale(0.96);
		}
	}
	.tile {
		--size: clamp(6rem, 4.5rem + 6vw, 10.5rem);
		display: grid;
		justify-items: center;
		gap: 0.85rem;
		width: calc(var(--size) + 1rem);
		padding: 0.5rem;
		border: 0;
		border-radius: var(--radius-l);
		background: none;
		color: var(--text-2);
		outline: none;
	}
	.tile:focus-visible {
		box-shadow: none;
	}
	.av {
		position: relative;
		display: grid;
		place-items: center;
		width: var(--size);
		height: var(--size);
		border-radius: 30%;
		transition:
			transform var(--dur) var(--ease-out),
			box-shadow var(--dur) var(--ease-out);
	}
	.av :global(.avatar) {
		width: 100%;
		height: 100%;
	}
	.tile:hover .av,
	.tile:focus-visible .av {
		transform: scale(1.07);
		box-shadow:
			0 0 0 3px var(--bg),
			0 0 0 6px var(--accent),
			0 24px 60px -16px var(--accent-glow);
	}
	.tile[aria-current='true']:not(:hover):not(:focus-visible) .av {
		box-shadow: 0 0 0 1px var(--line-strong);
	}
	.name {
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: clamp(1rem, 0.9rem + 0.4vw, 1.25rem);
		font-weight: 700;
		transition: color var(--dur) var(--ease-out);
	}
	.tile:hover .name,
	.tile:focus-visible .name {
		color: var(--text);
	}
	.lock {
		position: absolute;
		right: 0.4rem;
		bottom: 0.4rem;
		display: grid;
		place-items: center;
		width: 1.9rem;
		height: 1.9rem;
		border-radius: 50%;
		background: rgb(7 7 11 / 0.72);
		backdrop-filter: blur(8px);
		-webkit-backdrop-filter: blur(8px);
		color: #fff;
	}
	.kids {
		position: absolute;
		left: 50%;
		bottom: -0.55rem;
		transform: translateX(-50%);
		padding: 0.12rem 0.6rem;
		border-radius: var(--radius-pill);
		background: linear-gradient(90deg, #ffd166, #ff8fab);
		color: #2b1530;
		font-size: var(--text-xs);
		font-weight: 800;
		letter-spacing: 0.04em;
		box-shadow: var(--shadow-1);
	}
	.edit-overlay {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		border-radius: inherit;
		background: rgb(7 7 11 / 0.5);
		color: #fff;
	}
	.add-av {
		border: 2px dashed var(--line-strong);
		color: var(--text-3);
		background: rgb(255 255 255 / 0.03);
		transition:
			transform var(--dur) var(--ease-out),
			box-shadow var(--dur) var(--ease-out),
			color var(--dur) var(--ease-out),
			border-color var(--dur) var(--ease-out);
	}
	.add:hover .add-av,
	.add:focus-visible .add-av {
		color: var(--text);
		border-color: transparent;
	}
	.foot {
		display: flex;
		justify-content: center;
		gap: 0.75rem;
	}
</style>
