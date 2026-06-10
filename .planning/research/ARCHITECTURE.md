# Architecture: v1.2 Integration Map

**Domain:** Resilient playback + UX polish for an existing SvelteKit (Svelte 5 runes) + Cloudflare music PWA
**Researched:** 2026-06-10
**Scope:** How v1.2 features integrate into the existing `src/lib` architecture. New vs modified modules with explicit file paths, data-flow changes, and a dependency-ordered build sequence.
**Overall confidence:** HIGH (grounded in direct reads of the live codebase; no external library claims involved)

---

## Existing architecture (the seam every feature plugs into)

```text
src/routes/+layout.svelte            ← single long-lived <audio>, player.attach + player.restore, base OG meta
  └ src/routes/(app)/+layout.svelte  ← Nowbar / NowPlaying mount, overlays.init() popstate, library/settings load
       ├ (app)/+page.svelte          ← home (863 lines): shelves, cover-backfill caller
       ├ (app)/search                ← search results
       ├ (app)/artist/[name]         ← derived artist page (searchAll grouped)
       ├ (app)/album/[name]          ← Last.fm tracklist, resolve-on-tap stubs
       ├ (app)/library
       └ (app)/settings/*            ← per-group settings pages (general/appearance/playback/home/…)

src/lib/stores/   player.svelte.ts (singleton audio engine) · settings.svelte.ts · library.svelte.ts
                  history.svelte.ts · names.svelte.ts · overlays.svelte.ts (history-API back-to-close)
src/lib/services/ catalog (searchAll/ensureTrackDetails) · fallback · similar · picks · discovery (resolveStub)
                  dedupe · blob-store (IDB) · cover-cache · cover-backfill · cover-art (CAA) · lrc · media-session
                  deezer · lastfm · itunes-cover · ttl-cache · share · translate · score-match · match-key
src/lib/sources/  registry + per-source adapters (netease/qq/kuwo/joox/fivesing/jamendo) — CLIENT side
src/lib/proxy/    edge proxy adapters (Cloudflare) — hides tokens, handles CORS
src/routes/api/   /api/[source]/[...path] · /api/deezer · /api/lastfm · /api/similar · /api/translate
```

**Load-bearing invariants v1.2 must not break:**

1. **Single `<audio>` element**, mounted once in the ROOT layout, attached via `player.attach(el)`. iOS single-element constraint stands — no second audio element for byte-warming (the store comment at `player.svelte.ts:540-546` explicitly rules this out).
2. **`playGen` monotonic generation guard** — every `play()` bumps it; in-flight fallback/prefetch/reresolve abort when superseded. Any new async playback path MUST snapshot+check `playGen`.
3. **Overlay = history-depth invariant** (`overlays.svelte.ts`): `open()` pushes exactly one raw `history.pushState`; the host `$effect` cleanup is the SINGLE `dismiss()` site. The TrackMenu `$effect` deps on `open` ONLY, NOT `track`. This is the #1 pitfall for the menu-modal rework.
4. **Stores never import the player** (settings/library/history are leaf stores) — avoids circular deps. New stores (sleep-timer, online) should stay leaf or be owned by the player.
5. **Services never throw** — every service is SSR-guarded and best-effort; a miss → null → caller degrades. New services must follow this.
6. **No service worker exists yet** and **no vite-plugin-pwa** is installed (only a static `manifest.webmanifest` + `app.html` PWA meta). Offline app-shell is genuinely net-new infra.

---

## Feature-by-feature integration

### 1. Never-stop playback

**Where failover lives today:** Already implemented and mature. `player.svelte.ts` has:
- `runFallback(failed)` (`:870`) — the cross-source driver, generation-guarded, with a 200ms watchdog that aborts the in-flight `tryFallback` when `playGen` moves.
- `tryFallback()` in `src/lib/services/fallback.ts` — searches each OTHER enabled source for the same `{artist,title}`, returns the first resolved Track or null.
- The audio `error` listener (`:421`) routes seek-window errors to `reresolveCurrent()` and genuine failures to `runFallback()`.

