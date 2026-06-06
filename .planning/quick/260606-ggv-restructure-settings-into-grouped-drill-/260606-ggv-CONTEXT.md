# Quick Task 260606-ggv: Grouped drill-in settings + recently-played history - Context

**Gathered:** 2026-06-06
**Status:** Ready for planning

<domain>
## Task Boundary

Restructure the settings page from one long scroll into a **grouped, drill-in information architecture**: the top-level `/settings` becomes a list of setting groups; each row navigates into its own sub-section. Regroup the existing (already-i18n'd) settings by nature, add a **Song-History** group (recently-played — a NEW feature), and a **Last.fm** group (login **placeholder** only).
</domain>

<decisions>
## Implementation Decisions (LOCKED — user answered "No preference" → all recommended defaults)

### Drill-in mechanism — separate SvelteKit routes
- `/settings` (index) becomes a **group list**: each row shows icon + group name + chevron and navigates to its sub-route.
- Each group is its own route under `src/routes/(app)/settings/<group>/+page.svelte`, with a back button → `/settings`. Real browser-back nav, deep-linkable. (NOT in-page accordion / view-swap.)
- Sub-routes inherit the `(app)` layout (bottom nav + now-playing bar). Reuse the existing chip / seg / row-toggle / swatch styles (extract a tiny shared stylesheet or component if it reduces duplication — executor's call). All chrome via the existing `t()` i18n helper.

### Group taxonomy (fuller suggestion, beyond the user's 4)
Move each existing setting into one of these groups (no settings dropped):
- **General** (`/settings/general`) — App language, Accent color, Reduce motion.
- **Translation** (`/settings/translation`) — Lyrics translation, Translate names, Translate mode. (CONTENT translation — distinct from the General app-UI language.)
- **Playback** (`/settings/playback`) — Default quality, Default source, Auto-expand on play.
- **History** (`/settings/history`) — Recently played (NEW, below).
- **Last.fm** (`/settings/lastfm`) — Connect placeholder (below).
- **Data** (`/settings/data`) — library counts, Clear top picks, Clear library.
- **About** (`/settings/about`) — about line.

### History scope — build lightweight LOCAL recently-played
- New store `src/lib/stores/history.svelte.ts` (Svelte 5 runes singleton). Imports NOTHING from player/library (avoid circular deps — same rule as settings store). `player` imports `history`, not vice-versa.
- Records each played track on `player.play()` (player.svelte.ts:119): prepend to a capped most-recent-first list (cap ~50), de-dupe by `uid` (re-play moves to top). Persist to `localStorage` key `openmusic:history:v1`, SSR-guarded, serialize via the existing `serializeTrack`-style minimal shape (the Track shape is rich; store enough to re-resolve/replay).
- History route renders the list (reuse the existing track-row markup + `TrackMenu` + `longpress`), tap a row to play it, plus a **Clear history** button.

### Last.fm entry — disabled placeholder (do NOT build auth)
- `/settings/lastfm` shows a disabled "Connect Last.fm — coming soon" entry. NO auth, NO network, NO secret use. Real auth is the security-planned **v1.1 Phase 11** (LASTFM_SECRET, httpOnly `sk` cookie, T-lfm-01/02/03, api_sig) — this task must not pre-empt it. A short note that it's coming is fine.

### i18n
- Every new chrome string (group names, history labels, Last.fm placeholder, back labels) goes through `t()` with NEW keys added to ALL THREE locale dicts (`en`, `zh-Hant`, `zh-Hans`) — identical key sets, per the existing i18n module contract. `en` values = natural English.
</decisions>

<specifics>
## Specific Ideas

- Current `/settings/+page.svelte` is a single scroll with ~9 sections, ALL already i18n'd via `t()` — moving them is mostly relocating existing markup + handlers into the right sub-route, not rewriting logic.
- `settings.svelte.ts` is the shared store all sub-routes read/write (`settings.load()` + `settings.save()`); each sub-route calls `settings.load()` on mount like the current page does.
- Reuse `TrackMenu` + `use:longpress` for History rows (same pattern as search/library/home lists).
- Player hook point: `async play(track, opts?)` at `src/lib/stores/player.svelte.ts:119`.
</specifics>

<canonical_refs>
## Canonical References & Guardrails

- i18n module contract: `src/lib/i18n/` — `t(key)`, identical key sets across `en`/`zh-Hant`/`zh-Hans`, fallback key→en→raw.
- Store style reference: `src/lib/stores/settings.svelte.ts` (runes singleton, `load()`/`save()`, SSR-guarded, "imports nothing from player/library to avoid circular deps").
- Last.fm auth is OUT of scope — reserved for v1.1 Phase 11 (see STATE.md blockers / PROJECT.md). Placeholder only.
- Working-tree hygiene: stage only files this task edits, by explicit path; never `git add -A`/`.`.
</canonical_refs>
