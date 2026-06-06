<script lang="ts">
	// Album page. The tracklist is the REAL ordered album.getInfo tracklist (Phase 9,
	// D-05), reached by clicking an album on the artist page (which carries the album
	// artist via the ?artist= query param). Each track is a Last.fm {artist,title} STUB
	// resolved to a playable Track lazily, ON TAP, via resolveStub (D-05/D-03) — the same
	// resolve-on-tap path the home shelves use.
	import { page } from '$app/state';
	import { untrack } from 'svelte';
	import { fly } from 'svelte/transition';
	import { ChevronLeft, Play, Download, ListPlus, Heart, Share2, Plus, X } from '@lucide/svelte';
	import { player } from '$lib/stores/player.svelte';
	import { library } from '$lib/stores/library.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { names } from '$lib/stores/names.svelte';
	import { overlays } from '$lib/stores/overlays.svelte';
	import { dragClose } from '$lib/actions/dragClose';
	import { t } from '$lib/i18n';
	import { goto } from '$app/navigation';
	import { resolveStub } from '$lib/services/discovery';
	import { ensureTrackDetails } from '$lib/services/catalog';
	import { enrichAlbum, getAlbumTracklist, type EnrichResult } from '$lib/services/lastfm';
	import type { Track } from '$lib/sources/types';

	// A Last.fm tracklist entry — NOT a Track (no uid/source/audioUrl). Resolved on tap.
	type AlbumStub = { artist: string; title: string };

	const name = $derived(decodeURIComponent(page.params.name ?? ''));
	// The album artist is carried in the URL by the artist-page link (?artist=…). It is
	// NOT derived from tracks[0] (the stubs have no resolved artist until tap, and the
	// album.getInfo query NEEDS the artist up front). Absent param (deep link) → '' → the
	// page still renders the hero + a graceful empty state instead of crashing.
	const albumArtist = $derived(page.url.searchParams.get('artist') ?? '');

	let tracks = $state<AlbumStub[]>([]);
	let loading = $state(true);
	let loadedFor = '';

	// ---- Last.fm enrichment (Phase 8, ENRICH-01/02 · D-01c/D-03/D-04) ----
	// Best-effort, AUGMENTS the page — never blocks/replaces the tracklist load. A SEPARATE
	// $effect keyed on `name` + `albumArtist` with its own guard void-fires enrichAlbum
	// (never awaited, never throws) and assigns the result only if the key still matches
	// (race guard). An album with no Last.fm match / absent key resolves to the all-empty
	// shape, so nothing extra renders (the listeners/playcount hero is gated on presence).
	let enrich = $state<EnrichResult | null>(null);
	let enrichedFor = '';
	// In-flight flag for the cover/info skeletons (album art + listeners/playcount come ONLY
	// from Last.fm enrich; tracked explicitly so an empty result / deep-link doesn't strand the
	// skeleton — it stays false unless the enrich effect actually fires).
	let enrichLoading = $state(false);

	// Synthetic gradient cover keyed by the stub (no source cover on a Last.fm stub).
	function fallbackCover(seed: string): string {
		const h = (seed.split('').reduce((a, c) => a + c.charCodeAt(0), 0) * 47) % 360;
		return `linear-gradient(145deg, hsl(${h} 55% 32%), hsl(${(h + 40) % 360} 55% 18%))`;
	}
	// Prefer the Last.fm album art when present (the service already placeholder-filtered
	// it). The stub tracklist carries no source cover, so this is the only hero art source.
	const heroImg = $derived(enrich?.lastfmArt ?? null);
	const numFmt = new Intl.NumberFormat();

	// Component-local toast (same lightweight pattern as the home page) for the unplayable
	// case when a stub resolves to no CN-source match.
	let toastMsg = $state('');
	let toastTimer: ReturnType<typeof setTimeout> | null = null;
	function toast(m: string) {
		toastMsg = m;
		if (toastTimer) clearTimeout(toastTimer);
		toastTimer = setTimeout(() => (toastMsg = ''), 2000);
	}

	// ---- Real album.getInfo ordered tracklist (D-05) ----
	// REPLACES the old searchAll-grouped-by-track.album approximation. Race-guarded on
	// `name|albumArtist`; [] on absent key / absent artist / no match → the graceful empty
	// state. The album.getInfo query needs the artist, so skip the fetch when it is absent.
	$effect(() => {
		const n = name;
		const artist = albumArtist;
		const key = `${n}|${artist}`;
		if (n && loadedFor !== key) {
			loadedFor = key;
			tracks = [];
			if (!artist) {
				// Deep link with no ?artist= — cannot query album.getInfo. Render the
				// graceful "open from an artist" empty state, not a spinner.
				loading = false;
				return;
			}
			loading = true;
			getAlbumTracklist(n, artist)
				.then((r) => {
					if (loadedFor === key) tracks = r; // race guard — discard if key changed
				})
				.catch(() => {
					if (loadedFor === key) tracks = [];
				})
				.finally(() => {
					if (loadedFor === key) loading = false;
				});
		}
	});

	// SEPARATE enrichment effect (D-02: augment, never block/replace the tracklist load).
	// Keyed on `name` + `albumArtist` with its own `enrichedFor` guard.
	$effect(() => {
		const n = name;
		const artist = albumArtist;
		const key = `${n} ${artist}`;
		if (n && artist && enrichedFor !== key) {
			enrichedFor = key;
			enrich = null;
			enrichLoading = true;
			void enrichAlbum(n, artist)
				.then((r) => {
					if (enrichedFor === key) enrich = r; // race guard — discard if key changed
				})
				.finally(() => {
					if (enrichedFor === key) enrichLoading = false;
				});
		}
	});

	// Resolve-on-tap (D-05/D-03) — now OPTIMISTIC (FIX-A). Delegate to player.playStub so the
	// now-bar locks the tapped {artist,title} with a loading indicator instantly (album stubs
	// carry no cover), dedupes a same-song double-tap, and supersedes an in-flight resolve.
	// playStub returns null for BOTH a miss AND a supersede; toast only on a genuine miss
	// (pendingTrack cleared) — a supersede leaves pendingTrack on the newer song (no toast).
	async function playStub(stub: AlbumStub) {
		const tr = await player.playStub(stub.artist, stub.title);
		if (tr === null && player.pendingTrack == null) toast(t('album.unplayable'));
	}

	// ---- Album-level actions (between hero + tracklist) ----
	// The tracklist is {artist,title} STUBS; the whole-album actions (download/playlist/like)
	// need playable Tracks, so they batch-resolve every stub via the SAME resolveStub path used
	// on tap, concurrency-capped (album-scoped fan-out is user-initiated, not eager per Pitfall
	// 11). `albumBusy` guards against a second batch while one runs and disables the toolbar.
	let albumBusy = $state(false);
	let pickerOpen = $state(false);

	// Resolve EVERY stub to a Track, order-preserved, max 4 concurrent searchAll fan-outs.
	async function resolveAll(): Promise<Track[]> {
		const out: (Track | null)[] = new Array(tracks.length).fill(null);
		let next = 0;
		const worker = async () => {
			for (let i = next++; i < tracks.length; i = next++) {
				out[i] = await resolveStub(tracks[i].artist, tracks[i].title).catch(() => null);
			}
		};
		await Promise.all(Array.from({ length: Math.min(4, tracks.length || 1) }, worker));
		return out.filter((t): t is Track => t !== null);
	}

	// Play the whole album: play track 1 instantly (optimistic now-bar), then resolve the rest
	// and set the queue in album order so it plays straight through.
	async function playAlbum() {
		if (!tracks.length || albumBusy) return;
		albumBusy = true;
		try {
			// Play track 1 instantly (optimistic now-bar), then resolve the WHOLE album in album
			// order (concurrency-capped) and set it as the queue so it plays straight through.
			const first = await player.playStub(tracks[0].artist, tracks[0].title);
			if (!first) {
				if (player.pendingTrack == null) toast(t('album.unplayable'));
				return;
			}
			const all = await resolveAll();
			player.setQueue(all.length ? all : [first]);
		} finally {
			albumBusy = false;
		}
	}

	// Download the album → resolve all + re-resolve each at the DOWNLOAD quality (transient
	// settings swap, same idiom as the track menu) + add to the library Downloads tab. Unlike a
	// single track we do NOT trigger N browser file-saves (one prompt per track is hostile); the
	// Downloads tab re-streams (the app's download model).
	async function downloadAlbum() {
		if (!tracks.length || albumBusy) return;
		albumBusy = true;
		toast(t('toast.preparingDownload'));
		try {
			const resolved = await resolveAll();
			const prevQuality = settings.defaultQuality;
			settings.defaultQuality = settings.downloadQuality;
			try {
				for (const tr of resolved) {
					const full = await ensureTrackDetails({ ...tr, detailsLoaded: false, audioUrl: null, lrc: null }).catch(
						() => tr
					);
					library.addDownload(full);
				}
			} finally {
				settings.defaultQuality = prevQuality;
			}
			toast(resolved.length ? t('toast.downloaded') : t('album.unplayable'));
		} finally {
			albumBusy = false;
		}
	}

	// Like the album → resolve all + add every not-yet-liked track to Liked songs.
	async function likeAlbum() {
		if (!tracks.length || albumBusy) return;
		albumBusy = true;
		try {
			const resolved = await resolveAll();
			for (const tr of resolved) if (!library.isLiked(tr.uid)) library.toggleLike(tr);
			toast(resolved.length ? t('menu.liked') : t('album.unplayable'));
		} finally {
			albumBusy = false;
		}
	}

	// Share the album = the current album page URL (carries ?artist= so the link reopens the
	// tracklist). Native share sheet when available, else copy to clipboard.
	async function shareAlbum() {
		const url = location.href;
		try {
			const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
			if (nav.share) await nav.share({ title: `${name} — ${albumArtist}`, url });
			else {
				await navigator.clipboard.writeText(url);
				toast(t('toast.shareCopied'));
			}
		} catch {
			/* cancelled */
		}
	}

	// Add the whole album to a playlist (existing or new) → resolve all + add each.
	async function addAlbumToPlaylist(id: string) {
		pickerOpen = false;
		if (albumBusy) return;
		albumBusy = true;
		try {
			const resolved = await resolveAll();
			for (const tr of resolved) library.addToPlaylist(id, tr);
			toast(resolved.length ? t('toast.addedToPlaylist') : t('album.unplayable'));
		} finally {
			albumBusy = false;
		}
	}
	function newPlaylistForAlbum() {
		const nm = prompt(t('menu.newPlaylistPrompt'));
		if (!nm) return;
		const pl = library.createPlaylist(nm);
		toast(t('toast.playlistCreated'));
		void addAlbumToPlaylist(pl.id);
	}

	// Playlist picker is a back-to-close overlay (same single-dismiss idiom as TrackMenu).
	$effect(() => {
		if (pickerOpen) {
			untrack(() => overlays.open('album-picker', () => (pickerOpen = false)));
			return () => untrack(() => overlays.dismiss('album-picker'));
		}
	});
