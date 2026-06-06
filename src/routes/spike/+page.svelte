<script lang="ts">
	// Egress-spike harness (success criterion #5). This is the deployed test rig that
	// answers, per source: does the resolved audio CDN URL play BROWSER-DIRECT from a
	// real Cloudflare edge, or does that source need a Worker stream-passthrough?
	//
	// In THIS plan (01-01) only Netease lights up; QQ/Kuwo/JOOX render "pending adapter"
	// (their bodies land in 01-02/01-03). The full 4-source run happens after deploy in
	// 01-04. It is fine for this page to use Svelte even though the data layer is headless
	// — it's a test rig.
	//
	// SECURITY (T-01-03): every source-supplied field (title/artist) is rendered via
	// Svelte text interpolation, which auto-escapes. We NEVER use the raw-HTML directive here.
	import { SOURCES } from '$lib/sources/registry';
	import { searchAll, ensureTrackDetails } from '$lib/services/catalog';
	import type { SourceId, Track } from '$lib/sources/types';

	type RowState = {
		id: SourceId;
		label: string;
		status: 'idle' | 'pending-adapter' | 'searching' | 'resolving' | 'playing' | 'pass' | 'fail';
		message: string;
		track: Track | null;
		audioPlay: 'untested' | 'pass' | 'fail';
		rangeStatus: number | null; // HTTP status of the ranged fetch (diagnostic)
		acceptsRange: boolean | null; // 206 / Accept-Ranges seen?
	};

	const KEYWORD = '周杰伦';

	let rows = $state<RowState[]>(
		Object.values(SOURCES).map((a) => ({
			id: a.id,
			label: a.label,
			status: 'idle',
			message: '',
			track: null,
			audioPlay: 'untested',
			rangeStatus: null,
			acceptsRange: null
		}))
	);

	let audioEl: HTMLAudioElement;

	function setRow(id: SourceId, patch: Partial<RowState>) {
		rows = rows.map((r) => (r.id === id ? { ...r, ...patch } : r));
	}

	/** Measurement 1: browser-direct <audio> playback (not CORS-gated). */
	function playDirect(audioUrl: string): Promise<boolean> {
		return new Promise((resolve) => {
			// referrerpolicy=no-referrer reproduces the legacy <meta no-referrer> so
			// referer-gated CDNs don't 403 (Pitfall 2 carry-over).
			audioEl.setAttribute('referrerpolicy', 'no-referrer');
			let done = false;
			const finish = (ok: boolean) => {
				if (done) return;
				done = true;
				cleanup();
				resolve(ok);
			};
			const onPlaying = () => finish(true);
			const onCanPlay = () => finish(true);
			const onError = () => finish(false);
			const cleanup = () => {
				audioEl.removeEventListener('playing', onPlaying);
				audioEl.removeEventListener('canplay', onCanPlay);
				audioEl.removeEventListener('error', onError);
			};
			audioEl.addEventListener('playing', onPlaying);
			audioEl.addEventListener('canplay', onCanPlay);
			audioEl.addEventListener('error', onError);
			audioEl.src = audioUrl;
			audioEl.play().catch(() => {
				/* autoplay may be blocked; canplay still tells us it loaded */
			});
			setTimeout(() => finish(false), 8000);
		});
	}

	/** Measurement 2/3: ranged fetch + 206/Accept-Ranges diagnostic. */
	async function probeRange(
		audioUrl: string
	): Promise<{ status: number | null; acceptsRange: boolean | null }> {
		try {
			const res = await fetch(audioUrl, {
				method: 'GET',
				headers: { Range: 'bytes=0-1' },
				cache: 'no-store'
			});
			const acceptsRange =
				res.status === 206 || res.headers.get('accept-ranges') === 'bytes';
			return { status: res.status, acceptsRange };
		} catch {
			// A CORS rejection here is informational only — <audio> doesn't need fetch.
			return { status: null, acceptsRange: null };
		}
	}

	// Enable EXACTLY one source so per-source isolation (DATA-03) is visible: every
	// other source is explicitly disabled (absent would fall back to enabledByDefault=true).
	function soloPrefs(id: SourceId): Partial<Record<SourceId, boolean>> {
		const prefs: Partial<Record<SourceId, boolean>> = {};
		for (const a of Object.values(SOURCES)) prefs[a.id] = a.id === id;
		return prefs;
	}

	async function runSource(id: SourceId) {
		const ac = new AbortController();
		setRow(id, { status: 'searching', message: 'searching…', audioPlay: 'untested' });
		try {
			// Route through the aggregation layer (catalog.searchAll) rather than the raw
			// adapter — this is the same path the real app uses; per-source isolation means
			// a thrown adapter shows as status:'error', not an uncaught rejection.
			const { perSource, interleaved } = await searchAll(KEYWORD, 1, soloPrefs(id), ac.signal);
			const outcome = perSource.find((p) => p.source === id);
			if (outcome?.status === 'error') {
				setRow(id, { status: 'fail', message: `search error: ${outcome.error ?? 'unknown'}` });
				return;
			}
			const top = interleaved.find((t) => t.source === id) ?? null;
			if (!top) {
				setRow(id, { status: 'fail', message: 'no results' });
				return;
			}
			setRow(id, { status: 'resolving', message: 'resolving top result…', track: top });
			const resolved = await ensureTrackDetails(top, ac.signal);
			setRow(id, { track: resolved });
			if (!resolved.audioUrl) {
				setRow(id, { status: 'fail', message: 'no audioUrl after resolve' });
				return;
			}
			setRow(id, { status: 'playing', message: 'testing browser-direct playback…' });
			const range = await probeRange(resolved.audioUrl);
			const played = await playDirect(resolved.audioUrl);
			setRow(id, {
				status: played ? 'pass' : 'fail',
				audioPlay: played ? 'pass' : 'fail',
				rangeStatus: range.status,
				acceptsRange: range.acceptsRange,
				message: played
					? 'browser-direct playback OK'
					: 'browser-direct playback failed (may need Worker stream-passthrough)'
			});
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			setRow(id, { status: 'fail', message: msg });
		}
	}

	async function runAll() {
		for (const r of rows) {
			await runSource(r.id);
		}
	}

	// Raw same-origin proxy probe — confirms the /api/netease/search boundary itself
	// works end-to-end (independent of the adapter normalization). Netease is THE source
	// proven in plan 01-01; this is the literal key-link the architecture asserts.
	let rawProbe = $state<string>('not run');
	async function probeNeteaseProxy() {
		rawProbe = 'probing…';
		try {
			const res = await fetch(`/api/netease/search?id=${encodeURIComponent(KEYWORD)}&limit=3`);
			const body: unknown = await res.json();
			rawProbe = Array.isArray(body)
				? `OK — ${res.status}, ${body.length} rows from /api/netease/search`
				: `unexpected body (status ${res.status})`;
		} catch (err) {
			rawProbe = `failed: ${err instanceof Error ? err.message : String(err)}`;
		}
	}
