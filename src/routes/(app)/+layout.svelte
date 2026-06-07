<script lang="ts">
	import { onMount, type Component } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { House, Search, Library, Play, Pause, Loader } from '@lucide/svelte';
	import { player } from '$lib/stores/player.svelte';
	import { captureFrom } from '$lib/stores/morph.svelte';
	import { library } from '$lib/stores/library.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { LANDING_PATHS } from '$lib/services/home-layout';
	import { names } from '$lib/stores/names.svelte';
	import { overlays } from '$lib/stores/overlays.svelte';
	import { t, type TranslationKey } from '$lib/i18n';
	import NowPlaying from '$lib/components/NowPlaying.svelte';

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

	function cover(track: { cover: string | null } | null): string {
		return 'linear-gradient(145deg,#3a2d63,#1a1326)';
	}

	// ---- Shared-element expand (gte) -----------------------------------------
	// Click handler: snapshot the now-bar's cover/title/artist rects → expand.
	// NowPlaying.onMount reads the rects, applies inverse FLIP transforms, then a
	// CSS transition morphs the elements into their NP slots.
	let nowbarEl = $state<HTMLDivElement | null>(null);
	let liftDy = $state(0);          // current swipe-up displacement (negative px)
	let liftActive = $state(false);  // a swipe is in progress (drives transform + skip click)
	let liftScale = $state(1);
	let liftId = -1;
	const LIFT_THRESHOLD = 60; // px — commit threshold for swipe-up expand

	function captureNowbarRects(): boolean {
		const root = nowbarEl;
		if (!root) return false;
		const art = root.querySelector<HTMLElement>('.np-art');
		const title = root.querySelector<HTMLElement>('.np-title');
		const artist = root.querySelector<HTMLElement>('.np-artist');
		return captureFrom(art, title, artist);
	}

	function openNowPlaying() {
		// Best-effort capture; if it fails (no DOM/SSR), NowPlaying falls back to today's fly.
		captureNowbarRects();
		player.expand();
	}

	// ---- swipe-up gesture on the nowbar ----
	let liftStartY = 0;
	function liftDown(e: PointerEvent) {
		// Ignore presses on the inner play/pause button (it has its own onclick).
		if ((e.target as HTMLElement).closest('.np-btn')) return;
		liftId = e.pointerId;
		liftStartY = e.clientY;
		liftDy = 0;
		liftActive = false;
		// Pointer capture can throw on synthesized/edge-case pointers — defensive guard so we
		// never abort the gesture state machine before liftDy/liftScale get cleared.
		try { (e.currentTarget as HTMLElement).setPointerCapture?.(liftId); } catch { /* */ }
	}
	function liftMove(e: PointerEvent) {
		if (liftId < 0 || e.pointerId !== liftId) return;
		const dy = e.clientY - liftStartY;
		// Only enter drag mode on UPWARD motion past 6px — keeps the tap path intact.
		if (!liftActive && dy < -6) liftActive = true;
		if (!liftActive) return;
		// Resist downward / past threshold so the gesture feels bounded.
		liftDy = Math.min(0, dy);
		const progress = Math.min(1, -liftDy / LIFT_THRESHOLD);
		liftScale = 1 + progress * 0.06; // up to 1.06× visual hint
	}
	function liftUp(e: PointerEvent) {
		if (liftId < 0 || e.pointerId !== liftId) return;
		try { (e.currentTarget as HTMLElement).releasePointerCapture?.(liftId); } catch { /* */ }
		liftId = -1;
		const past = -liftDy >= LIFT_THRESHOLD;
		// Reset transient state. captureRects must happen BEFORE expand so the rects reflect
		// the nowbar's RESTING geometry (the inverse transform we'd otherwise capture would
		// poison the FLIP delta computation).
		liftDy = 0;
		liftScale = 1;
		if (past) {
			liftActive = false; // suppress the synthetic click that follows pointerup
			openNowPlaying();
		} else {
			// Snap back. Defer flipping liftActive=false so the click still fires only when
			// there was no real drag.
			setTimeout(() => (liftActive = false), 50);
		}
	}
</script>

