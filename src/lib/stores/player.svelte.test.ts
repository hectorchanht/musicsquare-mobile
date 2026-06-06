import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeUid, type SourceId, type Track } from '$lib/sources/types';

// FIX-A: player.playStub is the optimistic resolve-on-tap path. A discovery tile is a
// Last.fm {artist,title} stub (NOT a Track), so it must be resolved via resolveStub
// (searchAll+dedupeBest, ~5-10s) before play. playStub locks the tapped stub into
// pendingTrack + loading SYNCHRONOUSLY, dedupes a same-song double-tap, and supersedes an
// in-flight resolve when a different song is tapped (generation guard). We mock resolveStub
// with DEFERRED promises so the generation-timing test is deterministic, and play() (which
// touches the real <audio>/Media Session) is stubbed so these run headless in node.

// Mock the resolve-on-tap shim so we control settle order + timing.
vi.mock('$lib/services/discovery', () => ({ resolveStub: vi.fn() }));
// Mock the detail resolver so prefetchNext's pre-resolve is observable/controllable in node.
vi.mock('$lib/services/catalog', () => ({ ensureTrackDetails: vi.fn() }));

import { player } from './player.svelte';
import { resolveStub } from '$lib/services/discovery';
import { ensureTrackDetails } from '$lib/services/catalog';

const mockResolve = vi.mocked(resolveStub);
const mockEnsure = vi.mocked(ensureTrackDetails);

function mk(source: SourceId, songid: string, artist: string, title: string): Track {
	return {
		uid: makeUid(source, songid),
		source,
		songid,
		title,
		artist,
		album: '',
		cover: null,
		audioUrl: 'https://cdn.example.com/a.mp3',
		lrc: null,
		lrcUrl: null,
		detailsLoaded: true,
		quality: null,
		qualityLabel: null,
		keyword: 'x',
		displayIndex: 1
	};
}

