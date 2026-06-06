---
gsd_state_version: 1.0
milestone: v1.1
milestone_name: Last.fm Integration
status: planning
stopped_at: Phase 8 context gathered
last_updated: "2026-06-06T04:00:57.115Z"
last_activity: "2026-06-06 — Created v1.1 roadmap (Phases 8–13): all 19 Last.fm requirements mapped, 100% coverage"
progress:
  total_phases: 6
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-05)

**Core value:** A user on their phone can search a song, tap it, and have it play instantly with a smooth, native-app-like experience — and keep playing when the screen locks.
**Current focus:** Phase 8 — Last.fm Read Foundation & Metadata Enrichment (v1.1)

## Current Position

Milestone: v1.1 — Last.fm Integration (Phases 8–13)
Phase: Phase 8 — Last.fm Read Foundation & Metadata Enrichment
Plan: — (not yet planned)
Status: Defined — ready to plan (`/gsd:plan-phase 8`)
Last activity: 2026-06-06 — Completed quick task 260606-ggj: mobile UX + gesture overhaul (drag-to-close, back-gesture, 3-state now-playing sheet, cover reflow)

## Performance Metrics

**Velocity:**

- Total plans completed: 0
- Average duration: — min
- Total execution time: 0.0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

**Recent Trend:**

- Last 5 plans: —
- Trend: —

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Roadmap v1.1]: Read-only-first phase order — enrichment (8), discovery (9), source (10) ship value with zero auth surface before the highest-risk signed-call infrastructure + auth lands once (11), then scrobble (12) and loved-sync (13) layer on top. Auth cannot move earlier: scrobble/loved-sync hard-depend on the `sk` cookie.
- [Roadmap v1.1]: Last.fm-searchable source resolves via the EXISTING CN-source re-search resolver (searchAll + dedupeBest + best-match scoring). GD Studio `ytmusic` is OUT of v1.1 (deferred to v2 / LFSRC-FB-01); would need its own feasibility spike if pulled in.
- [Roadmap v1.1]: `LASTFM_SECRET` + session key stay edge-only; sk in an httpOnly+Secure+SameSite cookie, never localStorage, never in a response body (JOOX_TOKEN parity / threats T-lfm-01/02/03). The match-key normalization primitive lands in Phase 8 and is reused by Phase 13 reconciliation.
- [Roadmap]: Bottom-up phase order — extract data layer + prove proxy boundary headless before any UI is built (avoids building on an audio engine whose iOS behavior is unproven).
- [Roadmap]: Proxy metadata only through SvelteKit `+server.ts`; audio bytes stream browser → CDN directly (preserves geo/IP context, stays within Worker free-tier limits).
- [Roadmap]: Single module-scoped `<audio>` element owned by an `AudioEngine` singleton; Svelte 5 runes in `.svelte.ts` for all shared state; source-adapter registry so adding a source touches only new files.

### Pending Todos

[From .planning/todos/pending/ — ideas captured during sessions]

None yet.

### Blockers/Concerns

[Issues that affect future work]

