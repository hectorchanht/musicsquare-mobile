# Pitfalls Research — v1.2 Resilient Playback & UX Polish

**Domain:** Adding never-stop playback (multi-source failover + auto-skip + gapless prefetch + auto-generated up-next), sleep timer, new touch gestures, a reworked optimistic menu modal, a service worker / offline pass, per-entity OG/SEO, and search-scoring changes to an existing SvelteKit (Svelte 5 runes) + Cloudflare Pages/Workers mobile music PWA. The system already has a singleton `<audio>` player store with cross-source fallback, generation-guarded prefetch, an IndexedDB blob store for downloads, a History-API overlay stack with documented invariants, transform-based marquee, slop-thresholded pointer-capture gestures, and 15-locale parity-enforced i18n.
**Researched:** 2026-06-10
**Confidence:** HIGH on the integration pitfalls (read against the live `player.svelte.ts`, `overlays.svelte.ts`, `fallback.ts`, `score-match.ts`, `dragClose.ts`, `NowPlaying.svelte`, `TrackMenu.svelte`); HIGH on iOS-autoplay-after-src-swap and background-tab timer throttling (verified vs WebKit/Chrome platform behavior); MEDIUM on Cloudflare-SW + OG-crawler specifics (current best-practice, not version-pinned).

> Companion to the v1.0 base `PITFALLS.md` (PWA/iOS/Worker platform pitfalls) and the v1.1 Last.fm `PITFALLS.md`. This file covers ONLY pitfalls that arise when ADDING the v1.2 features to the *existing* system — every entry references a concrete seam in the current code.
>
> **Phase legend (provisional — planner assigns final numbers):**
> **P-FAILOVER** = all-source retry → toast + auto-skip + loop-guard ·
> **P-PREFETCH** = gapless next-track prefetch ·
> **P-UPNEXT** = auto-generated up-next + per-context sourcing setting ·
> **P-SLEEP** = sleep timer ·
> **P-GESTURE** = cover swipe / sheet containment / lyrics touch-suspend ·
> **P-MENU** = optimistic menu modal rework ·
> **P-SW** = service worker / offline ·
> **P-SEO** = per-entity OG metadata + slugs ·
> **P-SEARCH** = search-scoring tune ·
> **P-RUNES** = cross-cutting Svelte-5-reactivity discipline.
> Every pitfall is tagged with the phase that **owns** prevention. The "how to avoid" is written against the actual functions in `src/lib/`.

---

## Critical Pitfalls

Mistakes that cause infinite loops, silent stops, broken Back navigation, or app-wide deploy breakage — the class that forces a hotfix or rewrite.

### Pitfall 1: Infinite auto-skip loop when all sources are down or the device is offline — P-FAILOVER

**What goes wrong:**
The "never-stop" policy chains failover → skip → auto-generate. Each layer can fail and hand off to the next, and the next can fail and re-enter the first. When every source is region-locked, every CDN URL is expired, or the device just went offline, the player burns through the entire queue at machine speed (resolve-fail → `next()` → resolve-fail → …), spamming toasts, hammering the proxies, and draining battery — never reaching a resting "can't play" state. `buildSimilarQueue` / `ensureAhead` will even *grow* the queue with more un-playable tracks, so the loop has no natural terminator.

**Why it happens:**
The current `play()` → `runFallback()` → `next()` chain has per-attempt generation guards (`playGen`) but **no global failure budget**. Each individual fallback correctly gives up after exhausting sources and surfaces `this.error`, but `next()` immediately advances to the *next* queue entry and starts a fresh `play()` with its own fresh fallback budget. There is no counter that says "we've auto-skipped N tracks in a row with zero successful plays — stop."

**Consequences:**
Toast storm, proxy rate-limiting / IP ban risk (sources have no SLA — see PROJECT.md), battery drain, queue polluted with dozens of generated-but-dead tracks, MediaSession state thrashing.

**Prevention (loop-guard — PROJECT.md "Key Decisions" already commits to this):**
- Add a **consecutive-failure counter** on the player. Increment on every auto-skip that did NOT result in a successful `play` (i.e. `audio` reached `playing`/`canplay`); reset to 0 the moment any track actually plays.
- When the counter crosses a small threshold (e.g. 3–5), **STOP**: pause, surface a single sticky "couldn't find anything playable — check your connection" state, and do NOT auto-advance again until a *user gesture* (tap play / tap a song). Do not regenerate or `ensureAhead` while in the stopped state.
- Gate the whole never-stop chain on `navigator.onLine === false` → go straight to the stopped state with an offline message; do not attempt any network resolve. (Downloaded-blob tracks still play — that branch already runs before the network resolve in `play()`.)
- Distinguish auto-advance (`ended`/error → `next()`) from a user-initiated `play()` so a manual tap always resets the counter and re-arms the chain.

**Warning signs:**
- Toasts flicker faster than once per second.
- Proxy returns 429 / the network panel shows a wall of failed `/api/*` calls.
- The queue length climbs while nothing plays.

**Phase to address:** **P-FAILOVER** (owns the counter + stopped state); **P-UPNEXT** must respect the stopped state (no regen while stopped).

---

### Pitfall 2: User manually skips *during* an in-flight failover — stale fallback clobbers the new track — P-FAILOVER

**What goes wrong:**
Track A fails → `runFallback(A)` starts searching other sources (several seconds of proxy round-trips). Mid-search the user taps "next" (or taps a different song). `runFallback`'s search resolves *after* the user's new track is already playing, and — if the guard is wrong — calls `play(swapForA)` which yanks the audio back to A's replacement, overwriting the user's choice. The user-felt bug is "I skipped and it jumped back to the old song."

