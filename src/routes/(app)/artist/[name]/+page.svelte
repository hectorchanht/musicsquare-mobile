<script lang="ts">
	// Artist page. DATA CONSTRAINT: the source adapters expose only search + detail
	// (no real artist/album API). So this is DERIVED: searchAll(artistName) →
	// "Hit songs" = the result list; "Albums" = results grouped by track.album.
	// Not a true artist catalog — an approximation from cross-source search.
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { fly } from 'svelte/transition';
	import { ChevronLeft, Heart, Play, Share2 } from '@lucide/svelte';
	import { searchAll } from '$lib/services/catalog';
	import { dedupeBest } from '$lib/services/dedupe';
	import { settings } from '$lib/stores/settings.svelte';
	import { player } from '$lib/stores/player.svelte';
	import { library } from '$lib/stores/library.svelte';
	import { names } from '$lib/stores/names.svelte';
	import { t } from '$lib/i18n';
	import { longpress } from '$lib/actions/longpress';
	import { dragScroll } from '$lib/actions/dragScroll';
	import { marquee } from '$lib/actions/marquee';
	import TrackMenu from '$lib/components/TrackMenu.svelte';
	import TagChips from '$lib/components/TagChips.svelte';
	import { enrichArtist, getArtistTopAlbums, type EnrichResult, type DiscoveryAlbum } from '$lib/services/lastfm';
	import { getSimilarArtists } from '$lib/services/similar';
	import { deezerArtistCover } from '$lib/services/deezer';
	import { mapWithConcurrency } from '$lib/services/discovery';
	import type { Track } from '$lib/sources/types';

	let menuTrack = $state<Track | null>(null);
	let menuOpen = $state(false);

	const name = $derived(decodeURIComponent(page.params.name ?? ''));

	let songs = $state<Track[]>([]);
	let loading = $state(true);
	let loadedFor = '';

	// ---- Last.fm enrichment (Phase 8, ENRICH-01/02 · D-07/D-08) ----
	// Best-effort, AUGMENTS the derived track-list — it never blocks or replaces the
	// searchAll load below (D-02). A SEPARATE $effect keyed on `name` with its own
	// guard void-fires enrichArtist (never awaited, never throws) and assigns the
	// result only if `name` still matches (race guard). A CN artist with no Last.fm
	// match / absent key resolves to the all-empty shape, so nothing extra renders.
	let enrich = $state<EnrichResult | null>(null);
	let enrichedFor = '';
	// In-flight flag for the About/bio skeleton (enrich settling to its all-empty shape is
	// indistinguishable from a no-bio result via `enrich` alone, and a failed fetch must not
	// leave the skeleton up forever — so track the settle explicitly).
	let enrichLoading = $state(true);

	// ---- Real Last.fm top-albums (Phase 9, D-04) ----
	// REPLACES the old searchAll-grouped-by-`track.album` approximation. A SEPARATE
	// race-guarded $effect (clone of the enrichedFor pattern, own `albumsFor` guard)
	// void-fires getArtistTopAlbums(name) and assigns the result only if `name` still
	// matches. [] on absent key / CN artist not on Last.fm → the section simply hides.
	let albums = $state<DiscoveryAlbum[]>([]);
	let albumsFor = '';
	// In-flight flag for the Albums skeleton (an empty result and "still loading" are both
	// `albums.length === 0`, so the settle is tracked explicitly).
	let albumsLoading = $state(true);

	// "More like this" shelf (quick-260607-jip). getSimilarArtists() chains Last.fm → Deezer
	// (jau-added fallback) → same-artist. Each related artist gets its avatar via Deezer's
	// artist-picture endpoint (4 in-flight cap; never throws). Race-guarded on `name`.
	type RelatedArtist = { name: string; image: string | null };
	let related = $state<RelatedArtist[]>([]);
	let relatedFor = '';
	let relatedLoading = $state(true);

	function fallbackCover(t: Track): string {
		const h = (t.uid.split('').reduce((a, c) => a + c.charCodeAt(0), 0) * 47) % 360;
		return `linear-gradient(145deg, hsl(${h} 55% 32%), hsl(${(h + 40) % 360} 55% 18%))`;
	}
	// String-seed variant for the Last.fm album row (DiscoveryAlbum has no uid/cover).
	function fallbackCoverSeed(seed: string): string {
		const h = (seed.split('').reduce((a, c) => a + c.charCodeAt(0), 0) * 47) % 360;
		return `linear-gradient(145deg, hsl(${h} 55% 32%), hsl(${(h + 40) % 360} 55% 18%))`;
	}

	// kmn: action-bar state. Heart fills when artist is in library.favArtists; play picks a
	// random hit + queues all songs from this artist; share uses Web Share API.
	const favArtist = $derived(library.isFavArtist(name));

	// Local toast (same lightweight pattern as TrackMenu / home).
	let toastMsg = $state('');
	let toastTimer: ReturnType<typeof setTimeout> | null = null;
	function toast(m: string) {
		toastMsg = m;
		if (toastTimer) clearTimeout(toastTimer);
		toastTimer = setTimeout(() => (toastMsg = ''), 2000);
	}

	function toggleFavourite() {
		const was = favArtist;
		library.toggleFavArtist(name);
		toast(was ? t('toast.artistUnfavorited') : t('toast.artistFavorited'));
	}

	function playArtistRandom() {
		if (!songs.length) return;
		const pickIdx = Math.floor(Math.random() * songs.length);
		const picked = songs[pickIdx];
		// Queue order = picked first, then the rest shuffled — same intent as the
		// shuffle button on a playlist. player.play() handles ensureAhead growth.
		const rest = songs.filter((_, i) => i !== pickIdx);
		for (let i = rest.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[rest[i], rest[j]] = [rest[j], rest[i]];
		}
		player.setQueue([picked, ...rest]);
		void player.play(picked, { fresh: true });
	}

	async function shareArtist() {
		const url = typeof location !== 'undefined' ? `${location.origin}/artist/${encodeURIComponent(name)}` : `/artist/${encodeURIComponent(name)}`;
		const title = name;
		try {
			const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
			if (nav.share) await nav.share({ title, text: title, url });
			else { await navigator.clipboard.writeText(url); toast(t('toast.shareCopied')); }
		} catch {
			/* user dismissed / clipboard blocked — no toast on cancel */
		}
	}

	const hero = $derived(songs.find((t) => t.cover)?.cover ?? null);
	// Prefer the Last.fm artist image for the hero ONLY when present (the service
	// already placeholder-filtered it); otherwise keep the derived cover so a real
	// hero NEVER regresses to a placeholder (ENRICH-02 overrides D-03).
	const heroImg = $derived(enrich?.lastfmArt ?? hero);

	$effect(() => {
		const n = name;
		if (n && loadedFor !== n) {
			loadedFor = n;
			loading = true;
			songs = [];
			searchAll(n, 1)
				.then((r) => (songs = dedupeBest(r.interleaved, settings.preferredSource)))
				.catch(() => (songs = []))
				.finally(() => (loading = false));
		}
	});

	// SEPARATE enrichment effect (D-02: augment, never block/replace the searchAll
	// load above). Keyed on `name` with its own `enrichedFor` guard.
	$effect(() => {
		const n = name;
		if (n && enrichedFor !== n) {
			enrichedFor = n;
			enrich = null;
			enrichLoading = true;
			void enrichArtist(n)
				.then((r) => {
					if (enrichedFor === n) enrich = r; // race guard — discard if name changed
				})
				.finally(() => {
					if (enrichedFor === n) enrichLoading = false;
				});
		}
	});

	// SEPARATE top-albums effect (D-04). Mirrors the enrichedFor race guard with its
	// own `albumsFor` key. Never blocks the Hit-songs / bio load; [] → section hides.
	$effect(() => {
		const n = name;
		if (n && albumsFor !== n) {
			albumsFor = n;
			albums = [];
			albumsLoading = true;
			void getArtistTopAlbums(n)
				.then((r) => {
					if (albumsFor === n) albums = r; // race guard — discard if name changed
				})
				.finally(() => {
					if (albumsFor === n) albumsLoading = false;
				});
		}
	});

	// SEPARATE more-like-this effect (jip, ju0 avatar fix). getSimilarArtists chains LF →
	// Deezer → []. Avatar source CHANGED ju0: Last.fm enrichArtist primary (matches the hero
	// — the user reported Deezer often returns wrong avatars due to partial-name matches);
	// Deezer falls back ONLY when LF is empty. Capped at 4 in-flight, race-guarded.
	$effect(() => {
		const n = name;
		if (n && relatedFor !== n) {
			relatedFor = n;
			related = [];
			relatedLoading = true;
			void (async () => {
				try {
					const names = await getSimilarArtists(n);
					if (relatedFor !== n) return; // race guard
					if (!names.length) return;
					const withCovers = await mapWithConcurrency(names, 4, async (nm: string) => {
						// Last.fm primary (same source as hero) — exact-name-keyed, fewer wrong matches.
						const lf = await enrichArtist(nm).catch(() => null);
						const lfImg = lf?.lastfmArt ?? null;
						if (lfImg) return { name: nm, image: lfImg };
						// Fall back to Deezer only when LF has no picture for this artist.
						const dz = await deezerArtistCover(nm).catch(() => null);
						return { name: nm, image: dz };
					});
					if (relatedFor === n) related = withCovers;
				} finally {
					if (relatedFor === n) relatedLoading = false;
				}
			})();
		}
	});
