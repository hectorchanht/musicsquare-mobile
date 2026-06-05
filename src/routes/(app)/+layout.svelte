<script lang="ts">
	import { onMount, type Component } from 'svelte';
	import { page } from '$app/state';
	import { House, Search, Library, Play, Pause } from '@lucide/svelte';
	import { player } from '$lib/stores/player.svelte';
	import { library } from '$lib/stores/library.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import NowPlaying from '$lib/components/NowPlaying.svelte';

	let { children } = $props();

	onMount(() => {
		library.load();
		settings.load();
	});

	const tabs: { href: string; label: string; icon: Component }[] = [
		{ href: '/', label: 'Home', icon: House },
		{ href: '/search', label: 'Search', icon: Search },
		{ href: '/library', label: 'Library', icon: Library }
	];

	function cover(track: { cover: string | null } | null): string {
		return 'linear-gradient(145deg,#3a2d63,#1a1326)';
	}
</script>

<div class="app">
	<main class="content">
		{@render children()}
	</main>

	{#if player.current && !player.expanded}
		<div class="nowbar">
			<div class="np-prog"><i style:width={`${player.duration > 0 ? (player.currentTime / player.duration) * 100 : 0}%`}></i></div>
			<button class="np-open" aria-label="Open now playing" onclick={() => player.expand()}>
				<span class="np-art" style:background-image={player.current.cover ? `url(${player.current.cover})` : cover(player.current)}></span>
				<span class="np-meta">
					<span class="np-title">{player.current.title}</span>
					<span class="np-artist">
						{player.current.artist}
						{#if player.loading}· loading…{:else if player.error}· <span class="err">{player.error}</span>{/if}
					</span>
				</span>
			</button>
			<button class="np-btn" aria-label="Play/pause" onclick={() => player.toggle()}>
				{#if player.playing}<Pause size={18} />{:else}<Play size={18} />{/if}
			</button>
		</div>
	{/if}

	{#if player.expanded}
		<NowPlaying />
	{/if}

	<nav class="tabbar">
		{#each tabs as t (t.href)}
			{@const Icon = t.icon}
			<a class="tab" class:active={page.url.pathname === t.href} href={t.href}>
				<span class="ic"><Icon size={20} /></span>{t.label}
			</a>
		{/each}
	</nav>
	<!-- audio element lives in the ROOT layout (persists across navigation) -->
</div>

<style>
	.app {
		min-height: 100dvh;
		display: flex;
		flex-direction: column;
		background: radial-gradient(120% 55% at 50% 0%, #1a1326 0%, var(--color-bg) 55%);
		padding-bottom: calc(var(--nowbar-h) + var(--tabbar-h));
	}
	.content {
		flex: 1;
		max-width: 720px;
		width: 100%;
		margin: 0 auto;
		padding: 0 16px;
	}
	.nowbar {
		position: fixed;
		left: 8px;
		right: 8px;
		bottom: calc(var(--tabbar-h) + 6px);
		height: var(--nowbar-h);
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px 12px;
		border-radius: 14px;
		background: rgba(40, 32, 60, 0.55);
		backdrop-filter: blur(14px);
		-webkit-backdrop-filter: blur(14px);
		border: 1px solid rgba(255, 255, 255, 0.08);
		max-width: 704px;
		margin: 0 auto;
		z-index: 20;
		overflow: hidden;
	}
	.np-prog {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		height: 3px;
		background: rgba(255, 255, 255, 0.12);
	}
	.np-prog > i {
		display: block;
		height: 100%;
		background: var(--color-primary);
		transition: width 0.25s linear;
	}
	.np-open {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 10px;
		background: none;
		border: none;
		padding: 0;
		cursor: pointer;
		text-align: left;
		color: inherit;
	}
	.np-art {
		width: 44px;
		height: 44px;
		border-radius: 8px;
		background-size: cover;
		background-position: center;
		flex: none;
	}
	.np-meta { flex: 1; min-width: 0; display: flex; flex-direction: column; }
	.np-title { display: block; font-size: 13px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.np-artist { display: block; font-size: 11px; color: var(--color-text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.err { color: #ff7a90; }
	.np-btn {
		background: var(--color-primary);
		border: none;
		color: #fff;
		width: 40px;
		height: 40px;
		border-radius: 50%;
		cursor: pointer;
		flex: none;
		display: grid;
		place-items: center;
		transition: transform 0.12s ease;
	}
	.np-btn:active { transform: scale(0.92); }
	.tabbar {
		position: fixed;
		left: 0;
		right: 0;
		bottom: 0;
		height: var(--tabbar-h);
		display: flex;
		justify-content: space-around;
		align-items: center;
		background: var(--color-bg);
		border-top: 1px solid var(--color-border);
		padding-bottom: env(safe-area-inset-bottom);
		z-index: 21;
	}
	.tab {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
		font-size: 10px;
		color: var(--color-text-muted);
		transition: color 0.15s ease;
	}
	.tab .ic { display: grid; place-items: center; }
	.tab.active { color: var(--color-text); }
</style>
