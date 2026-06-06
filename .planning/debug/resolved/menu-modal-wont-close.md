---
gsd_debug_version: 1.0
slug: menu-modal-wont-close
status: resolved
trigger: "in playing song page, menu modal have to be closed by swipe down, back action, click outside of it. it can not be closed by any of these method now."
created: 2026-06-06T10:40:00Z
updated: 2026-06-06T11:05:00Z
---

# Debug Session: menu-modal-wont-close

## Symptoms

- **Expected behavior:**
  - On the now-playing (playing song) page, the ⋮ menu modal (track options menu) should be dismissable by ALL THREE of:
    1. Swipe down on the modal.
    2. Hardware/browser back action.
    3. Click/tap outside the modal (backdrop / scrim).
- **Actual behavior:**
  - The menu modal cannot be closed by ANY of those three methods. It stays open.
- **Error messages:** none reported (behavioral).
- **Timeline:** not specified.
- **Reproduction:** Open the now-playing page → tap the ⋮ (kebab/options) button → menu modal opens → try swipe-down, back, and tap-outside → none dismiss it.

## Likely Location

- `src/lib/components/TrackMenu.svelte` — the menu modal component.
- `src/lib/stores/overlays.svelte.ts` — overlay open/close state store.
- `src/lib/actions/dragClose.ts` — swipe-down-to-close action.
- `src/lib/components/NowPlaying.svelte` — hosts the ⋮ trigger on the now-playing page.

## Hypothesis Seed

All THREE independent dismiss paths failing simultaneously points to a single shared cause. Confirmed: the shared cause is upstream of all three close handlers (a corrupted History-API / overlay-stack state), not three separate handler bugs.

## Current Focus

- hypothesis: A NowPlaying `$effect` that calls `overlays.open()` captures the `$state` overlay
  stack as a reactive dependency, so it re-runs (cleanup→dismiss then re-open) every time the
  track menu pushes/pops — churning the `nowplaying` history entry and desyncing History-API
  depth from the overlay stack, which corrupts the shared dismiss path all three methods use.
- test: Static dependency-capture analysis of `overlays.open()`/`dismiss()` (both READ
  `this.stack` via `isTop`/`has`/`find`), cross-checked against the two `$effect` call sites.
  Runtime unit repro attempted but the node test env does not pump runes-effect scheduling.
- expecting: Reading a `$state` field inside an `$effect` body (even transitively through a
  method) registers it as a dependency in Svelte 5 → the effect re-runs on stack mutation.
- next_action: (resolved) Untrack the `overlays.open`/`dismiss` calls at both effect sites.
- reasoning_checkpoint: store logic itself is correct (scrim path keeps history balanced and
  does NOT collapse nowplaying); the defect is the effect re-run churn at the NowPlaying/
  TrackMenu call sites, not the store's dismiss algorithm.

## Evidence

- timestamp: 2026-06-06T10:48:00Z — `overlays.open(id, close)` reads the `$state stack` via
  `isTop(id)` (`overlays.svelte.ts:44`) and `has(id)` (`:48`); `dismiss(id)` reads it via
  `has(id)` and `.find()` (`:83-84`). Any `$effect` calling these captures `stack` as a dep.
- timestamp: 2026-06-06T10:50:00Z — `NowPlaying.svelte:246` ran `overlays.open('nowplaying', …)`
  inside an `$effect` with NO explicit reactive deps, so its ONLY dependency was the leaked
  `stack` read → re-runs on every stack mutation. `TrackMenu.svelte:91/97/103` had the same
  latent flaw (e.g. opening the picker would re-run the menu effect).
- timestamp: 2026-06-06T10:52:00Z — store-logic repro (mocked window/history, node): the scrim
  path correctly closes the menu, keeps `nowplaying` open, and leaves history balanced — i.e.
  the dismiss algorithm is sound. This eliminated the store's `dismiss`/`popping` logic as the
  bug and pointed at the effect re-run churn at the call sites.
