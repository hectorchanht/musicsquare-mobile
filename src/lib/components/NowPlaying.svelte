<script lang="ts">
	import { fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { goto } from '$app/navigation';
	import { player, fmtTime } from '$lib/stores/player.svelte';
	import { searchAll } from '$lib/services/catalog';
	import { parseLRC, type LyricLine } from '$lib/services/lrc';
	import type { SourceId, Track } from '$lib/sources/types';

	const SRC_LABEL: Record<SourceId, string> = { netease: 'NetEase', qq: 'QQ', kuwo: 'Kuwo', joox: 'JOOX' };

	type Tab = 'queue' | 'lyrics' | 'related';
	let tab = $state<Tab>('queue');
	let shuffle = $state(false);
	let repeat = $state(false);

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

	// ---- lyrics (parse current track's lrc, highlight active line) ----
	const lines = $derived<LyricLine[]>(player.current?.lrc ? parseLRC(player.current.lrc) : []);
	const activeLine = $derived.by(() => {
		let idx = -1;
		for (let i = 0; i < lines.length; i++) if (lines[i].time <= player.currentTime) idx = i;
		return idx;
	});

	// ---- related (derived from searchAll(artist), minus current) ----
	let related = $state<Track[]>([]);
	let relatedFor = '';
	$effect(() => {
		const t = player.current;
		if (tab === 'related' && t && relatedFor !== t.uid) {
			relatedFor = t.uid;
			related = [];
			searchAll(t.artist, 1)
				.then((r) => (related = r.interleaved.filter((x) => x.uid !== t.uid).slice(0, 20)))
				.catch(() => (related = []));
		}
	});

	function openArtist() {
		if (player.current) {
			player.collapse();
			goto(`/artist/${encodeURIComponent(player.current.artist)}`);
		}
	}

	// ---- drag-down-to-collapse on the cover ----
	let dragY = $state(0);
	let dragging = $state(false);
	let startY = 0;
	function down(e: PointerEvent) {
		dragging = true;
		startY = e.clientY;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}
	function move(e: PointerEvent) {
		if (!dragging) return;
		dragY = Math.max(0, e.clientY - startY); // only downward
	}
	function up() {
		if (!dragging) return;
		dragging = false;
		if (dragY > 120) player.collapse();
		dragY = 0;
	}
</script>

<section
	class="np"
	transition:fly={{ y: 600, duration: 320, easing: cubicOut }}
	style:transform={dragY ? `translateY(${dragY}px)` : undefined}
	style:transition={dragging ? 'none' : 'transform 0.28s cubic-bezier(.22,1,.36,1)'}
>
	<header class="bar">
		<button class="icon" aria-label="Collapse" onclick={() => player.collapse()}>⌄</button>
		<span class="ctx">Now Playing</span>
		<button class="icon" aria-label="More">⋮</button>
	</header>

	<!-- cover: draggable down to collapse -->
	<div
		class="cover"
		role="button"
		tabindex="0"
		aria-label="Album art — drag down to minimize"
		onpointerdown={down}
		onpointermove={move}
		onpointerup={up}
		onpointercancel={up}
		style:background-image={player.current?.cover ? `url(${player.current.cover})` : fallbackCover(player.current)}
	></div>

	<div class="meta">
		<div class="title">{player.current?.title ?? ''}</div>
		<button class="artist" onclick={openArtist}>{player.current?.artist ?? ''}</button>
		{#if player.current}<span class="src">{SRC_LABEL[player.current.source]}</span>{/if}
	</div>

	<!-- progress -->
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

	<!-- transport -->
	<div class="transport">
		<button class="t" class:on={shuffle} aria-label="Shuffle" onclick={() => (shuffle = !shuffle)}>🔀</button>
		<button class="t" aria-label="Previous" onclick={() => player.prev()}>⏮</button>
		<button class="play" aria-label="Play/pause" onclick={() => player.toggle()}>{player.playing ? '⏸' : '▶'}</button>
		<button class="t" aria-label="Next" onclick={() => player.next()}>⏭</button>
		<button class="t" class:on={repeat} aria-label="Repeat" onclick={() => (repeat = !repeat)}>🔁</button>
	</div>

	<!-- sub-nav -->
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
							<button class="row" class:playing={t.uid === player.current?.uid} onclick={() => player.play(t)}>
								<span class="r-title">{t.title}</span>
								<span class="r-artist">{t.artist} · {SRC_LABEL[t.source]}</span>
							</button>
						</li>
					{/each}
				</ul>
			{:else}<p class="empty">No queue yet.</p>{/if}
		{:else if tab === 'lyrics'}
			{#if lines.length}
				<div class="lyrics">
					{#each lines as l, i (i)}<p class:active={i === activeLine}>{l.text}</p>{/each}
				</div>
			{:else}<p class="empty">No lyrics for this track.</p>{/if}
		{:else}
			{#if related.length}
				<ul class="list">
					{#each related as t (t.uid)}
						<li>
							<button class="row" onclick={() => player.play(t)}>
								<span class="r-title">{t.title}</span>
								<span class="r-artist">{t.artist} · {SRC_LABEL[t.source]}</span>
							</button>
						</li>
					{/each}
				</ul>
			{:else}<p class="empty">Loading related…</p>{/if}
		{/if}
	</div>
</section>

<style>
	.np {
		position: fixed;
		inset: 0;
		z-index: 50;
		background: radial-gradient(130% 60% at 50% 0%, #241a3a 0%, var(--color-bg) 60%);
		display: flex;
		flex-direction: column;
		padding: 8px 18px env(safe-area-inset-bottom);
		overflow: hidden;
		touch-action: none;
	}
	.bar { display: flex; align-items: center; justify-content: space-between; padding: 8px 0; }
	.bar .ctx { font-size: 12px; color: var(--color-text-muted); }
	.icon { background: none; border: none; color: var(--color-text); font-size: 22px; cursor: pointer; width: 36px; height: 36px; }
	.cover {
		width: min(78vw, 360px); aspect-ratio: 1/1; margin: 12px auto;
		border-radius: 16px; background-size: cover; background-position: center;
		box-shadow: 0 18px 50px rgba(0,0,0,0.5); cursor: grab; touch-action: none;
	}
	.cover:active { cursor: grabbing; }
	.meta { margin: 6px 2px 14px; }
	.title { font-size: 1.5rem; font-weight: 800; line-height: 1.2; }
	.artist { background: none; border: none; padding: 0; color: var(--color-text-muted); font-size: 1rem; cursor: pointer; text-decoration: underline; text-underline-offset: 3px; }
	.src { display: inline-block; margin-left: 8px; font-size: 10px; font-weight: 700; color: var(--color-primary); }
	.prog { margin: 4px 0 10px; }
	.track { position: relative; height: 14px; display: flex; align-items: center; cursor: pointer; }
	.track::before { content: ''; position: absolute; left: 0; right: 0; height: 4px; border-radius: 4px; background: rgba(255,255,255,0.18); }
	.fill { position: absolute; left: 0; height: 4px; border-radius: 4px; background: var(--color-primary); }
	.knob { position: absolute; width: 12px; height: 12px; border-radius: 50%; background: #fff; transform: translateX(-50%); }
	.times { display: flex; justify-content: space-between; font-size: 11px; color: var(--color-text-muted); margin-top: 4px; }
	.transport { display: flex; align-items: center; justify-content: space-between; margin: 6px 4px 14px; }
	.t { background: none; border: none; color: var(--color-text); font-size: 20px; cursor: pointer; opacity: 0.8; }
	.t.on { color: var(--color-primary); opacity: 1; }
	.play { width: 62px; height: 62px; border-radius: 50%; border: none; background: #fff; color: #000; font-size: 24px; cursor: pointer; display: grid; place-items: center; }
	.subnav { display: flex; justify-content: space-around; border-top: 1px solid var(--color-border); padding-top: 8px; }
	.subnav button { background: none; border: none; color: var(--color-text-muted); font-size: 13px; padding: 6px 4px; cursor: pointer; border-bottom: 2px solid transparent; }
	.subnav button.active { color: var(--color-text); border-bottom-color: var(--color-primary); }
	.panel { flex: 1; overflow-y: auto; padding: 10px 0 16px; }
	.list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
	.row { width: 100%; text-align: left; background: none; border: none; padding: 8px 6px; border-radius: 8px; cursor: pointer; display: flex; flex-direction: column; }
	.row:hover { background: var(--color-surface); }
	.row.playing { background: rgba(124,92,255,0.15); }
	.r-title { font-size: 14px; font-weight: 600; }
	.r-artist { font-size: 12px; color: var(--color-text-muted); }
	.lyrics { text-align: center; line-height: 2.1; }
	.lyrics p { color: var(--color-text-muted); transition: color 0.2s ease, transform 0.2s ease; }
	.lyrics p.active { color: var(--color-text); font-weight: 700; transform: scale(1.04); }
	.empty { color: var(--color-text-muted); font-size: 14px; text-align: center; padding: 24px; }
</style>
