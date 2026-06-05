<script lang="ts">
	// Album page. DATA CONSTRAINT: no real album API — DERIVED from searchAll(albumName).
	import { page } from '$app/state';
	import { ChevronLeft, Play } from '@lucide/svelte';
	import { searchAll } from '$lib/services/catalog';
	import { dedupeBest } from '$lib/services/dedupe';
	import { settings } from '$lib/stores/settings.svelte';
	import { player } from '$lib/stores/player.svelte';
	import { names } from '$lib/stores/names.svelte';
	import { longpress } from '$lib/actions/longpress';
	import TrackMenu from '$lib/components/TrackMenu.svelte';
	import { goto } from '$app/navigation';
	import type { Track } from '$lib/sources/types';

	let menuTrack = $state<Track | null>(null);
	let menuOpen = $state(false);

	const name = $derived(decodeURIComponent(page.params.name ?? ''));
	let tracks = $state<Track[]>([]);
	let loading = $state(true);
	let loadedFor = '';

	function fallbackCover(t: Track): string {
		const h = (t.uid.split('').reduce((a, c) => a + c.charCodeAt(0), 0) * 47) % 360;
		return `linear-gradient(145deg, hsl(${h} 55% 32%), hsl(${(h + 40) % 360} 55% 18%))`;
	}
	const hero = $derived(tracks.find((t) => t.cover)?.cover ?? null);

	$effect(() => {
		const n = name;
		if (n && loadedFor !== n) {
			loadedFor = n;
			loading = true;
			tracks = [];
			searchAll(n, 1)
				.then((r) => {
					const all = dedupeBest(r.interleaved, settings.preferredSource);
					// prefer exact-album matches; fall back to all results for the query
					const exact = all.filter((t) => (t.album || '').trim() === n);
					tracks = exact.length ? exact : all;
				})
				.catch(() => (tracks = []))
				.finally(() => (loading = false));
		}
	});
</script>

<svelte:head><title>{name} · openmusic</title></svelte:head>

<header class="hero">
	<button class="back" aria-label="Back" onclick={() => goto('/')}><ChevronLeft size={22} /></button>
	<div class="cover" style:background-image={hero ? `url(${hero})` : 'linear-gradient(145deg,#3a2d63,#1a1326)'}></div>
	<h1>{names.dn(name)}</h1>
	<p class="note">Album · {tracks.length} tracks (derived from search)</p>
</header>

{#if loading}
	<p class="muted">Loading album…</p>
{:else if tracks.length}
	<ul class="list">
		{#each tracks as t, i (t.uid)}
			<li>
				<button class="row" use:longpress onlongpress={() => { menuTrack = t; menuOpen = true; }} onclick={() => { player.setQueue(tracks); player.play(t); }}>
					<span class="rank">{i + 1}</span>
					<span class="art" style:background-image={t.cover ? `url(${t.cover})` : fallbackCover(t)}></span>
					<span class="meta"><span class="r-title">{names.dn(t.title)}</span><span class="r-sub">{names.dn(t.artist)}</span></span>
					<Play size={16} />
				</button>
			</li>
		{/each}
	</ul>
{:else}
	<p class="muted">No tracks found for “{name}”.</p>
{/if}

<TrackMenu track={menuTrack} open={menuOpen} onclose={() => (menuOpen = false)} />

<style>
	.hero { padding: 14px 0 18px; text-align: center; position: relative; }
	.back { position: absolute; left: 0; top: 8px; background: none; border: none; color: var(--color-text); cursor: pointer; display: grid; place-items: center; width: 36px; height: 36px; }
	.cover { width: 160px; height: 160px; border-radius: 12px; margin: 8px auto 12px; background-size: cover; background-position: center; box-shadow: 0 12px 34px rgba(0,0,0,0.5); }
	.hero h1 { font-size: 1.5rem; margin: 0; }
	.note { color: var(--color-text-muted); font-size: 12px; margin-top: 4px; }
	.muted { color: var(--color-text-muted); font-size: 14px; }
	.list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
	.row { width: 100%; text-align: left; background: none; border: none; padding: 6px; border-radius: 8px; cursor: pointer; display: flex; align-items: center; gap: 12px; color: var(--color-text); }
	.row:hover { background: var(--color-surface); }
	.rank { width: 18px; text-align: center; color: var(--color-text-muted); font-size: 13px; flex: none; }
	.art { width: 44px; height: 44px; border-radius: 6px; background-size: cover; background-position: center; flex: none; }
	.meta { display: flex; flex-direction: column; min-width: 0; flex: 1; }
	.r-title { font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.r-sub { font-size: 12px; color: var(--color-text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>
