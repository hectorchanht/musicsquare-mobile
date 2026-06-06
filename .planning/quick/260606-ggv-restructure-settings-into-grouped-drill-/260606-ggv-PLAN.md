---
phase: quick-260606-ggv
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/lib/history/history-logic.ts
  - src/lib/history/history-logic.test.ts
  - src/lib/stores/history.svelte.ts
  - src/lib/stores/player.svelte.ts
  - src/lib/i18n/en.ts
  - src/lib/i18n/zh-Hant.ts
  - src/lib/i18n/zh-Hans.ts
  - src/routes/(app)/settings/+page.svelte
  - src/routes/(app)/settings/general/+page.svelte
  - src/routes/(app)/settings/translation/+page.svelte
  - src/routes/(app)/settings/playback/+page.svelte
  - src/routes/(app)/settings/history/+page.svelte
  - src/routes/(app)/settings/lastfm/+page.svelte
  - src/routes/(app)/settings/data/+page.svelte
  - src/routes/(app)/settings/about/+page.svelte
autonomous: true
requirements: []
must_haves:
  truths:
    - "Tapping /settings shows a list of group rows (chevrons) that navigate to per-group sub-routes"
    - "Every existing setting still exists, relocated under its correct group route; none dropped"
    - "Each sub-route has a back button to /settings and calls settings.load() on mount"
    - "Playing a track records it to a capped (~50), most-recent-first, uid-deduped history persisted at openmusic:history:v1"
    - "The History route lists recently-played tracks, plays one on tap, and clears the list via Clear history"
    - "The Last.fm route shows a disabled 'coming soon' placeholder with no auth/network"
    - "All new chrome strings render via t() with identical key sets across en / zh-Hant / zh-Hans"
  artifacts:
    - path: "src/lib/history/history-logic.ts"
      provides: "Pure cap/dedupe/serialize helpers for history (no runes — node-testable)"
    - path: "src/lib/history/history-logic.test.ts"
      provides: "Vitest coverage of cap, dedupe-by-uid, and persisted-shape logic"
    - path: "src/lib/stores/history.svelte.ts"
      provides: "Runes singleton: record(), clear(), load(), persisted history list"
    - path: "src/routes/(app)/settings/+page.svelte"
      provides: "Group-list index (rows -> navigate, chevrons)"
    - path: "src/routes/(app)/settings/history/+page.svelte"
      provides: "Recently-played list with tap-to-play + Clear history"
    - path: "src/routes/(app)/settings/lastfm/+page.svelte"
      provides: "Disabled Last.fm coming-soon placeholder"
  key_links:
    - from: "src/lib/stores/player.svelte.ts"
      to: "src/lib/stores/history.svelte.ts"
      via: "history.record(track) inside play()"
      pattern: "history\\.record"
    - from: "src/routes/(app)/settings/+page.svelte"
      to: "/settings/general etc."
      via: "goto(row.href)"
      pattern: "goto\\('/settings/"
---

<objective>
Restructure the single-scroll settings page into a grouped, drill-in information
architecture (one SvelteKit route per group), regroup every existing setting into
its correct group with nothing dropped, add a NEW local recently-played History
group (store + recording + list UI + unit test), and add a disabled Last.fm
"coming soon" placeholder. All new chrome is i18n'd across all three locales.

Purpose: A clean, deep-linkable settings IA and a useful recently-played feature,
without pre-empting the v1.1 Phase 11 Last.fm auth work.
Output: 7 group sub-routes + rewritten /settings index, a history store (runes
singleton wrapping a pure node-testable logic module), a player hook, a unit test,
and new i18n keys in en / zh-Hant / zh-Hans.
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/execute-plan.md
@~/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/quick/260606-ggv-restructure-settings-into-grouped-drill-/260606-ggv-CONTEXT.md
@./CLAUDE.md

<!-- Source of sections to relocate (verbatim markup + handlers + <style>) -->
@src/routes/(app)/settings/+page.svelte

<!-- Shared store every sub-route reads/writes; call settings.load() on mount -->
@src/lib/stores/settings.svelte.ts

