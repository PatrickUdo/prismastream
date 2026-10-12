<!--
	Deterministic generative artwork (poster 2:3 or backdrop 16:9) as inline SVG.
	Same `seed` → same artwork. Palette follows the genres; posters carry the title
	in poster typography. Purely decorative (aria-hidden); the parent supplies a label.
-->
<script lang="ts">
	import {
		buildScene,
		layoutTitle,
		type ArtFormat,
		type GenreFamily,
		type Motif,
		type Paint
	} from './art.ts';

	interface Props {
		seed: string;
		format?: ArtFormat;
		genres?: readonly string[];
		family?: GenreFamily;
		motif?: Motif;
		/** Poster title (rendered only for posters when showTitle). */
		title?: string;
		/** Small line under the title, e.g. "2023 · Sci-fi". */
		tagline?: string;
		showTitle?: boolean;
		/** Large faint label for stills, e.g. the episode number. */
		label?: string;
		/** How the art fills a box with another aspect ratio. */
		fit?: 'slice' | 'meet';
	}

	let {
		seed,
		format = 'poster',
		genres = [],
		family,
		motif,
		title = '',
		tagline = '',
		showTitle = format === 'poster',
		label,
		fit = 'slice'
	}: Props = $props();

	const uid = $props.id();

	const scene = $derived(buildScene(seed, { format, genres, family, motif }));
	const pad = 16;
	const layout = $derived(
		showTitle && title ? layoutTitle(title, scene.w - pad * 2, scene.caps) : undefined
	);
	const textX = $derived(scene.align === 'middle' ? scene.w / 2 : pad);
	const anchor = $derived(scene.align === 'middle' ? 'middle' : 'start');
	const lastBaseline = $derived(scene.h - (tagline ? 28 : 18));
	const titleTop = $derived(
		layout
			? lastBaseline - (layout.lines.length - 1) * layout.size * layout.lineHeight - layout.size
			: 0
	);

	function paint(p: Paint | undefined): string | undefined {
		if (!p) return undefined;
		return p.startsWith('grad:') ? `url(#${uid}-${p.slice(5)})` : p;
	}
</script>

<svg
	class="art"
	viewBox="0 0 {scene.w} {scene.h}"
	preserveAspectRatio="xMidYMid {fit}"
	aria-hidden="true"
	focusable="false"
>
	<defs>
		{#each scene.gradients as g (g.id)}
			{#if g.type === 'linear'}
				<linearGradient id="{uid}-{g.id}" x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2}>
					{#each g.stops as s, i (i)}
						<stop offset={s.offset} stop-color={s.color} stop-opacity={s.opacity ?? 1} />
					{/each}
				</linearGradient>
			{:else}
				<radialGradient id="{uid}-{g.id}" cx={g.cx} cy={g.cy} r={g.r}>
					{#each g.stops as s, i (i)}
						<stop offset={s.offset} stop-color={s.color} stop-opacity={s.opacity ?? 1} />
					{/each}
				</radialGradient>
			{/if}
		{/each}
		{#if layout}
			<linearGradient id="{uid}-scrim" x1="0" y1="0" x2="0" y2="1">
				<stop offset="0" stop-color={scene.palette.bg[0]} stop-opacity="0" />
				<stop offset="1" stop-color={scene.palette.bg[0]} stop-opacity="0.92" />
			</linearGradient>
		{/if}
	</defs>

	{#each scene.shapes as s, i (i)}
		{@const style = s.blend ? `mix-blend-mode:${s.blend}` : undefined}
		{#if s.t === 'rect'}
			<rect
				x={s.x}
				y={s.y}
				width={s.w}
				height={s.h}
				fill={paint(s.fill)}
				opacity={s.opacity}
				{style}
			/>
		{:else if s.t === 'circle'}
			<circle
				cx={s.cx}
				cy={s.cy}
				r={s.r}
				fill={paint(s.fill) ?? 'none'}
				stroke={paint(s.stroke)}
				stroke-width={s.strokeWidth}
				opacity={s.opacity}
				{style}
			/>
		{:else if s.t === 'ellipse'}
			<ellipse
				cx={s.cx}
				cy={s.cy}
				rx={s.rx}
				ry={s.ry}
				fill={paint(s.fill) ?? 'none'}
				stroke={paint(s.stroke)}
				stroke-width={s.strokeWidth}
				opacity={s.opacity}
				transform={s.transform}
				{style}
			/>
		{:else}
			<path
				d={s.d}
				fill={paint(s.fill) ?? 'none'}
				stroke={paint(s.stroke)}
				stroke-width={s.strokeWidth}
				stroke-linecap="round"
				opacity={s.opacity}
				transform={s.transform}
				{style}
			/>
		{/if}
	{/each}

	{#if label}
		<text
			class="label"
			x={scene.w - 12}
			y={scene.h - 10}
			text-anchor="end"
			fill={scene.palette.ink}
			font-size="78">{label}</text
		>
	{/if}

	{#if layout}
		<rect
			x="0"
			y={titleTop - 40}
			width={scene.w}
			height={scene.h - titleTop + 40}
			fill="url(#{uid}-scrim)"
		/>
		{#if scene.align === 'start'}
			<rect x={pad} y={titleTop - 9} width="18" height="1.4" fill={scene.palette.glow} />
		{/if}
		<text
			class="title"
			class:caps={scene.caps}
			x={textX}
			text-anchor={anchor}
			fill={scene.palette.ink}
			font-size={layout.size}
			letter-spacing="{layout.tracking}em"
		>
			{#each layout.lines as line, i (i)}
				<tspan
					x={textX}
					y={lastBaseline - (layout.lines.length - 1 - i) * layout.size * layout.lineHeight}
					>{line}</tspan
				>
			{/each}
		</text>
		{#if tagline}
			<text
				class="tagline"
				x={textX}
				y={scene.h - 13}
				text-anchor={anchor}
				fill={scene.palette.ink}
				font-size="6.6">{tagline}</text
			>
		{/if}
	{/if}
</svg>

<style>
	.art {
		width: 100%;
		height: 100%;
		font-family: var(--font);
		user-select: none;
	}
	.title {
		font-weight: 720;
		font-kerning: normal;
	}
	.title.caps {
		font-weight: 800;
	}
	.tagline {
		font-weight: 650;
		letter-spacing: 0.24em;
		text-transform: uppercase;
		opacity: 0.72;
	}
	.label {
		font-weight: 800;
		letter-spacing: -0.04em;
		opacity: 0.13;
	}
</style>