**Why it happens:**
This is *already mitigated* in the live code (`runFallback` snapshots `playGen`, a 200ms watchdog aborts the `AbortController`, and a post-await `if (this.playGen !== gen) return` discards stale swaps). The pitfall is **regressing this** when adding auto-skip / prefetch: every new async path that can call `play()` MUST bump `playGen` (non-fallback paths) and every in-flight resolver MUST re-check it after each await. New code (e.g. a "skip" button wired to `next()`, or the sleep-timer end-of-track handler) that calls `play()` without going through the generation discipline reopens this race.

**Consequences:**
"Skip jumps back," double-playback (two `play()` in flight), prefetch writing a resolved track into a queue slot the user already moved (the prefetch stale-guard re-checks `current?.uid === seedUid` AND the slot uid — preserve both checks).

**Prevention:**
- Keep the invariant: **every user-initiated advance bumps `playGen`; every async continuation re-checks it after each `await`**. Auto-skip from the loop-guard path is a continuation of user intent only if it has NOT been superseded.
- The manual-skip handler must call the same `next()`/`play()` that bumps the generation — do not add a parallel "fast skip" path that skips the guard.
- New prefetch-on-skip must reuse the existing `prefetchController.abort()` + `prefetchingUid` dedupe; do not introduce a second in-flight resolver without an abort signal.

**Warning signs:**
- Tapping next quickly twice plays the first-next, not the second.
- A song the user explicitly skipped reappears as `current` a few seconds later.

**Phase to address:** **P-FAILOVER** (auto-skip) and **P-PREFETCH** (prefetch-on-advance) — both must thread `playGen` + `AbortSignal`.

---

### Pitfall 3: iOS Safari rejects `play()` after a programmatic `src` swap that wasn't inside a fresh user gesture — P-FAILOVER / P-PREFETCH

**What goes wrong:**
Failover and auto-skip both set `audio.src` to a *newly resolved* URL after several seconds of async proxy work, then call `audio.play()`. On iOS Safari the original user gesture has long expired by the time the resolve returns, so `play()` rejects — the song silently stops mid-session even though the previous track was playing. Safari 17.2.1+ specifically broke the "change `src` after `ended` then `play()`" sequence even when playback was already going. This is the single most likely "music stops on iPhone" failure for the never-stop feature.

**Why it happens:**
iOS treats a `src` change as a new media load that requires a (recent) user activation to autoplay. The async gap between gesture and `play()` (proxy resolve, fallback search, prefetch) loses the activation. The codebase already wraps every `audio.play()` in `.catch(() => {})` — which prevents an unhandled rejection but means the rejection is *silent*: the loop-guard counter and toast must treat a rejected `play()` as a non-success.

**Consequences:**
Music stops with no error on iOS while working on Android/desktop; the never-stop guarantee is broken precisely on the primary target platform (PROJECT.md: "Mobile browsers first (iOS Safari)").

**Prevention:**
- **Keep ONE long-lived `<audio>` element** (the codebase already does — `attach()` binds one element). Reusing the same element that the user already activated by tapping play is what lets subsequent programmatic `src` swaps keep autoplaying on iOS. Do NOT introduce a second `<audio>` for prefetch (see Pitfall 4) — a never-activated second element cannot autoplay on iOS.
- Treat a rejected `play()` as a **playback-failure signal**, not a no-op: route it into the same loop-guard counter (Pitfall 1) and, after the counter trips, surface a "tap play to resume" state rather than silently advancing forever.
- Prefer **resolving the URL while the previous track is still playing** (the existing `prefetchNext()` does this) so the `src` swap on advance is near-instant and lands inside the residual activation window, minimizing the gap.
- For end-of-track auto-advance (`ended` → `next()`), the gap is unavoidable on a cold queue entry; this is why prefetch matters and why the loop-guard must catch the iOS-reject case gracefully.

**Warning signs:**
- Works in desktop Chrome, "stops between songs" only on iPhone.
- `audio.play()` promise rejects with `NotAllowedError` in iOS logs.

**Phase to address:** **P-FAILOVER** (reject-as-failure into loop-guard) + **P-PREFETCH** (resolve-ahead to shrink the gap). **P-SLEEP** must also account for this on end-of-track resume.

---

### Pitfall 4: Gapless prefetch via a second `<audio>` element breaks iOS + desyncs MediaSession — P-PREFETCH

**What goes wrong:**
The instinctive "gapless" implementation is a double-buffer: a second `<audio>` element pre-buffers the next track's bytes, then you swap elements at the boundary. On iOS this fails three ways: (1) iOS limits concurrent audio elements and won't autoplay the never-activated second element (Pitfall 3); (2) the OS MediaSession metadata + lock-screen artwork is bound to *one* element's playback — swapping elements desyncs the now-playing card (wrong title/cover on the lock screen); (3) mobile-data waste from byte-warming a track the user may skip before it plays.

**Why it happens:**
"Gapless" gets conflated with "byte-level pre-buffering." For THIS app the user-felt latency on advance is the **per-source proxy resolve round-trip inside `ensureTrackDetails`**, not byte buffering — the audio URLs are direct CDN files the browser buffers fast once the URL is known. The existing `prefetchNext()` comment states this explicitly: it pre-*resolves* the next track (URL + lyrics) so the later `play()` hits a no-op resolve = instant start, with **no second `<audio>` element**.

**Consequences:**
iOS silent-stop on advance, lock-screen metadata showing the previous/next song, doubled mobile data, Object-URL/element leaks.

