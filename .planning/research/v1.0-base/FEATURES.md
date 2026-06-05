# Feature Research

**Domain:** Mobile-first music streaming PWA (YouTube Music / Spotify / Apple Music style), aggregating audio from unofficial third-party CN proxy sources
**Researched:** 2026-06-05
**Confidence:** HIGH on UX patterns and PWA/mediaSession constraints (verified against web.dev, MDN, recent iOS/Safari reports); MEDIUM on exact competitor gesture details (community/press sources, behavior varies by version)

> Scope note: This is a rebuild. The existing data layer already delivers search, audio-URL + lyrics resolution, play modes, favorites/playlists with localStorage, import/export, and zh/en i18n (see `.planning/codebase/ARCHITECTURE.md`). This research focuses on the **mobile UX shell and platform capabilities** wrapped around that proven backend. Where a feature maps to an existing capability, it is flagged **[EXISTS]**; where it is net-new, **[NEW]**.

---

## Feature Landscape

### Table Stakes (Users Expect These)

These define "feels like a real music app." Missing any of these makes the PWA feel like a web page, not an app — the exact failure the rebuild exists to fix.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Persistent mini-player** docked above bottom nav (cover thumbnail, title, play/pause, progress) | Universal pattern in YT Music / Spotify / Apple Music. Users expect playback context to follow them as they browse. | MEDIUM | Must persist across route changes. In SvelteKit, lives in the root layout outside the page slot so it never unmounts on navigation. **[NEW]** wrapper around existing `currentTrack`/`isPlaying` state. |
| **Expandable full-screen now-playing** (tap mini-player → slide up; swipe-down to dismiss) | The defining gesture of the genre. YT Music's 2026 redesign and Spotify both center on it. | MEDIUM-HIGH | Shared-element transition (cover thumbnail grows into hero art) is what sells the "native" feel. Svelte transitions + FLIP make this tractable. **[NEW]** |
| **Bottom-tab navigation** (Home/Search/Library, ~3-4 tabs) | Thumb-reachable primary nav is the mobile-app convention; top tabs feel like a website. | LOW-MEDIUM | Maps existing 3-panel desktop layout (Search / Player / Library) onto tabs. Player becomes the mini-player + now-playing overlay, not a tab. **[NEW] (replaces desktop panels)** |
| **Search across sources with instant results** | Core of the product. | LOW (backend done) | `searchAllSources` + `getInterleavedSearchList` already exist. UI: full-width search field, results list, per-result source pill. **[EXISTS]** |
| **Tap-to-play from any list** | Baseline interaction. | LOW (backend done) | `playFromList(type, index)` exists. **[EXISTS]** |
| **Play / pause / next / prev + seekable progress bar** | Non-negotiable transport controls. | LOW (backend done) | `playTrack`/`playNext` exist; HTML5 `<audio>` gives seek. **[EXISTS]** |
| **Play modes: sequential / repeat-one / shuffle** | Expected toggle on the now-playing screen. | LOW (backend done) | `state.playMode` (list/single/shuffle) exists; just needs touch-friendly toggle UI. **[EXISTS]** |
| **Background playback + lock-screen / notification controls + metadata** | A music app that dies on screen-lock is unusable. This is the #1 "is it real" test. | HIGH | `navigator.mediaSession` for metadata + action handlers (play/pause/next/prev/seek). **Critical caveat below** — iOS PWA background audio is fragile. **[NEW]** |
| **Now-playing metadata: cover art, title, artist, source/quality** | Users orient by album art. | LOW (data exists) | Existing track object carries `cover`, `title`, `artist`, `source`, `quality`. **[EXISTS]** |
| **Synced lyrics view** (scrolling, current line highlighted) | YT Music / Spotify / Apple Music all ship this; it's expected, not a bonus, in 2026. | MEDIUM | LRC parsing (`parseLRC`) and timestamp data exist. UI: auto-scroll + active-line highlight on `timeupdate`. Tap-line-to-seek is a cheap nice-to-have. **[EXISTS data, NEW view]** |
| **Library: favorites + user playlists** | Users expect to save and revisit songs. | LOW (backend done) | `favorites`, `playlists`, localStorage persistence all exist. **[EXISTS]** |
| **Favorite/like toggle from now-playing and from list rows** | One-tap save is standard. | LOW (backend done) | `toggleFavoriteCurrent`/`isFavorite` exist. Heart icon on now-playing + row. **[EXISTS]** |
| **Queue / Up-Next view** (see what plays next; reorder; remove; jump-to) | Spotify/YT Music both expose an explicit queue. Current app has *no* queue concept — it advances through whatever list is active. | MEDIUM-HIGH | **Biggest backend gap.** Today the "queue" = active list (`playContext`). A real queue needs an explicit, mutable, reorderable list independent of the source list. See dependencies + pitfalls. **[NEW]** |
| **Installable PWA (Add to Home Screen, app-shell caching)** | "Installable" is the bar for app-like distribution without app stores. | MEDIUM | Service worker caches the shell (HTML/CSS/JS/icons). **Audio is NOT cached** — streamed from third-party URLs that expire. **[NEW]** |
| **Responsive layout (phone → desktop)** | Same URL must work on a laptop. | MEDIUM | Mobile-first; widen to a multi-column layout at desktop breakpoints. **[NEW]** |
| **zh / en language toggle** | Existing users expect it; CN-source audience is bilingual. | LOW (backend done) | `translations`/`t()` exist. **[EXISTS]** |
| **Loading / buffering / error states** | Third-party sources fail often; silent failure feels broken. | MEDIUM | Per-track resolve can fail (expired URL, dead proxy). Need skeletons, spinners on resolve, and clear "couldn't play / trying next source" toasts. Existing error handling is console-only — **must upgrade**. **[NEW UX over existing logic]** |