**Integration verdict: EXTEND, do not rebuild.** "All-source retry → toast + auto-skip" is a small delta on existing code, not a new module. A separate "playback-resilience module" is NOT warranted — the resilience logic must stay co-located with the `playGen`/generation-guard state in the player store; fragmenting it would break that guard.

- **Auto-skip on exhaustion:** today `runFallback`'s exhaustion branch sets `this.error` + `clearMedia()` and STOPS. v1.2 wants it to *toast and skip to next* instead. Change: in that branch, fire a toast signal and call `this.next()` — guarded by the skip-loop counter (below). **Modify `player.svelte.ts`.**
- **Skip-loop guard state (NEW field on Player):** add `private consecutiveSkips = 0`. Reset to 0 on a successful audio `play` event (`:372`). Increment when an auto-skip fires from exhaustion. When it exceeds queue length (or a cap ~5), STOP and surface "all sources unavailable / offline" instead of looping. This is the loop-guard PROJECT.md names ("loop-guard for offline/all-down"). **Modify `player.svelte.ts`.**
- **Offline short-circuit:** before launching `runFallback`, check `navigator.onLine === false` → skip the network thrash, surface offline immediately (unless the next queue entry is a downloaded blob, which still plays). **Modify `player.svelte.ts`.**

**Gapless prefetch:** Already exists as `prefetchNext()` (`:548`). It pre-RESOLVES the next track's URL/lyrics (the felt latency is the proxy round-trip, NOT byte buffering) and writes the resolved Track back into `queue[i+1]` so the later `play()` hits a no-op resolve = instant start. It is correctly NOT a second audio element. **Integration verdict: ALREADY DONE.** v1.2 work here is verification/tuning. Optional enhancement: prefetch the offline-blob lookup too (`blobStore.get` for the next uid if downloaded) so blob-URL creation isn't on the critical advance path. **Optional modify `player.svelte.ts`.**

**ended → prefetched-next handoff:** lives in the `ended` listener (`:406`) → `next()` (`:804`). `repeatMode==='one'` loops in place; otherwise `next()` advances. **No structural change** beyond the repeat reduction.

**Repeat 2-state (off / repeat-one):** `repeatMode` is currently tri-state `'off'|'one'|'all'`. Drop `'all'` (redundant once the queue auto-generates):
- `cycleRepeat()` (`:858`): `off → one → off`.
- `next()` (`:810`): delete the `repeatMode==='all'` wrap branch (falls through to `ensureAhead()`).
- `restore()`/`persist()` narrow the type to `'off'|'one'`; migrate persisted `'all'` → `'off'` on load.
- `NowPlaying.svelte` transport (`:706`): drop the `Repeat` (all) icon branch.
- **Modify** `player.svelte.ts`, `NowPlaying.svelte`.

**New module? NO** — extension of `player.svelte.ts` + `fallback.ts`.

---

### 2. Auto-generated up-next + per-context sourcing

**Today:** `services/similar.ts` (`buildSimilarQueue`) + `services/picks.ts` (`buildDiversePicks`) exist and are already wired:
- Fresh user play → `regenerate(seed)` (`:785`) rebuilds the auto tail from `buildSimilarQueue`, preserving `manualUids`.
- Queue-near-exhaustion → `ensureAhead()` (`:510`) appends `buildDiversePicks(8)` within 2 of the end.
- `next()` at true end → `ensureAhead().then(advance)`.

**Integration verdict: EXTEND.** Auto-generation already works. v1.2 adds the **per-context sourcing setting** ("same list" vs "genre-generated", global default = generated).

**Does the player track playback-origin context today? NO.** `setQueue(tracks)` just replaces the queue; there is no record of WHERE it came from (liked / search / downloads / discovery). This is the gap.