**Prevention:**
- **Do NOT add a second `<audio>`.** Keep the single-element model. "Gapless" here = pre-resolve the next URL (already implemented), not pre-buffer bytes.
- If true byte-warming is later desired, gate it behind a "prefetch on Wi-Fi only" check (`navigator.connection?.saveData` / `effectiveType`) so it never burns metered data, and accept it cannot help iOS autoplay.
- MediaSession metadata must be set from the track that is *actually* about to play on the single element (the existing `play()` sets `ms.metadata` right before `audio.src = …`), not from the prefetch target.
- Reuse the existing `prefetchController` abort + `prefetchingUid` dedupe so a skipped prefetch is cancelled, not left to complete and waste data.

**Warning signs:**
- Lock-screen shows the wrong song.
- iOS plays track N then goes silent; Android is fine.
- Data usage spikes on cellular.

**Phase to address:** **P-PREFETCH** (owns the single-element + resolve-ahead design); **P-RUNES** (the prefetch in-flight guards are plain fields, NOT `$state` — keep them non-reactive).

---

### Pitfall 5: Service worker caches `/api/*` responses (or stale shell) and silently breaks the live app — P-SW

**What goes wrong:**
Adding a service worker for offline is the highest-blast-radius v1.2 change because a SW persists across deploys and is hard to recover from on a user's device. Two specific failure modes:
1. **Caching `/api/*`** — the proxy responses contain *expiring* audio URLs and time-sensitive search/charts data. A cache-first SW serves a stale resolved URL → audio that 403s; or serves yesterday's charts. Worse, a cached failed/empty response gets pinned and the source looks permanently dead.
2. **Stale app shell** — a cache-first SW for the SvelteKit shell keeps serving the *old* JS/CSS after a Cloudflare Pages deploy. SvelteKit fingerprints assets and ships a `version` — if the SW caches `index.html`/the entry without honoring the new build manifest, users get a white screen on next deploy (old shell references hashed chunks that no longer exist) until they hard-clear the SW.

**Why it happens:**
Default "cache everything" SW recipes don't distinguish API from assets and don't wire SvelteKit's `$service-worker` build manifest / `version`. Cloudflare Pages adds its own edge caching on top, so a misconfigured SW + edge cache compound into "I deployed but nobody sees it."

**Consequences:**
App-wide breakage that survives a normal reload; expired-audio 403 storms feeding the failover loop (Pitfall 1); users stuck on an old build with no obvious recovery.

**Prevention:**
- **Never cache `/api/*`.** Explicitly bypass (network-only) any request whose path starts with `/api/`. The data layer already has TTL caches in memory (`ttl-cache.ts`) — that is the right layer for API caching, not the SW.
- Cache ONLY: the SvelteKit build assets from `$service-worker`'s `build` + `files` arrays, keyed by the injected `version`; on `activate`, **delete every cache whose key !== current version** so a deploy evicts the old shell.
- Use **stale-while-revalidate for the shell/assets, network-first (or network-only) for navigations and API** — never blind cache-first for HTML.
- The offline *audio* path does NOT need the SW to cache audio: downloaded tracks already play from IndexedDB blobs via `blobStore` + `URL.createObjectURL` in `player.svelte.ts`. Keep audio offline = IndexedDB, app-shell offline = SW. Do not try to make the SW cache CDN audio (cross-origin opaque responses + expiry make it a trap).
- Ship a kill-switch: a `skipWaiting()` + `clients.claim()` path and a way to unregister, so a bad SW can be remediated by the next deploy.

**Warning signs:**
- "I deployed but users see the old version."
- Audio 403s spike right after a deploy (cached expired URLs).
- DevTools → Application → Service Workers shows an old version "waiting" indefinitely.

**Phase to address:** **P-SW** (owns the cache strategy + version eviction + `/api/` bypass). Highest-risk phase of the milestone — flag for deeper plan-level review.

---

### Pitfall 6: Optimistic menu acting on an unresolved stub — like/download/share before `uid` exists — P-MENU

**What goes wrong:**
The reworked menu renders buttons *instantly* on a discovery STUB (the existing `TrackMenu` already does this: opens on a `{artist,title}` stub, then reassigns `track` to the resolved Track after `resolveStub`). If a button acts before resolution: **Like** writes a favorite with an empty/placeholder `uid` (library keyed by `uid` → orphaned entry, dedupe breaks, "liked" never reflects); **Download** has no `audioUrl` to fetch; **Share** encodes a token with a missing `uid`/`source` (the `share.ts` `decodeTrack` returns null → dead link); **Go to artist/album** navigates on a stub with no `songid`.

**Why it happens:**
The whole point of the rework is "buttons render instantly with background data resolve" — which means there is a real window where `track` is the stub, not the resolved Track. The current code gates the *menu actions* implicitly by having a `loading` prop, but the rework adds more actions (remix, sleep-timer seed) that each need the same gate.

**Consequences:**
Orphaned/duplicate library entries keyed by a bad uid; dead share links; downloads that silently no-op; "go to artist" landing nowhere; identity confusion if two different taps resolve to the same uid (dedupe/`manualUids` set keyed by uid gets polluted).