<div class="app">
	<main class="content">
		{@render children()}
	</main>

	{#if (player.current || player.pendingTrack) && !player.expanded}
		<!-- Optimistic now-bar (FIX-A): when a discovery stub is tapped, player.pendingTrack
		     locks the tapped {artist,title,cover} here INSTANTLY (before resolveStub settles),
		     with an indeterminate loading sliver. Once the real Track resolves, player.current
		     takes over and the bar swaps to the determinate progress fill. -->
		{@const np = player.current ?? player.pendingTrack}
		{@const resolving = !player.current && !!player.pendingTrack}
		<div class="nowbar"
			class:lifting={liftActive}
			role="region"
			aria-label={t('nowbar.openNowPlaying')}
			bind:this={nowbarEl}
			style:transform={liftDy ? `translateY(${liftDy}px) scale(${liftScale})` : undefined}
			onpointerdown={liftDown}
			onpointermove={liftMove}
			onpointerup={liftUp}
			onpointercancel={liftUp}>
			<div class="np-prog" class:indet={player.loading}>
				{#if player.loading}
					<i class="sliver"></i>
				{:else}
					<i style:width={`${player.duration > 0 ? (player.currentTime / player.duration) * 100 : 0}%`}></i>
				{/if}
			</div>
			<button class="np-open" aria-label={t('nowbar.openNowPlaying')} disabled={resolving} onclick={() => { if (liftActive) return; openNowPlaying(); }}>
				<span class="np-art" style:background-image={np?.cover ? `url(${np.cover})` : cover(np)}></span>
				<span class="np-meta">
					<span class="np-title">{names.dnTitle(np?.title ?? '')}</span>
					<span class="np-artist">
						{names.dnArtist(np?.artist ?? '')}
						{#if player.error}· <span class="err">{player.error}</span>{/if}
					</span>
				</span>
			</button>
			{#if resolving}
				<span class="np-btn np-spin" aria-label={t('common.loading')} aria-busy="true"><Loader size={18} /></span>
			{:else}
				<button class="np-btn" aria-label={t('nowbar.playPause')} onclick={() => player.toggle()}>
					{#if player.playing}<Pause size={18} />{:else}<Play size={18} />{/if}
				</button>
			{/if}
		</div>
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
	.nowbar {
		position: fixed;
		left: 8px;
		right: 8px;
		bottom: calc(var(--tabbar-h) + 6px);
		height: var(--nowbar-h);
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px 12px;
		border-radius: 14px;
		background: rgba(40, 32, 60, 0.55);
		backdrop-filter: blur(14px);
		-webkit-backdrop-filter: blur(14px);
		border: 1px solid rgba(255, 255, 255, 0.08);
		max-width: 704px;
		margin: 0 auto;
		z-index: 20;
		overflow: hidden;
		backdrop-filter: blur(2px);
		transition: transform 0.18s cubic-bezier(.22,1,.36,1);
		touch-action: pan-y; /* let vertical pan be ours; keep horizontal swipes for browser */
	}
	.nowbar.lifting { transition: none; }
	.np-prog {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		height: 3px;
		background: rgba(255, 255, 255, 0.12);
	}
	.np-prog > i {
		display: block;
		height: 100%;
		background: var(--color-primary);
		transition: width 0.25s linear;
	}
	/* Indeterminate loading sliver (FIX-A): while resolveStub runs there is no real
	   duration/progress yet, so animate a left↔right sliver instead of a width-bound fill. */
	.np-prog.indet {
		overflow: hidden;
	}
	.np-prog.indet > i.sliver {
		width: 35%;
		transition: none;
		animation: np-indet 1.1s ease-in-out infinite;
	}
	@keyframes np-indet {
		0% { transform: translateX(-110%); }
		100% { transform: translateX(310%); }
	}
	@media (prefers-reduced-motion: reduce) {
		.np-prog.indet > i.sliver { animation-duration: 2.2s; }
	}
	.np-open[disabled] { cursor: default; }
	/* Resolving spinner stand-in for the play/pause button (no audio yet). */
	.np-spin {
		display: grid;
		place-items: center;
		opacity: 0.85;
	}
	.np-spin :global(svg) { animation: np-spin 0.9s linear infinite; }
	@keyframes np-spin {
		to { transform: rotate(360deg); }
	}
	@media (prefers-reduced-motion: reduce) {
		.np-spin :global(svg) { animation: none; }
	}
	.np-open {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 10px;
		background: none;
		border: none;
		padding: 0;
		cursor: pointer;
		text-align: left;
		color: inherit;
	}
	.np-art {
		width: 44px;
		height: 44px;
		border-radius: 8px;
		background-size: cover;
		background-position: center;
		flex: none;
	}
	.np-meta { flex: 1; min-width: 0; display: flex; flex-direction: column; }
	.np-title { display: block; font-size: 13px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.np-artist { display: block; font-size: 11px; color: var(--color-text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.err { color: #ff7a90; }
	.np-btn {
		background: var(--color-primary);
		border: none;
		color: #fff;
		width: 40px;
		height: 40px;
		border-radius: 50%;
		cursor: pointer;
		flex: none;
		display: grid;
		place-items: center;
		transition: transform 0.12s ease;
	}
	.np-btn:active { transform: scale(0.92); }
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
