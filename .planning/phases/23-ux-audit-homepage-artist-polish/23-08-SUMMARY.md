---
phase: 23-ux-audit-homepage-artist-polish
plan: 08
subsystem: feedback-a11y-overlays
tags: [toast, focus-trap, aria-pressed, aria-busy, haptics, a11y, ux]
requires:
  - src/lib/stores/toast.svelte.ts
  - src/lib/actions/focusTrap.ts
  - src/lib/util/haptics.ts
provides:
  - "NowPlaying + TrackMenu migrated off local toast onto the global toast store (UX-02)"
  - "aria-pressed on NowPlaying like + repeat transport toggles (UX-06 §7.1)"
  - "use:focusTrap (trap + restore) on TrackMenu, NowPlaying sheet, SleepTimerSheet (UX-06 §7.3)"
  - "aria-busy surfaced on TrackMenu gated rows (UX-06); haptic tick on like/addQueue commits (UX-05 §3.3)"
affects:
  - "completes the phase-wide feedback/a11y consolidation begun in Plans 01/02 (only home toast in Plan 04 remains outside this plan's scope)"
tech-stack:
  added: []
  patterns:
    - "Global toast.show() replaces per-component toast()/flash() local copies (D-15)"
    - "use:focusTrap composes alongside use:dragClose on the same overlay container; focus-only, never open/close"
    - "Haptic import aliased `tick as hapticTick` to avoid colliding with Svelte's microtask `tick`"
key-files:
  created: []
  modified:
    - src/lib/components/TrackMenu.svelte
    - src/lib/components/NowPlaying.svelte
    - src/lib/components/SleepTimerSheet.svelte
decisions:
  - "Aliased haptics `tick` to `hapticTick` in TrackMenu/NowPlaying — both already import Svelte's `tick` (microtask) which must not be shadowed (the existing TrackMenu sleep-timer `tick().then(...)` is the Svelte tick and is untouched)."
  - "aria-busy on the gated TrackMenu rows was already authored in Plan-04-era markup (inFlight.has(key)); verified present rather than re-added — the guard logic is untouched per the plan's constraint."
  - "focusTrap added as an additional action on the existing overlay containers (.menu / .np section / sleep .menu); the Phase 19 overlay $effect (dep open-only, untrack, single dismiss path) is byte-unchanged in all three files."
metrics:
  duration: ~6m
  tasks: 3
  files: 3
  completed: 2026-06-12
---

# Phase 23 Plan 08: NowPlaying / TrackMenu / SleepTimerSheet feedback + a11y Summary

Finished the phase's feedback/a11y consolidation on the two remaining local-toast surfaces and the overlay sheets. NowPlaying's `flash()` and TrackMenu's local `toast()` now route through the single global toast store; the NowPlaying transport like/repeat toggles reflect state with `aria-pressed`; `use:focusTrap` traps + restores focus on the TrackMenu menu, the NowPlaying sheet, and the SleepTimerSheet; TrackMenu's in-flight gated rows surface `aria-busy`; and commit-tier `haptics.tick()` fires on the like / addQueue commits.

## What Was Built

### Task 1 — TrackMenu: toast migration + focusTrap + aria-busy + haptics (UX-02/05/06) — commit `4cd95a8`
- Removed the local `toast(m)` function plus its `toastMsg`/`toastTimer` `$state`, and the inline `{#if toastMsg}<div class="toast">…</div>` render + the `.toast` CSS rule. Added `import { toast } from '$lib/stores/toast.svelte'` and rewrote every call site (`gated()` noAudio×2, `playNext`, `addQueue`, `like`, `doDownload` preparing/noAudio/downloaded/openedAudio, `doShare` shareCopied, `doRemix` remixing, `addToPlaylist`, `newPlaylist`) to `toast.show(...)`. ToastHost (mounted once in the layout, Plan 01) now renders all of it.
- Added `use:focusTrap` to the open menu `.menu` container (alongside the existing `use:dragClose`). Focus traps while open and restores to the trigger on close.
- `aria-busy={inFlight.has(key)}` on the three gated rows (remix/download/detail) was already present in the markup; verified intact. The `inFlight` guard logic (`shouldStartResolve` + `new Set().add` / `finally`-delete) is untouched.
- Added `hapticTick()` (`import { tick as hapticTick } from '$lib/util/haptics'`) inside `addQueue()` and `like()`. The Svelte microtask `tick` import is preserved; the menu's `tick().then(() => sleepTimer.sheetOpen = true)` is the Svelte tick and is unchanged.

