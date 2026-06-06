---
phase: quick-260606-kyf
plan: 01
subsystem: playback / OS media integration
tags: [media-session, player, pwa, pure-module, ssr-guard]
requires:
  - src/lib/stores/player.svelte.ts (existing attach/play/toggle/prev/next/seekFraction)
  - src/lib/stores/names.svelte.ts (dn display-name translation)
  - src/lib/sources/types.ts (Track type)
provides:
  - "buildArtwork / safePositionState / playbackStateFor (pure media-session helpers)"
  - "MediaSession wiring in the player store (metadata, transport, seek, position-state, clear-on-stop)"
affects:
  - src/lib/stores/player.svelte.ts
tech-stack:
  added: []
  patterns:
    - "Pure node-Vitest module + thin runes wrapper (mirrors history-logic.ts)"
    - "Single SSR + feature-detection accessor (this.ms) gating all Media Session calls"
    - "Untrusted UA seek input clamped into [0, duration]"
key-files:
  created:
    - src/lib/services/media-session.ts
    - src/lib/services/media-session.test.ts
  modified:
    - src/lib/stores/player.svelte.ts
decisions:
  - "Artwork uses the cover URL across the standard size ladder with empty type (browser content-sniffs remote raster); null/empty cover falls back to /favicon.svg (only raster-less asset the manifest ships) — graceful SVG degradation accepted, no binary PNG authored."
  - "All throw-prone artwork/position/state logic lives in the pure media-session.ts so it is node-Vitest-testable; the runes store is a thin caller (history-logic.ts idiom)."
  - "seekto reuses seekFraction (its existing [0,1] clamp) when duration is finite; falls back to a clamped el.currentTime otherwise."
metrics:
  duration: ~6m
  completed: 2026-06-06
  tasks: 1 auto + 1 human-verify checkpoint (deferred to manual)
  files: 3
  tests-added: 16
requirements: [MS-01, MS-02, MS-03, MS-04, MS-05]
---

# Phase quick-260606-kyf Plan 01: Wire Media Session API Summary

Wired the W3C Media Session API so the OS/browser media surfaces (Chrome media hub, macOS Now Playing, lock screens) show the current track's title/artist/album/cover with working transport + ±10s skip + scrubber — backed by a pure, node-tested `media-session.ts` helper module and a thin, SSR-guarded wrapper in the existing player singleton.

## What Was Built

**`src/lib/services/media-session.ts`** (pure module, no runes / no `$app/environment`, `import type { Track }` only):
- `buildArtwork(cover)` — non-empty cover → `MediaImage[]` across the 96/128/256/384/512 + `any` size ladder, every `src` the cover URL, `type: ''` (browser sniffs remote raster MIME). null/empty cover → single `/favicon.svg` entry (`image/svg+xml`, `sizes: 'any'`). (MS-01)
- `safePositionState(duration, position)` — returns `null` unless `Number.isFinite(duration) && duration > 0`; otherwise coerces NaN/negative position to 0 and clamps position down to `duration`, returning `{ duration, position, playbackRate: 1 }`. This is the single guard preventing `setPositionState` from throwing in the hot timeupdate path. (MS-04, T-kyf-02)
- `playbackStateFor(hasTrack, playing)` — `'none'` when no track, else `'playing'` / `'paused'`. (MS-02)

**`src/lib/services/media-session.test.ts`** — 16 node-Vitest cases covering every `<behavior>` case (ladder mapping, empty-type, null/empty-cover fallback; finite/NaN/0/Infinity/negative duration, position>duration clamp, NaN/negative position coercion; all three playback-state mappings). One+ assertion per `it()` (satisfies `requireAssertions`).