<!-- Persisted runes-store pattern to mirror for the new history store -->
@src/lib/stores/library.svelte.ts

<!-- Player.play() at line ~119 = the history recording hook point -->
@src/lib/stores/player.svelte.ts

<!-- Track-row markup + use:longpress + TrackMenu pattern to reuse for History rows -->
@src/routes/(app)/library/+page.svelte
@src/lib/components/TrackMenu.svelte
@src/lib/actions/longpress.ts

<!-- i18n contract: identical key sets across all three dicts; t() reactive wrapper -->
@src/lib/i18n/index.ts
@src/lib/i18n/en.ts

<interfaces>
<!-- Track shape (src/lib/sources/types.ts) — history stores a minimal slice of this. -->
Track has: uid, source, songid, title, artist, album, cover, audioUrl|null,
  detailsLoaded, quality|null, qualityLabel|null, keyword, displayIndex (+optional extras).
makeUid(source, songid) => `${source}:${songid}`.

<!-- Settings store (src/lib/stores/settings.svelte.ts) — singleton, call .load()/.save(). -->
settings.appLang, .lyricsLang, .nameLang, .translateMode, .defaultQuality,
  .defaultSource, .accent, .reduceMotion, .autoExpandOnPlay; ACCENT_PRESETS[].

<!-- i18n (src/lib/i18n/index.ts) — Dict = Record<TranslationKey,string>; t(key, params?). -->
TranslationKey = keyof typeof en. en.ts is the SOURCE dict (its keys define the type).
zh-Hant.ts / zh-Hans.ts are typed `const x: Dict` so a missing key is a COMPILE error.

<!-- CRITICAL Vitest constraint (vite.config.ts): the "server" project runs in `node`
     and EXCLUDES *.svelte.{test,spec}.ts and CANNOT compile runes ($state). The i18n
     test imports only PURE exports, never `t`. Therefore the history UNIT TEST must
     import a PURE logic module (plain .ts, no runes), NOT the .svelte.ts store. The
     runes singleton WRAPS the pure module — same separation as i18n pure helpers vs t(). -->

<!-- Player.play signature (src/lib/stores/player.svelte.ts:119):
     async play(track: Track, opts?: { fresh?: boolean }) -->
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Pure history logic module + unit test</name>
  <files>src/lib/history/history-logic.ts, src/lib/history/history-logic.test.ts</files>
  <behavior>
    - prepend new track => it is first; original entries follow in order.
    - replaying an existing uid => it MOVES to the top (de-dupe by uid, no duplicate entry, length unchanged for a known uid).
    - cap at HISTORY_CAP (~50) => adding the 51st distinct track drops the oldest; result length === cap.
    - serialize keeps a minimal, JSON-safe slice sufficient to replay (uid, source, songid, title, artist, album, cover, quality, qualityLabel, keyword, displayIndex) and OMITS volatile fields (audioUrl, lrc, lrcUrl, detailsLoaded) so they are re-resolved on replay.
    - parse/round-trip => serialize then parse yields an array of the same uids in the same order; corrupt/non-array input yields [].
  </behavior>
  <action>
    Create `src/lib/history/history-logic.ts` as a PURE module (NO runes, NO `$state`,
    NO `$app/environment` import) so the node Vitest project can import it directly —
    this mirrors the i18n pure-helpers / dedupe.ts separation (see the CRITICAL Vitest
    constraint in <interfaces>). Export:
      - `HISTORY_CAP` constant (= 50).
      - `HISTORY_KEY` constant (= 'openmusic:history:v1').
      - a `HistoryEntry` type = the minimal Track slice listed in <behavior> (reuse
        field names from the Track interface; import the Track type for the picker
        signature only — types are erased, no runtime coupling).
      - `toEntry(track: Track): HistoryEntry` — picks the minimal whitelist fields.
      - `recordEntry(list: HistoryEntry[], entry: HistoryEntry, cap = HISTORY_CAP): HistoryEntry[]`
        — returns a NEW array: drop any existing entry with the same uid, prepend
        `entry`, then truncate to `cap`. (most-recent-first + de-dupe + cap.)
      - `parseHistory(raw: string | null): HistoryEntry[]` — JSON.parse, return `[]`
        on null / parse error / non-array.
    Then create `src/lib/history/history-logic.test.ts` (plain `.test.ts`, NOT
    `.svelte.test.ts`, so it runs in the node project) covering every <behavior>
    bullet with Vitest (`describe/it/expect`), mirroring the assertion style of
    src/lib/services/catalog.test.ts and src/lib/i18n/i18n.test.ts. Build fixture
    tracks with a tiny local `mk()` helper like catalog.test.ts does.
    Do NOT use `git add -A`/`.`; stage only the two files above by explicit path.
  </action>
  <verify>
    <automated>pnpm test --run src/lib/history/history-logic.test.ts</automated>
  </verify>
  <done>history-logic.ts exports the pure helpers; history-logic.test.ts passes covering cap, dedupe-by-uid (replay-moves-to-top), serialize whitelist, and parse round-trip / corrupt-input.</done>
