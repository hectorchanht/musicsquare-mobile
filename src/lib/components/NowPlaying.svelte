<script lang="ts">
	import { untrack } from 'svelte';
	import { fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { goto } from '$app/navigation';
	import { ChevronDown, MoreVertical, Heart, SkipBack, SkipForward, Play, Pause, Repeat, Repeat1, GripVertical } from '@lucide/svelte';
	import { player, fmtTime } from '$lib/stores/player.svelte';
	import { settings, effectiveTarget } from '$lib/stores/settings.svelte';
	import { library } from '$lib/stores/library.svelte';
	import { names } from '$lib/stores/names.svelte';
	import { overlays } from '$lib/stores/overlays.svelte';
	import { t } from '$lib/i18n';
	import { searchAll } from '$lib/services/catalog';
	import { dedupeBest } from '$lib/services/dedupe';
	import { translateLines } from '$lib/services/translate';
	import { shouldTranslate } from '$lib/i18n/detect';
	import { enrichTrack } from '$lib/services/lastfm';
	import { longpress } from '$lib/actions/longpress';
	import { marquee } from '$lib/actions/marquee';
	import TrackMenu from '$lib/components/TrackMenu.svelte';
	import Nowbar from '$lib/components/Nowbar.svelte';
	import { parseLRC, type LyricLine } from '$lib/services/lrc';
	import { createVelocityTracker } from '$lib/gestures/velocity';
	import type { Track } from '$lib/sources/types';

	type Tab = 'queue' | 'lyrics' | 'related';
	let tab = $state<Tab>('lyrics');
	// shuffle/repeat moved to the store (gte) so the audio `ended` handler + next() can read
	// them. The transport buttons below bind to player.shuffle / player.repeatMode directly.

	// ii6: derived "is current track liked" for the transport heart button (Like replaces
	// Shuffle in the transport row; Shuffle moved into the TrackMenu kebab menu).
	const currentLiked = $derived(player.current ? library.isLiked(player.current.uid) : false);
	let npToast = $state('');
	let npToastTimer: ReturnType<typeof setTimeout> | null = null;
	function flash(m: string) {
		npToast = m;
		if (npToastTimer) clearTimeout(npToastTimer);
		npToastTimer = setTimeout(() => (npToast = ''), 1500);
	}
	function toggleCurrentLike() {
		if (!player.current) return;
		library.toggleLike(player.current);
		flash(library.isLiked(player.current.uid) ? t('toast.liked') : t('toast.unliked'));
	}


	// shared context menu for current track + long-pressed queue/related rows
	let menuTrack = $state<Track | null>(null);
	let menuOpen = $state(false);
	function openMenu(t: Track | null) {
		menuTrack = t;
		menuOpen = !!t;
	}

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

	// ---- lyrics ----
	const lines = $derived<LyricLine[]>(player.current?.lrc ? parseLRC(player.current.lrc) : []);
	const activeLine = $derived.by(() => {
		let idx = -1;
		for (let i = 0; i < lines.length; i++) if (lines[i].time <= player.currentTime) idx = i;
		return idx;
	});
	let lyricsEl = $state<HTMLElement | null>(null);
	let autoScroll = $state(true);
	let idleTimer: ReturnType<typeof setTimeout> | null = null;
	// Touch-presence auto-scroll: pause WHILE a finger is down (or wheel is active), resume a
	// short grace after release — NOT a blind fixed idle timer. lyricsTouched only pauses;
	// lyricsReleased schedules the resume.
	function lyricsTouched() {
		autoScroll = false;
		if (idleTimer) clearTimeout(idleTimer);
	}
	function lyricsReleased() {
		if (idleTimer) clearTimeout(idleTimer);
		idleTimer = setTimeout(() => (autoScroll = true), 600);
	}
	function lyricsWheel() {
		// No release event for a wheel — pause, then schedule the same grace resume.
		lyricsTouched();
		lyricsReleased();
	}
	$effect(() => {
		const idx = activeLine;
		// sheetState is a read dependency: re-anchor the active line whenever the sheet
		// changes mode (closed/half/full) while the same line stays active.
		const mode = sheetState;
		if (tab !== 'lyrics' || !autoScroll || idx < 0 || !lyricsEl) return;
		const el = lyricsEl.querySelectorAll('p')[idx] as HTMLElement | undefined;
		// Scope the scroll to the bounded .panel container (the overflow-y:auto scroller) and
		// move it manually — never the ancestor-walking scroll-into-view API, which yanks the
		// sheet to full in half mode. Compute the line's offset RELATIVE TO the container via rect deltas
		// (offsetParent-agnostic), then anchor it inside the panel without changing sheetState.
		const container = lyricsEl.closest('.panel') as HTMLElement | null;
		if (!el || !container) return;
		const elRect = el.getBoundingClientRect();
		const cRect = container.getBoundingClientRect();
		const offsetWithin = elRect.top - cRect.top + container.scrollTop; // line top in container scroll-space
		// Anchor depends on the sheet mode. In HALF the sheet is position:absolute;inset:0 then
		// translated DOWN by halfOffset, so container.clientHeight spans the full viewport while only
		// the slice between the container top and the viewport bottom is actually VISIBLE. Centering on
		// clientHeight/2 would land below the visible fold (the reported "near the bottom" bug). So derive
		// the anchor from the live VISIBLE band (rect intersect viewport), which self-corrects for every mode:
		//   closed -> anchor near the visible TOP (tiny peek height, top-pin per spec)
		//   half / full -> center within the visible band
		const vh = typeof window !== 'undefined' ? window.innerHeight : cRect.bottom;
		const visTop = Math.max(cRect.top, 0);
		const visBottom = Math.min(cRect.bottom, vh);
		const visHeight = Math.max(0, visBottom - visTop);
		const visTopWithin = visTop - cRect.top; // visible-band top, in container-local coords
		const TOP_PAD = 12; // breathing room when top-pinned (closed)
		const anchorWithin =
			mode === 'closed'
				? visTopWithin + TOP_PAD
				: visTopWithin + visHeight / 2 - el.offsetHeight / 2; // visible-band center
		container.scrollTo({ top: offsetWithin - anchorWithin, behavior: 'smooth' });
	});

	// ---- lyrics translation ----
	let translated = $state<string[]>([]);
	let translating = $state(false);
	let trKey = '';
	$effect(() => {
		// ju0: lyricsLang now allows 'auto' (→ appLang). Resolve once here so both the
		// rerun key, shouldTranslate(), and translateLines() all see the SAME final token.
		const rawLang = settings.lyricsLang;
		const lang = effectiveTarget(rawLang);
		const skip = settings.lyricsSkip;
		const t = player.current;
		const n = lines.length;
		if (tab !== 'lyrics' || rawLang === 'off' || !n || !t) return;
		// Per-line whitelist: only the lines whose detected source is NOT whitelisted (and
		// is not already in the target) get sent to /api/translate. Skipped lines keep
		// their ORIGINAL text in the corresponding output slot so index alignment +
		// showTr/translateMode (below/replace) render unchanged. Include skip in the key so
		// toggling the whitelist re-runs the effect.
		const key = `${t.uid}:${lang}:${n}:${skip.slice().sort().join(',')}`;
		if (trKey === key) return;
		trKey = key;
		translating = true;
		const sendIdx: number[] = [];
		const sendText: string[] = [];
		for (let i = 0; i < lines.length; i++) {
			if (shouldTranslate(lines[i].text, lang, skip)) {
				sendIdx.push(i);
				sendText.push(lines[i].text);
			}
		}
		const stitch = (out: string[]) => lines.map((l, i) => {
			const pos = sendIdx.indexOf(i);
			return pos === -1 ? l.text : (out[pos] ?? l.text);
		});
		// Nothing to translate (every line whitelisted/already-target): keep originals.
		const work = sendText.length ? translateLines(sendText, lang) : Promise.resolve([] as string[]);
		work
			.then((out) => { if (trKey === key) translated = stitch(out); })
			.catch(() => { if (trKey === key) translated = []; })
			.finally(() => { if (trKey === key) translating = false; });
	});
	const showTr = $derived(settings.lyricsLang !== 'off' && translated.length === lines.length);

	// ---- related ----
	let related = $state<Track[]>([]);
	let relatedFor = '';
	$effect(() => {
		const t = player.current;
		if (tab === 'related' && t && relatedFor !== t.uid) {
			relatedFor = t.uid;
			related = [];
			searchAll(t.artist, 1)
				.then((r) => (related = dedupeBest(r.interleaved, settings.preferredSource).filter((x) => x.uid !== t.uid).slice(0, 20)))
				.catch(() => (related = []));
		}
	});

	// ---- Last.fm enrichment (Phase 8, ENRICH-01/02) ----
	// Best-effort, OFF the playback critical path: keyed on the current uid, the
	// $effect void-fires enrichTrack (never awaited, never blocks) and assigns the
	// result only if the uid still matches (race guard, mirrors the related/trKey
	// idiom). A non-Last.fm track / absent key resolves to the all-empty shape, so
	// nothing renders and the source cover is never disturbed.
	let enrichedFor = '';
	let swappedCover = $state<string | null>(null);
	$effect(() => {
		const cur = player.current;
		const uid = cur?.uid ?? '';
		if (!cur || enrichedFor === uid) return;
		enrichedFor = uid;
		swappedCover = null; // reset — never carry the previous track's swapped art
		void enrichTrack(cur).then((r) => {
			if (player.current?.uid !== uid) return; // track changed mid-flight — discard
			// Tags/genre chips are hidden now (quick-260607-f4y) — enrichment is kept ONLY for
			// the hi-res Last.fm cover-art adoption below.
			if (r.lastfmArt) maybeSwapCover(r.lastfmArt, cur);
		});
	});

	// Preload the Last.fm cover candidate BEFORE swapping (D-04 guardrail 4 — no
	// flash). Swap only when the source cover is absent OR the preloaded image is
	// strictly larger than a sane threshold (D-04 guardrail 3). A real cover NEVER
	// regresses to a placeholder/broken image — the endpoint already filtered the
	// grey-star/empty art, and we keep the source cover when lastfmArt is null
	// (ENRICH-02 overrides D-03). Best-effort + async — never blocks first paint.
	function maybeSwapCover(art: string, forTrack: Track) {
		if (typeof Image === 'undefined') return; // SSR guard
		// Adopt the Last.fm art only when its real width exceeds the source cover's
		// (D-04 g3: STRICTLY larger — never downgrade a good cover). `srcWidth = 0`
		// means the source is missing/broken, so any valid art is an improvement.
		const adopt = (srcWidth: number) => {
			const img = new Image();
			img.onload = () => {
				if (player.current?.uid !== forTrack.uid) return; // track changed — abort
				if (img.naturalWidth > srcWidth) swappedCover = art;
			};
			img.onerror = () => {}; // broken candidate → keep the source cover
			img.src = art;
		};
		if (!forTrack.cover) {
			adopt(0); // no source cover → any non-placeholder Last.fm art wins
			return;
		}
		// Measure the source cover first (naturalWidth needs a load) so the swap is a
		// genuine resolution upgrade, not a same-size/smaller regression (WR-03).
		const src = new Image();
		src.onload = () => {
			if (player.current?.uid === forTrack.uid) adopt(src.naturalWidth);
		};
		src.onerror = () => adopt(0); // source cover broken → Last.fm art beats nothing
		src.src = forTrack.cover;
	}

	// Effective now-playing cover: the swapped hi-res Last.fm art when adopted, else
	// the source cover (never a placeholder).
	const effectiveCover = $derived(swappedCover ?? player.current?.cover ?? null);

	function openArtist() {
		if (player.current) {
			player.collapse();
			goto(`/artist/${encodeURIComponent(player.current.artist)}`);
		}
	}

	// ---- back-gesture: NowPlaying only renders while player.expanded, so mount == overlay
	// open. The back gesture runs player.collapse() (→ unmount → cleanup dismisses); the
	// header ChevronDown, cover drag-collapse, and openArtist all also call player.collapse(),
	// so they route through the SAME single dismiss path (the $effect cleanup). History depth
	// stays balanced: open pushes 1 state, cleanup's dismiss() pops it (or back-gesture's
	// closeTop already popped it → dismiss is a no-op).
	$effect(() => {
		// untrack: overlays.open/dismiss READ the $state overlay stack internally (isTop/has).
		// Without untrack this effect would capture that stack as a dependency and RE-RUN
		// (cleanup-dismiss then re-open, churning history) every time ANY other overlay (e.g.
		// the track menu) pushes/pops — desyncing history depth so the menu can't be dismissed.
		untrack(() => overlays.open('nowplaying', () => player.collapse()));
		return () => untrack(() => overlays.dismiss('nowplaying'));
	});

	// ---- Keyboard shortcuts (gte) — Space/←/→ on the open NowPlaying overlay.
	// NowPlaying only renders while player.expanded, so mount == overlay open; the cleanup
	// removes the listener on collapse. Suppress when typing in inputs / textareas / contentEditable
	// or while an IME composition is active so we never break text entry.
	$effect(() => {
		if (typeof window === 'undefined') return;
		function isTextEntry(el: EventTarget | null): boolean {
			if (!(el instanceof HTMLElement)) return false;
			const tag = el.tagName;
			if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
			return el.isContentEditable;
		}
		const onKey = (e: KeyboardEvent) => {
			if (e.isComposing) return;
			if (isTextEntry(e.target)) return;
			if (e.key === ' ' || e.code === 'Space') {
				e.preventDefault();
				player.toggle();
			} else if (e.key === 'ArrowLeft') {
				player.prev();
			} else if (e.key === 'ArrowRight') {
				player.next();
			}
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	});

	// ---- cover drag-down to collapse ----
	let dragY = $state(0);
	let dragging = $state(false);
	let startY = 0;
	function coverDown(e: PointerEvent) { dragging = true; startY = e.clientY; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); }
	function coverMove(e: PointerEvent) { if (dragging) dragY = Math.max(0, e.clientY - startY); }
	function coverUp() { if (!dragging) return; dragging = false; if (dragY > 120) player.collapse(); dragY = 0; }

	// ---- sheet: 3-state snap machine (closed / half / full) ----
	// translateY is measured in "full coordinates": 0 = full (sheet fills .np),
	// halfOffset = half-open (~50% down), closedOffset = closed/peek (sheet at its
	// resting peek height). The grip AND the subnav row both drive this via the same
	// gripDown/gripMove/gripUp pointer handlers. Mirrors the old live-drag idiom.
	type SheetState = 'closed' | 'half' | 'full';
	let sheetState = $state<SheetState>('closed');
	let sheetEl = $state<HTMLElement | null>(null);
	let transportEl = $state<HTMLElement | null>(null); // transport row → live bottom edge for flush half offset
	let coverEl = $state<HTMLElement | null>(null); // cover banner → its 0.32s reflow must settle before re-measuring halfOffset
	let sheetDragY = $state(0); // px in full-coordinates (0 = full, closedOffset = closed)
	let sheetDragging = $state(false); // forces absolute layout while dragging/snapping
	let gripActive = $state(false); // true only while finger is down (transition off)
	let subnavMoved = $state(false); // set true when the gesture passed the 8px drag threshold
	let gripStartY = 0;
	let gripMoved = 0;
	let gripStartTab: Tab | null = null; // gesture-transient: the subnav tab the gesture started on (null = grip/empty)
	let closedOffset = 300; // distance from full-top to closed/peek-top (measured at drag start)
	let halfOffset = $state(150); // distance from full-top to half-open-top; reactive so the resting-half transform updates when re-measured
	let snapTimer: ReturnType<typeof setTimeout> | null = null;
	// Pointer-velocity tracker for the grip drag → a fast flick steps ONE state in the
	// flick direction even when distance is small (slow-drag falls back to nearest-by-position).
	const gripVel = createVelocityTracker();
	const FLICK_V = 0.5; // px/ms threshold that counts as a deliberate flick

	/** translateY (full-coordinate px) for a given resting state. */
	function offsetFor(s: SheetState): number {
		return s === 'full' ? 0 : s === 'half' ? halfOffset : closedOffset;
	}

	/** Measure closed/half offsets from the live layout at drag/tap start. */
	function measureOffsets() {
		const np = sheetEl?.closest('.np') as HTMLElement | null;
		if (!sheetEl || !np) return;
		const npRect = np.getBoundingClientRect();
		// When closed the sheet is in normal flow → real peek distance. When half/full it
		// is absolute, so derive a sensible peek height from the container instead.
		if (sheetState === 'closed') {
			closedOffset = Math.max(80, sheetEl.getBoundingClientRect().top - npRect.top);
		} else {
			closedOffset = Math.max(80, npRect.height * 0.72);
		}
		// Flush half-open: the panel top sits exactly at the bottom edge of the transport
		// row (no dead gap). Fall back to the old fraction only when the ref isn't mounted.
		halfOffset = transportEl
			? Math.round(transportEl.getBoundingClientRect().bottom - npRect.top)
			: Math.round(npRect.height * 0.5);
		// Keep ordering sane: half must sit between full(0) and closed.
		halfOffset = Math.max(20, Math.min(closedOffset - 20, halfOffset));
	}

	function gripDown(e: PointerEvent) {
		gripActive = true;
		subnavMoved = false;
		gripStartY = e.clientY;
		gripMoved = 0;
		// Remember which subnav tab (if any) the gesture started on, so a TAP switches that
		// tab with priority over the generic grip toggle. null = grip handle / empty nav area.
		const btn = (e.target as HTMLElement).closest('.subnav button') as HTMLElement | null;
		gripStartTab = btn ? (btn.dataset.tab as Tab) : null;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		if (snapTimer) clearTimeout(snapTimer);
		gripVel.reset();
		gripVel.sample(e.clientY, e.timeStamp);
		measureOffsets();
		sheetDragging = true;
		sheetDragY = offsetFor(sheetState);
	}
	function gripMove(e: PointerEvent) {
		if (!gripActive) return;
		gripVel.sample(e.clientY, e.timeStamp);
		gripMoved = e.clientY - gripStartY;
		if (Math.abs(gripMoved) >= 8) subnavMoved = true;
		const start = offsetFor(sheetState);
		sheetDragY = Math.max(0, Math.min(closedOffset, start + gripMoved));
	}
	function gripUp() {
		if (!gripActive) return;
		gripActive = false;
		if (Math.abs(gripMoved) < 8) {
			// TAP → reset transient drag state regardless of branch taken below.
			sheetDragging = false;
			sheetDragY = 0;
			if (gripStartTab) {
				// Tap originated on a subnav item → switch to that tab (+ half-open from
				// closed) with priority over the generic toggle.
				selectTab(gripStartTab);
				gripStartTab = null;
				return;
			}
			// Tap on the grip handle / empty nav area → generic single step:
			// closed→half, half→closed, full→half.
			sheetState = sheetState === 'closed' ? 'half' : sheetState === 'full' ? 'half' : 'closed';
			gripStartTab = null;
			return;
		}
		gripStartTab = null;
		let target: SheetState;
		// FLICK → a fast pointer velocity steps ONE state in the flick direction, regardless
		// of how far the finger travelled (down = toward closed, up = toward full), clamped at
		// the ends. v > 0 = moving DOWN, v < 0 = moving UP.
		const v = gripVel.velocity();
		if (Math.abs(v) > FLICK_V) {
			if (v > 0) {
				// downward flick: full → half → closed (clamp)
				target = sheetState === 'full' ? 'half' : 'closed';
			} else {
				// upward flick: closed → half → full (clamp)
				target = sheetState === 'closed' ? 'half' : 'full';
			}
		} else {
			// SLOW DRAG → snap to the nearest of {full,half,closed}, biased by drag direction so a
			// deliberate swipe overshoots one state (up = toward full, down = toward closed).
			const dir = gripMoved < 0 ? -1 : 1; // -1 = swiped up, +1 = swiped down
			const bias = closedOffset * 0.12 * dir; // shift the decision point with the swipe
			const pos = sheetDragY + bias;
			const dHalf = Math.abs(pos - halfOffset);
			const dFull = Math.abs(pos - 0);
			const dClosed = Math.abs(pos - closedOffset);
			if (dFull <= dHalf && dFull <= dClosed) target = 'full';
			else if (dClosed <= dHalf && dClosed <= dFull) target = 'closed';
			else target = 'half';
		}
		sheetDragY = offsetFor(target); // animate (transition on now that gripActive=false)
		if (snapTimer) clearTimeout(snapTimer);
		snapTimer = setTimeout(() => {
			sheetState = target;
			sheetDragging = false;
			sheetDragY = 0;
		}, 290);
	}

	/** Grip keyboard step (Enter/Space): mirrors the TAP single-step. */
	function gripKey(e: KeyboardEvent) {
		if (e.key !== 'Enter' && e.key !== ' ') return;
		e.preventDefault();
		sheetState = sheetState === 'closed' ? 'half' : sheetState === 'full' ? 'half' : 'closed';
	}

	/** Subnav item tap: switch tab; open to half from closed. Suppressed if it was a drag. */
	function selectTab(next: Tab) {
		if (subnavMoved) {
			subnavMoved = false;
			return; // gesture was a drag on the subnav row — don't switch tabs
		}
		tab = next;
		if (sheetState === 'closed') sheetState = 'half';
	}

	// Resting half reads halfOffset for its transform, but tap/keyboard paths enter half
	// without going through measureOffsets() (only the drag path measures). Recompute the
	// flush offset whenever the sheet rests in half (and on layout-affecting changes).
	// SEPARATE from the back-gesture $effect above — measureOffsets() is idempotent and
	// guards on null refs.
	//
	// BUG-2 ROOT CAUSE FIX: the .cover runs a 0.32s width/height/margin reflow when entering
	// half/full. Measuring transportEl.bottom DURING that transition overshoots by the
	// cover-shrink delta → a visible dead gap. So defer the measurement until the reflow has
	// SETTLED: re-measure on the cover's transitionend (one-shot) AND via a double-rAF + a
	// ~340ms timeout fallback for the cases where no transition fires (already-reflowed tap
	// into half, or prefers-reduced-motion). All listeners/timers are torn down on cleanup so
	// nothing leaks or fires after the sheet leaves half.
	$effect(() => {
		if (sheetState !== 'half' || sheetDragging) return;
		// Measure immediately (best-effort) then again once the reflow settles for the flush value.
		measureOffsets();
		let raf1 = 0;
		let raf2 = 0;
		const onSettled = () => measureOffsets();
		const cover = coverEl;
		cover?.addEventListener('transitionend', onSettled, { once: true });
		// double-rAF: wait two frames so layout has flushed, then re-measure.
		raf1 = requestAnimationFrame(() => {
			raf2 = requestAnimationFrame(onSettled);
		});
		// timeout fallback (> the 0.32s reflow) for when no transitionend fires at all.
		const fallback = setTimeout(onSettled, 340);
		return () => {
			cover?.removeEventListener('transitionend', onSettled);
			if (raf1) cancelAnimationFrame(raf1);
			if (raf2) cancelAnimationFrame(raf2);
			clearTimeout(fallback);
		};
	});

	// ---- Up-Next reorder: custom pointer/touch drag on the far-right grip handle ----
	// (NOT native HTML5 DnD — poor on touch). On drop we call player.reorderQueue,
	// which pins the moved track manual so it survives the next fresh-play regen.
	let queueListEl = $state<HTMLElement | null>(null);
	let dragFrom = $state(-1); // source row index while dragging (-1 = idle)
	let dragOver = $state(-1); // current target row index
	let rowDragY = $state(0); // px the lifted row follows the finger
	let rowDragStartY = 0;

	/** Find the queue row index under client-Y `y` by measuring each <li>'s rect. */
	function rowIndexAt(y: number): number {
		if (!queueListEl) return dragFrom;
		const items = queueListEl.querySelectorAll('li');
		for (let i = 0; i < items.length; i++) {
			const r = items[i].getBoundingClientRect();
			if (y < r.top + r.height / 2) return i;
		}
		return items.length - 1;
	}

	function gripDragDown(e: PointerEvent, index: number) {
		e.stopPropagation(); // don't trigger the row's play onclick
		dragFrom = index;
		dragOver = index;
		rowDragStartY = e.clientY;
		rowDragY = 0;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}
	function gripDragMove(e: PointerEvent) {
		if (dragFrom < 0) return;
		rowDragY = e.clientY - rowDragStartY;
		dragOver = rowIndexAt(e.clientY);
	}
	function gripDragUp() {
		if (dragFrom < 0) return;
		if (dragOver >= 0 && dragOver !== dragFrom) player.reorderQueue(dragFrom, dragOver);
		dragFrom = -1;
		dragOver = -1;
		rowDragY = 0;
	}
</script>

<section
	class="np"
	class:reflow={sheetState !== 'closed'}
	class:fullshrink={sheetState === 'full'}
	transition:fly={{ y: 600, duration: 320, easing: cubicOut }}
	style:transform={dragY ? `translateY(${dragY}px)` : undefined}
	style:transition={dragging ? 'none' : 'transform 0.28s cubic-bezier(.22,1,.36,1)'}
>
	{#if sheetState === 'full'}
		<!-- mtv-followup: reuse the existing docked Nowbar as the sticky top bar when the
		     subnav sheet is fully open. Same cover/title/artist/play layout as the
		     bottom-of-screen mini-player; tapping it collapses the sheet (returns to the
		     full Now Playing view, sheet closed). The lower header (.bar) is hidden by CSS
		     so the underlying NP chrome doesn't leak through. -->
		<Nowbar variant="embed" onOpen={() => { sheetState = 'closed'; sheetDragY = offsetFor('closed'); }} />
	{/if}
	<header class="bar">
		<button class="icon" aria-label={t('nowplaying.collapse')} onclick={() => player.collapse()}><ChevronDown /></button>
		<span class="ctx">{t('nowplaying.nowPlaying')}</span>
		<button class="icon" aria-label={t('nowplaying.options')} onclick={() => openMenu(player.current)}><MoreVertical /></button>
	</header>

	<div
		class="cover"
		role="button"
		tabindex="0"
		bind:this={coverEl}
		aria-label={t('nowplaying.albumArt')}
		onpointerdown={coverDown}
		onpointermove={coverMove}
		onpointerup={coverUp}
		onpointercancel={coverUp}
		style:background-image={effectiveCover ? `url(${effectiveCover})` : fallbackCover(player.current)}
	></div>

	<div class="meta">
		<!-- {#key uid}: .title/.artist are single persistent nodes, so the marquee action would
		     never re-measure on a track change (box width is unchanged). Re-keying remounts them
		     per track → fresh measure. .marquee-inner wraps the text so the GLOBAL transform-based
		     marquee in app.css drives them (gmy unified the artist + NowPlaying drift onto one
		     system). Genre/tag chips intentionally hidden (quick-260607-f4y). -->
		{#key player.current?.uid}
			<div class="title" use:marquee><span class="marquee-inner">{player.current ? names.dnTitle(player.current.title) : ''}</span></div>
			<button class="artist" use:marquee onclick={openArtist}><span class="marquee-inner">{player.current ? names.dnArtist(player.current.artist) : ''}</span></button>
		{/key}
	</div>

	{#if player.error}
		<p class="np-error" role="alert">{player.error}</p>
	{/if}

	<div class="prog">
		<div class="track" onclick={seek} onkeydown={seekKey} role="slider" tabindex="0" aria-label={t('nowplaying.seek')} aria-valuenow={Math.round(frac * 100)}>
			<div class="fill" style:width={`${frac * 100}%`}></div>
			<div class="knob" style:left={`${frac * 100}%`}></div>
		</div>
		<div class="times">
			<span>{fmtTime(player.currentTime)}</span>
			<span>{player.duration > 0 ? fmtTime(player.duration) : '--:--'}</span>
		</div>
	</div>

	<div class="transport" bind:this={transportEl}>
		<button class="t" class:on={currentLiked} aria-label={currentLiked ? t('menu.liked') : t('menu.like')} onclick={toggleCurrentLike}><Heart size={20} fill={currentLiked ? 'currentColor' : 'none'} /></button>
		<button class="t" aria-label={t('nowplaying.previous')} onclick={() => player.prev()}><SkipBack size={26} /></button>
		<button class="play" aria-label={t('nowplaying.playPause')} onclick={() => player.toggle()}>
			{#if player.playing}<Pause size={26} />{:else}<Play size={26} />{/if}
		</button>
		<button class="t" aria-label={t('nowplaying.next')} onclick={() => player.next()}><SkipForward size={26} /></button>
		<button class="t" class:on={player.repeatMode !== 'off'} aria-label={player.repeatMode === 'one' ? t('nowplaying.repeatModeOne') : player.repeatMode === 'all' ? t('nowplaying.repeatModeAll') : t('nowplaying.repeat')} onclick={() => player.cycleRepeat()}>
			{#if player.repeatMode === 'one'}<Repeat1 size={20} />{:else}<Repeat size={20} />{/if}
		</button>
	</div>

	<div
		class="sheet"
		class:full={sheetState !== 'closed'}
		class:dragging={sheetDragging}
		bind:this={sheetEl}
		style:transform={sheetDragging ? `translateY(${sheetDragY}px)` : sheetState === 'half' ? `translateY(${halfOffset}px)` : undefined}
		style:transition={gripActive ? 'none' : 'transform 0.28s cubic-bezier(.22,1,.36,1)'}
	>
		<div class="grip" role="button" tabindex="0" aria-label={sheetState === 'closed' ? t('nowplaying.expandPanel') : t('nowplaying.collapsePanel')}
			onpointerdown={gripDown} onpointermove={gripMove} onpointerup={gripUp} onpointercancel={gripUp}
			onkeydown={gripKey}>
			<span class="handle"></span>
		</div>

		<nav class="subnav"
			onpointerdown={gripDown} onpointermove={gripMove} onpointerup={gripUp} onpointercancel={gripUp}>
			<button data-tab="queue" class:active={tab === 'queue'} onclick={() => selectTab('queue')}>{t('nowplaying.upNext')}</button>
			<button data-tab="lyrics" class:active={tab === 'lyrics'} onclick={() => selectTab('lyrics')}>{t('nowplaying.lyrics')}</button>
			<button data-tab="related" class:active={tab === 'related'} onclick={() => selectTab('related')}>{t('nowplaying.related')}</button>
		</nav>

		<div class="panel">
			{#if tab === 'queue'}
				{#if player.queue.length}
					<ul class="list" bind:this={queueListEl}>
						{#each player.queue as track, i (track.uid)}
							<li
								class:lifted={i === dragFrom}
								class:over={i === dragOver && i !== dragFrom}
								style:transform={i === dragFrom && rowDragY ? `translateY(${rowDragY}px)` : undefined}
							>
								<button class="row q-row" class:playing={track.uid === player.current?.uid} use:longpress onlongpress={() => openMenu(track)} onclick={() => player.play(track, { fresh: true })}>
									<span class="r-title">{names.dnTitle(track.title)}</span>
									<span class="r-artist">{names.dnArtist(track.artist)}</span>
								</button>
								<button
									class="grip-handle"
									aria-label={t('nowplaying.reorderTrack')}
									onpointerdown={(e) => gripDragDown(e, i)}
									onpointermove={gripDragMove}
									onpointerup={gripDragUp}
									onpointercancel={gripDragUp}
									onclick={(e) => e.stopPropagation()}
								><GripVertical size={18} /></button>
							</li>
						{/each}
					</ul>
				{:else}<p class="empty">{t('nowplaying.noQueue')}</p>{/if}
			{:else if tab === 'lyrics'}
				{#if lines.length}
					{#if translating}<p class="tr-hint">{t('nowplaying.translating')}</p>{/if}
					<div class="lyrics" role="group" aria-label={t('nowplaying.lyrics')} bind:this={lyricsEl} onpointerdown={lyricsTouched} onpointerup={lyricsReleased} onpointercancel={lyricsReleased} onwheel={lyricsWheel}>
						{#each lines as l, i (i)}
							<p class:active={i === activeLine}>
								{#if showTr && settings.translateMode === 'replace'}
									{translated[i]}
								{:else}
									{l.text}
									{#if showTr}<span class="tr">{translated[i]}</span>{/if}
								{/if}
							</p>
						{/each}
					</div>
				{:else}<p class="empty">{t('nowplaying.noLyrics')}</p>{/if}
			{:else}
				{#if related.length}
					<ul class="list">
						{#each related as track (track.uid)}
							<li><button class="row" use:longpress onlongpress={() => openMenu(track)} onclick={() => player.play(track, { fresh: true })}><span class="r-title">{names.dnTitle(track.title)}</span><span class="r-artist">{names.dnArtist(track.artist)}</span></button></li>
						{/each}
					</ul>
				{:else}<p class="empty">{t('nowplaying.loadingRelated')}</p>{/if}
			{/if}
		</div>
	</div>

	<TrackMenu track={menuTrack} open={menuOpen} onclose={() => (menuOpen = false)} />

	{#if npToast}<div class="np-toast" transition:fly={{ y: -10, duration: 160 }}>{npToast}</div>{/if}
</section>

<style>
	.np { position: fixed; inset: 0; z-index: 50; background: radial-gradient(130% 60% at 50% 0%, #241a3a 0%, var(--color-bg) 60%); display: flex; flex-direction: column; padding: 0px 18px env(safe-area-inset-bottom); overflow: hidden; }
	.bar { display: flex; align-items: center; justify-content: space-between; }
	.bar .ctx { font-size: 12px; color: var(--color-text-muted); }
	.icon { background: none; border: none; color: var(--color-text); cursor: pointer; width: 38px; height: 38px; display: grid; place-items: center; border-radius: 50%; }
	.icon:hover { background: var(--color-surface-2); }
	.cover { position: relative; z-index: 1; width: min(72vw, 320px); height: auto; aspect-ratio: 1/1; margin: 8px auto; border-radius: 16px; background-size: cover; background-position: center; box-shadow: 0 18px 50px rgba(0,0,0,0.5); cursor: grab; touch-action: none; transition: width 0.32s cubic-bezier(.22,1,.36,1), height 0.32s cubic-bezier(.22,1,.36,1), margin 0.32s cubic-bezier(.22,1,.36,1), border-radius 0.32s cubic-bezier(.22,1,.36,1); }
	.cover:active { cursor: grabbing; }
	.meta { margin: 4px 2px 12px; transition: margin 0.32s cubic-bezier(.22,1,.36,1); }
	/* Reflow (sheet half/full): cover becomes a full-bleed YT-Music banner that the
	   header overlaps at the top and the meta overlaps at the bottom. */
	.np.reflow .cover { width: auto; aspect-ratio: auto; height: 30vh; margin: 0 -18px; border-radius: 0; }
	.np.reflow .cover::before { content: ''; position: absolute; inset: 0; border-radius: inherit; background: linear-gradient(180deg, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0) 28%, rgba(0,0,0,0) 60%, rgba(0,0,0,0.35) 100%); }
	.np.reflow .bar { position: absolute; top: 0; left: 18px; right: 18px; z-index: 2; }
	.np.reflow .meta { position: relative; z-index: 2; margin-top: -42px; padding: 0 2px; }
	.np.reflow .title { text-shadow: 0 1px 6px rgba(0,0,0,0.6); }

	/* mtv-followup: sheet FULL state → reuse the docked Nowbar as a sticky top bar. The
	   existing .bar/.cover/.meta/.prog/.transport are all hidden (Nowbar carries the same
	   information in a single compact row) and the sheet starts below the bar so the queue
	   never overlaps it. .fullshrink is a strict superset of .reflow so the overrides win. */
	.np.fullshrink .bar,
	.np.fullshrink .cover,
	.np.fullshrink .meta,
	.np.fullshrink .prog,
	.np.fullshrink .transport,
	.np.fullshrink .np-error { display: none; }
	/* The embedded Nowbar sits in static flow at the top of .np. Reserve viewport below it for
	   the absolute-positioned sheet so the top bar isn't painted over. The 76px = Nowbar height
	   (var(--nowbar-h)) + .np's own padding-top (8px); pinned numerically here because .np.fullshrink
	   adds no extra padding-top and the sheet is `position:absolute` with explicit inset. */
	.np.fullshrink .sheet.full { inset: calc(var(--nowbar-h) + 16px) 0 0 0; }
	/* .np.fullshrink :global(.nowbar.embed) { margin-bottom: 0px; } */
	.title { font-size: calc(1.5rem * var(--fs-title, 1)); font-weight: 800; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.artist { display: inline-block; max-width: 100%; vertical-align: bottom; background: black; border: none; padding: 2px; border-radius: 4px; color: var(--color-text-muted); font-size: calc(1rem * var(--fs-artist, 1)); cursor: pointer; text-decoration: underline; text-underline-offset: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	/* Marquee lives globally in app.css (transform-based .marquee-inner). The .title/.artist
	   clips above + the use:marquee action + inner .marquee-inner span in the markup are the
	   only per-file pieces — the global rule animates them. (gmy unified the drift.) */
	.np-error { color: #ff6b6b; font-size: 13px; text-align: center; margin: 2px 2px 10px; }
	.prog { margin: 4px 0; }
	.track { position: relative; height: 14px; display: flex; align-items: center; cursor: pointer; }
	.track::before { content: ''; position: absolute; left: 0; right: 0; height: 4px; border-radius: 4px; background: rgba(255,255,255,0.18); }
	.fill { position: absolute; left: 0; height: 4px; border-radius: 4px; background: var(--color-primary); }
	.knob { position: absolute; width: 12px; height: 12px; border-radius: 50%; background: #fff; transform: translateX(-50%); }
	.times { display: flex; justify-content: space-between; font-size: 11px; color: var(--color-text-muted); margin-top: 4px; }
	.transport { display: flex; align-items: center; justify-content: space-between; margin: 6px 4px; }
	.t { background: none; border: none; color: var(--color-text); cursor: pointer; opacity: 0.85; display: grid; place-items: center; }
	.t.on { color: var(--color-primary); opacity: 1; }
	.play { width: 62px; height: 62px; border-radius: 50%; border: none; background: #fff; color: #000; cursor: pointer; display: grid; place-items: center; }
	.sheet { display: flex; flex-direction: column; flex: 1; min-height: 0; will-change: transform; user-select: none; -webkit-user-select: none; }
	.sheet.full, .sheet.dragging { position: absolute; inset: 0; z-index: 5; background: var(--color-bg); padding: 4px 18px env(safe-area-inset-bottom); }
	.grip { display: flex; justify-content: center; padding: 10px 0 6px; cursor: grab; touch-action: none; user-select: none; -webkit-user-select: none; }
	.grip:active { cursor: grabbing; }
	.handle { width: 44px; height: 5px; border-radius: 999px; background: var(--color-text-muted); opacity: 0.6; }
	.subnav { display: flex; justify-content: space-around; padding-bottom: 6px; touch-action: none; user-select: none; -webkit-user-select: none; }
	.subnav button { background: none; border: none; color: var(--color-text-muted); font-size: 13px; min-height: 40px; padding: 8px 12px; cursor: pointer; border-bottom: 2px solid transparent; }
	.subnav button.active { color: var(--color-text); border-bottom-color: var(--color-primary); }
	.panel { flex: 1; overflow-y: auto; }
	.list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
	.row { width: 100%; text-align: left; background: none; border: none; padding: 8px 6px; border-radius: 8px; cursor: pointer; display: flex; flex-direction: column; }
	.row:hover { background: var(--color-surface); }
	.row.playing { background: rgba(124,92,255,0.15); }
	/* Queue rows: play-button + far-right grip side by side. */
	.list li { display: flex; align-items: center; gap: 2px; }
	.q-row { flex: 1; min-width: 0; }
	.grip-handle { flex: 0 0 auto; background: none; border: none; color: var(--color-text-muted); opacity: 0.55; cursor: grab; touch-action: none; display: grid; place-items: center; padding: 8px 6px; border-radius: 8px; }
	.grip-handle:active { cursor: grabbing; opacity: 0.9; }
	.list li.lifted { position: relative; z-index: 2; opacity: 0.92; }
	.list li.lifted .q-row { background: var(--color-surface); box-shadow: 0 6px 18px rgba(0,0,0,0.4); }
	.list li.over .q-row { box-shadow: inset 0 2px 0 var(--color-primary); }
	.r-title { font-size: calc(14px * var(--fs-title, 1)); font-weight: 600; }
	.r-artist { font-size: calc(12px * var(--fs-artist, 1)); color: var(--color-text-muted); }
	.lyrics { text-align: center; line-height: 2.1; }
	.lyrics p { font-size: calc(1rem * var(--fs-lyrics, 1)); color: var(--color-text-muted); transition: color 0.2s ease, transform 0.2s ease; margin: 0; }
	.lyrics p.active { color: var(--color-text); font-weight: 700; transform: scale(1.04); }
	.lyrics .tr { display: block; font-size: 0.82em; font-weight: 400; color: var(--color-text-muted); margin-top: 2px; }
	.tr-hint { text-align: center; font-size: 11px; color: var(--color-primary); margin: 0 0 6px; }
	.empty { color: var(--color-text-muted); font-size: 14px; text-align: center; padding: 24px; }
	.np-toast { position: absolute; left: 50%; transform: translateX(-50%); top: 72px; z-index: 60; background: rgba(0,0,0,0.75); color: #fff; padding: 8px 14px; border-radius: 999px; font-size: 13px; }
</style>
