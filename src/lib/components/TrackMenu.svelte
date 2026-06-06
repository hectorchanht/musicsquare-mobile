<script lang="ts">
	import { untrack } from 'svelte';
	import { fly } from 'svelte/transition';
	import { goto } from '$app/navigation';
	import { ListStart, ListEnd, Download, Heart, ListPlus, Disc, User, Share2, Info, X, Plus } from '@lucide/svelte';
	import { player } from '$lib/stores/player.svelte';
	import { library } from '$lib/stores/library.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { names } from '$lib/stores/names.svelte';
	import { overlays } from '$lib/stores/overlays.svelte';
	import { dragClose } from '$lib/actions/dragClose';
	import { t } from '$lib/i18n';
	import { ensureTrackDetails } from '$lib/services/catalog';
	import { shareUrl } from '$lib/services/share';
	import type { Track } from '$lib/sources/types';

	// `loading` = the menu opened on a discovery STUB and is still resolving the real Track
	// (home long-press). It pops INSTANTLY with a skeleton; the action buttons render once the
	// track resolves — so the menu never waits on the network before appearing.
	let { track, open, loading = false, onclose }: { track: Track | null; open: boolean; loading?: boolean; onclose: () => void } = $props();

	let pickerOpen = $state(false);
	let detailTrack = $state<Track | null>(null);
	let toastMsg = $state('');
	let toastTimer: ReturnType<typeof setTimeout> | null = null;
	function toast(m: string) {
		toastMsg = m;
		if (toastTimer) clearTimeout(toastTimer);
		toastTimer = setTimeout(() => (toastMsg = ''), 2000);
	}
	const liked = $derived(track ? library.isLiked(track.uid) : false);

	function close() {
		pickerOpen = false;
		onclose();
	}
	function playNext() { if (track) { player.playNext(track); toast(t('toast.playingNext')); } close(); }
	function addQueue() { if (track) { player.addToQueue(track); toast(t('toast.addedToQueue')); } close(); }
	function like() {
		if (!track) return;
		library.toggleLike(track);
		toast(library.isLiked(track.uid) ? t('menu.liked') : t('menu.like'));
	}
	// goto* navigate away (TrackMenu unmounts) so a local toast can't render — the page change
	// IS the feedback. like()/detail keep their on-page feedback (toast / heart toggle / sheet).
	function gotoArtist() { if (track) { onclose(); player.collapse(); goto(`/artist/${encodeURIComponent(track.artist)}`); } }
	function gotoAlbum() { if (track?.album) { onclose(); player.collapse(); goto(`/album/${encodeURIComponent(track.album)}`); } }

	async function doDownload() {
		if (!track) return;
		onclose();
		toast(t('toast.preparingDownload'));
		// Re-resolve at the user's DOWNLOAD quality (separate from the streaming default). The
		// source resolvers read settings.defaultQuality at resolve time, so temporarily swap it
		// and force a fresh resolve (clear cached details on a COPY — the queue track is left
		// untouched), then restore. settings is not persisted here, so the swap is transient.
		const prevQuality = settings.defaultQuality;
		let r: Track = track;
		try {
			settings.defaultQuality = settings.downloadQuality;
			r = await ensureTrackDetails({ ...track, detailsLoaded: false, audioUrl: null, lrc: null }).catch(
				() => track
			);
		} finally {
			settings.defaultQuality = prevQuality;
		}
		library.addDownload(r);
		if (!r.audioUrl) return toast(t('toast.noAudio'));
		// Web sandbox: saved file can't be replayed offline — Downloads references + re-streams.
		try {
			const resp = await fetch(r.audioUrl);
			const blob = await resp.blob();
			const ext = (r.audioUrl.split('?')[0].match(/\.(mp3|flac|m4a|aac|ogg|wav)$/i)?.[1] ?? 'mp3').toLowerCase();
			const a = document.createElement('a');
			a.href = URL.createObjectURL(blob);
			a.download = `${track.artist} - ${track.title}.${ext}`.replace(/[/\\?%*:|"<>]/g, '_');
			a.click();
			URL.revokeObjectURL(a.href);
			toast(t('toast.downloaded'));
		} catch {
			window.open(r.audioUrl, '_blank');
			toast(t('toast.openedAudio'));
		}
	}
	async function doShare() {
		if (!track) return;
		onclose();
		const url = shareUrl(track);
		try {
			const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
			if (nav.share) await nav.share({ title: `${track.title} — ${track.artist}`, url });
			else { await navigator.clipboard.writeText(url); toast(t('toast.shareCopied')); }
		} catch { /* cancelled */ }
	}
	async function doDetail() {
		if (!track) return;
		onclose();
		detailTrack = await ensureTrackDetails(track).catch(() => track);
	}
	function addToPlaylist(id: string) { if (track) library.addToPlaylist(id, track); pickerOpen = false; toast(t('toast.addedToPlaylist')); }
	function newPlaylist() {
		const name = prompt(t('menu.newPlaylistPrompt'));
		if (name && track) { const pl = library.createPlaylist(name); library.addToPlaylist(pl.id, track); toast(t('toast.playlistCreated')); }
		pickerOpen = false;
	}

	// ---- back-gesture wiring (SINGLE dismiss path) ----
	// Each sheet registers with the overlays stack while open. The back gesture invokes
	// the registered close handler (which only flips state false); UI close handlers
	// (scrim/X/drag) likewise only flip state false. The $effect CLEANUP is the ONE site
	// that calls overlays.dismiss(id) — so scrim, X, drag and back-gesture all converge on
	// a single dismiss site and history depth stays balanced (open pushed 1 state; either
	// the cleanup's dismiss() pops it, or closeTop() already popped it → dismiss is a no-op).
	$effect(() => {
		// untrack the overlays calls: open/dismiss read the $state overlay stack internally,
		// so without untrack this effect would re-run (cleanup+reopen, churning history) whenever
		// ANOTHER overlay (picker/detail/nowplaying) pushes or pops. Deps stay: open + track.
		if (open && track) {
			untrack(() => overlays.open("trackmenu-menu", () => onclose()));
			return () => untrack(() => overlays.dismiss("trackmenu-menu"));
		}
	});
	$effect(() => {
		if (pickerOpen && track) {
			untrack(() => overlays.open("trackmenu-picker", () => (pickerOpen = false)));
			return () => untrack(() => overlays.dismiss("trackmenu-picker"));
		}
	});
	$effect(() => {
		if (detailTrack) {
			untrack(() => overlays.open("trackmenu-detail", () => (detailTrack = null)));
			return () => untrack(() => overlays.dismiss("trackmenu-detail"));
		}
	});
</script>

{#if open && track}
	<button class="scrim" aria-label={t('menu.closeMenu')} onclick={close}></button>
	<div class="menu" transition:fly={{ y: 240, duration: 200 }} use:dragClose={{ onclose: close }}>
		<div class="menu-head">{names.dnTitle(track.title)} · {names.dnArtist(track.artist)}</div>
		{#if loading}
			<!-- Resolving the real Track (home stub). Skeleton placeholders so the menu is
			     visible INSTANTLY on long-press; the buttons swap in when the track resolves. -->
			{#each Array(7) as _, i (i)}
				<div class="mi-skel" aria-hidden="true"><span class="sk-ico"></span><span class="sk-bar" style:width={`${70 - (i % 3) * 12}%`}></span></div>
			{/each}
		{:else}
			<button class="mi" onclick={playNext}><ListStart size={18} /> {t('menu.playNext')}</button>
			<button class="mi" onclick={addQueue}><ListEnd size={18} /> {t('menu.addToQueue')}</button>
			<button class="mi" onclick={doDownload}><Download size={18} /> {t('menu.download')}</button>
			<button class="mi" onclick={like}><Heart size={18} fill={liked ? 'currentColor' : 'none'} /> {liked ? t('menu.liked') : t('menu.like')}</button>
			<button class="mi" onclick={() => { pickerOpen = true; }}><ListPlus size={18} /> {t('menu.addToPlaylist')}</button>
			<button class="mi" onclick={gotoAlbum} disabled={!track.album}><Disc size={18} /> {t('menu.goToAlbum')}</button>
			<button class="mi" onclick={gotoArtist}><User size={18} /> {t('menu.goToArtist')}</button>
			<button class="mi" onclick={doShare}><Share2 size={18} /> {t('menu.share')}</button>
			<button class="mi" onclick={doDetail}><Info size={18} /> {t('menu.detail')}</button>
		{/if}
	</div>
{/if}

{#if pickerOpen && track}
	<button class="scrim" aria-label={t('menu.close')} onclick={() => (pickerOpen = false)}></button>
	<div class="menu" transition:fly={{ y: 240, duration: 200 }} use:dragClose={{ onclose: () => (pickerOpen = false) }}>
		<div class="menu-head">{t('menu.addToPlaylist')}</div>
		{#each library.playlists as pl (pl.id)}
			<button class="mi" onclick={() => addToPlaylist(pl.id)}><ListPlus size={18} /> {pl.name} <span class="count">{pl.tracks.length}</span></button>
		{/each}
		<button class="mi accent" onclick={newPlaylist}><Plus size={18} /> {t('menu.newPlaylist')}</button>
	</div>
{/if}

{#if detailTrack}
	<button class="scrim" aria-label={t('menu.close')} onclick={() => (detailTrack = null)}></button>
	<div class="modal" transition:fly={{ y: 240, duration: 200 }} use:dragClose={{ onclose: () => (detailTrack = null) }}>
		<div class="menu-head row"><span>{t('menu.trackDetail')}</span><button class="x" aria-label={t('menu.close')} onclick={() => (detailTrack = null)}><X size={18} /></button></div>
		<dl class="detail">
			<dt>{t('menu.detailTitle')}</dt><dd>{detailTrack.title}</dd>
			<dt>{t('menu.detailArtist')}</dt><dd>{detailTrack.artist}</dd>
			<dt>{t('menu.detailAlbum')}</dt><dd>{detailTrack.album || '—'}</dd>
			<dt>{t('menu.detailQuality')}</dt><dd>{detailTrack.qualityLabel || detailTrack.quality || t('menu.detailUnknown')}</dd>
			<dt>{t('menu.detailSource')}</dt><dd>{detailTrack.source}</dd>
			<dt>{t('menu.detailUid')}</dt><dd class="mono">{detailTrack.uid}</dd>
			<dt>{t('menu.detailAudioUrl')}</dt><dd class="mono break">{detailTrack.audioUrl || t('menu.detailNotResolved')}</dd>
		</dl>
	</div>
{/if}

{#if toastMsg}<div class="toast" transition:fly={{ y: -20, duration: 180 }}>{toastMsg}</div>{/if}

<style>
	.scrim { position: fixed; inset: 0; z-index: 80; background: rgba(0,0,0,0.45); border: none; }
	.menu, .modal { position: fixed; left: 12px; right: 12px; bottom: 16px; z-index: 81; background: var(--color-surface-2); border: 1px solid var(--color-border); border-radius: 16px; padding: 8px; max-width: 680px; margin: 0 auto; box-shadow: 0 -10px 40px rgba(0,0,0,0.5); max-height: 80vh; overflow-y: auto; }
	.menu-head { font-size: 13px; color: var(--color-text-muted); padding: 8px 10px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.menu-head.row { display: flex; align-items: center; justify-content: space-between; }
	.x { background: none; border: none; color: var(--color-text); cursor: pointer; display: grid; place-items: center; }
	.mi { width: 100%; display: flex; align-items: center; gap: 12px; background: none; border: none; color: var(--color-text); font-size: 15px; padding: 12px; border-radius: 10px; cursor: pointer; text-align: left; }
	.mi:hover { background: var(--color-surface); }
	.mi:disabled { opacity: 0.4; cursor: default; }
	.mi.accent { color: var(--color-primary); }
	.mi .count { margin-left: auto; font-size: 12px; color: var(--color-text-muted); }
	/* Loading skeleton rows (home stub resolving) — same height as .mi so the menu doesn't jump. */
	.mi-skel { display: flex; align-items: center; gap: 12px; padding: 12px; }
	.sk-ico { width: 18px; height: 18px; border-radius: 4px; flex: none; }
	.sk-bar { height: 12px; border-radius: 6px; }
	.sk-ico, .sk-bar { position: relative; overflow: hidden; background: var(--color-surface); }
	.sk-ico::after, .sk-bar::after { content: ''; position: absolute; inset: 0; background: linear-gradient(90deg, transparent, rgba(255,255,255,0.12), transparent); transform: translateX(-100%); animation: mi-shimmer 1.1s ease-in-out infinite; }
	@keyframes mi-shimmer { 100% { transform: translateX(100%); } }
	@media (prefers-reduced-motion: reduce) { .sk-ico::after, .sk-bar::after { animation: none; } }
	.detail { display: grid; grid-template-columns: auto 1fr; gap: 6px 14px; padding: 6px 12px 14px; margin: 0; }
	.detail dt { color: var(--color-text-muted); font-size: 12px; }
	.detail dd { margin: 0; font-size: 13px; }
	.mono { font-family: ui-monospace, monospace; font-size: 11px; }
	.break { word-break: break-all; }
	.toast { position: fixed; left: 50%; transform: translateX(-50%); top: calc(env(safe-area-inset-top, 0px) + 14px); z-index: 90; background: #000; color: #fff; padding: 10px 16px; border-radius: 999px; font-size: 13px; box-shadow: var(--shadow-lg); }
</style>
