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
vi.mock('$lib/services/catalog', () => ({ ensureTrackDetails: vi.fn(), searchAll: vi.fn() }));
// Mock the cross-source fallback so the resilience tests drive runFallback's total-failure exit
// (null = all sources exhausted) without real network.
vi.mock('$lib/services/fallback', () => ({ tryFallback: vi.fn(), fallbackOrder: vi.fn(() => []) }));
// PLAY-10: restore()/persist() early-return under !browser. Flip browser ON so the restore
// migration path (persisted repeatMode → 'off'|'one') actually executes in node, and provide a
// minimal in-memory localStorage so persist()/restore() have a backing store to read/write.
vi.mock('$app/environment', () => ({ browser: true }));
// WR-02/CR-02: mock the IDB blob store so the offline-blob read in reresolveCurrent/play can be a
// DEFERRED promise (controls the await window the gen re-check guards). Defaults to a miss.
vi.mock('$lib/services/blob-store', () => ({
	blobStore: { get: vi.fn(async () => null), put: vi.fn(), del: vi.fn() }
}));
// QUEUE-05 (17-02): mock the two up-next generators so a test can OBSERVE the exclude/`have` Set
// passed to them (the removedUids-exclusion assertions) without real network. Both default to []
// — the same "sources dry → adds nothing" outcome the real fns hit headless, so the existing
// end-of-queue / ensureAhead tests keep their behaviour (they already assert "adds nothing").
vi.mock('$lib/services/similar', () => ({ buildSimilarQueue: vi.fn(async () => []) }));
vi.mock('$lib/services/picks', () => ({ buildDiversePicks: vi.fn(async () => []) }));

const memStore = new Map<string, string>();
const localStorageMock: Storage = {
	get length() {
		return memStore.size;
	},
	clear: () => memStore.clear(),
	getItem: (k: string) => (memStore.has(k) ? (memStore.get(k) as string) : null),
	key: (i: number) => Array.from(memStore.keys())[i] ?? null,
	removeItem: (k: string) => void memStore.delete(k),
	setItem: (k: string, v: string) => void memStore.set(k, String(v))
};
vi.stubGlobal('localStorage', localStorageMock);

import { player } from './player.svelte';
import { settings } from './settings.svelte';
import { library } from '$lib/stores/library.svelte';
import { resolveStub } from '$lib/services/discovery';
import { ensureTrackDetails } from '$lib/services/catalog';
import { tryFallback } from '$lib/services/fallback';
import { blobStore } from '$lib/services/blob-store';
import { buildSimilarQueue } from '$lib/services/similar';
import { buildDiversePicks } from '$lib/services/picks';

const mockResolve = vi.mocked(resolveStub);
const mockEnsure = vi.mocked(ensureTrackDetails);
const mockTryFallback = vi.mocked(tryFallback);
const mockBlobGet = vi.mocked(blobStore.get);
const mockSimilar = vi.mocked(buildSimilarQueue);
const mockPicks = vi.mocked(buildDiversePicks);

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

/** Mirror of Player.FAILURE_CAP (private static = 5) for the loop-guard tests. */
const Player_FAILURE_CAP = 5;
/** Mirror of Player.STALL_TIMEOUT_MS (private static = 15000) for the stall-watchdog tests. */
const Player_STALL_TIMEOUT_MS = 15000;

/**
 * Minimal fake <audio> for attach(): records addEventListener handlers so a test can `.fire()`
 * a named event, and stubs the methods/props attach() + the listeners touch. navigator.mediaSession
 * is absent in node, so the `ms` accessor returns null and the Media Session calls early-return.
 */
function makeFakeAudio() {
	const handlers = new Map<string, Array<() => void>>();
	return {
		_handlers: handlers,
		paused: true,
		currentTime: 0,
		duration: NaN,
		src: '',
		setAttribute() {},
		addEventListener(type: string, cb: () => void) {
			const arr = handlers.get(type) ?? [];
			arr.push(cb);
			handlers.set(type, arr);
		},
		play: vi.fn(() => Promise.resolve()),
		pause: vi.fn(),
		fire(type: string) {
			for (const cb of handlers.get(type) ?? []) cb();
		}
	};
}

beforeEach(() => {
	mockResolve.mockReset();
	mockEnsure.mockReset();
	memStore.clear();
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
	// IN-02: vi.restoreAllMocks() does NOT undo vi.stubGlobal — without this, a stubbed
	// `navigator` (e.g. the offline suite's { onLine: false }) would persist into later suites in
	// this worker, leaving a truthy-but-mediaSession-less navigator that the `ms` accessor's
	// feature detection would see. Unstub globally after every test as the single safety net…
	vi.unstubAllGlobals();
	// …then re-establish the module-level localStorage stub that unstubAllGlobals also tears down
	// (it is set once at import, not per-test; restore()/persist() tests depend on it).
	vi.stubGlobal('localStorage', localStorageMock);
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

	it('ended → next() auto-advance reaches play() (which fires prefetchNext) — PLAY-09/D-15', () => {
		// The ended listener (repeatMode 'off') calls next(); next() → play(queue[i+1]); play()'s
		// tail fires `void this.prefetchNext()`. play() is stubbed here so we assert the advance
		// hand-off: ended drives next() which calls play() with the next queue entry. That play()
		// in production is the unconditional prefetchNext trigger on the auto-advance path.
		const cur = mk('netease', '0', 'A', 'Now');
		const next = mk('qq', '1', 'B', 'Next');
		player.queue = [cur, next];
		player.current = cur;
		player.repeatMode = 'off';

		const el = makeFakeAudio();
		player.attach(el as unknown as HTMLAudioElement);
		const playSpy = player.play as unknown as ReturnType<typeof vi.fn>;
		playSpy.mockClear();

		el.fire('ended');

		expect(playSpy).toHaveBeenCalledWith(next);
	});
});