### Differentiators (Competitive Advantage)

Not expected, but they make this app stand out — especially against the big players' inability to surface these CN sources at all. Align with the Core Value ("search a song, tap it, play instantly, native feel").

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Multi-source aggregation in one search** | The actual moat: YT Music/Spotify can't return Netease/QQ/Kuwo/JOOX/Kugou/Migu results. One query, all sources, interleaved. | LOW (backend done) | Already the product's superpower. Surface source pills + let users see which platform a result came from. **[EXISTS]** |
| **Per-source / quality badges on results & now-playing** | Power users care that JOOX defaults to Atmos/lossless. Transparency the big apps hide. | LOW | `inferQualityFromUrl` + `qualityLabel` exist. **[EXISTS]** |
| **Swipe gestures: swipe-to-change-track, swipe-down-to-dismiss, drag-to-reorder queue** | This is what separates "web app" from "native feel." Spotify's swipe-to-queue is a beloved power feature. | MEDIUM-HIGH | Touch gesture lib or hand-rolled pointer events. Drag-reorder depends on the queue feature existing. **[NEW]** |
| **Local-first portability: JSON import/export of library** | No account needed; users own their data; trivial backup/migrate. Big apps lock you in. | LOW (backend done) | `importPlaylistData`/`exportPlaylistData` exist. Surface as a clean Library → Settings action. **[EXISTS]** |
| **Source fallback on play failure** ("couldn't play from QQ → trying Netease for same song") | Turns the #1 reliability weakness (dead proxies / expired URLs) into a resilience feature. | HIGH | Requires matching the same song across sources; non-trivial. High value, defer past v1. **[NEW]** |
| **Sleep timer** | Common bedtime-listening request; cheap to build with the `<audio>` element. | LOW | Pause after N minutes / end-of-track. **[NEW]** |
| **Recently played / search history** | Quick re-access; fills the "Home" tab cheaply so it isn't empty. | LOW-MEDIUM | Store last-N in localStorage. Helps Home tab not feel barren without a recommendations engine. **[NEW]** |

### Anti-Features (Commonly Requested, Often Problematic)

