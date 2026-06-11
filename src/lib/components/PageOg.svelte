<script lang="ts">
	// Per-page OG / Twitter card tags (GLN-4 / item 4). Rendered into <svelte:head> by a route that
	// supplies `og` from its universal `+page.ts` load — so the values are baked into the SSR HTML
	// that non-JS share-card crawlers read. The root layout gates its static site-default OG behind
	// `{#if !page.data?.og}`, so exactly one of each og:*/twitter:* property renders per route.
	//
	// T-gln-02: all values are bound via `content={...}` (Svelte escapes attribute bindings), never
	// {@html}. The image is constrained to an https URL by buildOg; a null cover falls back to the
	// static /og.svg so the card always has an image.
	import { page } from '$app/state';

	let {
		og
	}: { og: { title: string; description: string; image: string | null } } = $props();

	const SITE = 'https://openmusic.pages.dev';
	const FALLBACK_IMG = `${SITE}/og.svg`;
	const url = $derived(`${SITE}${page.url.pathname}`);
	const image = $derived(og.image ?? FALLBACK_IMG);
</script>

<svelte:head>
	<meta property="og:type" content="music.song" />
	<meta property="og:title" content={og.title} />
	<meta property="og:description" content={og.description} />
	<meta property="og:url" content={url} />
	<meta property="og:image" content={image} />
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content={og.title} />
	<meta name="twitter:description" content={og.description} />
	<meta name="twitter:image" content={image} />
</svelte:head>