- [Phase 1]: Worker egress geo-behavior against JOOX/QQ audio CDNs is unconfirmed — spike required before the audio data-flow architecture is locked. Research flag set.
- [Phase 6]: iOS standalone-PWA background audio is contested (STACK.md vs PITFALLS.md); only a real-device spike (iOS 15.4 / 16 / 17 / 18 / 18.4+) covering play-while-locked AND pause→wait→resume-from-lock can resolve it. Research flag set.
- [Phase 11]: Highest-risk v1.1 surface — owns T-lfm-01/02/03 (secret/sk leakage, CSRF) + `api_sig` UTF-8/CJK correctness. Mandatory `周杰伦`/`稻香` signing fixture test must run in the workerd/`wrangler dev` runtime (throws NotSupportedError under jsdom/Node — that's runtime, not a code bug).
- [Phase 13]: May need `/gsd:plan-phase --research-phase 13` IF CJK normalization proves complex (Traditional/Simplified folding, CJK punctuation variants, "ghost" loved stubs with no playable source).
- [Phase 10]: GD Studio `ytmusic` is deferred from v1.1; if ever pulled in it warrants its own feasibility spike (`s`-checksum drift, 50 req/5 min cap, instance failover, Western-catalog match rate).

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260605-wq1 | Sketch-001 variant C home shell + search, wired to data layer; deployed to openmusic.pages.dev | 2026-06-05 | 0684b67 | [260605-wq1-implement-sketch-001-variant-c-home-shel](./quick/260605-wq1-implement-sketch-001-variant-c-home-shel/) |
| 260606-2k7 | Full-screen now-playing (expand/drag-collapse) + artist page + seekable progress (NaN fix); deployed | 2026-06-06 | a1422fd | [260606-2k7-full-screen-now-playing-artist-page-prog](./quick/260606-2k7-full-screen-now-playing-artist-page-prog/) |
| 260606-3a0 | Persist playback across nav + nowbar progress sliver + diverse cached top picks (localStorage) + Randomize; deployed | 2026-06-06 | 3a0832b | [260606-3a0-persist-playback-nowbar-progress-diverse](./quick/260606-3a0-persist-playback-nowbar-progress-diverse/) |
| 260606-3f6 | Hide source + cross-source dedupe/best-quality + draggable subnav sheet + smart lyrics scroll + auto-advance/auto-grow queue; deployed | 2026-06-06 | aa0260a | [260606-3f6-dedupe-cross-source-hide-source-draggabl](./quick/260606-3f6-dedupe-cross-source-hide-source-draggabl/) |
| 260606-4g1 | Rebrand openmusic + lucide icons + settings & library pages + now-playing options menu (download/like/playlist/album/artist/share/detail) + sensitive grip; deployed | 2026-06-06 | e959635 | [260606-4g1-rebrand-openmusic-settings-library-nowpl](./quick/260606-4g1-rebrand-openmusic-settings-library-nowpl/) |
| 260606-4pn | Settings: live lyrics translation (/api/translate, replace/below) + default quality/source + accent/reduce-motion/auto-expand; deployed | 2026-06-06 | ec862cc | [260606-4pn-settings-lyrics-translation-default-qual](./quick/260606-4pn-settings-lyrics-translation-default-qual/) |
| 260606-54l | Translate displayed song/artist names (settings nameLang) + long-press track context menu (Play next / Add to queue + 7 actions, reusable TrackMenu); deployed | 2026-06-06 | ac8b6fd | [260606-54l-translate-song-artist-names-long-press-t](./quick/260606-54l-translate-song-artist-names-long-press-t/) |
| 260606-5du | Live-drag now-playing panel grip (translateY follows finger, smooth snap like full-page close); deployed | 2026-06-06 | d5201c7 | [260606-5du-smooth-live-drag-now-playing-panel-grip](./quick/260606-5du-smooth-live-drag-now-playing-panel-grip/) |
| 260606-5ji | openmusic logo/favicon (SVG mark) + SEO (meta, OG/Twitter share card, manifest, robots/sitemap); deployed | 2026-06-06 | 9621a70 | [260606-5ji-favicon-logo-seo-meta-og-twitter-manifes](./quick/260606-5ji-favicon-logo-seo-meta-og-twitter-manifes/) |
| 260606-5of | Remove unused/fork-cruft: orphan favicon dup, docs/logo.png (README fix), legacy/ (~220KB), g4f issue bot + workflow, fork issue templates + FUNDING; svelte-check clean | 2026-06-05 | e688cfe | [260606-5of-remove-things-that-are-not-used-or-neede](./quick/260606-5of-remove-things-that-are-not-used-or-neede/) |
| 260606-5vm | Rewrite README for the openmusic SvelteKit project (doc-only; reconciled removed legacy/ refs) | 2026-06-06 | bde56ea | [260606-5vm-update-readme-for-svelte-project](./quick/260606-5vm-update-readme-for-svelte-project/) |
| 260606-5ug | Smarter Up-Next: Last.fm artist.getSimilar gen (server-side key + same-artist fallback) regen-on-fresh-play preserving manual adds, pointer-drag reorder (GripVertical, pins manual), current-track length; check clean, 67/67 tests | 2026-06-05 | be967a3 | [260606-5ug-up-next-list-auto-generated-from-similar](./quick/260606-5ug-up-next-list-auto-generated-from-similar/) |
| 260606-6p7 | App-language selector (English/繁體中文/简体中文) + whole-app i18n: dependency-free runes t() in src/lib/i18n/, ~74 chrome strings across 12 files (toasts/menus/aria), persisted appLang + first-visit auto-detect, nameLang/lyricsLang kept independent; check clean, 78/78 tests | 2026-06-05 | 66f871c | [260606-6p7-add-app-language-selector-to-settings-i1](./quick/260606-6p7-add-app-language-selector-to-settings-i1/) |
| 260606-ggv | Grouped drill-in settings: /settings → 7-group list (general/translation/playback/history/lastfm/data/about) each its own route; NEW local recently-played History (pure logic+test, runes store, openmusic:history:v1, recorded in player.play, cap 50/dedupe/tap-to-play); Last.fm route = disabled "coming soon" placeholder (real auth deferred to Phase 11); i18n keys in 3 locales; check clean, 89/89 tests | 2026-06-06 | fa142b2 | [260606-ggv-restructure-settings-into-grouped-drill-](./quick/260606-ggv-restructure-settings-into-grouped-drill-/) |
| 260606-ggj | Mobile UX + gesture overhaul: reusable `dragClose` action (finger-follow translateY dismiss, tap-preserving) + `overlays.svelte.ts` History-API back-to-close stack (single dismiss path, depth==stack invariant); now-playing sheet now 3-state (closed/half/full) with direction-biased nearest-snap, subnav row doubles as drag handle (tap still switches tab), YT-Music full-bleed cover-squeeze reflow on half/full; drag-to-close + back-gesture wired into all 3 TrackMenu sheets + now-playing; no new deps/i18n keys; check clean, 89/89 tests | 2026-06-06 | caf9f6a | [260606-ggj-make-it-more-mobile-friendly-and-enhance](./quick/260606-ggj-make-it-more-mobile-friendly-and-enhance/) |

> Note: off planned phase order (Phase-4-shaped UI pulled forward as a demo). Basic playback only; full audio engine = Phase 6, formal Mobile UI Shell = Phase 4.

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| Resilience | SRC-FB-01 source fallback on play failure (cross-source matching) | Deferred to v2 | 2026-06-05 |
| Delight | LYR-01 tap-lyric-to-seek | Deferred to v2 | 2026-06-05 |
| Delight | TIMER-01 sleep timer | Deferred to v2 | 2026-06-05 |
| Delight | HOME-01 recently-played / search history | Deferred to v2 | 2026-06-05 |
| Delight | COACH-01 custom PWA install coachmark | Deferred to v2 | 2026-06-05 |

## Session Continuity

Last session: 2026-06-06T04:00:57.109Z
Stopped at: Phase 8 context gathered
Resume: `/gsd:plan-phase 8` (Last.fm Read Foundation & Metadata Enrichment)
