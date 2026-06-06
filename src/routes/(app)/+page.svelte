<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { fly } from 'svelte/transition';
	import { Search, Settings, RotateCw } from '@lucide/svelte';
	import Logo from '$lib/components/Logo.svelte';
	import { buildDiversePicks } from '$lib/services/picks';
	import {
		getChartTopTracks,
		getChartTopArtists,
		getTagTopTracks,
		getGeoTopTracks,
		type DiscoveryTrack,
		type DiscoveryArtist
	} from '$lib/services/lastfm';
	import {
		resolveStub,
		mapWithConcurrency,
		DISCOVERY_TAGS,
		DISCOVERY_COUNTRIES
	} from '$lib/services/discovery';
	import { decodeTrack } from '$lib/services/share';
	import { player } from '$lib/stores/player.svelte';
	import { names } from '$lib/stores/names.svelte';
	import { t } from '$lib/i18n';
	import { longpress } from '$lib/actions/longpress';
	import TrackMenu from '$lib/components/TrackMenu.svelte';
	import type { Track } from '$lib/sources/types';

	let menuTrack = $state<Track | null>(null);
	let menuOpen = $state(false);

	const PICK_COUNT = 9;
	const PER_SHELF = 18;
	const FANOUT_CAP = 4; // ≤4 in-flight tag/country shelf fetches (Pitfall 11 / DISCO-04)
	// Bumped to v2: the cache now holds the four Last.fm discovery shelves (D-01/D-02),
	// not the flat v1 buildDiversePicks list. A stale v1 entry is simply ignored.
	const CACHE_KEY = 'musicsquare:top-picks:v2';

	// A labelled tag/country row paired with its heading.
	type Shelf = { label: string; tracks: DiscoveryTrack[] };
	// Versioned cache payload: the four displayed shelves + the fallback flag.
	type ShelfCache = {
		v: 2;
		topHits: DiscoveryTrack[];
		topArtists: DiscoveryArtist[];
		tagShelves: Shelf[];
		countryShelves: Shelf[];
		useFallback: boolean;
		fallback: Track[];
	};

	let topHits = $state<DiscoveryTrack[]>([]);
	let topArtists = $state<DiscoveryArtist[]>([]);
	let tagShelves = $state<Shelf[]>([]);
	let countryShelves = $state<Shelf[]>([]);
	// D-06: when LASTFM_KEY is absent or every shelf is empty, fall back to the random
	// buildDiversePicks grid so the home page is never blank signed-out / no-key.
	let useFallback = $state(false);
	let fallbackSongs = $state<Track[]>([]);

	let loading = $state(true);
	let error = $state<string | null>(null);

	// Component-local toast (same lightweight pattern as TrackMenu) for the unplayable case.
	let toastMsg = $state('');
	let toastTimer: ReturnType<typeof setTimeout> | null = null;
	function toast(m: string) {
		toastMsg = m;
		if (toastTimer) clearTimeout(toastTimer);
		toastTimer = setTimeout(() => (toastMsg = ''), 2000);
	}

	function fallbackCover(seed: string): string {
		const h = (seed.split('').reduce((a, c) => a + c.charCodeAt(0), 0) * 47) % 360;
		return `linear-gradient(145deg, hsl(${h} 55% 32%), hsl(${(h + 40) % 360} 55% 18%))`;
	}

	// Has at least one Last.fm shelf returned anything? Drives the D-06 fallback decision.
	function hasAnyDiscovery(
		hits: DiscoveryTrack[],
		artists: DiscoveryArtist[],
		tags: Shelf[],
		countries: Shelf[]
	): boolean {
		return (
			hits.length > 0 ||
			artists.length > 0 ||
			tags.some((s) => s.tracks.length) ||
			countries.some((s) => s.tracks.length)
		);
	}

	// localStorage is browser-only; these run inside onMount / click handlers (never SSR).
	function saveCache(payload: ShelfCache) {
		try {
			localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
		} catch {
			/* quota or unavailable — non-fatal */
		}
	}
	function loadCache(): ShelfCache | null {
		try {
			const raw = localStorage.getItem(CACHE_KEY);
			if (!raw) return null;
			const v: unknown = JSON.parse(raw);
			if (v && typeof v === 'object' && (v as ShelfCache).v === 2) return v as ShelfCache;
			return null;
		} catch {
			return null;
		}
	}

	function applyCache(c: ShelfCache) {
		topHits = c.topHits ?? [];
		topArtists = c.topArtists ?? [];
		tagShelves = c.tagShelves ?? [];
		countryShelves = c.countryShelves ?? [];
		useFallback = c.useFallback ?? false;
		fallbackSongs = c.fallback ?? [];
	}

	// Fetch the four Last.fm shelves (concurrency-capped), fall back to buildDiversePicks
	// when discovery is empty, cache the displayed result, and seed the player queue.
	// Used by Randomize + cold start + background revalidate.
	async function refresh(seedQueue = true) {
		loading = true;
		error = null;
		try {
			// Shelves 1+2 (chart) + the capped tag/country fan-out (shelves 3+4). All
			// builders never throw (→ [] on failure / absent key), so this never rejects.
			const [hits, artists, tagRows, countryRows] = await Promise.all([
				getChartTopTracks(PER_SHELF),
				getChartTopArtists(PER_SHELF),
				mapWithConcurrency(DISCOVERY_TAGS, FANOUT_CAP, (tag) =>
					getTagTopTracks(tag, PER_SHELF)
				),
				mapWithConcurrency(DISCOVERY_COUNTRIES, FANOUT_CAP, (c) =>
					getGeoTopTracks(c, PER_SHELF)
				)
			]);

			const tags: Shelf[] = DISCOVERY_TAGS.map((label, i) => ({
				label,
				tracks: tagRows[i] ?? []
			})).filter((s) => s.tracks.length);
			const countries: Shelf[] = DISCOVERY_COUNTRIES.map((label, i) => ({
				label,
				tracks: countryRows[i] ?? []
			})).filter((s) => s.tracks.length);

			if (hasAnyDiscovery(hits, artists, tags, countries)) {
				// PRIMARY: the Last.fm discovery surface (D-01/D-02).
				topHits = hits;
				topArtists = artists;
				tagShelves = tags;
				countryShelves = countries;
				useFallback = false;
				fallbackSongs = [];
				saveCache({
					v: 2,
					topHits: hits,
					topArtists: artists,
					tagShelves: tags,
					countryShelves: countries,
					useFallback: false,
					fallback: []
				});
			} else {
				// D-06 FALLBACK: absent key / all-empty → keep the home page populated.
				const picks = await buildDiversePicks(PICK_COUNT);
				if (picks.length) {
					useFallback = true;
					fallbackSongs = picks;
					topHits = [];
					topArtists = [];
					tagShelves = [];
					countryShelves = [];
					if (seedQueue) player.setQueue(picks);
					saveCache({
						v: 2,
						topHits: [],
						topArtists: [],
						tagShelves: [],
						countryShelves: [],
						useFallback: true,
						fallback: picks
					});
				} else {
					error = t('home.noResults');
				}
			}
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	}

	// Resolve-on-tap (D-03): a discovery track is a {artist,title} stub, NOT a Track, so
	// it MUST be resolved via searchAll+dedupeBest before play. Strictly lazy (one tap →
	// one resolve). A miss shows an unplayable toast and never breaks the surface/player.
	async function playStub(item: DiscoveryTrack) {
		const tr = await resolveStub(item.artist, item.title);
		if (tr) {
			player.setQueue([tr]);
			player.play(tr);
		} else {
			toast(t('home.unplayable'));
		}
	}

	onMount(() => {
		// Shared link: /?play=<token> → reconstruct the track stub and play it.
		const token = new URLSearchParams(location.search).get('play');
		if (token) {
			const tr = decodeTrack(token);
			if (tr) {
				player.setQueue([tr]);
				player.play(tr);
			}
			history.replaceState(null, '', location.pathname); // clear the param
		}

		// Instant render from the cached shelves, then revalidate in the background.
		const cached = loadCache();
		if (cached) {
			applyCache(cached);
			// Re-seed the queue only for the fallback grid (discovery taps resolve-on-tap).
			if (!token && cached.useFallback && cached.fallback.length) {
				player.setQueue(cached.fallback);
			}
			loading = false;
			// Background revalidate without re-seeding the queue (don't clobber ?play).
			void refresh(false);
		} else {
			// Cold cache: full fetch. Seed the queue unless a shared link is taking over.
			refresh(!token);
		}
	});
</script>

<header class="topnav">
	<div class="brand"><Logo size={26} /> openmusic</div>
	<button class="gear" aria-label={t('home.settings')} onclick={() => goto('/settings')}><Settings size={20} /></button>
</header>

<button class="searchpill" onclick={() => goto('/search')}>
	<Search size={16} /> <span>{t('home.searchPill')}</span>
</button>

<section class="section">
	<div class="head">
		<h2>{t('home.topPicks')}</h2>
		<button class="more" onclick={() => refresh(true)} disabled={loading}><RotateCw size={13} /> {loading ? t('home.loadingPicks') : t('home.randomize')}</button>
	</div>

	{#if loading && !useFallback && !topHits.length && !topArtists.length && !tagShelves.length && !countryShelves.length && !fallbackSongs.length}
		<div class="albumrow">
			{#each Array(6) as _, i (i)}<div class="album"><span class="al-cover skeleton"></span></div>{/each}
		</div>
	{:else if error}
		<p class="error">{error} — <button class="retry" onclick={() => refresh(true)}>{t('common.retry')}</button></p>
	{:else if useFallback}
		<!-- D-06 fallback: the random buildDiversePicks grid (real Tracks → tap-to-play). -->
		<div class="grid">
			{#each fallbackSongs as track (track.uid)}
				<button class="tile" use:longpress onlongpress={() => { menuTrack = track; menuOpen = true; }} onclick={() => { player.setQueue(fallbackSongs); player.play(track); }}>
					<div class="art" style:background-image={track.cover ? `url(${track.cover})` : fallbackCover(track.uid)}></div>
					{#if track.qualityLabel || track.quality}<span class="q">{track.qualityLabel ?? track.quality}</span>{/if}
					<div class="scrim"></div>
					<div class="label">
						<div class="t-title">{names.dn(track.title)}</div>
						<div class="t-artist">{names.dn(track.artist)}</div>
					</div>
				</button>
			{/each}
		</div>
	{:else}
		<!-- PRIMARY: the four Last.fm discovery shelves (D-01/D-02). -->
		{#if topHits.length}
			<div class="subhead">{t('home.topHits')}</div>
			<div class="albumrow">
				{#each topHits as item (item.artist + ' ' + item.title)}
					<button class="album" onclick={() => playStub(item)}>
						<span class="al-cover" style:background-image={item.image ? `url(${item.image})` : fallbackCover(item.artist + item.title)}></span>
						<span class="al-name">{names.dn(item.title)}</span>
						<span class="al-count">{names.dn(item.artist)}</span>
					</button>
				{/each}
			</div>
		{/if}

		{#if topArtists.length}
			<div class="subhead">{t('home.topArtists')}</div>
			<div class="albumrow">
				{#each topArtists as a (a.name)}
					<button class="album" onclick={() => goto('/artist/' + encodeURIComponent(a.name))}>
						<span class="al-cover round" style:background-image={a.image ? `url(${a.image})` : fallbackCover(a.name)}></span>
						<span class="al-name center">{names.dn(a.name)}</span>
					</button>
				{/each}
			</div>
		{/if}

		{#each tagShelves as shelf (shelf.label)}
			<div class="subhead">{t('home.tagShelf', { tag: shelf.label })}</div>
			<div class="albumrow">
				{#each shelf.tracks as item (item.artist + ' ' + item.title)}
					<button class="album" onclick={() => playStub(item)}>
						<span class="al-cover" style:background-image={item.image ? `url(${item.image})` : fallbackCover(item.artist + item.title)}></span>
						<span class="al-name">{names.dn(item.title)}</span>
						<span class="al-count">{names.dn(item.artist)}</span>
					</button>
				{/each}
			</div>
		{/each}

		{#each countryShelves as shelf (shelf.label)}
			<div class="subhead">{t('home.countryShelf', { country: shelf.label })}</div>
			<div class="albumrow">
				{#each shelf.tracks as item (item.artist + ' ' + item.title)}
					<button class="album" onclick={() => playStub(item)}>
						<span class="al-cover" style:background-image={item.image ? `url(${item.image})` : fallbackCover(item.artist + item.title)}></span>
						<span class="al-name">{names.dn(item.title)}</span>
						<span class="al-count">{names.dn(item.artist)}</span>
					</button>
				{/each}
			</div>
		{/each}
	{/if}
</section>

<TrackMenu track={menuTrack} open={menuOpen} onclose={() => (menuOpen = false)} />

{#if toastMsg}<div class="toast" transition:fly={{ y: 20, duration: 180 }}>{toastMsg}</div>{/if}

<style>
	.topnav { display: flex; align-items: center; justify-content: space-between; padding: 14px 0 10px; }
	.brand { display: flex; align-items: center; gap: 8px; font-weight: 800; font-size: 1.35rem; }
	.gear { background: none; border: none; color: var(--color-text); cursor: pointer; width: 38px; height: 38px; display: grid; place-items: center; border-radius: 50%; }
	.gear:hover { background: var(--color-surface-2); }
	.searchpill {
		width: 100%; text-align: left; background: var(--color-surface-2);
		border: 1px solid var(--color-border); border-radius: 999px;
		padding: 11px 16px; color: var(--color-text-muted); font-size: 13px;
		display: flex; align-items: center; gap: 8px; cursor: pointer; margin-bottom: 18px;
	}
	.section .head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 12px; }
	.section h2 { font-size: 1.1rem; margin: 0; }
	.subhead { font-size: 0.95rem; font-weight: 700; margin: 14px 0 8px; color: var(--color-text); }
	.more, .retry {
		background: none; border: 1px solid var(--color-border); color: var(--color-text-muted);
		padding: 5px 12px; border-radius: 999px; font-size: 12px; cursor: pointer;
		display: inline-flex; align-items: center; gap: 5px;
	}
	/* Horizontal scroll row (copied from the artist page .albumrow pattern). */
	.albumrow { display: flex; gap: 12px; overflow-x: auto; padding-bottom: 4px; }
	.album { flex: 0 0 130px; background: none; border: none; padding: 0; cursor: pointer; text-align: left; display: flex; flex-direction: column; gap: 4px; transition: transform 0.12s ease; }
	.album:active { transform: scale(0.96); }
	.al-cover { width: 130px; height: 130px; border-radius: 10px; background-size: cover; background-position: center; background-color: var(--color-surface-2); }
	.al-cover.round { border-radius: 50%; }
	.al-cover.skeleton { background: linear-gradient(110deg, #1a1a22 30%, #24242f 50%, #1a1a22 70%); background-size: 200% 100%; animation: sk 1.2s infinite; }
	@keyframes sk { to { background-position: -200% 0; } }
	.al-name { font-size: 12px; font-weight: 600; color: var(--color-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.al-name.center { text-align: center; }
	.al-count { font-size: 11px; color: var(--color-text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	/* Fallback grid (D-06). */
	.grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
	.tile {
		position: relative; aspect-ratio: 1 / 1; border-radius: var(--radius-md);
		overflow: hidden; cursor: pointer; border: none; padding: 0; background: var(--color-surface-2);
		transition: transform 0.12s ease;
	}
	.tile:active { transform: scale(0.96); }
	.art { position: absolute; inset: 0; background-size: cover; background-position: center; }
	.scrim { position: absolute; inset: 0; background: linear-gradient(to top, rgba(0,0,0,0.8) 0%, rgba(0,0,0,0) 55%); }
	.label { position: absolute; left: 7px; right: 7px; bottom: 6px; text-align: left; }
	.t-title { font-size: 11px; font-weight: 700; line-height: 1.2; color: #fff; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
	.t-artist { font-size: 10px; color: #d8d8de; margin-top: 2px; opacity: 0.85; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.q { position: absolute; top: 6px; right: 6px; font-size: 8px; font-weight: 700; padding: 2px 5px; border-radius: 4px; background: rgba(0,0,0,0.55); color: #fff; }
	.error { color: #ff7a90; font-size: 14px; }
	.toast { position: fixed; left: 50%; transform: translateX(-50%); bottom: 28px; z-index: 90; background: #000; color: #fff; padding: 10px 16px; border-radius: 999px; font-size: 13px; box-shadow: var(--shadow-lg); }
</style>
