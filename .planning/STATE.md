---
gsd_state_version: 1.0
milestone: v1.1
milestone_name: Last.fm Integration
status: executing
stopped_at: "Phase 9 executed — 3/3 plans + code-review fixes (CR-01 image XSS, WR-01..04); pnpm check clean, 165/165 tests. SECURITY.md pending for 8 & 9 (/gsd:secure-phase)."
last_updated: "2026-06-06T12:16:23.200Z"
last_activity: 2026-06-06 -- Phase 14 planning complete
progress:
  total_phases: 7
  completed_phases: 2
  total_plans: 8
  completed_plans: 6
  percent: 29
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-05)

**Core value:** A user on their phone can search a song, tap it, and have it play instantly with a smooth, native-app-like experience — and keep playing when the screen locks.
**Current focus:** Phase 9 — Discovery / Hot-Picks Tab

## Current Position

Milestone: v1.1 — Last.fm Integration (Phases 8–13)
Phase: 9 (Discovery / Hot-Picks Tab) — EXECUTING
Plan: 3 of 3
Status: Ready to execute
Last activity: 2026-06-06 -- Phase 14 planning complete

## Performance Metrics

**Velocity:**

- Total plans completed: 1
- Average duration: 7 min
- Total execution time: 0.1 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 8 | 1 | 7 min | 7 min |

**Recent Trend:**

- Last 5 plans: 08-01 (7 min)
- Trend: —

