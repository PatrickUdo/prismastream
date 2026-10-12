<!-- PrismaStream mark: a glass prism splitting a beam into the spectrum. -->
<script lang="ts">
	interface Props {
		size?: string;
		wordmark?: boolean;
	}

	let { size = '2rem', wordmark = false }: Props = $props();
	const id = $props.id();
</script>

<span class="logo">
	<svg viewBox="0 0 40 40" width={size} height={size} aria-hidden="true" focusable="false">
		<defs>
			<linearGradient id="{id}-spec" x1="0" y1="0" x2="0" y2="1">
				<stop offset="0" stop-color="#ff6b8b" />
				<stop offset=".25" stop-color="#ffd36b" />
				<stop offset=".5" stop-color="#6dffb8" />
				<stop offset=".75" stop-color="#5cc8ff" />
				<stop offset="1" stop-color="#a77bff" />
			</linearGradient>
			<linearGradient id="{id}-glass" x1="0" y1="0" x2="1" y2="1">
				<stop offset="0" stop-color="#fff" stop-opacity=".95" />
				<stop offset="1" stop-color="#fff" stop-opacity=".55" />
			</linearGradient>
		</defs>
		<path
			d="M2 21.5 15 19.6"
			stroke="#fff"
			stroke-width="1.6"
			stroke-linecap="round"
			opacity=".9"
		/>
		<path d="M25 18.5 39 11v18z" fill="url(#{id}-spec)" opacity=".9" />
		<path
			d="M20 6 30.5 27H9.5z"
			fill="none"
			stroke="url(#{id}-glass)"
			stroke-width="2.2"
			stroke-linejoin="round"
		/>
	</svg>
	{#if wordmark}
		<span class="word">Prisma<span>Stream</span></span>
	{/if}
</span>

<style>
	.logo {
		display: inline-flex;
		align-items: center;
		gap: 0.6rem;
	}
	.word {
		font-size: 1.05rem;
		font-weight: 800;
		letter-spacing: -0.02em;
		white-space: nowrap;
	}
	.word span {
		font-weight: 400;
		color: var(--text-2);
	}
</style>
