---
quick_id: 260607-ju0
slug: offline-download-cache-np-full-open-mini
date: 2026-06-07
status: incomplete
commits:
  - c7f9ac7  # P1 + P2 + P4 only — P3 (offline cache) + P5 (fav artists) deferred
---

# Quick Task 260607-ju0 — partial (3 of 5 items shipped)

User asked for 5 items. After P1/P2/P4 landed, they pivoted to a new /gsd:quick with
different priorities (reset-to-default + cache audit). Shipping the completed work
cleanly; P3 + P5 deferred to follow-up tasks.

## Shipped (c7f9ac7)

### P1 — Auto (app language) translation option
- `LyricsLang` widened to include `'auto'`. New exported `effectiveTarget(target)` in
  `settings.svelte.ts` resolves `'auto'` → `settings.appLang`.
- `names.dnArtist/dnTitle/dnLastfm` + the NowPlaying lyrics-translate effect all route
  the raw target through `effectiveTarget` before consuming.
- `dnBio` simplified to the same helper (deletes its inline 'auto' branch).
- Chip label reuses `settings.bioAuto` (no new i18n).

### P2 — More-like-this avatars from Last.fm
- Artist-page related shelf was using `deezerArtistCover` → frequent wrong-avatar
  matches on partial-name queries. Switched to `enrichArtist(name).lastfmArt` (same
  source as the hero — exact-name keyed). Deezer kept as fallback when LF empty.

### P4 — NowPlaying full-shrink top bar
- When subnav sheet is `'full'`, cover/title/artist + a compact play button collapse
  into a YT-Music-style horizontal mini-bar at the top. New `.np.fullshrink` CSS class
  (strict superset of `.reflow`). Half stays today's full-bleed cover.
- Transport row + progress hidden in full state (sheet covers them). Mini-play button
  in `.bar` markup, gated on `sheetState === 'full'`.

## Deferred

### P3 — Offline download cache + auto-replay from local
Non-trivial (IndexedDB blob store, play() routing). Standalone follow-up task.

### P5 — Fav artists feature
Data-layer started + reverted from this commit (partial scaffolding without UI would
have been dangling). Re-implement clean in a follow-up: library.favArtists state +
methods, /artist heart button, /library tab, HOME_SECTIONS id, i18n.

## Verification
- `pnpm check` 0/0, `pnpm test` 414/414, build OK.
- Live verification of the shipped items: visual checks left to UAT (user pivoted before
  preview verification ran).
