---
quick_id: 260607-gte
slug: now-playing-playback-resilience-cross-so
date: 2026-06-07
status: planned
---

# Quick Task 260607-gte — NowPlaying / playback resilience (4 parts)

Decisions locked via CONTEXT.md: **FLIP** for the morph; **industry-standard tri-state repeat**
(off → one → all → off); fallback order = enabled sources minus failed source, preferred-source
first, each tried at most once per attempt.

## Task 1 — Player store: shuffle + tri-state repeat state + integration
**File:** `src/lib/stores/player.svelte.ts`
- Add `shuffle = $state(false)`, `repeatMode = $state<'off'|'one'|'all'>('off')`.
- Methods:
  - `toggleShuffle()` → flips; when newly true, Fisher-Yates the queue slice AFTER `indexOf(current)+1`
    (current pinned, history pinned). When false, leave queue as-is (user-specified).
  - `cycleRepeat()` → off → one → all → off.
- Wire `<audio>` `ended` handler ([:147](src/lib/stores/player.svelte.ts:147)):
  - `one`: `audio.currentTime = 0; audio.play()` — don't advance.
  - `all`: if `indexOf(current) === queue.length - 1`, call `play(queue[0])`; else `next()`.
  - `off`: today's behavior — `next()`.
- `next()` end-of-queue branch ([:445](src/lib/stores/player.svelte.ts:445)): when `repeatMode==='all'`,
  wrap to `queue[0]` instead of growing.

## Task 2 — Cross-source fallback in `play()` (SRC-FB-01)
**File:** `src/lib/stores/player.svelte.ts` (+ a small pure helper in `src/lib/services/fallback.ts`)
- New `tryFallback(failedTrack, gen)`: returns the resolved Track from another source, or null.
  Order: `getEnabledAdapters({})` minus the failed source's id, sorted with `settings.preferredSource`
  first (when set). For each candidate source `s`:
  - `searchAll(\`${artist} ${title}\`, 1, { ...allFalse, [s]: true }, sig)` → `dedupeBest(... , s)`
    → first candidate (or scoreMatch if available).
  - `ensureTrackDetails(stub, sig)` → only return when `audioUrl` truthy.
  - Generation guard: bump `playGen` at the top of `play()`; abort fallback when a newer play() supersedes.
- Hook into `play()` ([:381-384](src/lib/stores/player.svelte.ts:381)):
  - When `!resolved.audioUrl` after `ensureTrackDetails`, run `tryFallback`.
  - On the audio element `'error'` listener ([:152](src/lib/stores/player.svelte.ts:152)) when the current
    error matches the playing track and `playGen` hasn't moved, run `tryFallback`.
  - On success: `play(fallbackTrack)` BUT with a `{ fromFallback: true }` opt so it does NOT
    re-record history and does NOT bump playGen again. On full exhaustion: keep the existing
    `player.error = '…'`.
- Reuse `searchAll` cache (5-min) — falls back are cache-friendly.

## Task 3 — NowPlaying transport: bind to store + tri-state repeat icon
**File:** `src/lib/components/NowPlaying.svelte`
- Replace local `let shuffle = $state(false); let repeat = $state(false)` with reads of `player.shuffle`
  / `player.repeatMode`.
- Buttons bind to `player.toggleShuffle()` / `player.cycleRepeat()`.
- Repeat icon swap:
  - off  → `Repeat` (muted color, default tone).
  - one  → `Repeat1` (accent).
  - all  → `Repeat` (accent).
- Add 2 i18n keys per parity locale (en/zh-Hant/zh-Hans): `nowplaying.repeatModeOne`,
  `nowplaying.repeatModeAll` for aria-label completeness.

## Task 4 — Keyboard shortcuts on NowPlaying
**File:** `src/lib/components/NowPlaying.svelte`
- `$effect` attaches a window `keydown` listener on mount, removes on cleanup.
- Suppress when `target` is `<input>`/`<textarea>`/contenteditable OR `isComposing`.
- `Space` → `e.preventDefault(); player.toggle()`.
- `ArrowLeft` → `player.prev()`, `ArrowRight` → `player.next()`.

## Task 5 — Shared-element morph + swipe-up to expand
**Files:** `src/routes/(app)/+layout.svelte`, `src/lib/components/NowPlaying.svelte`,
  + new `src/lib/stores/morph.svelte.ts` (tiny module-scoped store: source rects + progress).
- **Source-rect capture (pre-mount):** when the user clicks the nowbar `np-open` button OR swipes
  up past the threshold, capture `getBoundingClientRect()` of `.np-art`, `.np-title`, `.np-artist`
  on the nowbar and store in `morph.fromRects` BEFORE flipping `player.expanded = true`.
- **Target-rect snapshot (post-mount):** in NowPlaying's `onMount` (after a `tick()`), measure
  `.cover`, `.meta .title`, `.meta .artist` rects → `morph.toRects`.
- **Morph animation:** for each of the 3 shared elements, set on mount:
  - `transform: translate(dx, dy) scale(sx, sy); transform-origin: 0 0;` (the FROM state).
  - Then on the next frame: `transform: none;` with a 280ms ease-out transition.
  This is the standard FLIP "invert then play" — width/height never animate, only transform.
- **Chrome fade-in:** `.bar`, `.prog`, `.transport`, `.sheet` start at `opacity: 0; transform:
  scale(0.96) translateY(8px);` and animate to `opacity:1; transform:none;` over the same 280ms.
  Each gets a CSS class wired to a `morphIn` state that flips on `onMount` + rAF.
- **Reverse on collapse:** `player.collapse()` calls a method that runs the morph IN REVERSE
  (NP → nowbar) before setting `expanded = false`. For now, keep the existing `transition:fly` as
  a DEGRADED fallback if the morph rects are missing (e.g. when collapse fires from a non-nowbar
  source). Practical: most collapses are explicit, the back-gesture + ChevronDown happen on a
  mounted NowPlaying where rects are available.
- **Swipe-up gesture:** on the `.nowbar` element, add pointerdown/move/up that tracks `deltaY`.
  - When `deltaY < -6` (px), enter drag mode. Otherwise after pointerup with no drag, the
    `np-open` click fires (existing path).
  - Drag drives a `dragProgress = clamp(-deltaY / 200, 0, 1)`. Apply the same per-element FLIP
    interpolation to `.np-art/.np-title/.np-artist` while the nowbar is still mounted (transform
    only). The nowbar's background fades out as progress rises.
  - On release: `dragProgress >= 0.5` → set expanded=true + finish the morph in NP; else snap back.
- **Reduce-motion:** when `:root[data-reduce-motion]` is set, skip the morph entirely — set
  transitions to `none` and apply the final state instantly.

## Must-haves
- A track that fails on its native source auto-switches to another source and plays; only after
  every enabled source fails does the `player.error` toast appear.
- Shuffle randomizes Up Next (current pinned). Repeat cycles off→one→all→off with icon change;
  audio `ended` honors the mode (one = loop current; all = wrap queue; off = today's next()).
- Swipe up from the nowbar expands NowPlaying with the cover/title/artist *visually morphing*
  from their nowbar slots into their NP slots; chrome fades+scales in. Tap still works.
- On the open NowPlaying, Space pauses, ArrowLeft prev, ArrowRight next (suppressed inside text
  fields / IME).
- `pnpm check` clean, tests pass, build OK; live spot-check verifies fallback + shuffle + repeat
  + kbd. Morph verified structurally (rect snapshots present + transition fires).
