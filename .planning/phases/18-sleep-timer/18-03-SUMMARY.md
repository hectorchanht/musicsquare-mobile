---
phase: 18-sleep-timer
plan: 03
subsystem: sleep-timer
tags: [sleep-timer, ui, picker-sheet, overlay-effect, i18n-15-locale, nowbar-badge, now-playing-readout]
requires:
  - "sleepTimer leaf runes store — mode/deadline/selectedMinutes/remaining + set/restart/cancel + active getter (18-01)"
  - "fmtTime(s) — NaN/Infinity-safe mm:ss formatter (player.svelte.ts)"
  - "player.onSleepTimerSet() — coarse secondary wake-timer backstop the UI arms after set('minutes') (18-02)"
  - "overlays.open/dismiss + the pickerOpen overlay-registration $effect precedent (TrackMenu.svelte:154-158)"
  - "dragClose action + fly transition (existing sub-sheet idiom)"
provides:
  - "SleepTimerSheet.svelte — globally-mounted timer sub-sheet (3rd pickerOpen instance), driven by sleepTimer.sheetOpen, registers overlay 'trackmenu-timer'"
  - "sleepTimer.sheetOpen — UI-trigger $state flag any surface flips to open the global sheet"
  - "TrackMenu 'Sleep timer' menu item, Nowbar moon+countdown badge, NowPlaying full countdown/end-of-track readout — all converge on the same global sheet (D-08)"
  - "menu.sleepTimer / timer.endOfTrack / timer.cancel / timer.minutes (single interpolation key) in all 15 locale dicts, NO expiry-toast key (D-09)"
affects:
  - "Phase 19 (TrackMenu rework): the Sleep timer menu item stays an action that flips sleepTimer.sheetOpen; the sheet itself lives outside TrackMenu (in the app layout) so the menu restyle does not touch it"
  - "TIMER-01 is now user-facing end-to-end (set/indicator/reopen/cancel/change from menu, nowbar, and now-playing)"
tech-stack:
  added: []
  patterns:
    - "Third pickerOpen instance: open-only overlay-registration $effect (dep on sheetOpen ONLY, untrack around overlays.open/dismiss, visibility gated by {#if}) — Pitfall 6 / Phase-19 history-depth-desync avoidance"
    - "Global UI-flag-driven sheet mounted ONCE in (app)/+layout.svelte ungated — reachable in both collapsed nowbar and expanded now-playing states"
    - "Single interpolation i18n key (timer.minutes '{n} min') mirroring toast.skippedMany's {count} precedent — six durations from ONE key, not six strings"
    - "en.ts defines TranslationKey → 15-locale parity is enforced by svelte-check (a missing key in any dict is a compile error)"
key-files:
  created:
    - "src/lib/components/SleepTimerSheet.svelte"
  modified:
    - "src/lib/stores/sleepTimer.svelte.ts"
    - "src/lib/components/TrackMenu.svelte"
    - "src/lib/components/Nowbar.svelte"
    - "src/lib/components/NowPlaying.svelte"
    - "src/routes/(app)/+layout.svelte"
    - "src/lib/i18n/en.ts (+ 14 other locale dicts: zh-Hans zh-Hant ar de es fr hi id it pt ru th tr vi)"
decisions:
  - "The timer sheet is mounted ONCE in (app)/+layout.svelte (ungated) and driven by sleepTimer.sheetOpen rather than living inside the per-page-mounted, track-gated TrackMenu — so the indicator on the collapsed nowbar AND the expanded now-playing both reach the same sheet (D-06/D-07/D-08)"
  - "menu.sleepTimer/timer.endOfTrack/timer.cancel are static literal keys; timer.minutes is a SINGLE interpolation key ('{n} min') so the six durations come from one key (mirrors toast.skippedMany {count}) — no six hardcoded strings, no dynamic key construction"
  - "No expiry-toast key was added anywhere (D-09) — the live countdown IS the confirmation (D-12); cancelling is silent"
  - "Deviation: SleepTimerSheet's pickMinutes/pickEndOfTrack call player.onSleepTimerSet() after sleepTimer.set(...) to arm the 18-02 wake-timer backstop (Rule 2 — the 18-02 downstream contract; onSleepTimerSet is idempotent/self-disarms)"
