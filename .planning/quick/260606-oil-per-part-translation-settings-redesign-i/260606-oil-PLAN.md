---
phase: 260606-oil
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/lib/i18n/detect.ts
  - src/lib/i18n/detect.test.ts
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
  - src/routes/(app)/settings/history/+page.svelte
  - src/routes/(app)/library/+page.svelte
  - src/routes/(app)/search/+page.svelte
  - src/routes/(app)/album/[name]/+page.svelte
  - src/routes/(app)/artist/[name]/+page.svelte
  - src/lib/stores/player.svelte.ts
autonomous: true
requirements: [OIL-01, OIL-02, OIL-03, OIL-04, OIL-05]

must_haves:
  truths:
    - "detectLang(text) classifies en / zh-Hant / zh-Hans / ja / ko purely (kana→ja, hangul→ko, latin→en, simplified-only→zh-Hans, traditional-only→zh-Hant, ambiguous Han→zh-Hant)"
    - "shouldTranslate(text, target, whitelist) returns false when target=off, false when detected source ∈ whitelist, true otherwise"
    - "Settings has independent artistLang / titleLang / lyricsLang / lastfmLang targets plus a source-language whitelist array per part"
    - "On load, a saved nameLang mirrors into BOTH artistLang and titleLang; lyricsLang/appLang preserved; lastfmLang defaults off; all whitelists default empty; existing prefs survive a reload"
    - "Artist names render via artistLang+artist whitelist and titles via titleLang+title whitelist, independently, at every call site"
    - "Lyrics skip per-line translation when a line's detected source ∈ lyrics whitelist; translateMode (below/replace) unchanged"
    - "Last.fm tags translate via lastfmLang+lastfm whitelist (target off ⇒ original tags)"
    - "Canonical scenario works: English artist+title stay original (target off or en-whitelisted) WHILE zh-Hant lyrics translate AND ja is selectable for content parts"
  artifacts:
    - path: "src/lib/i18n/detect.ts"
      provides: "Pure detectLang + shouldTranslate"
      exports: ["detectLang", "shouldTranslate"]
    - path: "src/lib/i18n/detect.test.ts"
      provides: "Unit tests for detector + decision fn"
    - path: "src/lib/stores/settings.svelte.ts"
      provides: "Per-part targets + whitelists + migration"
      contains: "artistLang"
    - path: "src/lib/stores/names.svelte.ts"
      provides: "dnArtist + dnTitle (per-part target + whitelist + detection)"
      exports: ["names"]
  key_links:
    - from: "src/lib/stores/names.svelte.ts"
      to: "src/lib/i18n/detect.ts"
      via: "shouldTranslate per text unit before queueing translateLines"
      pattern: "shouldTranslate"
    - from: "src/lib/components/NowPlaying.svelte"
      to: "src/lib/i18n/detect.ts"
      via: "per-line shouldTranslate in lyrics effect"
      pattern: "shouldTranslate"
    - from: "src/routes/(app)/settings/translation/+page.svelte"
      to: "src/lib/stores/settings.svelte.ts"
      via: "per-part target picker + whitelist multi-select"
      pattern: "artistLang|titleLang|lastfmLang|Whitelist"
---

<objective>
Replace the single-ish translation settings (today: `appLang` + `nameLang` + `lyricsLang` + `translateMode`, where `names.dn` translates artist AND title together via one `nameLang`) with INDEPENDENT per-part translation controls for five parts — artist name, song title, lyrics, app language, Last.fm info — each with (a) its own target language and (b) its own whitelist of source languages to leave untranslated. Add precise hand-rolled source-language detection (zh-Hant vs zh-Hans vs ja vs ko vs en) that drives whitelist pass-through per text unit.

Purpose: A user can keep English artist/title names original while translating lyrics to Traditional Chinese and selecting Japanese for content parts — all simultaneously. No single master language.

Output: A pure detection/decision module with unit tests; an extended settings store with per-part targets + whitelists + non-destructive migration; a redesigned per-part `/settings/translation` UI; and the artist/title/lyrics/Last.fm apply sites swept to the new per-part logic.
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/execute-plan.md
@~/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/quick/260606-oil-per-part-translation-settings-redesign-i/260606-oil-CONTEXT.md
@CLAUDE.md

<interfaces>
<!-- Contracts the executor needs. Extracted from the codebase. Use directly — no exploration. -->