describe('player repeat — 2-state (PLAY-10)', () => {
	// Seed the persisted player-state blob the way persist() writes it: a serialized `current`
	// with a real uid (restore early-returns without one), an empty queue, and the target
	// repeatMode. restore() then resolves the track via the mocked ensureTrackDetails so it
	// doesn't hang on the network — and audio is null in node, so restore returns right after
	// the repeatMode migration assignment we're asserting.
	const STATE_KEY = 'openmusic:player:v1';
	function seedState(repeatMode: 'off' | 'one' | 'all' | undefined) {
		const cur = mk('netease', 'r1', 'Artist', 'Title');
		const payload: Record<string, unknown> = {
			v: 1,
			current: {
				uid: cur.uid,
				source: cur.source,
				songid: cur.songid,
				title: cur.title,
				artist: cur.artist,
				album: cur.album,
				cover: cur.cover,
				quality: cur.quality,
				qualityLabel: cur.qualityLabel,
				keyword: cur.keyword,
				displayIndex: cur.displayIndex
			},
			queue: [],
			currentTime: 0,
			shuffle: false
		};
		if (repeatMode !== undefined) payload.repeatMode = repeatMode;
		localStorage.setItem(STATE_KEY, JSON.stringify(payload));
		// ensureTrackDetails is awaited inside restore(); resolve a complete track so it settles.
		mockEnsure.mockResolvedValue(mk('netease', 'r1', 'Artist', 'Title'));
	}

	beforeEach(() => {
		player.repeatMode = 'off';
	});

	it("cycleRepeat from 'off' yields 'one'", () => {
		player.repeatMode = 'off';
		player.cycleRepeat();
		expect(player.repeatMode).toBe('one');
	});

	it("cycleRepeat from 'one' yields 'off' (never 'all')", () => {
		player.repeatMode = 'one';
		player.cycleRepeat();
		expect(player.repeatMode).toBe('off');
	});

	it("cycleRepeat is a strict 2-state toggle (off→one→off→one)", () => {
		player.repeatMode = 'off';
		player.cycleRepeat();
		expect(player.repeatMode).toBe('one');
		player.cycleRepeat();
		expect(player.repeatMode).toBe('off');
		player.cycleRepeat();
		expect(player.repeatMode).toBe('one');
	});

	it("restore() with persisted repeatMode 'all' migrates to 'off' (D-11)", async () => {
		seedState('all' as 'off');
		await player.restore();
		expect(player.repeatMode).toBe('off');
	});

	it("restore() with persisted repeatMode 'one' stays 'one'", async () => {
		seedState('one');
		await player.restore();
		expect(player.repeatMode).toBe('one');
	});

	it("restore() with missing repeatMode defaults to 'off'", async () => {
		seedState(undefined);
		await player.restore();
		expect(player.repeatMode).toBe('off');
	});

	it('next() at end-of-queue does NOT wrap to queue[0]; it grows via ensureAhead (no repeat-all path)', async () => {
		const a = mk('netease', 'qa', 'A', 'First');
		const b = mk('qq', 'qb', 'B', 'Last');
		player.queue = [a, b];
		player.current = b; // current is the last entry → end of queue
		// Even if a stale 'all' value were somehow present, there is no wrap branch any more.
		(player as unknown as { repeatMode: string }).repeatMode = 'off';

		const playSpy = player.play as unknown as ReturnType<typeof vi.fn>;
		playSpy.mockClear();

		player.next();
		await flush();

		// next() must NOT have played queue[0] (the removed repeat-all wrap). The end-of-queue
		// path is solely ensureAhead().then(...); with sources dry/empty it adds nothing and the
		// post-grow advance finds no next track, so play() is never called with queue[0].
		expect(playSpy).not.toHaveBeenCalledWith(a);
	});
});