metrics:
  duration: ~12 min
  tasks: 2
  files: 6
  completed: 2026-06-11
---

# Phase 18 Plan 03: Sleep Timer UI Summary

Built the user-facing sleep-timer surface: a globally-mounted duration sub-sheet (the third `pickerOpen` overlay instance), a "Sleep timer" track-menu item, and an active-timer indicator on both the collapsed nowbar (moon + live countdown) and the expanded now-playing (full mm:ss / end-of-track readout) — all three converging on the same global sheet via the new `sleepTimer.sheetOpen` UI flag (D-08, the fastest cancel/change path). Four i18n keys added to all 15 locale dicts with no expiry-toast key (D-09). Zero new packages — reuses the existing `@lucide/svelte` Moon icon, `dragClose`/`fly` sheet idiom, `overlays` registration precedent, the 18-01 store, and the 18-02 `onSleepTimerSet()` wake backstop.

## What Was Built

### Task 1 — i18n keys + sheetOpen flag + SleepTimerSheet component + layout mount (commit a8bcfdc)

1. **Four i18n keys across all 15 locales** (en, zh-Hans, zh-Hant, ar, de, es, fr, hi, id, it, pt, ru, th, tr, vi): `menu.sleepTimer` (track-menu label), `timer.endOfTrack`, `timer.cancel`, and `timer.minutes` as a SINGLE interpolation key (`'{n} min'`) — mirroring the `toast.skippedMany` `{count}` precedent so the six durations are rendered from ONE key. EN added to `en.ts` first (it defines `TranslationKey`), then the same keys to the other 14 dicts with house-style translations. NO expiry-toast key (D-09 is silent).

2. **`sleepTimer.sheetOpen = $state(false)`** UI-trigger field added to `src/lib/stores/sleepTimer.svelte.ts` — the ONLY change to that store; the deadline logic from 18-01 is untouched. Any surface flips it to `true` to open the global sheet.

3. **`src/lib/components/SleepTimerSheet.svelte`** — a verbatim third instance of the `pickerOpen` precedent, driven by `sleepTimer.sheetOpen`:
   - Overlay-registration `$effect` copies the TrackMenu:154-158 shape EXACTLY — dep on `sleepTimer.sheetOpen` ONLY, `untrack(() => overlays.open('trackmenu-timer', () => (sleepTimer.sheetOpen = false)))` with cleanup `untrack(() => overlays.dismiss('trackmenu-timer'))`. Visibility gated by `{#if sleepTimer.sheetOpen}`, NOT by the effect (Pitfall 6 / T-18-06 history-depth-desync avoidance).
   - `.scrim` + `.menu` (`transition:fly={{ y: 240, duration: 200 }}` + `use:dragClose`) markup cloned from the :194-203 sub-sheet.
   - Header shows `{t('menu.sleepTimer')}` plus, when active in minutes mode, ` · {fmtTime(sleepTimer.remaining / 1000)}` live remaining (D-11).
   - `{#each [5,10,15,30,45,60]}` `.mi` buttons with `class:on` highlighting the active duration, labelled `{t('timer.minutes', { n: min })}`; an end-of-track `.mi` button (`class:on` on end-of-track mode); and a `{#if sleepTimer.active}` Cancel row (`{t('timer.cancel')}`).
   - Minimal scoped `<style>` copies `.scrim`/`.menu`/`.menu-head`/`.mi`/`.mi.on` from TrackMenu.

