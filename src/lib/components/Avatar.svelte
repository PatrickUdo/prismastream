<!--
	Profile avatar from a generative preset (see avatars.ts). Unknown presets fall back
	to a prisma gradient with the initials of `name`.
-->
<script lang="ts">
	import { isAvatarPreset } from './avatars.ts';
	import { initials } from './format.ts';

	interface Props {
		preset: string;
		name?: string;
		size?: string;
		/** Show a ring (selected / active profile). */
		ring?: boolean;
		/** Decorative when false (default true = labelled with name). */
		labelled?: boolean;
	}

	let { preset, name = '', size = '2.5rem', ring = false, labelled = true }: Props = $props();
	const id = $props.id();
	const known = $derived(isAvatarPreset(preset));
</script>

<span
	class="avatar"
	class:ring
	style:--size={size}
	role={labelled && name ? 'img' : undefined}
	aria-label={labelled && name ? name : undefined}
	aria-hidden={labelled && name ? undefined : 'true'}
>
	<svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
		{#if preset === 'aurora'}
			<defs>
				<linearGradient id="{id}-bg" x1="0" y1="0" x2="0" y2="1">
					<stop offset="0" stop-color="#0a0f2e" />
					<stop offset="1" stop-color="#1c0f3d" />
				</linearGradient>
				<linearGradient id="{id}-a" x1="0" y1="0" x2="1" y2="0">
					<stop offset="0" stop-color="#3dffb0" stop-opacity="0" />
					<stop offset=".5" stop-color="#3dffb0" />
					<stop offset="1" stop-color="#4fd1ff" stop-opacity=".2" />
				</linearGradient>
				<linearGradient id="{id}-b" x1="0" y1="0" x2="1" y2="0">
					<stop offset="0" stop-color="#a77bff" stop-opacity=".2" />
					<stop offset=".6" stop-color="#a77bff" />
					<stop offset="1" stop-color="#ff7bd5" stop-opacity="0" />
				</linearGradient>
			</defs>
			<rect width="64" height="64" fill="url(#{id}-bg)" />
			<path
				d="M-4 30C10 14 22 38 36 22s22-6 32-14v14C56 30 48 26 36 38S10 34-4 46z"
				fill="url(#{id}-a)"
				opacity=".75"
			/>
			<path
				d="M-4 42c14-10 26 6 40-4s20-10 32-6v10c-12-2-20 4-32 12S8 50-4 56z"
				fill="url(#{id}-b)"
				opacity=".7"
			/>
			<circle cx="48" cy="14" r="1" fill="#fff" opacity=".8" />
			<circle cx="14" cy="10" r=".7" fill="#fff" opacity=".6" />
			<circle cx="30" cy="8" r=".6" fill="#fff" opacity=".5" />
		{:else if preset === 'ember'}
			<defs>
				<radialGradient id="{id}-bg" cx=".5" cy=".62" r=".7">
					<stop offset="0" stop-color="#ff9a3d" />
					<stop offset=".35" stop-color="#e2380f" />
					<stop offset=".75" stop-color="#3b0a03" />
					<stop offset="1" stop-color="#160301" />
				</radialGradient>
			</defs>
			<rect width="64" height="64" fill="url(#{id}-bg)" />
			<path
				d="M32 50c-8 0-12-6-10-13 1.5-5 6-7 6-13 5 3 6 8 5 11 3-1 4-4 4-6 4 4 6 9 4 14-1.5 4.5-4.5 7-9 7z"
				fill="#ffd27a"
				opacity=".9"
			/>
			<path
				d="M32 50c-3.5 0-5.5-3-4.5-6 .8-2.5 3-3.5 3-6.5 3 2 4.5 5 4 8-.4 3-1 4.5-2.5 4.5z"
				fill="#fff4d6"
			/>
			<circle cx="20" cy="18" r="1.1" fill="#ffd27a" />
			<circle cx="44" cy="14" r=".9" fill="#ffb347" />
			<circle cx="40" cy="24" r=".7" fill="#ffe7b0" />
			<circle cx="24" cy="28" r=".6" fill="#ffb347" />
		{:else if preset === 'tide'}
			<defs>
				<linearGradient id="{id}-bg" x1="0" y1="0" x2="0" y2="1">
					<stop offset="0" stop-color="#0b2c4f" />
					<stop offset="1" stop-color="#03111f" />
				</linearGradient>
			</defs>
			<rect width="64" height="64" fill="url(#{id}-bg)" />
			<circle cx="44" cy="20" r="8" fill="#cdeeff" opacity=".9" />
			<path d="M0 34c8-6 16-6 24 0s16 6 24 0 12-6 16-4v34H0z" fill="#1e6fd9" />
			<path d="M0 42c8-5 16-5 24 0s16 5 24 0 12-5 16-3v25H0z" fill="#39b6ff" opacity=".9" />
			<path d="M0 51c8-4 16-4 24 0s16 4 24 0 12-4 16-2v15H0z" fill="#a8ecff" opacity=".85" />
		{:else if preset === 'moss'}
			<rect width="64" height="64" fill="#0b1a10" />
			<circle cx="18" cy="46" r="20" fill="#2f7a4a" />
			<circle cx="46" cy="40" r="18" fill="#4f9d5d" opacity=".9" />
			<circle cx="34" cy="22" r="14" fill="#6fbf73" opacity=".85" />
			<circle cx="26" cy="30" r="7" fill="#c6e58b" opacity=".85" />
			<circle cx="44" cy="18" r="3" fill="#e9f7c4" />
		{:else if preset === 'nova'}
			<defs>
				<radialGradient id="{id}-c" cx=".5" cy=".5" r=".5">
					<stop offset="0" stop-color="#fff" />
					<stop offset=".25" stop-color="#ffc8f0" />
					<stop offset="1" stop-color="#7a3cff" stop-opacity="0" />
				</radialGradient>
			</defs>
			<rect width="64" height="64" fill="#0d0820" />
			<circle cx="32" cy="32" r="30" fill="url(#{id}-c)" opacity=".7" />
			<g stroke="#fff" stroke-linecap="round" opacity=".85">
				<path d="M32 6v52M6 32h52" stroke-width="1.2" />
				<path d="M14 14l36 36M50 14 14 50" stroke-width=".7" opacity=".7" />
			</g>
			<circle cx="32" cy="32" r="5" fill="#fff" />
			<circle cx="12" cy="50" r=".8" fill="#fff" />
			<circle cx="52" cy="10" r=".7" fill="#fff" />
		{:else if preset === 'dusk'}
			<defs>
				<linearGradient id="{id}-bg" x1="0" y1="0" x2="0" y2="1">
					<stop offset="0" stop-color="#2b1055" />
					<stop offset=".55" stop-color="#d4418e" />
					<stop offset="1" stop-color="#ff9a5a" />
				</linearGradient>
			</defs>
			<rect width="64" height="64" fill="url(#{id}-bg)" />
			<circle cx="32" cy="42" r="13" fill="#ffd8a8" />
			<path d="M0 44h64v20H0z" fill="#1a0b2e" />
			<path
				d="M8 49h20M36 49h22M16 54h32M24 59h16"
				stroke="#ffb27a"
				stroke-width="1.3"
				stroke-linecap="round"
				opacity=".6"
			/>
		{:else if preset === 'koi'}
			<rect width="64" height="64" fill="#0b3b45" />
			<circle cx="32" cy="32" r="22" fill="#0e4c58" />
			<path d="M32 12c11 0 18 9 14 18-3 7-14 6-14 2 0-6 9-4 9-10 0-5-4-9-9-10z" fill="#ff7a3d" />
			<path d="M32 52c-11 0-18-9-14-18 3-7 14-6 14-2 0 6-9 4-9 10 0 5 4 9 9 10z" fill="#fff1e6" />
			<circle cx="39" cy="20" r="1.6" fill="#0b3b45" />
			<circle cx="25" cy="44" r="1.6" fill="#0b3b45" />
			<circle cx="40" cy="34" r="2.2" fill="#ffd2b8" opacity=".9" />
		{:else if preset === 'pixel'}
			<rect width="64" height="64" fill="#120f24" />
			<g>
				<rect x="16" y="12" width="8" height="8" fill="#7c5cff" />
				<rect x="40" y="12" width="8" height="8" fill="#7c5cff" />
				<rect x="24" y="20" width="16" height="8" fill="#4fd1c5" />
				<rect x="8" y="28" width="16" height="8" fill="#ffd166" />
				<rect x="40" y="28" width="16" height="8" fill="#ffd166" />
				<rect x="24" y="28" width="16" height="8" fill="#ff6f91" />
				<rect x="16" y="36" width="32" height="8" fill="#4fd1c5" />
				<rect x="16" y="44" width="8" height="8" fill="#7c5cff" />
				<rect x="40" y="44" width="8" height="8" fill="#7c5cff" />
			</g>
		{:else}
			<defs>
				<linearGradient id="{id}-bg" x1="0" y1="0" x2="1" y2="1">
					<stop offset="0" stop-color="#5b45d6" />
					<stop offset="1" stop-color="#e57bff" />
				</linearGradient>
			</defs>
			<rect width="64" height="64" fill="url(#{id}-bg)" />
		{/if}
	</svg>
	{#if !known && name}
		<span class="initials" aria-hidden="true">{initials(name)}</span>
	{/if}
</span>

<style>
	.avatar {
		position: relative;
		display: inline-grid;
		place-items: center;
		flex: none;
		width: var(--size);
		height: var(--size);
		border-radius: 30%;
		overflow: hidden;
		box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.1);
		transition: box-shadow var(--dur) var(--ease-out);
	}
	.avatar svg {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
	}
	.ring {
		box-shadow:
			0 0 0 2px var(--bg),
			0 0 0 4px var(--accent);
	}
	.initials {
		position: relative;
		font-weight: 800;
		font-size: calc(var(--size) * 0.38);
		color: #fff;
	}
</style>
