<script lang="ts">
	import { fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { goto } from '$app/navigation';
	import { ChevronDown, MoreVertical, Shuffle, SkipBack, SkipForward, Play, Pause, Repeat } from '@lucide/svelte';
	import { player, fmtTime } from '$lib/stores/player.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { names } from '$lib/stores/names.svelte';
	import { searchAll } from '$lib/services/catalog';
	import { dedupeBest } from '$lib/services/dedupe';
	import { translateLines } from '$lib/services/translate';
	import { longpress } from '$lib/actions/longpress';
	import TrackMenu from '$lib/components/TrackMenu.svelte';
	import { parseLRC, type LyricLine } from '$lib/services/lrc';
	import type { Track } from '$lib/sources/types';

	type Tab = 'queue' | 'lyrics' | 'related';
	let tab = $state<Tab>('queue');
	let shuffle = $state(false);
	let repeat = $state(false);

	// shared context menu for current track + long-pressed queue/related rows
	let menuTrack = $state<Track | null>(null);
	let menuOpen = $state(false);
	function openMenu(t: Track | null) {
		menuTrack = t;
		menuOpen = !!t;
	}

	function fallbackCover(t: Track | null): string {
		if (!t) return 'linear-gradient(145deg,#3a2d63,#1a1326)';
		const h = (t.uid.split('').reduce((a, c) => a + c.charCodeAt(0), 0) * 47) % 360;
		return `linear-gradient(145deg, hsl(${h} 55% 32%), hsl(${(h + 40) % 360} 55% 18%))`;
	}

	// ---- progress ----
	const frac = $derived(player.duration > 0 ? player.currentTime / player.duration : 0);
	function seek(e: MouseEvent) {
		const el = e.currentTarget as HTMLElement;
		const r = el.getBoundingClientRect();
		player.seekFraction((e.clientX - r.left) / r.width);
	}
	function seekKey(e: KeyboardEvent) {
		if (player.duration <= 0) return;
		if (e.key === 'ArrowRight') player.seekFraction((player.currentTime + 5) / player.duration);
		else if (e.key === 'ArrowLeft') player.seekFraction((player.currentTime - 5) / player.duration);
	}

	// ---- lyrics ----
	const lines = $derived<LyricLine[]>(player.current?.lrc ? parseLRC(player.current.lrc) : []);
	const activeLine = $derived.by(() => {
		let idx = -1;
		for (let i = 0; i < lines.length; i++) if (lines[i].time <= player.currentTime) idx = i;
		return idx;
	});
	let lyricsEl = $state<HTMLElement | null>(null);
	let autoScroll = $state(true);
	let idleTimer: ReturnType<typeof setTimeout> | null = null;
	function lyricsTouched() {
		autoScroll = false;
		if (idleTimer) clearTimeout(idleTimer);
		idleTimer = setTimeout(() => (autoScroll = true), 2500);
	}
	$effect(() => {
		const idx = activeLine;
		if (tab !== 'lyrics' || !autoScroll || idx < 0 || !lyricsEl) return;
		const el = lyricsEl.querySelectorAll('p')[idx];
		if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
	});

	// ---- lyrics translation ----
	let translated = $state<string[]>([]);
	let translating = $state(false);
	let trKey = '';
	$effect(() => {
		const lang = settings.lyricsLang;
		const t = player.current;
		const n = lines.length;
		if (tab !== 'lyrics' || lang === 'off' || !n || !t) return;
		const key = `${t.uid}:${lang}:${n}`;
		if (trKey === key) return;
		trKey = key;
		translating = true;
		translateLines(lines.map((l) => l.text), lang)
			.then((out) => { if (trKey === key) translated = out; })
			.catch(() => { if (trKey === key) translated = []; })
			.finally(() => { if (trKey === key) translating = false; });
	});
	const showTr = $derived(settings.lyricsLang !== 'off' && translated.length === lines.length);

	// ---- related ----
	let related = $state<Track[]>([]);
	let relatedFor = '';
	$effect(() => {
		const t = player.current;
		if (tab === 'related' && t && relatedFor !== t.uid) {
			relatedFor = t.uid;
			related = [];
			searchAll(t.artist, 1)
				.then((r) => (related = dedupeBest(r.interleaved, settings.preferredSource).filter((x) => x.uid !== t.uid).slice(0, 20)))
				.catch(() => (related = []));
		}
	});

	function openArtist() {
		if (player.current) {
			player.collapse();
			goto(`/artist/${encodeURIComponent(player.current.artist)}`);
		}
	}

	// ---- cover drag-down to collapse ----
	let dragY = $state(0);
	let dragging = $state(false);
	let startY = 0;
	function coverDown(e: PointerEvent) { dragging = true; startY = e.clientY; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); }
	function coverMove(e: PointerEvent) { if (dragging) dragY = Math.max(0, e.clientY - startY); }
	function coverUp() { if (!dragging) return; dragging = false; if (dragY > 120) player.collapse(); dragY = 0; }

	// ---- grip: sensitive drag OR tap toggles full/peek ----
	let panelFull = $state(false);
	let gripStartY = 0;
	let gripMoved = 0;
	let gripActive = false;
	function gripDown(e: PointerEvent) { gripActive = true; gripStartY = e.clientY; gripMoved = 0; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); }
	function gripMove(e: PointerEvent) { if (gripActive) gripMoved = e.clientY - gripStartY; }
	function gripUp() {
		if (!gripActive) return;
		gripActive = false;
		if (Math.abs(gripMoved) < 8) panelFull = !panelFull;
		else if (gripMoved < -24) panelFull = true;
		else if (gripMoved > 24) panelFull = false;
		gripMoved = 0;
	}
