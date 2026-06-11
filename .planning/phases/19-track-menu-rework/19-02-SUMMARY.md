---
phase: 19
plan: 02
subsystem: track-menu / bottom-sheet UI
tags: [MENU-01, MENU-02, QUEUE-04, marquee, gated-resolve-then-act, remix, overlay-invariant]
requires:
  - "src/lib/components/track-menu-gate.ts (isGatedReady + shouldStartResolve — from 19-01)"
  - "'remix' QueueContext + effectiveUpnextMode('remix')==='generated' (from 19-01)"
  - "menu.remix / toast.remixing / menu.preparing i18n keys ×15 (from 19-01)"
  - "src/lib/actions/marquee.ts (use:marquee overflow-only action)"
  - "src/lib/stores/player.svelte.ts (setQueue + play(_,{fresh}) → regenerate)"
  - "src/lib/services/catalog.ts (ensureTrackDetails — idempotent resolve)"
  - "src/app.css (global .sk skeleton class + @keyframes marquee-scroll)"
provides:
  - "Reworked TrackMenu.svelte: 2-row marquee header + top-right Like/Close, always-visible buttons, gated resolve-then-act (Download/Detail/Remix), Sparkles Remix row"
affects:
  - "19-03 (long-press fix — operates at trigger sites; TrackMenu's overlay invariant must stay intact, which it does)"
tech-stack:
  added: []
  patterns:
    - "always-visible buttons + per-action inFlight Set drives inline row spinners (resolve-then-act)"
    - "two-row {#key track.uid} marquee header (NowPlaying analog) for stub→resolved re-measure"
    - "single dismiss path preserved — new Close (X) calls close() only, never overlays.dismiss"
key-files:
  created: []
  modified:
    - src/lib/components/TrackMenu.svelte
decisions:
  - "Tasks 1-3 landed as ONE atomic commit (dfddc3c) to the single component file: the three contracts are mutually-dependent (Task 2's gated() is invoked by Task 3's Remix markup beside Task 1's header) and the file does not compile in partial states"
  - "doDownload / doDetail refactored from no-arg handlers to gated run(resolved) callbacks; Download still re-resolves at settings.downloadQuality inside the callback (WR-07 preserved); Detail just opens the sheet with the already-resolved track"
  - "Download filename now built from the re-resolved track (r.artist/r.title) instead of the closure `track` — same logical track, avoids a TS null-narrowing dependency on the prop"
  - ".menu-head scoped style KEPT (still used by the playlist-picker + detail sub-sheets); only the dead 9-row .mi-skel/.sk-ico/.sk-bar/@keyframes mi-shimmer were removed"
metrics:
  duration: ~10 min
  tasks: 3
  files: 1
  completed: 2026-06-11
---

# Phase 19 Plan 02: TrackMenu Rework Summary

