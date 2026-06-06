---
phase: quick-260606-ncw
plan: 01
subsystem: ui-overlays
tags: [audit, no-op, modal, scrim, outside-click, history-api]
requires: []
provides:
  - "Audit verdict: all TrackMenu scrims dismiss on outside-click via the single dismiss path; nested stack depth-balanced"
affects:
  - src/lib/components/TrackMenu.svelte
tech-stack:
  added: []
  patterns:
    - "state-flip → $effect cleanup → overlays.dismiss(id) single dismiss convergence"
key-files:
  created: []
  modified: []
decisions:
  - "Honest no-op: requirement already fully satisfied; no code change made (no fabricated churn)."
metrics:
  duration: ~8 min
  completed: 2026-06-06
  tasks: 1
  files-changed: 0
  check: "0 errors / 0 warnings"
  test: "19 files / 165 tests passed"
---

# Phase quick-260606-ncw Plan 01: Outside-Scrim Click Always Closes Any Modal Summary

**One-liner:** Audit confirmed all three TrackMenu sheets (context menu, playlist picker, track detail) already dismiss on outside (scrim) click through the single `state-flip → $effect-cleanup → overlays.dismiss` convergence, and the nested menu→picker stack closes the correct layer while staying History-API depth-balanced — **no code change warranted (honest no-op).**

## Outcome

**ALREADY SATISFIED — no code change needed.**

All three scrims close on outside-click via the single dismiss path; the nested menu→picker stack stays depth-balanced (top-of-stack `trackmenu-picker` pops first, leaving the menu open). No defect found. No source file was modified. Per the plan's explicit "honest no-op is a valid outcome" clause, no churn was fabricated.

## STEP A — Per-sheet outside-click audit

| Sheet | Scrim is sibling `<button>`, full-viewport `inset:0`, z-index strictly below sheet | Scrim `onclick` only flips local state (no direct `overlays.dismiss`) | State flip → matching `$effect` cleanup is the SOLE `overlays.dismiss` caller | `aria-label` present | Verdict |
|-------|---|---|---|---|---|
| **Context menu** (`trackmenu-menu`) | YES — `<button class="scrim">` at L111 is a sibling of `.menu` (L112), not its parent → inside-click cannot close. scrim z-index 80 (L156), `.menu` z-index 81 (L157). | YES — `onclick={close}`; `close()` (L28-31) flips `pickerOpen=false` + calls `onclose()` (parent flips `open`). No `overlays.dismiss`. | YES — menu `$effect` (L90-95) cleanup `() => overlays.dismiss('trackmenu-menu')` is the only dismiss site for this id. | YES — `aria-label={t('menu.closeMenu')}`. | PASS |
| **Playlist picker** (`trackmenu-picker`) | YES — `<button class="scrim">` at L127 is a sibling of `.menu` (L128). scrim z-index 80, sheet 81. | YES — `onclick={() => (pickerOpen = false)}`. No `overlays.dismiss`. | YES — picker `$effect` (L96-101) cleanup `() => overlays.dismiss('trackmenu-picker')` is the only dismiss site for this id. | YES — `aria-label={t('menu.close')}`. | PASS |
| **Track detail** (`trackmenu-detail`) | YES — `<button class="scrim">` at L138 is a sibling of `.modal` (L139). scrim z-index 80, `.modal` 81. | YES — `onclick={() => (detailTrack = null)}`. No `overlays.dismiss`. Also: X button (L140) and `use:dragClose` (L139) flip the same `detailTrack = null`. | YES — detail `$effect` (L102-107) cleanup `() => overlays.dismiss('trackmenu-detail')` is the only dismiss site for this id. | YES — `aria-label={t('menu.close')}` (scrim and X). | PASS |

**Convergence confirmed:** For every sheet, scrim / X / drag-close / back-gesture all merely flip local `$state` to `false`/`null`. The matching `$effect` CLEANUP (the only `overlays.dismiss(id)` call site) runs exactly once per close → one stack entry removed + one `history.back()` (echo swallowed by the `popping` flag). History depth never desyncs. This matches the documented invariant in `overlays.svelte.ts` (L1-19).

