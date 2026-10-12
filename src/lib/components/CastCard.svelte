<!-- Cast member: round photo (or initials on a generated gradient), name and role. -->
<script lang="ts">
	import type { Person } from '#lib/types.ts';
	import { hashString } from './art.ts';
	import { initials } from './format.ts';

	interface Props {
		person: Person;
	}

	let { person }: Props = $props();
	let failed = $state(false);
	const hue = $derived(hashString(person.name) % 360);
</script>

<div class="cast">
	<div class="photo" style:--hue={hue}>
		{#if person.profileUrl && !failed}
			<img
				src={person.profileUrl}
				alt=""
				loading="lazy"
				decoding="async"
				onerror={() => (failed = true)}
			/>
		{:else}
			<span aria-hidden="true">{initials(person.name)}</span>
		{/if}
	</div>
	<strong>{person.name}</strong>
	{#if person.character}<span class="role">{person.character}</span>{/if}
</div>

<style>
	.cast {
		display: grid;
		justify-items: center;
		gap: 0.2rem;
		text-align: center;
		border-radius: var(--radius-m);
		padding-bottom: 0.25rem;
	}
	.photo {
		display: grid;
		place-items: center;
		width: 100%;
		aspect-ratio: 1;
		margin-bottom: 0.45rem;
		border-radius: 50%;
		overflow: hidden;
		background:
			radial-gradient(circle at 30% 25%, hsl(var(--hue) 70% 62% / 0.75), transparent 60%),
			radial-gradient(circle at 75% 80%, hsl(calc(var(--hue) + 60) 65% 45% / 0.6), transparent 65%),
			var(--bg-elev-2);
		box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.08);
	}
	.photo span {
		font-size: 1.5rem;
		font-weight: 800;
		letter-spacing: -0.02em;
		color: #fff;
		text-shadow: 0 2px 10px rgb(0 0 0 / 0.35);
	}
	img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	strong {
		font-size: var(--text-s);
		font-weight: 700;
		line-height: 1.3;
	}
	.role {
		font-size: var(--text-xs);
		color: var(--text-3);
		line-height: 1.3;
	}
</style>
