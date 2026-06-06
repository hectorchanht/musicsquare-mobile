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
		mapWithConcurrency,
		shuffle,
		pickRandomPage,
		DISCOVERY_TAGS,
		DISCOVERY_COUNTRIES
	} from '$lib/services/discovery';
	import {
		resolveSectionOrder,
		resolveSubset,
		clampShelfSize
	} from '$lib/services/home-layout';
	import { settings } from '$lib/stores/settings.svelte';
	import { deezerChart } from '$lib/services/deezer';
	import { getCachedCover, getCachedArtistCover } from '$lib/services/cover-cache';
	import { backfillCovers, backfillArtistCovers } from '$lib/services/cover-backfill';
	import { decodeTrack } from '$lib/services/share';
	import { player } from '$lib/stores/player.svelte';
	import { names } from '$lib/stores/names.svelte';
	import { t } from '$lib/i18n';
	import { longpress } from '$lib/actions/longpress';
	import { dragScroll } from '$lib/actions/dragScroll';
	import { marquee } from '$lib/actions/marquee';
	import TrackMenu from '$lib/components/TrackMenu.svelte';
	import type { Track } from '$lib/sources/types';

	let menuTrack = $state<Track | null>(null);
	let menuOpen = $state(false);

	const PICK_COUNT = 9;
	// w87: items-per-shelf is now the user setting (clampShelfSize(settings.homeShelfSize)),
	// read inside refresh(); the old hardcoded PER_SHELF=18 is gone (18 is still the default).
	const FANOUT_CAP = 4; // ≤4 in-flight tag/country shelf fetches (Pitfall 11 / DISCO-04)
	// Bumped to v2: the cache now holds the four Last.fm discovery shelves (D-01/D-02),
	// not the flat v1 buildDiversePicks list. A stale v1 entry is simply ignored.
	// w87: the cache is keyed by CACHE_KEY ONLY (NOT by the home-layout config). A config
	// change (subset / shelf size) is reconciled by the background refresh(false,true) that
	// runs after applyCache — it re-fetches with the CURRENT config and overwrites the cache,
	// so the next paint reflects the change without adding config to the key.
	const CACHE_KEY = 'openmusic:top-picks:v2';

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

	// quick-260606-wv8 (supersedes v7k; extends nza's FIX-B / rvy's FIX-A): prefer a real cover
	// for a discovery item in this EXACT render order (the cheap, synchronous pre-checks):
	//   1. Last.fm image (item.image)                    — already on the row (the "Last.fm" tier
	//                                                       of the Deezer → CN → Last.fm chain,
	//                                                       satisfied here, NOT as a backfill call)
	//   2. CAA-by-mbid (caaReleaseGroupCover)             — nza's MusicBrainz path
	//   3a. TRACK: cached cover (getCachedCover)          — Deezer/CN backfill, keyed by artist|title
	//   3b. ARTIST: cached artist image (getCachedArtistCover) — Deezer backfill, keyed by artistName
	//   4. null → gradient                                — never a broken/blocking image
	// What changed in wv8 is the BACKFILL that fills tiers 3a/3b (Deezer-first → CN for tracks,
	// Deezer for artists); the tileCover render order itself is UNCHANGED. The
	// cached lookups read `coverVer` so Svelte 5 re-evaluates each tile's <img src> when a
	// background resolve lands (coverVer is bumped in the backfill onResolved callback). Track
	// rows pass {artist,title}; ARTIST tiles pass a dedicated `artistName` (NOT `artist`) so the
	// artist-only cache key is read — never colliding with a {artist,title} track of the same
	// name. Rendered as a lazy <img> over the gradient (NOT a CSS background) so a 404 degrades
	// via onerror.
	function tileCover(item: {
		image: string | null;
		mbid: string | null;
		artist?: string;
		title?: string;
		artistName?: string;
	}): string | null {
		void coverVer; // reactive dependency: recompute when a backfilled cover lands
		if (item.image) return item.image;
		// NOTE: the CAA-by-mbid tier was REMOVED here — coverartarchive.org image loads are
		// blocked by the browser's Opaque Response Blocking (net::ERR_BLOCKED_BY_ORB), so a CAA
		// URL always renders broken AND shadowed the working Deezer/CN backfilled cover for any
		// item that carried an mbid (the runtime root cause of "most tiles are color blocks").
		if (item.artist && item.title) return getCachedCover(item.artist, item.title);
		if (item.artistName) return getCachedArtistCover(item.artistName);
		return null;
	}
	// Hide a cover <img> on load error so the gradient underneath shows (no broken-image icon).
	function hideOnError(e: Event) {
		(e.currentTarget as HTMLImageElement).style.display = 'none';
	}

	// FIX-A: bumped in backfillCovers' onResolved so tileCover() recomputes and resolved covers
	// appear without a full refresh. A plain $state number is the cheapest reactive trigger.
	let coverVer = $state(0);

	// quick-260607-0bb (supersedes wv8): gather every TRACK row across all shelves that still
	// shows a gradient (no Last.fm image AND no mbid) — exactly the tiles nza's CAA path could
	// not cover — and every top-ARTIST tile with no Last.fm image (artist art is deprecated →
	// always null). Then fire BOTH lazy, concurrency-capped backfills OFF the critical path (void,
	// never awaited before paint): track covers (Deezer → iTunes → CN) and artist images
	// (Deezer → iTunes). Both skip already-cached entries, so a warm visit issues ~0 requests. The
	// same coverVer++ onResolved makes covers — track AND artist — appear progressively as resolves
	// land. Chain: tileCover render = Last.fm image → CAA(mbid) → cached(Deezer/iTunes/CN) →
	// gradient; BACKFILL fill = Deezer → iTunes → CN (track) / Deezer → iTunes (artist).
	//
	// CAP LIFTED (0bb): the cap is now the FULL gathered gradient set — `max: rows.length` /
	// `max: artistNames.length` — so EVERY rendered gradient tile (all ~270 track tiles + ~18 artist
	// tiles in the default config) is attempted, not just a fixed first 24/12 (the wv8 cap stranded
	// every tile past the 24th/12th as a permanent gradient — the grounded root cause of "most tiles
	// are color blocks"). The in-flight CAP=6 pool + per-call AbortSignal.timeout + skip-cached +
	// de-dupe keep this safe: a cold visit stays under Deezer's ~50 req/5s (Deezer is tier-1 + edge-
	// cached; iTunes/CN fire only on a Deezer miss), and a warm visit is ~free (every tile cached).
	function scheduleBackfill() {
		const rows: { artist: string; title: string }[] = [];
		const pushNeeding = (items: DiscoveryTrack[]) => {
			for (const it of items) {
				if (!it.image) rows.push({ artist: it.artist, title: it.title });
			}
		};
		pushNeeding(topHits);
		for (const s of tagShelves) pushNeeding(s.tracks);
		for (const s of countryShelves) pushNeeding(s.tracks);
		if (rows.length) {
			void backfillCovers(rows, { onResolved: () => coverVer++, max: rows.length });
		}

		// 0bb: artist tiles are structurally gradient (Last.fm artist art deprecated → null).
		// Resolve their images via Deezer → iTunes, capped (= full gathered set) + cached + post-paint.
		const artistNames = topArtists.filter((a) => !a.image).map((a) => a.name);
		if (artistNames.length) {
			void backfillArtistCovers(artistNames, {
				onResolved: () => coverVer++,
				max: artistNames.length
			});
		}
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

	// Randomize page bound (VX2): how many Last.fm chart/tag/geo pages to draw from. Kept
	// SMALL so a randomly-picked page still has data on these high-traffic methods — going
	// deeper risks empty pages (→ a blank shelf). The fan-out WIDTH is unchanged (one
	// request per existing shelf, FANOUT_CAP in flight); only WHICH page each shelf fetches
	// varies, and each (method+params+page) stays edge-cached (T-vx2-03 — no new fan-out).
	const RANDOM_PAGE_BOUND = 5;

	// Fetch the four Last.fm shelves (concurrency-capped), fall back to buildDiversePicks
	// when discovery is empty, cache the displayed result, and seed the player queue.
	// Used by Randomize + cold start + background revalidate.
	//
	// `background` (WR-02): a post-cache-hit revalidate does NOT toggle `loading`, so the
	// Randomize button stays enabled and shows live content rather than "Loading…".
	// `refreshGen` (WR-04): only the LATEST refresh writes state — a stale background call
	// that finishes after a manual Randomize is discarded, so they never clobber each other.
	// `randomize` (VX2): the 隨機推薦 button passes true to genuinely VARY the surface — each
	// chart/tag/geo call draws a fresh random page AND the shelf order + within-shelf tile
	// order + topHits/topArtists are shuffled, so consecutive presses look different even
	// when an overlapping page comes back. A NON-randomize (cold/background) call passes the
	// default page 1 → identical request + edge cache key as before, AND no shuffle, so the
	// cache-friendly fast path is untouched. Randomize never reads loadCache(); it always
	// FETCHES and OVERWRITES the cache below with the freshly-shuffled arrangement.
	let refreshGen = 0;
	async function refresh(seedQueue = true, background = false, randomize = false) {
		const gen = ++refreshGen;
		if (!background) loading = true;
		error = null;
		try {
			// w87: per-shelf tile count is the user setting, clamped to [6,24] (T-w87-01 — a
			// poisoned/old value can never produce a giant or NaN page size). Tag/country
			// fan-out runs over the SELECTED subset (resolveSubset falls back to the full pool
			// when none/garbage are selected, T-w87-03), so config can only NARROW the
			// surface — fan-out width stays ≤ the pool size, behind FANOUT_CAP (Pitfall 11).
			const perShelf = clampShelfSize(settings.homeShelfSize);
			const tagPool = resolveSubset(settings.homeTags, DISCOVERY_TAGS);
			const countryPool = resolveSubset(settings.homeCountries, DISCOVERY_COUNTRIES);
			// Shelves 1+2 (chart) + the capped tag/country fan-out (shelves 3+4). All
			// builders never throw (→ [] on failure / absent key), so this never rejects.
			// On a randomize press, draw a fresh random page PER call so different shelves
			// pull from different pages; on a normal call pass page 1 (cache-friendly).
			const pg = () => (randomize ? pickRandomPage(RANDOM_PAGE_BOUND) : 1);
			// TOP-HITS + TOP-ARTISTS source from the Deezer /chart: covers + artist pictures are
			// EMBEDDED, so ONE request yields a fully-covered shelf and the per-tile cover backfill
			// is demoted to a rare backup (user: "less requests, backfill as backup not norm").
			// Tag/country shelves stay Last.fm (their imageless tiles are the backup backfill's job).
			const dzChart = await deezerChart(perShelf);
			if (gen !== refreshGen) return;
			const [tagRows, countryRows] = await Promise.all([
				mapWithConcurrency(tagPool, FANOUT_CAP, (tag) =>
					getTagTopTracks(tag, perShelf, pg())
				),
				mapWithConcurrency(countryPool, FANOUT_CAP, (c) =>
					getGeoTopTracks(c, perShelf, pg())
				)
			]);
			if (gen !== refreshGen) return; // superseded by a newer refresh (WR-04)

			// Deezer PRIMARY; fall back to the Last.fm chart PER SOURCE only when Deezer is empty.
			const rawHits = dzChart.tracks.length
				? dzChart.tracks
				: await getChartTopTracks(perShelf, pg());
			const rawArtists = dzChart.artists.length
				? dzChart.artists
				: await getChartTopArtists(perShelf);
			if (gen !== refreshGen) return;

			// On randomize, shuffle the chart shelves' tile order so even an overlapping page
			// renders visibly differently. (Non-randomize leaves them in Last.fm rank order.)
			const hits = randomize ? shuffle(rawHits) : rawHits;
			const artists = randomize ? shuffle(rawArtists) : rawArtists;

			// Build the tag/country shelves; on randomize also shuffle the tile order WITHIN
			// each shelf. w87: map over the resolved SUBSET (tagPool/countryPool) so the
			// shelves match the rows we fetched above — a deselected tag simply has no shelf.
			let tags: Shelf[] = tagPool.map((label, i) => ({
				label,
				tracks: randomize ? shuffle(tagRows[i] ?? []) : (tagRows[i] ?? [])
			})).filter((s) => s.tracks.length);
			let countries: Shelf[] = countryPool.map((label, i) => ({
				label,
				tracks: randomize ? shuffle(countryRows[i] ?? []) : (countryRows[i] ?? [])
			})).filter((s) => s.tracks.length);

			// On randomize, also shuffle the ORDER of the shelves themselves (which tag/country
			// shelf appears first) — done on the local vars BEFORE assignment + saveCache so the
			// persisted cache and the rendered UI carry the identical shuffled arrangement.
			if (randomize) {
				tags = shuffle(tags);
				countries = shuffle(countries);
			}

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
				scheduleBackfill(); // FIX-A: fill gradients with real CN covers, post-paint, capped
			} else {
				// D-06 FALLBACK: absent key / all-empty → keep the home page populated.
				const picks = await buildDiversePicks(PICK_COUNT);
				if (gen !== refreshGen) return; // superseded during the fallback fetch (WR-04)
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
				} else if (!background) {
					error = t('home.noResults');
				}
			}
		} catch (e) {
			// Background-revalidate failures stay silent — cached content remains visible.
			if (gen === refreshGen && !background) error = e instanceof Error ? e.message : String(e);
		} finally {
			if (gen === refreshGen && !background) loading = false;
		}
	}

	// Resolve-on-tap (D-03) — now OPTIMISTIC (FIX-A). Delegate to player.playStub, which
	// locks the tapped {artist,title,cover} into the now-bar with a loading indicator
	// instantly, dedupes a same-song double-tap, and supersedes an in-flight resolve when a
	// different song is tapped. playStub returns null for BOTH a genuine miss AND a
	// supersede, so gate the toast on pendingTrack: a supersede leaves pendingTrack pointing
	// at the NEWER song (no toast), a miss clears pendingTrack (toast). Cover-if-known is
	// passed so the optimistic bar shows real art immediately when available.
	async function playStub(item: DiscoveryTrack) {
		const tr = await player.playStub(item.artist, item.title, item.image);
		if (tr === null && player.pendingTrack == null) toast(t('home.unplayable'));
	}

	onMount(() => {
		// w87: ensure the home-layout config is loaded before cache/refresh reads it. load()
		// is idempotent (its own `loaded` guard), so the layout's onMount call is harmless.
		settings.load();

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
			scheduleBackfill(); // FIX-A: backfill covers for the just-applied cached shelves
			// Background revalidate (WR-02: keeps Randomize enabled, no "Loading…") without
			// re-seeding the queue (don't clobber ?play).
			void refresh(false, true);
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

{#if settings.homeShowSearchPill}
	<button class="searchpill" onclick={() => goto('/search')}>
		<Search size={16} /> <span>{t('home.searchPill')}</span>
	</button>
{/if}

<section class="section" class:compact={settings.homeDensity === 'compact'}>
	<div class="head">
		<h2>{t('home.topPicks')}</h2>
		{#if settings.homeShowRandomize}
			<button class="more" onclick={() => refresh(true, false, true)} disabled={loading}><RotateCw size={13} /> {loading ? t('home.loadingPicks') : t('home.randomize')}</button>
		{/if}
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
						<div class="t-title">{names.dnTitle(track.title)}</div>
						<div class="t-artist">{names.dnArtist(track.artist)}</div>
					</div>
				</button>
			{/each}
		</div>
	{:else}
		<!-- PRIMARY: the four Last.fm discovery shelves (D-01/D-02). w87: render each
		     section block in the user's RESOLVED order (resolveSectionOrder drops unknown /
		     appends missing known ids, so a corrupt saved order never blanks the home),
		     skipping any id in settings.homeHidden. The per-section markup lives in the
		     snippets below; only ORDER + the hidden-skip are new. -->
		{#each resolveSectionOrder(settings.homeSectionOrder) as id (id)}
			{#if !settings.homeHidden.includes(id)}
				{#if id === 'top-hits'}{@render topHitsBlock()}
				{:else if id === 'top-artists'}{@render topArtistsBlock()}
				{:else if id === 'tags'}{@render tagsBlock()}
				{:else if id === 'countries'}{@render countriesBlock()}
				{/if}
			{/if}
		{/each}
	{/if}
</section>

{#snippet topHitsBlock()}
	{#if topHits.length}
		<div class="subhead">{t('home.topHits')}</div>
		<div class="albumrow" use:dragScroll>
			{#each topHits as item (item.artist + ' ' + item.title)}
				<button class="album" onclick={() => playStub(item)}>
					<span class="al-cover" style:background-image={fallbackCover(item.artist + item.title)}>
						{#if tileCover(item)}<img class="al-cover-img" src={tileCover(item)} loading="lazy" alt="" onerror={hideOnError} />{/if}
					</span>
					<span class="al-name" use:marquee>{names.dnTitle(item.title)}</span>
					<span class="al-count" use:marquee>{names.dnArtist(item.artist)}</span>
				</button>
			{/each}
		</div>
	{/if}
{/snippet}

{#snippet topArtistsBlock()}
	{#if topArtists.length}
		<div class="subhead">{t('home.topArtists')}</div>
		<div class="albumrow" use:dragScroll>
			{#each topArtists as a (a.name)}
				{@const artistCover = tileCover({ image: a.image, mbid: a.mbid, artistName: a.name })}
				<button class="album" onclick={() => goto('/artist/' + encodeURIComponent(a.name))}>
					<span class="al-cover round" style:background-image={fallbackCover(a.name)}>
						{#if artistCover}<img class="al-cover-img" src={artistCover} loading="lazy" alt="" onerror={hideOnError} />{/if}
					</span>
					<span class="al-name center" use:marquee>{names.dnArtist(a.name)}</span>
				</button>
			{/each}
		</div>
	{/if}
{/snippet}

{#snippet tagsBlock()}
	{#each tagShelves as shelf (shelf.label)}
		<div class="subhead">{t('home.tagShelf', { tag: shelf.label })}</div>
		<div class="albumrow" use:dragScroll>
			{#each shelf.tracks as item (item.artist + ' ' + item.title)}
				<button class="album" onclick={() => playStub(item)}>
					<span class="al-cover" style:background-image={fallbackCover(item.artist + item.title)}>
						{#if tileCover(item)}<img class="al-cover-img" src={tileCover(item)} loading="lazy" alt="" onerror={hideOnError} />{/if}
					</span>
					<span class="al-name" use:marquee>{names.dnTitle(item.title)}</span>
					<span class="al-count" use:marquee>{names.dnArtist(item.artist)}</span>
				</button>
			{/each}
		</div>
	{/each}
{/snippet}

{#snippet countriesBlock()}
	{#each countryShelves as shelf (shelf.label)}
		<div class="subhead">{t('home.countryShelf', { country: shelf.label })}</div>
		<div class="albumrow" use:dragScroll>
			{#each shelf.tracks as item (item.artist + ' ' + item.title)}
				<button class="album" onclick={() => playStub(item)}>
					<span class="al-cover" style:background-image={fallbackCover(item.artist + item.title)}>
						{#if tileCover(item)}<img class="al-cover-img" src={tileCover(item)} loading="lazy" alt="" onerror={hideOnError} />{/if}
					</span>
					<span class="al-name" use:marquee>{names.dnTitle(item.title)}</span>
					<span class="al-count" use:marquee>{names.dnArtist(item.artist)}</span>
				</button>
			{/each}
		</div>
	{/each}
{/snippet}

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
	/* min-width:0 is REQUIRED: without it the flex item's default min-width:auto lets the
	   nowrap .al-name/.al-count grow the tile past its 130px basis to fit the full text — which
	   both widened the row AND defeated the marquee (its clientWidth grew to the text width so
	   scrollWidth>clientWidth never tripped). Pinning min-width:0 holds the 130px basis, so the
	   labels clip to the cover width and the marquee correctly detects + scrolls the overflow. */
	.album { flex: 0 0 130px; min-width: 0; max-width: 130px; background: none; border: none; padding: 0; cursor: pointer; text-align: left; display: flex; flex-direction: column; gap: 4px; transition: transform 0.12s ease; }
	.album:active { transform: scale(0.96); }
	.al-cover { position: relative; overflow: hidden; width: 130px; height: 130px; border-radius: 10px; background-size: cover; background-position: center; background-color: var(--color-surface-2); }
	.al-cover.round { border-radius: 50%; }
	/* w87: COMPACT density — tighter tiles + gaps so more fit per shelf row. Comfortable
	   (the default) keeps the values above. The class is set on .section from
	   settings.homeDensity, so toggling the setting re-sizes every shelf/grid live. */
	.section.compact .albumrow { gap: 8px; }
	.section.compact .album { flex-basis: 96px; }
	.section.compact .al-cover { width: 96px; height: 96px; }
	.section.compact .grid { gap: 8px; grid-template-columns: repeat(4, 1fr); }
	/* FIX-B: real cover (Last.fm or CAA) layered over the gradient span; onerror hides it
	   (a 404 → the gradient shows). inherit border-radius so the round variant clips it. */
	.al-cover-img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; border-radius: inherit; }
	.al-cover.skeleton { background: linear-gradient(110deg, #1a1a22 30%, #24242f 50%, #1a1a22 70%); background-size: 200% 100%; animation: sk 1.2s infinite; }
	@keyframes sk { to { background-position: -200% 0; } }
	.al-name { font-size: 12px; font-weight: 600; color: var(--color-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.al-name.center { text-align: center; }
	.al-count { font-size: 11px; color: var(--color-text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	/* FIX-C: marquee-bounce a truncated label. use:marquee adds .marquee-on and sets
	   --marquee-dx (the exact overflow distance) ONLY when the text overflows AND the user
	   has not requested reduced motion. The box keeps overflow:hidden + nowrap; we animate
	   text-indent (which scrolls inline text WITHIN the clip box, respecting it) from 0 to
	   -dx and back (alternate = bounce), dropping the ellipsis while scrolling. Non-overflow
	   labels never get the class → the static ellipsis above stays. The @media gate is
	   defense-in-depth alongside the action's own prefers-reduced-motion check. */
	@media (prefers-reduced-motion: no-preference) {
		/* .marquee-on is toggled at runtime by use:marquee, so it is not in the static markup;
		   :global() on that part keeps the .al-name/.al-count scope while telling svelte-check
		   the runtime class is intentional (no false "unused selector"). */
		.al-name:global(.marquee-on),
		.al-count:global(.marquee-on) {
			text-overflow: clip;
			/* SIMPLE fixed 8s loop, LINEAR (no wobble): 0–2s hold at start (25%), 2–6s slowly
			   scroll left to reveal the end, 6–8s hold revealed, then `alternate` glides back.
			   Fixed duration → a guaranteed ~2s readable pause regardless of text length. */
			animation: marquee-scroll 8s linear infinite alternate;
		}
	}
	@keyframes marquee-scroll {
		0%, 25% { text-indent: 0; } /* ~2s hold at the start */
		75%, 100% { text-indent: calc(-1 * var(--marquee-dx, 0px)); } /* reveal + hold the end */
	}
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