From src/lib/stores/settings.svelte.ts (current):
```typescript
export type LyricsLang = 'off' | 'zh-Hant' | 'zh-Hans' | 'en' | 'ja' | 'ko';
export type TranslateMode = 'replace' | 'below';
const KEY = 'openmusic:settings:v1';
// class Settings { appLang: AppLang; lyricsLang: LyricsLang; nameLang: LyricsLang;
//   translateMode; defaultQuality; defaultSource; accent; reduceMotion; autoExpandOnPlay;
//   load(); save(); applyTheme(); }
// load() reads localStorage[KEY] JSON with `?? default` per field. save() writes the same shape.
```

From src/lib/i18n/index.ts:
```typescript
export type AppLang = 'en' | 'zh-Hant' | 'zh-Hans'; // STAYS 3-value — no ja chrome dict
export function detectAppLang(navLang?: string): AppLang; // pure
export function t(key: TranslationKey, params?): string; // reactive, reads settings.appLang
// PURE helpers (lookupKey, interpolate, detectAppLang, dicts) are node-test-safe.
```

From src/lib/stores/names.svelte.ts (current dn — to be split):
```typescript
// class Names { rev=$state(0); private cache: Map<lang, Map<orig, translated>>;
//   private pending: Map<lang, Set<string>>; private timers; private hydrated;
//   dn(text): returns cached translation OR original immediately; lazily batches via
//   translateLines(items, lang) after a 160ms debounce; persists to
//   localStorage `openmusic:name-tr:${lang}`; bumps rev when results arrive. }
export const names: Names;
```

From src/lib/services/translate.ts:
```typescript
export async function translateLines(lines: string[], to: string): Promise<string[]>;
// `to === 'off'` ⇒ returns lines unchanged. Caches in mem + localStorage `openmusic:lyrics-tr:${to}:${hash}`.
```

From src/lib/i18n/i18n.test.ts (node Vitest project, no runes):
```typescript
import { describe, it, expect } from 'vitest';
import { lookupKey, interpolate, detectAppLang, dicts } from './index';
// detect.test.ts MUST import ONLY pure exports (no $state) — same node project.
```
</interfaces>

<call_sites>
<!-- All 26 names.dn(...) sites, pre-classified artist-path vs title-path. Sweep each to the
     correct variant. ALBUM names → title path; ARTIST names + albumArtist + artist-page h1 → artist path. -->

ARTIST path → dnArtist(...):
- src/lib/components/NowPlaying.svelte: 472 (artist), 531 (r-artist), 566 (r-artist)
- src/lib/components/TrackMenu.svelte: 113 (· artist half)
- src/routes/(app)/+layout.svelte: 60 (np artist)
- src/routes/(app)/settings/history/+page.svelte: 45 (r-sub artist)
- src/routes/(app)/library/+page.svelte: 46, 67, 83 (r-sub artist halves)
- src/routes/(app)/search/+page.svelte: 76 (r-artist)
- src/routes/(app)/album/[name]/+page.svelte: 122 (albumArtist), 143 (r-sub artist)
- src/routes/(app)/artist/[name]/+page.svelte: 107 (h1 artist name), 141 (loading name), 157 (noSongs name)
- src/lib/stores/player.svelte.ts: 326 (MediaMetadata artist)
- artist/[name] 152 r-sub `track.album || track.artist`: this is an album-or-artist fallback → treat as artist path (it is the per-song sub-line; album-name-when-present is a label, acceptable as artist path; keep semantics simple — use dnArtist here).