describe('player resilience — loop-guard + skip-on-failure (PLAY-07/08)', () => {
	// runFallback is private + driven by the audio `error` path in production; drive it directly
	// (bracket access) with tryFallback mocked to null = "all sources exhausted for this song".
	const runFallback = (failed: Track) =>
		(player as unknown as { runFallback(f: Track): Promise<void> })['runFallback'](failed);
	// Internal counter for asserting the increment/reset behavior (it's a private loop-guard budget).
	const failures = () => (player as unknown as { consecutiveFailures: number })['consecutiveFailures'];
	const setFailures = (n: number) => {
		(player as unknown as { consecutiveFailures: number })['consecutiveFailures'] = n;
	};

	beforeEach(() => {
		mockTryFallback.mockReset();
		mockTryFallback.mockResolvedValue(null); // every source exhausted → total failure
		setFailures(0);
		// Reset the skip-burst batch state (private; persists on the singleton across tests).
		const p = player as unknown as {
			skipBurst: number;
			skipBurstTimer: ReturnType<typeof setTimeout> | null;
		};
		if (p.skipBurstTimer) clearTimeout(p.skipBurstTimer);
		p.skipBurst = 0;
		p.skipBurstTimer = null;
		player.notice = null;
		player.repeatMode = 'off';
		player.current = null;
		player.queue = [];
		// online by default so the offline gate (Task 3) does not short-circuit these tests.
		vi.stubGlobal('navigator', { onLine: true });
	});

	it('below the cap: increments the counter, emits a skip notice, and calls next()', async () => {
		const a = mk('netease', 'a', 'A', 'Dead Song');
		const b = mk('qq', 'b', 'B', 'Next Song');
		player.queue = [a, b];
		player.current = a;
		const playSpy = player.play as unknown as ReturnType<typeof vi.fn>;
		playSpy.mockClear();

		await runFallback(a);
		await flush();

		expect(failures()).toBe(1);
		expect(player.notice?.kind).toBe('skip');
		expect(player.notice?.count).toBe(1);
		expect(player.notice?.title).toBe('Dead Song');
		// next() auto-skipped to queue[1].
		expect(playSpy).toHaveBeenCalledWith(b);
	});

	it('batches consecutive skips into one notice with a rising count (D-02)', async () => {
		const a = mk('netease', 'a', 'A', 'One');
		const b = mk('qq', 'b', 'B', 'Two');
		player.queue = [a, b];
		player.current = a;

		await runFallback(a);
		await runFallback(b);
		await flush();

		expect(failures()).toBe(2);
		expect(player.notice?.kind).toBe('skip');
		expect(player.notice?.count).toBe(2); // collapsed, not two separate notices
	});

	it('at the cap: pauses, sets a sticky stopped notice with a Retry action, does NOT call next()', async () => {
		const a = mk('netease', 'a', 'A', 'Dead');
		const b = mk('qq', 'b', 'B', 'Next');
		player.queue = [a, b];
		player.current = a;
		setFailures(Player_FAILURE_CAP - 1); // one more failure trips the guard
		const playSpy = player.play as unknown as ReturnType<typeof vi.fn>;
		playSpy.mockClear();

		await runFallback(a);
		await flush();

		expect(failures()).toBe(Player_FAILURE_CAP);
		expect(player.notice?.kind).toBe('stopped');
		expect(player.notice?.reason).toBe('loop-guard');
		expect(typeof player.notice?.action).toBe('function');
		expect(player.error).toBeTruthy(); // inline now-bar error still set
		// Loop-guard stops auto-advance.
		expect(playSpy).not.toHaveBeenCalled();
	});

	it('the Retry action resets the counter, clears the notice, and skips ahead (D-05)', async () => {
		const a = mk('netease', 'a', 'A', 'Dead');
		const b = mk('qq', 'b', 'B', 'Next');
		player.queue = [a, b];
		player.current = a;
		setFailures(Player_FAILURE_CAP - 1);
		await runFallback(a);
		await flush();
		expect(player.notice?.kind).toBe('stopped');

		const playSpy = player.play as unknown as ReturnType<typeof vi.fn>;
		playSpy.mockClear();
		player.notice?.action?.(); // user taps Retry
		await flush();

		expect(failures()).toBe(0); // counter reset
		expect(player.notice).toBeNull(); // sticky notice cleared
		expect(playSpy).toHaveBeenCalledWith(b); // skipped AHEAD to the next track, not retry-current
	});

	it('a real `playing` event resets the counter and clears a stopped notice (D-06)', () => {
		setFailures(3);
		player.notice = { kind: 'stopped', reason: 'loop-guard', msg: 'toast.playbackStopped' };
		// Simulate the audio element firing `playing` by invoking the bound listener via a fake element.
		const el = makeFakeAudio();
		player.attach(el as unknown as HTMLAudioElement);
		el.fire('playing');

		expect(failures()).toBe(0);
		expect(player.notice).toBeNull();
	});

	it('CR-01: the `play` event alone does NOT reset the counter (it fires before audio loads)', () => {
		setFailures(3);
		player.notice = { kind: 'stopped', reason: 'loop-guard', msg: 'toast.playbackStopped' };
		const el = makeFakeAudio();
		player.attach(el as unknown as HTMLAudioElement);
		// `play` fires the instant audio.play() is called, before any byte loads — it must NOT be
		// treated as a success. Only `playing` (real output) resets the loop-guard budget.
		el.fire('play');

		expect(failures()).toBe(3); // untouched by `play`
		expect(player.notice?.kind).toBe('stopped'); // sticky notice survives a bare `play`
	});

	it('CR-01: error-event failures still reach the cap even when each play fires a `play` event', async () => {
		// Regression for the dominant failure mode: a URL resolves but the <audio> errors. Each
		// auto-skip's play() fires `play` instantly; before the fix that reset consecutiveFailures
		// 0↔1 forever and the cap of 5 was unreachable. With the fix, `play` no longer resets, so a
		// run of total failures (tryFallback → null) climbs to the cap and trips the loop-guard.
		const dead = mk('netease', 'dead', 'A', 'Region Locked');
		player.queue = [dead];
		player.current = dead;
		const el = makeFakeAudio();
		player.attach(el as unknown as HTMLAudioElement);

		// Simulate FAILURE_CAP consecutive failures, each preceded by a bare `play` event (the
		// transport flipped to playing) but NO `playing` event (audio never actually started).
		for (let i = 0; i < Player_FAILURE_CAP; i++) {
			el.fire('play'); // transport intent — must not reset the counter
			await runFallback(dead); // tryFallback → null → handleTotalFailure increments
			await flush();
		}

		expect(failures()).toBe(Player_FAILURE_CAP);
		expect(player.notice?.kind).toBe('stopped');
		expect(player.notice?.reason).toBe('loop-guard');
	});

	it('CR-03: a resolve-but-unplayable ping-pong (tryFallback keeps succeeding) trips the cap via errorBurst', async () => {
		// The audio `error` listener routes into runFallback; tryFallback keeps "succeeding"
		// (resolving a swap whose URL also 403s), so handleTotalFailure NEVER runs and
		// consecutiveFailures stays 0 — the classic unbounded loop. The errorBurst backstop counts
		// raw error events and trips the loop-guard at the cap regardless. play() is the global
		// mock, so the swap never fires a real `playing` (errorBurst is never reset).
		const a = mk('netease', 'a', 'A', 'Pingpong');
		const swap = mk('qq', 'a2', 'A', 'Pingpong'); // same song, different (also-dead) source
		mockTryFallback.mockResolvedValue(swap); // ALWAYS finds a resolvable-but-unplayable source
		player.queue = [a];
		player.current = a;
		const el = makeFakeAudio();
		player.attach(el as unknown as HTMLAudioElement);
		// lastSeekAt defaults to 0, so Date.now()-lastSeekAt ≫ SEEK_ERROR_WINDOW_MS → the error
		// takes the non-seek cross-source branch (not reresolveCurrent).

		const errorBurst = () => (player as unknown as { errorBurst: number })['errorBurst'];

		// Fire FAILURE_CAP error events outside the seek window. Each increments errorBurst; the
		// Nth (== cap) routes straight into handleTotalFailure (the loop-guard) instead of yet
		// another fallback.
		for (let i = 0; i < Player_FAILURE_CAP; i++) {
			el.fire('error');
			await flush();
		}

		expect(player.notice?.kind).toBe('stopped');
		expect(player.notice?.reason).toBe('loop-guard');
		expect(errorBurst()).toBe(0); // reset after tripping the guard

		mockTryFallback.mockResolvedValue(null); // restore the suite default
	});

	it('repeat-one breaks to off on a failing loop before skipping (D-12)', async () => {
		const a = mk('netease', 'a', 'A', 'Looping Dead');
		const b = mk('qq', 'b', 'B', 'Next');
		player.queue = [a, b];
		player.current = a;
		player.repeatMode = 'one';

		await runFallback(a);
		await flush();

		expect(player.repeatMode).toBe('off'); // never-stop wins over explicit repeat
		expect(player.notice?.kind).toBe('skip');
	});
});

