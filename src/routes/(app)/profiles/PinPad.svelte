<!--
	4-digit PIN pad. Works with touch/mouse (on-screen keys), the keyboard (0-9, Backspace,
	Escape) and a remote (arrow keys move between keys, OK presses). Submits automatically
	after the 4th digit; `onsubmit` returns 'ok' | 'wrong' | 'blocked'. After 5 wrong PINs
	entry is blocked for 30 seconds (kids store).
-->
<script lang="ts">
	import { t } from '#lib/i18n/index.svelte.ts';
	import { kids } from '#lib/stores/kids.svelte.ts';

	interface Props {
		title: string;
		subtitle?: string;
		onsubmit: (pin: string) => Promise<'ok' | 'wrong' | 'blocked'>;
		oncancel?: () => void;
		/** Focus the first key on mount. */
		autofocus?: boolean;
	}

	let { title, subtitle, onsubmit, oncancel, autofocus = true }: Props = $props();

	const id = $props.id();
	let pin = $state('');
	let busy = $state(false);
	let error = $state('');
	let shake = $state(0);
	let pad = $state<HTMLDivElement>();
	let now = $state(Date.now());

	const lockedFor = $derived(Math.max(0, Math.ceil((kids.lockedUntil - now) / 1000)));
	const blocked = $derived(lockedFor > 0);

	$effect(() => {
		if (!blocked) return;
		const timer = setInterval(() => (now = Date.now()), 250);
		return () => clearInterval(timer);
	});

	$effect(() => {
		if (autofocus) pad?.querySelector<HTMLButtonElement>('button[data-key="1"]')?.focus();
	});

	// Keys in visual order (3 columns).
	const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'cancel', '0', 'back'] as const;

	async function press(key: string) {
		if (busy) return;
		if (key === 'back') {
			pin = pin.slice(0, -1);
			error = '';
			return;
		}
		if (key === 'cancel') {
			oncancel?.();
			return;
		}
		now = Date.now();
		if (blocked || pin.length >= 4) return;
		pin += key;
		error = '';
		if (pin.length === 4) {
			busy = true;
			const result = await onsubmit(pin);
			busy = false;
			if (result === 'ok') return;
			now = Date.now();
			pin = '';
			shake++;
			error =
				result === 'blocked'
					? ''
					: kids.attemptsLeft === 1
						? t('profiles.pin.wrongLeftOne')
						: kids.attemptsLeft === 2
							? t('profiles.pin.wrongLeft', { n: 2 })
							: t('profiles.pin.wrong');
		}
	}

	function onwindowkey(e: KeyboardEvent) {
		const target = e.target;
		if (target instanceof Element && target.closest('input, textarea, select, [contenteditable]'))
			return;
		if (e.metaKey || e.ctrlKey || e.altKey) return;
		if (/^[0-9]$/.test(e.key)) {
			e.preventDefault();
			void press(e.key);
		} else if (e.key === 'Backspace') {
			e.preventDefault();
			void press('back');
		}
	}

	/** Arrow keys move between keys in the 3×4 grid (remote control). */
	function onkeykey(e: KeyboardEvent, i: number) {
		const delta: Record<string, number> = {
			ArrowLeft: -1,
			ArrowRight: 1,
			ArrowUp: -3,
			ArrowDown: 3
		};
		const d = delta[e.key];
		if (d === undefined) return;
		const j = i + d;
		if (j < 0 || j >= KEYS.length) return;
		if ((d === -1 && i % 3 === 0) || (d === 1 && i % 3 === 2)) return;
		e.preventDefault();
		e.stopPropagation();
		pad?.querySelectorAll<HTMLButtonElement>('.key')[j]?.focus();
	}
</script>

<svelte:window onkeydown={onwindowkey} />