/** A deferred promise so a test can control exactly WHEN a resolve settles. */
function deferred<T>() {
	let resolve!: (v: T) => void;
	let reject!: (e: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

// Let queued microtasks (the await in playStub + the void play() handoff) flush.
const flush = () => new Promise((r) => setTimeout(r, 0));

/** An unresolved search stub: detailsLoaded:false + audioUrl:null so the readiness guard does NOT short-circuit. */
function stub(source: SourceId, songid: string, artist: string, title: string): Track {
	return { ...mk(source, songid, artist, title), detailsLoaded: false, audioUrl: null };
}

beforeEach(() => {
	mockResolve.mockReset();
	mockEnsure.mockReset();
	player.queue = [];
	// play() touches the real <audio>/Media Session — stub it so playStub's success handoff
	// is observable (current set) without a DOM. We assert play() is CALLED with the track.
	vi.spyOn(player, 'play').mockImplementation(async (track: Track) => {
		// Mirror the bits of play() the now-bar observes: take ownership of current/loading.
		player.current = track;
		player.loading = false;
	});
	// Reset the optimistic state between tests (private fields reset via a fresh miss path).
	player.current = null;
	player.pendingTrack = null;
	player.loading = false;
	player.error = null;
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('player.playStub — optimistic resolve-on-tap (FIX-A)', () => {
	it('locks the tapped stub into pendingTrack + loading SYNCHRONOUSLY, before resolve', () => {
		const d = deferred<Track | null>();
		mockResolve.mockReturnValue(d.promise);

		// Do NOT await — assert the state set synchronously, before resolveStub settles.
		void player.playStub('周杰伦', '稻香', 'https://img/cover.png');

		expect(player.pendingTrack).toEqual({
			artist: '周杰伦',
			title: '稻香',
			cover: 'https://img/cover.png'
		});
		expect(player.loading).toBe(true);
		expect(player.current).toBeNull(); // not played yet — still resolving
		d.resolve(null); // cleanup
	});

	it('dedupes a same-song double-tap: resolveStub is called ONCE', async () => {
		const d = deferred<Track | null>();
		mockResolve.mockReturnValue(d.promise);

		const p1 = player.playStub('Ed Sheeran', 'Perfect');
		const p2 = player.playStub('Ed Sheeran', 'Perfect'); // same key, still in flight

		expect(mockResolve).toHaveBeenCalledTimes(1);
		await expect(p2).resolves.toBeNull(); // the deduped second tap returns null immediately

		d.resolve(mk('netease', '1', 'Ed Sheeran', 'Perfect'));
		await p1;
		await flush();
	});

	it('a DIFFERENT-song tap supersedes: the stale resolve never plays', async () => {
		const dA = deferred<Track | null>();
		const dB = deferred<Track | null>();
		mockResolve.mockReturnValueOnce(dA.promise).mockReturnValueOnce(dB.promise);

		const trackA = mk('netease', 'A', 'Artist A', 'Song A');
		const trackB = mk('qq', 'B', 'Artist B', 'Song B');

		const pA = player.playStub('Artist A', 'Song A'); // gen 1
		const pB = player.playStub('Artist B', 'Song B'); // gen 2 — supersedes gen 1

		// The now-bar shows the NEWER song while both resolve.
		expect(player.pendingTrack).toEqual({ artist: 'Artist B', title: 'Song B', cover: null });

		// The STALE (gen 1) resolve settles FIRST → must be discarded (not played).
		dA.resolve(trackA);
		await expect(pA).resolves.toBeNull();
		await flush();
		expect(player.current).toBeNull(); // stale result never played

		// The CURRENT (gen 2) resolve settles → it plays.
		dB.resolve(trackB);
		await expect(pB).resolves.toBe(trackB);
		await flush();
		expect(player.current?.uid).toBe(trackB.uid);
		expect(player.play).toHaveBeenCalledWith(trackB, { fresh: true });
		// The stale track was NEVER handed to play().
		expect(player.play).not.toHaveBeenCalledWith(trackA, expect.anything());
	});

	it('on success: plays the resolved Track + clears pendingTrack', async () => {
		const track = mk('netease', 'hit', '周杰伦', '稻香');
		mockResolve.mockResolvedValue(track);

		const out = await player.playStub('周杰伦', '稻香');
		await flush();

		expect(out).toBe(track);
		expect(player.pendingTrack).toBeNull(); // overlay cleared on handoff
		expect(player.play).toHaveBeenCalledWith(track, { fresh: true });
		expect(player.current?.uid).toBe(track.uid);
	});

	it('on a miss (null): clears pendingTrack, loading false, returns null', async () => {
		mockResolve.mockResolvedValue(null);

		const out = await player.playStub('Nobody', 'Nothing');

		expect(out).toBeNull();
		expect(player.pendingTrack).toBeNull();
		expect(player.loading).toBe(false);
		expect(player.play).not.toHaveBeenCalled();
	});

	it('never throws even when resolveStub rejects (returns null, clears overlay)', async () => {
		mockResolve.mockRejectedValue(new Error('search down'));

		await expect(player.playStub('X', 'Y')).resolves.toBeNull();
		expect(player.pendingTrack).toBeNull();
		expect(player.loading).toBe(false);
	});

	it('after a miss, the SAME song can be tapped again (key cleared, not stuck deduped)', async () => {
		mockResolve.mockResolvedValueOnce(null);
		await player.playStub('Retry', 'Me'); // miss clears pendingKey

		const track = mk('kuwo', '2', 'Retry', 'Me');
		mockResolve.mockResolvedValueOnce(track);
		const out = await player.playStub('Retry', 'Me'); // not deduped — fresh attempt
		await flush();

		expect(out).toBe(track);
		expect(mockResolve).toHaveBeenCalledTimes(2);
	});
});

describe('player.prefetchNext — pre-resolve next track for gapless-ish play', () => {
	// prefetchNext is private + fired from the real play(); drive it directly (bracket access)
	// after seeding current + queue, so timing stays deterministic regardless of play()'s stub.
	const prefetch = () => (player as unknown as { prefetchNext(): Promise<void> })['prefetchNext']();

	it("pre-resolves the next track's details and writes resolved back into the queue", async () => {
		const cur = mk('netease', '0', 'A', 'Now');
		const next = stub('qq', '1', 'B', 'Next'); // unresolved — readiness guard does NOT short-circuit
		player.queue = [cur, next];
		player.current = cur;

		const resolved: Track = { ...next, detailsLoaded: true, audioUrl: 'https://cdn/next.mp3' };
		mockEnsure.mockResolvedValue(resolved);

		await prefetch();
		await flush();

		// Called once, with the next stub and an AbortSignal.
		expect(mockEnsure).toHaveBeenCalledTimes(1);
		expect(mockEnsure).toHaveBeenCalledWith(next, expect.any(AbortSignal));
		// Resolved track written back into queue[1] (so a later play() no-ops).
		expect(player.queue[1].detailsLoaded).toBe(true);
		expect(player.queue[1].audioUrl).toBe('https://cdn/next.mp3');
	});

	it('no-op at end of queue (no next track)', async () => {
		const cur = mk('netease', '0', 'A', 'Now');
		player.queue = [cur]; // current is the last entry
		player.current = cur;

		await prefetch();
		await flush();

		expect(mockEnsure).not.toHaveBeenCalled();
	});

	it('no-op when next track is already detailsLoaded (readiness guard satisfied)', async () => {
		const cur = mk('netease', '0', 'A', 'Now');
		const next = mk('qq', '1', 'B', 'Next'); // mk() is fully loaded (detailsLoaded:true + audioUrl)
		player.queue = [cur, next];
		player.current = cur;

		await prefetch();
		await flush();

		expect(mockEnsure).not.toHaveBeenCalled();
	});

	it('dedupes in-flight: a second prefetchNext for the same next track does not start a second resolve', async () => {
		const cur = mk('netease', '0', 'A', 'Now');
		const next = stub('qq', '1', 'B', 'Next');
		player.queue = [cur, next];
		player.current = cur;

		const d = deferred<Track>();
		mockEnsure.mockReturnValue(d.promise); // never settles until we resolve it

		void prefetch();
		void prefetch(); // same current/queue, still in flight → must NOT start a second resolve

		expect(mockEnsure).toHaveBeenCalledTimes(1);

		d.resolve({ ...next, detailsLoaded: true, audioUrl: 'https://cdn/next.mp3' }); // cleanup
		await flush();
	});

	it('discards a stale resolve when current changes mid-resolve', async () => {
		const cur = mk('netease', '0', 'A', 'Now');
		const next = stub('qq', '1', 'B', 'Next');
		player.queue = [cur, next];
		player.current = cur;

		const d = deferred<Track>();
		mockEnsure.mockReturnValue(d.promise);

		void prefetch(); // captures seedUid = cur.uid

		// Current changes away mid-resolve → the just-prefetched result is now stale.
		player.current = mk('kuwo', '9', 'Z', 'Unrelated');

		const resolved: Track = { ...next, detailsLoaded: true, audioUrl: 'https://cdn/stale.mp3' };
		d.resolve(resolved);
		await flush();

		// queue[1] must NOT be overwritten — the stale resolve was discarded.
		expect(player.queue[1]).toBe(next);
		expect(player.queue[1].audioUrl).toBeNull();
	});
});