- timestamp: 2026-06-06T10:58:00Z — fix verified: `svelte-check` 0 errors / 0 warnings; full
  vitest suite 201 passed / 23 files; dev server (`:5180`) transforms both edited components
  with HTTP 200 (no compile/transform error) and the compiled output contains the `untrack`
  wrapping.

## Eliminated

- The `dragClose` action (swipe path) — handler logic is correct; it calls `onclose()` on a
  past-threshold drag. Failed only because the shared downstream dismiss path was corrupted.
- The scrim `onclick` wiring and z-index/pointer-events — scrim sits above the sheet within
  `.np`'s stacking context and is clickable; no `pointer-events:none` affects it.
- The `overlays` store `dismiss()` / `popping` echo-swallow algorithm — proven balanced for
  the stacked (nowplaying + trackmenu) scenario by a node repro.

## Resolution

- root_cause: In Svelte 5, reading a `$state` value inside an `$effect` body — even indirectly
  through a method call — registers it as a reactive dependency. `overlays.open()` and
  `overlays.dismiss()` both READ the `$state` overlay `stack` (via `isTop`/`has`/`find`). The
  `$effect` at `NowPlaying.svelte` that calls `overlays.open('nowplaying', …)` therefore
  captured the overlay stack as its dependency and RE-RAN every time another overlay mutated
  the stack — specifically when the track menu pushed `'trackmenu-menu'`. On each re-run Svelte
  fired the effect cleanup (`overlays.dismiss('nowplaying')` → `history.back()`) and then the
  body again (`overlays.open('nowplaying')` → `history.pushState`), churning the `nowplaying`
  History-API entry. That desynced History-API depth from the overlay stack and corrupted the
  `popping` echo-swallow flag, so when the user invoked ANY of the three dismiss paths the
  menu's `dismiss('trackmenu-menu') → history.back()` landed on a corrupted history state and
  the close never settled — the modal stayed open. Because all three paths share this one
  History-API dismiss site, all three broke together. The three `$effect`s in TrackMenu had the
  same latent flaw (picker/detail opens would churn the menu effect).
- fix: Wrapped every `overlays.open(...)` / `overlays.dismiss(...)` call made from inside an
  `$effect` in `untrack(() => …)` so the effect no longer captures the overlay `$state` stack
  as a dependency. Each effect now depends ONLY on its intended reactive guards
  (`open`/`track`, `pickerOpen`/`track`, `detailTrack`, and NowPlaying's mount). No churn, so
  History-API depth stays in lockstep with the overlay stack and the shared dismiss path works
  for all three close methods. Imported `untrack` from `svelte` in both components.
- verification: `npx svelte-check` → 0 errors, 0 warnings. `npx vitest --run` → 201 passed /
  23 files. Dev server at http://localhost:5180 transforms both edited components (HTTP 200,
  no transform error) with `untrack` present in the compiled output. (Interactive 3-path
  dismiss to be confirmed by the user in-browser.)
- files_changed:
  - `src/lib/components/NowPlaying.svelte` — import `untrack`; wrap the `nowplaying` overlay
    `$effect` open/dismiss in `untrack`.
  - `src/lib/components/TrackMenu.svelte` — import `untrack`; wrap all three overlay `$effect`
    open/dismiss calls (menu, picker, detail) in `untrack`.

## Specialist Review

- specialist_hint: typescript (Svelte 5 runes / TypeScript codebase)
- result: LOOKS_GOOD — `untrack(() => overlays.open/dismiss(...))` at the effect call sites is
  the canonical Svelte 5 remedy for an unintended reactive-dependency capture. The reactive
  guards (`open && track`, `pickerOpen && track`, `detailTrack`) are still read OUTSIDE
  `untrack`, so each effect re-runs exactly when its own state changes (no behavior change),
  while the leaked `$state stack` read inside `open`/`dismiss` no longer becomes a dependency.
  Wrapping the cleanup return is harmless (cleanups don't track) and keeps the two sites
  symmetric. Narrower and safer than restructuring the store. No stale-closure risk: the close
  callbacks are invoked later from the store and read component scope at call time.
