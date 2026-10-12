<!-- Shown instead of a settings page while kids mode is active and not unlocked. -->
<script lang="ts">
	import { t } from '#lib/i18n/index.svelte.ts';
	import EmptyState from './EmptyState.svelte';
	import Button from './Button.svelte';
	import { path } from './links.ts';
</script>

<div class="page">
	<EmptyState icon="lock" title={t('settings.kids.title')} body={t('settings.kids.body')}>
		{#snippet actions()}
			<Button variant="primary" icon="settings" href={path('/settings')} data-focusable>
				{t('settings.kids.unlock')}
			</Button>
		{/snippet}
	</EmptyState>
</div>
