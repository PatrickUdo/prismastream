<!--
	Friendly banners above content: "Verbind met PrismaStream Cloud" (a backend url but no
	account yet, dismissible per device) and the offline notice in remote mode.
-->
<script lang="ts">
	import { t } from '#lib/i18n/index.svelte.ts';
	import { library } from '#lib/catalog/library.svelte.ts';
	import Button from './Button.svelte';
	import Icon from './Icon.svelte';
	import { path } from './links.ts';

	interface Props {
		/** Inside a full-bleed area: add the page gutters. */
		inset?: boolean;
	}

	let { inset = false }: Props = $props();

	const KEY = 'ps:cloudBanner:dismissed';
	let dismissed = $state(read());

	function read(): boolean {
		try {
			return localStorage.getItem(KEY) === '1';
		} catch {
			return false;
		}
	}

	function dismiss() {
		dismissed = true;
		try {
			localStorage.setItem(KEY, '1');
		} catch {
			// private mode: dismissed for this session only
		}
	}

	const showConnect = $derived(
		library.initialized && !!library.backendUrl && !library.hasAccount && !dismissed
	);
	const showOffline = $derived(library.mode === 'remote' && library.offline);
</script>

{#if showOffline}
	<div class="banner offline" class:inset role="status">
		<Icon name="cloud" size="1.2rem" />
		<p><strong>{t('cloud.offline.title')}</strong> {t('cloud.offline.body')}</p>
		<Button variant="ghost" size="s" icon="refresh" onclick={() => library.poke()} data-focusable>
			{t('common.retry')}
		</Button>
	</div>
{:else if showConnect}
	<div class="banner" class:inset>
		<span class="ico" aria-hidden="true"><Icon name="cloud" size="1.3rem" /></span>
		<div class="copy">
			<strong>{t('cloud.banner.title')}</strong>
			<p>{t('cloud.banner.body')}</p>
		</div>
		<div class="actions">
			<Button variant="primary" size="s" href={path('/settings/sync')} data-focusable>
				{t('cloud.banner.action')}
			</Button>
			<button
				type="button"
				class="close"
				aria-label={t('cloud.banner.dismiss')}
				onclick={dismiss}
				data-focusable
			>
				<Icon name="close" size="1rem" />
			</button>
		</div>
	</div>
{/if}

<style>
	.banner {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.75rem 1rem;
		margin: 0 0 1.5rem;
		padding: 0.9rem 1rem;
		border-radius: var(--radius-l);
		border: 1px solid var(--line);
		background:
			radial-gradient(30rem 8rem at 0% 0%, var(--accent-faint), transparent 70%), var(--bg-elev-1);
		min-width: 0;
	}
	.banner.inset {
		margin-inline: var(--page-start) var(--page-end);
	}
	.ico {
		display: grid;
		place-items: center;
		width: 2.5rem;
		height: 2.5rem;
		border-radius: 50%;
		background: var(--accent-faint);
		color: var(--accent);
		flex: none;
	}
	.copy {
		flex: 1 1 14rem;
		min-width: 0;
	}
	.copy p,
	.offline p {
		color: var(--text-2);
		font-size: var(--text-s);
	}
	.offline p {
		flex: 1 1 14rem;
		min-width: 0;
	}
	.offline strong {
		color: var(--text);
	}
	.actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.close {
		display: grid;
		place-items: center;
		width: 2.25rem;
		height: 2.25rem;
		border: 0;
		border-radius: 50%;
		background: none;
		color: var(--text-3);
	}
	@media (hover: hover) {
		.close:hover {
			color: var(--text);
			background: rgb(255 255 255 / 0.06);
		}
	}
</style>