**`src/lib/stores/player.svelte.ts`** (REUSE only — no new playback/queue logic):
- Private `get ms()` accessor — single SSR + feature-detection guard (`typeof navigator !== 'undefined' && 'mediaSession' in navigator`); every Media Session call goes through it and early-returns when null. (MS-05, T-kyf-03)
- `attach()` registers all 7 action handlers ONCE (play, pause, previoustrack, nexttrack, seekbackward, seekforward, seekto). Transport handlers reuse `prev()`/`next()`/the audio element; seek handlers treat `details.seekOffset`/`seekTime` as untrusted — acted on only when finite, clamped into `[0, duration]`. (MS-03, T-kyf-01)
- Existing listeners augmented (no duplicate listeners added): `play`/`pause`/`ended` → `syncPlaybackState()`; `timeupdate`/`loadedmetadata`/`durationchange` → `syncPosition()` (guarded `safePositionState` → `setPositionState`). (MS-02, MS-04)
- `play()` sets `MediaMetadata` from the RESOLVED track (`names.dn(title/artist)`, album, `buildArtwork(cover)`) + `playbackState = 'playing'`. (MS-01)
- `clearMedia()` (metadata = null, state = 'none', clears position) called on the `error` listener and the no-`audioUrl` path. (MS-05, MS-02)

## Tasks Completed

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | Pure media-session helpers + node tests, then wire into the player store | 8f9f3d8 | src/lib/services/media-session.ts, src/lib/services/media-session.test.ts, src/lib/stores/player.svelte.ts |

## Verification

- `npm run check` → **0 errors / 0 warnings** (svelte-check + tsc; 3993 files).
- `npm test` → **17 files passed, 129 tests passed** (includes the 16 new media-session cases in the `server`/node project).
- Pure module confirmed runes-free / `$app/environment`-free (compiles in the node Vitest project).

## Manual Verification (checkpoint:human-verify — deferred, not blocking)

The plan's final task is a `checkpoint:human-verify` because the OS media UI cannot be asserted in a unit test. Per execution constraints these are recorded here as manual-verify items rather than blocking the run:

1. `npm run dev`, open in Chrome desktop and/or a mobile browser.
2. Search a song and tap to play.
3. Open the OS/browser media surface (Chrome media hub / macOS Control Center → Now Playing; Android lock screen / shade; iOS Control Center — SVG fallback art may degrade, acceptable).
4. Confirm it shows the track TITLE, ARTIST, ALBUM, COVER (not "openmusic…" + the Chrome icon).
5. Tap media-surface PLAY/PAUSE — playback toggles and displayed state matches.
6. Tap NEXT / PREVIOUS — track changes and metadata/art update.
7. Use ±10s skip and drag the SCRUBBER — position moves and the scrubber tracks real position during playback.
8. Stop / clear playback — the media surface shows no active track (state 'none').

Resume signal: type "approved" if all of the above hold, else describe what's wrong.

## Deviations from Plan

None — plan executed exactly as written. Minor naming note: the Vitest project that runs the pure tests is named `server` in vite.config.ts (the plan referred to it generically as the "node project"); the include/exclude semantics are identical (`src/**/*.{test,spec}.ts` excluding `*.svelte.{test,spec}.ts`), so the new `media-session.test.ts` runs there as intended.

## Authentication Gates

None.

## Known Stubs

None — all helpers are fully implemented and wired; the data feeding `MediaMetadata` comes from the resolved Track (no placeholder/mock data).

## Threat Flags

None — no new network endpoints, auth paths, or schema changes. Artwork `src` is the already-public track cover URL rendered by the UA (T-kyf-04 accepted). Seek inputs from the UA are clamped (T-kyf-01); position-state is guarded (T-kyf-02); all access is SSR/feature-gated (T-kyf-03). No new dependencies (T-kyf-SC).

## Self-Check: PASSED

- FOUND: src/lib/services/media-session.ts (3 exported helpers)
- FOUND: src/lib/services/media-session.test.ts
- FOUND: src/lib/stores/player.svelte.ts (7 setActionHandler, 1 new MediaMetadata, 2 setPositionState)
- FOUND: 260606-kyf-SUMMARY.md
- FOUND: commit 8f9f3d8