</task>

<task type="auto">
  <name>Task 2: History runes store + player recording hook</name>
  <files>src/lib/stores/history.svelte.ts, src/lib/stores/player.svelte.ts</files>
  <action>
    Create `src/lib/stores/history.svelte.ts` as a Svelte 5 runes singleton that
    WRAPS the pure module from Task 1 — mirror the structure of
    src/lib/stores/library.svelte.ts (SSR-guard via `import { browser } from
    '$app/environment'`, private `loaded` flag, `load()` hydrates once in the
    browser, private `save()` writes localStorage). It MUST import NOTHING from
    player or library (avoid circular deps — same rule the settings/library stores
    state in their headers). Specifically:
      - `entries = $state<HistoryEntry[]>([])`.
      - `load()`: if already loaded or not browser, return; else read
        `localStorage.getItem(HISTORY_KEY)`, set `entries = parseHistory(raw)`.
      - `record(track: Track)`: `entries = recordEntry(entries, toEntry(track))`
        then `save()`. SSR-guarded via the same browser check used by save().
      - `clear()`: `entries = []` then `save()`.
      - `save()`: browser-guarded `localStorage.setItem(HISTORY_KEY, JSON.stringify(entries))`
        wrapped in try/catch (quota — non-fatal), exactly like library.save().
      - export `const history = new History();`. Import HISTORY_KEY, parseHistory,
        recordEntry, toEntry, and the HistoryEntry/Track types from the Task-1 module
        and $lib/sources/types.
    Then edit `src/lib/stores/player.svelte.ts`: add
    `import { history } from '$lib/stores/history.svelte';` and, inside
    `async play(track, opts?)` (line ~119), call `history.record(track)` so each
    user-initiated/auto-advanced play is recorded. Record the ORIGINAL `track` arg
    (the resolved object is fine too, but recording the arg avoids ordering issues if
    resolution fails); place the call early in `play()` so it records even when audio
    resolution later errors. Do NOT make history import player (one-way edge only).
    Stage only these two files by explicit path; never `git add -A`/`.`.
  </action>
  <verify>
    <automated>pnpm check</automated>
  </verify>
  <done>`pnpm check` reports 0 errors; history.svelte.ts exports the singleton wrapping the pure module; player.play() calls history.record(track); history imports nothing from player/library.</done>
</task>

