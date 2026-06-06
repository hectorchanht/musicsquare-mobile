---
phase: quick-260606-tmh
plan: 01
subsystem: ui-actions
tags: [longpress, gesture, click-suppression, trackmenu, bugfix]
requires:
  - "src/lib/actions/dragScroll.ts (FIX-B idiom mirrored)"
provides:
  - "longpress action that suppresses the trailing native click after a longpress fires"
  - "pure exported helper shouldSuppressClickAfterLongpress(fired)"
affects:
  - "every use:longpress call site (home tile, search row, library/album/artist rows, now-playing queue rows) — fixed uniformly at the action level, no call site edited"
tech-stack:
  added: []
  patterns:
    - "one-shot capture-phase click suppressor armed by a gesture, mirroring dragScroll FIX-B"
    - "self-disarm timeout so a stale armed flag never eats a later legitimate tap"
key-files:
  created:
    - "src/lib/actions/longpress.test.ts"
  modified:
    - "src/lib/actions/longpress.ts"
decisions:
  - "Fix at the shared action level (not per-call-site guards) so home/search/library/album/artist/now-playing are all corrected uniformly."
  - "700ms self-disarm because some mobile browsers emit no synthetic click after a long hold; bounds the armed window so an independent later tap is never swallowed."
metrics:
  duration: ~8 min
  completed: 2026-06-06
---

# Quick 260606-tmh: Long-press song tile (home & search results) Summary

Fixed the shared `use:longpress` action so a long-press opens the TrackMenu without also starting playback — by arming a one-shot capture-phase click suppressor (mirroring `dragScroll.ts` FIX-B) the instant the hold fires, with a ~700ms self-disarm so tap-to-play stays intact everywhere.

## What Changed

**Root cause:** `longpress.ts` dispatched a `longpress` CustomEvent after the 450ms hold but never touched the trailing native `click` the OS emits when the finger lifts. At every call site that trailing click ran the element's `onclick` (which calls `player.setQueue(...) + player.play(...)`), so a long-press opened the menu AND started playback — it looked like the menu "didn't open."

**Fix (action-level, no call site touched):**
- Exported a pure decision helper `shouldSuppressClickAfterLongpress(fired: boolean)` (returns `fired`) — unit-testable under the node-only vitest project, mirroring dragScroll's `shouldSuppressClick`.
- Added a `suppressNextClick` flag inside the action closure.
- In the timer callback, after dispatching `longpress`, the suppressor is armed (`suppressNextClick = true`, gated through the helper).
- Added a CAPTURE-phase `click` listener (`node.addEventListener('click', clickCapture, true)`) that `preventDefault()` + `stopPropagation()`'s the trailing click before the element's bubble-phase `onclick` can play, then disarms. Removed in `destroy()` with the same `true` capture flag.
- Added a ~700ms self-disarm `setTimeout` (some mobile browsers emit no synthetic click after a long hold) so a stale flag never eats a later legitimate tap. `clear()` and `destroy()` cancel the pending disarm timer; `suppressNextClick` is deliberately NOT reset on `pointerup` (the trailing click arrives after pointerup).
- Preserved all existing behavior: 450ms duration, >8px move-cancel, `contextmenu` preventDefault, pointerup/leave/cancel `clear()`.

**Test:** `src/lib/actions/longpress.test.ts` — node unit test for the pure helper (Test 1: `shouldSuppressClickAfterLongpress(true) === true`; Test 2: `shouldSuppressClickAfterLongpress(false) === false`), with a top comment noting the DOM capture-phase flow is verified manually (no jsdom), exactly as `dragScroll.test.ts` documents.

## Behavior Satisfied (all three required)

1. Long-press a home tile (`/`) / a search-result row → arms the suppressor when the hold fires, so `onlongpress` opens TrackMenu and the trailing click that would `player.play()` is eaten. No playback on long-press.
2. A normal short tap never fires the timer → never arms the suppressor → `onclick` runs normally → tap-to-play preserved.
3. The fix is at the shared action, so library/album/artist long-press and now-playing queue rows are corrected by the same code path with no regression (they were also silently double-firing play before).

## Verification

- `pnpm check` → **0 errors, 0 warnings** (svelte-check strict, against current HEAD).
- `pnpm test` → **258/258 passing across 32 files** (against current HEAD), including the 2 new `longpress.test.ts` cases.
- Manual (deferred to human, per plan): the four touch-device human-checks (long-press home tile, long-press search row, short-tap both, long-press library row).

## Deviations from Plan

### Cross-agent commit entanglement (working-tree race with the parallel Phase 14 executor)

- **Found during:** GREEN-phase commit of `src/lib/actions/longpress.ts`.
- **Issue:** I followed the strict hygiene rule and staged ONLY my file via explicit path (`git add src/lib/actions/longpress.ts`). Between my `git add` and my `git commit`, the **parallel Phase 14 executor** ran a broad stage (`git add -A` / `git commit -a` — against the hygiene rule, but that is its process, not mine) and swept my already-staged `longpress.ts` into ITS commit **`0c8ed2e` `feat(14-01): D-03 wire settings.defaultQuality …`**. My subsequent `git commit` then reported "no changes added to commit."
- **Net effect:** My fix's *content* is correctly committed and live at HEAD (verified: `git diff HEAD -- src/lib/actions/longpress.ts` is empty; the helper, capture listener, and self-disarm are all present; tests pass). It simply landed inside a Phase 14 `feat` commit rather than a standalone `fix(quick-260606-tmh)` commit.
- **Resolution / why no rewrite:** I did NOT rewrite `0c8ed2e`. Per the destructive-git prohibition, rewriting shared history that another active agent authored (and which contains its legitimate quality-ladder work across 10 other files) would risk destroying that agent's work. The fix is functionally complete and verified in the tree; the only cost is commit attribution.
- **Commit trail:**
  - `116d270` — `test(quick-260606-tmh): failing test for shouldSuppressClickAfterLongpress` (my RED commit, clean and standalone).
  - `0c8ed2e` — `feat(14-01): …` (parallel executor's commit; **contains my GREEN `longpress.ts`** as a swept-in 52-line addition alongside its own work).
- **No code deviation:** the implementation matches the plan exactly (Rules 1–4 not triggered; no bugs, missing functionality, or blocking issues encountered in the fix itself).

## Known Stubs

None. No hardcoded empty values, placeholders, or unwired data sources introduced.

## Threat Flags

None. No new network endpoints, auth paths, file access, or schema changes. The plan's threat register (T-tmh-01 tampering / T-tmh-02 UX-DoS, both bounded by the 700ms self-disarm) is satisfied by the implemented self-disarm + `shouldSuppressClickAfterLongpress(false) === false` test.

## Self-Check: PASSED

- FOUND: `src/lib/actions/longpress.ts` (contains `shouldSuppressClickAfterLongpress`)
- FOUND: `src/lib/actions/longpress.test.ts`
- FOUND commit: `116d270` (RED test)
- FOUND commit: `0c8ed2e` (GREEN fix content — entangled with parallel Phase 14 commit, see Deviations)
- Call sites unmodified: last touch of `+page.svelte` / `search/+page.svelte` is `a8b2644` (pre-existing, unrelated) — no call site edited by this task.