Documented to prevent scope creep and to protect the legal/technical posture set in PROJECT.md.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **Offline audio download / track caching** | "Spotify lets me download." Users assume offline = table stakes. | Legal exposure (caching copyrighted audio from unofficial proxies), storage cost, and **technically near-impossible**: source URLs are short-lived/expiring CDN links, not stable files. Explicitly Out of Scope in PROJECT.md. | Be honest: streaming-only. Cache the *app shell* offline so the UI loads, but show a clear "offline — playback needs a connection" state. Manage the expectation in onboarding. |
| **User accounts / cloud sync of library** | "Sync my playlists across devices." | Backend, auth, privacy/PII, server cost, and it contradicts the local-first design. Out of Scope in PROJECT.md. | Local-first (localStorage/IndexedDB) + JSON import/export covers portability. Position as a feature ("no account, your data is yours"), not a gap. |
| **Recommendations / "For You" / algorithmic radio** | Big-app home screens are recommendation-driven; an empty Home tab feels unfinished. | Requires a recommendation engine, listening-history modeling, and ideally a catalog API none of these unofficial sources expose cleanly. Huge effort, low payoff for a demo app. | Fill Home with deterministic content: recently played, search history, favorites shortcuts, maybe source-provided hot/top lists if a proxy offers them. |
| **Native iOS / Android apps** | "Real apps are in the store." | App-store ToS exposure for an unofficial aggregator, review risk, double maintenance. Out of Scope in PROJECT.md. | PWA + Add to Home Screen delivers the app-like experience without store gatekeeping. |
| **Video playback (YT Music song↔video toggle)** | YT Music's signature dual mode. | Sources here are audio-only; no value, large complexity. | None needed — audio-first is the product. |
| **Audio-reactive visualizer driven by real waveform** | The existing app has particle effects; "make them react to the music." | Requires Web Audio `AnalyserNode` tapping the audio graph; CORS-tainted cross-origin audio **cannot be analyzed** (the source URLs are cross-origin and not CORS-enabled for media). The current code already fakes it with `Math.sin`. | Keep purely decorative motion (driven by play state / progress), not real FFT. Don't promise reactive visuals. |
| **Crossfade / gapless playback** | Audiophile request. | A single HTML5 `<audio>` element can't crossfade; needs dual elements + Web Audio gain nodes, complicated further by expiring stream URLs and buffering from flaky proxies. | Defer indefinitely. Not worth the complexity against unreliable sources. |
| **Equalizer** | "Let me tune the sound." | Web Audio EQ requires routing audio through `AudioContext`, which is blocked for cross-origin non-CORS media — same wall as the visualizer. | Skip. Rely on source-provided quality tiers (Atmos/lossless via JOOX). |

---

## Feature Dependencies

```
Persistent mini-player
    └──requires──> Global playback state in root layout (currentTrack, isPlaying)  [EXISTS, needs reactive wrapper]
            └──requires──> Reactive store replacing imperative renderers           [NEW — see ARCHITECTURE anti-patterns]

Expandable full-screen now-playing
    └──requires──> Persistent mini-player (it is the collapsed state)
    └──enhanced-by──> Swipe-down-to-dismiss gesture
    └──contains──> Lyrics view, queue access, play-mode toggle, favorite toggle

Background playback + lock-screen controls (navigator.mediaSession)
    └──requires──> Stable global audio element that survives navigation         [NEW — single <audio> in root layout]
    └──requires──> Track metadata (title/artist/cover) wired into mediaSession   [EXISTS data]
    └──enhanced-by──> Wake Lock API (keep audio alive; iOS caveats apply)

Queue / Up-Next
    └──requires──> Explicit queue model separate from playContext               [NEW — backend gap]
            └──blocks──> playNext() rewrite to consume the queue                 [MODIFY existing]
    └──enhanced-by──> Drag-to-reorder gesture
    └──enhanced-by──> Swipe-to-add-to-queue from result/list rows

Installable PWA (service worker)
    └──requires──> App-shell caching (HTML/CSS/JS/icons)
    └──conflicts-with──> Offline audio (intentionally NOT cached — streaming only)
    └──platform-gated──> Custom install prompt logic (Android = beforeinstallprompt; iOS = manual instructions)

Source fallback on play failure
    └──requires──> Cross-source song matching (title/artist normalization)       [NEW — hard]
    └──requires──> Robust per-track error states                                 [NEW]
```

### Dependency Notes

- **Mini-player + now-playing require a reactive global store.** The existing code uses imperative `render*()` calls after each mutation (ARCHITECTURE.md "Anti-Patterns"). For a persistent player that survives SvelteKit navigation, playback state must live in a Svelte store in the root layout, with the `<audio>` element mounted once at the root — not re-created per route.
- **Background/lock-screen controls require the single-audio-element pattern.** `navigator.mediaSession` metadata and action handlers must point at one long-lived audio element. Mounting `<audio>` inside a page component breaks playback on navigation.
- **Queue is the one true backend gap.** Everything queue-related (drag-reorder, swipe-to-queue, up-next view, "play next") depends on introducing an explicit queue model. Today `playNext()` walks the active source list via `playContext`; this must be refactored so the queue is the source of truth and the source list merely *seeds* it.
- **Source fallback depends on cross-source matching**, which is genuinely hard (no shared IDs across Netease/QQ/Kuwo/JOOX). Keep it out of v1.
- **PWA install prompt is platform-forked** (see Competitor/Platform analysis): Android supports `beforeinstallprompt`; iOS Safari does not — it needs a custom "tap Share → Add to Home Screen" coachmark.

---

## MVP Definition

### Launch With (v1)

The minimum that delivers Core Value: "search a song, tap it, play instantly, native feel, keeps playing on lock."

