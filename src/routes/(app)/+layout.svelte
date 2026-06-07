<script lang="ts">
	import { onMount, type Component } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { House, Search, Library } from '@lucide/svelte';
	import { player } from '$lib/stores/player.svelte';
	import { library } from '$lib/stores/library.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { LANDING_PATHS } from '$lib/services/home-layout';
	import { overlays } from '$lib/stores/overlays.svelte';
	import { t, type TranslationKey } from '$lib/i18n';
	import NowPlaying from '$lib/components/NowPlaying.svelte';
	import Nowbar from '$lib/components/Nowbar.svelte';

	let { children } = $props();

	onMount(() => {
		library.load();
		settings.load();

		// w87: default landing-tab redirect. onMount is client-only (SSR-safe) and runs ONCE,
		// so a later manual nav back to '/' never re-triggers. Guards (all must hold):
		//  - path is EXACTLY '/' (don't hijack a deep route),
		//  - NO ?play= token present (don't break a shared deep link — the home page's own
		//    onMount still receives + plays it),
		//  - the chosen landing tab is not 'home' (else there's nothing to redirect).
		// The target is taken from the fixed LANDING_PATHS record, never the raw stored string
		// (T-w87-05 — no open-redirect). replaceState so Back doesn't bounce to '/'.
		if (
			location.pathname === '/' &&
			!new URLSearchParams(location.search).get('play') &&
			settings.homeLandingTab !== 'home'
		) {
			goto(LANDING_PATHS[settings.homeLandingTab], { replaceState: true });
		}

		// Single back-gesture popstate listener for the whole app (overlays back-to-close).
		const teardownOverlays = overlays.init();
		return teardownOverlays;
	});

	// Store a translation KEY per tab (not the literal) so the nav re-renders when appLang changes.
	const tabs: { href: string; labelKey: TranslationKey; icon: Component }[] = [
		{ href: '/', labelKey: 'nav.home', icon: House },
		{ href: '/search', labelKey: 'nav.search', icon: Search },
		{ href: '/library', labelKey: 'nav.library', icon: Library }
	];

</script>

<div class="app">
	<main class="content">
		{@render children()}
	</main>

	{#if !player.expanded}
		<Nowbar />
	{/if}

	{#if player.expanded}
		<NowPlaying />
	{/if}

	<nav class="tabbar">
		{#each tabs as tab (tab.href)}
			{@const Icon = tab.icon}
			<a class="tab" class:active={page.url.pathname === tab.href} href={tab.href}>
				<span class="ic"><Icon size={20} /></span>{t(tab.labelKey)}
			</a>
		{/each}
	</nav>
	<!-- audio element lives in the ROOT layout (persists across navigation) -->
</div>

<style>
	.app {
		min-height: 100dvh;
		display: flex;
		flex-direction: column;
		background: radial-gradient(120% 55% at 50% 0%, #1a1326 0%, var(--color-bg) 55%);
		padding-bottom: calc(var(--nowbar-h) + var(--tabbar-h));
	}
	.content {
		flex: 1;
		max-width: 720px;
		width: 100%;
		margin: 0 auto;
		padding: 0 16px;
	}
	.tabbar {
		position: fixed;
		left: 0;
		right: 0;
		bottom: 0;
		height: var(--tabbar-h);
		display: flex;
		justify-content: space-around;
		align-items: center;
		background: var(--color-bg);
		border-top: 1px solid var(--color-border);
		padding-bottom: env(safe-area-inset-bottom);
		z-index: 21;
	}
	.tab {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
		font-size: 10px;
		color: var(--color-text-muted);
		transition: color 0.15s ease;
	}
	.tab .ic { display: grid; place-items: center; }
	.tab.active { color: var(--color-text); }
</style>