- **NEW: `queueContext` state on Player** — `$state<{ source: 'liked'|'search'|'downloads'|'playlist'|'discovery'|'artist'|'album'|null; id?: string }>`. Set by `setQueue()` callers (each list page passes its context). Minimal origin tracking the setting needs. **Modify `player.svelte.ts`** + every `setQueue` call site.
- **NEW setting group** in `config/defaults.ts` — `UPNEXT_DEFAULTS = { mode: 'generated' as 'generated'|'same-list', perContext: {} as Partial<Record<QueueContextSource,'generated'|'same-list'>> }`. Global default `generated`; per-context overrides. Follows the exact `DEFAULTS` group pattern. **Modify `config/defaults.ts`** + add fields to `settings.svelte.ts`.
- **Wiring at exhaustion:** `ensureAhead()`/`regenerate()` branch on the effective mode for the current `queueContext`: `same-list` → append the remainder of the origin list; `generated` → today's `buildSimilarQueue`/`buildDiversePicks` path. **Modify `player.svelte.ts`.**
- **Search never silently appends by default** (a PROJECT.md decision) — covered because search's context maps to `generated` by global default.
- **"Remix" action** (TrackMenu) = seed a genre-generated queue from a track = `player.play(track, { fresh: true })` (already triggers `regenerate`). Trivial new menu item. **Modify `TrackMenu.svelte`.**

**New module? NO** — reuse `similar.ts`/`picks.ts`. Context→mode resolution is likely a method on the settings store.

---

### 3. Sleep timer

**Today:** does not exist. Cleanest as a small **NEW leaf store** that drives the existing player.

- **NEW: `src/lib/stores/sleep-timer.svelte.ts`** (runes singleton, leaf — imports nothing from player, stays acyclic). Holds `remainingMs`, `mode: 'off'|'duration'|'end-of-track'`, an interval/timeout, a reactive `remaining` readout.
- **Player hook:** one-way `store → player`. On expiry the timer invokes a registered callback `() => this.audio?.pause()`; for `end-of-track`, set a flag the `ended` listener checks BEFORE `next()` so it pauses instead of advancing. **Modify `player.svelte.ts`** to add `setOnSleep(cb)` registration + the `ended`-handler flag check.
- **Interaction with never-stop:** the sleep timer is the SANCTIONED stop (PROJECT.md: "never-stop guarantee except sleep timer / sudden offline"). The `ended`-handler `end-of-track` check must run BEFORE the auto-skip/next logic, and an intentional sleep stop must NOT trip the skip-loop guard.
- **UI placement:** in the reworked TrackMenu (industry durations 15/30/45/60 min + "end of track"). **Modify `TrackMenu.svelte`** + new store file.

**New module: YES** — `src/lib/stores/sleep-timer.svelte.ts`.

---

### 4. Menu modal instant-render (TrackMenu rework)

**Today:** `TrackMenu.svelte` ALREADY supports optimistic render — the `loading` prop (`:21`) renders 9 skeleton rows instantly while the parent resolves the stub; buttons swap in when `track` resolves. The home long-press path uses this.

**The known pitfall is explicitly documented** at `TrackMenu.svelte:139-155`: the open-overlay `$effect` deps on `open` ONLY, NOT `track`. When the long-press reassigns `track` (stub → resolved), depending on `track` would re-run the effect → cleanup fires `overlays.dismiss` (→ `history.back()`) and the body re-runs `overlays.open` (→ `pushState`) in the same flush → back+push churn that over-pops Back into the previous route. **This must be preserved exactly.**

**Integration verdict: EXTEND `TrackMenu.svelte` carefully.** v1.2 requirements:
- **2-row header** (title/artist, marquee) — replace the single `.menu-head` line with a 2-row layout; reuse `use:marquee`. The instant-render skeleton must produce the SAME header height so the menu doesn't jump.
- **Like at top-right beside close** — add a header-row like + close X. The X routes through the SAME `close()` → `onclose()` → host `$effect` cleanup dismiss path (do NOT call `overlays.dismiss` directly from the button).
- **Remix action** — feature 2 (`player.play(track,{fresh:true})`).
- **Sleep timer** — feature 3.
- **Long-press focus-state bug** — fix in `src/lib/actions/longpress.ts` and/or row CSS, not the menu structure.

