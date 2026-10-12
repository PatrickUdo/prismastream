<!-- Password input with a show/hide toggle and an optional strength meter. -->
<script lang="ts">
	import { t } from '#lib/i18n/index.svelte.ts';
	import { passwordStrength } from '#lib/sync/crypto.ts';

	interface Props {
		id: string;
		label: string;
		value: string;
		autocomplete: 'current-password' | 'new-password';
		/** Show the strength meter (new passwords). */
		meter?: boolean;
		hint?: string;
	}

	let { id, label, value = $bindable(''), autocomplete, meter = false, hint }: Props = $props();
	let show = $state(false);
	const strength = $derived(passwordStrength(value));
</script>

<div class="field">
	<label for={id}>{label}</label>
	<div class="pass">
		<input
			{id}
			type={show ? 'text' : 'password'}
			{autocomplete}
			autocapitalize="off"
			spellcheck="false"
			bind:value
			aria-describedby={meter ? `${id}-strength` : hint ? `${id}-hint` : undefined}
			data-focusable
		/>
		<button
			type="button"
			class="eye"
			aria-pressed={show}
			aria-label={show ? t('sync.passphrase.hide') : t('sync.passphrase.show')}
			onclick={() => (show = !show)}
			data-focusable
		>
			{show ? t('sync.passphrase.hideShort') : t('sync.passphrase.showShort')}
		</button>
	</div>
	{#if meter}
		<div class="meter s{strength.score}" aria-hidden="true">
			{#each [0, 1, 2, 3] as i (i)}
				<span class:on={value && strength.score > i}></span>
			{/each}
		</div>
		<p id="{id}-strength" class="hint" aria-live="polite">
			{value ? t('sync.strength.label', { level: t('sync.strength.' + strength.score) }) : ''}
			{#if value && !strength.acceptable}· {t('account.password.rule')}{/if}
		</p>
	{/if}
	{#if hint}<p id="{id}-hint" class="hint">{hint}</p>{/if}
</div>

<style>
	.field {
		display: grid;
		gap: 0.4rem;
		min-width: 0;
	}
	label {
		font-weight: 650;
		font-size: var(--text-s);
	}
	.pass {
		display: flex;
		gap: 0.5rem;
		min-width: 0;
	}
	input {
		flex: 1;
		min-width: 0;
		min-height: 2.75rem;
		padding: 0 0.9rem;
		border-radius: var(--radius-m);
		border: 1px solid var(--line-strong);
		background: rgb(255 255 255 / 0.04);
		color: var(--text);
		font: inherit;
	}
	input:focus-visible {
		outline: none;
		box-shadow: var(--focus-ring);
	}
	.eye {
		min-width: 4.5rem;
		border-radius: var(--radius-m);
		border: 1px solid var(--line);
		background: none;
		color: var(--text-2);
		font-size: var(--text-s);
		font-weight: 650;
	}
	.meter {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 0.3rem;
	}
	.meter span {
		height: 0.3rem;
		border-radius: 999px;
		background: rgb(255 255 255 / 0.08);
	}
	.meter.s0 span.on,
	.meter.s1 span.on {
		background: #ff6b6b;
	}
	.meter.s2 span.on {
		background: #ffc861;
	}
	.meter.s3 span.on,
	.meter.s4 span.on {
		background: #4cd38a;
	}
	.hint {
		color: var(--text-3);
		font-size: var(--text-s);
	}
</style>
