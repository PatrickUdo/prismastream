<!-- Calm empty / error / not-found state with an icon in a prisma halo. -->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon, { type IconName } from './Icon.svelte';

	interface Props {
		icon?: IconName;
		title: string;
		body?: string;
		tone?: 'default' | 'error';
		actions?: Snippet;
	}

	let { icon = 'sparkle', title, body, tone = 'default', actions }: Props = $props();
</script>

<div class="empty {tone}" role={tone === 'error' ? 'alert' : undefined}>
	<div class="halo" aria-hidden="true"><Icon name={icon} size="1.75rem" /></div>
	<h2>{title}</h2>
	{#if body}<p>{body}</p>{/if}
	{#if actions}<div class="actions">{@render actions()}</div>{/if}
</div>

<style>
	.empty {
		display: grid;
		justify-items: center;
		gap: 0.85rem;
		max-width: 30rem;
		margin: 0 auto;
		padding: 4rem 1rem;
		text-align: center;
	}
	.halo {
		position: relative;
		display: grid;
		place-items: center;
		width: 4.5rem;
		height: 4.5rem;
		margin-bottom: 0.5rem;
		border-radius: 50%;
		color: var(--text);
		background:
			radial-gradient(circle at 50% 40%, var(--accent-soft), transparent 70%), var(--bg-elev-1);
		box-shadow:
			inset 0 0 0 1px var(--line),
			0 20px 50px -20px var(--accent-glow);
	}
	.halo::before {
		content: '';
		position: absolute;
		inset: -1px;
		border-radius: inherit;
		padding: 1px;
		background: var(--spectrum);
		opacity: 0.35;
		mask:
			linear-gradient(#000 0 0) content-box exclude,
			linear-gradient(#000 0 0);
	}
	.error .halo {
		color: var(--danger);
		background:
			radial-gradient(
				circle at 50% 40%,
				color-mix(in oklab, var(--danger) 22%, transparent),
				transparent 70%
			),
			var(--bg-elev-1);
	}
	h2 {
		font-size: var(--text-xl);
	}
	p {
		color: var(--text-2);
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 0.75rem;
		margin-top: 0.75rem;
	}
</style>