TITLE path → dnTitle(...):
- src/lib/components/NowPlaying.svelte: 471 (title), 530 (r-title), 566 (r-title)
- src/lib/components/TrackMenu.svelte: 113 (title half)
- src/routes/(app)/+layout.svelte: 58 (np title)
- src/routes/(app)/settings/history/+page.svelte: 45 (r-title)
- src/routes/(app)/library/+page.svelte: 46, 67, 83 (r-title halves)
- src/routes/(app)/search/+page.svelte: 75 (r-title)
- src/routes/(app)/album/[name]/+page.svelte: 121 (h1 album name), 143 (r-title), 152 (noTracks album name)
- src/routes/(app)/artist/[name]/+page.svelte: 132 (al.name = album name), 152 (r-title)
- src/lib/stores/player.svelte.ts: 325 (MediaMetadata title)
</call_sites>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Pure language-detection + per-part decision module with unit tests</name>
  <files>src/lib/i18n/detect.ts, src/lib/i18n/detect.test.ts</files>
  <behavior>
    detectLang(text) → 'en' | 'zh-Hant' | 'zh-Hans' | 'ja' | 'ko':
    - Text containing Hiragana (U+3040–309F) or Katakana (U+30A0–30FF) → 'ja' (e.g. "テスト", "こんにちは").
    - Text containing Hangul (U+AC00–D7A3 or jamo U+1100–11FF) → 'ko' (e.g. "안녕").
    - Latin-dominant / no CJK Han + no kana/hangul → 'en' (e.g. "Taylor Swift", "Hello World", "" empty → 'en').
    - Han-only (CJK Unified U+4E00–9FFF, no kana/hangul): scan for simplified-only chars (e.g. 简,体,爱,国,听,乐,这,会,时,实) → 'zh-Hans'; traditional-only chars (e.g. 繁,體,愛,國,聽,樂,這,會,時,實) → 'zh-Hant'; if both or neither signal → default 'zh-Hant' (ambiguous Han → Traditional). Kanji-only Japanese acceptably misclassifies as Chinese (documented in CONTEXT D-01).
    - Mixed: kana/hangul presence wins over Han (a string with both kana and Han → 'ja').
    shouldTranslate(text, target, whitelist) → boolean:
    - target === 'off' → false (no translation regardless of whitelist).
    - detectLang(text) ∈ whitelist → false (render original).
    - detected source === target (already in target language) → false (avoid pointless round-trip).
    - otherwise → true.
    Both functions are PURE (no $state, no browser) so they run under the node Vitest project.
  </behavior>
  <action>Create src/lib/i18n/detect.ts exporting two pure functions: `detectLang(text: string): LangTag` and `shouldTranslate(text: string, target: string, whitelist: readonly string[]): boolean`, where `LangTag = 'en' | 'zh-Hant' | 'zh-Hans' | 'ja' | 'ko'`. Implement detection via Unicode-range regex tests in the priority order above (kana → 'ja', hangul → 'ko', then Han-only simplified/traditional signal via two small hand-curated char sets of common simplified-only / traditional-only characters; ambiguous Han → 'zh-Hant'; no-CJK → 'en'). Keep the simplified/traditional char sets as module-level `Set<string>` constants with ~30-50 high-frequency disambiguating characters each (per CONTEXT D-01 — pragmatic, marginal misclassification of kanji-only-ja accepted). NO external deps, NO regex that imports unicode property escapes if the TS target rejects them — use explicit `\u` ranges. Co-locate detect.test.ts importing ONLY these pure exports (mirror i18n.test.ts style: `import { describe, it, expect } from 'vitest'`). Cover: kana→ja, katakana→ja, hangul→ko, latin/empty→en, simplified-only→zh-Hans, traditional-only→zh-Hant, ambiguous Han→zh-Hant, kana+Han→ja, and shouldTranslate truth table (off→false, whitelisted source→false, source===target→false, else→true).</action>
  <verify>
    <automated>npm test -- --run src/lib/i18n/detect.test.ts</automated>
  </verify>
  <done>detect.ts exports detectLang + shouldTranslate as pure functions; detect.test.ts passes under the node Vitest project covering all branches above.</done>
</task>

<task type="auto">
  <name>Task 2: Per-part settings schema + migration + redesigned /settings/translation UI</name>
  <files>src/lib/stores/settings.svelte.ts, src/lib/i18n/en.ts, src/lib/i18n/zh-Hant.ts, src/lib/i18n/zh-Hans.ts, src/routes/(app)/settings/translation/+page.svelte</files>
  <action>In settings.svelte.ts: add per-part `$state<LyricsLang>` targets `artistLang`, `titleLang`, `lastfmLang` (keep existing `lyricsLang`); reuse the existing `LyricsLang` union (off|zh-Hant|zh-Hans|en|ja|ko) for all four CONTENT targets (per CONTEXT D-03). Add four whitelist arrays as `$state<string[]>`: `artistSkip`, `titleSkip`, `lyricsSkip`, `lastfmSkip` (each defaults `[]`). Each entry is a source-lang tag from the same set MINUS 'off' (en|zh-Hant|zh-Hans|ja|ko). Keep `appLang` (AppLang, 3-value — DO NOT add ja chrome per CONTEXT D-02), `translateMode`, and all non-translation fields untouched. Migration in load() (per CONTEXT D-04, NON-DESTRUCTIVE): `this.artistLang = (v.artistLang as LyricsLang) ?? (v.nameLang as LyricsLang) ?? 'off'` and identically for `titleLang` (BOTH mirror saved nameLang); `this.lyricsLang = (v.lyricsLang as LyricsLang) ?? 'off'`; `this.lastfmLang = (v.lastfmLang as LyricsLang) ?? 'off'`; each `*Skip = Array.isArray(v.*Skip) ? v.*Skip : []`. Keep reading appLang/translateMode/etc. with their existing fallbacks so existing prefs survive a reload. In save(): write the new fields (artistLang, titleLang, lastfmLang, artistSkip, titleSkip, lyricsSkip, lastfmSkip); you MAY drop writing `nameLang` (it is now a read-only migration source) OR keep mirroring it for back-compat — prefer dropping the write but STILL reading it in load() so an older saved blob migrates once. Keep the same `KEY` ('openmusic:settings:v1') — extend the shape, do not bump the key.

