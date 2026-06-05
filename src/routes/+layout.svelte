<script lang="ts">
	import '../app.css';
	import { page } from '$app/state';
	import { player } from '$lib/stores/player.svelte';

	let { children } = $props();
	let audioEl: HTMLAudioElement;

	const SITE = 'https://openmusic.pages.dev';
	const TITLE = 'openmusic — stream music from every source';
	const DESC =
		'Search and stream music aggregated from NetEase, QQ, Kuwo and JOOX. Synced lyrics, translation, playlists, library — a fast mobile-first web player.';
	const canonical = $derived(`${SITE}${page.url.pathname}`);

	// The single app-wide <audio> lives at the ROOT layout so it is mounted ONCE
	// and never torn down by client-side navigation between routes/route-groups —
	// playback persists across page changes (incl. into /spike). The visible
	// now-playing bar + overlay live in (app)/+layout and read the same singleton.
	$effect(() => {
		if (audioEl) player.attach(audioEl);
	});
</script>

<svelte:head>
	<title>{TITLE}</title>
	<meta name="description" content={DESC} />
	<link rel="canonical" href={canonical} />
	<!-- Open Graph -->
	<meta property="og:type" content="website" />
	<meta property="og:site_name" content="openmusic" />
	<meta property="og:title" content={TITLE} />
	<meta property="og:description" content={DESC} />
	<meta property="og:url" content={canonical} />
	<meta property="og:image" content="{SITE}/og.svg" />
	<meta property="og:image:width" content="1200" />
	<meta property="og:image:height" content="630" />
	<!-- Twitter -->
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content={TITLE} />
	<meta name="twitter:description" content={DESC} />
	<meta name="twitter:image" content="{SITE}/og.svg" />
</svelte:head>

{@render children()}

<audio bind:this={audioEl} style="display:none"></audio>
