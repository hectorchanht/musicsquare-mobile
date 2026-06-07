<script lang="ts">
	// Reusable compact "now bar" (mtv-followup). Originally lived inline in (app)/+layout.svelte;
	// extracted here so NowPlaying.svelte can reuse the same shape as the YT-Music-style sticky
	// mini-bar when the queue/lyrics sheet is fully open. Two variants:
	//   - 'docked' (default): position:fixed near the bottom of the viewport, the original
	//     layout-level mini-player. `.np-open` calls player.expand() unless overridden.
	//   - 'embed': position:static, sits in the parent's normal flow. Used inside NowPlaying.svelte
	//     in the fullshrink layout so the cover/title/artist/play row stays visible above the
	//     open subnav sheet.
	import { Play, Pause, Loader } from '@lucide/svelte';
	import { player } from '$lib/stores/player.svelte';
	import { names } from '$lib/stores/names.svelte';
	import { t } from '$lib/i18n';

	type Variant = 'docked' | 'embed';

	let {
		variant = 'docked',
		onOpen
	}: {
		variant?: Variant;
		onOpen?: () => void;
	} = $props();

	const np = $derived(player.current ?? player.pendingTrack);
	const resolving = $derived(!player.current && !!player.pendingTrack);

	function fallbackCover(): string {
		return 'linear-gradient(145deg,#3a2d63,#1a1326)';
	}
	function handleOpen() {
		if (onOpen) onOpen();
		else player.expand();
	}
</script>

{#if np}
	<div class="nowbar" class:embed={variant === 'embed'}>
		<div class="np-prog" class:indet={player.loading}>
			{#if player.loading}
				<i class="sliver"></i>
			{:else}
				<i style:width={`${player.duration > 0 ? (player.currentTime / player.duration) * 100 : 0}%`}></i>
			{/if}
		</div>
		<button class="np-open" aria-label={t('nowbar.openNowPlaying')} disabled={resolving} onclick={handleOpen}>
			<span class="np-art" style:background-image={np?.cover ? `url(${np.cover})` : fallbackCover()}></span>
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

<style>
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
	}
	.nowbar::before {
		content: "";
		position: absolute;
		top: -10px;
		left: -10px;
		right: -10px;
		bottom: -10px;
		
		/* Your background logic (e.g., using inherited or static image) */
		background: rgba(40, 32, 60, 0.55);
		background-repeat: no-repeat;
		background-size: cover;
		filter: blur(14px);
		
		/* Crucial fixes */
		z-index: -1;             /* Keeps it behind the button text/icons */
		pointer-events: none;    /* PASSES CLICK EVENTS THROUGH TO BUTTONS */
	}

	/* Ensure child content stays interactive and on top */
	.nowbar > * {
		position: relative;
		z-index: 2;
	}
	/* Embed variant: same visual shell, no fixed positioning. Parent (.np.fullshrink) owns
	   the placement so this bar can sit at the top of the now-playing view. */
	.nowbar.embed {
		position: static;
		left: auto;
		right: auto;
		bottom: auto;
		margin: 0;
		max-width: none;
		z-index: 4;
	}
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
	.np-prog.indet { overflow: hidden; }
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
	.np-spin { display: grid; place-items: center; opacity: 0.85; }
	.np-spin :global(svg) { animation: np-spin 0.9s linear infinite; }
	@keyframes np-spin { to { transform: rotate(360deg); } }
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
	/* Nowbar surface is always the dark-translucent purple panel (in both themes), so the
	   text colors are pinned to light tones rather than tracking --color-text — otherwise the
	   light theme inverts text to near-black and the nowbar reads as dark-on-dark. */
	.np-title { display: block; font-size: 13px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #fff; }
	.np-artist { display: block; font-size: 11px; color: rgba(255, 255, 255, 0.7); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
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
</style>
