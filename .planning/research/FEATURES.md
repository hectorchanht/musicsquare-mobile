# Feature Landscape

**Domain:** Mobile-first music-streaming PWA (multi-source aggregation; YouTube Music / Spotify / Apple Music conventions)
**Milestone:** v1.2 "Resilient Playback & UX Polish"
**Researched:** 2026-06-10
**Confidence:** MEDIUM-HIGH (behaviors verified against official docs + multiple secondary sources; exact timing constants are convention-derived, marked where so)

> Scope note: this maps ONLY the NEW v1.2 features (PART A) plus a fresh UX audit (PART B).
> Existing-and-shipped features (search, streaming, downloads, offline-first playback, synced
> LRC, track menu, Last.fm/Deezer discovery, MediaSession) are treated as dependencies, not
> items to (re)build. Where the codebase already implements part of a v1.2 item, that is called
> out under "Dependencies / current state" so the roadmap doesn't re-spec built behavior.
> (Prior v1.0/v1.1 feature research preserved in `.planning/research/v1.0-base/` + git history.)

---

## Table Stakes

Features users expect from any "real" music app. Missing = the app feels broken or toy-like.

| Feature | Why Expected | Complexity | Dependencies / current state |
|---------|--------------|------------|------------------------------|
| **Never-stop playback (autoplay continuation)** | Spotify/YTM/Apple all auto-play similar songs when the queue/album/playlist ends — "music never stops" is the baseline. Silent stop is the single worst playback failure. | High | `services/picks.ts` (`buildDiversePicks`), `services/similar.ts` (`buildSimilarQueue`), `player.svelte.ts` `playGen` supersedence + `tryFallback` already exist. v1.2 wires them into a never-stop policy + loop-guard. |
| **Skip-on-fail with feedback** | When a source returns a dead URL, the app must auto-advance, not hang. A brief toast ("Couldn't play X, skipping…") is the convention; Spotify shows "This track is currently not available." | Med | `services/fallback.ts` (`tryFallback`) + cross-source retry exist; needs toast wording + auto-skip wiring + loop-guard so all-down/offline doesn't infinite-skip. |
| **Next-track prefetch (near-gapless)** | Spotify/Apple prefetch & decode the next track so transitions are seamless. For an aggregator with slow upstream resolve (5–10s observed in `resolveStub`), prefetch is the difference between "instant next" and a stall. | Med-High | Player already has a `prefetchNext` in-flight uid guard field. True gapless (Web Audio crossfade) is NOT realistic with `<audio>` direct-src; **target = prefetch + resolve-ahead, not sample-accurate gapless.** |
| **Repeat control** | Universal. Spotify/YTM/Apple all ship 3-state (off → repeat-all → repeat-one). | Low | Store currently has tri-state `repeatMode` ('off'\|'one'\|'all'). **v1.2 DECISION: reduce to 2-state (off / repeat-one)** because auto-generated up-next makes repeat-all redundant. Deliberate divergence from the big-3 — see Anti-Features + audit AUD-09. |
| **Shuffle control** | Universal. Always separate from repeat, paired in the transport row. | Low | `player.shuffle` exists. Stays in-app (cannot live on the OS media card — fixed MediaSession action set). |
| **Sleep timer** | Apple Music, Spotify, YTM, Pandora all ship it. Standard durations: **5 / 10 / 15 / 30 / 45 / 60 min + "end of track"** (Spotify's exact set, verified). | Med | Not built. Needs a countdown that pauses (ideally fades) at expiry, persists across now-playing collapse, and a visible "timer active" indicator. v1.2 puts it in the track-menu modal. |
| **Queue visibility ("Up Next")** | Seeing what plays next is table stakes; YTM/Spotify both have a dedicated queue view. | — (built) | NowPlaying has a `queue` tab + drag-to-reorder (`reorderQueue`). ✓ |
| **Lyrics auto-scroll + suspend-on-touch** | Apple/Spotify pause auto-scroll while the user manually scrolls and re-center later. | — (mostly built) | NowPlaying suspends `autoScroll` on touch/wheel and resumes after a **600ms** grace timer. v1.2 adds end-of-lyrics spacer + CN highlight-order + bracket robustness. |
| **Tap-lyric-line to seek** | Apple Music & Spotify (newer) let you tap a synced line to jump there. | Med | NOT currently wired (lyrics render but tapping a line doesn't seek). Strong table-stakes candidate — see audit AUD-12. |
| **Context (long-press) track menu** | Long-press → action sheet is the universal mobile pattern (Spotify/YTM/Apple). | — (built) | `TrackMenu.svelte` renders instantly with skeleton + background resolve. v1.2 reworks header + adds remix/sleep + focus-state fix. |
| **Share link** | Every track/album/artist row has Share → system share sheet. | — (partial) | `services/share.ts` + Web Share API exist (opaque `?play=<token>`). v1.2 upgrades to per-entity OG metadata + readable slugs — see Differentiators. |
| **Cover swipe prev/next** | Spotify & (now) Apple Music both support swipe-left/right on the now-playing artwork to change tracks. | Med | Now-playing has a down-swipe-to-close drag machine; horizontal cover swipe for prev/next is NEW in v1.2. |
| **Empty / loading / error states** | Skeletons during load, friendly empty states, retry on error. | Low-Med | Skeletons partially adopted; v1.2 mandates shape-matched skeletons everywhere + button toast + double-click guard. |
| **Persistent mini-player (nowbar)** | Bottom-docked nowbar that expands to full now-playing. | — (built) | `Nowbar.svelte` + shared-element expand. ✓ |

---

## Differentiators

Not strictly expected, but raise the app from "works" to "feels premium." Several are explicit v1.2 targets.

| Feature | Value Proposition | Complexity | Dependencies / current state |
|---------|-------------------|------------|------------------------------|
| **Per-context up-next sourcing** ("same list" vs "genre-generated", per origin) | Big-3 hard-code their continuation logic; exposing it as a per-context setting (liked / search / album / downloads) is a power-user differentiator. v1.2 default = **generated**, so search never silently appends its full result list. | Med-High | Config-file defaults (`config/defaults.ts` pattern). Needs `playContext.origin` plumbed into the never-stop decision (which builder to call). |
| **Remix / "start radio from this track"** | Spotify's "Go to song radio" reseeds the queue from one track. v1.2 "remix" = seed a genre-generated queue from the long-pressed track. Differentiator because it surfaces the aggregator's cross-source discovery. | Med | `buildSimilarQueue` / `buildDiversePicks` exist; needs a menu action + queue-replace semantics. |
| **Readable share slugs + per-entity OG metadata** | Spotify uses opaque base-62 IDs; Apple uses readable slugs (`/album/take-on-me/123?i=456`). Readable slugs + per-page OG (song/album/artist) give rich link unfurls in chat apps — a real polish win for a sharing-driven app. | Med | Current share = opaque base64url token, no per-entity OG. Needs SvelteKit route-level `<svelte:head>` OG tags + a slug scheme. SEO depends on SSR/prerender on Cloudflare. |
| **Homepage compact rows-of-4 density mode** | YTM moved from carousels to denser grids (3×2 / rows). A per-section density toggle (compact rows-of-4 vs comfortable carousel) is a personalization differentiator. | Med | `HOME_DEFAULTS.homeDensity` ('comfortable') + `homeGridCols` already exist — extend to rows-of-4 per section. |
| **"See all" → grid / chart / library-tab navigation** | Section-title arrow → full grid page (YTM "More" top-right pattern). | Low-Med | Home sections exist; needs route targets (chart grid page or library-tab redirect). |
| **Cover fallback resolver + resolve-on-scroll-into-view, name-keyed cache** | Aggregated sources often return no/broken cover; a name-keyed fallback chain (Deezer→iTunes→CN, already built for backfill) applied lazily on scroll-into-view keeps lists from looking broken. | Med | `cover-art.ts`, `cover-backfill.ts`, `cover-cache.ts`, `itunes-cover.ts` exist. Extend to playing-track fallback + IntersectionObserver-driven resolve. |
| **Text-size 50–200% with contextual demo text** | Beyond OS font scaling — per-part (title/artist/lyrics) scale with a live "example xxx" preview is an accessibility-flavored differentiator. | Low | `APPEARANCE_DEFAULTS` already has per-part `fontScale*` (100 today); v1.2 widens to 50–200% + adds demo text. |
| **Deezer artist/album enrichment** | Richer metadata (bio, album art, related) than the bare aggregator stubs. | Med | `services/deezer.ts` exists; carryover from v1.1. |
| **Offline usability for downloads** | True offline-first playback (already shipped) + graceful "this needs network" display for online-only data when offline. | Low-Med (display) | Offline-first playback shipped (blob-store + IDB). v1.2 = simplest-possible offline display for online-only surfaces. |
| **Top running-line loader in now-playing** | Indeterminate progress line during resolve = perceived-speed polish. | Low | New. |

---

## Anti-Features

Features to explicitly NOT build (with the v1.2 rationale where relevant).

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|--------------------|
| Like / shuffle buttons on the OS media card | Web MediaSession exposes a **fixed action set**; custom actions are not rendered by Chrome/Android/macOS/iOS for PWAs. | Standard prev/play/next/seek on the OS card; like + shuffle live in-app only. (Confirmed PROJECT.md boundary.) |
| Sample-accurate gapless / crossfade | Direct-`<audio>` `.src` swap + expiring CDN URLs make true gapless unrealistic; Web Audio decode of remote streams adds CORS + memory cost. | Prefetch/resolve-ahead the next track for *near*-instant transitions. Don't promise crossfade. |
| Repeat-all (3rd state) | v1.2 DECISION: auto-generated up-next makes "wrap the queue" redundant + complicates the mental model. | 2-state repeat (off / repeat-one). Continuation handled by never-stop autoplay, not repeat-all. (Diverges from all big-3 — acceptable simplification; see AUD-09.) |
| Search silently appending its full result list as the queue | Surprising — user taps one search result and suddenly 50 unrelated results are queued. | Default up-next = genre-generated; "same list" is opt-in per context. |
| First-party accounts / cloud sync (own DB) | Out of scope; local-first. | Last.fm delegated auth deferred to v1.3; local-first remains the signed-out default. |
| Infinite skip loop when offline / all sources down | A never-stop policy without a guard becomes a CPU-burning skip storm. | Loop-guard: after N consecutive resolve failures, stop + toast "Can't reach any source — playback paused." |
| Heavy haptics on every interaction | "Haptic drift" — over-buzzing numbs the user (Android/iOS guidance). | A *small* reusable set keyed by meaning (success / boundary / selection), with an OFF/reduced setting. (Currently zero haptics — see AUD-06.) |

---

## Feature Dependencies

```
Never-stop autoplay ──requires──> picks.ts / similar.ts queue builders
                    ──requires──> playContext.origin (per-context sourcing)
                    ──requires──> loop-guard (offline / all-down detection)
                    ──pairs with─> prefetch-next (gapless feel)

Per-context up-next ──requires──> config/defaults.ts (global default = generated)
                    ──requires──> playContext { origin: liked|search|album|downloads }

Remix action ──requires──> similar/picks builders + queue-replace
             ──lives in──> TrackMenu rework

Sleep timer ──lives in──> TrackMenu rework
            ──requires──> active-timer indicator (now-playing + menu)

Cover swipe prev/next ──requires──> next()/prev() + must NOT conflict with down-swipe-to-close drag machine (axis-lock)

Share OG metadata ──requires──> readable slug scheme + SvelteKit SSR/prerender on Cloudflare (SEO)

Cover fallback-on-scroll ──requires──> IntersectionObserver + name-keyed cover-cache

Lyrics tap-to-seek ──requires──> synced LRC line index → audio.currentTime (independent of auto-scroll suspend, already built)
```

---

## PART A — How each v1.2 feature works in the big-3 (behavior reference)

### A1. Never-stop playback / autoplay continuation
- **When queue exhausts:** Spotify/YTM/Apple auto-play similar tracks ("Autoplay similar content" — Spotify setting under Playback). YTM builds a short *dynamic* queue and keeps extending it rather than loading everything at once.
- **Radio seed:** when a *playlist/album* ends, Spotify starts a Radio seeded by that context; a single track → "song radio." For us: seed `buildSimilarQueue` from the last track / context.
- **Skip-on-fail wording (convention):** Spotify "This track is currently not available." Keep it short, auto-dismiss ~3s; don't block on a modal. Pattern: "Couldn't play {title} — skipping."
- **Prefetch:** big-3 resolve + buffer next track ahead of time. **Table stakes for us given slow upstream resolve.** Sample-accurate gapless is a differentiator we explicitly skip.
- **Edge cases:** offline mid-session (pause + toast, don't skip-storm); all sources 403 (loop-guard); user manually skips during prefetch (supersede via `playGen`).

### A2. Sleep timer
- **Durations (Spotify, verified):** 5, 10, 15, 30, 45, 60 minutes + **"End of track."** Apple Music + custom; YTM ≈ 5/10/15/20/30/45/60 + end of track/episode. **Recommendation: 5/10/15/30/45/60 + end-of-track** (matches v1.2 spec, "industry-standard durations + end-of-track").
- **UI location:** Spotify = three-dot menu on Now Playing, scroll to bottom → Sleep Timer (moon icon for podcasts). Our track-menu modal matches.
- **At expiry:** playback pauses (gentle fade in last ~5–10s is a nice-to-have). Timer survives sheet collapse; show an active indicator. "End of track" = stop when the current song ends.

### A3. Repeat control
- **Big-3 = 3-state:** off → repeat-all (context) → repeat-one (badge "1"). Icon highlights (accent/green) when active. Repeat is separate from shuffle and placed on the **opposite side** of the transport (Spotify: shuffle far-left, repeat far-right of the play cluster).
- **v1.2 = 2-state** (off / repeat-one) — deliberate divergence. Keep the accent-on visual; the "1" badge is optional since there's only one active mode.

### A4. Up-next sourcing per origin (what the big-3 actually queue)
- **Play from album/playlist:** queues the rest of that list in order; Autoplay (similar) kicks in only after exhaustion.
- **Play from a single search result / song:** Spotify queues *song-radio*-style similar tracks (NOT "all search results"). YTM builds a generated mix.
- **Play from "Liked":** queues your liked songs (the list) — then autoplay similar after.
- **Implication for v1.2:** liked/album/downloads → "same list" is sensible for those origins, but the global default = generated and **search defaults to generated** (never the raw result list). Matches big-3 intuition (search → radio, not result-dump).

### A5. Lyrics UX
- **Suspend-on-touch:** Apple/Spotify pause auto-scroll while you drag; resume after you stop. Our impl resumes after **600ms** idle (within the acceptable 600ms–1.5s band; Apple feels ~1–2s, Spotify sometimes needs re-open).
- **Current-line centering:** keep the active line vertically centered (Spotify has a known *non*-centering complaint — easy to beat).
- **End-of-lyrics:** add a trailing spacer so final lines still scroll to center instead of clamping (explicit v1.2 item).
- **Tap-to-seek:** Apple + newer Spotify support it; strong candidate (AUD-12).
- **Multi-line / shared-timestamp:** CN LRCs ship original+translation on the same timestamp — highlight must pick the original, not the translation line (explicit v1.2 bug).

### A6. Context menu (long-press) conventions
- **Instant render, progressive data:** open immediately, fill async (already done — skeleton then resolve). Big-3 do the same.
- **Action ordering (Spotify current):** Add to playlist → Add to queue → (Like) → Go to song/artist/album radio → Go to artist → Go to album → Share. Spotify moved "Add to playlist" above "Add to queue" recently.
- **"Start radio / remix" semantics:** replaces the queue with a generated mix seeded by the track (song radio). Premium-gated on Spotify mobile; free for us.
- **Header:** v1.2 = 2-row marquee header (title / artist), Like at top-right beside Close — matches "primary affirmative action elevated, close at corner."

### A7. Cover swipe prev/next
- **Spotify:** swipe left/right on now-playing artwork OR the nowbar title → next/prev. **Apple Music** added artwork swipe only recently (2025).
- **Conflict:** vertical swipe = collapse sheet; horizontal = track change. Need a direction-lock at gesture start (our drag machine already distinguishes axes for the down-swipe).

### A8. Share links / OG metadata
- **Spotify:** `https://open.spotify.com/track/{base62Id}` — opaque IDs, `?si=` tracking param stripped on share. Rich OG unfurl (title, artist, cover, audio preview) server-rendered.
- **Apple Music:** `https://music.apple.com/{cc}/album/{readable-slug}/{numericId}?i={trackId}` — **human-readable slug + numeric id**. Song links resolve to the album page with the track selected.
- **Recommendation:** adopt Apple-style readable slugs (`/song/{artist-title-slug}-{shortcode}`), keep the opaque token decodable for playback re-resolution, and render per-entity OG via SvelteKit `<svelte:head>` with SSR/prerender on Cloudflare for unfurls + SEO.

### A9. Homepage shelf density / "see all"
- **YTM trend:** carousels → denser grids (3×2 / rows-of-N); "More" button top-right of a shelf → full grid page; artist pages use "See all" → grid.
- **Recommendation:** per-section density (comfortable carousel vs compact rows-of-4); section-title arrow → grid chart page or library-tab redirect (matches v1.2 spec exactly).

### A10. Multi-source search ranking heuristics
- **Industry approach:** cross-source dedupe via normalized artist+title keys (MusicBrainz-style), down-rank variants (cover/karaoke/live/instrumental), prefer canonical/clean titles. Acoustic fingerprinting is overkill here.
- **Current code (`score-match.ts`):** already does matchKey similarity + a 14-keyword (EN+CJK) variant penalty (cover/karaoke/live/翻唱/卡拉ok/伴奏…), word-boundary-safe; score = similarity − variantPenalty.
- **v1.2 adds:** short-title boost (clean exact titles rank higher), artist-frequency boost (an artist appearing across multiple sources is likely canonical), and a **heavy <60s 試聽 (preview-clip) penalty** — aggregator sources often return 30s previews that should sink, not surface. These are additive scoring terms on the existing pure scorer.

---

## MVP Recommendation (v1.2 build ordering)

Prioritize the resilience core first (the milestone's namesake + highest user-visible risk), then the menu/now-playing reworks that other items hang off, then polish.

1. **Never-stop playback engine** — failover → toast + auto-skip, loop-guard, prefetch-next, auto-generated up-next, per-context sourcing, 2-state repeat. *(Table stakes; everything else is polish on top of a player that doesn't stop.)*
2. **TrackMenu rework** — instant buttons + bg resolve (mostly built), 2-row marquee header, top-right like/close, **remix** action, **sleep timer**, focus-state fix. *(Unblocks remix + sleep, both new.)*
3. **Now-playing polish** — cover swipe prev/next, half-open scroll containment, tap-cover-closes-subnav, top running-line loader.
4. **Lyrics fixes** — end spacer, CN highlight order, bracket robustness (auto-scroll suspend already built). Consider adding **tap-line-to-seek** (AUD-12).
5. **Search scoring tune** — short-title + artist-frequency boost + <60s penalty + result cover fallback + empty-query autofocus.
6. **Homepage density + see-all nav**, **cover fallback resolver**, **Deezer enrichment**.
7. **Sharing/SEO** (OG + slugs) and broad polish (skeletons everywhere, text-size 50–200%, double-click guard, hide trackless albums, accent verify).

**Defer:** true gapless/crossfade (anti-feature), haptics-everywhere (do a *small* meaningful set only), Last.fm write-side (v1.3).

---

## Sources

- Spotify Newsroom — Sleep timer durations (5/10/15/30/45/60 + end of track): https://newsroom.spotify.com/2022-08-02/how-to-make-spotifys-sleep-timer-part-of-any-bedtime-routine/ (HIGH)
- Spotify Support — Autoplay similar content: https://support.spotify.com/us/article/autoplay/ (HIGH)
- We Are Colorblind — Spotify repeat 3-state behavior: https://wearecolorblind.com/examples/spotify-shuffle-and-repeat-buttons/ (MEDIUM)
- Macworld — Apple Music synced lyrics tap-to-seek: https://www.macworld.com/article/233114/how-to-use-synchronized-lyrics-in-apple-music-on-your-iphone-ipad-or-apple-tv.html (MEDIUM)
- Macworld — Apple Music swipe gesture to change tracks (2025): https://www.macworld.com/article/2918525/ (MEDIUM)
- HowToGeek — Spotify swipe gestures (artwork/title swipe prev-next): https://www.howtogeek.com/spotify-gestures-every-subscriber-should-know/ (MEDIUM)
- Apple Developer — Apple Music link format (readable slug + numeric id): https://developer.apple.com/library/archive/featuredarticles/iPhoneURLScheme_Reference/iTunesLinks/iTunesLinks.html (HIGH)
- Soundplate — Spotify open.spotify.com/track/{base62} format: https://soundplate.com/spotify-uri-url-converter/ (MEDIUM)
- Spotify Community — "Go to radio" context-menu semantics + ordering: https://community.spotify.com/t5/Your-Library/Go-to-Song-artist-radio-missing/td-p/5336278 (MEDIUM)
- 9to5Google — YTM carousel→grid, "More"/"See all" navigation: https://9to5google.com/2022/05/01/youtube-music-listen-again/ ; https://9to5google.com/2022/06/24/youtube-music-mixed-for-you-grid/ (MEDIUM)
- Android Developers — Haptics design principles (small reusable set, per-meaning): https://developer.android.com/develop/ui/views/haptics/haptics-principles (HIGH)
- MusicBrainz Indexed Search Syntax (fuzzy/dedupe norms): https://musicbrainz.org/doc/Indexed_Search_Syntax (MEDIUM)
- Codebase (direct read, HIGH): `src/lib/services/score-match.ts`, `share.ts`, `picks.ts`, `similar.ts`, `fallback.ts`, `stores/player.svelte.ts`, `config/defaults.ts`, `components/{NowPlaying,TrackMenu,Nowbar}.svelte`

---

## UX Audit Findings (PART B)

Audit of the described app (bottom nav; nowbar; now-playing sheet with half-open Queue/Lyrics/Related; long-press track menus; download/like actions) against music-streaming industry standards. Each finding: **severity** (Critical / High / Medium / Low) and **v1.2 coverage** (Covered / Partial / Not covered).

> Grounding: findings checked against the actual components (`NowPlaying.svelte`, `TrackMenu.svelte`, `Nowbar.svelte`, `player.svelte.ts`) — not just the prose description — so coverage tags reflect real code state on 2026-06-10.

| ID | Finding | Severity | v1.2 Coverage | Detail / Recommendation |
|----|---------|----------|---------------|-------------------------|
| **AUD-01** | **No swipe-actions on list rows** (swipe-to-queue / swipe-to-like). Big-3 + mail-style apps expose quick actions via row swipe; the app relies solely on long-press → menu. | Medium | **Not covered** | Add swipe-left-on-row → "Add to queue", swipe-right → "Like" (haptic bump at threshold). Cheap, high-frequency shortcut. Long-press menu stays the full set. |
| **AUD-02** | **Queue editing is reorder-only; no swipe-to-remove and no "clear queue" / "save queue as playlist."** `NowPlaying` has drag-grip reorder (`reorderQueue`) but no per-row remove or bulk ops. | High | **Partial** | Reorder ✓. Add: remove on each Up-Next row, a "Clear" affordance, "Save as playlist." YTM/Spotify both have remove-from-queue. |
| **AUD-03** | **Never-stop / skip-on-fail needs a user-visible recovery contract.** Without a loop-guard + clear toast, all-sources-down / offline risks a silent stop OR a skip-storm. | Critical | **Covered** (the v1.2 namesake) | Ensure the loop-guard surfaces ONE actionable toast ("Can't reach any source — paused. Retry?") instead of silently halting. Confirm the toast wording ships, not just the skip logic. |
| **AUD-04** | **No haptic feedback anywhere** (`grep vibrate\|haptic` = 0 hits). Mobile music apps use subtle haptics for like, skip, drag-threshold, sleep-timer set. | Medium | **Not covered** | Add a *small* reusable `haptics` util (selection / success / boundary) via `navigator.vibrate`, gated by reduce-motion / an OFF setting. iOS Safari has limited/absent vibration — degrade gracefully. Don't over-buzz. |
| **AUD-05** | **Mini-player (nowbar) lacks horizontal swipe gestures.** Nowbar has only open + play/pause; Spotify lets you swipe the nowbar to skip and swipe-down to dismiss. | Medium | **Partial** | Cover-swipe prev/next is a v1.2 item but specced for the now-playing cover, not the nowbar. Extend the same gesture to the nowbar title/artwork. Consider swipe-down-to-dismiss. |
| **AUD-06** | **In-list cover-tap → jump-to-now-playing semantics unclear.** Spotify uses cover tap to navigate to the playing context. | Low | **Partial** | v1.2 has "tap cover closes subnav" inside now-playing; nowbar cover-tap already expands. Clarify in-list cover tap target. Minor. |
| **AUD-07** | **Empty states likely text-only / inconsistent.** Spec replaces loading *text* with skeletons, but empty states (no liked, no results, no downloads, offline) need explanatory empties with a CTA, not blank. | Medium | **Partial** | v1.2 covers skeletons + offline display; explicitly design empty states per library tab + zero-results search (with a "try a different spelling" hint). |
| **AUD-08** | **Offline error recovery for online-only surfaces underspecified.** Offline, discovery shelves / search / artist pages fail; a raw error or infinite spinner is the failure mode. | High | **Covered** (spec: "simplest-possible offline display") | Online-only surfaces should show "You're offline — showing downloads" with downloads still playable, not a dead screen. Tie to AUD-03 loop-guard. |
| **AUD-09** | **2-state repeat diverges from all big-3 (3-state).** Users from Spotify/YTM/Apple will look for repeat-all and not find it. | Low | **Covered** (deliberate) | Acceptable given auto-generated up-next, but make the two states unmistakable (clear off vs repeat-one) so users don't think repeat "doesn't work." |
| **AUD-10** | **OS media card can't show like/shuffle (MediaSession fixed action set).** Users may expect a lock-screen heart. | Low | **Covered** (documented boundary) | Nothing to build; ensure the in-app like is obviously reachable so the gap isn't felt. Confirm artwork + metadata + seek correct on the card (`media-session.ts` exists). |
| **AUD-11** | **Accessibility: verify control labels + focus management on the sheet & menu.** Long-press focus-state bug already flagged. Sheet open/close should move + trap focus; transport toggles need `aria-pressed`. | High | **Partial** | v1.2 fixes the long-press focus-state bug. Broaden: `aria-pressed` on shuffle/repeat, focus-trap + restore on sheet/menu open-close, `aria-label`s on all icon-only buttons (Nowbar labels play/pause/open — extend everywhere). Test VoiceOver/TalkBack. |
| **AUD-12** | **No tap-lyric-line-to-seek.** Apple + newer Spotify support tapping a synced line to jump there; the app renders synced LRC but doesn't wire the tap. | Medium | **Not covered** | Each lyric `<p>` already maps to a timestamp (active-line logic exists). Wire `onclick` → `player.seek(line.time)`. Low effort, high perceived polish. Independent of the auto-scroll-suspend work. |
| **AUD-13** | **Sleep timer needs a persistent active-state indicator.** A timer set in the menu modal must be visible after the modal closes (Spotify shows a moon/countdown). | Medium | **Partial** | Sleep timer is in scope; ensure an indicator (countdown chip / moon icon) appears in now-playing or the menu + a quick "cancel timer." |
| **AUD-14** | **Double-tap / double-submit guards inconsistent.** Rapid taps on play/like/download can double-fire (e.g. two downloads). | Low | **Covered** | v1.2 lists "button toast + double-click guard." Apply uniformly to download/like/share/play-resolve. |
| **AUD-15** | **Cover-swipe vs sheet-collapse gesture conflict.** Adding horizontal cover swipe over the existing vertical down-swipe-to-close drag machine risks misfires. | High | **Covered** (cover swipe is in scope) | Implement an axis-lock at gesture start (the down-swipe drag already detects axis) + a horizontal-dominance threshold before committing to prev/next, so a diagonal close-gesture doesn't skip tracks. **Riskiest v1.2 UX interaction — flag for deeper design.** |
| **AUD-16** | **Share unfurls are weak (opaque token, no per-entity OG).** A shared link is `?play=<base64>` with no rich preview — poor for a share-driven app. | Medium | **Covered** | v1.2 adds OG metadata + readable slugs. Ensure OG is per-entity (song/album/artist) and the playback token stays decodable behind the pretty slug. Depends on Cloudflare SSR/prerender. |
| **AUD-17** | **Search empty-query autofocus + state-preservation.** Returning to search should restore prior results, not blank + steal focus disruptively. | Low | **Covered** | v1.2: "empty-query autofocus (state-preservation safe)" + search-state restore already shipped. Verify autofocus doesn't wipe restored results on back-navigation. |

### Top audit themes for the roadmap
- **Resilience UX contract (AUD-03 / 08 / 15)** is the highest-risk cluster — the never-stop policy and the cover-swipe-vs-close gesture both need explicit interaction design, not just logic.
- **Queue power-ops (AUD-02) and row swipe-actions (AUD-01)** are the biggest *missing table-stakes* not fully in v1.2 scope — candidate adds.
- **Accessibility (AUD-11) and haptics (AUD-04)** are partially / not covered and cheap to add as cross-cutting passes.
- **Tap-lyric-to-seek (AUD-12)** is a low-effort, high-polish quick win currently out of scope.
