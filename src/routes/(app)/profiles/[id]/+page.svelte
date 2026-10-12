<!--
	Edit a profile. A profile with a PIN asks for it first (unless it is the active profile);
	in locked kids mode an adult PIN is needed first.
-->
<script lang="ts">
	import { page } from '$app/state';
	import { t } from '#lib/i18n/index.svelte.ts';
	import { user } from '#lib/stores/user.svelte.ts';
	import { kids } from '#lib/stores/kids.svelte.ts';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import Button from '#lib/components/Button.svelte';
	import { path } from '#lib/components/links.ts';
	import ProfileEditor from '../ProfileEditor.svelte';
	import LockGate from '../LockGate.svelte';
	import { isEditUnlocked, unlockEdit } from '../session.ts';

	const id = $derived(page.params.id ?? '');
	const profile = $derived(user.profiles.find((p) => p.id === id));
	const from = $derived(page.url.searchParams.get('from'));
	const backHref = $derived(from === 'settings' ? '/settings' : '/profiles?manage=1');

	let unlocked = $state(0);
	const needsOwnPin = $derived.by(() => {
		void unlocked;
		return !!profile?.pinHash && profile.id !== user.activeId && !isEditUnlocked(profile.id);
	});
</script>

<svelte:head>
	<title>{t('profiles.edit.title')} · PrismaStream</title>
</svelte:head>

<div class="page">
	{#if !user.ready}
		<!-- loading -->
	{:else if !profile}
		<EmptyState icon="user" title={t('profiles.notFound')}>
			{#snippet actions()}
				<Button variant="primary" href={path('/profiles?manage=1')}>{t('nav.profiles')}</Button>
			{/snippet}
		</EmptyState>
	{:else if kids.locked}
		<LockGate
			title={t('profiles.kids.unlockTitle')}
			subtitle={t('profiles.kids.unlockBody')}
			hashes={kids.adultPinProfiles.map((p) => p.pinHash!)}
			onsuccess={() => kids.unlock()}
			oncancel={() => history.back()}
		/>
	{:else if needsOwnPin}
		<LockGate
			title={t('profiles.pin.enterFor', { name: profile.name })}
			subtitle={t('profiles.pin.toEdit')}
			hashes={[profile.pinHash!]}
			onsuccess={() => {
				unlockEdit(profile.id);
				unlocked++;
			}}
			oncancel={() => history.back()}
		/>
	{:else}
		{#key profile.id}
			<ProfileEditor {profile} {backHref} />
		{/key}
	{/if}
</div>