describe('player resilience — stall watchdog (PLAY-07 / D-13/D-14)', () => {
	// armStall/disarmStall are private; drive them directly + observe via a runFallback spy.
	const armStall = () => (player as unknown as { armStall(): void })['armStall']();
	const setPlayed = (v: boolean) => {
		(player as unknown as { hasPlayedSinceSrc: boolean })['hasPlayedSinceSrc'] = v;
	};
	let runFallbackSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		vi.useFakeTimers();
		player.current = mk('netease', 's', 'A', 'Stalling');
		player.queue = [player.current];
		setPlayed(false);
		// Spy runFallback so the watchdog firing is observable without real network.
		runFallbackSpy = vi
			.spyOn(player as unknown as { runFallback(f: Track): Promise<void> }, 'runFallback')
			.mockResolvedValue(undefined);
	});

	afterEach(() => {
		(player as unknown as { disarmStall(): void })['disarmStall']();
		vi.useRealTimers();
	});

	it('after src-set with no audio, advancing STALL_TIMEOUT_MS routes into runFallback (D-13)', () => {
		armStall();
		vi.advanceTimersByTime(Player_STALL_TIMEOUT_MS);
		expect(runFallbackSpy).toHaveBeenCalledTimes(1);
		expect(runFallbackSpy).toHaveBeenCalledWith(player.current);
	});

	it('a timeupdate before the timeout disarms the watchdog (no failover)', () => {
		const el = makeFakeAudio();
		player.attach(el as unknown as HTMLAudioElement);
		armStall();
		// Audio starts producing — the first timeupdate disarms.
		el.fire('timeupdate');
		vi.advanceTimersByTime(Player_STALL_TIMEOUT_MS);
		expect(runFallbackSpy).not.toHaveBeenCalled();
	});

	it('a playing event before the timeout disarms the watchdog (no failover)', () => {
		const el = makeFakeAudio();
		player.attach(el as unknown as HTMLAudioElement);
		armStall();
		el.fire('playing');
		vi.advanceTimersByTime(Player_STALL_TIMEOUT_MS);
		expect(runFallbackSpy).not.toHaveBeenCalled();
	});

	it('CR-01: a bare `play` event does NOT disarm the watchdog (it precedes real audio)', () => {
		const el = makeFakeAudio();
		player.attach(el as unknown as HTMLAudioElement);
		armStall();
		// `play` is transport intent, not real output — the watchdog must still fire if no audio
		// (`playing`/`timeupdate`) follows within the timeout.
		el.fire('play');
		vi.advanceTimersByTime(Player_STALL_TIMEOUT_MS);
		expect(runFallbackSpy).toHaveBeenCalledTimes(1);
	});

	it('does NOT fail over when hasPlayedSinceSrc is true at fire time (mid-track buffer-dry, D-14)', () => {
		armStall();
		setPlayed(true); // audio already played — a later buffer stall is NOT a load failure
		vi.advanceTimersByTime(Player_STALL_TIMEOUT_MS);
		expect(runFallbackSpy).not.toHaveBeenCalled();
	});

	it('WR-05: an explicit pause during initial load disarms the watchdog (no auto-failover)', () => {
		const el = makeFakeAudio();
		player.attach(el as unknown as HTMLAudioElement);
		armStall();
		// User taps pause within the 15s initial-load window — opting out of this load. The
		// watchdog must NOT, 15s later, runFallback → play(swap) and start audio over the pause.
		el.fire('pause');
		vi.advanceTimersByTime(Player_STALL_TIMEOUT_MS);
		expect(runFallbackSpy).not.toHaveBeenCalled();
	});
});