- [ ] **Reactive global playback store + single root-level `<audio>` element** — foundation everything else hangs off; resolves the imperative-render anti-pattern.
- [ ] **Bottom-tab nav (Home/Search/Library) + persistent mini-player** — the app shell.
- [ ] **Expandable full-screen now-playing (tap up / swipe-down dismiss)** — the defining interaction.
- [ ] **Search across sources + tap-to-play** — wraps existing backend.
- [ ] **Transport: play/pause/next/prev, seek, play modes** — wraps existing backend.
- [ ] **Synced lyrics view** — wraps existing LRC data.
- [ ] **Library: favorites + playlists + import/export** — wraps existing backend.
- [ ] **Background playback + `navigator.mediaSession` lock-screen controls + metadata** — the "is it real" test. Validate on Android first; treat iOS as best-effort (see pitfalls).
- [ ] **Installable PWA with app-shell caching** — streaming stays online-only.
- [ ] **Loading / buffering / error states + toasts** — sources fail; failures must be visible and graceful.
- [ ] **Responsive layout + zh/en toggle** — inherited expectations.

### Add After Validation (v1.x)

- [ ] **Explicit queue / Up-Next view with remove + jump-to** — once core playback is stable; requires the queue-model refactor. *Trigger: users ask "where's my queue?" or hit the limits of list-based advance.*
- [ ] **Drag-to-reorder queue + swipe-to-add-to-queue gestures** — depends on the queue model landing. *Trigger: queue view shipped.*
- [ ] **Swipe-to-change-track gesture on now-playing** — polish once core is solid.
- [ ] **Sleep timer** — cheap, high-satisfaction. *Trigger: any bedtime-listening feedback.*
- [ ] **Recently played / search history on Home** — fills the Home tab. *Trigger: Home tab feels empty in testing.*
- [ ] **Custom PWA install coachmark (Android prompt + iOS Share instructions)** — *Trigger: install rate measured low.*

### Future Consideration (v2+)

- [ ] **Source fallback on play failure (cross-source matching)** — high value, high effort; defer until reliability data justifies it.
- [ ] **Tap-lyric-line-to-seek** — small delight, low priority.
- [ ] **New sources (Kugou, Migu, others best-effort)** — backend expansion tracked in PROJECT.md Active; orthogonal to the UX shell.

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Reactive store + root `<audio>` element | HIGH (enables all) | MEDIUM | P1 |
| Bottom-tab nav + persistent mini-player | HIGH | MEDIUM | P1 |
| Expandable full-screen now-playing | HIGH | MEDIUM-HIGH | P1 |
| Search + tap-to-play (wrap existing) | HIGH | LOW | P1 |
| Transport + play modes (wrap existing) | HIGH | LOW | P1 |
| Background playback + mediaSession controls | HIGH | HIGH | P1 |
| Synced lyrics view | HIGH | MEDIUM | P1 |
| Library: favorites/playlists/import-export | HIGH | LOW | P1 |
| Installable PWA + app-shell caching | MEDIUM-HIGH | MEDIUM | P1 |
| Loading / error states + toasts | HIGH | MEDIUM | P1 |
| Responsive + i18n | MEDIUM | MEDIUM | P1 |
| Explicit queue / Up-Next view | HIGH | MEDIUM-HIGH | P2 |
| Drag-reorder + swipe-to-queue gestures | MEDIUM | MEDIUM-HIGH | P2 |
| Swipe-to-change-track gesture | MEDIUM | MEDIUM | P2 |
| Sleep timer | MEDIUM | LOW | P2 |
| Recently played / search history | MEDIUM | LOW-MEDIUM | P2 |
| Custom install coachmark | MEDIUM | LOW | P2 |
| Source fallback on play failure | HIGH | HIGH | P3 |
| Quality/source badges (wrap existing) | LOW-MEDIUM | LOW | P2 (cheap, do early) |

---

## Competitor / Platform Analysis

### UX patterns

| Feature | YouTube Music | Spotify | Apple Music | Our Approach |
|---------|---------------|---------|-------------|--------------|
| Now-playing | Tap mini-player → full screen; 2026 redesign uses a split/collapsible layout with Lyrics + Related expandable panels | Mini-player → full screen; swipe-down to dismiss | Hero art → scrolling lyrics in full screen | Mini-player → slide-up full screen, swipe-down dismiss, shared-element cover transition. Keep it simpler than YT's split view (mixed reception). |
| Queue | Explicit Up-Next, reorderable | Explicit queue; swipe-right = add to queue (iOS-first, later Android), swipe-left on queue = remove | Up-Next list | Introduce explicit queue in v1.x; adopt Spotify's swipe-to-queue once queue model exists. |
| Lyrics | Synced, line-level | Synced (not every song), often manual scroll | Synced, line/sentence highlight (best-in-class) | Line-level synced auto-scroll + active highlight (data already available via LRC). Word-by-word is out of scope. |
| Bottom nav | Home/Samples/Explore/Library | Home/Search/Library (+Premium) | Home/New/Radio/Library/Search | 3-4 tabs: Home/Search/Library. Player is overlay, not a tab. |

