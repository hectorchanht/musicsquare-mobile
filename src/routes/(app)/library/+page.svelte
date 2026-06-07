<script lang="ts">
	import { onMount } from 'svelte';
	import { Heart, ListMusic, Download, Trash2, Play, Clock } from '@lucide/svelte';
	import { library } from '$lib/stores/library.svelte';
	import { history } from '$lib/stores/history.svelte';
	import { player } from '$lib/stores/player.svelte';
	import { names } from '$lib/stores/names.svelte';
	import { t } from '$lib/i18n';
	import { longpress } from '$lib/actions/longpress';
	import TrackMenu from '$lib/components/TrackMenu.svelte';
	import type { Track } from '$lib/sources/types';

	type Tab = 'liked' | 'playlists' | 'downloads' | 'history';
	let tab = $state<Tab>('liked');
	let menuTrack = $state<Track | null>(null);
	let menuOpen = $state(false);
	function openMenu(t: Track) { menuTrack = t; menuOpen = true; }
	onMount(() => {
		library.load();
		history.load();
	});

	function fallbackCover(t: Track): string {
		const h = (t.uid.split('').reduce((a, c) => a + c.charCodeAt(0), 0) * 47) % 360;
		return `linear-gradient(145deg, hsl(${h} 55% 32%), hsl(${(h + 40) % 360} 55% 18%))`;
	}
	function playList(list: Track[], t: Track) {
		player.setQueue(list);
		player.play(t);
	}
	// Listen history: replay slice (audioUrl re-resolves on play), moved here from settings.
	function playEntry(track: Track) {
		player.setQueue(history.entries as Track[]);
		player.play(track);
	}
</script>

<svelte:head><title>{t('library.title')}</title></svelte:head>

<header class="head"><h1>{t('library.heading')}</h1></header>

<nav class="tabs">
	<button class:active={tab === 'liked'} onclick={() => (tab = 'liked')}><Heart size={15} /> {t('library.liked')}</button>
	<button class:active={tab === 'playlists'} onclick={() => (tab = 'playlists')}><ListMusic size={15} /> {t('library.playlists')}</button>
	<button class:active={tab === 'downloads'} onclick={() => (tab = 'downloads')}><Download size={15} /> {t('library.downloads')}</button>
	<button class:active={tab === 'history'} onclick={() => (tab = 'history')}><Clock size={15} /> {t('history.heading')}</button>
</nav>

