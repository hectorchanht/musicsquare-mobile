---
phase: 19
plan: 01
subsystem: track-menu / queue / i18n
tags: [MENU-01, QUEUE-04, MENU-02, wave-0, pure-helper, tdd, i18n-parity]
requires:
  - "src/lib/sources/types.ts (Track shape)"
  - "src/lib/services/catalog.ts (ensureTrackDetails readiness guard — predicate analog)"
  - "src/lib/stores/player.svelte.ts (setQueue/regenerate/manualUids — reused verbatim)"
provides:
  - "src/lib/components/track-menu-gate.ts — isGatedReady + shouldStartResolve (pure, node-tested)"
  - "'remix' QueueContext member + effectiveUpnextMode('remix')==='generated' force-generate seam"
  - "menu.remix / toast.remixing / menu.preparing across all 15 i18n dicts"
  - "15-locale i18n parity test (was 3)"
affects:
  - "19-02 (TrackMenu rework — consumes the gate helpers + 3 i18n keys)"
  - "19-03 (long-press fix — builds on the same tested contracts)"
tech-stack:
  added: []
  patterns:
    - "exported-pure-helper + sibling .test.ts (marquee.ts / longpress.ts idiom)"
    - "force-generate via a QueueContext enum value + a one-line resolver early-return (vs threading a param)"
    - "i18n parity self-enforced by iterating Object.keys(dicts)"
key-files:
  created:
    - src/lib/components/track-menu-gate.ts
    - src/lib/components/track-menu-gate.test.ts
  modified:
    - src/lib/config/defaults.ts
    - src/lib/stores/settings.svelte.ts
    - src/lib/stores/settings.svelte.test.ts
    - src/lib/stores/player.svelte.test.ts
    - src/lib/i18n/i18n.test.ts
    - "src/lib/i18n/{ar,de,en,es,fr,hi,id,it,pt,ru,th,tr,vi,zh-Hans,zh-Hant}.ts (15)"
decisions:
  - "D-06 mechanism = QueueContext enum value + settings early-return (Assumption A1, least-churn vs param threading through play/regenerate)"
  - "D-05 proven by driving the private regenerate() directly with a 'remix' setup (mirrors the existing D-10 regenerate tests), not by booting the full fresh-play path — deterministic, no fake <audio> needed"
  - "i18n parity test widened to all 15 locales (Open Question 1 → recommendation taken): a key added only to en now fails CI in every missing locale"
metrics:
  duration: ~7 min
  tasks: 3
  files: 22
  completed: 2026-06-11
---

# Phase 19 Plan 01: Wave-0 Track-Menu Seams Summary

Landed the four node-testable seams the Phase-19 TrackMenu rework (19-02) and long-press fix (19-03) build on: a pure gating + in-flight-dedupe helper (`track-menu-gate.ts`), a `'remix'` force-generate `QueueContext` with a one-line `effectiveUpnextMode` early-return, the 3 new i18n keys across all 15 dictionaries, and a hardened 15-locale parity test — plus the two store-level tests proving QUEUE-04's force-generate (settings) and manual-pin-preservation / generated-tail-discard (player). No new runtime dependencies; no UI/DOM changes (those are 19-02/03).

## What Was Built

### Task 1 — Pure gating helper (`track-menu-gate.ts`) + sibling test (MENU-01, TDD)
- `isGatedReady(track: Track | null): boolean` → `!!(track && track.detailsLoaded && track.uid && track.audioUrl)` — the literal readiness test mirroring `catalog.ts:186`. true → a gated action (Download/Detail/Remix) runs immediately; false → resolve-then-act.
- `shouldStartResolve(inFlight: Set<string>, key: string): boolean` → `!inFlight.has(key)` — D-03 dedupe (a second tap while the key is in flight is a no-op; per-action keys independent; a cleared key resolves true again → never a stuck spinner).
- Both PURE (no DOM, no `$state`); the `new Set(inFlight)` reassign-for-reactivity discipline stays in the component (19-02). Follows the `marquee.ts` / `longpress.ts` exported-pure-helper idiom verbatim.
- TDD: test written first (RED — module-missing fail confirmed), then implementation (GREEN — 9/9). Committed as a single `feat` since the helper pair + its tests are one new seam.

### Task 2 — `'remix'` force-generate context (QUEUE-04 / D-06) + both store tests
- `defaults.ts`: widened the `QueueContext` union with `| 'remix'`.
- `settings.svelte.ts`: `effectiveUpnextMode` now early-returns `'generated'` for `ctx === 'remix'` as its FIRST line — so an explicit Remix always generates regardless of a global `'same-list'` override or any per-context setting.
- `settings.svelte.test.ts`: asserts `effectiveUpnextMode('remix') === 'generated'` under `upnextMode = 'same-list'`, and that a (hypothetical) per-context `remix: 'same-list'` override cannot defeat it.
- `player.svelte.test.ts`: a Remix-context case (`setQueue([seed], 'remix')`, a manual-pinned entry via `addToQueue`, a stale generated track in the queue, `buildSimilarQueue` mocked to a fresh tail) drives `regenerate(seed)` and asserts the result `= [seed, pinned, freshAuto]` — manual pin preserved (D-05), prior generated tail discarded.
- Player store itself needed ZERO edits — Remix reuses `setQueue` / `play(_,{fresh})` / `regenerate` verbatim (the enum value + the settings line carry D-06).

### Task 3 — 3 i18n keys × 15 dicts + hardened parity test (MENU-02 i18n)
- Added `menu.remix` (EN `Remix`), `toast.remixing` (EN `Remixing from this song`), `menu.preparing` (EN `Preparing…`) to all 15 locale files with faithful localized strings, matching each file's quote/section convention. Reused the pre-existing `menu.closeMenu` (no duplicate).
- `i18n.test.ts`: replaced the 3-locale parity assertion with one iterating `Object.keys(dicts)` (all 15 locales), added an explicit "Phase-19 keys present in every locale" assertion, and widened the no-blank-values loop to all 15.

## Verification

- `pnpm test` — full node suite green: **51 files / 626 tests passed** (includes the 9 new gate cases, the settings remix case, the player remix-context case, and the 15-locale parity + Phase-19-keys assertions).
- `pnpm check` — svelte-check **0 errors / 0 warnings** (the `'remix'` union widening type-checks across `defaults.ts` / `settings.svelte.ts` / `player.svelte.ts`; the new `TranslationKey`s type-check).
- `pnpm build` — production build succeeds with `@sveltejs/adapter-cloudflare` (smoke for the cross-store type widening).

## Deviations from Plan

None — plan executed exactly as written. All Wave-0 acceptance criteria met; no Rule 1–4 deviations triggered. No package installs (threat T-19-SC: nothing to slopcheck).

## Manual / Device-Only Items (out of this plan's scope, tracked for the phase gate)

These are NOT this plan's work (this plan is the node-testable Wave-0 seams) but are recorded so 19-02/03 and the phase gate know they remain:
- MENU-02 two-row header marquee re-measure on stub→resolved — device/preview-verify (no jsdom).
- MENU-03 no-stuck-`:active`/`:hover`/focus under finger on iOS Safari + Android Chrome — device-verify (Assumption A3, the one genuinely device-only contract).

## Known Stubs

None. This plan adds tested pure logic, a type widening, i18n strings, and tests — no UI data sources, no placeholders.

## Self-Check: PASSED

- Created files exist: `src/lib/components/track-menu-gate.ts`, `src/lib/components/track-menu-gate.test.ts` — both present.
- Commits exist: `5eec5dd` (gate helper), `fb283e7` (remix context), `6b28085` (i18n) — all in `git log`.
