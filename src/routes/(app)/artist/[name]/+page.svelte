<script lang="ts">
	// Artist page. DATA CONSTRAINT: the source adapters expose only search + detail
	// (no real artist/album API). So this is DERIVED: searchAll(artistName) →
	// "Hit songs" = the result list; "Albums" = results grouped by track.album.
	// Not a true artist catalog — an approximation from cross-source search.
	import { page } from '$app/state';
	import { searchAll } from '$lib/services/catalog';
	import { dedupeBest } from '$lib/services/dedupe';
	import { settings } from '$lib/stores/settings.svelte';
	import { player } from '$lib/stores/player.svelte';
	import { names } from '$lib/stores/names.svelte';
	import { longpress } from '$lib/actions/longpress';
	import TrackMenu from '$lib/components/TrackMenu.svelte';

	let menuTrack = $state<Track | null>(null);
	let menuOpen = $state(false);
	import type { Track } from '$lib/sources/types';

	const name = $derived(decodeURIComponent(page.params.name ?? ''));

	let songs = $state<Track[]>([]);
	let loading = $state(true);
	let loadedFor = '';

	function fallbackCover(t: Track): string {
		const h = (t.uid.split('').reduce((a, c) => a + c.charCodeAt(0), 0) * 47) % 360;
		return `linear-gradient(145deg, hsl(${h} 55% 32%), hsl(${(h + 40) % 360} 55% 18%))`;
	}

	type Album = { name: string; cover: string | null; tracks: Track[] };
	const albums = $derived.by<Album[]>(() => {
		const map = new Map<string, Album>();
		for (const t of songs) {
			const a = (t.album || '').trim();
			if (!a) continue;
			if (!map.has(a)) map.set(a, { name: a, cover: t.cover, tracks: [] });
			const al = map.get(a)!;
			al.tracks.push(t);
			if (!al.cover && t.cover) al.cover = t.cover;
		}
		return [...map.values()].sort((x, y) => y.tracks.length - x.tracks.length);
	});
	const hero = $derived(songs.find((t) => t.cover)?.cover ?? null);

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
</script>

<svelte:head><title>{name} · MusicSquare</title></svelte:head>

<header class="hero">
	<a class="back" href="/">‹ Back</a>
	<div class="herocover" style:background-image={hero ? `url(${hero})` : 'linear-gradient(145deg,#3a2d63,#1a1326)'}></div>
	<h1>{names.dn(name)}</h1>
	<p class="note">Derived from cross-source search · {songs.length} tracks</p>
</header>

{#if loading}
	<p class="muted">Loading {name}…</p>
{:else}
	{#if albums.length}
		<section>
			<h2>Albums</h2>
			<div class="albumrow">
				{#each albums as al (al.name)}
					<button class="album" onclick={() => { player.setQueue(al.tracks); player.play(al.tracks[0]); }}>
						<span class="al-cover" style:background-image={al.cover ? `url(${al.cover})` : fallbackCover(al.tracks[0])}></span>
						<span class="al-name">{names.dn(al.name)}</span>
						<span class="al-count">{al.tracks.length} track{al.tracks.length > 1 ? 's' : ''}</span>
					</button>
				{/each}
			</div>
		</section>
	{/if}

	<section>
		<h2>Hit songs</h2>
		{#if songs.length}
			<ul class="list">
				{#each songs.slice(0, 30) as t, i (t.uid)}
					<li>
						<button class="row" use:longpress onlongpress={() => { menuTrack = t; menuOpen = true; }} onclick={() => { player.setQueue(songs); player.play(t); }}>
							<span class="rank">{i + 1}</span>
							<span class="art" style:background-image={t.cover ? `url(${t.cover})` : fallbackCover(t)}></span>
							<span class="meta"><span class="r-title">{names.dn(t.title)}</span><span class="r-sub">{names.dn(t.album || t.artist)}</span></span>
						</button>
					</li>
				{/each}
			</ul>
		{:else}<p class="muted">No songs found for {name}.</p>{/if}
	</section>
{/if}

<TrackMenu track={menuTrack} open={menuOpen} onclose={() => (menuOpen = false)} />

<style>
	.hero { padding: 14px 0 18px; text-align: center; }
	.back { display: block; text-align: left; color: var(--color-text-muted); font-size: 14px; margin-bottom: 8px; }
	.herocover { width: 150px; height: 150px; border-radius: 50%; margin: 8px auto 12px; background-size: cover; background-position: center; box-shadow: 0 12px 34px rgba(0,0,0,0.5); }
	.hero h1 { font-size: 1.7rem; margin: 0; }
	.note { color: var(--color-text-muted); font-size: 12px; margin-top: 4px; }
	section { margin: 18px 0; }
	section h2 { font-size: 1.1rem; margin: 0 0 12px; }
	.albumrow { display: flex; gap: 12px; overflow-x: auto; padding-bottom: 4px; }
	.album { flex: 0 0 130px; background: none; border: none; padding: 0; cursor: pointer; text-align: left; display: flex; flex-direction: column; gap: 4px; }
	.al-cover { width: 130px; height: 130px; border-radius: 10px; background-size: cover; background-position: center; }
	.al-name { font-size: 12px; font-weight: 600; color: var(--color-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.al-count { font-size: 11px; color: var(--color-text-muted); }
	.list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
	.row { width: 100%; text-align: left; background: none; border: none; padding: 6px; border-radius: 8px; cursor: pointer; display: flex; align-items: center; gap: 12px; }
	.row:hover { background: var(--color-surface); }
	.rank { width: 18px; text-align: center; color: var(--color-text-muted); font-size: 13px; flex: none; }
	.art { width: 44px; height: 44px; border-radius: 6px; background-size: cover; background-position: center; flex: none; }
	.meta { display: flex; flex-direction: column; min-width: 0; }
	.r-title { font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.r-sub { font-size: 12px; color: var(--color-text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.muted { color: var(--color-text-muted); font-size: 14px; }
</style>
