---
phase: 21-search-cover-pipeline-polish
plan: 03
subsystem: player-cover
tags: [covers, player, media-session, resolved-cover, generation-guard, tdd]
requires:
  - cover-cache.ts (getCachedCoverByUid / getCachedCover — two-layer D-13 read order)
  - cover-backfill.ts (resolveCoverForTrack — Plan-02 single-item never-throw tier chain)
  - media-session.ts (buildArtwork — favicon fallback)
provides:
  - "player.resolvedCover ($state) — the ONE cover field NowPlaying, Nowbar, and MediaSession all read (COVER-01 / D-09)"
  - "sync set on play() entry: track.cover ?? uid-cache ?? name-cache ?? null (clears stale art on every entry)"
  - "resolveCoverAsync(resolved, myGen) — generation-guarded async tier-chain land + FRESH-object MediaMetadata re-fire (Pitfall 4)"
affects:
  - src/lib/stores/player.svelte.ts
  - src/lib/components/NowPlaying.svelte
  - src/lib/components/Nowbar.svelte
tech-stack:
  added: []
  patterns:
    - "Single source of truth for the playing-track cover: one $state field drives three surfaces (UI x2 + OS MediaSession)"
    - "Sync-best-known-then-async-resolve: paint the best cached/stub cover immediately, fill a miss off the audio critical path"
    - "Generation guard (myGen !== this.playGen) discards a superseded async resolve before it paints — no stale art on fast skip"
    - "MediaSession repaint by assigning a BRAND-NEW MediaMetadata object (never mutate artwork in place — A2/Pitfall 4)"
key-files:
  created: []
  modified:
    - src/lib/stores/player.svelte.ts
    - src/lib/stores/player.svelte.test.ts
    - src/lib/components/NowPlaying.svelte
    - src/lib/components/Nowbar.svelte
decisions:
  - "resolvedCover seeded synchronously on play() entry so the first MediaMetadata write + both UI surfaces never flicker through a gradient when art is already known (D-09)"
  - "uid-cache read BEFORE name-cache BEFORE null (D-13 two-layer order) for the sync seed"
  - "async tier chain fires ONLY when both the sync read AND ensureTrackDetails' resolved.cover missed — playback never waits on it (T-21-07 accept)"
  - "total miss leaves resolvedCover null; surfaces keep their seeded gradient and MediaSession keeps /favicon.svg via buildArtwork (D-12)"
metrics:
  duration: ~15m
  tasks: 3
  files: 4
  completed: 2026-06-11
---

# Phase 21 Plan 03: Playing-Track Cover Guarantee Summary

A single `resolvedCover` field on the player store now feeds NowPlaying, Nowbar, and MediaSession — set synchronously from the best-known source on every `play()` entry and filled asynchronously through the Plan-02 tier chain on a miss, with a generation guard that discards a superseded resolve and a fresh-object MediaMetadata re-fire so the lock screen repaints (COVER-01).

## What Was Built

### Task 1 — `resolvedCover` field: sync set + async land + MediaSession re-fire (commit 3797150)
- Added `resolvedCover = $state<string | null>(null)` to the `Player` class — the one field all three surfaces read.
- Seeded **synchronously** on `play()` entry: `track.cover ?? getCachedCoverByUid(track.uid) ?? getCachedCover(track.artist, track.title) ?? null`. Repointing on every entry also clears stale art from the prior track.
- Both MediaMetadata writes (offline-blob path + network path) now feed `buildArtwork(this.resolvedCover)` instead of the raw track cover.
- When `ensureTrackDetails` resolves a cover the sync read missed (search stub had none), adopts it into `resolvedCover` so the network-path MediaMetadata + UI show real art without waiting on the async chain.
- `resolveCoverAsync(resolved, myGen)`: runs the Plan-02 `resolveCoverForTrack` (Deezer → iTunes → CN, never-throw, writes both cache layers on a SOLID https hit) only when art is still missing. On a SOLID result and only if not superseded (`myGen !== this.playGen`, Pitfall 4 / T-21-06), sets `resolvedCover` and re-fires a **brand-new** `MediaMetadata` object so the OS lock screen repaints. Miss or supersede → nothing written, gradient/favicon stand (D-12). Off the audio critical path; playback never waits (T-21-07).
- 7 new player tests: sync set, uid-before-name precedence, async land, fresh-object MediaMetadata, generation guard, repoint.

### Task 2 — Repoint NowPlaying + Nowbar at `player.resolvedCover` (commit 1244ee6)
- `NowPlaying.svelte` and `Nowbar.svelte` cover render now read `player.resolvedCover` with the existing gradient as the null fallback — one field drives all three surfaces (incl. MediaSession from Task 1).

### Task 3 — Human-verify cover guarantee across surfaces + lock screen
- **Blocking checkpoint NOT manually run** (user closed out via "skip verify"). The automated proxy passed: 92 player-store tests green cover the sync set, uid-before-name order, async land, generation guard, and MediaSession re-fire. Device-level lock-screen / no-cover-source / fast-skip verification deferred to a real-device pass.

## Verification

- `npx vitest run src/lib/stores/player.svelte.test.ts` → **92 passed**
- Task 3 manual device checkpoint: **deferred** (closed out via safe-resume "skip verify"; see Deviations).

## Deviations from Plan

- **Task 3 (blocking human-verify) not executed.** The original executor died after committing Tasks 1+2 but before writing this SUMMARY or running the Task 3 device check. On resume, the safe-resume gate detected the partial state (commits present, SUMMARY absent); the user elected to close out trusting the committed code + 92 green tests rather than re-run the device checkpoint. The lock-screen / no-cover-QQ-track / fast-skip-no-stale-art checks remain manually unverified.

## Notes for Downstream Plans

- **One cover field:** any surface needing the playing track's art should read `player.resolvedCover` (null → gradient). Do not re-read `track.cover` directly for the active track.
- **Outstanding device check:** before relying on lock-screen artwork in production, run the Task 3 manual pass — play a no-cover QQ track, confirm resolved art on nowbar + now-playing + OS notification; total-miss → gradient/favicon; fast skip → no stale art.

## Self-Check: PASSED (automated) — manual device checkpoint deferred
