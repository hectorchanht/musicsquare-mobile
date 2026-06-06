---
phase: quick-260606-rvy
plan: 01
subsystem: home-discovery-ux
tags: [covers, cover-cache, backfill, drag-scroll, marquee, svelte-action, discovery]
requires:
  - searchAll + dedupeBest (catalog.ts / dedupe.ts) — pure reuse
  - mapWithConcurrency + resolveStub path (discovery.ts) — pure reuse
  - matchKey (match-key.ts) — cover-cache key, pure reuse
  - caaReleaseGroupCover (cover-art.ts, from nza) — preference step 2
provides:
  - getCachedCover / setCachedCover / coverCacheKey (cover-cache.ts)
  - backfillCovers (cover-backfill.ts) — lazy capped CN-source cover resolver
  - dragScroll action + shouldSuppressClick helper (dragScroll.ts)
  - marquee action + isOverflowing helper (marquee.ts)
affects:
  - src/routes/(app)/+page.svelte (home shelves/tiles)
  - src/routes/(app)/artist/[name]/+page.svelte (album row)
tech-stack:
  added: []
  patterns:
    - "Svelte action mirroring dragClose.ts (typed Action, pointer listeners, update/destroy)"
    - "Pure-helper-export-for-test idiom (shouldSuppressClick / isOverflowing) like velocity.ts"
    - "Flat versioned localStorage Record cache (openmusic:cover-cache:v1) with try/catch null/no-op"
    - "Reactive $state counter (coverVer) to recompute tile <img src> as lazy covers land"
key-files:
  created:
    - src/lib/services/cover-cache.ts
    - src/lib/services/cover-cache.test.ts
    - src/lib/services/cover-backfill.ts
    - src/lib/actions/dragScroll.ts
    - src/lib/actions/dragScroll.test.ts
    - src/lib/actions/marquee.ts
    - src/lib/actions/marquee.test.ts
  modified:
    - src/routes/(app)/+page.svelte
    - src/routes/(app)/artist/[name]/+page.svelte
decisions:
  - "cover-cache stored shape = flat Record<string,string> (key->url) at openmusic:cover-cache:v1 — simpler than the home shelf cache since values are tiny URL strings"
  - "tileCover preference order is image -> CAA-by-mbid -> cached CN cover -> gradient; the LAZY resolve is NOT in tileCover (sync render) but a post-paint backfillCovers that writes the cache + bumps coverVer"
  - "marquee animates text-indent (scrolls inline text WITHIN the clipped box) rather than transform on the span (which would move the clip box) — clean single-element solution, no inner wrapper needed"
  - "dragScroll deliberately does NOT set touch-action:none so touch keeps native momentum scroll; pointer drag is additive for mouse only (skips pointerType==='touch')"
  - ":global(.marquee-on) keeps the .al-name/.al-count component scope while silencing svelte-check's unused-selector false-positive for the runtime-added class"
metrics:
  duration: 11 min
  completed: 2026-06-06
---

# quick-260606-rvy: Home discovery tiles — real CN covers, drag-scroll shelves, marquee labels Summary

Backfill+cache real CN-source album covers for no-mbid discovery tiles, make horizontal shelves mouse-draggable without playing songs, and marquee-bounce truncated tile labels — a follow-up to nza's CAA-by-mbid covers, holding nza's never-block-render / never-broken-image contracts.

## What Was Built

Three home-discovery UX features as two dependency-free services + two dependency-free Svelte actions, wired into the home page and (cheaply) the artist page:

- **FIX-A — real covers for color-block tiles.** `cover-cache.ts` is a pure localStorage `Record<matchKey, url>` at `openmusic:cover-cache:v1` (get/set with try/catch graceful-null/no-op). `cover-backfill.ts`'s `backfillCovers` resolves a real cover for every track row lacking both a Last.fm image and an mbid — mirroring `resolveStub` (`searchAll → dedupeBest[0].cover`), concurrency-capped at 3 via the existing `mapWithConcurrency`, total-capped at `max=24`, skipping already-cached rows, never throwing. The home page fires it post-paint (after cache-apply and after refresh) and bumps a `coverVer` `$state` counter in `onResolved` so `tileCover` recomputes and resolved covers appear without a full refresh. `tileCover` preference is now exactly: Last.fm image → CAA-by-mbid → cached CN cover → gradient.
- **FIX-B — drag-to-scroll shelves.** `dragScroll.ts` pans a `.albumrow` on mouse/pointer drag (touch keeps native scroll — it skips `pointerType==='touch'` and never sets `touch-action:none`). It accumulates max |dx| and, past a 6px threshold, arms a one-shot **capture-phase** click suppressor so a shelf drag never fires a tile's onclick (mirrors dragClose's tap-vs-drag guard). Applied to all 4 discovery shelves + the artist album row.
- **FIX-C — marquee-bounce truncated labels.** `marquee.ts` measures `scrollWidth > clientWidth` via a ResizeObserver (SSR-guarded), and when overflowing AND not reduced-motion adds `.marquee-on` + sets `--marquee-dx`; the per-file CSS keyframe bounces `text-indent` within the clipped box (ellipsis otherwise). Applied to tile `.al-name`/`.al-count` on home + artist.

