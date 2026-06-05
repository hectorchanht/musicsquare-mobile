<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { searchAll } from '$lib/services/catalog';
	import { player } from '$lib/stores/player.svelte';
	import type { SourceId, Track } from '$lib/sources/types';

	const SRC_LABEL: Record<SourceId, string> = { netease: 'NetEase', qq: 'QQ', kuwo: 'Kuwo', joox: 'JOOX' };
	const SRC_COLOR: Record<SourceId, string> = {
		netease: 'var(--src-netease)',
		qq: 'var(--src-qq)',
		kuwo: 'var(--src-kuwo)',
		joox: 'var(--src-joox)'
	};
	// Top picks = one hit from each of N DISTINCT artists (not one keyword).
	const ARTIST_POOL = [
		'周杰伦', '邓紫棋', '林俊杰', '陈奕迅', '五月天', '李荣浩', '张惠妹', '王菲', '周深', '李宗盛',
		'Taylor Swift', 'Ed Sheeran', 'Lana Del Rey', 'Bruno Mars', 'Adele', 'The Weeknd', 'Billie Eilish', 'Coldplay', 'Maroon 5', 'Dua Lipa'
	];
	const PICK_COUNT = 9;
	const CACHE_KEY = 'musicsquare:top-picks:v1';

	let songs = $state<Track[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);

	function fallbackCover(t: Track): string {
		const h = (t.uid.split('').reduce((a, c) => a + c.charCodeAt(0), 0) * 47) % 360;
		return `linear-gradient(145deg, hsl(${h} 55% 32%), hsl(${(h + 40) % 360} 55% 18%))`;
	}

	function sample<T>(arr: T[], n: number): T[] {
		const a = [...arr];
		for (let i = a.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[a[i], a[j]] = [a[j], a[i]];
		}
		return a.slice(0, n);
	}

	// Fan out across N random artists, take each artist's top result → diverse grid.
	async function buildPicks(): Promise<Track[]> {
		const artists = sample(ARTIST_POOL, PICK_COUNT);
		const results = await Promise.allSettled(artists.map((a) => searchAll(a, 1)));
		const picks: Track[] = [];
		const seen = new Set<string>();
		for (const r of results) {
			if (r.status !== 'fulfilled') continue;
			const top = r.value.interleaved[0];
			if (top && !seen.has(top.uid)) {
				seen.add(top.uid);
				picks.push(top);
			}
		}
		return picks;
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
			const picks = await buildPicks();
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
		// Instant render from localStorage; only hit the network on a cold cache.
		const cached = loadCache();
		if (cached) {
			songs = cached;
			player.setQueue(cached);
			loading = false;
		} else {
			refresh();
		}
	});
</script>

<header class="topnav">
	<div class="brand"><span class="dot">♪</span> MusicSquare</div>
</header>

<button class="searchpill" onclick={() => goto('/search')}>
	🔍 <span>Search songs, artists across all sources</span>
</button>

<section class="section">
	<div class="head">
		<h2>Top picks</h2>
		<button class="more" onclick={refresh} disabled={loading}>{loading ? '…' : '↻ Randomize'}</button>
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
					<span class="src" style:background={SRC_COLOR[t.source]}>{SRC_LABEL[t.source]}</span>
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
		width: 24px; height: 24px; border-radius: 50%;
		background: var(--color-primary); display: grid; place-items: center; font-size: 14px;
	}
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
	.src { position: absolute; top: 6px; left: 6px; font-size: 8.5px; font-weight: 800; letter-spacing: 0.3px; padding: 2px 6px; border-radius: 999px; color: #fff; text-transform: uppercase; }
	.q { position: absolute; top: 6px; right: 6px; font-size: 8px; font-weight: 700; padding: 2px 5px; border-radius: 4px; background: rgba(0,0,0,0.55); color: #fff; }
	.error { color: #ff7a90; font-size: 14px; }
</style>