</script>

<svelte:head>
	<title>openmusic egress spike</title>
	<meta name="referrer" content="no-referrer" />
</svelte:head>

<main>
	<h1>Egress spike harness</h1>
	<p>
		Per source: search <code>{KEYWORD}</code> via <code>/api/&lt;source&gt;/search</code>, resolve
		the top result, then test browser-direct <code>&lt;audio&gt;</code> playback + a ranged-fetch
		206 probe. Run this from a <strong>deployed</strong> edge visit (01-04), not <code>wrangler dev</code>.
	</p>

	<div class="actions">
		<button onclick={runAll}>Run all sources</button>
		<button onclick={probeNeteaseProxy}>Probe /api/netease/search</button>
		<span class="raw">proxy: {rawProbe}</span>
	</div>

	<table>
		<thead>
			<tr>
				<th>Source</th>
				<th>Status</th>
				<th>Top result</th>
				<th>Browser-direct</th>
				<th>Range / 206</th>
				<th>Notes</th>
				<th></th>
			</tr>
		</thead>
		<tbody>
			{#each rows as row (row.id)}
				<tr class={row.status}>
					<td>{row.label}</td>
					<td>{row.status}</td>
					<!-- source-supplied text — auto-escaped by Svelte (no raw-HTML directive) -->
					<td>{row.track ? `${row.track.title} — ${row.track.artist}` : '—'}</td>
					<td>{row.audioPlay}</td>
					<td>
						{#if row.rangeStatus === null}
							—
						{:else}
							{row.rangeStatus}{row.acceptsRange ? ' (ranged)' : ''}
						{/if}
					</td>
					<td>{row.message}</td>
					<td><button onclick={() => runSource(row.id)}>Run</button></td>
				</tr>
			{/each}
		</tbody>
	</table>

	<!-- single shared audio element the harness drives; referrerpolicy is set via
	     setAttribute in playDirect() (not a typed Svelte audio prop) -->
	<audio bind:this={audioEl} controls></audio>
</main>

<style>
	main {
		max-width: 56rem;
		margin: 2rem auto;
		padding: 0 1rem;
		font-family: system-ui, sans-serif;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		margin-top: 1rem;
	}
	th,
	td {
		border: 1px solid #ccc;
		padding: 0.4rem 0.6rem;
		text-align: left;
		font-size: 0.9rem;
	}
	tr.pass {
		background: #e6ffed;
	}
	tr.fail {
		background: #ffeef0;
	}
	tr.pending-adapter {
		background: #fff8e6;
	}
	.actions {
		margin: 1rem 0;
		display: flex;
		gap: 0.75rem;
		align-items: center;
		flex-wrap: wrap;
	}
	.raw {
		font-size: 0.85rem;
		color: #555;
	}
	audio {
		display: block;
		margin-top: 1.5rem;
		width: 100%;
	}
</style>
