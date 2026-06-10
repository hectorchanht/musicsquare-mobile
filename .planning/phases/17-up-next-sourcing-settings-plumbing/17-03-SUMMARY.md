---
phase: 17-up-next-sourcing-settings-plumbing
plan: 03
subsystem: appearance-settings
tags: [svelte5-runes, settings-store, color-util, appearance, accent-hover, font-scale, i18n-consume]

# Dependency graph
requires:
  - phase: 17-up-next-sourcing-settings-plumbing
    plan: 01
    provides: shared settings.svelte.ts (upnext fields + effectiveUpnextMode), settings.svelte.test.ts harness, settings.demoPrefix i18n key (all 15 locales)
provides:
  - src/lib/services/color.ts — pure darken(hex, amount) accent-hover derivation helper (zero-dep)
  - FONT_SCALE_MIN=50 / FONT_SCALE_MAX=200 widened bounds (UX-03 / D-11)
  - applyTheme() now sets --color-primary-hover = darken(accent, 0.12) at runtime (UX-07 root-cause fix)
  - appearance page demo text sourced from player.current (title vs artist per slider type, D-12)
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure colour math util (no DOM/browser/store imports) — settings imports it without breaking leaf-store discipline; trivially node-testable"
    - "Runtime CSS-var derivation: applyTheme derives --color-primary-hover from the chosen accent instead of relying on a static app.css value"
    - "Demo/preview text reads player.current in the PAGE, never inside the leaf settings store (Pitfall 6 / SSR-leak rule)"
    - "FONT_SCALE clamp only WIDENS — clampInt re-clamps within the looser bounds so previously-persisted values stay valid (no migration)"

key-files:
  created:
    - src/lib/services/color.ts
    - src/lib/services/color.test.ts
  modified:
    - src/lib/stores/settings.svelte.ts
    - src/lib/stores/settings.svelte.test.ts
    - src/routes/(app)/settings/appearance/+page.svelte

key-decisions:
  - "darken() uses ~12% (amount 0.12) to match today's #7c5cff → #6a48f0 accent/hover relationship (A3)"
  - "Malformed input to darken() returns the input unchanged and never throws (T-17-07 mitigation): strict /^#?[0-9a-f]{6}$/i, no injection"
  - "applyTheme hover-derivation is asserted INDIRECTLY in the node test (browser=false → applyTheme is a no-op); the test asserts darken(accent,0.12) is the value it would set + applyTheme does not throw"
  - "Lyrics slider previews lyrics-type text using the song title as the representative name (D-12)"
  - "FONT_SCALE consts changed in place; the appearance sliders pick up the new 50/200 bounds automatically via the existing min/max bindings"

patterns-established:
  - "darken(hex, amount): regex-match → parse → per-channel scale by (1-amount) clamped 0..255 → reassemble #rrggbb; malformed passthrough"
  - "demoTitle/demoArtist = $derived(player.current?.title/artist ?? static fallback) read in page"

requirements-completed: [UX-03, UX-07]

# Metrics
duration: 6min
completed: 2026-06-11
---

# Phase 17 Plan 03: Appearance / Settings Plumbing Summary

Widened the text-size sliders to 50–200%, drove each slider's demo text from the actual current/last-played track, and fixed the dead accent-hover wiring by deriving `--color-primary-hover` from the chosen accent in `applyTheme()` via a new pure `darken()` helper.

## What Shipped

**Task 1 — Pure `darken(hex, amount)` helper + unit test (TDD)**
- New `src/lib/services/color.ts`: zero-dependency, side-effect-free `darken(hex, amount)`. Strict `/^#?[0-9a-f]{6}$/i` match (leading `#` optional), per-channel scale by `(1 - amount)` clamped to 0..255 and rounded, reassembled as `#rrggbb`. Malformed input (named colours, 3-digit shorthand, empty) returns the input unchanged — never throws.
- New `src/lib/services/color.test.ts`: 6 cases — per-channel darken, halve at amount 0.5 (`#ffffff`→`#808080`), clamp at 0 (`#000000` stays), `#`-optional parsing, malformed passthrough, amount 0/1 boundaries. RED-then-GREEN.
- Purity verified: no `browser`/`document`/`window`/store imports (grep gate returns 0), so it is safe to import from the leaf settings store.

