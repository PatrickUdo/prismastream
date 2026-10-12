<!-- Inline SVG icon set (24×24, 1.75 stroke). Decorative unless `label` is given. -->
<script lang="ts" module>
	export type IconName =
		| 'home'
		| 'film'
		| 'series'
		| 'live'
		| 'search'
		| 'bookmark'
		| 'bookmark-filled'
		| 'settings'
		| 'play'
		| 'info'
		| 'plus'
		| 'check'
		| 'heart'
		| 'heart-filled'
		| 'chevron-left'
		| 'chevron-right'
		| 'chevron-down'
		| 'close'
		| 'star'
		| 'globe'
		| 'subtitles'
		| 'play-circle'
		| 'sparkle'
		| 'sort'
		| 'source'
		| 'monitor'
		| 'sliders'
		| 'user'
		| 'refresh'
		| 'clock'
		| 'alert'
		| 'grid'
		| 'pause'
		| 'list'
		| 'star-outline'
		| 'lock'
		| 'edit'
		| 'trash'
		| 'grip'
		| 'arrow-up'
		| 'arrow-down'
		| 'eye'
		| 'eye-off'
		| 'external'
		| 'smile'
		| 'palette'
		| 'key'
		| 'cloud';

	const FILLED = new Set<IconName>([
		'play',
		'pause',
		'heart-filled',
		'star',
		'bookmark-filled',
		'sparkle'
	]);
</script>

<script lang="ts">
	interface Props {
		name: IconName;
		size?: string;
		label?: string;
		class?: string;
	}

	let { name, size = '1.25rem', label, class: cls = '' }: Props = $props();
	const filled = $derived(FILLED.has(name));
</script>

<svg
	class="icon {cls}"
	viewBox="0 0 24 24"
	width={size}
	height={size}
	fill={filled ? 'currentColor' : 'none'}
	stroke={filled ? 'none' : 'currentColor'}
	stroke-width="1.75"
	stroke-linecap="round"
	stroke-linejoin="round"
	role={label ? 'img' : undefined}
	aria-label={label}
	aria-hidden={label ? undefined : 'true'}
	focusable="false"
