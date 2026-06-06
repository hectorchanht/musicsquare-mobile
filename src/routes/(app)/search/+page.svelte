<script lang="ts">
	import { onDestroy, onMount, tick } from 'svelte';
	import { searchAll } from '$lib/services/catalog';
	import { dedupeBest } from '$lib/services/dedupe';
	import { settings } from '$lib/stores/settings.svelte';
	import { player } from '$lib/stores/player.svelte';
	import { names } from '$lib/stores/names.svelte';
	import { searchSession } from '$lib/stores/searchSession.svelte';
	import { searchHistory } from '$lib/stores/searchHistory.svelte';
	import { t } from '$lib/i18n';
	import { longpress } from '$lib/actions/longpress';
	import TrackMenu from '$lib/components/TrackMenu.svelte';
	import type { Track } from '$lib/sources/types';

	let menuTrack = $state<Track | null>(null);
	let menuOpen = $state(false);

	let q = $state('');
	let results = $state<Track[]>([]);
	let loading = $state(false);
	let searched = $state(false);
	let someFailed = $state(false);
	let ac: AbortController | null = null;

	// D-05: focus tracking for the past-search suggestion list (idle pre-query state).
	let inputFocused = $state(false);

	// Infinite-scroll pagination state.
	let page = $state(1); // last page successfully loaded
	let loadingMore = $state(false); // true ONLY while a NEXT-page batch is in flight
	let hasMore = $state(false); // whether another batch might yield net-new tracks
	let moreAc: AbortController | null = null; // separate controller for load-more requests

	// Sentinel + observer (sentinel binding/observer creation live in the template/$effect).
	// ac/moreAc/io/sentinelEl are PAGE-LOCAL transients — never lifted into searchSession.
	let sentinelEl = $state<HTMLLIElement | null>(null);
	let io: IntersectionObserver | null = null;

	// D-02: persist the live result set into the in-memory session so a tab return
	// restores instantly. Called after run()/loadMore() settle (browser-side only).
	function persistSession() {
		searchSession.save({ q: q.trim(), results, page, hasMore, searched });
	}

	function fallbackCover(t: Track): string {
		const h = (t.uid.split('').reduce((a, c) => a + c.charCodeAt(0), 0) * 47) % 360;
		return `linear-gradient(145deg, hsl(${h} 55% 32%), hsl(${(h + 40) % 360} 55% 18%))`;
	}

	async function run(e?: Event) {
		e?.preventDefault();
		const kw = q.trim();
		if (!kw) return;
		ac?.abort();
		moreAc?.abort(); // cancel any in-flight load-more from a previous query
		ac = new AbortController();
		const myAc = ac; // capture for the onPartial stale-guard (survives a later ac swap)
		// D-05: record the user-intent query on submit (even a zero-result one, so a
		// typo'd query the user wants to retry is still listed). De-dupe/cap are in the store.
		searchHistory.add(kw);
		// D-02: a NEW query resets pagination AND clears the prior result set so the
		// D-01 first-load skeleton (gated on results.length===0) shows immediately.
		results = [];
		inputFocused = false;
		loading = true;
		searched = true;
		someFailed = false;
		try {
			// D-06: stream partials so results render as each source settles. The skeleton
			// (results.length===0) yields to the FIRST partial. Two-layer abort guard
			// (mirrors the loadMore race guard) drops a superseded query's partials.
			const { interleaved, perSource } = await searchAll(kw, 1, {}, ac.signal, (partial) => {
				if (myAc.signal.aborted || kw !== q.trim()) return;
				results = dedupeBest(partial.interleaved, settings.preferredSource);
			});
			// Final value is authoritative — re-derive from the complete superset.
			results = dedupeBest(interleaved, settings.preferredSource);
			someFailed = perSource.some((p) => p.status === 'error');
			// Reset pagination: assume more may exist whenever page 1 returned anything;
			// loadMore() flips hasMore off once a page stops growing.
			page = 1;
			hasMore = results.length > 0;
			persistSession(); // D-02: store the fresh set (overwrites the prior session)
		} catch {
			results = [];
			hasMore = false;
		} finally {
			loading = false;
		}
	}

	async function loadMore() {
		// Guards: no concurrent batch, no firing during initial search, past the end,
		// or before any search has run.
		if (loadingMore || loading || !hasMore || !searched) return;
		const kw = q.trim(); // capture BEFORE awaiting (race guard)
		if (!kw) return;
		loadingMore = true;
		const next = page + 1;
		moreAc?.abort();
		moreAc = new AbortController();
		try {
			const { interleaved } = await searchAll(kw, next, {}, moreAc.signal);
			const merged = dedupeBest(interleaved, settings.preferredSource);
			// Race guard: user searched something else mid-fetch — bail without touching state.
			if (kw !== q.trim()) return;
			if (merged.length <= results.length) {
				// Sources exhausted: no net-new unique tracks.
				hasMore = false;
			} else {
				// REPLACE with the cumulative superset (never concatenate — see pagination_mechanism).
				results = merged;
				page = next;
				persistSession(); // D-02: keep the session fresh so a mid-scroll nav restores the larger set
			}
		} catch (err) {
			// AbortError = a newer request superseded this one: do nothing.
			if (err instanceof DOMException && err.name === 'AbortError') return;
			// Any other failure: stop hammering a failing source.
			hasMore = false;
		} finally {
			loadingMore = false;
		}
	}

	// D-02 + D-05: hydrate search history; restore a prior in-session search INSTANTLY
	// (no refetch) including scroll, after results paint.
	onMount(async () => {
		searchHistory.load();
		if (searchSession.hasPrior) {
			q = searchSession.q;
			results = searchSession.results;
			page = searchSession.page;
			hasMore = searchSession.hasMore;
			searched = searchSession.searched;
			// Restore scroll AFTER the {#each results} renders so the document has height
			// (the WINDOW scrolls — see the IO root:null below). Pitfall 6.
			await tick();
			window.scrollTo(0, searchSession.scrollY);
		}
	});

	// D-02: on navigate-away, capture the live set + current scroll so a tab return restores it.
	onDestroy(() => {
		io?.disconnect();
		if (searched && typeof window !== 'undefined') {
			persistSession();
			searchSession.setScroll(window.scrollY);
		}
	});

	// Create / tear down the IntersectionObserver whenever the sentinel mounts or
	// changes. root:null = the viewport because the WINDOW scrolls (see reuse_note);
	// rootMargin prefetches the next batch slightly before the true bottom.
	$effect(() => {
		const el = sentinelEl;
		if (!el) return;
		io?.disconnect();
		io = new IntersectionObserver(
			(entries) => {
				if (entries[0]?.isIntersecting) loadMore();
			},
			{ root: null, rootMargin: '400px 0px' }
		);
		io.observe(el);
		return () => io?.disconnect();
	});
