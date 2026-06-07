---
quick_id: 260607-gte
slug: now-playing-playback-resilience-cross-so
date: 2026-06-07
status: complete
commits:
  - e568c20  # P1 + P2 store: cross-source fallback + tri-state repeat + real shuffle
  - 84cb187  # P3 + P4 NowPlaying UI: bind transport, repeat icon, kbd shortcuts, i18n
  - 95c61e6  # P5 shared-element FLIP morph + swipe-up to expand
---

# Quick Task 260607-gte — NowPlaying / playback resilience expansion

Locked decisions via AskUserQuestion (CONTEXT.md): **hand-rolled FLIP** for the morph;
**industry-standard tri-state repeat** (off → one → all → off); fallback order = enabled sources
minus failed, preferred-source first, each tried at most once per attempt.

## Part 1 — Cross-source fallback (SRC-FB-01, deferred from v2)
- New `src/lib/services/fallback.ts`: `tryFallback(failed, preferred, signal)` walks enabled
  sources (preferred-source first when set, the failed source excluded), `searchAll` →
  `dedupeBest` → `ensureTrackDetails` for each. Returns the first Track whose `audioUrl` is
  truthy; null when every source dries up. Pure `fallbackOrder()` exported for tests. Never throws.
- Hooked into `play()` at two failure surfaces:
  - **No audioUrl after resolve** (region-block / dead URL): runs fallback before surfacing the
    "no playable audio" error.
  - **`<audio>` `error` event** (mid-stream failure): runs fallback before surfacing the
    "playback failed" error.
- **Supersedence**: every `play()` bumps `playGen`; the in-flight fallback's watchdog interval
  aborts its `AbortController` when a newer play() bumps the generation, and the post-search
  generation check prevents stale results from clobbering the newer track. Fallback-continuation
  `play(t, { fromFallback: true })` does NOT re-record history and does NOT bump playGen.
- Queue slot for the failed track is updated to the resolved fallback so `next()`/`prev()` walk it.

## Part 2 — Real shuffle + tri-state repeat
- `player.shuffle` (boolean) + `player.repeatMode` (`'off' | 'one' | 'all'`) on the store.
- `toggleShuffle()` Fisher-Yates's queue slice AFTER `indexOf(current)+1` — current pinned;
  history pinned. Toggling off leaves the queue as-is (user-specified, no auto-unshuffle).
- `cycleRepeat()` cycles `off → one → all → off`. Wired into:
  - `<audio>` `ended`: when `'one'`, rewind + replay current without advancing.
  - `next()` end-of-queue: when `'all'`, wrap to `queue[0]` instead of growing.

## Part 3 — NowPlaying transport bind + tri-state repeat icon
- Replaced dead local `let shuffle/repeat` component state with reads of
  `player.shuffle` / `player.repeatMode`; buttons call `player.toggleShuffle()` /
  `player.cycleRepeat()` so audio actually honors them.
- Repeat icon: `Repeat1` (lucide) when `'one'`; `Repeat` when `'off'` / `'all'`. `.on` class set
  whenever mode !== 'off'. aria-label switches per mode (2 new i18n keys
  `nowplaying.repeatModeOne` / `repeatModeAll` added across all **15** locales — Dict completeness).

## Part 4 — Keyboard shortcuts
- A `$effect` attaches a window `keydown` listener on mount, removes on cleanup. Since NowPlaying
  renders only while `player.expanded === true`, mount == overlay open.
- Mappings: **Space** → `player.toggle()` (preventDefault to stop page scroll);
  **ArrowLeft** → `player.prev()`; **ArrowRight** → `player.next()`.
- Suppressed when target is `INPUT/TEXTAREA/SELECT/contentEditable` or `e.isComposing` (IME).

## Part 5 — Shared-element FLIP morph + swipe-up
- New `src/lib/stores/morph.svelte.ts`: module-scoped from-rect store carrying nowbar slot rects
  through the unmount → mount transition. Intentionally NOT `$state` (read once on mount).
- Layout: `np-open` click + swipe-up commit both snapshot rects of `.np-art / .np-title /
  .np-artist` BEFORE `player.expand()`.
- `NowPlaying.onMount` reads the from-rects, awaits `tick()`, measures target rects of `.cover /
  .title / .artist`, computes inverse FLIP (translate + scale, origin `0 0`), applies it as the
  initial state with `transition:none`. Inline font-size pinned to the nowbar value so text
  doesn't pre-grow inside the scaled box. Two rAFs later: enable transitions and drop the inline
  transforms + set the target font-size; CSS animates the morph (~320ms ease-out). Inline-style
  cleanup runs in a `setTimeout` AFTER the transition so CSS rules own the rest state.
- **Chrome fade-in**: a `.morph` class on `.np` sets `.bar/.prog/.transport/.sheet` to
  `opacity:0; transform: scale(0.96) translateY(8px); transition: …`. The class is dropped in the
  same rAF as the transform release, so the chrome animates IN parallel.
- **Section entry guard**: `in:fly` uses `duration: morphRunning ? 0 : 320` so the section's
  built-in slide-up doesn't double-animate when the morph owns the entry. `out:fly` stays at 320ms
  (today's collapse path).
- **Swipe-up gesture** on `.nowbar`: pointerdown/move/up with `LIFT_THRESHOLD = 60px`. `deltaY <
  -6` enters drag mode so the click-vs-drag distinction is correct; mid-drag transform is
  `translateY(deltaY) scale(1..1.06)`. On release past threshold → capture rects + expand. Below
  → CSS snap-back. Pointer-capture calls wrapped in try/catch to survive synthesized/edge pointers.
- **Reduce-motion**: `prefersReducedMotion()` skips the FLIP entirely; today's `transition:fly`
  fallback handles the entry.

## Verification (live)
- **Shuffle + repeat**: shuffle button → `.on=true`; repeat 3 clicks → aria "Repeat one" + icon
  `lucide-repeat-1` → aria "Repeat all" + icon `lucide-repeat` (still `.on`) → off (`.on=false`).
- **Keyboard**: `Space` toggled playing false→true; `ArrowRight` advanced to next track ("PASSENGER").
- **FLIP morph frame-by-frame** (live `getComputedStyle.transform` samples): cover scale
  `0.168 → 0.354 → 0.514 → 0.643 → 0.743` toward 1.0; title fontSize `13 → 15.46 → 17.57 → 19.28
  → 20.6 → 24px`. Chrome transitions in parallel.
- **Swipe-up**: 30px (under) → snap back, transform cleared, NP NOT mounted; 80px (over) → mid-drag
  `translateY(-80px) scale(1.06)`, on release NP mounts (`.np` in DOM).
- `pnpm check` **0/0**, `pnpm test` **414/414**, `pnpm build` OK.

## Notes / follow-ups
- **Reverse-morph on collapse** intentionally deferred — collapse still uses today's `out:fly`.
  Reverse would need to defer `expanded=false` until the reverse-morph completes, which conflicts
  with the existing `$effect` cleanup that immediately dismisses the overlays stack. A future
  task can build it on top of `morph.captureFrom` from the NP side at collapse time.
- The `morph.svelte.ts` `prefersReducedMotion()` is duplicated with the marquee action's. Could
  consolidate into a tiny `motion.ts` helper later (cosmetic).
- The fallback watchdog interval (200ms) is generous; a real-world play() usually completes
  before the first tick, so the watchdog overhead is invisible. If profiling shows otherwise it
  can move to a single observer of `playGen` via a Promise race.
- The shuffle uses `Math.random()`. Fine for queue UX — not CSPRNG-grade.
