# Quick Task 260606-oil: Per-part translation settings redesign - Context

**Gathered:** 2026-06-06
**Status:** Ready for planning

<domain>
## Task Boundary

Replace the single-ish translation settings (today: `appLang` + `nameLang` + `lyricsLang` + `translateMode`; `names.dn` translates artist AND title together via `nameLang`) with INDEPENDENT per-part translation controls. Five parts, each with (a) its own target-language setting and (b) its own whitelist of source languages to leave untranslated (pass-through):

1. Artist name
2. Song (track) title
3. Lyrics
4. App language (UI chrome)
5. Last.fm info (tags, bio, etc.)

No single master language. Canonical example must work: original English artist + original English title + Traditional-Chinese lyrics + (content) Japanese available, all at once.
</domain>

<decisions>
## Implementation Decisions

### Source-language detection (whitelist mechanism)
- **Detect zh vs ja precisely.** Hand-rolled Unicode/script classifier returning a source-language tag, no external deps:
  - Hiragana/Katakana present → `ja`.
  - Hangul present → `ko`.
  - Latin-dominant (no CJK) → `en`.
  - Han-only (no kana): split zh-Hant vs zh-Hans via a traditional/simplified character signal (presence of simplified-only chars → `zh-Hans`, traditional-only chars → `zh-Hant`; ambiguous → default to one, pragmatically `zh-Hant` or a neutral `zh`). Han-only-without-kana is treated as Chinese (kanji-only Japanese is rare for names/lyrics and acceptable to misclassify at the margin).
- Whitelist semantics: for a given part, detect the source language of the text unit; if that detected language ∈ that part's whitelist → render ORIGINAL untouched (no `/api/translate` call). Detection is per text UNIT: per name (artist, title) and per lyric line.
- A part's whitelist only matters when its target is set (≠ off). Target=off ⇒ no translation regardless of whitelist.
- This is a **pure function** (text → source-lang tag) + a pure decision fn (text, targetLang, whitelist → translate-or-passthrough). Unit-tested.

### App-language Japanese
- **Content-only ja; chrome stays en / zh-Hant / zh-Hans.** Do NOT author a ja UI dictionary now. `appLang` (`AppLang`) keeps its existing 3-value type. Japanese (and ko) are selectable only for the four CONTENT parts (artist/title/lyrics/lastfm). Full ja chrome dict is deferred.

### Target language set (content parts)
- **Uniform `off + en + zh-Hant + zh-Hans + ja + ko`** for all four content parts (reuse the existing `LyricsLang` type/set already wired into the translate service). Same menu everywhere.

### Migration + defaults
- **Mirror `nameLang`, empty whitelists.** On load: migrate saved `nameLang` → BOTH new `artistLang` AND `titleLang` (preserve current behavior); keep `lyricsLang` and `appLang` as saved; new `lastfmLang` defaults `off`. ALL per-part whitelists default EMPTY. No surprise behavior change for existing users (whitelist only bites when a target is set). Keep `translateMode` as-is (applies to lyrics below/replace).
- Persisted localStorage shape extends the existing key; old keys read with fallbacks (no wipe, no destructive migration). `nameLang` may be retained as a deprecated read-only migration source or dropped after mapping — planner decides, but existing prefs must survive a reload.

### Settings UI
- Lives in the grouped drill-in settings `/settings → translation` group (from task 260606-ggv). Per-part block: a target-language picker + a multi-select "skip these languages" whitelist. Keep it understandable (5 clearly-labeled sections), not overwhelming.

### Apply sites
- Split `names.dn`: artist uses `artistLang`+artist whitelist, title uses `titleLang`+title whitelist (independent). 
- Lyrics translation respects `lyricsLang` + lyrics whitelist (skip lines whose detected source ∈ whitelist; per-line decision).
- Last.fm info display respects `lastfmLang` + its whitelist.
- App chrome continues to use `appLang` (unchanged path).
</decisions>

<specifics>
## Specific Ideas

- Canonical acceptance scenario: artistLang/titleLang with `en` whitelisted (or target off) → English names stay original; lyricsLang=`zh-Hant` → Chinese/other lyrics translate to Traditional Chinese; content `ja` selectable; app chrome independent.
- Pure helpers to unit-test: `detectLang(text)` (→ en/zh-Hant/zh-Hans/ja/ko) and `shouldTranslate(text, targetLang, whitelist)` (→ boolean) / `resolveText(...)`.
- Reuse existing `/api/translate` proxy + `translateLines`. No new heavy deps; the detector is a hand-rolled Unicode-range + small simplified/traditional char-set classifier.
</specifics>

<canonical_refs>
## Canonical References

- Existing: `src/lib/stores/settings.svelte.ts` (appLang/nameLang/lyricsLang/translateMode + localStorage persist), `src/lib/stores/names.svelte.ts` (`dn()` via nameLang), `src/lib/services/translate.ts` (`translateLines(lines, to)` → `/api/translate`), `src/lib/i18n/index.ts` (`AppLang` = en/zh-Hant/zh-Hans, dicts), `LyricsLang` type (off/zh-Hant/zh-Hans/en/ja/ko).
- Settings UI: grouped `/settings/translation` route group from quick task 260606-ggv.
- CLAUDE.md: Svelte 5 runes, UI + i18n/settings layer only — do NOT touch the music data/fetch/source backend.
</canonical_refs>