</script>

<header class="head"><h1>{t('search.title')}</h1></header>

<form class="bar" onsubmit={run}>
	<input
		bind:value={q}
		placeholder={t('search.placeholder')}
		autocomplete="off"
		autocapitalize="off"
		onfocus={() => (inputFocused = true)}
		onblur={() => {
			// Delay closing so a suggestion tap (mousedown→click) registers before blur
			// hides the list. The suggestion buttons also preventDefault on mousedown so
			// focus never leaves the input on tap (belt-and-braces).
			setTimeout(() => (inputFocused = false), 150);
		}}
	/>
	<button type="submit" disabled={loading}>{loading ? t('search.submitting') : t('search.go')}</button>
</form>

<!-- D-05: tappable past-search suggestions in the idle pre-query state. -->
{#if inputFocused && q.trim() === '' && !searched && searchHistory.entries.length > 0}
	<div class="suggest">
		<div class="suggest-head">
			<span class="suggest-title">{t('search.recent')}</span>
			<button type="button" class="suggest-clear" onmousedown={(e) => e.preventDefault()} onclick={() => searchHistory.clear()}>
				{t('search.clear')}
			</button>
		</div>
		<ul class="list">
			{#each searchHistory.entries as entry (entry.query)}
				<li>
					<button
						type="button"
						class="row suggest-row"
						onmousedown={(e) => e.preventDefault()}
						onclick={() => {
							q = entry.query;
							inputFocused = false;
							run();
						}}
					>
						<span class="suggest-q">{entry.query}</span>
					</button>
				</li>
			{/each}
		</ul>
	</div>
{/if}

{#if someFailed}
	<p class="warn">{t('search.someFailed')}</p>
{/if}

<!-- ONE skeleton-row definition shared by the D-01 first-load gate and the existing
     load-more position (no second skeleton style). Reduce-motion handled by .skel CSS. -->
{#snippet skeletonRows(count: number, label: string)}
	<li class="skel-wrap" aria-label={label}>
		<span class="vh">{label}</span>
		{#each Array(count) as _, i (i)}
			<span class="row skel" aria-hidden="true">
				<span class="art"></span>
				<span class="meta">
					<span class="bar bar-title"></span>
					<span class="bar bar-artist"></span>
				</span>
			</span>
		{/each}
	</li>
{/snippet}

{#if loading && results.length === 0}
	<!-- D-01: first-load skeleton (gated on no results yet); yields to the first D-06 partial. -->
	<ul class="list">
		{@render skeletonRows(6, t('search.searching'))}
	</ul>
{:else if searched && !loading && results.length === 0}
	<p class="muted">{t('search.empty')}</p>
{:else}
	<ul class="list">
		{#each results as t (t.uid)}
			<li>
				<button class="row" use:longpress onlongpress={() => { menuTrack = t; menuOpen = true; }} onclick={() => { player.setQueue(results); player.play(t); }}>
					<span class="art" style:background-image={t.cover ? `url(${t.cover})` : fallbackCover(t)}></span>
					<span class="meta">
						<span class="r-title">{names.dnTitle(t.title)}</span>
						<span class="r-artist">{names.dnArtist(t.artist)}</span>
					</span>
				</button>
			</li>
		{/each}

		{#if loadingMore}
			{@render skeletonRows(4, t('search.loadingMore'))}
		{/if}

		{#if hasMore}
			<li class="sentinel" bind:this={sentinelEl}></li>
		{/if}
	</ul>
{/if}

<TrackMenu track={menuTrack} open={menuOpen} onclose={() => (menuOpen = false)} />

<style>
	.head h1 { font-size: 1.4rem; margin: 16px 0 12px; }
	.bar { display: flex; gap: 8px; margin-bottom: 14px; }
	.bar input {
		flex: 1; background: var(--color-surface-2); border: 1px solid var(--color-border);
		color: var(--color-text); border-radius: 12px; padding: 12px 14px; font-size: 15px; outline: none;
	}
	.bar input:focus { border-color: var(--color-primary); }
	.bar button {
		background: var(--color-primary); border: none; color: #fff; border-radius: 12px;
		padding: 0 18px; font-weight: 700; cursor: pointer;
	}
	.muted { color: var(--color-text-muted); font-size: 14px; }
	.warn { color: #ffcf66; font-size: 12px; margin: 0 0 10px; }

	/* --- D-05 past-search suggestions --- */
	.suggest { margin-bottom: 14px; }
	.suggest-head {
		display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;
	}
	.suggest-title { font-size: 12px; font-weight: 700; color: var(--color-text-muted); letter-spacing: 0.02em; }
	.suggest-clear {
		background: none; border: none; color: var(--color-primary); font-size: 12px; font-weight: 600;
		cursor: pointer; padding: 4px 6px; border-radius: 8px;
	}
	.suggest-clear:hover { background: var(--color-surface); }
	.suggest-row { padding: 10px 8px; }
	.suggest-q {
		font-size: 14px; color: var(--color-text);
		white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
	}

	.list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
	.row {
		width: 100%; display: flex; align-items: center; gap: 12px; padding: 8px; background: none;
		border: none; border-radius: 10px; cursor: pointer; text-align: left; transition: background 0.12s ease;
	}
	.row:hover { background: var(--color-surface); }
	.art { width: 48px; height: 48px; border-radius: 8px; background-size: cover; background-position: center; flex: none; }
	.meta { flex: 1; min-width: 0; display: flex; flex-direction: column; }
	.r-title { font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.r-artist { font-size: 12px; color: var(--color-text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

	/* --- infinite-scroll loading state --- */
	.sentinel { height: 1px; margin: 0; padding: 0; list-style: none; }
	.skel-wrap { display: flex; flex-direction: column; gap: 6px; list-style: none; }
	/* Skeleton row mirrors .row sizing so placeholders line up with real rows. */
	.skel { pointer-events: none; }
	.skel .art { background: var(--color-surface-2); }
	.skel .meta { gap: 7px; }
	.skel .bar { display: block; height: 11px; border-radius: 5px; background: var(--color-surface-2); }
	.skel .bar-title { width: 62%; }
	.skel .bar-artist { width: 40%; height: 9px; }
	.skel .art, .skel .bar {
		position: relative; overflow: hidden;
	}
	.skel .art::after, .skel .bar::after {
		content: ''; position: absolute; inset: 0;
		background: linear-gradient(
			90deg,
			transparent 0%,
			rgba(255, 255, 255, 0.08) 50%,
			transparent 100%
		);
		transform: translateX(-100%);
		animation: skel-shimmer 1.2s ease-in-out infinite;
	}
	@keyframes skel-shimmer {
		100% { transform: translateX(100%); }
	}
	/* Disable shimmer for users who prefer reduced motion. */
	@media (prefers-reduced-motion: reduce) {
		.skel .art::after, .skel .bar::after { animation: none; }
	}
	/* Visually-hidden screen-reader cue for the skeleton container. */
	.vh {
		position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
		overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
	}
</style>