<task type="auto">
  <name>Task 3: i18n keys for all new chrome (en / zh-Hant / zh-Hans)</name>
  <files>src/lib/i18n/en.ts, src/lib/i18n/zh-Hant.ts, src/lib/i18n/zh-Hans.ts</files>
  <action>
    Add NEW keys for every new chrome string used by Tasks 4-6, with an IDENTICAL key
    set across all three dicts (the i18n test asserts identical key sets, and the
    `Dict` type makes a missing key a compile error). en values = natural English;
    zh-Hant / zh-Hans = correct translations following the tone of the existing
    settings strings. Add a `// --- settings groups / history / lastfm ---` comment
    block in each file. Required keys (group rows, history UI, lastfm placeholder,
    and a generic back-to-settings label — REUSE existing `common.back` /
    `settings.heading` / `settings.title` where they already fit):
      - `settings.groupGeneral` (e.g. "General")
      - `settings.groupTranslation` ("Translation")
      - `settings.groupPlayback` ("Playback")
      - `settings.groupHistory` ("History")
      - `settings.groupLastfm` ("Last.fm")
      - `settings.groupData` ("Data")
      - `settings.groupAbout` ("About")
      - `settings.groupGeneralDesc` (e.g. "Language, accent, motion")
      - `settings.groupTranslationDesc` ("Lyrics & name translation")
      - `settings.groupPlaybackDesc` ("Quality, source, auto-expand")
      - `settings.groupHistoryDesc` ("Recently played")
      - `settings.groupLastfmDesc` ("Scrobbling — coming soon")
      - `settings.groupDataDesc` ("Library counts, clear data")
      - `settings.groupAboutDesc` ("Build info")
      - `settings.backToSettings` ("Settings")  // back-button label on sub-routes
      - `history.title` ("History · openmusic")
      - `history.heading` ("History")
      - `history.empty` ("No recently played songs yet.")
      - `history.clear` ("Clear history")
      - `history.cleared` ("History cleared.")
      - `lastfm.title` ("Last.fm · openmusic")
      - `lastfm.heading` ("Last.fm")
      - `lastfm.connect` ("Connect Last.fm")
      - `lastfm.comingSoon` ("Coming soon")
      - `lastfm.note` ("Scrobbling and your Last.fm profile will arrive in a future update.")
    (Use these exact key names so Tasks 4-6 can reference them verbatim. If a label is
    better worded, change the VALUE, not the KEY.) Stage only the three i18n files by
    explicit path; never `git add -A`/`.`.
  </action>
  <verify>
    <automated>pnpm test --run src/lib/i18n/i18n.test.ts</automated>
  </verify>
  <done>All three dicts gain the identical new key set; the i18n test (identical-key-sets + no-blank-values) passes; en values are natural English.</done>
</task>

<task type="auto">
  <name>Task 4: /settings group-list index + General / Translation / Playback routes</name>
  <files>src/routes/(app)/settings/+page.svelte, src/routes/(app)/settings/general/+page.svelte, src/routes/(app)/settings/translation/+page.svelte, src/routes/(app)/settings/playback/+page.svelte</files>
  <action>
    Rewrite `src/routes/(app)/settings/+page.svelte` into a GROUP LIST: a header with
    the existing back-to-home button (keep its current behavior, `goto('/')`) and
    `t('settings.heading')` title, then a list of group rows. Each row = icon +
    `t('settings.group<Name>')` title + `t('settings.group<Name>Desc')` subtitle +
    a right chevron (`ChevronRight` from `@lucide/svelte`), and `onclick` calls
    `goto('/settings/<group>')`. Rows in order: general, translation, playback,
    history, lastfm, data, about. Reuse the existing `.item`/row styling idiom (a
    `.item` button with icon + text), adding a chevron and a small subtitle; keep the
    `<style>` self-contained. Remove all the old setting sections from this file
    (they move into the sub-routes below).

    Create the three sub-routes, each as a standalone `+page.svelte` that: imports the
    settings store + i18n + needed lucide icons; calls `settings.load()` in onMount
    (like the current page); renders a header with a back button -> `goto('/settings')`
    labelled `t('settings.backToSettings')` (reuse the `.head`/`.back` markup + style
    from the current settings page); and contains ONLY its group's sections, moved
    VERBATIM (markup + the relevant chip/seg/swatch/row-toggle handlers + the
    corresponding `<style>` rules) from the original settings page:
      - `settings/general/+page.svelte`: App language, Accent color, Reduce motion
        (the App-language chips block, the Accent swatches block, and the Reduce-motion
        row-toggle — split the existing "Playback & motion" section so reduce-motion
        lives here and auto-expand lives in Playback).
      - `settings/translation/+page.svelte`: Lyrics translation, Translate names,
        Translate mode (the three translation sections + their `langs`/`modes` arrays
        + setLang/setNameLang/setMode handlers).
      - `settings/playback/+page.svelte`: Default quality, Default source, Auto-expand
        on play (the quality + source sections + their arrays/handlers, plus the
        auto-expand row-toggle).
    Carry over each block's `<h2>` heading and `t(...)` calls unchanged. Drop the
    now-unused `library` import / counts logic from these three routes (only Data
    needs it). Ensure every chip/seg/swatch/toggle still calls `settings.save()` on
    change exactly as before. Stage only these four files by explicit path; never
    `git add -A`/`.`.
  </action>
  <verify>
    <automated>pnpm check</automated>
  </verify>
  <done>/settings renders a 7-row group list with chevrons that navigate; general/translation/playback routes each load settings, have a back button to /settings, and contain their exact relocated sections with working save-on-change; `pnpm check` = 0 errors.</done>
