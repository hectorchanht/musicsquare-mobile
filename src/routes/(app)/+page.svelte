<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { Music2, Search, Settings, RotateCw } from '@lucide/svelte';
	import { buildDiversePicks } from '$lib/services/picks';
	import { decodeTrack } from '$lib/services/share';
	import { player } from '$lib/stores/player.svelte';
	import type { Track } from '$lib/sources/types';

	const PICK_COUNT = 9;
	const CACHE_KEY = 'musicsquare:top-picks:v1';

	let songs = $state<Track[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);

	function fallbackCover(t: Track): string {
		const h = (t.uid.split('').reduce((a, c) => a + c.charCodeAt(0), 0) * 47) % 360;
		return `linear-gradient(145deg, hsl(${h} 55% 32%), hsl(${(h + 40) % 360} 55% 18%))`;
	}

	// localStorage is browser-only; these run inside onMount / click handlers (never SSR).
	function saveCache(list: Track[]) {
		try {
			localStorage.setItem(CACHE_KEY, JSON.stringify(list));
		} catch {
			/* quota or unavailable — non-fatal */
		}
	}
	function loadCache(): Track[] | null {
		try {
			const raw = localStorage.getItem(CACHE_KEY);
			if (!raw) return null;
			const v: unknown = JSON.parse(raw);
			return Array.isArray(v) && v.length ? (v as Track[]) : null;
		} catch {
			return null;
		}
	}

	// Fetch a fresh diverse set, cache it, seed the queue. Used by Randomize + cold start.
	async function refresh() {
		loading = true;
		error = null;
		try {
			const picks = await buildDiversePicks(PICK_COUNT);
			if (picks.length) {
				songs = picks;
				saveCache(picks);
				player.setQueue(picks);
			} else {
				error = 'no results — sources may be unavailable';
			}
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		// Shared link: /?play=<token> → reconstruct the track stub and play it.
		const token = new URLSearchParams(location.search).get('play');
		if (token) {
			const t = decodeTrack(token);
			if (t) {
				player.setQueue([t]);
				player.play(t);
			}
			history.replaceState(null, '', location.pathname); // clear the param
		}
		// Instant render from localStorage; only hit the network on a cold cache.
		const cached = loadCache();
		if (cached) {
			songs = cached;
			if (!token) player.setQueue(cached);
			loading = false;
		} else if (!token) {
			refresh();
		} else {
			loading = false;
		}
	});
</script>

<header class="topnav">
	<div class="brand"><span class="dot"><Music2 size={15} /></span> openmusic</div>
	<button class="gear" aria-label="Settings" onclick={() => goto('/settings')}><Settings size={20} /></button>
</header>

<button class="searchpill" onclick={() => goto('/search')}>
	<Search size={16} /> <span>Search songs, artists across all sources</span>
</button>

<section class="section">
	<div class="head">
		<h2>Top picks</h2>
		<button class="more" onclick={refresh} disabled={loading}><RotateCw size={13} /> {loading ? 'Loading…' : 'Randomize'}</button>
	</div>

	{#if loading}
		<div class="grid">
			{#each Array(9) as _, i (i)}<div class="tile skeleton"></div>{/each}
		</div>
	{:else if error}
		<p class="error">{error} — <button class="retry" onclick={refresh}>retry</button></p>
	{:else}
		<div class="grid">
			{#each songs as t (t.uid)}
				<button class="tile" onclick={() => { player.setQueue(songs); player.play(t); }}>
					<div class="art" style:background-image={t.cover ? `url(${t.cover})` : fallbackCover(t)}></div>
					{#if t.qualityLabel || t.quality}<span class="q">{t.qualityLabel ?? t.quality}</span>{/if}
					<div class="scrim"></div>
					<div class="label">
						<div class="t-title">{t.title}</div>
						<div class="t-artist">{t.artist}</div>
					</div>
				</button>
			{/each}
		</div>
	{/if}
</section>

<style>
	.topnav { display: flex; align-items: center; justify-content: space-between; padding: 14px 0 10px; }
	.brand { display: flex; align-items: center; gap: 8px; font-weight: 800; font-size: 1.35rem; }
	.brand .dot {
		width: 26px; height: 26px; border-radius: 50%;
		background: var(--color-primary); color: #fff; display: grid; place-items: center;
	}
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
	.more, .retry {
		background: none; border: 1px solid var(--color-border); color: var(--color-text-muted);
		padding: 5px 12px; border-radius: 999px; font-size: 12px; cursor: pointer;
		display: inline-flex; align-items: center; gap: 5px;
	}
	.grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
	.tile {
		position: relative; aspect-ratio: 1 / 1; border-radius: var(--radius-md);
		overflow: hidden; cursor: pointer; border: none; padding: 0; background: var(--color-surface-2);
		transition: transform 0.12s ease;
	}
	.tile:active { transform: scale(0.96); }
	.tile.skeleton { background: linear-gradient(110deg, #1a1a22 30%, #24242f 50%, #1a1a22 70%); background-size: 200% 100%; animation: sk 1.2s infinite; cursor: default; }
	@keyframes sk { to { background-position: -200% 0; } }
	.art { position: absolute; inset: 0; background-size: cover; background-position: center; }
	.scrim { position: absolute; inset: 0; background: linear-gradient(to top, rgba(0,0,0,0.8) 0%, rgba(0,0,0,0) 55%); }
	.label { position: absolute; left: 7px; right: 7px; bottom: 6px; text-align: left; }
	.t-title { font-size: 11px; font-weight: 700; line-height: 1.2; color: #fff; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
	.t-artist { font-size: 10px; color: #d8d8de; margin-top: 2px; opacity: 0.85; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.q { position: absolute; top: 6px; right: 6px; font-size: 8px; font-weight: 700; padding: 2px 5px; border-radius: 4px; background: rgba(0,0,0,0.55); color: #fff; }
	.error { color: #ff7a90; font-size: 14px; }
</style>
