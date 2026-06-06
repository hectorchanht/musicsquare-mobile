<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { ChevronLeft, Play, Clock, Trash2 } from '@lucide/svelte';
	import { history } from '$lib/stores/history.svelte';
	import { player } from '$lib/stores/player.svelte';
	import { names } from '$lib/stores/names.svelte';
	import { t } from '$lib/i18n';
	import { longpress } from '$lib/actions/longpress';
	import TrackMenu from '$lib/components/TrackMenu.svelte';
	import type { Track } from '$lib/sources/types';

	let menuTrack = $state<Track | null>(null);
	let menuOpen = $state(false);
	function openMenu(t: Track) { menuTrack = t; menuOpen = true; }

	onMount(() => history.load());

	function fallbackCover(uid: string): string {
		const h = (uid.split('').reduce((a, c) => a + c.charCodeAt(0), 0) * 47) % 360;
		return `linear-gradient(145deg, hsl(${h} 55% 32%), hsl(${(h + 40) % 360} 55% 18%))`;
	}
	// History entries are a Track-compatible replay slice; audioUrl re-resolves on play.
	function playEntry(track: Track) {
		player.setQueue(history.entries as Track[]);
		player.play(track);
	}
	function clear() { history.clear(); }
</script>

<svelte:head><title>{t('history.title')}</title></svelte:head>

<header class="head">
	<button class="back" aria-label={t('settings.backToSettings')} onclick={() => goto('/settings')}><ChevronLeft size={22} /></button>
	<h1>{t('history.heading')}</h1>
</header>

{#if history.entries.length}
	<ul class="list">
		{#each history.entries as entry (entry.uid)}
			{@const track = entry as Track}
			<li>
				<button class="row" use:longpress onlongpress={() => openMenu(track)} onclick={() => playEntry(track)}>
					<span class="art" style:background-image={track.cover ? `url(${track.cover})` : fallbackCover(track.uid)}></span>
					<span class="meta"><span class="r-title">{names.dnTitle(track.title)}</span><span class="r-sub">{names.dnArtist(track.artist)}</span></span>
					<Play size={16} />
				</button>
			</li>
		{/each}
	</ul>
	<button class="item danger" onclick={clear}><Trash2 size={18} /> {t('history.clear')}</button>
{:else}
	<p class="empty"><Clock size={28} /><span>{t('history.empty')}</span></p>
{/if}

<TrackMenu track={menuTrack} open={menuOpen} onclose={() => (menuOpen = false)} />

<style>
	.head { display: flex; align-items: center; gap: 8px; padding: 14px 0 12px; }
	.back { background: none; border: none; color: var(--color-text); cursor: pointer; display: grid; place-items: center; width: 36px; height: 36px; }
	.head h1 { font-size: 1.4rem; margin: 0; }
	.list { list-style: none; margin: 0 0 16px; padding: 0; display: flex; flex-direction: column; gap: 4px; }
	.row { width: 100%; text-align: left; background: none; border: none; padding: 8px; border-radius: 10px; cursor: pointer; display: flex; align-items: center; gap: 12px; color: var(--color-text); }
	.row:hover { background: var(--color-surface); }
	.art { width: 48px; height: 48px; border-radius: 8px; background-size: cover; background-position: center; flex: none; }
	.meta { flex: 1; min-width: 0; display: flex; flex-direction: column; }
	.r-title { font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.r-sub { font-size: 12px; color: var(--color-text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.item { width: 100%; display: flex; align-items: center; gap: 12px; background: var(--color-surface-2); border: 1px solid var(--color-border); color: var(--color-text); padding: 14px; border-radius: 12px; font-size: 15px; cursor: pointer; text-align: left; }
	.item.danger { color: #ff7a90; }
	.empty { display: flex; flex-direction: column; align-items: center; gap: 10px; color: var(--color-text-muted); padding: 48px 16px; text-align: center; font-size: 14px; }
</style>