</script>

<svelte:head><title>{t('album.title', { name })}</title></svelte:head>

<header class="hero">
	<button class="back" aria-label={t('album.back')} onclick={() => goto(albumArtist ? '/artist/' + encodeURIComponent(albumArtist) : '/')}><ChevronLeft size={22} /></button>
	{#if heroImg}
		<div class="cover" style:background-image={`url(${heroImg})`}></div>
	{:else if loading || enrichLoading}
		<div class="cover sk" aria-hidden="true"></div>
	{:else}
		<div class="cover" style:background-image="linear-gradient(145deg,#3a2d63,#1a1326)"></div>
	{/if}
	<h1>{names.dnTitle(name)}</h1>
	{#if albumArtist}<p class="artist">{names.dnArtist(albumArtist)}</p>{/if}
	<p class="note">{t('album.tracklistNote', { count: tracks.length })}</p>

	<!-- Last.fm album info (D-01c). Rendered only when present; degrades silently. -->
	{#if enrichLoading}
		<p class="info" aria-hidden="true"><span class="sk sk-info"></span></p>
	{:else if enrich?.listeners != null || enrich?.playcount != null}
		<p class="info">
			{#if enrich?.listeners != null}<span>{t('lastfm.listeners')}: {numFmt.format(enrich.listeners)}</span>{/if}
			{#if enrich?.playcount != null}<span>{t('lastfm.playcount')}: {numFmt.format(enrich.playcount)}</span>{/if}
		</p>
	{/if}
</header>

{#if loading}
	<ul class="list" aria-label={t('album.loading')}>
		{#each Array(10) as _, i (i)}
			<li>
				<span class="row" aria-hidden="true">
					<span class="sk sk-rank"></span>
					<span class="art sk"></span>
					<span class="meta"><span class="sk sk-rtitle"></span><span class="sk sk-rsub"></span></span>
				</span>
			</li>
		{/each}
	</ul>
{:else if tracks.length}
	<!-- Album-level actions (between hero + tracklist). Icon buttons reuse existing i18n keys
	     for aria-labels (no new translation keys). Disabled while a batch resolve runs. -->
	<div class="album-actions">
		<button class="act play" aria-label={t('nowplaying.playPause')} disabled={albumBusy} onclick={playAlbum}><Play size={20} /></button>
		<button class="act" aria-label={t('menu.download')} disabled={albumBusy} onclick={downloadAlbum}><Download size={20} /></button>
		<button class="act" aria-label={t('menu.addToPlaylist')} disabled={albumBusy} onclick={() => (pickerOpen = true)}><ListPlus size={20} /></button>
		<button class="act" aria-label={t('menu.like')} disabled={albumBusy} onclick={likeAlbum}><Heart size={20} /></button>
		<button class="act" aria-label={t('menu.share')} disabled={albumBusy} onclick={shareAlbum}><Share2 size={20} /></button>
	</div>
	<ul class="list">
		{#each tracks as track, i (i)}
			<li>
				<button class="row" onclick={() => playStub(track)}>
					<span class="rank">{i + 1}</span>
					<span class="art" style:background-image={fallbackCover(track.artist + track.title)}></span>
					<span class="meta"><span class="r-title">{names.dnTitle(track.title)}</span><span class="r-sub">{names.dnArtist(track.artist)}</span></span>
					<Play size={16} />
				</button>
			</li>
		{/each}
	</ul>
{:else if !albumArtist}
	<p class="muted">{t('album.openFromArtist')}</p>
{:else}
	<p class="muted">{t('album.noTracks', { name: names.dnTitle(name) })}</p>
{/if}

{#if toastMsg}<div class="toast" transition:fly={{ y: -20, duration: 180 }}>{toastMsg}</div>{/if}

<!-- Add-album-to-playlist picker (back-to-close sheet, mirrors the track menu's picker). -->
{#if pickerOpen}
	<button class="scrim" aria-label={t('menu.close')} onclick={() => (pickerOpen = false)}></button>
	<div class="picker" transition:fly={{ y: 240, duration: 200 }} use:dragClose={{ onclose: () => (pickerOpen = false) }}>
		<div class="picker-head">{t('menu.addToPlaylist')}</div>
		<button class="mi" onclick={newPlaylistForAlbum}><Plus size={18} /> {t('menu.newPlaylist')}</button>
		{#each library.playlists as pl (pl.id)}
			<button class="mi" onclick={() => addAlbumToPlaylist(pl.id)}><ListPlus size={18} /> {pl.name}</button>
		{/each}
		<button class="mi close" onclick={() => (pickerOpen = false)}><X size={18} /> {t('menu.close')}</button>
	</div>
{/if}

<style>
	.hero { padding: 14px 0 18px; text-align: center; position: relative; }
	.back { position: absolute; left: 0; top: 8px; background: none; border: none; color: var(--color-text); cursor: pointer; display: grid; place-items: center; width: 36px; height: 36px; }
	.cover { width: 160px; height: 160px; border-radius: 12px; margin: 8px auto 12px; background-size: cover; background-position: center; box-shadow: 0 12px 34px rgba(0,0,0,0.5); }
	.hero h1 { font-size: 1.5rem; margin: 0; }
	.artist { color: var(--color-text); font-size: 14px; margin: 4px 0 0; opacity: 0.85; }
	.note { color: var(--color-text-muted); font-size: 12px; margin-top: 4px; }
	.info { color: var(--color-text-muted); font-size: 12px; margin-top: 6px; display: flex; gap: 14px; justify-content: center; flex-wrap: wrap; }
	.muted { color: var(--color-text-muted); font-size: 14px; }
	.list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
	.row { width: 100%; text-align: left; background: none; border: none; padding: 6px; border-radius: 8px; cursor: pointer; display: flex; align-items: center; gap: 12px; color: var(--color-text); }
	.row:hover { background: var(--color-surface); }
	.rank { width: 18px; text-align: center; color: var(--color-text-muted); font-size: 13px; flex: none; }
	.art { width: 44px; height: 44px; border-radius: 6px; background-size: cover; background-position: center; flex: none; }
	.meta { display: flex; flex-direction: column; min-width: 0; flex: 1; }
	.r-title { font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.r-sub { font-size: 12px; color: var(--color-text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.toast { position: fixed; left: 50%; transform: translateX(-50%); top: calc(env(safe-area-inset-top, 0px) + 14px); z-index: 90; background: #000; color: #fff; padding: 10px 16px; border-radius: 999px; font-size: 13px; box-shadow: var(--shadow-lg); }

	/* ---- loading skeletons (global .sk in app.css supplies the grey + shimmer; these size the
	   blocks to match the real content) ---- */
	.info .sk-info { display: inline-block; width: 150px; height: 12px; }
	.sk-rank { width: 14px; height: 12px; flex: none; border-radius: 3px; }
	.meta .sk-rtitle { display: block; width: 80%; height: 13px; margin-bottom: 7px; }
	.meta .sk-rsub { display: block; width: 45%; height: 11px; }

	/* ---- album-level action toolbar (between hero + tracklist) ---- */
	.album-actions { display: flex; align-items: center; justify-content: center; gap: 16px; margin: 2px 0 20px; }
	.act { display: grid; place-items: center; width: 44px; height: 44px; border-radius: 50%; background: var(--color-surface-2); border: 1px solid var(--color-border); color: var(--color-text); cursor: pointer; transition: background 0.15s, transform 0.1s; }
	.act:hover { background: var(--color-surface); }
	.act:active { transform: scale(0.92); }
	.act:disabled { opacity: 0.4; cursor: default; }
	.act.play { width: 56px; height: 56px; background: var(--color-primary); border-color: transparent; color: #fff; box-shadow: 0 6px 18px rgba(0, 0, 0, 0.4); }
	/* ---- add-to-playlist picker (mirrors the track menu sheet) ---- */
	.scrim { position: fixed; inset: 0; z-index: 80; background: rgba(0, 0, 0, 0.45); border: none; }
	.picker { position: fixed; left: 12px; right: 12px; bottom: 16px; z-index: 81; background: var(--color-surface-2); border: 1px solid var(--color-border); border-radius: 16px; padding: 8px; max-width: 680px; margin: 0 auto; box-shadow: 0 -10px 40px rgba(0, 0, 0, 0.5); max-height: 70vh; overflow-y: auto; }
	.picker-head { font-size: 13px; color: var(--color-text-muted); padding: 8px 10px; }
	.mi { width: 100%; display: flex; align-items: center; gap: 12px; background: none; border: none; color: var(--color-text); font-size: 15px; padding: 12px; border-radius: 10px; cursor: pointer; text-align: left; }
	.mi:hover { background: var(--color-surface); }
	.mi.close { color: var(--color-text-muted); }
</style>
