---
phase: 260606-oil
plan: 01
subsystem: i18n / settings / display-name translation
tags: [translation, settings, i18n, svelte5-runes, language-detection]
requires:
  - LyricsLang type + translateLines(/api/translate) service
  - names store cache/pending/debounce/rev machinery
  - existing i18n dict pattern (en authoritative, zh-Hant/zh-Hans parity)
provides:
  - pure detectLang + shouldTranslate (whitelist decision per text unit)
  - per-part translation settings (artist/title/lyrics/lastfm targets + skip whitelists)
  - dnArtist/dnTitle/dnLastfm resolvers (independent per-part targets)
affects:
  - every names.dn render site (now dnArtist/dnTitle)
  - NowPlaying lyrics effect (per-line whitelist)
  - TagChips (lastfm tag gating)
tech-stack:
  added: []   # hand-rolled detector, no new deps
  patterns:
    - "pure Unicode-range + simp/trad char-set classifier (node-test-safe)"
    - "per-target translation cache keyed by target lang, shared across parts"
key-files:
  created:
    - src/lib/i18n/detect.ts
    - src/lib/i18n/detect.test.ts
  modified:
    - src/lib/stores/settings.svelte.ts
    - src/lib/stores/names.svelte.ts
    - src/lib/i18n/en.ts
    - src/lib/i18n/zh-Hant.ts
    - src/lib/i18n/zh-Hans.ts
    - src/routes/(app)/settings/translation/+page.svelte
    - src/lib/components/NowPlaying.svelte
    - src/lib/components/TagChips.svelte
    - src/lib/components/TrackMenu.svelte
    - src/routes/(app)/+layout.svelte
    - src/routes/(app)/+page.svelte
    - src/routes/(app)/settings/history/+page.svelte
    - src/routes/(app)/library/+page.svelte
    - src/routes/(app)/search/+page.svelte
    - src/routes/(app)/album/[name]/+page.svelte
    - src/routes/(app)/artist/[name]/+page.svelte
    - src/lib/stores/player.svelte.ts
decisions:
  - "Detector is a pure module (no $state/browser) so it runs under the node Vitest project"
  - "Translation cache stays keyed by TARGET lang (output is target-only) — parts sharing a target share cache"
  - "App-language section on the translation page is a pointer to /settings/general (appLang UI lives there); no duplicate control, no ja/ko chrome"
  - "Home page (+page.svelte) had 7 dn call sites NOT in the plan's 26-site map — swept as a deviation"
metrics:
  duration: ~11 min
  completed: 2026-06-06
  tasks: 3
  files: 18
---

# Phase 260606-oil Plan 01: Per-part translation settings redesign Summary

Independent per-part translation: each of artist name, song title, lyrics, and Last.fm tags now has its own target language and its own source-language skip whitelist, driven by a pure hand-rolled zh-Hant/zh-Hans/ja/ko/en detector — so a user can keep English artist+title original while translating zh-Hant lyrics and selecting ja for content parts, all at once.

## What was built

**Task 1 — Pure detection/decision module (TDD).** `src/lib/i18n/detect.ts` exports two pure functions:
- `detectLang(text)`: kana → `ja`, hangul → `ko`, Han-only with a simplified-only signal → `zh-Hans`, traditional-only signal → `zh-Hant`, ambiguous Han → `zh-Hant`, no-CJK/empty → `en`. Implemented with explicit `\u` Unicode-range regexes plus two 53-char disambiguation `Set`s (no overlap, verified). Kana/hangul win over Han when mixed.
- `shouldTranslate(text, target, whitelist)`: `false` when target=`off`, when detected source ∈ whitelist, or when source already === target; `true` otherwise.
- `detect.test.ts` (15 cases) covers every detection branch + the shouldTranslate truth table. Runs under the node Vitest project (no runes). RED → GREEN gate observed (failing test committed first, then implementation).

**Task 2 — Settings schema + migration + UI + i18n.**
- `settings.svelte.ts`: added `artistLang`/`titleLang`/`lastfmLang` (`LyricsLang`, incl. ja/ko) + four `SourceLang[]` skip whitelists (`artistSkip`/`titleSkip`/`lyricsSkip`/`lastfmSkip`, default `[]`). Non-destructive `load()` migration: a saved `nameLang` mirrors into BOTH `artistLang` and `titleLang`; `lyricsLang`/`appLang`/`translateMode`/all non-translation prefs preserved; `lastfmLang` defaults `off`. `save()` writes the new fields and stops writing `nameLang` (still read as a migration source). Same KEY (`openmusic:settings:v1`).
- `/settings/translation/+page.svelte`: four content sections (artist / title / lyrics / Last.fm), each with the target chip row (Off/繁/简/EN/日/한) + a de-emphasized "skip these source languages" multi-select (disabled when target=off). translateMode segment kept, gated on `lyricsLang≠off`. App-language section links to `/settings/general`.
- New i18n keys added to all three dicts (`translateArtist/Title/Lastfm` + per-part notes + `skipLanguages`/`skipLanguagesNote`); retired `translateNames`/`translateNamesNote`.