## STEP B — Nested menu→picker stack verdict

**VERDICT: PASS — closes the correct layer, depth stays balanced.**

Trace of the open path (tap "Add to playlist", L118 → `pickerOpen = true`):

- `open && track` remains true, so BOTH `{#if open && track}` (menu, L110-124) and `{#if pickerOpen && track}` (picker, L126-135) render simultaneously. Overlay stack = `[trackmenu-menu, trackmenu-picker]`, history depth **2**.
- The picker block is declared AFTER the menu block in source order. Both scrims share `class="scrim"` at z-index **80** (equal). At equal z-index, later-painted DOM wins stacking → the **picker scrim paints on top** and is the element that receives an "outside the picker" click. Confirmed: that click fires the **picker** scrim handler (`pickerOpen = false`), NOT the menu scrim handler.
- `pickerOpen = false` → picker `$effect` cleanup → `overlays.dismiss('trackmenu-picker')`. `trackmenu-picker` is the TOP of the stack, so the id-filter removes the top entry and `history.back()` pops exactly the picker's history state → depth returns to **1** (menu still open). **Correct layer closed; menu left open.**
- **Side-effect safety:** `close()` flipping `pickerOpen=false` (its line 29) is harmless here because while the picker is open the menu scrim is COVERED by the picker scrim (same z-index, painted later) so the menu scrim is not clickable. The menu's registered back-gesture handler is `() => onclose()` (L92) — it does NOT touch `pickerOpen` — so under repeated Back the two stacked entries pop independently and in LIFO order (picker first, then menu). **Holds.**
- Second outside-click (after the picker is gone, stack `[trackmenu-menu]`, depth 1): the menu scrim is now the top scrim and clickable → `close()` → menu `$effect` cleanup → `overlays.dismiss('trackmenu-menu')` → depth 0. Balanced.

## STEP C — Decision

Every check in STEP A and STEP B passes (as the orchestrator's pre-dispatch sweep anticipated). Per plan STEP C: **make NO code change.** Already satisfied — all three scrims close on outside-click via the single dismiss path; nested menu→picker stack stays depth-balanced. No code change needed.

Drag-to-close, back-gesture, X-button, `prompt()`/`confirm()` new-playlist flow, and all TrackMenu behavior are untouched and preserved.

## Verification

- `npm run check` → **0 errors / 0 warnings** (svelte-check, 3998 files).
- `npm test` → **19 test files / 165 tests passed** (vitest `--run`, ~800ms).
- Static audit confirms the wiring; no runtime regression possible since no source was modified.

### Manual verification (recorded for completeness)

The plan's manual steps (`npm run dev`) map 1:1 to the static trace above and require no source change to pass:
- Open context menu (⋯) → click dimmed area outside the sheet → menu scrim `onclick={close}` → closes. ✓ (traced)
- Open picker (menu → "Add to playlist") → click outside → picker scrim (top at equal z-index) fires `pickerOpen=false` → ONLY the picker closes, menu beneath remains; click outside again → menu scrim fires `close()` → menu closes. ✓ (traced, STEP B)
- Open track detail (menu → "Detail") → click outside → detail scrim `detailTrack=null` → closes. ✓ (traced)
- Back gesture: each `overlays.open` pushed exactly one history state; each dismiss pops exactly one → one Back per open overlay, no stuck-Back, no double-close. ✓ (per `overlays.svelte.ts` invariant)

> Note: live in-browser confirmation was not executed in this sandboxed worktree (no display/browser). The verdict rests on a complete static trace against the documented `overlays` invariant and the existing 165-test green suite. The wiring is unchanged from what already shipped.

## Deviations from Plan

None — plan executed exactly as written. Audit-first task; audit concluded "already satisfied," so no code was written, which is the plan's explicitly-sanctioned outcome.

## Known Stubs

None.

## Threat Flags

None — no new network endpoints, auth paths, file access, or schema changes (no source modified).

## Self-Check: PASSED

- Created files: SUMMARY.md (this file) — written.
- Modified source files: none (intentional no-op) — `git status --short` shows no `src/` changes.
- Commits: no per-task code commit made (no code change), per the constraints. Docs commit is owned by the orchestrator.