4. **`<SleepTimerSheet />` mounted ONCE, ungated** in `src/routes/(app)/+layout.svelte` (sibling to the `{#if !player.expanded}<Nowbar />` block) so it is reachable whether the now-playing is collapsed or expanded.

### Task 2 — TrackMenu item + Nowbar badge + NowPlaying readout (commit 2b995c4)

1. **TrackMenu.svelte** — added `Moon` to the `@lucide/svelte` import + `sleepTimer` store import; a new `.mi` menu item `onclick={() => { sleepTimer.sheetOpen = true; close(); }}` that opens the GLOBAL sheet and closes the track menu (no local timer state, no new $effect — the sheet lives in the layout).

2. **Nowbar.svelte** — added `Moon` + `sleepTimer` + `fmtTime` imports; a small tappable moon badge `{#if sleepTimer.active}` to the LEFT of the play button, showing the countdown `{fmtTime(sleepTimer.remaining / 1000)}` in minutes mode (icon-only for end-of-track, D-07), in a `min-0` container so the mm:ss never breaks the nowbar layout. `onclick={() => (sleepTimer.sheetOpen = true)}`.

3. **NowPlaying.svelte** — added `Moon` + `sleepTimer` imports (fmtTime/overlays already present); a full tappable readout near the `.transport` row using the `.t`/`class:on` idiom — `{fmtTime(sleepTimer.remaining / 1000)}` (full mm:ss, minutes mode) or `{t('timer.endOfTrack')}` (end-of-track), `onclick={() => (sleepTimer.sheetOpen = true)}` (D-08).

All three indicators converge on the same global sheet via `sleepTimer.sheetOpen = true`.

## Verification Results

- `npm run check` (svelte-check) → **0 errors, 0 warnings** across **4090 files** — proves all 15 dicts have the four new keys (a missing key is a `TranslationKey` compile error) and no type errors in the new component / store field
- `npx vitest run` full suite → **584/584 pass** (49 files) — no regression
- `grep -rc "timer.minutes" src/lib/i18n/*.ts | grep -v ':0' | wc -l` → **15** (key in every dict)
- `grep -c "menu.sleepTimer\|timer.endOfTrack\|timer.cancel\|timer.minutes" src/lib/i18n/en.ts` → **4**
- `grep -c "expir\|asleep" src/lib/i18n/en.ts` → **0** (no expiry-toast key, D-09)
- `grep -n "sheetOpen" src/lib/stores/sleepTimer.svelte.ts` → matches
- `grep -c "trackmenu-timer" src/lib/components/SleepTimerSheet.svelte` → **2** (overlay open + dismiss)
- `grep -c "SleepTimerSheet" src/routes/(app)/+layout.svelte` → **2** (import + ungated mount)
- `grep -c "onSleepTimerSet" src/lib/components/SleepTimerSheet.svelte` → **5** (armed in pickMinutes / pickEndOfTrack / cancelTimer paths)
- `sleepTimer.sheetOpen = true` in TrackMenu + Nowbar + NowPlaying → **1 each** (all three surfaces open the sheet)
- `sleepTimer.active` in Nowbar + NowPlaying → **1 each** (indicators gated on active)
- `fmtTime(sleepTimer.remaining` in Nowbar + NowPlaying → **1 each** (live countdown reuses fmtTime — no new formatter)

## Human-Verify Checkpoint (Task 3 — APPROVED)

The orchestrator drove the live app (mobile viewport, `http://localhost:4321`) and verified the browser-observable acceptance items. The verifier typed **"approved"**.

### Browser-verified — PASSED

- Track menu → "Sleep timer" item present and translated (EN).
- Sheet opens with 5/10/15/30/45/60 min + End of track options (moon icons).
- Pick 5 min → sheet closes, NowPlaying readout shows live countdown.
- Reopen via readout → header shows live "Sleep timer · m:ss", active duration highlighted, Cancel timer present.
- Restart: pick 10 min → remaining jumps to a fresh deadline (3:49 → 9:53) — D-11.
- Cancel → readout + nowbar badge disappear, NO toast (D-09 silent confirmed).
- Nowbar collapsed moon+countdown badge renders, no layout break.
- i18n verified translated (NOT fallback) in zh-Hant (睡眠定時器 / 本曲結束), zh-Hans, ar (RTL).
- Zero console errors across the whole flow.

