<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { ChevronLeft, Languages, Replace, Music, Radio, Palette, Zap, Maximize2, Trash2, RefreshCw, Info } from '@lucide/svelte';
	import { settings, ACCENT_PRESETS, type LyricsLang, type TranslateMode, type DefaultQuality, type DefaultSource } from '$lib/stores/settings.svelte';
	import { library } from '$lib/stores/library.svelte';

	const TOP_PICKS_KEY = 'musicsquare:top-picks:v1';
	let msg = $state('');
	let counts = $state({ liked: 0, playlists: 0, downloads: 0 });

	onMount(() => {
		settings.load();
		library.load();
		counts = { liked: library.liked.length, playlists: library.playlists.length, downloads: library.downloads.length };
	});

	function flash(m: string) { msg = m; setTimeout(() => (msg = ''), 1800); }
	const langs: { v: LyricsLang; label: string }[] = [
		{ v: 'off', label: 'Off' },
		{ v: 'zh-Hant', label: '繁體中文' },
		{ v: 'zh-Hans', label: '简体中文' },
		{ v: 'en', label: 'English' },
		{ v: 'ja', label: '日本語' },
		{ v: 'ko', label: '한국어' }
	];
	const modes: { v: TranslateMode; label: string }[] = [
		{ v: 'below', label: 'Show below' },
		{ v: 'replace', label: 'Replace' }
	];
	const qualities: { v: DefaultQuality; label: string }[] = [
		{ v: 'auto', label: 'Auto' },
		{ v: 'lossless', label: 'Lossless' },
		{ v: '320', label: '320k' },
		{ v: '128', label: '128k' }
	];
	const sources: { v: DefaultSource; label: string }[] = [
		{ v: 'auto', label: 'Auto (all)' },
		{ v: 'netease', label: 'NetEase' },
		{ v: 'qq', label: 'QQ' },
		{ v: 'kuwo', label: 'Kuwo' },
		{ v: 'joox', label: 'JOOX' }
	];

	function setLang(v: LyricsLang) { settings.lyricsLang = v; settings.save(); }
	function setMode(v: TranslateMode) { settings.translateMode = v; settings.save(); }
	function setQuality(v: DefaultQuality) { settings.defaultQuality = v; settings.save(); }
	function setSource(v: DefaultSource) { settings.defaultSource = v; settings.save(); }
	function setAccent(hex: string) { settings.accent = hex; settings.save(); }
	function toggleMotion() { settings.reduceMotion = !settings.reduceMotion; settings.save(); }
	function toggleExpand() { settings.autoExpandOnPlay = !settings.autoExpandOnPlay; settings.save(); }

	function clearPicks() { try { localStorage.removeItem(TOP_PICKS_KEY); } catch { /* */ } flash('Cached top picks cleared.'); }
	function clearLibrary() {
		if (confirm('Clear all liked songs, playlists and downloads?')) {
			library.clearAll();
			counts = { liked: 0, playlists: 0, downloads: 0 };
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
	<h2><Languages size={15} /> Lyrics translation</h2>
	<div class="chips">
		{#each langs as l (l.v)}
			<button class="chip" class:on={settings.lyricsLang === l.v} onclick={() => setLang(l.v)}>{l.label}</button>
		{/each}
	</div>
</section>

<section>
	<h2><Replace size={15} /> Translate mode</h2>
	<div class="seg" class:disabled={settings.lyricsLang === 'off'}>
		{#each modes as m (m.v)}
			<button class:on={settings.translateMode === m.v} disabled={settings.lyricsLang === 'off'} onclick={() => setMode(m.v)}>{m.label}</button>
		{/each}
	</div>
	<p class="muted">{settings.lyricsLang === 'off' ? 'Pick a language above to enable.' : 'Translation uses an online service; quality varies.'}</p>
</section>

<section>
	<h2><Music size={15} /> Default song quality</h2>
	<div class="seg">
		{#each qualities as q (q.v)}
			<button class:on={settings.defaultQuality === q.v} onclick={() => setQuality(q.v)}>{q.label}</button>
		{/each}
	</div>
	<p class="muted">Best-effort — sources don't all expose bitrate; biases selection where known.</p>
</section>

<section>
	<h2><Radio size={15} /> Default music source</h2>
	<div class="chips">
		{#each sources as s (s.v)}
			<button class="chip" class:on={settings.defaultSource === s.v} onclick={() => setSource(s.v)}>{s.label}</button>
		{/each}
	</div>
	<p class="muted">Preferred source wins when the same song appears on several.</p>
</section>

<section>
	<h2><Palette size={15} /> Accent color</h2>
	<div class="swatches">
		{#each ACCENT_PRESETS as c (c)}
			<button class="swatch" class:on={settings.accent === c} style:background={c} aria-label={c} onclick={() => setAccent(c)}></button>
		{/each}
	</div>
</section>

<section>
	<h2><Zap size={15} /> Playback &amp; motion</h2>
	<button class="row-toggle" onclick={toggleExpand}>
		<span><Maximize2 size={16} /> Auto-expand now-playing on play</span>
		<span class="sw" class:on={settings.autoExpandOnPlay}></span>
	</button>
	<button class="row-toggle" onclick={toggleMotion}>
		<span><Zap size={16} /> Reduce motion</span>
		<span class="sw" class:on={settings.reduceMotion}></span>
	</button>
</section>

<section>
	<h2>Data</h2>
	<p class="muted">{counts.liked} liked · {counts.playlists} playlists · {counts.downloads} downloads</p>
	<button class="item" onclick={clearPicks}><RefreshCw size={18} /> Clear cached top picks</button>
	<button class="item danger" onclick={clearLibrary}><Trash2 size={18} /> Clear library</button>
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
	section h2 { display: flex; align-items: center; gap: 6px; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.5px; color: var(--color-text-muted); margin: 0 0 10px; }
	.muted { color: var(--color-text-muted); font-size: 12px; margin: 8px 0 0; }
	.chips { display: flex; flex-wrap: wrap; gap: 8px; }
	.chip { background: var(--color-surface-2); border: 1px solid var(--color-border); color: var(--color-text); padding: 8px 14px; border-radius: 999px; font-size: 13px; cursor: pointer; }
	.chip.on { background: var(--color-primary); color: #fff; border-color: transparent; }
	.seg { display: inline-flex; background: var(--color-surface-2); border: 1px solid var(--color-border); border-radius: 999px; padding: 3px; gap: 3px; }
	.seg.disabled { opacity: 0.5; }
	.seg button { background: none; border: none; color: var(--color-text-muted); padding: 7px 16px; border-radius: 999px; font-size: 13px; cursor: pointer; }
	.seg button.on { background: var(--color-primary); color: #fff; }
	.swatches { display: flex; gap: 12px; }
	.swatch { width: 34px; height: 34px; border-radius: 50%; border: 2px solid transparent; cursor: pointer; }
	.swatch.on { border-color: #fff; box-shadow: 0 0 0 2px var(--color-bg), 0 0 0 4px currentColor; }
	.row-toggle { width: 100%; display: flex; align-items: center; justify-content: space-between; background: var(--color-surface-2); border: 1px solid var(--color-border); color: var(--color-text); padding: 13px 14px; border-radius: 12px; font-size: 14px; cursor: pointer; margin-bottom: 8px; }
	.row-toggle span:first-child { display: inline-flex; align-items: center; gap: 10px; }
	.sw { width: 40px; height: 22px; border-radius: 999px; background: var(--color-border); position: relative; transition: background 0.15s ease; flex: none; }
	.sw::after { content: ''; position: absolute; top: 2px; left: 2px; width: 18px; height: 18px; border-radius: 50%; background: #fff; transition: transform 0.15s ease; }
	.sw.on { background: var(--color-primary); }
	.sw.on::after { transform: translateX(18px); }
	.item { width: 100%; display: flex; align-items: center; gap: 12px; background: var(--color-surface-2); border: 1px solid var(--color-border); color: var(--color-text); padding: 14px; border-radius: 12px; font-size: 15px; cursor: pointer; text-align: left; margin-bottom: 8px; }
	.item.static { cursor: default; color: var(--color-text-muted); font-size: 13px; }
	.item.danger { color: #ff7a90; }
	.flash { position: fixed; left: 50%; transform: translateX(-50%); bottom: calc(var(--tabbar-h) + 70px); background: #000; color: #fff; padding: 10px 16px; border-radius: 999px; font-size: 13px; }
</style>
