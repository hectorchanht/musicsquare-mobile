<script lang="ts">
	// Album page. The tracklist is the REAL ordered album.getInfo tracklist (Phase 9,
	// D-05), reached by clicking an album on the artist page (which carries the album
	// artist via the ?artist= query param). Each track is a Last.fm {artist,title} STUB
	// resolved to a playable Track lazily, ON TAP, via resolveStub (D-05/D-03) — the same
	// resolve-on-tap path the home shelves use.
	import { page } from '$app/state';
	import { fly } from 'svelte/transition';
	import { ChevronLeft, Play } from '@lucide/svelte';
	import { player } from '$lib/stores/player.svelte';
	import { names } from '$lib/stores/names.svelte';
	import { t } from '$lib/i18n';
	import { goto } from '$app/navigation';
	import { enrichAlbum, getAlbumTracklist, type EnrichResult } from '$lib/services/lastfm';
	import { resolveStub } from '$lib/services/discovery';

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
			void enrichAlbum(n, artist).then((r) => {
				if (enrichedFor === key) enrich = r; // race guard — discard if key changed
			});
		}
	});

	// Resolve-on-tap (D-05/D-03): a tracklist entry is a {artist,title} STUB, NOT a Track,
	// so it MUST be resolved via searchAll+dedupeBest before play. Strictly lazy — one tap
	// → one resolve (NEVER eager over the whole tracklist; Pitfall 11). A miss shows an
	// unplayable toast and never breaks the page or the player.
	async function playStub(stub: AlbumStub) {
		const tr = await resolveStub(stub.artist, stub.title);
		if (tr) {
			player.setQueue([tr]);
			player.play(tr);
		} else {
			toast(t('album.unplayable'));
		}
	}
</script>

<svelte:head><title>{t('album.title', { name })}</title></svelte:head>

<header class="hero">
	<button class="back" aria-label={t('album.back')} onclick={() => goto(albumArtist ? '/artist/' + encodeURIComponent(albumArtist) : '/')}><ChevronLeft size={22} /></button>
	<div class="cover" style:background-image={heroImg ? `url(${heroImg})` : 'linear-gradient(145deg,#3a2d63,#1a1326)'}></div>
	<h1>{names.dn(name)}</h1>
	{#if albumArtist}<p class="artist">{names.dn(albumArtist)}</p>{/if}
	<p class="note">{t('album.tracklistNote', { count: tracks.length })}</p>

	<!-- Last.fm album info (D-01c). Rendered only when present; degrades silently. -->
	{#if enrich?.listeners != null || enrich?.playcount != null}
		<p class="info">
			{#if enrich?.listeners != null}<span>{t('lastfm.listeners')}: {numFmt.format(enrich.listeners)}</span>{/if}
			{#if enrich?.playcount != null}<span>{t('lastfm.playcount')}: {numFmt.format(enrich.playcount)}</span>{/if}
		</p>
	{/if}
</header>

{#if loading}
	<p class="muted">{t('album.loading')}</p>
{:else if tracks.length}
	<ul class="list">
		{#each tracks as track, i (i)}
			<li>
				<button class="row" onclick={() => playStub(track)}>
					<span class="rank">{i + 1}</span>
					<span class="art" style:background-image={fallbackCover(track.artist + track.title)}></span>
					<span class="meta"><span class="r-title">{names.dn(track.title)}</span><span class="r-sub">{names.dn(track.artist)}</span></span>
					<Play size={16} />
				</button>
			</li>
		{/each}
	</ul>
{:else if !albumArtist}
	<p class="muted">{t('album.openFromArtist')}</p>
{:else}
	<p class="muted">{t('album.noTracks', { name: names.dn(name) })}</p>
{/if}

{#if toastMsg}<div class="toast" transition:fly={{ y: 20, duration: 180 }}>{toastMsg}</div>{/if}

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
	.toast { position: fixed; left: 50%; transform: translateX(-50%); bottom: 28px; z-index: 90; background: #000; color: #fff; padding: 10px 16px; border-radius: 999px; font-size: 13px; box-shadow: var(--shadow-lg); }
</style>