{#if tab === 'liked'}
	{#if library.liked.length}
		<ul class="list">
			{#each library.liked as track (track.uid)}
				<li>
					<button class="row" use:longpress onlongpress={() => openMenu(track)} onclick={() => playList(library.liked, track)}>
						<span class="art" style:background-image={track.cover ? `url(${track.cover})` : fallbackCover(track)}></span>
						<span class="meta"><span class="r-title">{names.dnTitle(track.title)}</span><span class="r-sub">{names.dnArtist(track.artist)}</span></span>
						<Play size={16} />
					</button>
				</li>
			{/each}
		</ul>
	{:else}<p class="empty"><Heart size={28} /><span>{t('library.noLiked')}</span></p>{/if}
{:else if tab === 'playlists'}
	{#if library.playlists.length}
		{#each library.playlists as pl (pl.id)}
			<section class="pl">
				<div class="pl-head">
					<h2>{pl.name} <span class="count">{pl.tracks.length}</span></h2>
					<button class="del" aria-label={t('library.deletePlaylist')} onclick={() => library.deletePlaylist(pl.id)}><Trash2 size={16} /></button>
				</div>
				{#if pl.tracks.length}
					<ul class="list">
						{#each pl.tracks as track (track.uid)}
							<li>
								<button class="row" use:longpress onlongpress={() => openMenu(track)} onclick={() => playList(pl.tracks, track)}>
									<span class="art" style:background-image={track.cover ? `url(${track.cover})` : fallbackCover(track)}></span>
									<span class="meta"><span class="r-title">{names.dnTitle(track.title)}</span><span class="r-sub">{names.dnArtist(track.artist)}</span></span>
								</button>
							</li>
						{/each}
					</ul>
				{:else}<p class="empty-sm">{t('library.emptyPlaylist')}</p>{/if}
			</section>
		{/each}
	{:else}<p class="empty"><ListMusic size={28} /><span>{t('library.noPlaylists')}</span></p>{/if}
{:else if tab === 'downloads'}
	{#if library.downloads.length}
		<ul class="list">
			{#each library.downloads as track (track.uid)}
				<li class="rowline">
					<button class="row" use:longpress onlongpress={() => openMenu(track)} onclick={() => playList(library.downloads, track)}>
						<span class="art" style:background-image={track.cover ? `url(${track.cover})` : fallbackCover(track)}></span>
						<span class="meta"><span class="r-title">{names.dnTitle(track.title)}</span><span class="r-sub">{names.dnArtist(track.artist)}</span></span>
					</button>
					<button class="del" aria-label={t('library.remove')} onclick={() => library.removeDownload(track.uid)}><Trash2 size={15} /></button>
				</li>
			{/each}
		</ul>
		<p class="note">{t('library.downloadsNote')}</p>
	{:else}<p class="empty"><Download size={28} /><span>{t('library.noDownloads')}</span></p>{/if}
{:else}
	{#if history.entries.length}
		<ul class="list">
			{#each history.entries as entry (entry.uid)}
				{@const track = entry as Track}
				<li>
					<button class="row" use:longpress onlongpress={() => openMenu(track)} onclick={() => playEntry(track)}>
						<span class="art" style:background-image={track.cover ? `url(${track.cover})` : fallbackCover(track)}></span>
						<span class="meta"><span class="r-title">{names.dnTitle(track.title)}</span><span class="r-sub">{names.dnArtist(track.artist)}</span></span>
						<Play size={16} />
					</button>
				</li>
			{/each}
		</ul>
		<button class="clear-history" onclick={() => history.clear()}><Trash2 size={16} /> {t('history.clear')}</button>
	{:else}<p class="empty"><Clock size={28} /><span>{t('history.empty')}</span></p>{/if}
{/if}

<TrackMenu track={menuTrack} open={menuOpen} onclose={() => (menuOpen = false)} />

<style>
	.head h1 { font-size: 1.4rem; margin: 16px 0 12px; }
	.tabs { display: flex; gap: 6px; margin-bottom: 14px; }
	.tabs button { flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 6px; background: var(--color-surface-2); border: 1px solid var(--color-border); color: var(--color-text-muted); padding: 9px 6px; border-radius: 999px; font-size: 13px; cursor: pointer; }
	.tabs button.active { background: var(--color-primary); color: #fff; border-color: transparent; }
	.list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
	.rowline { display: flex; align-items: center; }
	.rowline .row { flex: 1; }
	.row { width: 100%; text-align: left; background: none; border: none; padding: 8px; border-radius: 10px; cursor: pointer; display: flex; align-items: center; gap: 12px; color: var(--color-text); }
	.row:hover { background: var(--color-surface); }
	.art { width: 48px; height: 48px; border-radius: 8px; background-size: cover; background-position: center; flex: none; }
	.meta { flex: 1; min-width: 0; display: flex; flex-direction: column; }
	.r-title { font-size: calc(14px * var(--fs-title, 1)); font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.r-sub { font-size: calc(12px * var(--fs-artist, 1)); color: var(--color-text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.pl { margin-bottom: 18px; }
	.pl-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
	.pl-head h2 { font-size: 1rem; margin: 0; }
	.count { color: var(--color-text-muted); font-size: 12px; font-weight: 400; }
	.del { background: none; border: none; color: var(--color-text-muted); cursor: pointer; display: grid; place-items: center; padding: 6px; }
	.empty { display: flex; flex-direction: column; align-items: center; gap: 10px; color: var(--color-text-muted); padding: 48px 16px; text-align: center; font-size: 14px; }
	.empty-sm { color: var(--color-text-muted); font-size: 13px; padding: 4px 8px; }
	.note { color: var(--color-text-muted); font-size: 11px; margin-top: 12px; }
	.clear-history { display: inline-flex; align-items: center; gap: 8px; margin-top: 12px; background: var(--color-surface-2); border: 1px solid var(--color-border); color: #ff7a90; padding: 10px 14px; border-radius: 12px; font-size: 14px; cursor: pointer; }
</style>