</script>

<section
	class="np"
	transition:fly={{ y: 600, duration: 320, easing: cubicOut }}
	style:transform={dragY ? `translateY(${dragY}px)` : undefined}
	style:transition={dragging ? 'none' : 'transform 0.28s cubic-bezier(.22,1,.36,1)'}
>
	<header class="bar">
		<button class="icon" aria-label="Collapse" onclick={() => player.collapse()}><ChevronDown /></button>
		<span class="ctx">Now Playing</span>
		<button class="icon" aria-label="Options" onclick={() => openMenu(player.current)}><MoreVertical /></button>
	</header>

	<div
		class="cover"
		role="button"
		tabindex="0"
		aria-label="Album art — drag down to minimize"
		onpointerdown={coverDown}
		onpointermove={coverMove}
		onpointerup={coverUp}
		onpointercancel={coverUp}
		style:background-image={player.current?.cover ? `url(${player.current.cover})` : fallbackCover(player.current)}
	></div>

	<div class="meta">
		<div class="title">{player.current ? names.dn(player.current.title) : ''}</div>
		<button class="artist" onclick={openArtist}>{player.current ? names.dn(player.current.artist) : ''}</button>
	</div>

	<div class="prog">
		<div class="track" onclick={seek} onkeydown={seekKey} role="slider" tabindex="0" aria-label="Seek" aria-valuenow={Math.round(frac * 100)}>
			<div class="fill" style:width={`${frac * 100}%`}></div>
			<div class="knob" style:left={`${frac * 100}%`}></div>
		</div>
		<div class="times">
			<span>{fmtTime(player.currentTime)}</span>
			<span>{player.duration > 0 ? fmtTime(player.duration) : '--:--'}</span>
		</div>
	</div>

	<div class="transport">
		<button class="t" class:on={shuffle} aria-label="Shuffle" onclick={() => (shuffle = !shuffle)}><Shuffle size={20} /></button>
		<button class="t" aria-label="Previous" onclick={() => player.prev()}><SkipBack size={26} /></button>
		<button class="play" aria-label="Play/pause" onclick={() => player.toggle()}>
			{#if player.playing}<Pause size={26} />{:else}<Play size={26} />{/if}
		</button>
		<button class="t" aria-label="Next" onclick={() => player.next()}><SkipForward size={26} /></button>
		<button class="t" class:on={repeat} aria-label="Repeat" onclick={() => (repeat = !repeat)}><Repeat size={20} /></button>
	</div>

	<div class="sheet" class:full={panelFull}>
		<div class="grip" role="button" tabindex="0" aria-label={panelFull ? 'Collapse panel' : 'Expand panel'}
			onpointerdown={gripDown} onpointermove={gripMove} onpointerup={gripUp} onpointercancel={gripUp}
			onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') panelFull = !panelFull; }}>
			<span class="handle"></span>
		</div>

		<nav class="subnav">
			<button class:active={tab === 'queue'} onclick={() => (tab = 'queue')}>Up Next</button>
			<button class:active={tab === 'lyrics'} onclick={() => (tab = 'lyrics')}>Lyrics</button>
			<button class:active={tab === 'related'} onclick={() => (tab = 'related')}>Related</button>
		</nav>

		<div class="panel">
			{#if tab === 'queue'}
				{#if player.queue.length}
					<ul class="list">
						{#each player.queue as t (t.uid)}
							<li>
								<button class="row" class:playing={t.uid === player.current?.uid} use:longpress onlongpress={() => openMenu(t)} onclick={() => player.play(t)}>
									<span class="r-title">{names.dn(t.title)}</span>
									<span class="r-artist">{names.dn(t.artist)}</span>
								</button>
							</li>
						{/each}
					</ul>
				{:else}<p class="empty">No queue yet.</p>{/if}
			{:else if tab === 'lyrics'}
				{#if lines.length}
					{#if translating}<p class="tr-hint">translating…</p>{/if}
					<div class="lyrics" role="group" aria-label="Lyrics" bind:this={lyricsEl} onpointerdown={lyricsTouched} onwheel={lyricsTouched}>
						{#each lines as l, i (i)}
							<p class:active={i === activeLine}>
								{#if showTr && settings.translateMode === 'replace'}
									{translated[i]}
								{:else}
									{l.text}
									{#if showTr}<span class="tr">{translated[i]}</span>{/if}
								{/if}
							</p>
						{/each}
					</div>
				{:else}<p class="empty">No lyrics for this track.</p>{/if}
			{:else}
				{#if related.length}
					<ul class="list">
						{#each related as t (t.uid)}
							<li><button class="row" use:longpress onlongpress={() => openMenu(t)} onclick={() => player.play(t)}><span class="r-title">{names.dn(t.title)}</span><span class="r-artist">{names.dn(t.artist)}</span></button></li>
						{/each}
					</ul>
				{:else}<p class="empty">Loading related…</p>{/if}
			{/if}
		</div>
	</div>

	<TrackMenu track={menuTrack} open={menuOpen} onclose={() => (menuOpen = false)} />
</section>

<style>
	.np { position: fixed; inset: 0; z-index: 50; background: radial-gradient(130% 60% at 50% 0%, #241a3a 0%, var(--color-bg) 60%); display: flex; flex-direction: column; padding: 8px 18px env(safe-area-inset-bottom); overflow: hidden; }
	.bar { display: flex; align-items: center; justify-content: space-between; padding: 8px 0; }
	.bar .ctx { font-size: 12px; color: var(--color-text-muted); }
	.icon { background: none; border: none; color: var(--color-text); cursor: pointer; width: 38px; height: 38px; display: grid; place-items: center; border-radius: 50%; }
	.icon:hover { background: var(--color-surface-2); }
	.cover { width: min(72vw, 320px); aspect-ratio: 1/1; margin: 10px auto; border-radius: 16px; background-size: cover; background-position: center; box-shadow: 0 18px 50px rgba(0,0,0,0.5); cursor: grab; touch-action: none; }
	.cover:active { cursor: grabbing; }
	.meta { margin: 4px 2px 12px; }
	.title { font-size: 1.5rem; font-weight: 800; line-height: 1.2; }
	.artist { background: none; border: none; padding: 0; color: var(--color-text-muted); font-size: 1rem; cursor: pointer; text-decoration: underline; text-underline-offset: 3px; }
	.prog { margin: 4px 0 10px; }
	.track { position: relative; height: 14px; display: flex; align-items: center; cursor: pointer; }
	.track::before { content: ''; position: absolute; left: 0; right: 0; height: 4px; border-radius: 4px; background: rgba(255,255,255,0.18); }
	.fill { position: absolute; left: 0; height: 4px; border-radius: 4px; background: var(--color-primary); }
	.knob { position: absolute; width: 12px; height: 12px; border-radius: 50%; background: #fff; transform: translateX(-50%); }
	.times { display: flex; justify-content: space-between; font-size: 11px; color: var(--color-text-muted); margin-top: 4px; }
	.transport { display: flex; align-items: center; justify-content: space-between; margin: 6px 4px 10px; }
	.t { background: none; border: none; color: var(--color-text); cursor: pointer; opacity: 0.85; display: grid; place-items: center; }
	.t.on { color: var(--color-primary); opacity: 1; }
	.play { width: 62px; height: 62px; border-radius: 50%; border: none; background: #fff; color: #000; cursor: pointer; display: grid; place-items: center; }
	.sheet { display: flex; flex-direction: column; flex: 1; min-height: 0; border-top: 1px solid var(--color-border); transition: all 0.28s cubic-bezier(.22,1,.36,1); }
	.sheet.full { position: absolute; inset: 0; z-index: 5; background: var(--color-bg); border-top: none; padding: 8px 18px env(safe-area-inset-bottom); }
	.grip { display: flex; justify-content: center; padding: 10px 0 6px; cursor: grab; touch-action: none; }
	.grip:active { cursor: grabbing; }
	.handle { width: 44px; height: 5px; border-radius: 999px; background: var(--color-text-muted); opacity: 0.6; }
	.subnav { display: flex; justify-content: space-around; padding-bottom: 6px; }
	.subnav button { background: none; border: none; color: var(--color-text-muted); font-size: 13px; padding: 6px 4px; cursor: pointer; border-bottom: 2px solid transparent; }
	.subnav button.active { color: var(--color-text); border-bottom-color: var(--color-primary); }
	.panel { flex: 1; overflow-y: auto; padding: 8px 0 16px; }
	.list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
	.row { width: 100%; text-align: left; background: none; border: none; padding: 8px 6px; border-radius: 8px; cursor: pointer; display: flex; flex-direction: column; }
	.row:hover { background: var(--color-surface); }
	.row.playing { background: rgba(124,92,255,0.15); }
	.r-title { font-size: 14px; font-weight: 600; }
	.r-artist { font-size: 12px; color: var(--color-text-muted); }
	.lyrics { text-align: center; line-height: 2.1; }
	.lyrics p { color: var(--color-text-muted); transition: color 0.2s ease, transform 0.2s ease; margin: 0; }
	.lyrics p.active { color: var(--color-text); font-weight: 700; transform: scale(1.04); }
	.lyrics .tr { display: block; font-size: 0.82em; font-weight: 400; color: var(--color-text-muted); margin-top: 2px; }
	.tr-hint { text-align: center; font-size: 11px; color: var(--color-primary); margin: 0 0 6px; }
	.empty { color: var(--color-text-muted); font-size: 14px; text-align: center; padding: 24px; }
</style>