</task>

<task type="auto">
  <name>Task 5: History route + Last.fm placeholder route</name>
  <files>src/routes/(app)/settings/history/+page.svelte, src/routes/(app)/settings/lastfm/+page.svelte</files>
  <action>
    Create `src/routes/(app)/settings/history/+page.svelte`: import the history store,
    player, names, i18n, `longpress`, `TrackMenu`, and the track type. In onMount call
    `history.load()`. Render the same header pattern as the other sub-routes (back
    button -> `goto('/settings')`, `t('settings.backToSettings')`, heading
    `t('history.heading')`, `<svelte:head><title>{t('history.title')}</title>`). Below
    it: if `history.entries.length`, render a track list REUSING the library page's
    `.row` markup + `<style>` (art swatch with `fallbackCover`, `.meta` title/sub via
    `names.dn`, `use:longpress onlongpress={() => openMenu(track)}`) where tapping a
    row plays it: `player.setQueue(history.entries as Track[]); player.play(track)`
    (history entries are a Track-compatible slice — cast to Track for the player call;
    audioUrl re-resolves on play). Include a `<TrackMenu track={menuTrack}
    open={menuOpen} onclose={...} />` and a "Clear history" button
    (`t('history.clear')`, danger style like `.item.danger`) that calls
    `history.clear()`. If empty, show an empty state (`t('history.empty')`) like the
    library page's `.empty`. Reuse `fallbackCover`, `menuTrack`/`menuOpen`/`openMenu`
    from the library page pattern.

    Create `src/routes/(app)/settings/lastfm/+page.svelte`: same header pattern (back
    -> /settings, `t('lastfm.heading')`, title `t('lastfm.title')`). Body = a DISABLED
    placeholder: a disabled `.item` button (or static row) showing
    `t('lastfm.connect')` + a "coming soon" pill (`t('lastfm.comingSoon')`), and a
    muted note `t('lastfm.note')`. NO auth, NO network/fetch, NO secret, NO env access,
    NO state beyond settings.load() if you choose to call it. Add a short HTML comment
    noting real auth is v1.1 Phase 11 (out of scope). Stage only these two files by
    explicit path; never `git add -A`/`.`.
  </action>
  <verify>
    <automated>pnpm check && pnpm test --run</automated>
  </verify>
  <done>history route lists recently-played (reusing track-row + TrackMenu + longpress), plays on tap, clears via Clear history, and shows an empty state; lastfm route is a disabled coming-soon placeholder with no auth/network; `pnpm check` = 0 errors and the full `pnpm test --run` suite (including the new history test) is green.</done>
</task>