**Task 2 — Widen FONT_SCALE + accent-hover derivation in `applyTheme()` + settings test (TDD)**
- `FONT_SCALE_MIN` 70→50, `FONT_SCALE_MAX` 160→200. The clamp only widens — `clampInt` re-clamps persisted 70–160 values within the new looser bounds, so they stay valid with no migration.
- `applyTheme()` now sets `r.style.setProperty('--color-primary-hover', darken(this.accent, 0.12))` immediately after `--color-primary`. This is the UX-07 root cause: `--color-primary-hover` was pinned at `#6a48f0` in `app.css` and never set at runtime, so hover surfaces (buttons/tabs/chips) ignored the chosen accent.
- Imported `{ darken }` from `$lib/services/color` (pure util — settings stays leaf; grep confirms 0 player imports).
- Extended `settings.svelte.test.ts`: FONT_SCALE bounds (50/200), clamp-widen cases (75/160/190 valid, 250→200, 30→50, NaN→default), and the accent-hover derivation (asserted indirectly — `browser` is false under the node project so `applyTheme()` is a no-op; the test asserts `darken(accent, 0.12)` is the value applyTheme uses and that `applyTheme()` does not throw). Plan-01's `effectiveUpnextMode` tests kept intact.

**Task 3 — Dynamic demo text on the appearance page**
- Imported `{ player }` from `$lib/stores/player.svelte` IN THE PAGE (settings stays leaf — Pitfall 6); added `const demoTitle = $derived(player.current?.title ?? 'Stargazing')` and `const demoArtist = $derived(player.current?.artist ?? 'Myles Smith')`.
- Replaced all five static demo literals with `t('settings.demoPrefix', { name })`: title-type sliders (title, NP-title) show `demoTitle`; artist-type sliders (artist, NP-artist) show `demoArtist`; the lyrics slider previews `demoTitle` as the representative name (D-12). The `settings.demoPrefix` key was created by Plan 01 — this plan only CONSUMES it; no locale file was edited.
- The slider `min/max` bindings already reference `FONT_SCALE_MIN/MAX`, so they pick up the widened 50–200 range automatically.

## must_haves Coverage

- **D-11** (sliders span 50–200%, persisted 70–160 stay valid): `FONT_SCALE_MIN=50`/`FONT_SCALE_MAX=200`; clampInt cases prove 160/75/190 load unchanged, 250→200, 30→50.
- **D-12** (demo text "example {name}" from current/last-played track, title vs artist per slider, static fallback): `$derived` reads + `t('settings.demoPrefix', { name })` on all 5 sliders.
- **D-13** (accent recolors hover surfaces app-wide; `applyTheme` derives `--color-primary-hover`; no second picker): runtime `setProperty('--color-primary-hover', darken(this.accent, 0.12))`; dead-wiring root cause fixed.

## Verification

- `vitest run src/lib/services/color.test.ts` — 6/6 green.
- `vitest run src/lib/stores/settings.svelte.test.ts` — 15/15 green (new FONT_SCALE + accent-hover cases + Plan-01 cases intact).
- `svelte-check --tsconfig ./tsconfig.json` — 0 errors, 0 warnings (4077 files; confirms the consumed `settings.demoPrefix` key resolves).
- `vitest run` (full suite) — 45 files, 489 tests green (no regression).

## Deviations from Plan

None — plan executed exactly as written.

## Threat Surface

All threat-register dispositions were satisfied as planned (no new surface introduced):
- **T-17-07** (darken malformed/hostile input): strict `/^#?[0-9a-f]{6}$/i`; non-match returns input unchanged, never throws; output is always a literal `#rrggbb` or the passthrough string.
- **T-17-08** (FONT_SCALE persisted value): `clampInt` re-clamps every load to 50..200; NaN/non-number → default 100 (unit-tested).
- **T-17-09** (settings→player SSR leak): `player.current` read in the appearance PAGE only; settings stays leaf (grep gate confirms 0 player imports in the store).
- **T-17-SC** (package installs): zero new dependencies this plan — N/A.

## Commits

- `aca5a14` test(17-03): add failing test for darken() accent-hover helper (RED)
- `58ac631` feat(17-03): implement pure darken(hex, amount) accent-hover helper (GREEN)
- `fe17f99` test(17-03): add failing tests for widened FONT_SCALE + accent-hover (RED)
- `5a0fa30` feat(17-03): widen FONT_SCALE to 50-200 + derive accent hover var (GREEN)
- `e8ad412` feat(17-03): dynamic demo text on appearance sliders from current track

## TDD Gate Compliance

Tasks 1 and 2 followed the RED→GREEN cycle with paired `test(...)` then `feat(...)` commits (verified in the commit log above). Task 3 is a UI-wiring task with no `tdd="true"` flag; its verification gate is `svelte-check` (clean).