### Deferred to manual device testing (residual human-verification — NOT verifiable in a desktop browser preview)

- **Expiry behavior**: desktop/Android ~10s volume fade → pause; iPhone instant-pause fallback (needs a real deadline + an iOS device).
- **D-05** gesture-abort during the fade window (tap play/next/seek mid-fade aborts the fade, restores volume, clears the timer).
- **D-03** end-of-track + repeat-one stops at the natural end (no rewind/advance).
- **D-04** manual pause + wait past a minutes deadline → indicator silently disappears.
- **D-09 / background**: OS lock-screen reads paused; a locked/background tab stops within seconds of the deadline.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 — Missing critical functionality] Wired `player.onSleepTimerSet()` into the sheet's set/cancel paths**
- **Found during:** Task 2.
- **Issue:** The 18-02 downstream contract (its SUMMARY "Notes for Downstream Plans") requires the UI to call `player.onSleepTimerSet()` after `sleepTimer.set('minutes', n)` to arm the coarse secondary wake-timer backstop (the `timeupdate` listener is the authority, but `onSleepTimerSet` catches the iOS screen-wake-after-stall case). The plan's Task-1 SleepTimerSheet action text described the `sleepTimer.set(...)` calls but omitted the `onSleepTimerSet()` arm.
- **Fix:** SleepTimerSheet's `pickMinutes`/`pickEndOfTrack`/`cancelTimer` handlers call `player.onSleepTimerSet()` after the corresponding `sleepTimer.set(...)`/`cancel()`. `onSleepTimerSet()` is idempotent and self-disarms (a later end-of-track set or cancel just clears any prior wake timer), so wiring it on every path is safe.
- **Files modified:** src/lib/components/SleepTimerSheet.svelte
- **Commit:** 2b995c4

## Known Stubs

None. All three indicator surfaces and the sheet are fully wired to the live `sleepTimer` store; no placeholder values, no unwired data, no TODO/FIXME. No expiry-toast key by design (D-09).

## Notes for Downstream Plans

- **Phase 19 (TrackMenu rework):** the "Sleep timer" menu item is an action that flips `sleepTimer.sheetOpen = true` and closes the menu — the sheet itself lives in `(app)/+layout.svelte`, NOT inside TrackMenu, so a TrackMenu restyle can move/restyle the menu item freely without touching the sheet or its overlay registration. Keep the action.
- Any future surface that opens the timer sheet only needs `sleepTimer.sheetOpen = true` (and `player.onSleepTimerSet()` if it also sets a minutes timer); the single global sheet handles the rest.

## Self-Check: PASSED

- FOUND: src/lib/components/SleepTimerSheet.svelte (created — 3rd pickerOpen instance, overlay 'trackmenu-timer')
- FOUND: src/lib/stores/sleepTimer.svelte.ts (modified — sheetOpen flag)
- FOUND: src/lib/components/TrackMenu.svelte (modified — Sleep timer menu item)
- FOUND: src/lib/components/Nowbar.svelte (modified — moon+countdown badge)
- FOUND: src/lib/components/NowPlaying.svelte (modified — full countdown readout)
- FOUND: src/routes/(app)/+layout.svelte (modified — ungated SleepTimerSheet mount)
- FOUND: 15 locale dicts each with the four new keys (svelte-check clean confirms parity)
- FOUND commit a8bcfdc (i18n + sheetOpen + SleepTimerSheet + layout mount)
- FOUND commit 2b995c4 (TrackMenu item + Nowbar badge + NowPlaying readout + onSleepTimerSet wiring)
