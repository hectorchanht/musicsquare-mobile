---
phase: 22-lyrics-polish
plan: 02
subsystem: ui
tags: [lyrics, svelte, tap-to-seek, auto-scroll, ios-momentum, nowplaying]

# Dependency graph
requires:
  - phase: 22-01
    provides: reorderPairs, splitParenLines (widened), lineSeekFraction, LyricLine interface
provides:
  - NowPlaying lyrics pipeline composed parse→reorder→split (LYR-04 original-line highlight via untouched anchor)
  - per-line tap-to-seek with instant re-center + paused-resume (LYR-01)
  - momentum-safe ~3s auto-scroll resume via onscroll re-arm (LYR-02)
  - end spacer ≈ half visible band so last lines center in half AND full sheet modes (LYR-03)
affects: [22 verify-work (device checkpoint must pass before /gsd:verify-work)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Compose pure lrc.ts transforms in the lines $derived (parse→reorder→split); component stays render-only (CLAUDE.md BACKEND-REUSE seam)"
    - "Momentum-safe idle resume: onscroll re-arms a RESUME_MS timer while suspended so resume fires only after iOS momentum glide stops (no further pointer/wheel events)"
    - "Real trailing spacer element sized from the anchor $effect's visHeight to grow scrollHeight (browsers clamp scrollTo to content bounds)"

key-files:
  created: []
  modified:
    - src/lib/components/NowPlaying.svelte

key-decisions:
  - "Kept the lyric line as a semantic <p> (not <button>): the anchor $effect's querySelectorAll('p')[idx] scroll-centering, the .lyrics p centring/active/paren CSS, and the activeTime↔translated[i] index alignment all depend on the p tag — swapping to <button> would break the anchor lookup the plan explicitly forbids editing. Made it a focusable tap/keyboard target via role=button + tabindex + onkeydown, silencing the three resulting a11y advisories at element scope (first svelte-ignore usage in the codebase, scoped + documented inline)."
  - "RESUME_MS=3000 shared by lyricsReleased, lyricsWheel, and the new bumpResume so the resume delay is single-sourced."

patterns-established:
  - "bumpResume() is a no-op once autoScroll is true, so the anchor $effect's own programmatic smooth-scroll never re-suspends itself."

requirements-completed: [LYR-01, LYR-02, LYR-03]

# Metrics
duration: ~12 min
completed: 2026-06-12
---

# Phase 22 Plan 02: Lyrics Tap-to-Seek + Auto-Scroll Polish Summary

**Wired the pure lrc.ts functions into NowPlaying.svelte: composed parse→reorder→split pipeline (LYR-04), per-line tap-to-seek with instant re-center + paused-resume (LYR-01), momentum-safe ~3s auto-scroll resume (LYR-02), and an end spacer so the last lines center in every sheet mode (LYR-03).**

## Performance

- **Duration:** ~12 min
- **Completed:** 2026-06-12
- **Tasks:** 2 of 3 automated + committed; Task 3 is a blocking human-verify device checkpoint (PENDING — see Next Phase Readiness)
- **Files modified:** 1

## Accomplishments
- `lines` $derived now composes `splitParenLines(reorderPairs(parseLRC(player.current.lrc)))` — reorder sits between parse and split (D-04 pipeline order). `activeIndexAndTime` is byte-unchanged, so the existing first-of-group anchor delivers LYR-04 (after reorder, first-of-group is the original).
- `seekToLine(line)` seeks via `lineSeekFraction(line.time, player.duration)` → `player.seekFraction` (auto-plays when paused, D-03), then clears the idle timer and re-arms `autoScroll` (D-02 instant re-center overriding the tap's own pointerdown suspend). Every lyric line is a tap target with Enter/Space keyboard parity (`seekToLineKey`).
- Raised the lyrics auto-scroll resume delay from 600ms to `RESUME_MS = 3000` (D-10) and added `bumpResume()` wired to `onscroll` — it re-arms the resume timer on every scroll tick while suspended, covering iOS momentum glide which emits no further pointer/wheel events (Pitfall 1); it is a no-op once auto-scroll is on.
- Added a real `.lyrics-end-spacer` element inside `.lyrics` after the `{#each}`, sized `spacerH = Math.round(visHeight / 2)` from the anchor $effect (Pitfall 3 — browsers clamp scrollTo to content bounds). No top spacer (D-12).
- Full suite (747 tests) green; `pnpm check` 0 errors / 0 warnings.

## Task Commits

Each task was committed atomically:

1. **Task 1: Compose pipeline + per-line tap-to-seek (D-01/D-02/D-03/D-04, LYR-01/LYR-04)** — `ca1411b` (feat)
2. **Task 2: Momentum-safe ~3s idle resume + end spacer (D-10/D-11/D-12, LYR-02/LYR-03)** — `0d804ff` (feat)
3. **Task 3: Device verification** — PENDING (blocking human-verify checkpoint; verification-only, no code)

## Files Created/Modified
- `src/lib/components/NowPlaying.svelte` — added `reorderPairs`/`lineSeekFraction` imports; composed parse→reorder→split in the `lines` $derived; added `seekToLine` + `seekToLineKey`; wired `onclick`/`onkeydown`/`role`/`tabindex` (+ scoped svelte-ignores) on the lyric `<p>`; added `RESUME_MS`, `bumpResume`, `onscroll={bumpResume}`, raised resume delay to 3000ms; added `spacerH` state, set it in the anchor $effect, mounted the `.lyrics-end-spacer` element + a minimal `.lyrics-end-spacer` CSS rule.

## Decisions Made
- **Lyric line stays a `<p>` (not `<button>`):** the anchor $effect's `querySelectorAll('p')[idx]` scroll-centering, the `.lyrics p` CSS, and the `activeTime`↔`translated[i]` alignment all key on the `p` tag. Made it a focusable tap/keyboard control via `role="button"` + `tabindex="0"` + `onkeydown`, silencing the three resulting a11y advisories at element scope (documented inline). This is the first `svelte-ignore` usage in the codebase — used three scoped one-line directives rather than introducing a `<button>` that would break the plan's do-not-touch anchor.
- **`RESUME_MS = 3000` single-sourced** across `lyricsReleased`, `lyricsWheel`, and `bumpResume`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] a11y warnings from making the lyric `<p>` tappable blocked the 0/0 svelte-check gate**
- **Found during:** Task 1 (per-line tap-to-seek wiring)
- **Issue:** Adding `onclick` to the non-interactive `<p>` raised svelte-check a11y warnings (`a11y_no_noninteractive_element_interactions`, `a11y_no_noninteractive_element_to_interactive_role`, `a11y_no_noninteractive_tabindex`). The plan's acceptance criterion requires `pnpm check` to report 0 errors / 0 warnings, so the warnings blocked task completion.
- **Fix:** Added `onkeydown={seekToLineKey}` (Enter/Space parity), `role="button"`, and `tabindex="0"` to make the line a genuine focusable control, then silenced the three residual ARIA advisories with element-scoped `<!-- svelte-ignore -->` directives (one per line) and an inline rationale. The `<p>` tag is retained so the anchor $effect/CSS/index alignment (the plan's do-not-touch invariants) stay intact.
- **Files modified:** src/lib/components/NowPlaying.svelte
- **Verification:** `pnpm check` → 0 errors / 0 warnings; `pnpm vitest run` → 747 passed.
- **Committed in:** `ca1411b` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** The fix was required to satisfy the plan's own 0/0 acceptance gate while honoring the explicit "keep the `<p>` / do not touch the anchor" constraint. No scope creep — the lyric element's semantics and the anchor/CSS/index invariants are unchanged.

## Issues Encountered
- The multi-rule `svelte-ignore` (two rule codes on one line) did not silence the second rule; splitting into three separate one-line `svelte-ignore` directives (one per rule) resolved it cleanly. Also `tabindex="0"` introduced a third advisory (`a11y_no_noninteractive_tabindex`) that the third directive covers.
- Worktree had no `node_modules`; ran `pnpm install --frozen-lockfile` (lockfile-only restore, no package added — not a code deviation).

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- **BLOCKING device checkpoint pending (Task 3).** The three device-only contracts cannot be unit-tested and must be verified on a real iOS Safari device before `/gsd:verify-work`:
  1. LYR-01 tap-to-seek + instant re-center (main, paren, translation lines all tappable) and paused-resume.
  2. LYR-02 momentum touch-suspend (PRIMARY — previously live-broken): a hard flick must NOT snap back during the iOS momentum glide nor for ~3s after it stops; tap overrides the suspend and re-centers instantly.
  3. LYR-04 CN ordering: the ORIGINAL line (not the translation) is the highlighted/anchored current line.
  4. LYR-03 end spacer: last 2-3 lines reach the vertical center in HALF and FULL sheet modes.
- All automated work is committed; suite + svelte-check green. No code blockers.

## Self-Check: PASSED
- `src/lib/components/NowPlaying.svelte` — FOUND
- `.planning/phases/22-lyrics-polish/22-02-SUMMARY.md` — FOUND
- Commit `ca1411b` (Task 1) — FOUND
- Commit `0d804ff` (Task 2) — FOUND
- `pnpm check` — 0 errors / 0 warnings
- `pnpm vitest run` — 747 passed

---
*Phase: 22-lyrics-polish*
*Completed: 2026-06-12 (automated tasks; device checkpoint pending)*
