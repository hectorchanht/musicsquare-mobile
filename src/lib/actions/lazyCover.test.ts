import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeUid, type SourceId, type Track } from '$lib/sources/types';

// lazyCover (Phase 21, COVER-02) resolves a track-row cover ONLY on first scroll-into-view. These
// tests pin the six behaviors: fire-once (unobserve-after-first + done flag), in-flight de-dupe for
// the same uid, destroy-disconnects, good-cover-skip (Image onload), broken-cover-repair (onerror →
// cache→chain), and the SSR guard (Image undefined → no throw). The node vitest project has no
// jsdom, so IntersectionObserver + Image are stubbed on globalThis and the cache + resolve helper
// are vi.mock'd — mirroring the discovery/cover-backfill spy style (no live DOM, no network).

// --- mock the cache + the shared single-item resolve helper -------------------------------------
const getCachedCoverByUid = vi.fn<(uid: string) => string | null>();
const getCachedCover = vi.fn<(artist: string, title: string) => string | null>();
const resolveCoverForTrack = vi.fn<(track: Track) => Promise<string | null>>();

vi.mock('$lib/services/cover-cache', () => ({
	getCachedCoverByUid: (uid: string) => getCachedCoverByUid(uid),
	getCachedCover: (artist: string, title: string) => getCachedCover(artist, title)
}));
vi.mock('$lib/services/cover-backfill', () => ({
	resolveCoverForTrack: (track: Track) => resolveCoverForTrack(track)
}));

// --- controllable IntersectionObserver stub -----------------------------------------------------
type IOCb = (entries: Array<{ isIntersecting: boolean }>) => void;
class MockIO {
	static instances: MockIO[] = [];
	cb: IOCb;
	observed: unknown[] = [];
	unobserved: unknown[] = [];
	disconnected = false;
	constructor(cb: IOCb) {
		this.cb = cb;
		MockIO.instances.push(this);
	}
	observe(node: unknown) {
		this.observed.push(node);
	}
	unobserve(node: unknown) {
		this.unobserved.push(node);
	}
	disconnect() {
		this.disconnected = true;
	}
	/** Test helper: fire an intersection. */
	trigger(isIntersecting = true) {
		this.cb([{ isIntersecting }]);
	}
}

// --- controllable Image stub (onload / onerror driven by the test) ------------------------------
let imageBehavior: 'load' | 'error' = 'load';
const imageInstances: MockImage[] = [];
class MockImage {
	decoding = '';
	referrerPolicy = '';
	onload: (() => void) | null = null;
	onerror: (() => void) | null = null;
	private _src = '';
	constructor() {
		imageInstances.push(this);
	}
	set src(v: string) {
		this._src = v;
		// Fire async to mirror the browser (and so onload/onerror are wired before firing).
		queueMicrotask(() => {
			if (imageBehavior === 'load') this.onload?.();
			else this.onerror?.();
		});
	}
	get src() {
		return this._src;
	}
}

function mkTrack(extra: Partial<Track> = {}): Track {
	const source: SourceId = 'netease';
	return {
		uid: makeUid(source, '12345'),
		source,
		songid: '12345',
		title: 'Dao Xiang',
		artist: 'Jay Chou',
		album: '',
		cover: null,
		audioUrl: null,
		lrc: null,
		lrcUrl: null,
		detailsLoaded: false,
		quality: null,
		qualityLabel: null,
		keyword: 'x',
		displayIndex: 1,
		...extra
	};
}

/** A flush helper for the microtask-driven Image + the async resolve chain. */
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