Pure logic is unit-tested: cover-cache get/set + matchKey-folding (8 cases), `shouldSuppressClick` drag-vs-tap threshold (5 cases), `isOverflowing` overflow detection (3 cases).

## Task Commits

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | Cover-cache (pure+tested) + lazy capped CN-source cover-backfill | `4e77ab2` | cover-cache.ts, cover-cache.test.ts, cover-backfill.ts |
| 2 | dragScroll action (drag-vs-tap) + marquee action (overflow) | `f240a5b` | dragScroll.ts, dragScroll.test.ts, marquee.ts, marquee.test.ts |
| 3 | Wire backfill + dragScroll + marquee into home & artist | `a8b2644` | (app)/+page.svelte, (app)/artist/[name]/+page.svelte |

(Note: an unrelated concurrent `docs(14)` commit `fc2ef98` interleaved between Task 2 and Task 3; it is not part of this task.)

## TDD Gate Compliance

Tasks 1 and 2 were `tdd="true"`. Both followed RED → GREEN:
- Task 1: cover-cache.test.ts written first, confirmed RED ("Cannot find module './cover-cache'"), then cover-cache.ts → 8/8 GREEN. cover-backfill.ts (network-dependent) has no direct unit test per the plan; verified compile + behavior by inspection (skips cached, caps via mapWithConcurrency, writes setCachedCover, never throws).
- Task 2: dragScroll.test.ts + marquee.test.ts written first, confirmed RED, then both actions → 8/8 GREEN.
Per-task commits bundle test+impl (atomic per-task), not separate RED/GREEN commits, per the sequential-executor instruction (commit each task atomically). No REFACTOR phase was needed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Restored 3 NUL bytes in home-page `{#each}` key expressions**
- **Found during:** Task 3 (editing the home page markup)
- **Issue:** Three `{#each ... (item.artist + ' ' + item.title)}` key expressions had a literal NUL byte (`0x00`) where the `' '` space-string should be — pre-existing corruption in the exact region I was editing (likely a prior tooling artifact). This also blocked exact-string Edit matching.
- **Fix:** Replaced all 3 NUL bytes with literal spaces while applying the FIX-B/FIX-C markup via a Python rewrite of the file. Keys now correctly read `artist + ' ' + title`.
- **Files modified:** src/routes/(app)/+page.svelte
- **Commit:** `a8b2644`

**2. [Rule 1 - Quality] `:global(.marquee-on)` to silence svelte-check unused-selector warning**
- **Found during:** Task 3 verify (first `pnpm check` run reported 4 unused-selector warnings)
- **Issue:** `.al-name.marquee-on` / `.al-count.marquee-on` are flagged "unused" by svelte-check because the `.marquee-on` class is added at runtime by `use:marquee`, not present in static markup. The project convention is check 0 errors / 0 warnings.
- **Fix:** Scoped the runtime part with `:global()` → `.al-name:global(.marquee-on)` (keeps the `.al-name` component scope, tells svelte-check the class is intentional). Re-ran: 0 errors, 0 warnings.
- **Files modified:** both edited pages
- **Commit:** `a8b2644`

## Verification

- `pnpm check` → **0 errors, 0 warnings** (4012 files).
- `pnpm test` → **217/217 passing** (26 files), including the 3 new test files (16 new pure-logic cases).
- `src/routes/+layout.svelte` → **untouched** (verified via git status).
- No new dependencies; Svelte 5 runes only; commits atomic on `main`.

Manual smoke (not blocking, requires a browser/device): tiles that were color blocks should fill with real CN covers shortly after load; dragging a shelf with the mouse scrolls it and does not play a song; long tile titles bounce, short ones stay static; reduced-motion → static ellipsis.

## Threat-Model Adherence

All three mitigations from the plan's STRIDE register were honored:
- **T-rvy-01** (XSS via cover URL): cached covers come from the same `dedupeBest` pipeline as nowbar art (already trusted) or CAA; rendered as `<img src>` attribute (not CSS `url()`); cache stores plain strings — no script/CSS-injection surface.
- **T-rvy-02** (self-DoS fan-out): `backfillCovers` caps in-flight at 3 (`mapWithConcurrency`), total at `max=24`, and skips cached rows so warm visits issue zero searches.
- **T-rvy-SC** (supply chain): no new packages — both services and both actions reuse existing primitives (mapWithConcurrency, matchKey, searchAll, dedupeBest, caaReleaseGroupCover).

No new security-relevant surface was introduced beyond the planned threat model (no new endpoints, no widened trust boundaries — `backfillCovers` issues the same `searchAll` requests the player already makes).

## Known Stubs

None. All new code paths are wired to real data sources (cover-backfill → searchAll/dedupeBest; tileCover reads the live cache + Last.fm/CAA). The gradient fallback is intentional graceful degradation, not a stub.

## Self-Check: PASSED

Created files verified present:
- src/lib/services/cover-cache.ts — FOUND
- src/lib/services/cover-cache.test.ts — FOUND
- src/lib/services/cover-backfill.ts — FOUND
- src/lib/actions/dragScroll.ts — FOUND
- src/lib/actions/dragScroll.test.ts — FOUND
- src/lib/actions/marquee.ts — FOUND
- src/lib/actions/marquee.test.ts — FOUND

Commits verified in git log:
- `4e77ab2` — FOUND
- `f240a5b` — FOUND
- `a8b2644` — FOUND
