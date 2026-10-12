<!-- New profile. In (locked) kids mode an adult PIN is needed first. -->
<script lang="ts">
	import { goto } from '$app/navigation';
	import { t } from '#lib/i18n/index.svelte.ts';
	import { user } from '#lib/stores/user.svelte.ts';
	import { kids } from '#lib/stores/kids.svelte.ts';
	import { path } from '#lib/components/links.ts';
	import ProfileEditor from '../ProfileEditor.svelte';
	import LockGate from '../LockGate.svelte';
	import { MAX_PROFILES } from '../session.ts';

	$effect(() => {
		if (user.ready && user.profiles.length >= MAX_PROFILES) void goto(path('/profiles?manage=1'));
	});
</script>

<svelte:head>
	<title>{t('profiles.edit.newTitle')} · PrismaStream</title>
</svelte:head>

<div class="page">
	{#if kids.locked}
		<LockGate
			title={t('profiles.kids.unlockTitle')}
			subtitle={t('profiles.kids.unlockBody')}
			hashes={kids.adultPinProfiles.map((p) => p.pinHash!)}
			onsuccess={() => kids.unlock()}
			oncancel={() => history.back()}
		/>
	{:else if user.ready}
		<ProfileEditor />
	{/if}
</div>