const origIO = (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
const origImage = (globalThis as { Image?: unknown }).Image;

beforeEach(() => {
	MockIO.instances = [];
	imageInstances.length = 0;
	imageBehavior = 'load';
	getCachedCoverByUid.mockReturnValue(null);
	getCachedCover.mockReturnValue(null);
	resolveCoverForTrack.mockResolvedValue('https://resolved.example/c.jpg');
	(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver =
		MockIO as unknown as typeof IntersectionObserver;
	(globalThis as { Image?: unknown }).Image = MockImage as unknown as typeof Image;
});

afterEach(() => {
	vi.clearAllMocks();
	(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = origIO;
	(globalThis as { Image?: unknown }).Image = origImage;
});

// Import AFTER the globals/mocks are in place (the action reads IntersectionObserver at mount).
async function mount(param: { track: Track; onResolved: (uid: string, url: string) => void }) {
	const { lazyCover } = await import('./lazyCover');
	const node = {} as HTMLElement;
	const handle = lazyCover(node, param);
	return { node, handle, io: MockIO.instances[MockIO.instances.length - 1] };
}

describe('lazyCover — IntersectionObserver + Image probe + cache-first resolve (COVER-02)', () => {
	it('fires the resolve once on first intersection, unobserves, and does NOT fire again', async () => {
		const onResolved = vi.fn();
		const track = mkTrack();
		const { node, io } = await mount({ track, onResolved });

		io.trigger(true);
		await flush();
		expect(resolveCoverForTrack).toHaveBeenCalledTimes(1);
		expect(io.unobserved).toContain(node); // unobserved after first intersection

		// A second intersection must NOT re-run the resolve (one-shot done flag).
		io.trigger(true);
		await flush();
		expect(resolveCoverForTrack).toHaveBeenCalledTimes(1);
		expect(onResolved).toHaveBeenCalledWith(track.uid, 'https://resolved.example/c.jpg');
	});

	it('de-dupes concurrent resolves for the same uid (chain runs once)', async () => {
		const onResolved = vi.fn();
		const track = mkTrack();
		// A slow resolve so both observers fire while the first is still in flight.
		let release!: (v: string | null) => void;
		resolveCoverForTrack.mockImplementation(
			() => new Promise<string | null>((res) => (release = res))
		);

		const a = await mount({ track, onResolved });
		const b = await mount({ track: mkTrack(), onResolved }); // same uid

		a.io.trigger(true);
		b.io.trigger(true);
		await flush();
		// Both intersected, but the in-flight Set keyed by uid lets only one chain run.
		expect(resolveCoverForTrack).toHaveBeenCalledTimes(1);
		release('https://resolved.example/c.jpg');
		await flush();
	});

	it('destroy() disconnects the observer (no further callbacks)', async () => {
		const onResolved = vi.fn();
		const { handle, io } = await mount({ track: mkTrack(), onResolved });
		expect(handle && typeof handle.destroy === 'function').toBe(true);
		handle!.destroy!();
		expect(io.disconnected).toBe(true);
	});

	it('keeps an existing SOLID cover that loads OK (Image onload) — no cache / chain', async () => {
		imageBehavior = 'load';
		const onResolved = vi.fn();
		const track = mkTrack({ cover: 'https://good.example/cover.jpg' });
		const { io } = await mount({ track, onResolved });

		io.trigger(true);
		await flush();
		// Cache is read first (and misses here), then the existing cover is probed and loads OK,
		// so the network chain is SKIPPED and the existing cover is kept.
		expect(getCachedCoverByUid).toHaveBeenCalledWith(track.uid);
		expect(resolveCoverForTrack).not.toHaveBeenCalled();
		expect(onResolved).toHaveBeenCalledWith(track.uid, 'https://good.example/cover.jpg');
	});

	it('repairs a broken cover (Image onerror) by routing to the cache→chain resolve', async () => {
		imageBehavior = 'error';
		const onResolved = vi.fn();
		const track = mkTrack({ cover: 'https://broken.example/404.jpg' });
		const { io } = await mount({ track, onResolved });

		io.trigger(true);
		await flush();
		expect(resolveCoverForTrack).toHaveBeenCalledTimes(1);
		expect(onResolved).toHaveBeenCalledWith(track.uid, 'https://resolved.example/c.jpg');
	});

	it('reads the cache uid-first and skips the network on a cache hit', async () => {
		getCachedCoverByUid.mockReturnValue('https://cache.example/by-uid.jpg');
		const onResolved = vi.fn();
		const track = mkTrack({ cover: 'https://good.example/cover.jpg' });
		const { io } = await mount({ track, onResolved });

		io.trigger(true);
		await flush();
		expect(getCachedCoverByUid).toHaveBeenCalledWith(track.uid);
		expect(resolveCoverForTrack).not.toHaveBeenCalled(); // cache hit → no network
		expect(onResolved).toHaveBeenCalledWith(track.uid, 'https://cache.example/by-uid.jpg');
	});

	it('SSR guard: with IntersectionObserver undefined the action does not throw', async () => {
		(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = undefined;
		const onResolved = vi.fn();
		const { lazyCover } = await import('./lazyCover');
		expect(() => lazyCover({} as HTMLElement, { track: mkTrack(), onResolved })).not.toThrow();
	});

	it('SSR guard: with Image undefined a broken/empty cover still routes to the chain (no throw)', async () => {
		(globalThis as { Image?: unknown }).Image = undefined;
		const onResolved = vi.fn();
		const track = mkTrack({ cover: 'https://x.example/c.jpg' });
		const { io } = await mount({ track, onResolved });
		io.trigger(true);
		await flush();
		// Image undefined → probe returns false → repair path runs the chain.
		expect(resolveCoverForTrack).toHaveBeenCalledTimes(1);
	});
});