<task type="auto">
  <name>Task 6: Data + About routes (relocate remaining sections)</name>
  <files>src/routes/(app)/settings/data/+page.svelte, src/routes/(app)/settings/about/+page.svelte</files>
  <action>
    Create `src/routes/(app)/settings/data/+page.svelte`: move the Data section
    VERBATIM from the original settings page — the library counts line
    (`t('settings.dataCounts', {...})` with the onMount `counts` computation and
    `library.load()` + `settings.load()`), the "Clear cached top picks" button
    (`clearPicks` + `TOP_PICKS_KEY` constant + the `flash`/`msg` helper), and the
    "Clear library" danger button (`clearLibrary` with the confirm + `library.clearAll()`
    + counts reset + flash). Carry the `flash`/`msg` `{#if msg}` toast and its `.flash`
    style. Add the standard sub-route header (back -> /settings,
    `t('settings.backToSettings')`, heading `t('settings.data')`).

    Create `src/routes/(app)/settings/about/+page.svelte`: move the About section
    (`<Info>` static `.item` row with `t('settings.aboutLine')`), plus the standard
    sub-route header (back -> /settings, heading `t('settings.about')`). Call
    `settings.load()` in onMount for i18n consistency. Bring over only the styles each
    route actually uses (`.head`, `.back`, `section`, `.item`, `.item.static`,
    `.item.danger`, `.muted`, `.flash`). Stage only these two files by explicit path;
    never `git add -A`/`.`.
  </action>
  <verify>
    <automated>pnpm check && pnpm test --run</automated>
  </verify>
  <done>data route shows counts + Clear-picks + Clear-library (all working, with flash) and about route shows the about line; both have back-to-/settings; no original setting is dropped anywhere; `pnpm check` = 0 errors and `pnpm test --run` green.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| localStorage <-> app | History persists user playback data locally (no PII beyond track metadata the app already stores). |
| (none external) | This task adds NO network calls. Last.fm is a disabled placeholder — no auth, no secret, no fetch. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-ggv-01 | Tampering | parseHistory(localStorage) | mitigate | parseHistory returns `[]` on null / parse error / non-array; save() try/catch on quota — corrupt store never crashes the app. |
| T-ggv-02 | Information disclosure | Last.fm placeholder | accept | Placeholder uses no secret, no network, no env — real auth (LASTFM_SECRET, httpOnly sk cookie, api_sig, T-lfm-01/02/03) is reserved for v1.1 Phase 11 and explicitly out of scope here. |
| T-ggv-03 | Denial of service | history cap | mitigate | recordEntry truncates to HISTORY_CAP (~50) so the persisted list cannot grow unbounded. |
| T-ggv-SC | Tampering | npm/pip/cargo installs | mitigate | No new dependencies are installed by this task (all imports — lucide icons, Svelte, $app — already present); no package-manager step, so no legitimacy gate required. |
</threat_model>

<verification>
- `pnpm check` → 0 errors (svelte-check strict).
- `pnpm test --run` → existing suite green + new src/lib/history/history-logic.test.ts passing.
- Manual smoke (executor or developer): visit /settings → 7 group rows with chevrons; each row deep-links to its sub-route; each sub-route's back button returns to /settings; play a song then open /settings/history and confirm it appears at the top, replay moves it to top, Clear history empties it; /settings/lastfm shows a disabled coming-soon entry.
- Confirm no existing setting is missing: General(app language, accent, reduce motion) + Translation(lyrics, names, mode) + Playback(quality, source, auto-expand) + Data(counts, clear picks, clear library) + About(line) all present across the new routes.
</verification>

<success_criteria>
- /settings is a grouped drill-in IA: index = group list (rows -> navigate, chevrons); 7 per-group routes (general, translation, playback, history, lastfm, data, about), each with a back button to /settings and settings.load() on mount.
- Every pre-existing setting is relocated, none dropped; taxonomy matches CONTEXT.md exactly.
- New history store (runes singleton wrapping a pure node-testable logic module) records on player.play(), caps at ~50, dedupes by uid (replay moves to top), persists to openmusic:history:v1 SSR-guarded; imports nothing from player/library.
- History route lists tracks (reuses track-row + TrackMenu + longpress), tap-to-play, Clear history; unit test covers cap/dedupe/persist.
- Last.fm route is a disabled "coming soon" placeholder — no auth/network/secret; v1.1 Phase 11 owns real auth.
- All new chrome via t() with identical key sets across en / zh-Hant / zh-Hans (en = natural English).
- `pnpm check` 0 errors; `pnpm test --run` green. Working tree: only files this task edits were staged, by explicit path.
- README.md, ROADMAP.md untouched; no Last.fm auth built.
</success_criteria>

<output>
Create `.planning/quick/260606-ggv-restructure-settings-into-grouped-drill-/260606-ggv-SUMMARY.md` when done.
</output>