**Prevention:**
- **Render buttons enabled-looking but route every action through a "resolve-then-act" guard.** If the action is invoked while still a stub, either (a) await the in-flight resolve then act on the resolved Track, or (b) disable destructive/identity actions (Like/Download/Share/Add-to-Queue) until `track.detailsLoaded && track.uid` and show the skeleton state for those rows specifically.
- The **identity key is `uid`** — never let a library/queue/`manualUids` write happen with a falsy or stub uid. Mirror the existing `playStub` discipline (it locks identity into `pendingTrack` but only does real writes after `resolveStub` returns a real Track with a uid).
- **Remix** (seed a genre-generated queue from a track) must seed from the *resolved* Track (it feeds `buildSimilarQueue` which reads `track.artist`/`uid`); seeding from a stub gives a worse similar-set or a self-excluding empty queue.
- Share-token generation must assert `uid && source` before producing a URL (matches `decodeTrack`'s own guard).

**Warning signs:**
- A liked song doesn't show as liked / shows twice.
- A shared link opens to nothing.
- Download button "does nothing" on a just-opened menu.

**Phase to address:** **P-MENU** (owns the resolve-then-act guard on every new action).

---

### Pitfall 7: New cover-swipe gesture collides with the existing sheet swipe-down + marquee horizontal scroll; pointer-capture-on-pointerdown breaks child taps — P-GESTURE

**What goes wrong:**
v1.2 adds **horizontal cover swipe = prev/next** on the now-playing cover. That cover lives inside `.np-top`, which already owns a **vertical swipe-down-to-collapse** gesture (`npTopDown/Move/Up`), and the title/artist use `use:marquee` with `touch-action: pan-x`. Three collisions: (1) a diagonal drag is ambiguous — does it collapse the sheet or change track? (2) `.np-top` has `touch-action: pan-x`, which the OS reads as "horizontal is for panning," fighting a horizontal swipe handler; (3) the documented project pitfall — **calling `setPointerCapture` on `pointerdown` retargets the trailing click to the captured node**, so a *tap* on the cover (which should expand subnav / play-pause) stops firing, and child buttons under the cover go dead.

**Why it happens:**
The existing gestures use a carefully tuned **slop-threshold capture**: `pointerdown` only records start position (no capture, no `dragging`, no `preventDefault`); capture happens in `pointermove` only after the gesture exceeds the slop AND the dominant axis is decided (`dy > SLOP && |dy| > |dx|` for the sheet; `dragClose` captures only after `dy > DRAG_START`). A naive cover-swipe handler that captures on `pointerdown`, or that doesn't arbitrate axis against the parent's vertical gesture, breaks all of this.

**Consequences:**
Taps on the cover stop working (the exact "menu actions did nothing" bug `dragClose` already warns about), the sheet collapses when the user meant to change track (or vice-versa), marquee horizontal scroll fights the swipe, and on iOS the browser's own pan claims the gesture (`pointercancel` mid-drag — `NowPlaying`'s lyrics code already handles this lost-pointer case).

**Prevention:**
- **Reuse the slop-threshold idiom verbatim:** on `pointerdown` only record start X/Y; in `pointermove` decide the axis once movement exceeds slop; **horizontal-dominant → cover swipe (capture here), vertical-dominant → let the parent `.np-top` collapse gesture win** (or vice-versa per design). Never `setPointerCapture` on `pointerdown`.
- The cover-swipe handler and the parent collapse handler must agree on a **single axis arbiter** so they don't both claim the gesture. Easiest: the cover handler claims horizontal and `stopPropagation`s only after it has committed to horizontal; otherwise it stays passive and the parent's vertical machine runs.
- Set `touch-action: pan-y` (or `none`) on the cover-swipe surface so the browser doesn't pre-empt horizontal panning — but verify it doesn't disable the parent's vertical collapse; scope `touch-action` to the exact element.
- Preserve the tap contract: a movement below slop (`< 8px`) must reach the cover's `onclick` (tap cover closes subnav per the v1.2 spec).
- **Lyrics touch-suspend** (already implemented via `lyricsTouched` + a window-level capture-phase `pointerup` and a `pointercancel`-during-scroll-takeover guard) — when adding swipe, do NOT let the new handler swallow the `pointercancel` the lyrics auto-scroll relies on; keep gesture handlers scoped to their own subtrees.

**Warning signs:**
- Tapping the cover does nothing (capture-on-pointerdown regression).
- Diagonal swipes randomly collapse the sheet or skip tracks.
- Marquee titles jitter when swiping.

**Phase to address:** **P-GESTURE** (owns axis arbitration + slop-threshold reuse + tap preservation).

---

## Moderate Pitfalls

Real bugs that degrade UX or correctness but don't brick the app or force a rewrite.

### Pitfall 8: Auto-generated up-next repeats the same songs / recommendation loop — P-UPNEXT

**What goes wrong:**
`buildSimilarQueue` seeds from `artist.getSimilar` then searches *each similar artist's top track* (`searchAll(name, 1)` → `interleaved[0]`). Because it always takes the **#1 result per artist**, the generated queue is highly deterministic: the same ~8 similar artists' same top songs recur every regeneration, and when the no-key fallback kicks in it's *same-artist* search (even less variety). Over a long session the up-next feels like a 8–20 song loop. `buildDiversePicks` (the `ensureAhead` grower) samples from a fixed 20-artist `ARTIST_POOL` and also takes top-1 — same staleness.

**Why it happens:**
Top-1-per-artist + a small fixed seed set + 6h TTL cache on similar artists = low entropy. The `exclude` set prevents *immediate* dupes within one queue but not cross-regeneration repetition.

**Consequences:**
"It keeps playing the same songs"; the never-stop feature feels robotic.

