<script lang="ts" module>
	export type IconName =
		| 'play'
		| 'pause'
		| 'back'
		| 'back10'
		| 'fwd10'
		| 'volume'
		| 'volumeLow'
		| 'mute'
		| 'fullscreen'
		| 'exitFullscreen'
		| 'pip'
		| 'language'
		| 'subtitles'
		| 'quality'
		| 'speed'
		| 'episodes'
		| 'channels'
		| 'close'
		| 'check'
		| 'star'
		| 'starFilled'
		| 'up'
		| 'down'
		| 'next'
		| 'retry'
		| 'alert'
		| 'chevron';
</script>

<script lang="ts">
	let { name, size = 28 }: { name: IconName; size?: number } = $props();
</script>

<svg
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="1.8"
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
	focusable="false"
>
	{#if name === 'play'}
		<path
			d="M7 4.8v14.4a1 1 0 0 0 1.52.85l11.5-7.2a1 1 0 0 0 0-1.7L8.52 3.95A1 1 0 0 0 7 4.8Z"
			fill="currentColor"
			stroke="none"
		/>
	{:else if name === 'pause'}
		<rect x="6" y="4.5" width="4" height="15" rx="1.2" fill="currentColor" stroke="none" />
		<rect x="14" y="4.5" width="4" height="15" rx="1.2" fill="currentColor" stroke="none" />
	{:else if name === 'back'}
		<path d="M15 5l-7 7 7 7" stroke-width="2.2" />
	{:else if name === 'back10'}
		<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" />
		<path d="M4 3.8v3.6h3.6" />
		<text
			x="12"
			y="15.3"
			text-anchor="middle"
			font-size="7.2"
			font-weight="700"
			fill="currentColor"
			stroke="none"
			font-family="inherit">10</text
		>
	{:else if name === 'fwd10'}
		<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" />
		<path d="M20 3.8v3.6h-3.6" />
		<text
			x="12"
			y="15.3"
			text-anchor="middle"
			font-size="7.2"
			font-weight="700"
			fill="currentColor"
			stroke="none"
			font-family="inherit">10</text
		>
	{:else if name === 'volume'}
		<path d="M4 9.5v5h3.5L12 19V5L7.5 9.5H4Z" fill="currentColor" />
		<path d="M15.5 8.5a5 5 0 0 1 0 7" />
		<path d="M18.2 5.8a9 9 0 0 1 0 12.4" />
	{:else if name === 'volumeLow'}
		<path d="M4 9.5v5h3.5L12 19V5L7.5 9.5H4Z" fill="currentColor" />
		<path d="M15.5 8.5a5 5 0 0 1 0 7" />
	{:else if name === 'mute'}
		<path d="M4 9.5v5h3.5L12 19V5L7.5 9.5H4Z" fill="currentColor" />
		<path d="M16 9.5l5 5M21 9.5l-5 5" />
	{:else if name === 'fullscreen'}
		<path
			d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15"
		/>
	{:else if name === 'exitFullscreen'}
		<path
			d="M9 4v3.5A1.5 1.5 0 0 1 7.5 9H4M20 9h-3.5A1.5 1.5 0 0 1 15 7.5V4M15 20v-3.5a1.5 1.5 0 0 1 1.5-1.5H20M4 15h3.5A1.5 1.5 0 0 1 9 16.5V20"
		/>
	{:else if name === 'pip'}
		<rect x="3" y="5" width="18" height="14" rx="2" />
		<rect x="12" y="11.5" width="7" height="5.5" rx="1" fill="currentColor" stroke="none" />
	{:else if name === 'language'}
		<circle cx="12" cy="12" r="8.5" />
		<path
			d="M3.5 12h17M12 3.5c2.4 2.4 3.6 5.2 3.6 8.5s-1.2 6.1-3.6 8.5c-2.4-2.4-3.6-5.2-3.6-8.5S9.6 5.9 12 3.5Z"
		/>
	{:else if name === 'subtitles'}
		<rect x="3" y="5" width="18" height="14" rx="2.5" />
		<path d="M7 12.5h3M13 12.5h4M7 15.5h6M15.5 15.5H17" />
	{:else if name === 'quality'}
		<path d="M4 7h10M18 7h2M4 17h2M10 17h10M4 12h4M12 12h8" />
		<circle cx="16" cy="7" r="2" />
		<circle cx="8" cy="17" r="2" />
		<circle cx="10" cy="12" r="2" />
	{:else if name === 'speed'}
		<path d="M4.6 17A8.5 8.5 0 1 1 19.4 17" />
		<path d="M12 13l4-4.5" stroke-width="2.2" />
		<circle cx="12" cy="13.2" r="1.2" fill="currentColor" />
	{:else if name === 'episodes'}
		<rect x="3" y="4" width="13" height="10" rx="1.8" />
		<path d="M6.5 17.5h12a2 2 0 0 0 2-2V8" />
		<path d="M8.5 20.5h11" />
	{:else if name === 'channels'}
		<rect x="3" y="6.5" width="18" height="13" rx="2" />
		<path d="M8 2.5l4 4 4-4" />
	{:else if name === 'close'}
		<path d="M6 6l12 12M18 6L6 18" stroke-width="2" />
	{:else if name === 'check'}
		<path d="M5 12.5l4.5 4.5L19 7.5" stroke-width="2.2" />
	{:else if name === 'star' || name === 'starFilled'}
		<path
			d="M12 3.6l2.6 5.3 5.8.85-4.2 4.1 1 5.8L12 16.9l-5.2 2.75 1-5.8-4.2-4.1 5.8-.85L12 3.6Z"
			fill={name === 'starFilled' ? 'currentColor' : 'none'}
		/>
	{:else if name === 'up'}
		<path d="M6 15l6-6 6 6" stroke-width="2" />
	{:else if name === 'down'}
		<path d="M6 9l6 6 6-6" stroke-width="2" />
	{:else if name === 'chevron'}
		<path d="M9 6l6 6-6 6" stroke-width="2" />
	{:else if name === 'next'}
		<path
			d="M5 5.5v13a.8.8 0 0 0 1.2.7l10-6.5a.8.8 0 0 0 0-1.4l-10-6.5A.8.8 0 0 0 5 5.5Z"
			fill="currentColor"
			stroke="none"
		/>
		<rect x="17.5" y="5" width="2.4" height="14" rx="1" fill="currentColor" stroke="none" />
	{:else if name === 'retry'}
		<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" />
		<path d="M20 3.8v3.6h-3.6" />
	{:else if name === 'alert'}
		<circle cx="12" cy="12" r="9" />
		<path d="M12 7.5v5.5" stroke-width="2.2" />
		<circle cx="12" cy="16.5" r="1.1" fill="currentColor" stroke="none" />
	{/if}
</svg>
