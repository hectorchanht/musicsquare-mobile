---
quick_id: 260607-f4y
slug: default-no-name-title-translation-rename
date: 2026-06-07
status: complete
commits:
  - 4730f5c  # Part A — translation policy + Bio-info rename
  - 0be3358  # Part B — NowPlaying marquee / hide genre / error
---

# Quick Task 260607-f4y — Summary

Two-part change. Decisions locked up-front via AskUserQuestion:
**names = flip defaults off (keep pickers)** · **lyrics = untouched** · **bio = auto by app language**.

## Part A — Translation policy
- **Names never auto-translate by default.** `src/lib/stores/settings.svelte.ts`: removed the
  legacy `nameLang` → `artistLang`/`titleLang` migration fallback. Defaults stay `'off'`; the
  per-part artist/title pickers remain for explicit opt-in. Returning users who only had the old
  `nameLang` now see original names (the cause of the translated title/artist in the report).
- **Bio info auto-translates to the app/device language.** `src/lib/stores/names.svelte.ts`: new
  `dnBio(text)` → `resolve(text, settings.appLang, [])` (appLang ⊆ LyricsLang, never `'off'`;
  `shouldTranslate` no-ops when the bio is already in the app language). Wired into the artist
  page bio paragraph (`artist/[name]/+page.svelte`, was deliberately untranslated under D-07).
- **Relabel "Last.fm info translation" → "Bio info".** Translation settings page drops the manual
  Last.fm tag picker; Bio info is now a read-only auto-translate note. `settings.translateLastfm`
  + `...Note` **values** updated across all **15** locales (keys unchanged → i18n parity intact).

## Part B — Now Playing
- **Marquee title + artist on one line.** Both made `nowrap`/clipped + the shared `use:marquee`
  action (home/artist pattern) with the copied `marquee-bounce` keyframe; reduced-motion → static
  ellipsis. Wrapped in `{#key player.current?.uid}` so the single persistent nodes re-measure per
  track. Title no longer wraps to 3 lines.
- **Genre/tag chips hidden** in Now Playing (removed `<TagChips>` + import). Enrichment kept only
  for hi-res cover-art adoption; dropped the now-vestigial `enrich` state + `EnrichResult` import.
- **Inline error banner** bound to `player.error` (already set on no-audio / resolve-throw / audio
  `error` event).

## Verification
- `pnpm check` → **0 errors / 0 warnings**; `pnpm test` → **414/414** passing; `pnpm build` → OK.
- Live (dev server, real Last.fm/CN data):
  - `/settings/translation` headings = Artist / Song title / Lyrics / **Bio info** / Translate mode
    / App language; Bio = note-only ("translated automatically to your app language"); **no
    "Last.fm" string anywhere** (picker gone).
  - Played a track → Now Playing: title/artist **single-line nowrap+ellipsis** (artist inline-block
    max-width 100%), **genre chip count = 0**, **no error banner** on a healthy track, names shown
    **untranslated**, lyrics still translating (English + 中文 below) — lyrics feature preserved.

## Notes / follow-ups
- Marquee *engagement* on an overflowing title was verified structurally (nowrap + action +
  keyframe = the already-shipped home/artist pattern); a long-title animation wasn't filmed.
- `lastfmLang` / `lastfmSkip` / `dnLastfm` remain in code but are no longer surfaced (kept to avoid
  localStorage migration churn). Could be pruned in a later cleanup.
- Bio text is translated via the names batch cache (`openmusic:name-tr:<lang>`); long bios bloat
  that cache slightly — fine for now.
- Env: repo needs Node 22 (`.nvmrc`/engines) but the shell defaults to Node 16; ran all tooling
  under nvm Node 22. Updated local `.claude/launch.json` to launch vite via Node 22 directly
  (bypasses the broken system-corepack `pnpm`); untracked, not committed.