Redesign src/routes/(app)/settings/translation/+page.svelte as FIVE clearly-labeled sections (per CONTEXT D-05 — understandable, not overwhelming). Sections 1-4 (Artist name, Song title, Lyrics, Last.fm info): each renders the existing `langs` chip row (off|繁體中文|简体中文|English|日本語|한국어) bound to its target setter, PLUS a "skip these languages" multi-select chip row of the five source tags (en|zh-Hant|zh-Hans|ja|ko, endonym labels) toggling membership in that part's Skip array. The skip row is visually de-emphasized/disabled when the part's target is `off` (whitelist only matters when target≠off — CONTEXT D-05). Section 5 (App language): unchanged — but note app chrome stays en/zh-Hant/zh-Hans; do NOT offer ja/ko for appLang. Keep the existing translateMode segment (below/replace) gated on lyricsLang≠off (unchanged behavior). Each setter calls `settings.save()`. Add new i18n keys to ALL THREE chrome dicts (en.ts authoritative, then zh-Hant.ts + zh-Hans.ts — missing-key is a compile error): section headings (artist name / song title / lyrics / Last.fm info translation), a "skip these source languages" sublabel, and per-part short notes. Reuse `settings.optOff` for the Off chip. Do NOT remove the still-used `settings.translateMode*` keys; you MAY retire `settings.translateNames`/`settings.translateNamesNote` only if no longer referenced (grep first).</action>
  <verify>
    <automated>npm run check && npm test -- --run</automated>
  </verify>
  <done>npm run check reports 0 errors / 0 warnings; settings persists artistLang/titleLang/lyricsLang/lastfmLang + four Skip arrays under the existing KEY; a saved {nameLang:'zh-Hant'} blob migrates to artistLang=titleLang='zh-Hant' on load (other prefs preserved); the translation page shows five labeled sections each with a target chip row + a skip multi-select (skip row de-emphasized when target=off); new i18n keys present in all three dicts.</done>
</task>

<task type="auto">
  <name>Task 3: Apply per-part logic at all sites — names dnArtist/dnTitle split, lyrics per-line whitelist, Last.fm tag gating</name>
  <files>src/lib/stores/names.svelte.ts, src/lib/components/NowPlaying.svelte, src/lib/components/TagChips.svelte, src/lib/components/TrackMenu.svelte, src/routes/(app)/+layout.svelte, src/routes/(app)/settings/history/+page.svelte, src/routes/(app)/library/+page.svelte, src/routes/(app)/search/+page.svelte, src/routes/(app)/album/[name]/+page.svelte, src/routes/(app)/artist/[name]/+page.svelte, src/lib/stores/player.svelte.ts</files>
  <action>In names.svelte.ts: replace the single `dn(text)` with per-part `dnArtist(text)` and `dnTitle(text)` (keep a thin back-compat `dn = dnTitle` ONLY if needed; the sweep below removes all bare `dn` callers so prefer not to). Factor the existing cache/pending/timer/persist/rev machinery into a private `resolve(text, target, whitelist)` that: reads `void this.rev`; returns `text` when `!text || target==='off' || !browser`; calls `shouldTranslate(text, target, whitelist)` from `$lib/i18n/detect` and returns `text` (original) when false; otherwise uses the EXISTING per-`target` cache/pending/debounced `translateLines(items, target)` flow keyed by target (unchanged reactive rev-bump + localStorage `openmusic:name-tr:${target}` persistence). `dnArtist(text) = resolve(text, settings.artistLang, settings.artistSkip)`; `dnTitle(text) = resolve(text, settings.titleLang, settings.titleSkip)`. The cache stays keyed by target lang (shared across parts that target the same lang — correct, since translation output is target-only). Sweep ALL 26 call sites per the <call_sites> map to dnArtist or dnTitle exactly (artist names/albumArtist/artist-page h1 → dnArtist; titles/album names → dnTitle). Update player.svelte.ts:325 → dnTitle, :326 → dnArtist.