**Prevention:**
- Pull more than the top result per artist (e.g. top 2–3) and randomly pick among them, or rotate the offset, so the same artist contributes different songs across regenerations.
- Track a **recently-served-uids ring buffer** (session-scoped) and add it to the `exclude` set passed to `buildSimilarQueue` / `buildDiversePicks` so regeneration avoids the last N played, not just what's currently in the queue.
- Widen `ARTIST_POOL` or seed the diverse-picks grower from the user's actual history/likes when available.
- Keep the 6h similar-artist TTL (artist sets ARE stable) but do NOT cache the *song selection* — re-pick songs each time.

**Warning signs:** the same 10 songs cycle within an hour. **Phase:** **P-UPNEXT**.

---

### Pitfall 9: Queue mutation races between auto-grow/regenerate and user edits (reorder / add / remove) — P-UPNEXT / P-RUNES

**What goes wrong:**
`ensureAhead`, `regenerate`, and `prefetchNext` all mutate `this.queue` asynchronously. A user reorder (`reorderQueue`) or `addToQueue`/`playNext` can land *between* the async build and the `this.queue = dedupeBest([...])` write-back, so the rebuild clobbers the user's edit, or `dedupeBest` reorders/drops a manually-pinned track. The code already protects this partially: `manualUids` survives regeneration (`regenerate` filters manual entries and re-prepends them), and the `growing` flag guards `ensureAhead` re-entry. The pitfall is **adding new mutation sites** (remix, per-context sourcing swap, "play this list now") that don't honor `manualUids` or that write a whole-array replacement over an interleaved user edit.

**Why it happens:**
Multiple async producers writing the same `$state` array with no single serialization point. `dedupeBest` returning a fresh array means the *last writer wins* — and the last writer might be a stale async build.

**Consequences:**
A track the user dragged to "next" jumps back; a removed track reappears; pinned manual entries vanish on regen.

**Prevention:**
- Every async queue rebuild must **re-read `this.queue` at write-time** (not close over a stale snapshot) and re-merge `manualUids` — exactly what `regenerate` does; replicate for remix + any new builder.
- New "play this list / switch up-next source" actions must go through one method that respects `manualUids` and the current-track pin, not assign `this.queue` directly.
- Keep the `growing` re-entry guard pattern for any new async grower.

**Warning signs:** dragged/added tracks revert; removed tracks come back. **Phase:** **P-UPNEXT** (mutation discipline), **P-RUNES** (single write path).

---

### Pitfall 10: Sleep timer drifts or never fires in a backgrounded tab; wake-lock + end-of-track interaction — P-SLEEP

**What goes wrong:**
A sleep timer built on `setTimeout`/`setInterval` is **heavily throttled when the tab is backgrounded** (Chrome clamps chained timers toward ~1/minute since Chrome 88; all browsers throttle hidden tabs) — exactly the state during phone-in-pocket music listening. A 30-minute timer can fire minutes late or, combined with countdown UI, drift visibly. Separately, the two sleep-timer modes (hard-stop at duration vs **end-of-track**) interact with playback: end-of-track must NOT fight the never-stop auto-advance (Pitfall 1) — the timer has to *suppress* the next `next()` exactly once. And the app has **no wake-lock today** (verified: no `wakeLock` usage) — if one is added for keeping the screen/playback alive, releasing it must coordinate with the sleep timer firing.

**Why it happens:**
`Date.now()` deltas are accurate but the *callback* that checks them is throttled; relying on `setInterval` tick count for the deadline drifts. Audio playback keeps the page from being fully frozen, but timers are still throttled.

**Consequences:**
"Sleep timer didn't stop my music" (fired late or skipped), countdown UI freezes, end-of-track mode stops mid-next-track or doesn't stop at all.

