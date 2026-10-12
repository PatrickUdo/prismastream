<!--
	Channel logo on a tinted tile, or a monogram (initials) on a generative gradient derived from
	the channel id (same look as ChannelCard).
-->
<script lang="ts">
	import type { Channel } from '#lib/types.ts';
	import { hashString } from '#lib/components/art.ts';
	import { initials } from '#lib/components/format.ts';

	interface Props {
		channel: Pick<Channel, 'id' | 'name' | 'logoUrl'>;
		/** Tile width (CSS length); the height follows the aspect ratio. */
		width?: string;
		ratio?: string;
	}

	let { channel, width = '4.5rem', ratio = '16 / 10' }: Props = $props();

	let failed = $state(false);
	const hue = $derived(hashString(channel.id) % 360);
	const showImg = $derived(!!channel.logoUrl && !failed);

	$effect(() => {
		void channel.logoUrl;
		failed = false;
	});
</script>

<span class="logo" class:mono={!showImg} style:--hue={hue} style:width style:aspect-ratio={ratio}>
	{#if showImg}
		<img
			src={channel.logoUrl}
			alt=""
			loading="lazy"
			decoding="async"
			onerror={() => (failed = true)}
		/>
	{:else}
		<span class="initials" aria-hidden="true">{initials(channel.name)}</span>
	{/if}
</span>

<style>
	.logo {
		position: relative;
		display: grid;
		place-items: center;
		flex: none;
		container-type: inline-size;
		border-radius: var(--radius-s);
		overflow: hidden;
		background:
			radial-gradient(120% 90% at 30% 20%, hsl(var(--hue) 55% 30% / 0.35), transparent 70%),
			linear-gradient(160deg, var(--bg-elev-3), var(--bg-elev-2));
		box-shadow: inset 0 0 0 1px var(--line);
	}
	.mono {
		background:
			radial-gradient(120% 100% at 25% 15%, hsl(var(--hue) 60% 42% / 0.75), transparent 70%),
			radial-gradient(
				90% 90% at 90% 100%,
				hsl(calc(var(--hue) + 50) 55% 32% / 0.6),
				transparent 70%
			),
			linear-gradient(160deg, var(--bg-elev-3), var(--bg-elev-1));
	}
	img {
		max-width: 72%;
		max-height: 66%;
		object-fit: contain;
		filter: drop-shadow(0 2px 8px rgb(0 0 0 / 0.5));
	}
	.initials {
		font-size: clamp(0.7rem, 30cqi, 2.6rem);
		font-weight: 800;
		letter-spacing: -0.03em;
		line-height: 1;
		color: hsl(var(--hue) 70% 90%);
		text-shadow: 0 1px 6px rgb(0 0 0 / 0.35);
	}
</style>
