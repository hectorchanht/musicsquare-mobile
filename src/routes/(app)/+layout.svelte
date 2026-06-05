<script lang="ts">
	import { page } from '$app/state';
	import { player } from '$lib/stores/player.svelte';

	let { children } = $props();
	let audioEl: HTMLAudioElement;

	$effect(() => {
		if (audioEl) player.attach(audioEl);
	});

	const tabs = [
		{ href: '/', label: 'Home', icon: '⌂' },
		{ href: '/search', label: 'Search', icon: '🔍' },
		{ href: '/library', label: 'Library', icon: '≡' }
	];

	function cover(track: { cover: string | null } | null): string {
		// deterministic gradient fallback when no cover art
		return 'linear-gradient(145deg,#3a2d63,#1a1326)';
	}
</script>

<div class="app">
	<main class="content">
		{@render children()}
	</main>

	{#if player.current}
		<div class="nowbar">
			<div class="np-art" style:background-image={player.current.cover ? `url(${player.current.cover})` : cover(player.current)}></div>
			<div class="np-meta">
				<div class="np-title">{player.current.title}</div>
				<div class="np-artist">
					{player.current.artist}
					{#if player.loading}· loading…{:else if player.error}· <span class="err">{player.error}</span>{/if}
				</div>
			</div>
			<button class="np-btn" aria-label="Play/pause" onclick={() => player.toggle()}>
				{player.playing ? '⏸' : '▶'}
			</button>
		</div>
	{/if}

	<nav class="tabbar">
		{#each tabs as t (t.href)}
			<a class="tab" class:active={page.url.pathname === t.href} href={t.href}>
				<span class="ic">{t.icon}</span>{t.label}
			</a>
		{/each}
	</nav>

	<!-- single long-lived audio element (browser-direct) -->
	<audio bind:this={audioEl}></audio>
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
	}
	.np-art {
		width: 44px;
		height: 44px;
		border-radius: 8px;
		background-size: cover;
		background-position: center;
		flex: none;
	}
	.np-meta { flex: 1; min-width: 0; }
	.np-title { font-size: 13px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.np-artist { font-size: 11px; color: var(--color-text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.err { color: #ff7a90; }
	.np-btn {
		background: var(--color-primary);
		border: none;
		color: #fff;
		width: 40px;
		height: 40px;
		border-radius: 50%;
		font-size: 16px;
		cursor: pointer;
		flex: none;
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
	.tab .ic { font-size: 18px; }
	.tab.active { color: var(--color-text); }
	audio { display: none; }
</style>