>
	{#if name === 'home'}
		<path
			d="M3.5 10.2 12 3.5l8.5 6.7V19a1.5 1.5 0 0 1-1.5 1.5h-4.25v-5.75h-5.5v5.75H5A1.5 1.5 0 0 1 3.5 19z"
		/>
	{:else if name === 'film'}
		<rect x="3" y="4" width="18" height="16" rx="2.5" />
		<path d="M7.5 4v16M16.5 4v16M3 9h4.5M3 15h4.5M16.5 9H21M16.5 15H21" />
	{:else if name === 'series'}
		<rect x="2.75" y="6.25" width="18.5" height="13" rx="2.5" />
		<path d="m8.5 2.5 3.5 3.5 3.5-3.5M9 22h6" />
	{:else if name === 'live'}
		<circle cx="12" cy="12" r="2" />
		<path
			d="M16.24 7.76a6 6 0 0 1 0 8.49M7.76 16.24a6 6 0 0 1 0-8.49M19.07 4.93a10 10 0 0 1 0 14.14M4.93 19.07a10 10 0 0 1 0-14.14"
		/>
	{:else if name === 'search'}
		<circle cx="11" cy="11" r="6.75" />
		<path d="m20.25 20.25-4.5-4.5" />
	{:else if name === 'bookmark'}
		<path d="M6.5 3.5h11a1 1 0 0 1 1 1v16l-6.5-4.25L5.5 20.5v-16a1 1 0 0 1 1-1z" />
	{:else if name === 'bookmark-filled'}
		<path
			d="M6.5 3h11A1.5 1.5 0 0 1 19 4.5v16.4a.6.6 0 0 1-.93.5L12 17.4l-6.07 4a.6.6 0 0 1-.93-.5V4.5A1.5 1.5 0 0 1 6.5 3z"
		/>
	{:else if name === 'settings'}
		<circle cx="12" cy="12" r="3" />
		<path
			d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
		/>
	{:else if name === 'play'}
		<path
			d="M7 4.6v14.8a1.1 1.1 0 0 0 1.68.93l11.6-7.4a1.1 1.1 0 0 0 0-1.86L8.68 3.67A1.1 1.1 0 0 0 7 4.6z"
		/>
	{:else if name === 'info'}
		<circle cx="12" cy="12" r="9" />
		<path d="M12 11v5.5M12 7.75h.01" />
	{:else if name === 'plus'}
		<path d="M12 5v14M5 12h14" />
	{:else if name === 'check'}
		<path d="m5 12.5 4.5 4.5L19 7.5" />
	{:else if name === 'heart'}
		<path
			d="M12 20.25s-7.4-4.55-9.15-9.05C1.7 8.1 3.75 4.75 7.15 4.75c2 0 3.55 1.1 4.85 2.8 1.3-1.7 2.85-2.8 4.85-2.8 3.4 0 5.45 3.35 4.3 6.45-1.75 4.5-9.15 9.05-9.15 9.05z"
		/>
	{:else if name === 'heart-filled'}
		<path
			d="M12 21s-7.9-4.8-9.8-9.6C.9 7.9 3.2 4 7.1 4c2.1 0 3.7 1.05 4.9 2.6C13.2 5.05 14.8 4 16.9 4c3.9 0 6.2 3.9 4.9 7.4C19.9 16.2 12 21 12 21z"
		/>
	{:else if name === 'chevron-left'}
		<path d="m14.5 5.5-6.5 6.5 6.5 6.5" />
	{:else if name === 'chevron-right'}
		<path d="m9.5 5.5 6.5 6.5-6.5 6.5" />
	{:else if name === 'chevron-down'}
		<path d="m5.5 9.5 6.5 6.5 6.5-6.5" />
	{:else if name === 'close'}
		<path d="M6 6l12 12M18 6 6 18" />
	{:else if name === 'star'}
		<path
			d="m12 3.2 2.65 5.4 5.95.86-4.3 4.2 1.02 5.92L12 16.78l-5.32 2.8 1.02-5.92-4.3-4.2 5.95-.86z"
		/>
	{:else if name === 'globe'}
		<circle cx="12" cy="12" r="9" />
		<path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
	{:else if name === 'subtitles'}
		<rect x="2.75" y="5" width="18.5" height="14" rx="2.5" />
		<path d="M6.5 12.5h4M13 12.5h4.5M6.5 15.5h7.5" />
	{:else if name === 'play-circle'}
		<circle cx="12" cy="12" r="9" />
		<path d="M10 8.6v6.8l5.6-3.4z" fill="currentColor" />
	{:else if name === 'sparkle'}
		<path
			d="m12 2.5 2 5.6 5.6 2-5.6 2-2 5.6-2-5.6-5.6-2 5.6-2zM19 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"
		/>
	{:else if name === 'sort'}
		<path d="M7 4v16M3.5 7.5 7 4l3.5 3.5M17 20V4M13.5 16.5 17 20l3.5-3.5" />
	{:else if name === 'source'}
		<ellipse cx="12" cy="6" rx="8" ry="3" />
		<path d="M4 6v6c0 1.66 3.58 3 8 3s8-1.34 8-3V6M4 12v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6" />
	{:else if name === 'monitor'}
		<rect x="2.75" y="4" width="18.5" height="12.5" rx="2.25" />
		<path d="M8 20.5h8M12 16.5v4" />
	{:else if name === 'sliders'}
		<path d="M4 6.5h9M17 6.5h3M4 12h3M11 12h9M4 17.5h11M19 17.5h1" />
		<circle cx="15" cy="6.5" r="2" />
		<circle cx="9" cy="12" r="2" />
		<circle cx="17" cy="17.5" r="2" />
	{:else if name === 'user'}
		<circle cx="12" cy="8" r="4" />
		<path d="M4 20.5c0-3.9 3.6-6.75 8-6.75s8 2.85 8 6.75" />
	{:else if name === 'refresh'}
		<path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5" />
	{:else if name === 'clock'}
		<circle cx="12" cy="12" r="9" />
		<path d="M12 7v5l3.25 2" />
	{:else if name === 'alert'}
		<path d="M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
		<path d="M12 9.5v4M12 17h.01" />
	{:else if name === 'pause'}
		<rect x="6" y="4.5" width="4" height="15" rx="1.2" />
		<rect x="14" y="4.5" width="4" height="15" rx="1.2" />
	{:else if name === 'grid'}
		<rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
		<rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
		<rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
		<rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
	{:else if name === 'list'}
		<path d="M9 6.5h11M9 12h11M9 17.5h11" />
		<path d="M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01" stroke-width="2.6" />
	{:else if name === 'star-outline'}
		<path
			d="m12 3.2 2.65 5.4 5.95.86-4.3 4.2 1.02 5.92L12 16.78l-5.32 2.8 1.02-5.92-4.3-4.2 5.95-.86z"
		/>
	{:else if name === 'lock'}
		<rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
		<path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
	{:else if name === 'edit'}
		<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z" />
		<path d="m13.5 6.5 4 4" />
	{:else if name === 'trash'}
		<path d="M4 7h16M9.5 7V4.5h5V7M6 7l1 13h10l1-13" />
		<path d="M10 11v5.5M14 11v5.5" />
	{:else if name === 'grip'}
		<g fill="currentColor" stroke="none">
			<circle cx="9" cy="6" r="1.1" />
			<circle cx="15" cy="6" r="1.1" />
			<circle cx="9" cy="12" r="1.1" />
			<circle cx="15" cy="12" r="1.1" />
			<circle cx="9" cy="18" r="1.1" />
			<circle cx="15" cy="18" r="1.1" />
		</g>
	{:else if name === 'arrow-up'}
		<path d="M12 19V5M6 11l6-6 6 6" />
	{:else if name === 'arrow-down'}
		<path d="M12 5v14M6 13l6 6 6-6" />
	{:else if name === 'eye'}
		<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
		<circle cx="12" cy="12" r="3" />
	{:else if name === 'eye-off'}
		<path
			d="M10.6 5.6A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.6 3.4M6.4 6.9C3.9 8.6 2.5 12 2.5 12S6 18.5 12 18.5a9.2 9.2 0 0 0 4.7-1.3"
		/>
		<path d="M9.9 9.9a3 3 0 0 0 4.2 4.2M3 3l18 18" />
	{:else if name === 'external'}
		<path
			d="M14 4h6v6M20 4l-9 9M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"
		/>
	{:else if name === 'smile'}
		<circle cx="12" cy="12" r="8.5" />
		<path d="M8.5 14.5s1.2 2 3.5 2 3.5-2 3.5-2" />
		<path d="M9 9.5h.01M15 9.5h.01" stroke-width="2.4" />
	{:else if name === 'palette'}
		<path
			d="M12 3.5a8.5 8.5 0 0 0 0 17c1.2 0 1.8-.8 1.8-1.7 0-1.3-1-1.6-1-2.8 0-1 .8-1.7 1.8-1.7h2.2a3.7 3.7 0 0 0 3.7-3.7C20.5 6.8 16.7 3.5 12 3.5z"
		/>
		<path d="M7.5 11.5h.01M9.5 7.5h.01M14.5 7.5h.01" stroke-width="2.6" />
	{:else if name === 'key'}
		<circle cx="8" cy="15" r="4" />
		<path d="m11 12 8.5-8.5M16 7l2.5 2.5M14 9l2 2" />
	{:else if name === 'cloud'}
		<path d="M7 18.5a4.5 4.5 0 0 1-.6-9 6 6 0 0 1 11.5 1.6A3.8 3.8 0 0 1 17.5 18.5z" />
	{/if}
</svg>

<style>
	.icon {
		flex: none;
		display: inline-block;
		vertical-align: middle;
	}
</style>