**Prevention:**
- Compute the deadline as an **absolute timestamp** (`Date.now() + ms`) and on each (possibly-throttled) tick check `Date.now() >= deadline` rather than counting ticks — late ticks then still stop promptly, just slightly late.
- For tighter accuracy in background, consider a Web Worker timer (Workers aren't main-thread-throttled) — but a stop a few seconds late is usually acceptable for a sleep timer; weigh complexity.
- **End-of-track mode:** set a one-shot flag the `ended` handler checks *before* calling `next()` — on a true end-of-track stop, pause and clear instead of advancing. Make sure repeat-one (`repeatMode === 'one'`, handled first in the `ended` listener) and the sleep flag don't both fire.
- On hard-stop: pause + (if added) release the wake lock; clear any prefetch/grow timers.
- Persist nothing about the timer (don't restore a stale countdown after reload).

**Warning signs:** music continues past the timer; countdown stalls in background. **Phase:** **P-SLEEP**.

---

### Pitfall 11: Per-entity OG metadata on a Cloudflare SPA shell — crawlers see empty meta; CJK slug + encodeURIComponent traps — P-SEO

**What goes wrong:**
The app currently sets OG/meta **client-side via `svelte:head`** (verified: no `+page.server.ts`, only client heads). Social-card crawlers (and many link unfurlers) do NOT run client JS — they read the initial HTML. So per-song/album/artist OG tags injected at runtime are invisible to the crawler; every share shows the generic shell title/image. Slug pitfalls compound it: CJK artist/track names (周杰伦, 稻香) in a URL slug must be `encodeURIComponent`-encoded or the route breaks; double-encoding (encoding an already-encoded slug) yields `%25E5...` and a 404; and using the raw share token (`share.ts` base64url) as the OG-bearing URL means no human-readable slug at all.

**Why it happens:**
SvelteKit SPA-style rendering on `adapter-cloudflare` serves a static shell; OG needs the meta in the *server-rendered* response. Crawlers don't execute the runtime `svelte:head` update.

**Consequences:**
Shared links show generic/blank cards (bad for the v1.2 sharing/SEO goal); broken routes on CJK slugs; redirect chains (token → canonical slug → page) hurt crawler success + SEO.

**Prevention:**
- Render per-entity OG tags **server-side** for the shareable routes — either a `+page.server.ts`/`load` that returns the entity metadata and a `<svelte:head>` populated from `data` (SSR'd into the initial HTML), or a Cloudflare Worker/function that injects OG tags for crawler user-agents. `adapter-cloudflare` supports prerender/SSR per route — make share routes SSR, not pure SPA.
- **Slugs:** `encodeURIComponent` once when building, decode once when reading; never feed an already-encoded value back through `encodeURIComponent`. Keep a stable canonical id (uid/source) in the path and treat the human slug as decorative (`/song/{slug}-{id}`) so a mangled slug still resolves by id.
- Avoid redirect chains: resolve directly to the canonical URL; don't bounce token → slug → canonical.
- The existing `share.ts` `/?play=<token>` link is fine for *playback* restore, but the *OG/SEO* URL should be a clean per-entity route, not the opaque token.

**Warning signs:** shared links show the generic site card; CJK URLs 404; Facebook/Twitter debugger shows empty OG. **Phase:** **P-SEO** (owns SSR-OG + slug scheme). Flag for deeper review — this changes the rendering mode for some routes.

---

### Pitfall 12: Search-scoring tune over-penalizes legit long CJK titles and applies false 試聽 (preview) penalties from missing duration data — P-SEARCH

**What goes wrong:**
v1.2 adds short-title boost + artist-frequency boost + a **heavy <60s 試聽 (trial/preview) penalty**. Two traps: (1) a "short-title boost" penalizes legitimately long CJK full titles — many real Chinese songs have parenthetical version markers (e.g. `稻香 (Live版)`, `告白气球 (电影主题曲)`) that are the *correct* song, and over-boosting short titles demotes them below truncated/wrong variants. (2) The <60s preview penalty depends on **per-source duration data that not all sources return** — `kuwo`/`joox`/`qq` adapters may give no duration on the search stub, so "duration missing" gets treated as "short → preview → penalize," wrongly burying full tracks from sources that just don't report duration.

**Why it happens:**
The current `score-match.ts` is a *re-ranking* term (never thresholds, never drops — D-03) that already handles variant keywords carefully (word-boundary for latin, substring for CJK, paired-keyword dedup, title-only scan). Adding duration/length-based terms without the same care reintroduces the exact false-positive class the variant logic was tuned to avoid.

**Consequences:**
Wrong-song resolution (a 30s preview or a cover ranks above the real track), or — worse — the real track from a no-duration source vanishes from results.

**Prevention:**
- **"Missing duration" must be neutral, never penalized.** Only apply the <60s penalty when duration is present AND finite AND < threshold. Verify which adapters actually return duration before relying on it (per PROJECT.md, sources are inconsistent third-party proxies).
- Make the short-title boost a *gentle* re-rank, not a dominant term — keep the existing balance where the similarity reward (`SIM_EXACT=10`) out-weighs a single penalty (`VARIANT_WEIGHT=4`); a length term should be the same magnitude as a single variant hit, not larger.
- Treat a parenthetical version marker as part of title normalization (the variant logic already only penalizes *un-asked-for* variants via the query-title check) — don't let a separate "short title is better" term undo that.
- Keep scoring **re-ranking only, never a threshold/drop** (preserve the D-03 invariant) so even a penalized track stays in the list.
- Add CJK fixtures with parenthetical full titles to `score-match.test.ts` asserting they out-rank truncated variants.

**Warning signs:** searching a known song returns a 30s clip or cover first; a source's results disappear after the scoring change. **Phase:** **P-SEARCH**.

---

### Pitfall 13: Object-URL leaks from blob playback across long offline sessions — P-SW / P-PREFETCH

**What goes wrong:**
Offline downloaded-track playback creates `URL.createObjectURL(blob)` for each play. The code already revokes the previous `cachedBlobUrl` on each new play (`play()`, `restore()`, `reresolveCurrent()` all revoke-then-create). The pitfall is **new code paths** (prefetch-from-blob, remix-from-downloads, a queue of offline tracks) that create object URLs without revoking — over a long offline session this leaks memory until the tab is killed, and on iOS (tight memory limits) that crashes the tab mid-listen.

**Why it happens:**
Each `createObjectURL` pins the blob in memory until `revokeObjectURL`. Adding more blob-playback entry points multiplies the create sites; missing one revoke leaks.

**Consequences:** memory growth, iOS tab crash on long offline playback, especially with large lossless blobs.

**Prevention:**
- **Centralize blob-URL lifecycle:** keep the single `cachedBlobUrl` field as the only live object URL; any new blob-play path must revoke the prior one first (mirror the existing three call sites). If prefetch-from-blob is added, track its URL separately and revoke on supersede (like `prefetchController`).
- Never create an object URL you don't store + later revoke.
- Prefer streaming the blob via the single `<audio>` element (current approach) over holding multiple object URLs.

**Warning signs:** memory climbs during offline playback; iOS reloads the tab after several offline songs. **Phase:** **P-SW** (offline playback) / **P-PREFETCH** (if prefetch touches blobs).

---

## Minor Pitfalls

Smaller correctness/polish issues, cheap to prevent if known up front.

### Pitfall 14: New translation keys break 15-locale parity — P-MENU / P-SLEEP / P-SEARCH (any UI-string phase)

**What goes wrong:** Every new UI string (sleep-timer durations, remix label, "couldn't find anything playable," skeleton aria-labels, OG titles, text-size demo text) needs a key in **all 15 locales** — the `Dict` enforces parity, so a missing key is a build/type error or a visible fallback. Adding strings ad-hoc across phases causes churn and untranslated leaks.

**Prevention:** Batch all v1.2 strings per phase; add the key to every locale at once (even if machine-translated/English-placeholder) to satisfy parity; prefer reusing existing keys (toast/error strings already exist). Sleep-timer durations should be **numeric + a unit key**, not 6 separate hardcoded strings. **Phase:** owned by whichever phase introduces the string; **P-RUNES**-adjacent discipline.

---

### Pitfall 15: `$effect` over-dependency churns the overlay history stack — P-MENU / P-GESTURE

**What goes wrong:** The documented overlay invariant requires the registration `$effect` to **depend on `open` ONLY** and wrap `overlays.open/dismiss` in `untrack` (see `TrackMenu.svelte` lines 140–165). The menu rework reassigns `track` (stub → resolved); if a new overlay/effect depends on `track` (or any field that changes during resolve), the effect re-runs → `dismiss` (history.back) + `open` (pushState) in one flush → **history depth desyncs → Back gets stuck or double-closes** (the exact failure the overlay module is built to prevent). Same risk for any new sheet (remix picker, sleep-timer sheet) added in the menu rework.

**Prevention:** Copy the existing pattern exactly: effect deps = the boolean `open`/`xOpen` flag only; `untrack` the `overlays.open/dismiss` calls; gate *visibility* with `{#if open && track}`, not the effect. One dismiss path (host `$effect` cleanup is the only `dismiss` caller). For outbound nav from a new menu action, use `overlays.navigateAway()` (do not `onclose()`-then-`goto()`). **Phase:** **P-MENU** (new sheets), **P-GESTURE** (cover-collapse dismiss).

---

### Pitfall 16: `goto()` from a menu action races the overlay `history.back()` — P-MENU

**What goes wrong:** "Go to artist/album" (and new "remix → navigate") from inside an overlay must run `goto()` while the overlay is still open, with the per-overlay `dismiss()` `history.back()` suppressed — otherwise the back() pops the just-pushed destination ("Go to artist flashes then snaps home"). This is **already solved** by `overlays.navigateAway()`; the pitfall is a new action calling `onclose()` then `goto()` directly and reopening the race.

**Prevention:** Every outbound nav from an overlay goes through `overlays.navigateAway(() => goto(dest))`. Never close-then-navigate. **Phase:** **P-MENU**.

---

### Pitfall 17: Marquee re-trigger / measurement on dynamic 2-row header — P-MENU

**What goes wrong:** The reworked menu has a **2-row marquee header** (title/artist). Marquee measures overflow against a parent that must be locked `flex`/`min-width:0`/`max-width` (per MEMORY: long text uses `use:marquee` + `marquee-inner`, parent locked, never static ellipsis). On a stub→resolved swap the text content changes, so the marquee must **re-measure** when the bound text changes; a marquee that measures once on mount shows a clipped or non-scrolling long title after the resolve updates it. Also skeleton placeholders must match the loaded text length/shape (MEMORY rule).

**Prevention:** Ensure the marquee action re-runs measurement on text change (reactive update), keep the parent constraints (`min-width:0`, locked flex), use `marquee-inner` span, and shape skeletons to the real 2-row layout. **Phase:** **P-MENU**.

---

### Pitfall 18: Overscroll chaining + scroll containment through layered sheets (half-open) — P-GESTURE

**What goes wrong:** v1.2 adds "half-open sheet scroll containment." When the inner panel (lyrics / up-next list) is scrolled to its top/bottom, the scroll **chains** to the parent sheet / page behind it, dragging the sheet or scrolling the route underneath — janky on iOS especially. Layered sheets (menu over now-playing over page) compound it.

**Prevention:** Set `overscroll-behavior: contain` on the inner scrollers; ensure the sheet's drag-to-collapse only arms at the scroll-top boundary (don't start a collapse drag while the panel can still scroll up). The lyrics scroller already manually scrolls a bounded `.panel` container (not ancestor-walking) — keep that discipline. **Phase:** **P-GESTURE**.

---

### Pitfall 19: Cover/resolve-on-scroll-into-view name-keyed cache identity collisions — P-MENU / (cover phase)

**What goes wrong:** The cover fallback resolver uses a **name-keyed cache** (resolve-on-scroll-into-view). Different songs with the same title (or same title+artist across releases) collide on the name key → wrong cover shown. Also resolving covers on scroll can fire many concurrent requests as the user flings a long list.

**Prevention:** Key the cover cache by the most specific stable identity available (prefer `uid`; fall back to normalized `artist|title` only when no uid), debounce/cancel on fast scroll (IntersectionObserver + abort on scroll-out), and reuse the existing cover-backfill chain (`cover-backfill.ts`: Deezer → iTunes → CN). **Phase:** cover phase (likely folded into **P-MENU**/polish).

---

### Pitfall 20: Double-click / double-action guard interacts with optimistic + dedupe — P-MENU / polish

**What goes wrong:** v1.2 adds "button toast + double-click guard." A double-tap on play/like/download must not stack two resolves or two library writes. The player already dedupes (`playStub` no-ops a same-key re-tap in flight; `addToQueue`/`playNext` filter by uid), but new buttons (remix, sleep-timer set, share) need the same guard or they fire twice (two toasts, two queue seeds).

**Prevention:** Reuse the in-flight dedupe idiom (a pending key / disabled-while-busy state) for every new action; the toast-on-tap should reflect the deduped single action. **Phase:** polish / **P-MENU**.

---

## Phase-Specific Warnings (summary table)

| Phase Topic | Likely Pitfall(s) | Mitigation (one-liner) |
|-------------|-------------------|------------------------|
| **P-FAILOVER** (auto-skip + loop-guard) | #1 infinite skip loop; #2 manual-skip race; #3 iOS reject-as-failure | Consecutive-failure counter + stopped state; thread `playGen` on every advance; treat `play()` rejection as failure into the counter |
| **P-PREFETCH** (gapless) | #4 second-`<audio>`/MediaSession desync; #3 iOS gap; #13 blob-URL leak | Single element + resolve-ahead only (no byte-buffer); set MediaSession from the actual next track; revoke prior object URL |
| **P-UPNEXT** (auto-generate + sourcing) | #8 recommendation loop; #9 queue mutation race | Recently-played ring buffer in `exclude` + pick beyond top-1; single write path honoring `manualUids` |
| **P-SLEEP** (timer) | #10 background throttle drift + end-of-track vs auto-advance | Absolute-timestamp deadline; one-shot end-of-track flag the `ended` handler checks before `next()` |
| **P-GESTURE** (cover swipe / containment / lyrics) | #7 swipe vs collapse vs marquee + capture-on-pointerdown; #18 overscroll chaining | Reuse slop-threshold capture, axis arbiter, never capture on pointerdown; `overscroll-behavior: contain` |
| **P-MENU** (optimistic rework) | #6 act-on-stub identity; #15 `$effect` over-dep; #16 goto race; #17 marquee re-measure; #20 double-action | Resolve-then-act guard keyed by uid; effect deps `open` only + `untrack`; `navigateAway()`; re-measure marquee; dedupe actions |
| **P-SW** (service worker / offline) | #5 `/api/` + stale-shell caching; #13 blob leak offline | Never cache `/api/`; version-keyed shell cache + activate-evict; audio offline = IndexedDB not SW |
| **P-SEO** (OG / slugs) | #11 client-only OG invisible to crawlers + CJK slug encode | SSR OG for share routes; encode-once, canonical id in path, no redirect chains |
| **P-SEARCH** (scoring) | #12 over-penalize long CJK titles + false 試聽 penalty on missing duration | Missing duration = neutral; gentle length term; keep re-rank-only (no threshold); CJK parenthetical fixtures |
| **P-RUNES** (cross-cutting) | #4/#9 reactivity: keep in-flight guards plain (not `$state`); single queue write path; #14 i18n parity | Mirror existing plain-field guards (`playGen`, `prefetchingUid`, `manualUids`); batch locale keys |

---

## Security / Data-Integrity Notes (at JOOX_TOKEN parity)

- **Offline blob store integrity:** downloaded blobs are keyed by `uid` in IndexedDB. The optimistic-menu act-on-stub bug (#6) could write a blob under a bad/placeholder uid → orphaned storage that never plays and never evicts. Gate `blobStore.put` on a resolved uid.
- **Share token:** `share.ts` encodes only a non-sensitive stub (no audio URL — re-resolved on open), which is correct; keep audio URLs out of share links (they expire and could leak referer-gated CDN signatures). Do not add `audioUrl` to the token for "faster" sharing.
- **No new secrets client-side:** the SW, OG, and prefetch work are all client/edge-data only; do not let the SW or any new `+page.ts` import server-only env (mirrors the v1.1 T-lfm-01 / JOOX_TOKEN discipline).

## Sources

- iOS Safari autoplay + `src`-swap gesture loss / Safari 17.2.1 play-after-ended regression — WebKit "New `<video>` Policies for iOS" (webkit.org/blog/6784), Apple Developer audio/video basics, MDN Autoplay guide. (HIGH — matches the existing `.catch(() => {})` discipline in `player.svelte.ts`.)
- Background-tab timer throttling (Chrome 88 chained-timer clamping ~1/min; hidden-tab throttling; Web Worker timers unthrottled) — Chrome for Developers "Timer throttling in Chrome 88," MDN, Mozilla bug 652472. (HIGH.)
- Service-worker caching strategy for SvelteKit (`$service-worker` build/files/version, activate-evict, never cache API, SWR for shell) + `adapter-cloudflare` SSR-per-route — SvelteKit service-worker + adapter docs (current best practice). (MEDIUM — not version-pinned.)
- Internal code seams (HIGH — read directly): `src/lib/stores/player.svelte.ts` (failover `playGen` guard, `prefetchNext`, `ensureAhead`/`regenerate`, blob-URL revoke, `ended` repeat-one), `src/lib/stores/overlays.svelte.ts` (history-depth invariant, `navigateAway`, `popping`), `src/lib/services/fallback.ts` (per-source abort), `src/lib/services/picks.ts` + `similar.ts` (top-1-per-artist generation), `src/lib/services/score-match.ts` (re-rank-only, variant logic), `src/lib/services/share.ts` (stub token), `src/lib/actions/dragClose.ts` (capture-after-slop, tap-preserving), `src/lib/components/NowPlaying.svelte` (slop-threshold collapse + lyrics touch-suspend), `src/lib/components/TrackMenu.svelte` (optimistic stub render + `$effect` deps `open` only).
- Project constraints — `.planning/PROJECT.md` (never-stop + loop-guard decision, MediaSession fixed action set, mobile-first iOS, no-SLA proxies), `MEMORY.md` (marquee + skeleton rules).