**Task 3 — Apply per-part logic everywhere.**
- `names.svelte.ts`: factored a private `resolve(text, target, whitelist)` (reads `rev`; returns original when `!text`/`off`/SSR/`!shouldTranslate`; else uses the existing per-target cache/pending/160ms-debounce/`translateLines`/localStorage/rev-bump). Exposes `dnArtist`/`dnTitle`/`dnLastfm`.
- Swept all `names.dn(` call sites (the 26 mapped + 7 unmapped home-page sites) to `dnArtist`/`dnTitle` per artist/title classification; `player.svelte.ts` MediaMetadata title→`dnTitle`, artist→`dnArtist`.
- `NowPlaying.svelte` lyrics `$effect`: per-line `shouldTranslate(line.text, lyricsLang, lyricsSkip)`; only non-skipped lines sent to `translateLines`, results stitched back by index so skipped lines keep their original text — `translated.length === lines.length` always holds, `showTr`/translateMode (below/replace) unchanged. `lyricsSkip` folded into `trKey` so toggling re-runs.
- `TagChips.svelte`: displayed label runs through `names.dnLastfm(tag)` (lastfmLang+lastfmSkip); the ORIGINAL tag is still used for `onTagClick`/`aria-label`/key. target=off ⇒ tags render exactly as before. Artist bio left untouched (D-07).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1/Rule 3 — Missing call sites] Home page had 7 unmapped `names.dn` sites**
- **Found during:** Task 3 (`npm run check` reported errors in `src/routes/(app)/+page.svelte` after removing the shim).
- **Issue:** The plan's `<call_sites>` map listed 26 sites but omitted the home page's top-hits, top-artists, tag-shelf, country-shelf, and fallback-song tiles (9 `dn` calls across 7 logical render points). Leaving them would break `npm run check`.
- **Fix:** Swept each per artist/title semantics — `item.title`/`a.name`(album)/`al.name` → `dnTitle`, `item.artist`/`a.name`(artist) → `dnArtist`. The artist-row label `a.name` is an artist name → `dnArtist`.
- **Files modified:** `src/routes/(app)/+page.svelte`
- **Commit:** 313dfdb

**2. [Rule 3 — Blocking compile] names.svelte.ts resolver pulled into Task 2**
- **Found during:** Task 2 (`npm run check` failed: `settings.nameLang` no longer existed but `names.svelte.ts` still referenced it).
- **Issue:** Removing `nameLang` from the Settings class broke the `dn()` reference, failing Task 2's required `npm run check` 0/0.
- **Fix:** Rewrote `names.svelte.ts` (resolve + dnArtist/dnTitle/dnLastfm) within Task 2 and kept a deprecated `dn` shim (→ dnTitle) so every then-unswept call site still compiled. Task 3 swept the sites and removed the shim. Each commit therefore compiles green.
- **Files modified:** `src/lib/stores/names.svelte.ts`
- **Commit:** cb51586 (rewrite + shim), 313dfdb (shim removed)

## Verification

- `npm run check` → **0 errors / 0 warnings** (4005 files).
- `npm test` → **201 passed (23 files)**, including the new `detect.test.ts` (15 cases).
- `grep -rnF '.dn(' src` → **NONE** (every site uses dnArtist/dnTitle/dnLastfm).
- Migration simulation: old blob `{nameLang:'zh-Hant', lyricsLang:'zh-Hans', accent:'#1db954', defaultSource:'qq'}` → artistLang=titleLang='zh-Hant', lyricsLang='zh-Hans', lastfmLang='off', all skips empty, accent/defaultSource preserved — asserted PASSED.
- No file deletions across the three task commits.
- i18n: all three dicts expose identical key sets (dict-parity test green); retired keys absent everywhere.

## Known Stubs

None — all four content parts are wired to real settings + the detector; no placeholder/empty-data render paths introduced.

## TDD Gate Compliance

Task 1 followed RED→GREEN: `test(260606-oil): add failing tests…` (2fc1d7a, module-not-found RED) precedes `feat(260606-oil): pure detectLang + shouldTranslate module` (51d5ed6, GREEN). No refactor commit needed.

## Self-Check: PASSED

- FOUND: src/lib/i18n/detect.ts
- FOUND: src/lib/i18n/detect.test.ts
- FOUND: 260606-oil-SUMMARY.md
- FOUND commits: 2fc1d7a, 51d5ed6, cb51586, 313dfdb