<div class="pinpad" bind:this={pad}>
	<div class="head">
		<h2 id="{id}-t">{title}</h2>
		{#if subtitle}<p>{subtitle}</p>{/if}
	</div>

	{#key shake}
		<div
			class="dots"
			class:shake={shake > 0}
			role="status"
			aria-label={t('profiles.pin.entered', { n: pin.length })}
		>
			{#each [0, 1, 2, 3] as i (i)}
				<span class="dot" class:filled={i < pin.length}></span>
			{/each}
		</div>
	{/key}

	<p class="msg" class:error={!!error || blocked} aria-live="assertive">
		{#if blocked}
			{t('profiles.pin.blocked', { s: lockedFor })}
		{:else}
			{error}
		{/if}
	</p>

	<div class="keys" role="group" aria-labelledby="{id}-t">
		{#each KEYS as key, i (key)}
			{#if key === 'cancel'}
				{#if oncancel}
					<button
						type="button"
						class="key text"
						data-key={key}
						data-focusable
						onclick={() => press(key)}
						onkeydown={(e) => onkeykey(e, i)}>{t('common.cancel')}</button
					>
				{:else}
					<span class="key spacer" aria-hidden="true"></span>
				{/if}
			{:else if key === 'back'}
				<button
					type="button"
					class="key text"
					data-key={key}
					data-focusable
					aria-label={t('profiles.pin.backspace')}
					disabled={pin.length === 0}
					onclick={() => press(key)}
					onkeydown={(e) => onkeykey(e, i)}
				>
					<svg viewBox="0 0 24 24" width="1.4rem" height="1.4rem" aria-hidden="true">
						<path
							d="M9 5h10.5A1.5 1.5 0 0 1 21 6.5v11a1.5 1.5 0 0 1-1.5 1.5H9l-6-7z M12.5 9.5l5 5m0-5-5 5"
							fill="none"
							stroke="currentColor"
							stroke-width="1.75"
							stroke-linecap="round"
							stroke-linejoin="round"
						/>
					</svg>
				</button>
			{:else}
				<button
					type="button"
					class="key"
					data-key={key}
					data-focusable
					disabled={blocked || busy}
					onclick={() => press(key)}
					onkeydown={(e) => onkeykey(e, i)}>{key}</button
				>
			{/if}
		{/each}
	</div>
</div>

<style>
	.pinpad {
		display: grid;
		justify-items: center;
		gap: 1.25rem;
		text-align: center;
	}
	.head {
		display: grid;
		gap: 0.4rem;
	}
	h2 {
		font-size: var(--text-xl);
	}
	.head p {
		color: var(--text-2);
		font-size: var(--text-s);
	}
	.dots {
		display: flex;
		gap: 1rem;
		padding: 0.5rem 0;
	}
	.dot {
		width: 0.95rem;
		height: 0.95rem;
		border-radius: 50%;
		border: 2px solid var(--line-strong);
		transition:
			background-color var(--dur-fast) var(--ease-out),
			border-color var(--dur-fast) var(--ease-out),
			transform var(--dur) var(--ease-out);
	}
	.dot.filled {
		background: var(--accent);
		border-color: var(--accent);
		box-shadow: 0 0 14px var(--accent-glow);
		transform: scale(1.1);
	}
	.shake {
		animation: shake 420ms var(--ease-out);
	}
	@keyframes shake {
		20%,
		60% {
			transform: translateX(-8px);
		}
		40%,
		80% {
			transform: translateX(8px);
		}
	}
	.msg {
		min-height: 1.5em;
		font-size: var(--text-s);
		font-weight: 650;
		color: var(--text-3);
	}
	.msg.error {
		color: var(--danger);
	}
	.keys {
		display: grid;
		grid-template-columns: repeat(3, auto);
		gap: clamp(0.6rem, 0.4rem + 1vw, 1rem);
	}
	.key {
		display: grid;
		place-items: center;
		width: clamp(4rem, 3.4rem + 3vw, 5rem);
		aspect-ratio: 1;
		border-radius: 50%;
		border: 1px solid var(--line);
		background: rgb(255 255 255 / 0.05);
		color: var(--text);
		font-size: 1.6rem;
		font-weight: 650;
		font-variant-numeric: tabular-nums;
		transition:
			background-color var(--dur) var(--ease-out),
			border-color var(--dur) var(--ease-out),
			transform var(--dur-fast) var(--ease-out);
	}
	.key:hover:not(:disabled) {
		background: var(--bg-hover);
		border-color: var(--line-strong);
	}
	.key:active:not(:disabled) {
		transform: scale(0.94);
		background: var(--accent-soft);
	}
	.key:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}
	.key:focus-visible {
		border-color: var(--accent);
	}
	.key.text {
		border-color: transparent;
		background: transparent;
		font-size: var(--text-s);
		color: var(--text-2);
	}
	.spacer {
		border: 0;
		background: none;
	}
</style>