**Optimistic render + background resolve WITHOUT re-triggering the bugs:** the existing pattern IS the template — keep `open` as the sole `$effect` dep, keep `untrack()` around `overlays.open/dismiss`, keep the single dismiss path. Any new sub-sheet (sleep-timer submenu) follows the existing `pickerOpen`/`detailTrack` `$effect` precedent (`:156`, `:162`): its own `untrack`ed open/dismiss effect with its own id.

**New module? NO** — modify `TrackMenu.svelte` + `actions/longpress.ts`.

---

### 5. Per-entity SEO / slugs + server-rendered OG meta on Cloudflare

**Today:** Routes are `/artist/[name]` and `/album/[name]`, both CLIENT-rendered components that fetch on mount. **No `+page.server.ts`, no `+page.ts`, no `prerender`/`ssr` flags anywhere.** OG meta is ONLY the static site-wide block in root `+layout.svelte` — social-card scrapers (which don't run JS) get the generic title/description for every entity. Real SEO gap.

**Biggest net-new architectural change in v1.2** — moving entity pages from client-only to SSR-with-load.

- **Adapter is `@sveltejs/adapter-cloudflare`** (`svelte.config.js`) — supports SSR via Cloudflare Pages/Workers. SSR per-route is available; the runtime is the edge, so a `+page.server.ts` `load` runs at the edge and must call the same `/api/*` proxies using the injected `event.fetch` (relative URL).
- **NEW: `+page.server.ts` for `/artist/[name]` and `/album/[name]`** returning minimal entity metadata (name, cover URL, description) so `<svelte:head>` renders real per-entity OG/Twitter tags server-side. The component reads `data` for the head and still does its richer client fetch. Keep `load` LIGHT (one cheap call) so edge SSR stays fast. **NEW** `src/routes/(app)/artist/[name]/+page.server.ts`, `.../album/[name]/+page.server.ts`. **Modify** both `+page.svelte` to render entity OG from `data`.
- **Short slugs:** params today carry the raw (often CJK, URL-encoded) name. **Lowest-risk (RECOMMENDED):** add a pure `slugify()` helper and accept BOTH slug and raw name (the `load` resolves either). A `/song/[token]` short link can reuse the existing `share.ts` base64url token (already implemented) with a prettier path. **AVOID** a slug→entity DB (no backend / local-first posture) — slugs must be derivable, not stored. **NEW** `src/lib/services/slug.ts`.
- **Per-page SEO on every page:** add `<svelte:head>` per route. Non-entity pages (search/library/settings) can use client `<svelte:head>` (JS-running crawlers see it); entity pages MUST be SSR for non-JS scrapers. **Modify** route `+page.svelte` heads.
- **`og:image` per entity:** point at the entity cover (artist/album via existing Deezer/iTunes resolvers) or a composed card; static `og.svg` is the fallback.

**New modules: YES** — two `+page.server.ts` + `slug.ts`. Most "new vs modified" surface and the deepest research need (edge SSR + `event.fetch` + scraper testing).

---

### 6. Offline (downloaded tracks playable offline + graceful online-data degradation)

**Today:**
- `blob-store.ts` (IndexedDB) stores downloaded audio blobs keyed by uid — **already integrated** into `player.play()`/`restore()`/`reresolveCurrent()`: a downloaded uid plays straight from the blob with NO network (offline-first commit `b9542ff`).
- `library.downloads` tracks which uids are downloaded.
- **NO service worker** → the APP SHELL is not cached → opening the PWA with no network fails to load at all, even though audio blobs are local. The real gap.

**Integration verdict: NET-NEW infra for the app shell; blob playback already done.**

- **App-shell caching:** add a service worker.
  - **SvelteKit native `src/service-worker.ts`** (no new dep, first-class on adapter-cloudflare) — precache the build manifest via `$service-worker` (`build`/`files`/`prerendered`), serve cached shell on offline navigation. RECOMMENDED — preserves the zero-extra-dep posture (no PWA plugin in package.json). **NEW** `src/service-worker.ts`.
  - Alternative `vite-plugin-pwa` (new dep, Workbox) — heavier; against the minimal-dep ethos. Prefer native.
- **Offline route guards:** an online-only route (artist/album/search) when offline should show a degraded "you're offline" state, not spin. **NEW** small leaf store `src/lib/stores/online.svelte.ts` (`navigator.onLine` + `online`/`offline` events). Pages read it to short-circuit fetches and render library/downloads instead.
- **Degradation pattern (PROJECT.md "simplest-possible"):** when offline, home/search degrade to local library + downloads only; entity fetches skipped with a friendly state. No offline request queue.
- **SW + media interaction:** the SW must NOT intercept audio CDN/blob requests or `/api/*` (dynamic). Scope the fetch handler to same-origin app-shell + static assets only — avoids breaking referrerpolicy/range-request audio behavior.

**New modules: YES** — `src/service-worker.ts`, `src/lib/stores/online.svelte.ts`. Needs deeper research (SW lifecycle on Cloudflare Pages, iOS Safari SW + PWA quirks, cache-versioning on deploy).

---

### 7. Cover pipeline (playing-track fallback + IntersectionObserver scroll-resolve)

**Today:** rich, mature pipeline:
- `cover-cache.ts` — localStorage name-keyed cache (track key + artist key, via `matchKey`).
- `cover-backfill.ts` — lazy, concurrency-capped (CAP=6) multi-tier resolver Deezer → iTunes → CN; writes the cache; `onResolved` callback for reactive re-render. Already called by the home page after first paint.
- `cover-art.ts` — CAA-by-mbid URL builder.
- NowPlaying already does Last.fm hi-res cover adoption (`maybeSwapCover`, `:272`) with preload-before-swap.

**Integration verdict: EXTEND.** Two v1.2 deltas:
- **Cover fallback for the PLAYING track:** when `player.current.cover` is null/broken AND no Last.fm art, call single-item `backfillCovers([{artist,title}])` and adopt the result. NowPlaying already has the swap machinery (`maybeSwapCover`/`effectiveCover`) — add a branch. Also surface the resolved cover to the Nowbar + MediaSession artwork (lock-screen art). **Modify `NowPlaying.svelte`**; likely expose `player.resolvedCover` `$state` so `Nowbar.svelte` + `media-session` artwork can read it (or reuse the queue-entry cover write-back).
- **Resolve-on-scroll-into-view:** today the home backfills a capped batch post-paint. v1.2 wants IntersectionObserver so only visible gradient tiles resolve (better for long lists). **NEW Svelte action** `src/lib/actions/coverInView.ts` (use:directive) — observes a tile, on intersect fires single-item `backfillCovers` (cache-first → instant on warm hit). Reuses `cover-cache`/`cover-backfill` entirely; only the trigger changes (batch → per-visible). **Modify** home/search/library list components to use it.

**New module: YES (small)** — `src/lib/actions/coverInView.ts`. Everything else extends existing cover services.

---

### 8. Lyrics (touch-suspension, end-spacer, CN translation pairing, bracket robustness)

**Today:** lyrics live entirely in `NowPlaying.svelte` (`:75-227`, `:760-788`) + `services/lrc.ts` (`parseLRC`, `splitParenLines`):
- **Touch-suspension state machine ALREADY EXISTS** (`:118-150`): `pressedPointers` Set, `windowPointerUp` capture-phase listener, `lyricsTouched`/`lyricsReleased`/`lyricsWheel`, 600ms grace resume. The `pointercancel`-during-scroll-takeover bug is already fixed (only true `pointerup` releases). v1.2 "touch/hold suspends auto-scroll" is LARGELY DONE — verify, possibly tune the grace window.
- **CN translation-line highlight ordering:** `activeIndexAndTime` (`:89`) + the `l.time === activeTime` render check (`:767`) already activate ALL lines sharing the active timestamp (recent fixes `bc21999`/`677a9eb` address exactly "translation line activated instead of original"). The v1.2 item is likely a remaining edge case — verify against the failing LRCs; fix in the `activeTime`/render logic or `splitParenLines` ordering (`lrc.ts:62`).
- **Bracket-hiding robustness:** `splitParenLines` (`lrc.ts:64`) matches `()` and `（）` only. v1.2 wants wider bracket support + "stop dropping original lines." Extend `parenRe` to `[]【】「」` etc.; ensure the stripped-empty guard (`:73`) never drops a line that is entirely a bracket clause. **Modify `lrc.ts`** (pure, unit-testable — `lrc.test.ts` exists).

**End-of-lyrics spacer (NEW, small):** so the last lines can center-scroll instead of pinning at the bottom. Add a trailing spacer after the lyric lines (~half the visible band tall); the existing scroll `$effect` (`:151-185`) then centers the final line. **Modify `NowPlaying.svelte`** (markup + CSS spacer).

**Integration verdict: EXTEND `NowPlaying.svelte` + `lrc.ts`.** No new module. Polish on recently-touched code — lowest architectural risk, highest fiddliness. Bracket logic grows in `lrc.ts` (pure, tested), not the component.

---

### 9. Settings (new settings via the defaults.ts pattern)

**Today:** `config/defaults.ts` is the single source of truth — grouped const objects (`GENERAL_/APPEARANCE_/TRANSLATION_/PLAYBACK_/HOME_DEFAULTS`), aggregated into `DEFAULTS`, consumed by `settings.svelte.ts` field initializers + reset methods. Adding a setting = add to the group const + reference it in the Settings class + it appears in reset automatically (documented at file top). Per-group settings UI pages exist under `(app)/settings/*`.

**Integration verdict: EXTEND `config/defaults.ts` + `settings.svelte.ts` + settings UI pages.** New v1.2 settings:
- **Per-section homepage density (rows-of-4 compact):** `HOME_DEFAULTS` has `homeDensity:'comfortable'`. v1.2 wants PER-SECTION → add `homeSectionDensity: {} as Partial<Record<HomeSectionId,HomeDensity>>`. Home renders rows-of-4 when a section's density is compact. **Modify `config/defaults.ts`, `settings.svelte.ts`, `(app)/+page.svelte`, `(app)/settings/home/+page.svelte`.**
- **Up-next sourcing per context:** new `UPNEXT_DEFAULTS` group (feature 2). **Modify `config/defaults.ts`, `settings.svelte.ts`** + a `(app)/settings/playback` field.
- **Text-size range 50-200% with contextual demo text:** today `APPEARANCE_DEFAULTS` has the `fontScale*` fields; `settings.svelte.ts` clamps to `FONT_SCALE_MIN=70 / MAX=160`. Widen to 50-200 → change the consts + slider UI; add the "example xxx" demo-text component to the appearance page. **Modify `settings.svelte.ts` (bounds), `(app)/settings/appearance/+page.svelte`.**
- **Accent setting verified wired:** `GENERAL_DEFAULTS.accent` exists; v1.2 is verify/bugfix (MEMORY flags a "dead-accent bug"). **Verify/modify** the accent CSS-var application path.

**New module? NO** — pure extension of the established defaults pattern.

---

## New vs modified — file ledger

| File | New / Modified | Feature(s) |
|------|----------------|------------|
| `src/lib/stores/player.svelte.ts` | **Modified** | 1 (skip-loop guard, auto-skip, offline short-circuit, repeat 2-state, queueContext), 2 (context-aware regen), 3 (sleep hook), 7 (resolvedCover) |
| `src/lib/services/fallback.ts` | Modified (minor) | 1 (offline-aware) |
| `src/lib/stores/sleep-timer.svelte.ts` | **NEW** (leaf store) | 3 |
| `src/lib/components/TrackMenu.svelte` | **Modified** | 2 (remix), 3 (sleep UI), 4 (2-row header, like+close, focus fix) |
| `src/lib/actions/longpress.ts` | Modified | 4 (focus-state bug) |
| `src/routes/(app)/artist/[name]/+page.server.ts` | **NEW** | 5 (SSR OG) |
| `src/routes/(app)/album/[name]/+page.server.ts` | **NEW** | 5 (SSR OG) |
| `src/lib/services/slug.ts` | **NEW** (pure) | 5 (short slugs) |
| `src/routes/(app)/{artist,album}/[name]/+page.svelte` | Modified | 5 (render OG from data) |
| `src/routes/(app)/*/+page.svelte` heads | Modified | 5 (per-page SEO) |
| `src/service-worker.ts` | **NEW** | 6 (app-shell cache) |
| `src/lib/stores/online.svelte.ts` | **NEW** (leaf) | 6 (offline guards) |
| `src/lib/actions/coverInView.ts` | **NEW** (small) | 7 (scroll-resolve) |
| `src/lib/components/NowPlaying.svelte` | **Modified** | 1 (repeat icon), 7 (playing-track cover fallback), 8 (end-spacer, verify touch-suspend, CN pairing) |
| `src/lib/services/lrc.ts` | **Modified** | 8 (wider brackets, no-drop) |
| `src/lib/services/similar.ts` / `picks.ts` | Reused as-is | 2 |
| `src/lib/services/cover-backfill.ts` / `cover-cache.ts` | Reused as-is | 7 |
| `src/lib/config/defaults.ts` | **Modified** | 2 (UPNEXT group), 9 (per-section density, text-size bounds) |
| `src/lib/stores/settings.svelte.ts` | **Modified** | 2, 9 (new fields, widened bounds) |
| `src/routes/(app)/settings/{home,appearance,playback}/+page.svelte` | Modified | 9 (UI) |
| `src/routes/(app)/+page.svelte` (home) | Modified | 7 (coverInView action), 9 (rows-of-4), homepage polish |
| List/search/library components | Modified | 7 (coverInView), search scoring/cover-fallback/autofocus |

---

## Data-flow changes

1. **`setQueue(tracks, context?)`** gains a context arg → `player.queueContext` → consumed by `ensureAhead`/`regenerate` to pick same-list vs generated. New write path: list pages → player.
2. **Sleep timer → player.pause()** via a one-way registered callback (store → player), plus an `end-of-track` flag the `ended` listener reads BEFORE `next()`.
3. **Skip-loop guard counter** added to the `error → runFallback → (exhaust) → next()` loop; reset on a successful playback start.
4. **Online state** (`online.svelte.ts`) read by online-only routes to short-circuit fetches; read by the player to short-circuit fallback thrash.
5. **Entity SSR load** (`+page.server.ts`) → `data` → `<svelte:head>` OG tags (NEW server→head flow; today head is layout-static only).
6. **IntersectionObserver action → single-item backfillCovers → cover-cache → reactive cover** (per-tile trigger replaces the home's post-paint batch for long lists; the batch can remain for above-the-fold).
7. **Service worker** sits in front of app-shell/static requests only; explicitly passes through audio + `/api/*`.

---

## Anti-patterns to avoid (codebase-specific)

- **Adding `track` (or any churn-prone value) to an overlay `$effect` dep** — re-runs cleanup+open and over-pops Back. Keep `open` as the sole dep; `untrack()` the overlay calls.
- **Calling `overlays.dismiss()` directly from a UI handler** — breaks the single-dismiss invariant. UI handlers flip local state; the `$effect` cleanup is the only dismiss site.
- **A second `<audio>` element for gapless** — violates the iOS single-element constraint; the existing URL-prefetch approach is the sanctioned design.
- **Async playback paths that don't snapshot `playGen`** — a superseded resolve clobbers the newer track. Every new async branch in the player must generation-guard.
- **Throwing from a service** — breaks the never-throws SSR-safe contract; return null and degrade.
- **Caching audio or `/api/*` in the service worker** — breaks range requests / dynamic proxying.
- **Persisting `repeatMode:'all'`** after the 2-state migration — narrow the type and migrate on load.

---

## Suggested build order (dependency-aware)

**Phase A — Playback resilience core (foundation; everything downstream relies on a stable player):**
1. Repeat 2-state reduction + `queueContext` field + skip-loop guard + offline short-circuit + auto-skip-on-exhaustion. All in `player.svelte.ts` (+ `NowPlaying` repeat icon, `fallback.ts` minor). Self-contained, high-value, unblocks #2/#3.

**Phase B — Up-next sourcing + settings plumbing:**
2. `UPNEXT_DEFAULTS` + settings fields + context-aware `ensureAhead`/`regenerate`; wire `setQueue(context)` at all call sites. Depends on Phase A's `queueContext`.
3. Other new settings (per-section density, text-size 50-200%, accent verify) — independent, batch here since they touch the same `defaults.ts`/settings surface.

**Phase C — Sleep timer (depends on a stable player + the menu rework target):**
4. `sleep-timer.svelte.ts` + player pause hook + `end-of-track` flag interaction with never-stop.

**Phase D — Menu modal rework (depends on sleep timer + remix from B):**
5. TrackMenu 2-row header, like+close, remix, sleep-timer UI, longpress focus fix. Respect the overlay/history pitfalls. Slot in sleep timer (C) + remix (B).

**Phase E — Cover pipeline polish (independent; low risk):**
6. Playing-track cover fallback in NowPlaying + Nowbar + MediaSession artwork; `coverInView` action for scroll-resolve. Reuses existing cover services.

**Phase F — Lyrics polish (independent; touches recently-changed code):**
7. `lrc.ts` wider brackets + no-drop; NowPlaying end-spacer; verify touch-suspension + CN pairing. Pure-logic changes are unit-testable first.

**Phase G — Offline app-shell (net-new infra; isolate to de-risk):**
8. `online.svelte.ts` + offline route guards + degradation states (no SW dependency — ship first).
9. `src/service-worker.ts` app-shell precache (deeper research). Build/deploy-sensitive — isolate so a SW bug can't block other phases.

**Phase H — SEO / slugs (net-new SSR; deepest research; ship near end):**
10. `slug.ts` + `+page.server.ts` for artist/album + per-page heads. Edge-SSR + social-scraper testing → highest research + deploy risk; sequence last so the resilient-playback core is already validated.

**Ordering rationale:** Phase A is the dependency root (queueContext, repeat, guards) for B and C. B's settings plumbing and remix feed D; C feeds D. E/F/G/H are largely independent of each other and can reorder by appetite, BUT G (service worker) and H (edge SSR) are the two with net-new infra + deploy risk + the deepest unknowns, so they go last and are isolated. F is low-risk polish on hot code — do after the structural player work settles to avoid merge churn.

---

## Research flags for phases

- **Phase G (offline / service worker):** HIGH — needs deeper research. SvelteKit `src/service-worker.ts` precache on adapter-cloudflare; iOS Safari PWA + SW background-audio quirks (a stated project constraint); cache-versioning/skipWaiting on deploy; scoping the fetch handler to avoid audio/`/api` interception.
- **Phase H (SEO / SSR):** HIGH — needs deeper research. `+page.server.ts` `load` at the Cloudflare edge calling `/api/*` via `event.fetch`; rendering per-entity OG for non-JS social scrapers; `og:image` strategy (entity cover vs composed card); slug derivation without a backend store.
- **Phases A–F:** LOW–MEDIUM — standard extensions of well-understood existing modules; main risks are the overlay/history pitfall (D) and `playGen` discipline (A), both fully documented in-code.

## Sources

- Direct reads (HIGH confidence): `src/lib/stores/player.svelte.ts`, `overlays.svelte.ts`, `library.svelte.ts`, `settings.svelte.ts`; `src/lib/services/{similar,blob-store,share,fallback,cover-cache,cover-backfill,cover-art,lrc,picks,discovery}.ts`; `src/lib/components/{TrackMenu,NowPlaying}.svelte`; `src/routes/+layout.svelte`, `(app)/+layout.svelte`, `(app)/artist/[name]/+page.svelte`, `(app)/album/[name]/+page.svelte`; `src/lib/config/defaults.ts`; `src/lib/sources/types.ts`; `svelte.config.js`, `vite.config.ts`, `package.json`, `src/app.html`; `.planning/PROJECT.md`.
- Recent git log (offline-first playback `b9542ff`; lyrics fixes `bc21999`/`677a9eb`/`a5c763f`/`e0a15d7`).