### Platform capability reality (PWA — informs feasibility, not just UX)

| Capability | Android Chrome | iOS Safari / PWA | Implication |
|-----------|----------------|------------------|-------------|
| `navigator.mediaSession` metadata + actions | Solid; rich lock-screen/notification controls | Supported since Safari 16.4 but **historically buggy**; artwork sizing flaky (use small pre-sized art; iOS 18 improved 512×512); compact-player art quirks | Implement mediaSession universally; **validate on Android first**, treat iOS lock-screen polish as best-effort. |
| Background audio on screen-lock | Reliable | Fragile in standalone PWA; reports of audio stopping/needing workarounds | This is the project's top UX risk. Test the exact target devices early; do not assume parity. |
| `beforeinstallprompt` (install prompt) | Supported — can trigger custom install UI | **Not supported** — manual "Share → Add to Home Screen" only; EU iOS 17.4 regressed standalone PWAs (open as tabs); iOS 26 defaults non-EU home-screen sites to web-app mode | Fork install UX: Android programmatic prompt; iOS coachmark. Don't block launch on iOS install conversion. |
| Wake Lock API | Supported | Limited / inconsistent | Use as enhancement for keeping playback alive, not a guarantee. |
| Service-worker app-shell cache | Solid | Supported with quirks (storage eviction) | Cache shell only; never attempt to cache expiring audio URLs. |

---

## Sources

- **PROJECT.md** and **`.planning/codebase/ARCHITECTURE.md`** — existing capabilities, queue/playContext model, anti-patterns, JOOX quality tiers. (HIGH — primary source of record)
- [web.dev — Media Session API](https://web.dev/articles/media-session) — mediaSession metadata + action handlers, lock-screen controls. (HIGH)
- [MDN — Making PWAs installable](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable) and [web.dev — Installation prompt](https://web.dev/learn/pwa/installation-prompt) — `beforeinstallprompt`, install criteria. (HIGH)
- [dbushell — iOS PWA & Media Session API](https://dbushell.com/2023/03/20/ios-pwa-media-session-api/) — iOS Safari 16.4 fix, artwork sizing quirks, iOS 18 512×512 improvement. (MEDIUM-HIGH)
- [Apple Developer Forums — iOS Audio Lockscreen Problem in PWA](https://developer.apple.com/forums/thread/762582) and [Discourse Meta — Media playback in PWA when locked](https://meta.discourse.org/t/media-playback-with-pwa-keep-playing-when-phone-locked/182219) — iOS background-audio fragility reports. (MEDIUM)
- [whatpwacando.today — Audio](https://whatpwacando.today/audio/) — PWA audio capability demos. (MEDIUM)
- [9to5Google — YouTube Music split-view Now Playing redesign (2026)](https://9to5google.com/2026/04/23/youtube-music-split-now-playing-redesign/) and [Android Police — YT Music Now Playing redesign](https://www.androidpolice.com/youtube-music-now-playing-redesign-android/) — current now-playing pattern. (MEDIUM)
- [XDA — Spotify swipe-to-queue on Android](https://www.xda-developers.com/spotify-android-swipe-to-queue-gesture/) and [HowToGeek — Spotify gestures](https://www.howtogeek.com/spotify-gestures-every-subscriber-should-know/) — queue swipe gesture UX. (MEDIUM)
- [TechRadar — Apple Music vs Spotify lyrics sync](https://www.techradar.com/audio/spotify/i-didnt-know-you-could-do-this-hack-in-spotify-lyrics-until-now-and-im-truly-astonished-but-its-only-available-to-android-users-leaving-us-ios-minions-on-the-back-burner) — line vs manual-scroll lyrics expectations. (MEDIUM)
- [MobiLoud — Do PWAs work on iOS (2026)](https://www.mobiloud.com/blog/progressive-web-apps-ios) / [MagicBell — PWA iOS limitations 2026](https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide) — iOS PWA install + standalone limitations, EU regression, iOS 26 changes. (MEDIUM)

---
*Feature research for: mobile-first music streaming PWA aggregating unofficial CN sources*
*Researched: 2026-06-05*
