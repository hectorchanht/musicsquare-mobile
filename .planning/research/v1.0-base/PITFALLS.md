# Pitfalls Research

**Domain:** Mobile-first PWA music player (SvelteKit + Cloudflare Worker proxy, unofficial third-party audio sources)
**Researched:** 2026-06-05
**Confidence:** HIGH for iOS/PWA/Worker platform realities (WebKit bugs, Cloudflare docs, service-worker range-request behavior — verified against official sources); MEDIUM for unofficial-API drift specifics (inferred from this codebase's own evidence + general patterns)

> Scope note: this file deliberately ignores generic web pitfalls (XSS basics, "write tests") and concentrates on the five high-risk, domain-specific trap clusters for *this* project: (1) iOS Safari audio/background reality, (2) PWA/service-worker + streamed audio, (3) Cloudflare Worker proxy for audio, (4) unofficial-API reliability, (5) SvelteKit-on-Cloudflare for a stateful player. The single global audio element and persistent now-playing state are the spine everything hangs off — most pitfalls below trace back to it.

---

## Critical Pitfalls

### Pitfall 1: Assuming iOS PWA background audio is broken — OR assuming it "just works"

**What goes wrong:**
Two opposite mistakes, both costly. (a) The team reads old (pre-2022) advice that "audio stops when an installed PWA backgrounds on iOS" and over-engineers silent-loop hacks or abandons the PWA install path. (b) The team assumes modern iOS background audio is fully solved and ships, then discovers the *lock-screen-pause-then-resume* failure: after audio is paused ~30s on the lock screen, tapping play on the lock-screen control fails silently until the PWA is foregrounded again.

**Why it happens:**
The platform genuinely changed under everyone's feet and the web is full of stale posts. WebKit bug #198277 ("audio stops when standalone web app is backgrounded") was a real 3-year-open blocker — but it was **resolved in iOS 15.4 (2022)** via AVAudioSession changes. So background *playback* now works in installed PWAs. What is *still* flaky (reported on Apple Developer forums, current) is resuming from the lock screen after a pause window, and Media Session edge behavior. The mental model "iOS PWA = no background audio" is now wrong, but so is "iOS PWA = parity with Android."

**How to avoid:**
- Treat iOS 15.4+ as the baseline; do **not** build silent-audio-loop hacks as the primary mechanism (they cause their own battery/Media-Session bugs).
- Use a **single, long-lived `<audio>` element** as the playback engine (see Pitfall 5). Background continuation hangs off keeping that one element playing, not off Wake Lock.
- Register `navigator.mediaSession.setActionHandler` for `play`, `pause`, `previoustrack`, `nexttrack` and set `mediaSession.playbackState` explicitly — lock-screen controls depend on this, and stale `playbackState` is a common cause of "the play button does nothing."
- Explicitly test the pause→lock→wait 60s→resume-from-lock-screen path on a real device per iOS version. Document the known resume-failure as a tolerated limitation if it persists, rather than pretending it doesn't exist.
- Do **not** rely on Wake Lock for audio continuation: Wake Lock keeps the *screen* awake (battery hostile), is auto-released the moment the PWA is backgrounded, and was itself broken in installed iOS PWAs until iOS 18.4. It is the wrong tool for "keep playing while locked."

**Warning signs:**
Background audio works in the Safari tab during dev but the team never tests the *installed* (home-screen) PWA; lock-screen controls show but tapping them is inert after a pause; QA only happens on Android or in the simulator (the simulator does not reproduce these audio-session bugs).

**Phase to address:**
Background-audio / Media Session phase. Must include a real-device iOS test matrix as an explicit success criterion, not a "nice to have."

---

### Pitfall 2: Caching streamed audio in the service worker (range-request / 206 trap)

**What goes wrong:**
The team adds a service worker for PWA install and, intending to be "offline-friendly," lets the SW intercept and cache audio responses (or uses a broad `fetch` handler / runtime caching rule that matches the audio URLs). Playback then breaks in subtle ways: audio won't start, **seeking is broken**, the scrubber jumps back, or the element errors out — because the SW returns a full `200` body where the media element expected a `206 Partial Content` with a `Content-Range` header.

**Why it happens:**
`<audio>`/`<video>` are unique among web APIs: they fetch via **HTTP Range requests** to start playback fast and to seek. The Cache API/service-worker spec **cannot cache `206` responses**, and a naive SW that responds to a ranged request with a cached full `200` violates what the media element expects. Historically this caused hard failures; Safari and Chromium fixed *passing through* correctly only relatively recently, and Firefox lagged. The project's own scope explicitly says "streamed audio stays online-only" — but it is very easy for a default Workbox/`vite-plugin-pwa` runtime-caching config or an over-broad fetch handler to silently scoop up the audio requests anyway.

**How to avoid:**
- **Never cache audio stream URLs in the service worker.** The SW caches the *app shell* only (HTML, JS, CSS, icons, fonts, manifest). This matches the stated scope ("streaming only, no offline track caching") — lean into it.
- Configure the SW with an explicit **denylist/exclusion** for audio: exclude the Worker-proxy audio path and any upstream CDN audio hosts from runtime caching. With `vite-plugin-pwa`/Workbox, set `navigateFallbackDenylist` and scope `runtimeCaching`/`urlPattern` so audio never matches; do not use a catch-all `globPatterns` or wildcard `fetch` handler over the audio route.
- If a fetch handler must exist, have it `return` (pass through to network) for any request whose `Range` header is present or whose path is the audio route — let the browser talk to the network directly.
- The cleanest design: route audio through a dedicated path (e.g. `/audio/...` on the Worker) and have the SW ignore that path entirely.

**Warning signs:**
Seeking snaps back to the start; audio plays only from the beginning and can't scrub; "stalled"/"error" events on the element only after the SW is installed (works in a non-PWA tab, breaks once installed); Workbox logging shows audio URLs being cached; cache storage grows by tens of MB after playback.

**Phase to address:**
PWA / service-worker phase. Verification: install the PWA, play and seek a track, confirm DevTools → Application → Cache Storage contains **no** audio bytes and seeking works.

---

### Pitfall 3: Streaming audio through the Cloudflare Worker by buffering it (CPU/memory limit + free-tier 10ms)

**What goes wrong:**
The Worker proxy is written to `await response.arrayBuffer()` (or `.text()`/`.json()`) on the upstream audio response and then return it. On a multi-MB lossless FLAC this buffers the whole file into the 128 MB isolate, burns CPU, and on the **free plan blows the 10 ms CPU budget** → `Worker exceeded CPU time limit`. Even on paid plans, buffering large bodies risks the 128 MB memory ceiling under concurrency and adds latency-to-first-byte. Alternatively, the team naively pipes the body but does heavy per-chunk work in JS, which also accrues CPU.

**Why it happens:**
The intuitive "fetch then return" pattern parses/buffers. The key non-obvious fact: **time spent waiting on `fetch()` does not count toward CPU time**, and Cloudflare streams response bodies without buffering — *if you let it*. Buffering converts cheap I/O wait into expensive CPU + memory. Range requests make it worse: if the Worker buffers, it can't cheaply serve a `Range`.

**How to avoid:**
- **Stream, don't buffer.** Return the upstream `Response` body directly: `return new Response(upstream.body, { headers })`. Do not call `.arrayBuffer()`/`.blob()` on audio.
- **Forward the client's `Range` header upstream and propagate the upstream `206` + `Content-Range`/`Accept-Ranges` back unchanged.** This is what makes the browser's seeking work *and* keeps the Worker cheap. Don't strip these headers.
- Keep per-request CPU near-zero: only rewrite headers (CORS, referrer, inject/hide the upstream token), never transform the audio bytes.
- Be honest about the free tier: 10 ms CPU is fine for header-rewrite streaming but **not** for any body parsing. If you ever need to parse upstream JSON (search/detail metadata, which is small) that's fine; never parse audio.
- The API-metadata proxy (search/detail JSON) and the audio-stream proxy have different profiles — consider separate Worker routes/handlers so the audio path stays a pure pass-through.

**Warning signs:**
`Worker exceeded CPU time limit` in `wrangler tail`/logs; large tracks fail while short ones work; high TTFB before audio starts; memory errors under load; seeking fails because the Worker only ever returns `200`.

**Phase to address:**
Cloudflare Worker proxy phase. Verification: `wrangler tail` shows sub-millisecond CPU on audio requests; a Range request to the Worker returns `206` with `Content-Range`; a 40 MB FLAC streams without a CPU error on the free plan.

---

### Pitfall 4: Cloudflare Worker egress region mismatch breaks geo-restricted / token-bound source URLs

**What goes wrong:**
Putting the Worker "in front of" the music APIs is assumed to be strictly better. But the upstream sources are China-centric proxies, and the audio CDN URLs are frequently **time-limited and geo-restricted**, sometimes also referer/IP-bound. When the *Worker* fetches them instead of the browser, the request now originates from a Cloudflare edge IP in an arbitrary region — which can be geo-blocked, IP-blocked, or simply different from the region the token/URL was minted for. Result: URLs that played fine direct-from-browser now 403 or return geo-error bodies through the Worker, and the failure looks like "our proxy is broken."

**Why it happens:**
The current design relies on the browser's own IP/region and a `no-referrer` meta tag to satisfy CDN checks. A server-side proxy changes the source IP and region. Cloudflare Workers do **not** offer fixed/region-pinned egress on standard plans (dedicated egress IPs are a Zero Trust/Enterprise add-on, and not on the China network). JOOX's `probeJooxAudioUrl` logic exists precisely because those CDN URLs are fragile/time-limited — moving the probe server-side changes which IP probes them.

**How to avoid:**
- **Decide per-request-type what goes through the Worker.** Strong case for routing the *metadata/search/detail* calls through the Worker (CORS, hide the JOOX token, retry/rate-limit). Weaker/risky case for routing the *audio bytes* through it — the audio CDN URL may be bound to the browser's region/IP.
- Consider a hybrid: Worker resolves and returns the (token-free) audio URL to the client, and the **browser** streams the audio directly from the CDN. This keeps the geo/IP context that the URL expects and offloads bandwidth from the Worker. The tradeoff: you reintroduce a browser↔CDN CORS dependency for the audio host (test whether the audio CDNs send permissive CORS; many media CDNs do, or tolerate `no-cors`/media-element loads which are not CORS-gated for plain `<audio src>`).
- Note: a plain `<audio src="...">` load is **not** subject to CORS the way `fetch()` is — the element can play a cross-origin URL directly without CORS headers (you just can't read its bytes). This is the key reason browser-direct audio often works where `fetch()` wouldn't. Use this: proxy the *metadata* (CORS-gated `fetch`), let the *element* load the audio URL directly.
- Whatever you choose, build a **fallback**: if Worker-proxied audio 403s, retry browser-direct (or vice versa) before showing an error.
- Hide the JOOX token in the Worker regardless — the token belongs server-side even if audio bytes don't go through the Worker.

**Warning signs:**
A track plays direct-from-browser in the old `index.html` but 403s through the new Worker; failures correlate with source (JOOX worst) rather than with track; error bodies contain region/geo language; the same Worker code works from your local `wrangler dev` (your IP) but fails when deployed (edge IP).

**Phase to address:**
Worker proxy phase, early — this decision (proxy audio bytes vs. proxy metadata only) shapes the whole data layer. Spike it against all sources before committing the architecture.

---

### Pitfall 5: Per-track `<audio>` elements / recreating the element on track change (iOS gesture + state loss)

**What goes wrong:**
The natural component-oriented instinct is to mount an `<audio>` inside the now-playing component, or create a new `Audio()` per track. On iOS this breaks autoplay-within-a-playlist: only audio played *in direct response to a user gesture* is allowed; a *newly created* element that starts on `ended`/`timeupdate` (auto-advance to next track) throws the autoplay error and goes silent. Recreating the element also drops Media Session state, resets background-audio continuity, and causes a gap/flash.

**Why it happens:**
iOS Safari ties the "unlocked to play" permission to a specific element that was first played via a gesture. A *new* element hasn't been blessed by a gesture. Frameworks encourage co-locating the element with the UI; SvelteKit page navigation/HMR can tear down and recreate it. The CONCERNS doc already flags there is no look-ahead prefetch and `playNext` resolves the next URL synchronously — combined with element recreation this is a recipe for silent auto-advance failures.

**How to avoid:**
- **One global, persistent `<audio>` element** for the lifetime of the app, owned by a singleton store/service outside the routed page tree (e.g. a module-level audio service + a Svelte store). Never recreate it; only swap `.src`.
- The first user-initiated play "unlocks" that element; all subsequent programmatic `.play()` calls (next/prev/auto-advance) reuse the *same* element and inherit the unlock. Swapping `src` and calling `.play()` on an already-unlocked element is allowed.
- Keep the audio service mounted in the root layout, decoupled from page transitions, so SvelteKit navigation never unmounts it.
- **Refresh expired URLs before play, not after error only.** Audio CDN URLs from all four sources are time-limited (CONCERNS: 30+ min cache → expired). Re-resolve the URL via the data layer when (re)playing a track whose URL is older than a TTL, and on an `error`/`stalled` event re-resolve and retry once.
- **Prefetch the next track's URL** during current playback (the data layer's detail fetch — especially JOOX's sequential probe — can take seconds to tens of seconds). Resolve `playNext` URL ahead of `ended` so auto-advance is gapless and stays inside the unlocked element.

**Warning signs:**
First track plays, next track is silent (no error toast because failures are swallowed); audio restarts/glitches on route change; Media Session metadata clears between tracks; long gap before the next track on auto-advance.

**Phase to address:**
Core playback engine phase (the data-layer extraction + player service). This is foundational — get the singleton element + unlock model right before building UI on top.

---

### Pitfall 6: Silent failures from unofficial APIs masked as "0 results / nothing plays"

**What goes wrong:**
The existing code fires all sources with `Promise.all` and swallows per-source errors into "0 results"; play errors collapse to a single generic toast. In the rebuild this gets worse at scale: when a proxy goes down, rate-limits, or **silently changes its contract** (the QQ `tang` API already changed once — code carries `Array.isArray(json) ? json : json?.data` dual-format handling), the app shows an empty list or a generic "play error" and the user/dev can't tell "API down" from "paywalled track" from "network error" from "contract drifted."

**Why it happens:**
Unofficial proxies have no SLA, no versioning, no deprecation notices, and return `200` with an unexpected body shape (or an HTML error page) rather than a clean error code. `Promise.all` rejects-all-or-resolves-all encourages swallowing. Generic toasts hide the signal.

**How to avoid:**
- Use `Promise.allSettled` for the search fan-out so one dead source doesn't blank the whole result set; surface per-source status (e.g. "JOOX unavailable").
- **Validate response shape** at the adapter boundary (a small schema/guard per source). Treat shape-mismatch as a typed error ("contract drift"), distinct from network error, paywall, and empty-result. Log/telemeter contract-drift specifically — it's your early-warning that an upstream changed.
- **Differentiate user-facing errors:** "source unavailable" vs "track is paywalled (QQ `pay`/`vip` field)" vs "network offline" vs "no results." The QQ `pay` field already exists; use it.
- **Add timeouts + bounded retry with backoff** per source in the Worker (not unbounded `Promise.all` blasting). Especially throttle JOOX's multi-probe.
- **Pin source contracts with fixtures + tests** (the CONCERNS doc calls this out): record real responses, test adapters against them, so a contract change fails a test instead of silently breaking users.
- Keep `uid` derivation (`{source}-{id}`) stable and resilient: if an upstream changes its ID scheme, saved favorites/playlists silently break (`deserializeTrack` returns null). Version the persisted library and handle unrecoverable UIDs gracefully (mark as "unavailable," don't drop silently).

**Warning signs:**
A source intermittently returns 0 results; favorites that used to play now error after weeks; one source's tracks all fail while others work (contract drift / token revoked); no telemetry exists so you learn from user reports.

**Phase to address:**
Data-layer extraction phase (typed adapters + fixtures), reinforced in the Worker proxy phase (retry/backoff/timeouts) and the error-UX phase (differentiated errors).

---

### Pitfall 7: JOOX detail-by-position-index returns the wrong song

**What goes wrong:**
JOOX detail is fetched by `n` = the 1-based *position* of the song in the original search results, not by a stable ID. If search results reorder between search and play (re-search, pagination, upstream nondeterminism), the wrong track's audio/lyrics load. The user taps "Song A" and "Song B" plays.

**Why it happens:**
The upstream JOOX proxy keyed detail by position, and the original code preserved `jooxIndex`. Reordering is invisible until it bites. This is an existing FRAGILE-AREA flagged in CONCERNS, carried into the rebuild via data-layer reuse.

**How to avoid:**
- Capture and pin the full identifying tuple (`songmid`/`歌曲ID` + keyword + index) at search time and re-validate after detail fetch: compare returned `songmid`/title against the expected one; if mismatch, re-probe or fail loudly rather than play the wrong song.
- Prefer the stable `songmid` if the proxy supports detail-by-mid; only fall back to `n=` index when forced.
- Never re-derive `jooxIndex` from a *fresh* search — keep it bound to the exact result set the user is acting on.

**Warning signs:**
Wrong song plays specifically for JOOX; lyrics don't match audio; the more the user paginates/re-searches before playing, the worse it gets.

**Phase to address:**
Data-layer extraction phase (JOOX adapter), with a verification test for index/identity stability.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| `Promise.all` fan-out with swallowed per-source errors (current behavior) | Simple, fast to write | One dead proxy blanks all results; no drift signal; impossible to debug | Never for production search — use `allSettled` from the start |
| Buffering audio in the Worker (`arrayBuffer()`) | "It returns the file" in one line | CPU-limit failures on free tier; no seeking; memory pressure | Never for audio bytes |
| Caching everything in the SW with a catch-all glob | Feels "offline-ready" | Breaks audio seeking (206 trap); stale-app bugs | Never for audio; app-shell-only is the right scope |
| `skipWaiting()` without coordinating clients | New SW activates instantly | App runs half-old/half-new; cache mismatch; broken assets | OK only with an "update available → reload" prompt that refreshes all clients |
| Hardcoded JOOX token in client (current) | No backend needed | Token public, revocable, abusable | Never once the Worker exists — move it server-side immediately |
| No URL-expiry handling (current) | Less code | Cached-playlist tracks fail after ~30 min with generic error | Never for a player whose core promise is "tap and it plays" |
| Recreate `<audio>` per track / per component | Clean component model | iOS auto-advance goes silent; Media Session resets | Never on iOS — single global element |
| Wake Lock as the background-audio mechanism | Seems to "keep things alive" | Drains battery (screen on), auto-released on background, was broken in iOS PWAs pre-18.4, doesn't fix audio | Never as the audio mechanism; optional only for an explicit "keep screen on" lyrics view |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| iOS Media Session | Set metadata once, never update `playbackState`; expect artwork to always show | Update `metadata` + `playbackState` on every play/pause/track change; provide multiple artwork sizes incl. small (lock screen historically wants ~96–128px); accept artwork is flaky on old iOS |
| Cloudflare Worker → audio CDN | Fetch audio server-side, strip `Range`, return `200` | Forward `Range`, propagate `206`/`Content-Range`/`Accept-Ranges`, stream body (no buffer); consider browser-direct audio to preserve geo/IP context |
| Service worker → media | Runtime-cache audio responses | Exclude audio routes/hosts entirely; SW caches app shell only |
| Unofficial proxies | Trust `200` = valid JSON of expected shape | Validate shape per adapter; treat HTML/`200`-with-wrong-shape as typed "contract drift" error; fixtures + tests |
| JOOX detail | Fetch by position index, trust result | Pin + re-validate `songmid`/title; prefer stable ID; fail loudly on mismatch |
| QQ Music | Treat all tracks as playable | Honor `pay`/`vip` fields; show "paywalled" distinctly, don't generic-error |
| Referer-gated CDNs | Forget the `no-referrer` behavior the old app relied on | Replicate referrer suppression (Worker referrer-policy / omit `Referer`) or audio CDN may 403 |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Synchronous next-track resolution (esp. JOOX multi-probe, up to ~30s) | Long gap on auto-advance; UI freeze feel | Prefetch next track's URL during current playback; throttle/parallel-bound JOOX probe with timeouts | Immediately on any slow source; worst on JOOX |
| Particle canvas O(N²) carried over (existing) | CPU pegged, battery drain, audio stutter on low-end Android | Drop/reduce on `pointer: coarse`; cap N; or remove | Any mid/low-end mobile, immediately |
| Full DOM rebuild per render (existing) | List flicker, jank with 30–40 results | Use Svelte keyed `{#each}`; virtualize long lists (`@tanstack/svelte-virtual`) | Low-end devices, 40+ results |
| Buffering audio in Worker | CPU-limit errors, memory pressure | Stream pass-through | Large/lossless tracks; free-tier 10ms |
| All sources hammered on every keystroke (live search) | Rate-limiting/bans from proxies | Debounce search input; cap concurrent source calls; cache recent queries | Sustained typing / many users sharing the JOOX token |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Leaving JOOX token client-side (current) | Token harvested, abused, rate-limit/ban hits all users; token revoked | Move token to Worker env var/secret; never expose in client bundle or network tab |
| Open Worker proxy (no origin restriction) | Anyone uses your Worker as a free music/CORS proxy → bandwidth + token abuse → upstream bans | Restrict by `Origin`/referer allowlist, lightweight rate-limit per IP, and/or a shared header; don't be an open relay |
| Trusting upstream bodies into `innerHTML` | XSS via track titles/lyrics from third-party (uncontrolled) sources | Render via text/`textContent`/Svelte interpolation (auto-escaped); never `{@html}` untrusted source data |
| Returning permissive `Access-Control-Allow-Origin: *` on the Worker | Combined with token, makes you an open proxy | Scope CORS to your own PWA origin(s) |
| Logging full audio URLs / tokens in Worker logs | Token/URL leakage in `wrangler tail`/log drains | Redact tokens and signed params from logs |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Generic "play error" for every failure | User can't tell paywall from outage from expired URL; feels broken | Differentiated, actionable messages ("This track is paywalled", "Source temporarily unavailable", "You're offline") |
| Aggressive PWA install prompt on first load | Annoying, dismissed, install rate drops | Defer `beforeinstallprompt`; show a tasteful custom prompt after engagement; on iOS provide "Add to Home Screen" instructions (no programmatic prompt exists) |
| No safe-area / `100vh` handling (existing flaw) | Mini-player hidden under home indicator; content clipped under notch | `env(safe-area-inset-*)`; `100dvh`/`100svh` instead of `100vh`; test on notched devices |
| Silent auto-advance failure on iOS | Music just stops; user thinks app is dead | Single unlocked global element + prefetch; surface a real error if it truly fails |
| No loading state during slow detail fetch (JOOX) | Tap → nothing for many seconds → user taps again | Immediate optimistic "loading" state on the mini-player; debounce double-taps |
| Stale app after deploy with no update path | Users stuck on old buggy version | Versioned caches + "Update available, tap to refresh" prompt; reload all clients on activate |
| Hover-only affordances carried from desktop (existing) | Unresponsive feel on touch | `:active`/touch states, `touch-action`, drag-to-seek, swipe gestures |

## "Looks Done But Isn't" Checklist

- [ ] **Background audio:** Works in a Safari *tab* — verify it works in the **installed home-screen PWA** on a **real iPhone**, including lock-screen controls and the pause→wait→resume-from-lock path.
- [ ] **Media Session:** Metadata shows — verify `playbackState` updates and `play/pause/next/prev` action handlers actually drive the single global element; verify artwork on the device (not just simulator).
- [ ] **Seeking under PWA:** Audio plays — verify **scrubbing/seek works after the service worker is installed** (no 206 regression) and Cache Storage holds no audio bytes.
- [ ] **Worker audio path:** Returns audio — verify it returns **`206` for `Range` requests**, streams (sub-ms CPU in `wrangler tail`), and a large FLAC doesn't hit the CPU limit on the free plan.
- [ ] **Geo/region:** Plays from `wrangler dev` (your IP) — verify it still plays **deployed** (edge IP), especially JOOX; have a browser-direct fallback.
- [ ] **URL expiry:** A freshly searched track plays — verify a track played from a **playlist saved 30+ min ago** re-resolves its URL and plays.
- [ ] **Source resilience:** Search works with all sources up — verify search still returns results with **one source down/rate-limited** (`allSettled`) and shows per-source status.
- [ ] **Contract drift:** Adapters parse today's responses — verify **fixture-based tests** exist so a shape change fails CI, not users.
- [ ] **JOOX identity:** Right song plays — verify after **reordering/paginating search** then playing, JOOX plays the *selected* track.
- [ ] **PWA update:** New deploy ships — verify users get an **update prompt** and aren't stuck on a stale cached version.
- [ ] **Safe areas:** Looks right in browser — verify mini-player/now-playing respect notch + home indicator on a notched device with `dvh`/`safe-area-inset`.
- [ ] **Token:** App works — verify the JOOX token is **not** in the client bundle/network requests (it lives in the Worker).

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| SW caching audio (206 break) | LOW | Exclude audio routes from runtime caching, bump SW/cache version, force update; clear Cache Storage |
| Worker buffering → CPU limit | LOW | Switch to `new Response(upstream.body, …)` pass-through; forward `Range` |
| Worker egress geo-block on audio | MEDIUM | Switch audio to browser-direct (Worker resolves URL only); keep metadata proxied; add fallback |
| Per-track audio element (iOS silent advance) | MEDIUM | Refactor to a single global audio service in root layout; rewire `src` swapping; re-test unlock model |
| Source contract drift | MEDIUM | Update adapter + fixture; if structural, version the adapter; communicate degraded source in UI |
| Source / proxy permanently down | MEDIUM–HIGH | Disable the source gracefully (per-source status), find/swap an alternative proxy; the `allSettled` design contains the blast radius |
| Saved library broken by UID scheme change | HIGH | Versioned persistence + migration; mark unrecoverable tracks "unavailable" rather than dropping; rely on JSON export as backstop |
| Stale-app lock-in (no update path) | HIGH | Ship a SW that self-updates + an in-app "hard reset cache" escape hatch; without it, users may need to delete/reinstall the PWA |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| 1. iOS background audio reality | Background-audio / Media Session phase | Real-device iPhone test matrix incl. lock-screen resume |
| 2. SW caching streamed audio (206) | PWA / service-worker phase | Install + seek works; no audio bytes in Cache Storage |
| 3. Worker buffering / CPU limit | Cloudflare Worker proxy phase | `wrangler tail` sub-ms CPU; `206` on Range; large FLAC streams on free plan |
| 4. Worker egress geo mismatch | Worker proxy phase (early spike) | Deployed Worker plays all sources; browser-direct fallback proven |
| 5. Per-track audio element / unlock | Core playback engine phase | Auto-advance plays silently-free across tracks on iOS; element survives navigation |
| 6. Silent unofficial-API failures | Data-layer extraction + Worker + error-UX phases | `allSettled` resilience; fixture tests; differentiated error UI |
| 7. JOOX index identity | Data-layer extraction (JOOX adapter) | Reorder-then-play test plays the selected track |
| URL expiry refresh | Core playback engine phase | 30-min-old playlist track re-resolves and plays |
| PWA stale-cache / update | PWA / service-worker phase | New deploy triggers update prompt; clients refresh |
| Safe-area / `dvh` layout | Mobile UI / now-playing phase | Notched-device visual check |
| JOOX token server-side | Worker proxy phase | Token absent from client bundle/network |
| Performance (particles, list rebuild, prefetch) | Mobile UI + playback engine phases | Profiling on low-end Android; no audio stutter; gapless advance |

## Sources

- [WebKit Bug #198277 — Audio stops in standalone web app when backgrounded (RESOLVED iOS 15.4)](https://bugs.webkit.org/show_bug.cgi?id=198277) — HIGH
- [dbushell — iOS Web Apps and the Media Session API (artwork/metadata reality, iOS 16.4/18 fixes)](https://dbushell.com/2023/03/20/ios-pwa-media-session-api/) — HIGH
- [Apple Developer Forums — iOS Audio Lockscreen Problem in PWA (pause→30s→resume failure)](https://developer.apple.com/forums/thread/762582) — MEDIUM (current community report)
- [WebKit Bug #254545 — Wake Lock API does not work in Home Screen Web Apps (fixed iOS 18.4)](https://bugs.webkit.org/show_bug.cgi?id=254545) — HIGH
- [web.dev — Handle range requests in a service worker (206 / Workbox range-requests)](https://web.dev/articles/sw-range-requests) — HIGH
- [philna.sh — Service workers: beware Safari's range request](https://philna.sh/blog/2018/10/23/service-workers-beware-safaris-range-request/) — HIGH
- [Jake Archibald — I discovered a browser bug (SW + range requests)](https://jakearchibald.com/2018/i-discovered-a-browser-bug/) — HIGH
- [Cloudflare Workers — Platform Limits (CPU 10ms free / 5min paid, 128MB, subrequests, streaming)](https://developers.cloudflare.com/workers/platform/limits/) — HIGH
- [Cloudflare Community — "Worker exceeded CPU time limit" when piping/buffering streams](https://community.cloudflare.com/t/streaming-response-catch-worker-exceeded-cpu-time-limit-error/372138) — MEDIUM
- [Cloudflare One — Egress policies / dedicated egress IPs (region pinning is Enterprise/ZT, not on China network)](https://developers.cloudflare.com/cloudflare-one/traffic-policies/egress-policies/) — HIGH
- [SvelteKit — adapter-cloudflare docs (worker size, `_routes.json`, SPA fallback, no `fs`)](https://svelte.dev/docs/kit/adapter-cloudflare) — HIGH
- [SvelteKit — Single-page apps / `ssr=false` for client-only player](https://svelte.dev/docs/kit/single-page-apps) — HIGH
- [MDN — Autoplay guide for media and Web Audio APIs (gesture requirement)](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay) — HIGH
- [WebKit — New `<video>` Policies for iOS (user-gesture unlock model)](https://webkit.org/blog/6784/new-video-policies-for-ios/) — HIGH
- [whatwebcando.today — Handling Service Worker updates (skipWaiting + update prompt)](https://whatwebcando.today/articles/handling-service-worker-updates/) — MEDIUM
- [MagicBell — PWA iOS Limitations & Safari Support guide](https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide) — MEDIUM
- Project codebase analysis: `.planning/codebase/CONCERNS.md`, `.planning/codebase/INTEGRATIONS.md`, `.planning/PROJECT.md` — HIGH (primary, project-specific)

---
*Pitfalls research for: Mobile-first PWA music player (SvelteKit + Cloudflare Worker proxy, unofficial audio sources)*
*Researched: 2026-06-05*