Reworked the bottom-sheet `TrackMenu.svelte` against the three UI contracts of the phase — instant always-visible buttons with gated resolve-then-act (MENU-01), a two-row marquee header with a top-right Like+Close cluster and a header-only skeleton (MENU-02), and a `Sparkles` Remix row that force-generates a fresh up-next from the seed (QUEUE-04) — all reusing existing primitives (the 19-01 gate helper, `ensureTrackDetails`, `use:marquee`, the player's fresh-play regenerate path) and leaving the load-bearing overlay/history `$effect` byte-unchanged.

## What Was Built

### Task 1 — Two-row marquee header + top-right Like/Close + header-only skeleton (MENU-02, D-08/D-09/D-10/D-11)
- Replaced the single ellipsised `{title} · {artist}` `.menu-head` line with a `.sheet-head` flex region: a left `.head-text` column (`flex:1; min-width:0`) holding two **display-only `<div use:marquee>` rows** (`.hd-title` 15px×`--fs-title`/weight 600/`--color-text`; `.hd-artist` 13px×`--fs-artist`/weight 400/`--color-text-muted`), each with a `.marquee-inner` span, wrapped in `{#key track.uid}` so a stub→resolved reassignment remounts the clips and forces `use:marquee` to re-measure (NowPlaying analog; Pitfall 2). Neither row is a button and neither navigates (D-10).
- Added a right `.head-actions` cluster (`flex:0 0 auto; gap:18px`): a Like button (`Heart size={20}`, accent fill + `.liked` class when liked, `aria-pressed={liked}`, `aria-label` liked/like, ≥44×44) then a Close button (`X size={20}`, `--color-text`, `aria-label={t('menu.closeMenu')}`, ≥44×44). Like is LEFT of Close (Close nearest the edge). The Close (X) calls `close()` only.
- Replaced the old 9-row `.mi-skel` skeleton with a **header-only** skeleton under `{#if loading && !track.title}` — two stacked `.sk` bars (15px×65%, 12px×45% + 6px gap) using the GLOBAL `.sk` class. Did NOT redefine `@keyframes marquee-scroll` (it is global, Pitfall 4).

### Task 2 — Always-visible buttons + gated resolve-then-act with inline spinner (MENU-01, D-01/D-02/D-03)
- The action list now ALWAYS renders — removed the `{#if loading} 9×skel {:else} buttons {/if}` gate; `loading` only drives the header skeleton (D-01).
- Added `let inFlight = $state(new Set<string>())` and a `gated(key, run)` handler: guards via `shouldStartResolve(inFlight, key)` (D-03 dedupe), fast-paths via `isGatedReady(track)` (run immediately on a resolved stub), else `inFlight = new Set(inFlight).add(key)` → `await ensureTrackDetails(track)` → toast `toast.noAudio` + return on `!audioUrl`, else `await run(resolved)`; `catch` toasts `toast.noAudio`; `finally` clears the key (`new Set(...).delete(key)`) — never a stuck spinner.
- Routed Download and Detail through `gated('download', doDownload)` / `gated('detail', doDetail)`; refactored both into `run(resolved: Track)` callbacks (Download re-resolves at `settings.downloadQuality` inside the callback per WR-07; Detail opens the sheet with the resolved track).
- Each gated row renders a 16px neutral `.row-spinner` (`--color-text-muted`, `border-top-color:transparent`, `spin .7s linear infinite`) in place of its leading icon when `inFlight.has(key)`, with `aria-busy` + a `menu.preparing` `aria-label`. Reduced-motion fallback drops the rotation (`prefers-reduced-motion` + `:root[data-reduce-motion]` → `animation:none`). Gated rows are tappable on a stub (never `disabled`).
- Removed the mid-list Like `.mi` row (D-09) — the header heart is now the sole Like; `like()` and the `Heart` import are retained (Pitfall 7).

### Task 3 — Remix action row (gated, force-generated) (QUEUE-04, D-04/D-05/D-06/D-07)
- Added a `Sparkles size={18}` Remix `.mi` row in the queue-actions cluster (after Play next / Add to queue, before Shuffle/Clear), labelled `t('menu.remix')`, routed through `gated('remix', doRemix)` so it shows the inline spinner while resolving and dedupes a double-tap.
- `doRemix(seed)` → `toast(t('toast.remixing'))`, `player.setQueue([seed], 'remix')`, `void player.play(seed, { fresh: true })`, `close()` — reuses the existing fresh-play regenerate path (`play(seed,{fresh})` → `regenerate` → `dedupeBest([seed, ...manualEntries, ...auto])`), forces generation via the `'remix'` context (`effectiveUpnextMode('remix')==='generated'` from 19-01), preserves manual pins, discards the prior generated tail. No new queue mechanism.

## Overlay Invariant (verified intact)

The `$effect` at TrackMenu.svelte:184-195 is byte-unchanged: dep is `open`-only, `untrack()` wraps `overlays.open/dismiss`, the cleanup `return () => untrack(() => overlays.dismiss("trackmenu-menu"))` is the SOLE dismiss caller, and `{#if open && track}` is preserved as the visibility gate. The new Close (X) calls `close()` only (which flips `pickerOpen=false; onclose()`), never `overlays.dismiss` directly — converging on the single dismiss path. `track` is never an effect dep.

## Verification

- `pnpm check` — svelte-check **0 errors / 0 warnings** (`Sparkles` import resolves; the gate-helper import resolves; no dangling `like()`/`Heart`; gated callbacks type-check).
- `pnpm test` — full node suite green: **51 files / 626 tests passed** (the 19-01 gate, player remix-context, settings force-generate, and 15-locale i18n parity tests all unaffected).

## Deviations from Plan

None affecting behavior — plan executed as written. One structural note recorded as a decision (above): the three tasks landed as a single atomic commit because they are mutually-dependent edits to one component file that does not compile in partial states (Task 2's `gated()` is called by Task 3's Remix markup which sits beside Task 1's header). All per-task acceptance criteria are individually satisfied in the final file. No Rule 1–4 deviations triggered; no package installs (threat T-19-SC: nothing to slopcheck).

## Manual / Device-Only Items (phase-gate tracking, out of node-test scope)

- MENU-01 always-visible-buttons + resolve-then-act flow (open menu on an unresolved stub → buttons visible immediately; tap Download/Detail/Remix on a stub → inline spinner → fires on resolve; second tap while spinning = no-op; forced resolve failure → spinner clears + `toast.noAudio`) — device/preview-verify (no jsdom project).
- MENU-02 two-row header marquee re-measure on stub→resolved + the X-closes/Back-stays-on-route history check — device/preview-verify.
- QUEUE-04 Remix on a resolved track plays first + up-next becomes a fresh genre-generated queue with manual pins surviving + `toast.remixing` — device/preview-verify (the underlying regenerate path is node-tested in 19-01; the UI trigger + toast are the visual half).

## Known Stubs

None. No hardcoded empty data flows to UI, no placeholder text, no TODO/FIXME — every action row is wired to a real handler.

## Threat Flags

None. No new network endpoint, auth path, file access, or trust-boundary schema change — header text + labels are display-only and Svelte auto-escaped (matches the plan's `<threat_model>` T-19-NA "accept"). The overlay/history integrity item (T-19-HIST) is mitigated: the `$effect` invariant is intact and the new X uses the single dismiss path.

## Self-Check: PASSED

- Modified file exists: `src/lib/components/TrackMenu.svelte` — present (`git show HEAD:src/lib/components/TrackMenu.svelte` resolves).
- Commit exists: `dfddc3c` (TrackMenu rework) — in `git log`.
- Overlay `$effect` dep `open`-only + `{#if open && track}` + new X → `close()` only — verified by grep.
- `pnpm check` 0/0; `pnpm test` 626 green — both confirmed this session.
