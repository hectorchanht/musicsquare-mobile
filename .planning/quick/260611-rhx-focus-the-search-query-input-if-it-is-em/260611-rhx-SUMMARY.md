---
phase: quick-260611-rhx
plan: 01
subsystem: search-ui
tags: [search, ux, focus, mobile-keyboard, svelte5-runes]
requires:
  - "src/routes/(app)/search/+page.svelte onMount session-restore ordering (D-02)"
provides:
  - "Mount-time-only programmatic focus of the empty search input (RHX-01)"
affects:
  - "src/routes/(app)/search/+page.svelte"
tech-stack:
  added: []
  patterns:
    - "bind:this element ref as $state<HTMLInputElement | null> for programmatic focus"
    - "Guarded one-shot focus inside onMount (not a $effect) to avoid focus theft"
key-files:
  created: []
  modified:
    - "src/routes/(app)/search/+page.svelte"
decisions:
  - "Use programmatic queryInputEl?.focus() over a bare autofocus attribute to keep pnpm check 0/0 (autofocus triggers a11y_autofocus warning)"
  - "Place the focus call inside onMount AFTER the searchSession.hasPrior restore — a restored query makes q non-empty so focus is suppressed; mount-time-only semantic (not a $effect keyed on q) means clearing mid-session does not re-steal focus"
metrics:
  duration: 5 min
  completed: 2026-06-11
requirements: [RHX-01]
---

# Quick Task 260611-rhx: Focus the Search Query Input If It Is Empty Summary

Auto-focuses the search input at mount only when the query is empty, so a fresh visit raises the mobile keyboard while a restored prior session keeps its query and is not interrupted — implemented as a guarded, one-shot `queryInputEl?.focus()` folded into the existing `onMount` after the session restore.

## What Was Built

A single edited Svelte component (`src/routes/(app)/search/+page.svelte`) with three coordinated changes:

1. **Element ref** — `let queryInputEl = $state<HTMLInputElement | null>(null);` declared next to `let q = $state('')`.
2. **`bind:this`** — `bind:this={queryInputEl}` added to the search `<input>` (the `bind:value={q}`, `oninput`, `onfocus`/`onblur` behavior is untouched).
3. **Guarded focus** — at the end of the existing `onMount`, after the `if (searchSession.hasPrior) { ... }` restore block: `if (!q.trim()) queryInputEl?.focus();`.

Because the focus check runs after the restore, a restored prior query makes `q` non-empty and suppresses the focus (no focus theft). Because it lives in `onMount` (not a `$effect` keyed on `q`), clearing the input mid-session does not re-grab focus. The `?.` optional chaining tolerates the brief pre-attach window.

## Tasks Completed

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | Auto-focus the empty search input at mount | 78b585d | src/routes/(app)/search/+page.svelte |

## Verification

- `pnpm check` (Node v22.22.0): **0 errors / 0 warnings** across 4104 files. No `a11y_autofocus` warning introduced (confirms the decision to use programmatic `.focus()` over the `autofocus` attribute).
- Tests: The plan's `<verification>` flags the test run as optional ("skip if no test references this page — the change is mount-only DOM focus that node tests typically don't cover"). This change is a mount-time browser DOM-focus side effect with no pure-logic seam; node tests do not exercise the search-page component's `onMount` focus. `pnpm test` was not run on that basis — the gating contract for this plan is `pnpm check` 0/0, which passed.

## Success Criteria

- [x] Fresh visit to /search with empty query: input receives focus (keyboard rises on mobile) — `if (!q.trim()) queryInputEl?.focus()` runs at mount when no prior query.
- [x] Return visit with a restored session query: focus NOT stolen — focus check sits after the `searchSession.hasPrior` restore, so a restored `q` is non-empty and the guard short-circuits.
- [x] Mid-session clearing does not re-grab focus — logic is one-shot in `onMount`, not a reactive `$effect`.
- [x] `pnpm check` remains 0 errors / 0 warnings.

## Deviations from Plan

None - plan executed exactly as written. (Note: the verify command's PATH glob `/Users/laichan/.nvm/versions/node/v22*/bin` matched two installed Node 22 directories — v22.21.1 and v22.22.0 — producing a space-separated string that silently dropped the PATH prefix; substituting the exact `v22.22.0` path resolved it. This is an environment quirk, not a code change.)

## Known Stubs

None.

## Self-Check: PASSED

- FOUND: src/routes/(app)/search/+page.svelte (contains `bind:this={queryInputEl}`, `queryInputEl?.focus()` guarded by `!q.trim()` after the hasPrior restore)
- FOUND: commit 78b585d in git log