</script>

<svelte:head><title>{name} · openmusic</title></svelte:head>

<header class="hero">
	<button type="button" class="back" aria-label={t('common.back')} onclick={() => history.back()}><ChevronLeft size={22} /></button>
	{#if heroImg}
		<div class="herocover" style:background-image={`url(${heroImg})`}></div>
	{:else if loading || enrichLoading}
		<div class="herocover sk" aria-hidden="true"></div>
	{:else}
		<div class="herocover" style:background-image="linear-gradient(145deg,#3a2d63,#1a1326)"></div>
	{/if}
	<h1>{names.dnArtist(name)}</h1>
	<p class="note">{t('artist.derived', { count: songs.length })}</p>

	<!-- kmn: action bar — Favourite / Play (random hit) / Share. Matches the album-page
	     action-bar visual language (pill buttons, lucide icons). -->
	<div class="actions">
		<button class="act" class:on={favArtist} aria-label={favArtist ? t('artist.unfavorite') : t('artist.favorite')} onclick={toggleFavourite}>
			<Heart size={18} fill={favArtist ? 'currentColor' : 'none'} />
			<span>{favArtist ? t('artist.unfavorite') : t('artist.favorite')}</span>
		</button>
		<button class="act primary" aria-label={t('artist.playArtist')} disabled={loading || !songs.length} onclick={playArtistRandom}>
			<Play size={18} fill="currentColor" />
			<span>{t('artist.playArtist')}</span>
		</button>
		<button class="act" aria-label={t('artist.share')} onclick={shareArtist}>
			<Share2 size={18} />
			<span>{t('artist.share')}</span>
		</button>
	</div>

	{#if enrich?.tags?.length}
		<div class="herotags"><TagChips tags={enrich.tags} /></div>
	{/if}

	<!-- Bio (quick-260607-f4y: HTML-stripped, auto-translated to the app language via
	     names.dnBio — bio is one of the only two translated surfaces). Gated on BOTH bio
	     AND bioUrl so the required attribution link is never missing (D-08). -->
	{#if enrichLoading}
		<section class="bio" aria-hidden="true">
			<span class="sk sk-h2"></span>
			<span class="sk sk-line"></span>
			<span class="sk sk-line"></span>
			<span class="sk sk-line short"></span>
		</section>
	{:else if enrich?.bio && enrich?.bioUrl}
		<section class="bio">
			<h2>{t('lastfm.about')}</h2>
			<p>{names.dnBio(enrich.bio)}</p>
			<a class="readmore" href={enrich.bioUrl} target="_blank" rel="noopener noreferrer">{t('lastfm.readMore')}</a>
		</section>
	{/if}
</header>

{#if albumsLoading}
	<section>
		<h2>{t('artist.albums')}</h2>
		<div class="albumrow">
			{#each Array(4) as _, i (i)}
				<div class="album" aria-hidden="true">
					<span class="al-cover sk"></span>
					<span class="sk sk-albumname"></span>
					<span class="sk sk-albumcount"></span>
				</div>
			{/each}
		</div>
	</section>
{:else if albums.length}
	<section>
		<h2>{t('artist.albums')}</h2>
		<div class="albumrow" use:dragScroll>
			{#each albums as al (al.name)}
				<button class="album" onclick={() => goto('/album/' + encodeURIComponent(al.name) + '?artist=' + encodeURIComponent(name))}>
					<span class="al-cover" style:background-image={al.image ? `url(${al.image})` : fallbackCoverSeed(al.name)}></span>
					<span class="al-name" use:marquee><span class="marquee-inner">{names.dnTitle(al.name)}</span></span>
					<span class="al-count" use:marquee><span class="marquee-inner">{t('artist.albumLabel')}</span></span>
				</button>
			{/each}
		</div>
	</section>
{/if}

{#if loading}
	<section>
		<h2>{t('artist.hitSongs')}</h2>
		<ul class="list" aria-label={t('artist.loading', { name: names.dnArtist(name) })}>
			{#each Array(8) as _, i (i)}
				<li>
					<span class="row" aria-hidden="true">
						<span class="sk sk-rank"></span>
						<span class="art sk"></span>
						<span class="meta"><span class="sk sk-rtitle"></span><span class="sk sk-rsub"></span></span>
					</span>
				</li>
			{/each}
		</ul>
	</section>
{:else}
	<section>
		<h2>{t('artist.hitSongs')}</h2>
		{#if songs.length}
			<ul class="list">
				{#each songs.slice(0, 30) as track, i (track.uid)}
					<li>
						<button class="row" use:longpress onlongpress={() => { menuTrack = track; menuOpen = true; }} onclick={() => { player.setQueue(songs); player.play(track); }}>
							<span class="rank">{i + 1}</span>
							<span class="art" style:background-image={track.cover ? `url(${track.cover})` : fallbackCover(track)}></span>
							<span class="meta"><span class="r-title">{names.dnTitle(track.title)}</span><span class="r-sub">{names.dnArtist(track.album || track.artist)}</span></span>
						</button>
					</li>
				{/each}
			</ul>
		{:else}<p class="muted">{t('artist.noSongs', { name: names.dnArtist(name) })}</p>{/if}
	</section>
{/if}

<!-- More like this (jip) — round avatar shelf, tap to navigate to that artist. -->
{#if relatedLoading}
	<section>
		<h2>{t('artist.moreLikeThis')}</h2>
		<div class="albumrow">
			{#each Array(6) as _, i (i)}
				<div class="album" aria-hidden="true">
					<span class="al-cover round sk"></span>
					<span class="sk sk-albumname"></span>
				</div>
			{/each}
		</div>
	</section>
{:else if related.length}
	<section>
		<h2>{t('artist.moreLikeThis')}</h2>
		<div class="albumrow" use:dragScroll>
			{#each related as a (a.name)}
				<button class="album" onclick={() => goto('/artist/' + encodeURIComponent(a.name))}>
					<span class="al-cover round" style:background-image={a.image ? `url(${a.image})` : fallbackCoverSeed(a.name)}></span>
					<span class="al-name center" use:marquee><span class="marquee-inner">{names.dnArtist(a.name)}</span></span>
				</button>
			{/each}
		</div>
	</section>
{/if}

<TrackMenu track={menuTrack} open={menuOpen} onclose={() => (menuOpen = false)} />

{#if toastMsg}<div class="toast" transition:fly={{ y: -20, duration: 180 }}>{toastMsg}</div>{/if}

<style>
	.hero { padding: 14px 0 18px; text-align: center; }
	.back { display: grid; place-items: center; width: 36px; height: 36px; background: none; border: none; color: var(--color-text); cursor: pointer; margin: 0 0 8px; padding: 0; }
	.back:hover { background: var(--color-surface-2); border-radius: 50%; }
	.herocover { width: 150px; height: 150px; border-radius: 50%; margin: 8px auto 12px; background-size: cover; background-position: center; box-shadow: 0 12px 34px rgba(0,0,0,0.5); }
	.hero h1 { font-size: 1.7rem; margin: 0; }
	.note { color: var(--color-text-muted); font-size: 12px; margin-top: 4px; }
	.herotags { display: flex; justify-content: center; margin-top: 8px; }
	/* kmn: action bar — three pill buttons centered under the hero title/note. Mirrors the
	   album-page action-bar visual language. */
	.actions { display: flex; justify-content: center; gap: 10px; flex-wrap: wrap; margin: 14px 0 6px; }
	.act { display: inline-flex; align-items: center; gap: 7px; background: var(--color-surface-2); border: 1px solid var(--color-border); color: var(--color-text); padding: 9px 16px; border-radius: 999px; font-size: 13px; cursor: pointer; }
	.act:hover { background: var(--color-surface); }
	.act:disabled { opacity: 0.45; cursor: default; }
	.act.on { color: var(--color-primary); border-color: var(--color-primary); }
	.act.primary { background: var(--color-primary); color: #fff; border-color: transparent; }
	.act.primary:hover { filter: brightness(1.06); }
	.toast { position: fixed; left: 50%; top: 16px; transform: translateX(-50%); background: var(--color-surface-2); border: 1px solid var(--color-border); color: var(--color-text); padding: 8px 14px; border-radius: 999px; font-size: 13px; z-index: 80; box-shadow: 0 8px 24px rgba(0,0,0,0.4); }
	.bio { text-align: left; margin: 16px 0 0; }
	.bio h2 { font-size: 1.1rem; margin: 0 0 8px; }
	.bio p { color: var(--color-text-muted); font-size: 13px; line-height: 1.55; margin: 0; }
	.readmore { display: inline-block; margin-top: 8px; color: var(--color-primary); font-size: 13px; }
	section { margin: 18px 0; }
	section h2 { font-size: 1.1rem; margin: 0 0 12px; }
	.albumrow { display: flex; gap: 12px; overflow-x: auto; padding-bottom: 4px; }
	/* min-width:0 + max-width:130px lock the tile width even when a long artist/album name's
	   intrinsic content-width would otherwise stretch it. flex-basis alone is a hint — the
	   default `min-width: auto` on flex items respects content size and `max-width` is needed
	   to seal off the "grows to fit content" path. With both locked at 130px, .al-name's
	   overflow:hidden produces a real clientWidth < scrollWidth, so the use:marquee action
	   detects the overflow and bounce-scrolls the text (instead of a static ellipsis). Same
	   pattern as home .album. */
	.album { flex: 0 0 130px; min-width: 0; max-width: 130px; background: none; border: none; padding: 0; cursor: pointer; text-align: left; display: flex; flex-direction: column; gap: 4px; }
	.al-cover { width: 130px; height: 130px; border-radius: 10px; background-size: cover; background-position: center; }
	.al-cover.round { border-radius: 50%; }
	.al-name { font-size: calc(12px * var(--fs-title, 1)); font-weight: 600; color: var(--color-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.al-name.center { text-align: center; }
	.al-count { font-size: calc(11px * var(--fs-artist, 1)); color: var(--color-text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	/* Marquee animation lives globally in app.css (transform-based .marquee-inner). The
	   .al-name / .al-count clips above + the use:marquee action + inner .marquee-inner span
	   in the markup are the only per-file pieces — the global rule animates them. */
	.list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
	.row { width: 100%; text-align: left; background: none; border: none; padding: 6px; border-radius: 8px; cursor: pointer; display: flex; align-items: center; gap: 12px; }
	.row:hover { background: var(--color-surface); }
	.rank { width: 18px; text-align: center; color: var(--color-text-muted); font-size: 13px; flex: none; }
	.art { width: 44px; height: 44px; border-radius: 6px; background-size: cover; background-position: center; flex: none; }
	.meta { flex: 1; display: flex; flex-direction: column; min-width: 0; }
	.r-title { font-size: calc(14px * var(--fs-title, 1)); font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.r-sub { font-size: calc(12px * var(--fs-artist, 1)); color: var(--color-text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.muted { color: var(--color-text-muted); font-size: 14px; }

	/* ---- loading skeletons (global .sk in app.css supplies the grey + shimmer; these size the
	   blocks to match the real content they stand in for) ---- */
	.bio .sk-h2 { display: block; width: 96px; height: 18px; margin-bottom: 12px; }
	.bio .sk-line { display: block; width: 100%; height: 12px; margin-bottom: 8px; }
	.bio .sk-line.short { width: 55%; }
	/* album-row skeleton tiles: .al-cover sizes the square (130px), bars sit under it */
	.sk-albumname { display: block; width: 78%; height: 12px; }
	.sk-albumcount { display: block; width: 48%; height: 11px; }
	/* hit-songs skeleton rows: reuse .row/.art/.meta layout, grey the rank + bars */
	.sk-rank { width: 14px; height: 12px; flex: none; border-radius: 3px; }
	.meta .sk-rtitle { display: block; width: 80%; height: 13px; margin-bottom: 7px; }
	.meta .sk-rsub { display: block; width: 45%; height: 11px; }
</style>