*Updated after each plan completion*
| Phase 8 P03 | 5 | 1 tasks | 1 files |
| Phase 09 P01 | 9min | 3 tasks | 8 files |
| Phase 09 P02 | 4min | 3 tasks | 6 files |
| Phase 09 P03 | 7min | 3 tasks | 5 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Phase 8-01]: Read-proxy route shape = DEDICATED `/api/lastfm/info` route (mirrors `/api/similar`), NOT the `/api/[source]/[...path]` catch-all — avoids widening `SourceId` to `'lastfm'` (which breaks `SOURCES: Record<SourceId, SourceAdapter>` until a Phase-10 client source exists) and gets the absent-key-is-200-clean-empty posture for free.
- [Phase 8-01]: Enriched fields = OPTIONAL fields on `Track` (tags?/bio?/bioUrl?/lastfmArt?), NOT a side cache. No `serializeTrack` whitelist on the library path; fields persist JSON-safe with no migration. Deliberately NOT added to `HistoryEntry`/`toEntry` (re-enrich on replay). `matchKey` is artist-first (`norm(artist)|norm(title)`, Pitfall 9); `dedupe.ts` keeps its legacy title|artist order and is left untouched.
- [Roadmap v1.1]: Read-only-first phase order — enrichment (8), discovery (9), source (10) ship value with zero auth surface before the highest-risk signed-call infrastructure + auth lands once (11), then scrobble (12) and loved-sync (13) layer on top. Auth cannot move earlier: scrobble/loved-sync hard-depend on the `sk` cookie.
- [Roadmap v1.1]: Last.fm-searchable source resolves via the EXISTING CN-source re-search resolver (searchAll + dedupeBest + best-match scoring). GD Studio `ytmusic` is OUT of v1.1 (deferred to v2 / LFSRC-FB-01); would need its own feasibility spike if pulled in.
- [Roadmap v1.1]: `LASTFM_SECRET` + session key stay edge-only; sk in an httpOnly+Secure+SameSite cookie, never localStorage, never in a response body (JOOX_TOKEN parity / threats T-lfm-01/02/03). The match-key normalization primitive lands in Phase 8 and is reused by Phase 13 reconciliation.
- [Roadmap]: Bottom-up phase order — extract data layer + prove proxy boundary headless before any UI is built (avoids building on an audio engine whose iOS behavior is unproven).
- [Roadmap]: Proxy metadata only through SvelteKit `+server.ts`; audio bytes stream browser → CDN directly (preserves geo/IP context, stays within Worker free-tier limits).
- [Roadmap]: Single module-scoped `<audio>` element owned by an `AudioEngine` singleton; Svelte 5 runes in `.svelte.ts` for all shared state; source-adapter registry so adding a source touches only new files.
- [Phase ?]: 09-01: Endpoint fork B — dedicated /api/lastfm/discovery for LIST methods; /api/lastfm/info extended only for album tracklist
- [Phase ?]: 09-01: Cache API cache key = own-origin discovery Request (secret never cached); per-method public TTLs charts 1h/tags 6h/topalbums 24h
- [Phase ?]: 09-02: Home is the Last.fm discovery surface — FOUR shelves (top hits / top artists / per-tag / per-country); tag+country fan-out capped via mapWithConcurrency (≤4 in-flight, Pitfall 11); v2 localStorage shelf cache + background revalidate
- [Phase ?]: 09-02: Discovery tracks are {artist,title} stubs — tap-to-play resolves via resolveStub (searchAll+dedupeBest) then player.play (D-03); top-artist tiles goto to the artist page; buildDiversePicks stays as the no-key/empty fallback (D-06)
- [Phase ?]: 09-03: album artist carried via ?artist= URL query param (artist-page link), read with page.url.searchParams.get — replaces the tracks[0]?.artist derivation; the album tracklist is the real album.getInfo ordered stubs resolved on tap via resolveStub

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
| 260606-h4s | Half-open now-playing fixes (follow-up to ggj): (1) flush half-open — `halfOffset` measured from live `.transport` bottom edge (was arbitrary 50% height) + persistent resting `translateY(halfOffset)` so half stops collapsing to full coverage, panel fills all space below controls with no gap; (2) subnav item tap now has priority over the open-gesture — `data-tab` + `gripStartTab` route the tap to `selectTab` (switch tab + half-open), drags still snap without switching; (3) `.np.reflow .bar` floats `position:absolute;top:0` transparent over the full-bleed cover. Single file (NowPlaying.svelte), no new deps/i18n; check 0/0, 113/113 tests | 2026-06-06 | 7fb2845 | [260606-h4s-fix-half-open-now-playing-remove-gap-bet](./quick/260606-h4s-fix-half-open-now-playing-remove-gap-bet/) |
| 260606-kyf | Wire W3C Media Session API so OS/browser media UI (Chrome hub, macOS Now Playing, lock screen, BT car) shows track title/artist/album/cover + transport + scrubber like YouTube Music (was page-title + Chrome icon). Pure node-testable `media-session.ts` helpers (`buildArtwork`/`safePositionState`/`playbackStateFor`, 16 tests) + wired into player store behind a single `get ms()` SSR+feature guard: 7 action handlers (play/pause/prev/next/seek±10s/seekto) registered once in attach(), `MediaMetadata` from resolved track in play(), `playbackState`/`setPositionState` synced off existing listeners, `clearMedia()` on error; reuses toggle/prev/next/seekFraction, no backend touch, no new deps, native DOM types, `/favicon.svg` fallback art; check 0/0, 129/129 tests | 2026-06-06 | 8f9f3d8 | [260606-kyf-wire-media-session-api-os-browser-media-](./quick/260606-kyf-wire-media-session-api-os-browser-media-/) |
| 260606-ncw | Audit: outside (scrim) click always closes any modal. Verdict = ALREADY SATISFIED, no code change. All 3 TrackMenu sheets (menu/picker/detail) have sibling `.scrim` buttons (full-viewport, z80 below modal z81) whose onclick only flips local `$state`; the `$effect` cleanup is the sole `overlays.dismiss(id)` site → scrim/X/drag/back-gesture all converge on one dismiss path (no history-depth desync). Nested menu→picker verified: picker scrim paints on top, closes correct layer LIFO. No other custom modals exist (album=toast, NowPlaying=full-screen, prompt/confirm=native). check 0/0, 165/165 tests | 2026-06-06 | (no-op) | [260606-ncw-outside-scrim-click-always-closes-any-mo](./quick/260606-ncw-outside-scrim-click-always-closes-any-mo/) |
| 260606-nqf | Now-playing gesture fixes (follow-up ggj/h4s): (1) VELOCITY snap — new pure `src/lib/gestures/velocity.ts` (`createVelocityTracker`, e.timeStamp, 6 tests) wired into `gripUp` (fast flick steps one state in swipe dir; slow drag keeps nearest-by-position) + `dragClose.up()` (flick-dismiss past velocity threshold even if not dragged far, dy>8 tap guard); (2) HALF-OPEN GAP root-caused — `measureOffsets` ran at reflow START reading pre-shrink transport bottom (0.32s cover transition) → overshoot; now re-measures after reflow settles (`transitionend` + double-rAF + 340ms fallback) → flush, zero gap; (3) LYRICS half-open — replaced `scrollIntoView` (walked ancestors → expanded sheet) with panel-scoped `scrollTo` rect-delta math (stays half) + finger-presence auto-scroll (pause on touch/wheel, resume ~600ms after release, was 2.5s idle timer). 3 files, no new deps/i18n; check 0/0, 171/171 tests | 2026-06-06 | ef4fda5 | [260606-nqf-now-playing-gesture-fixes-velocity-inert](./quick/260606-nqf-now-playing-gesture-fixes-velocity-inert/) |
| 260606-nza | Home discovery UX: (A) optimistic tap-to-play — `player.playStub` instantly locks the tapped stub into the now-bar with an indeterminate loading sliver before the ~10s CN-source resolve, same-song double-tap deduped, a newer tap supersedes the stale resolve (generation guard), success→play / miss→toast; (B) Cover Art Archive tile covers — surface Last.fm `mbid` through the discovery reshape, client `caaReleaseGroupCover` builds `coverartarchive.org/release-group/{mbid}/front-250` as an `<img>` over the gradient (onerror→gradient, never a broken image, no safeImageUrl change since mbid is `<img src>` not CSS url()); MusicBrainz no-mbid search fallback deferred. check 0/0, 186/186 tests | 2026-06-06 | 4b7a03d | [260606-nza-home-discovery-optimistic-tap-to-play-wi](./quick/260606-nza-home-discovery-optimistic-tap-to-play-wi/) |
| 260606-oil | Per-part translation redesign (--discuss): each surface (artist name / song title / lyrics / Last.fm tags) gets its OWN target lang + a skip-whitelist of source langs to leave original; no single master lang. New pure `src/lib/i18n/detect.ts` (`detectLang` precise zh-vs-ja via kana/hangul/Latin + simplified/traditional Han signal; `shouldTranslate` skips when source∈whitelist or source==target; 15 tests). Settings split `nameLang`→independent `artistLang`+`titleLang`, kept `lyricsLang`/`appLang`, added `lastfmLang` + per-part whitelist sets; non-destructive localStorage migration (mirrors old nameLang, empty whitelists). appLang stays en/zh-Hant/zh-Hans (ja/ko content-only, no ja chrome dict). Redesigned `/settings/translation` 5-section UI + i18n keys in 3 dicts. Applied: `names.dn`→`dnArtist`/`dnTitle`/`dnLastfm` swept across ~26 call sites (incl home), lyrics per-line whitelist, tag gating. NOTE: merged across a concurrent uncommitted NowPlaying.svelte edit (parallel lyrics-anchor work) — stash/merge/pop auto-merged clean, both preserved. check 0/0, 201/201 tests | 2026-06-06 | b5cacae | [260606-oil-per-part-translation-settings-redesign-i](./quick/260606-oil-per-part-translation-settings-redesign-i/) |
| 260606-pkl | Auto-deploy on push to main (--discuss). Method = Cloudflare Pages NATIVE Git integration (dashboard), NOT GitHub Actions — so deliverable is repo config CF reads + setup docs (no workflow file, no GH secrets, no tokens in repo). Scope Pages-only (API proxy is bundled `+server.ts` via adapter-cloudflare `_worker.js`, no separate Worker). Added `.nvmrc` (22) + `package.json` engines.node `>=22` so CF build uses Node 22; `wrangler.jsonc` already correct (name openmusic, output `.svelte-kit/cloudflare`). New `docs/DEPLOY.md` + README Deployment section: connect repo hectorchanht/musicsquare-mobile → openmusic (account f1868a071996e836eae6da2b65f37929), branch main, build `pnpm build`, output `.svelte-kit/cloudflare`, Node 22 / NODE_VERSION fallback, prod env-var reminder (JOOX_TOKEN required; LASTFM_KEY/LASTFM_SECRET optional; LASTFM_ENDPOINT is a constant, NOT a var). No app code. pnpm build → .svelte-kit/cloudflare OK, check 0/0, 201/201 tests | 2026-06-06 | e3ddc69 | [260606-pkl-auto-deploy-to-cloudflare-pages-on-push-](./quick/260606-pkl-auto-deploy-to-cloudflare-pages-on-push-/) |

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

Last session: 2026-06-06T08:36:29.252Z
Stopped at: Phase 9 executed — 3/3 plans + code-review fixes (CR-01 image XSS, WR-01..04); pnpm check clean, 165/165 tests. SECURITY.md pending for 8 & 9 (/gsd:secure-phase).
Resume: verify phase 9 (run /gsd:verify-phase 9) — all 3 plans complete
