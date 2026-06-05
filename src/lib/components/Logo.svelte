<script lang="ts">
	// openmusic mark — violet tile, "open" groove ring + play. Matches /favicon.svg.
	let { size = 26 }: { size?: number } = $props();
	const id = `om-${Math.random().toString(36).slice(2, 8)}`;
</script>

<svg width={size} height={size} viewBox="0 0 32 32" role="img" aria-label="openmusic" class="logo">
	<defs>
		<linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
			<stop offset="0" stop-color="#7c5cff" />
			<stop offset="1" stop-color="#a585ff" />
		</linearGradient>
	</defs>
	<rect width="32" height="32" rx="8" fill="url(#{id})" />
	<circle cx="16" cy="16" r="8.6" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="41 13" transform="rotate(-52 16 16)" />
	<path d="M13.4 12 L21 16 L13.4 20 Z" fill="#fff" />
</svg>

<style>
	.logo { display: block; flex: none; }
</style>
