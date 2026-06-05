<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { ChevronLeft, Trash2, RefreshCw, Globe, Info } from '@lucide/svelte';
	import { library } from '$lib/stores/library.svelte';

	const TOP_PICKS_KEY = 'musicsquare:top-picks:v1';
	let msg = $state('');
	let counts = $state({ liked: 0, playlists: 0, downloads: 0 });

	function refreshCounts() {
		counts = {
			liked: library.liked.length,
			playlists: library.playlists.length,
			downloads: library.downloads.length
		};
	}
	onMount(() => {
		library.load();
		refreshCounts();
	});

	function flash(m: string) {
		msg = m;
		setTimeout(() => (msg = ''), 1800);
	}
	function clearPicks() {
		try {
			localStorage.removeItem(TOP_PICKS_KEY);
		} catch {
			/* ignore */
		}
		flash('Cached top picks cleared — Home will refetch.');
	}
	function clearLibrary() {
		if (confirm('Clear all liked songs, playlists and downloads?')) {
			library.clearAll();
			refreshCounts();
			flash('Library cleared.');
		}
	}
</script>

<svelte:head><title>Settings · openmusic</title></svelte:head>

<header class="head">
	<button class="back" aria-label="Back" onclick={() => goto('/')}><ChevronLeft size={22} /></button>
	<h1>Settings</h1>
</header>

<section>
	<h2>Library</h2>
	<p class="muted">{counts.liked} liked · {counts.playlists} playlists · {counts.downloads} downloads</p>
	<button class="item danger" onclick={clearLibrary}><Trash2 size={18} /> Clear library</button>
</section>

<section>
	<h2>Data</h2>
	<button class="item" onclick={clearPicks}><RefreshCw size={18} /> Clear cached top picks</button>
</section>

<section>
	<h2>Language</h2>
	<div class="item static"><Globe size={18} /> 中文 / English — coming soon</div>
</section>

<section>
	<h2>About</h2>
	<div class="item static"><Info size={18} /> openmusic · demo build · streams from public music sources</div>
</section>

{#if msg}<p class="flash">{msg}</p>{/if}

<style>
	.head { display: flex; align-items: center; gap: 8px; padding: 14px 0 12px; }
	.back { background: none; border: none; color: var(--color-text); cursor: pointer; display: grid; place-items: center; width: 36px; height: 36px; }
	.head h1 { font-size: 1.4rem; margin: 0; }
	section { margin: 18px 0; }
	section h2 { font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.5px; color: var(--color-text-muted); margin: 0 0 8px; }
	.muted { color: var(--color-text-muted); font-size: 13px; margin: 0 0 8px; }
	.item { width: 100%; display: flex; align-items: center; gap: 12px; background: var(--color-surface-2); border: 1px solid var(--color-border); color: var(--color-text); padding: 14px; border-radius: 12px; font-size: 15px; cursor: pointer; text-align: left; }
	.item.static { cursor: default; color: var(--color-text-muted); font-size: 13px; }
	.item.danger { color: #ff7a90; }
	.flash { position: fixed; left: 50%; transform: translateX(-50%); bottom: calc(var(--tabbar-h) + 70px); background: #000; color: #fff; padding: 10px 16px; border-radius: 999px; font-size: 13px; }
</style>
