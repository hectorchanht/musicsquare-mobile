---
quick_id: 260607-m4e
slug: library-playlist-play-all-history-clear-
date: 2026-06-07
status: complete
commits:
  - c31cbea
---

# Playlist Play-all head + History Clear top-right + seek-error fallback guard

## P1 — Playlist head icon

The Trash2 icon next to each playlist name was the only action and
showed by default in non-edit mode. Now: Trash2 only in editMode
(delete playlist); Play in non-edit (run playlist from track 0). Empty
playlists hide the button entirely. Same affordance shape as the row
icons (Play default, Trash2 in edit) for internal consistency.

## P2 — History Clear top-right

Moved the Clear-history button from below the list into the header-right
slot (same row as "Library · History"). The History tab is read-only, so
the existing edit-pill slot is free; new `.danger` variant of `.edit-btn`
tints it red. Bottom `.clear-history` button + CSS deleted.

## P3 — Seek-restart fix

Bug: clicking the progress bar on a Now Playing song triggered FROM the
Downloads or History tab restarted the song from 0 instead of seeking.

Root cause: seeking past the buffered range on a non-range-capable CDN
raises an `audio.error` event the browser silently recovers from, but
our gte cross-source fallback handler treated it as a playback failure
and called `play()` again — which resets `currentTime = 0`.

Fix:
- New private fields `lastSeekAt` + static `SEEK_ERROR_WINDOW_MS = 1500`.
- `seekFraction()` stamps `lastSeekAt = Date.now()` before setting
  `audio.currentTime`. The OS Media Session `seekbackward` /
  `seekforward` handlers stamp it too (parity).
- The `audio.error` listener now checks `Date.now() - lastSeekAt`; if
  the error fires within the window, it returns early (no fallback).
- A genuine playback failure (no recent seek) still flows through
  `runFallback` exactly as before.

Why Downloads + History more than Liked: tracks added from those tabs
arrive at `play()` with either pre-stored CDN URLs (Downloads) or
re-resolved fresh URLs that often land on CDNs without HTTP Range
support, so the seek-past-buffered-range error rate is higher. The
fix is universal — applies regardless of caller — but the symptom
disappears for the reported paths.

## i18n

1 new key × 15 locales: `library.playAll`.

## Gate

- `pnpm check` 0/0 (4070 files)
- `pnpm test` 415/415