describe('player resilience — offline gate + downloads switch (PLAY-09 / D-07/D-08)', () => {
	const runFallback = (failed: Track) =>
		(player as unknown as { runFallback(f: Track): Promise<void> })['runFallback'](failed);
	const failures = () => (player as unknown as { consecutiveFailures: number })['consecutiveFailures'];
	const setFailures = (n: number) => {
		(player as unknown as { consecutiveFailures: number })['consecutiveFailures'] = n;
	};

	beforeEach(() => {
		mockTryFallback.mockReset();
		mockTryFallback.mockResolvedValue(null);
		setFailures(0);
		player.notice = null;
		player.error = null;
		player.current = null;
		player.queue = [];
		library.downloads = [];
		// Offline for this block.
		vi.stubGlobal('navigator', { onLine: false });
	});

	afterEach(() => {
		library.downloads = [];
		// IN-02: the top-level afterEach unstubs navigator globally — no need to re-stub onLine:true
		// here (which would itself leave a lingering stub).
	});

	it('offline: does NOT call tryFallback and does NOT increment the counter (D-08)', async () => {
		const a = mk('netease', 'a', 'A', 'Song');
		player.queue = [a];
		player.current = a;

		await runFallback(a);
		await flush();

		expect(mockTryFallback).not.toHaveBeenCalled();
		expect(failures()).toBe(0); // offline ≠ failure — the loop-guard budget is untouched
	});

	it('offline WITH downloads: switches up-next to downloads and continues playing (D-07)', async () => {
		const a = mk('netease', 'a', 'A', 'Failed');
		const dl1 = mk('qq', 'd1', 'D1', 'Downloaded One');
		const dl2 = mk('kuwo', 'd2', 'D2', 'Downloaded Two');
		player.queue = [a];
		player.current = a;
		library.downloads = [dl1, dl2];

		const playSpy = player.play as unknown as ReturnType<typeof vi.fn>;
		playSpy.mockClear();

		await runFallback(a);
		await flush();

		// First downloaded track is played; the queue now holds the downloads.
		expect(playSpy).toHaveBeenCalledWith(dl1);
		expect(player.queue.some((t) => t.uid === dl1.uid)).toBe(true);
		expect(failures()).toBe(0); // still no counter burn
	});

	it('offline with NO downloads: pauses + sets a sticky offline notice (D-08)', async () => {
		const a = mk('netease', 'a', 'A', 'Failed');
		player.queue = [a];
		player.current = a;
		library.downloads = [];

		const playSpy = player.play as unknown as ReturnType<typeof vi.fn>;
		playSpy.mockClear();

		await runFallback(a);
		await flush();

		expect(playSpy).not.toHaveBeenCalled();
		expect(player.notice?.kind).toBe('stopped');
		expect(player.notice?.reason).toBe('offline');
		expect(player.error).toBeTruthy();
		expect(failures()).toBe(0);
	});
});

