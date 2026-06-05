<script lang="ts">
	import { fly } from 'svelte/transition';
	import { goto } from '$app/navigation';
	import { ListStart, ListEnd, Download, Heart, ListPlus, Disc, User, Share2, Info, X, Plus } from '@lucide/svelte';
	import { player } from '$lib/stores/player.svelte';
	import { library } from '$lib/stores/library.svelte';
	import { names } from '$lib/stores/names.svelte';
	import { ensureTrackDetails } from '$lib/services/catalog';
	import { shareUrl } from '$lib/services/share';
	import type { Track } from '$lib/sources/types';

	let { track, open, onclose }: { track: Track | null; open: boolean; onclose: () => void } = $props();

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
	function playNext() { if (track) { player.playNext(track); toast('Playing next'); } close(); }
	function addQueue() { if (track) { player.addToQueue(track); toast('Added to queue'); } close(); }
	function like() { if (track) library.toggleLike(track); }
	function gotoArtist() { if (track) { onclose(); player.collapse(); goto(`/artist/${encodeURIComponent(track.artist)}`); } }
	function gotoAlbum() { if (track?.album) { onclose(); player.collapse(); goto(`/album/${encodeURIComponent(track.album)}`); } }

	async function doDownload() {
		if (!track) return;
		onclose();
		toast('Preparing download…');
		const r = await ensureTrackDetails(track).catch(() => track);
		library.addDownload(r);
		if (!r.audioUrl) return toast('No audio available');
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
			toast('Downloaded · added to Library');
		} catch {
			window.open(r.audioUrl, '_blank');
			toast('Opened audio · added to Library');
		}
	}
	async function doShare() {
		if (!track) return;
		onclose();
		const url = shareUrl(track);
		try {
			const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
			if (nav.share) await nav.share({ title: `${track.title} — ${track.artist}`, url });
			else { await navigator.clipboard.writeText(url); toast('Share link copied'); }
		} catch { /* cancelled */ }
	}
	async function doDetail() {
		if (!track) return;
		onclose();
		detailTrack = await ensureTrackDetails(track).catch(() => track);
	}
	function addToPlaylist(id: string) { if (track) library.addToPlaylist(id, track); pickerOpen = false; toast('Added to playlist'); }
	function newPlaylist() {
		const name = prompt('New playlist name');
		if (name && track) { const pl = library.createPlaylist(name); library.addToPlaylist(pl.id, track); toast('Playlist created'); }
		pickerOpen = false;
	}
</script>

{#if open && track}
	<button class="scrim" aria-label="Close menu" onclick={close}></button>
	<div class="menu" transition:fly={{ y: 240, duration: 200 }}>
		<div class="menu-head">{names.dn(track.title)} · {names.dn(track.artist)}</div>
		<button class="mi" onclick={playNext}><ListStart size={18} /> Play next</button>
		<button class="mi" onclick={addQueue}><ListEnd size={18} /> Add to queue</button>
		<button class="mi" onclick={doDownload}><Download size={18} /> Download</button>
		<button class="mi" onclick={like}><Heart size={18} fill={liked ? 'currentColor' : 'none'} /> {liked ? 'Liked' : 'Like'}</button>
		<button class="mi" onclick={() => { pickerOpen = true; }}><ListPlus size={18} /> Add to playlist</button>
		<button class="mi" onclick={gotoAlbum} disabled={!track.album}><Disc size={18} /> Go to album</button>
		<button class="mi" onclick={gotoArtist}><User size={18} /> Go to artist</button>
		<button class="mi" onclick={doShare}><Share2 size={18} /> Share</button>
		<button class="mi" onclick={doDetail}><Info size={18} /> Detail</button>
	</div>
{/if}

{#if pickerOpen && track}
	<button class="scrim" aria-label="Close" onclick={() => (pickerOpen = false)}></button>
	<div class="menu" transition:fly={{ y: 240, duration: 200 }}>
		<div class="menu-head">Add to playlist</div>
		{#each library.playlists as pl (pl.id)}
			<button class="mi" onclick={() => addToPlaylist(pl.id)}><ListPlus size={18} /> {pl.name} <span class="count">{pl.tracks.length}</span></button>
		{/each}
		<button class="mi accent" onclick={newPlaylist}><Plus size={18} /> New playlist…</button>
	</div>
{/if}

{#if detailTrack}
	<button class="scrim" aria-label="Close" onclick={() => (detailTrack = null)}></button>
	<div class="modal" transition:fly={{ y: 240, duration: 200 }}>
		<div class="menu-head row"><span>Track detail</span><button class="x" aria-label="Close" onclick={() => (detailTrack = null)}><X size={18} /></button></div>
		<dl class="detail">
			<dt>Title</dt><dd>{detailTrack.title}</dd>
			<dt>Artist</dt><dd>{detailTrack.artist}</dd>
			<dt>Album</dt><dd>{detailTrack.album || '—'}</dd>
			<dt>Quality</dt><dd>{detailTrack.qualityLabel || detailTrack.quality || 'unknown'}</dd>
			<dt>Source</dt><dd>{detailTrack.source}</dd>
			<dt>UID</dt><dd class="mono">{detailTrack.uid}</dd>
			<dt>Audio URL</dt><dd class="mono break">{detailTrack.audioUrl || '(not resolved)'}</dd>
		</dl>
	</div>
{/if}

{#if toastMsg}<div class="toast" transition:fly={{ y: 20, duration: 180 }}>{toastMsg}</div>{/if}

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
	.detail { display: grid; grid-template-columns: auto 1fr; gap: 6px 14px; padding: 6px 12px 14px; margin: 0; }
	.detail dt { color: var(--color-text-muted); font-size: 12px; }
	.detail dd { margin: 0; font-size: 13px; }
	.mono { font-family: ui-monospace, monospace; font-size: 11px; }
	.break { word-break: break-all; }
	.toast { position: fixed; left: 50%; transform: translateX(-50%); bottom: 28px; z-index: 90; background: #000; color: #fff; padding: 10px 16px; border-radius: 999px; font-size: 13px; box-shadow: var(--shadow-lg); }
</style>