### Task 2 — NowPlaying: flash→toast migration + aria-pressed + focusTrap + haptic (UX-02/05/06) — commit `3439c15`
- Removed `flash(m)` + `npToast`/`npToastTimer` `$state`, the inline `{#if npToast}<div class="np-toast">…</div>` render, and the `.np-toast` CSS. `toggleCurrentLike()` now calls `toast.show(...)` via the global store.
- `aria-pressed={currentLiked}` on the like transport button; `aria-pressed={player.repeatMode !== 'off'}` on the repeat toggle. (No shuffle toggle exists in the transport row — ii6 moved shuffle into the TrackMenu kebab — so no third aria-pressed was needed per §7.1.)
- `use:focusTrap` on the `<section class="np">` sheet container (the panel that only mounts while `player.expanded`). The overlay `$effect` (`overlays.open('nowplaying', …)`, dep-free + untrack) and the sheetState machine are unchanged.
- `hapticTick()` in `toggleCurrentLike` only; play/pause/seek/prev/next remain silent (§3.3). The `fly` transition import is still used by the section's own `transition:fly`, so it was kept.

### Task 3 — SleepTimerSheet focusTrap (UX-06 §7.3) — commit `8a3afcf`
- Added `use:focusTrap` to the open `.menu` sheet container (alongside `use:dragClose`). The `sleepTimer.sheetOpen` state and the open-only overlay `$effect` (dep `sleepTimer.sheetOpen` only, untrack, single dismiss) are unchanged. All controls already carry text labels (Moon icon + text); the scrim retains its `aria-label`, so no icon-only control needed an added label.

## Verification

- `pnpm check` → 0 errors, 0 warnings (4260 files) after each task.
- `pnpm vitest run src/lib/components/track-menu-gate.test.ts` → 1 file, 9 tests, all pass (guard logic unchanged).
- Residual-local-toast grep across TrackMenu + NowPlaying: no `function toast(`/`function flash(`, no `npToast`, no `.np-toast`, no inline `class="toast"` render — clean (T-23-21 mitigated: all toast text now routes through ToastHost's text-only render).
- `aria-pressed` present twice in NowPlaying (like + repeat); `use:focusTrap` present in all three target files (T-23-20 mitigated: focusTrap restores focus on destroy and never owns open/close; overlay `$effect`s unchanged).

## Deviations from Plan

None — plan executed as written. The only judgement call was aliasing the haptics `tick` as `hapticTick` in both TrackMenu and NowPlaying (both already import Svelte's microtask `tick`); this is a naming choice to avoid shadowing, not a behavior change. `aria-busy` on the gated rows was already authored in the existing markup, so Task 1's step (3) was a verification rather than an addition.

## Threat Flags

None — no new network/auth/file surface. T-23-20 (focus stranding) and T-23-21 (toast XSS) are both mitigated as designed; no new trust boundary introduced.

## Known Stubs

None. All three surfaces are fully wired to the existing global primitives (toast store, focusTrap action, haptics util) shipped by Plans 01/02.

## Self-Check: PASSED

- FOUND: src/lib/components/TrackMenu.svelte (use:focusTrap, toast.show, hapticTick)
- FOUND: src/lib/components/NowPlaying.svelte (use:focusTrap, aria-pressed×2, toast.show, hapticTick)
- FOUND: src/lib/components/SleepTimerSheet.svelte (use:focusTrap)
- FOUND commit: 4cd95a8 (Task 1)
- FOUND commit: 3439c15 (Task 2)
- FOUND commit: 8a3afcf (Task 3)