describe('player.play — generation guard against stale slow resolves (CR-02)', () => {
	// These exercise the REAL play() (the global beforeEach spies it; we restore the original
	// here so the generation re-checks actually run). ensureTrackDetails is mocked with deferred
	// promises so we control settle order: a slow play(A) and a fast play(B), then settle A LAST.
	let el: ReturnType<typeof makeFakeAudio>;

	beforeEach(() => {
		(player.play as unknown as { mockRestore(): void }).mockRestore?.();
		mockEnsure.mockReset();
		player.current = null;
		player.queue = [];
		player.error = null;
		player.loading = false;
		vi.stubGlobal('navigator', { onLine: true });
		el = makeFakeAudio();
		player.attach(el as unknown as HTMLAudioElement);
		// Downloaded-lookup off so play() takes the network/CDN branch (no IDB).
		vi.spyOn(library, 'isDownloaded').mockReturnValue(false);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('a slow play(A) that settles AFTER a fast play(B) is discarded — current + src stay on B', async () => {
		const stubA = stub('netease', 'A', 'Artist A', 'Song A');
		const stubB = stub('qq', 'B', 'Artist B', 'Song B');
		const resolvedA: Track = { ...mk('netease', 'A', 'Artist A', 'Song A'), audioUrl: 'https://cdn/a.mp3' };
		const resolvedB: Track = { ...mk('qq', 'B', 'Artist B', 'Song B'), audioUrl: 'https://cdn/b.mp3' };

		const dA = deferred<Track>();
		const dB = deferred<Track>();
		// First ensureTrackDetails call (A) gets the slow deferred; second (B) the fast one.
		mockEnsure.mockReturnValueOnce(dA.promise).mockReturnValueOnce(dB.promise);

		void player.play(stubA); // gen → 1, awaits A's slow resolve
		void player.play(stubB); // gen → 2, supersedes A

		// B resolves first and starts playing.
		dB.resolve(resolvedB);
		await flush();
		expect(player.current?.uid).toBe(resolvedB.uid);
		expect(el.src).toBe('https://cdn/b.mp3');

		// A's slow resolve settles LAST — its continuation must bail on the gen re-check and NOT
		// clobber current/src with the stale, earlier-tapped track.
		dA.resolve(resolvedA);
		await flush();
		expect(player.current?.uid).toBe(resolvedB.uid); // still B — A discarded
		expect(el.src).toBe('https://cdn/b.mp3');
	});
});

describe('player.reresolveCurrent — gen guard after the blob await (WR-02)', () => {
	// reresolveCurrent re-attaches the SAME track after a stale-URL seek error. It already
	// gen-checks after ensureTrackDetails, but a downloaded track has a SECOND await (blobStore.get)
	// before audio.src is written; a play() landing in that window would otherwise get its fresh src
	// overwritten. Drive reresolveCurrent (private) with a deferred blob read and bump playGen
	// mid-read.
	const reresolve = () =>
		(player as unknown as { reresolveCurrent(): Promise<void> })['reresolveCurrent']();
	let el: ReturnType<typeof makeFakeAudio>;

	beforeEach(() => {
		(player.play as unknown as { mockRestore(): void }).mockRestore?.();
		mockEnsure.mockReset();
		mockBlobGet.mockReset();
		vi.stubGlobal('navigator', { onLine: true });
		el = makeFakeAudio();
		player.attach(el as unknown as HTMLAudioElement);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('a newer play() landing during the IDB blob read discards the stale src write', async () => {
		const cur = mk('netease', 'X', 'Artist', 'Song');
		player.current = cur;
		player.queue = [cur];
		el.src = 'NEW-SRC-FROM-PLAY'; // stand-in for the src a concurrent play() already set

		// Resolve returns a downloaded track so reresolveCurrent enters the blob branch.
		const resolved: Track = { ...cur, audioUrl: 'https://cdn/old-reresolved.mp3' };
		mockEnsure.mockResolvedValue(resolved);
		vi.spyOn(library, 'isDownloaded').mockReturnValue(true);
		const dBlob = deferred<Blob | null>();
		mockBlobGet.mockReturnValue(dBlob.promise);

		const p = reresolve(); // captures myGen = current playGen
		await flush(); // run up to the awaited blobStore.get

		// A newer play() bumps playGen while the blob read is in flight.
		(player as unknown as { playGen: number }).playGen++;

		dBlob.resolve(null);
		await p;
		await flush();

		// reresolveCurrent must have bailed on the post-blob gen re-check — the src a concurrent
		// play() set is NOT clobbered with the stale re-resolved URL.
		expect(el.src).toBe('NEW-SRC-FROM-PLAY');
	});
});

describe('player.queueContext — context-threaded setQueue/playStub (Phase 17 QUEUE-03)', () => {
	// These use the global beforeEach's MOCKED play() — we only assert queueContext + that play
	// is handed the resolved track. setQueue is a synchronous field set, no real <audio> needed.
	it("setQueue(tracks, 'search') sets queueContext to 'search'", () => {
		player.setQueue([mk('netease', '1', 'A', 'S')], 'search');
		expect(player.queueContext).toBe('search');
	});

	it('setQueue(tracks) with no context defaults queueContext to null', () => {
		player.setQueue([mk('netease', '1', 'A', 'S')], 'liked'); // first set a non-null context
		player.setQueue([mk('qq', '2', 'B', 'T')]); // then call with no arg
		expect(player.queueContext).toBeNull();
	});

	it("playStub threads its context arg through the internal setQueue", async () => {
		const track = mk('netease', 'hit', '周杰伦', '稻香');
		mockResolve.mockResolvedValue(track);
		await player.playStub('周杰伦', '稻香', null, 'home-discovery');
		await flush();
		expect(player.queueContext).toBe('home-discovery');
		expect(player.play).toHaveBeenCalledWith(track, { fresh: true });
	});

	it('queueContext is NOT written to the persisted player snapshot', () => {
		player.current = mk('netease', '1', 'A', 'S');
		player.setQueue([mk('netease', '1', 'A', 'S')], 'album');
		const raw = localStorage.getItem('openmusic:player:v1');
		expect(raw).toBeTruthy();
		expect(JSON.parse(raw as string)).not.toHaveProperty('queueContext');
	});
});

describe('player.play — auto-expand fresh-only guard + per-context branch (Phase 17 QUEUE-01/D-05)', () => {
	// Exercise the REAL play() (restore the global spy) with a fake <audio>, mocked resolve, and
	// spies on the private regenerate/ensureAhead so we observe the branch without real network.
	let el: ReturnType<typeof makeFakeAudio>;
	const resolved = (s: SourceId, id: string): Track => ({
		...mk(s, id, 'Artist', 'Song'),
		audioUrl: `https://cdn/${id}.mp3`
	});

	beforeEach(() => {
		(player.play as unknown as { mockRestore(): void }).mockRestore?.();
		mockEnsure.mockReset();
		player.current = null;
		player.queue = [];
		player.queueContext = null;
		player.expanded = false;
		player.error = null;
		player.loading = false;
		vi.stubGlobal('navigator', { onLine: true });
		el = makeFakeAudio();
		player.attach(el as unknown as HTMLAudioElement);
		vi.spyOn(library, 'isDownloaded').mockReturnValue(false);
		// Restore default settings so each case controls them explicitly.
		settings.autoExpandOnPlay = false;
		settings.upnextMode = 'generated';
		settings.upnextPerContext = {};
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		settings.autoExpandOnPlay = false;
		settings.upnextMode = 'generated';
		settings.upnextPerContext = {};
	});

	it('autoExpandOnPlay=true: a fresh play expands; a non-fresh play does NOT (D-05)', async () => {
		settings.autoExpandOnPlay = true;
		const r = resolved('netease', 'F');
		mockEnsure.mockResolvedValue(r);

		await player.play(stub('netease', 'F', 'Artist', 'Song'), { fresh: true });
		await flush();
		expect(player.expanded).toBe(true);

		// Reset, then a non-fresh play (auto-advance/failover path) must leave expanded unchanged.
		player.expanded = false;
		mockEnsure.mockResolvedValue(resolved('qq', 'N'));
		await player.play(stub('qq', 'N', 'Artist', 'Song')); // no opts.fresh
		await flush();
		expect(player.expanded).toBe(false);
	});

	it("a fresh play in a 'generated' context regenerates (similar-queue path)", async () => {
		const regenSpy = vi
			.spyOn(player as unknown as { regenerate(t: Track): Promise<void> }, 'regenerate')
			.mockResolvedValue(undefined);
		const aheadSpy = vi
			.spyOn(player as unknown as { ensureAhead(): Promise<void> }, 'ensureAhead')
			.mockResolvedValue(undefined);
		player.queueContext = 'search'; // 'search' resolves to global 'generated' default
		mockEnsure.mockResolvedValue(resolved('netease', 'G'));

		await player.play(stub('netease', 'G', 'Artist', 'Song'), { fresh: true });
		await flush();
		expect(regenSpy).toHaveBeenCalledTimes(1);
		expect(aheadSpy).not.toHaveBeenCalled();
	});

	it("a fresh play in a 'same-list' context does NOT regenerate (snapshot survives)", async () => {
		const regenSpy = vi
			.spyOn(player as unknown as { regenerate(t: Track): Promise<void> }, 'regenerate')
			.mockResolvedValue(undefined);
		const aheadSpy = vi
			.spyOn(player as unknown as { ensureAhead(): Promise<void> }, 'ensureAhead')
			.mockResolvedValue(undefined);
		settings.upnextPerContext = { liked: 'same-list' };
		player.queueContext = 'liked';
		mockEnsure.mockResolvedValue(resolved('netease', 'S'));

		await player.play(stub('netease', 'S', 'Artist', 'Song'), { fresh: true });
		await flush();
		expect(regenSpy).not.toHaveBeenCalled();
		expect(aheadSpy).toHaveBeenCalledTimes(1); // snapshot still grows on exhaust (D-03)
	});
});

describe('player.removeFromQueue / clearQueue / removedUids (Phase 17 QUEUE-05 / D-08..D-10)', () => {
	// These use the global beforeEach's MOCKED play() (synchronous current set). removeFromQueue
	// and clearQueue are synchronous queue mutations; the removedUids exclusion is observed via the
	// mocked buildSimilarQueue / buildDiversePicks exclude-Set argument.
	beforeEach(() => {
		mockSimilar.mockReset().mockResolvedValue([]);
		mockPicks.mockReset().mockResolvedValue([]);
		player.current = null;
		player.queue = [];
		player.queueContext = null;
	});

	it('removeFromQueue(uid) drops the matching entry from the queue', () => {
		const a = mk('netease', '1', 'A', 'S1');
		const b = mk('qq', '2', 'B', 'S2');
		player.queue = [a, b];
		player.removeFromQueue(b.uid);
		expect(player.queue.map((t) => t.uid)).toEqual([a.uid]);
	});

	it('removeFromQueue(uid) deletes it from manual pins (a pinned track can still be swiped away)', () => {
		const a = mk('netease', '1', 'A', 'S1');
		const b = mk('qq', '2', 'B', 'S2');
		player.current = a; // a is playing, so addToQueue(b) does not auto-play b (b ≠ current)
		player.queue = [a, b];
		player.addToQueue(b); // pins b into manualUids (already in queue → dedupe keeps one)
		const manual = (player as unknown as { manualUids: Set<string> }).manualUids;
		expect(manual.has(b.uid)).toBe(true);
		player.removeFromQueue(b.uid);
		expect(manual.has(b.uid)).toBe(false);
	});

	it('removeFromQueue(current.uid) is a NO-OP — never-stop: the playing track survives (CR-01)', () => {
		const cur = mk('netease', 'C', 'A', 'Cur');
		const b = mk('qq', '2', 'B', 'S2');
		player.current = cur;
		player.queue = [cur, b];
		player.removeFromQueue(cur.uid);
		// Queue unchanged — removing the current track would orphan indexOf(current), killing
		// next()/ensureAhead/prefetchNext AND persisting the broken state (CR-01).
		expect(player.queue.map((t) => t.uid)).toEqual([cur.uid, b.uid]);
		// And the uid is NOT session-excluded (the removal never happened).
		expect((player as unknown as { removedUids: Set<string> }).removedUids.has(cur.uid)).toBe(false);
	});

	it('clearQueue() leaves queue = [current] when a current track exists and clears pins', () => {
		const cur = mk('netease', 'C', 'A', 'Cur');
		const a = mk('qq', '1', 'B', 'S1');
		player.current = cur;
		player.queue = [cur, a];
		player.addToQueue(a); // pin a
		player.clearQueue();
		expect(player.queue.map((t) => t.uid)).toEqual([cur.uid]); // only current survives (D-08)
		expect((player as unknown as { manualUids: Set<string> }).manualUids.size).toBe(0);
	});

	it('clearQueue() leaves an empty queue when there is no current track', () => {
		player.current = null;
		player.queue = [mk('netease', '1', 'A', 'S1'), mk('qq', '2', 'B', 'S2')];
		player.clearQueue();
		expect(player.queue).toEqual([]);
	});

	it('clearQueue() does NOT trigger an immediate regenerate/ensureAhead (D-09 — refill near end only)', async () => {
		const regenSpy = vi
			.spyOn(player as unknown as { regenerate(t: Track): Promise<void> }, 'regenerate')
			.mockResolvedValue(undefined);
		const aheadSpy = vi
			.spyOn(player as unknown as { ensureAhead(): Promise<void> }, 'ensureAhead')
			.mockResolvedValue(undefined);
		const cur = mk('netease', 'C', 'A', 'Cur');
		player.current = cur;
		player.queue = [cur, mk('qq', '1', 'B', 'S1'), mk('kuwo', '2', 'C', 'S2')];
		player.clearQueue();
		await flush();
		expect(regenSpy).not.toHaveBeenCalled();
		expect(aheadSpy).not.toHaveBeenCalled();
		expect(player.queue.map((t) => t.uid)).toEqual([cur.uid]); // stays at [current]
	});

	it('a removeFromQueue uid is excluded from regenerate buildSimilarQueue exclude set (D-10)', async () => {
		const seed = mk('netease', 'SEED', 'A', 'Seed');
		const gone = mk('qq', 'GONE', 'B', 'Gone');
		player.queue = [seed, gone];
		player.removeFromQueue(gone.uid);
		await (player as unknown as { regenerate(t: Track): Promise<void> }).regenerate(seed);
		expect(mockSimilar).toHaveBeenCalledTimes(1);
		const excludeArg = mockSimilar.mock.calls[0][1] as Set<string>;
		expect(excludeArg.has(gone.uid)).toBe(true);
	});

	it('a removeFromQueue uid is excluded from ensureAhead buildDiversePicks `have` set (D-10/QUEUE-02)', async () => {
		const cur = mk('netease', 'C', 'A', 'Cur');
		const gone = mk('qq', 'GONE', 'B', 'Gone');
		player.current = cur;
		player.queue = [cur]; // within 2 of the end → ensureAhead runs
		player.removeFromQueue(gone.uid); // gone is no longer in queue, but must stay excluded
		await (player as unknown as { ensureAhead(): Promise<void> }).ensureAhead();
		expect(mockPicks).toHaveBeenCalledTimes(1);
		const haveArg = mockPicks.mock.calls[0][1] as Set<string>;
		expect(haveArg.has(gone.uid)).toBe(true);
	});

	it('a fresh play resets removedUids — the next regenerate no longer excludes the old uid', async () => {
		// This one drives the REAL play() fresh branch (where removedUids.clear() lives), so restore
		// the globally-spied play(), attach a fake <audio>, and drive a 'generated'-context fresh play.
		(player.play as unknown as { mockRestore?(): void }).mockRestore?.();
		vi.stubGlobal('navigator', { onLine: true });
		const el = makeFakeAudio();
		player.attach(el as unknown as HTMLAudioElement);
		vi.spyOn(library, 'isDownloaded').mockReturnValue(false);
		settings.upnextMode = 'generated';
		settings.upnextPerContext = {};
		player.queueContext = 'search'; // resolves to 'generated' → fresh play calls regenerate

		const gone = mk('qq', 'GONE', 'B', 'Gone');
		player.removeFromQueue(gone.uid); // session A: gone is excluded
		// A fresh play starts a NEW session → removedUids cleared BEFORE regenerate runs.
		mockEnsure.mockResolvedValue({ ...mk('netease', 'F', 'A', 'Song'), audioUrl: 'https://cdn/f.mp3' });
		await player.play(stub('netease', 'F', 'A', 'Song'), { fresh: true });
		await flush();
		// regenerate ran during the fresh play; its exclude set must NOT contain the old uid.
		expect(mockSimilar).toHaveBeenCalled();
		const excludeArg = mockSimilar.mock.calls[0][1] as Set<string>;
		expect(excludeArg.has(gone.uid)).toBe(false); // cleared on fresh play (D-10 session-scoped)
	});

	it('removedUids is NOT written to the persisted player snapshot (session-scoped, not serialized)', () => {
		player.current = mk('netease', 'C', 'A', 'Cur');
		player.removeFromQueue('qq:GONE');
		const raw = localStorage.getItem('openmusic:player:v1');
		expect(raw).toBeTruthy();
		expect(raw as string).not.toContain('removedUids');
		expect(raw as string).not.toContain('GONE');
	});
});