Lyrics (NowPlaying.svelte $effect at ~100-113): keep translating via `translateLines(lines.map(l=>l.text), lang)` BUT apply a per-line whitelist skip — only translate lines where `shouldTranslate(line.text, settings.lyricsLang, settings.lyricsSkip)` is true; for skipped lines keep the ORIGINAL text in the corresponding `translated[i]` slot so index alignment + `showTr`/translateMode (below/replace) render unchanged. Practically: build the input as the full lines array but post-map the result so each skipped line's output === its original (or send only the non-skipped subset and stitch back by index — pick the simpler correct approach; index alignment with `translated.length === lines.length` MUST hold). Add `settings.lyricsSkip` and the detect import as reactive deps so toggling the whitelist re-runs the effect. translateMode behavior and the `trKey` cache key are otherwise unchanged (include lyricsSkip in trKey so a whitelist change invalidates).

Last.fm tags (TagChips.svelte + its call sites): gate tag translation on `lastfmLang` + `lastfmSkip`. Since TagChips currently renders raw `tags` (display strings, not run through names), add reactive translation INSIDE TagChips: when `settings.lastfmLang !== 'off'`, run each tag through the same per-unit decision — translate tags where `shouldTranslate(tag, settings.lastfmLang, settings.lastfmSkip)` and leave the rest original; render originals immediately and swap when results arrive (reuse the names-store pattern: you MAY add a `names.dnLastfm(tag)` resolver mirroring dnArtist/dnTitle that reads settings.lastfmLang+lastfmSkip, and call it from TagChips so the cache/debounce/rev machinery is reused — preferred over a second ad-hoc cache). target=off ⇒ tags render exactly as today (no behavior change for users who leave Last.fm translation off). The artist-page bio stays as-is per its existing D-07 comment (English-as-is, not translated) — do NOT translate bio; lastfm part scope here = tags (and bio remains explicitly out per existing decision unless trivially gated; keep bio untouched).</action>
  <verify>
    <automated>npm run check && npm test -- --run</automated>
  </verify>
  <done>npm run check 0/0; npm test green (incl detector tests); no remaining bare `names.dn(` callers (grep clean) — every site uses dnArtist or dnTitle per the map; lyrics translate only non-whitelisted lines with index alignment preserved and below/replace unchanged; Last.fm tags translate via lastfmLang+lastfmSkip and render originals when lastfmLang=off; bio untouched.</done>
</task>

</tasks>

<verification>
- `npm run check` → 0 errors / 0 warnings.
- `npm test -- --run` → all green, including the new src/lib/i18n/detect.test.ts.
- `grep -rn "names\.dn(" src/ --include="*.svelte" --include="*.ts"` → ZERO matches for the bare `dn(` (all swept to dnArtist/dnTitle/dnLastfm). Allowed: comments referencing the old name.
- Manual (dev server): set Artist target=off (or whitelist `en`) AND Title target=off (or whitelist `en`) → an English artist + English title render ORIGINAL; simultaneously set Lyrics target=zh-Hant → Chinese/other lyric lines translate to Traditional Chinese (English-whitelisted lyric lines, if whitelisted, stay original); confirm `ja` and `ko` are selectable for all four content parts and NOT for App language.
- Migration: with an OLD saved blob `{...,"nameLang":"zh-Hant","lyricsLang":"zh-Hans"}` in localStorage `openmusic:settings:v1`, reload → artistLang and titleLang both become zh-Hant, lyricsLang stays zh-Hans, lastfmLang=off, all Skip arrays empty; other prefs (accent, defaultSource, etc.) unchanged.
- Last.fm: with Last.fm target=off, tags render exactly as before; with target set, non-whitelisted tags translate.
</verification>

<success_criteria>
- Five independent per-part translation controls (artist / title / lyrics / app-lang / Last.fm), each with a target language and a source-language skip whitelist.
- Precise pure source-language detection (en / zh-Hant / zh-Hans / ja / ko) with passing unit tests; whitelist pass-through decided per text unit (per name, per lyric line, per tag).
- App chrome remains en/zh-Hant/zh-Hans (no ja chrome authored); ja/ko selectable only for the four content parts.
- Non-destructive migration: existing prefs survive reload; saved nameLang mirrors into artistLang + titleLang; whitelists default empty; translateMode preserved.
- Canonical scenario works simultaneously: original English artist + original English title + Traditional-Chinese lyrics + Japanese available for content parts.
- No render regressions: every former `names.dn` site shows correct content via dnArtist/dnTitle; lyrics below/replace + index alignment intact; Last.fm tags unchanged when target=off.
</success_criteria>

<output>
Create `.planning/quick/260606-oil-per-part-translation-settings-redesign-i/260606-oil-SUMMARY.md` when done.
</output>
