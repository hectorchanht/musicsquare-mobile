<script lang="ts">
	import { searchAll } from '$lib/services/catalog';
	import { dedupeBest } from '$lib/services/dedupe';
	import { player } from '$lib/stores/player.svelte';
	import type { Track } from '$lib/sources/types';

	let q = $state('');
	let results = $state<Track[]>([]);
	let loading = $state(false);
	let searched = $state(false);
	let someFailed = $state(false);
	let ac: AbortController | null = null;

	function fallbackCover(t: Track): string {
		const h = (t.uid.split('').reduce((a, c) => a + c.charCodeAt(0), 0) * 47) % 360;
		return `linear-gradient(145deg, hsl(${h} 55% 32%), hsl(${(h + 40) % 360} 55% 18%))`;
	}

	async function run(e?: Event) {
		e?.preventDefault();
		const kw = q.trim();
		if (!kw) return;
		ac?.abort();
		ac = new AbortController();
		loading = true;
		searched = true;
		someFailed = false;
		try {
			const { interleaved, perSource } = await searchAll(kw, 1, {}, ac.signal);
			results = dedupeBest(interleaved);
			someFailed = perSource.some((p) => p.status === 'error');
		} catch {
			results = [];
		} finally {
			loading = false;
		}
	}
</script>

<header class="head"><h1>Search</h1></header>

<form class="bar" onsubmit={run}>
	<input
		bind:value={q}
		placeholder="Search across NetEase · QQ · Kuwo · JOOX"
		autocomplete="off"
		autocapitalize="off"
	/>
	<button type="submit" disabled={loading}>{loading ? '…' : 'Go'}</button>
</form>

{#if someFailed}
	<p class="warn">Some sources didn't respond — showing the rest.</p>
{/if}

{#if loading}
	<p class="muted">Searching all sources…</p>
{:else if searched && results.length === 0}
	<p class="muted">No results.</p>
{:else}
	<ul class="list">
		{#each results as t (t.uid)}
			<li>
				<button class="row" onclick={() => { player.setQueue(results); player.play(t); }}>
					<span class="art" style:background-image={t.cover ? `url(${t.cover})` : fallbackCover(t)}></span>
					<span class="meta">
						<span class="r-title">{t.title}</span>
						<span class="r-artist">{t.artist}</span>
					</span>
				</button>
			</li>
		{/each}
	</ul>
{/if}

<style>
	.head h1 { font-size: 1.4rem; margin: 16px 0 12px; }
	.bar { display: flex; gap: 8px; margin-bottom: 14px; }
	.bar input {
		flex: 1; background: var(--color-surface-2); border: 1px solid var(--color-border);
		color: var(--color-text); border-radius: 12px; padding: 12px 14px; font-size: 15px; outline: none;
	}
	.bar input:focus { border-color: var(--color-primary); }
	.bar button {
		background: var(--color-primary); border: none; color: #fff; border-radius: 12px;
		padding: 0 18px; font-weight: 700; cursor: pointer;
	}
	.muted { color: var(--color-text-muted); font-size: 14px; }
	.warn { color: #ffcf66; font-size: 12px; margin: 0 0 10px; }
	.list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
	.row {
		width: 100%; display: flex; align-items: center; gap: 12px; padding: 8px; background: none;
		border: none; border-radius: 10px; cursor: pointer; text-align: left; transition: background 0.12s ease;
	}
	.row:hover { background: var(--color-surface); }
	.art { width: 48px; height: 48px; border-radius: 8px; background-size: cover; background-position: center; flex: none; }
	.meta { flex: 1; min-width: 0; display: flex; flex-direction: column; }
	.r-title { font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.r-artist { font-size: 12px; color: var(--color-text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>
