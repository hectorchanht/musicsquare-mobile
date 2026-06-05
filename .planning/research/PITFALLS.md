# Pitfalls Research — Last.fm Integration (v1.1)

**Domain:** Adding Last.fm integration (metadata enrichment, signed auth + scrobble/love sync, charts/tags discovery, new YouTube-style audio source) to an existing SvelteKit + Cloudflare Pages/Workers music PWA with 4 unofficial CN proxy sources, HTML5 audio, and local-first favorites/playlists.
**Researched:** 2026-06-06
**Confidence:** HIGH (api_sig rules, scrobble rules, MD5-on-Workers, session-key lifetime all verified against Last.fm official docs + Cloudflare docs; YouTube-source instability MEDIUM — operator/community reports)

> Companion to the v1.0 `PITFALLS.md` (PWA/iOS/Worker platform pitfalls). This file covers ONLY the Last.fm milestone. Suffix convention matches `STACK-lastfm.md`.
>
> **Phase legend:** **P8** = metadata enrichment · **P9** = optional auth + scrobble/love/recent sync · **P10** = discovery tabs (charts/tags/top-lists) · **P11** = new YouTube-style playable source.
> Every pitfall is tagged with the phase that **owns** prevention. Security threats get `T-lfm-NN` IDs at JOOX_TOKEN parity (existing scheme: T-01-xx, T-5ug-xx).

---

## Critical Pitfalls

### Pitfall 1: MD5 assumed unavailable on Cloudflare Workers (or hand-rolled / npm'd unnecessarily) — P9

**What goes wrong:**
Last.fm `api_sig` requires an **MD5** hash. Standard Web Crypto (`crypto.subtle.digest`) only blesses SHA-1/256/384/512, so the first instinct is "MD5 doesn't exist on the edge" → either (a) silently shipping a SHA-256 sig Last.fm rejects with error 13, (b) bundling a JS MD5 lib (`blueimp-md5`/`spark-md5`/`crypto-js`) adding weight + supply-chain surface, or (c) hand-rolling MD5.

**Why it happens:**
MD5 is genuinely not in the WebCrypto **standard**. Developers stop reading there. But **Cloudflare Workers ships a non-standard MD5 extension**: `crypto.subtle.digest({ name: "MD5" }, data)` works on the edge runtime (and the local `wrangler`/`workerd` dev runtime), even though it would throw in Node or a browser.

**How to avoid:**
- Use native edge MD5: `new Uint8Array(await crypto.subtle.digest({ name: 'MD5' }, new TextEncoder().encode(str)))` → lowercase hex (`b.toString(16).padStart(2,'0')`). **No npm dependency.**
- Encode input with `TextEncoder` (UTF-8) — see Pitfall 2; never pass a raw JS string.
- Because `{name:"MD5"}` is Cloudflare-specific, **do not** unit-test the signer under plain Vitest/jsdom/Node — it throws `NotSupportedError` there and looks like broken code. Either run that test in the `@cloudflare/vitest-pool-workers` (workerd) pool, or inject the hash fn and stub it in unit tests (assert the **pre-hash concatenated string**, where the real bugs live).

**Warning signs:**
- Every signed call returns error 13 "Invalid method signature supplied" though the concat string looks right → wrong hash algorithm.
- A signer test passes in Node but throws `NotSupportedError: Unrecognized algorithm name` → wrong test runtime, not a code bug.
- `crypto-js`/`spark-md5` appears in the client bundle → signing leaked to the client (Pitfall 4 / T-lfm-01).

**Phase to address:** **P9** (signing only needed for auth.getSession, track.scrobble, track.love/unlove).

---

### Pitfall 2: api_sig construction errors — UTF-8 on Chinese names, param ordering, and the `format`/`callback` exclusion — P9

**What goes wrong:**
`api_sig` is wrong → error 13 on **every** signed call. This app is **full of non-ASCII** (周杰伦, 林俊杰, 陈奕迅 — see the existing similar-endpoint test fixtures), exactly where naive signers break.

Exact algorithm (verified vs Last.fm docs):
1. Take **all** request params **except `format` and `callback`**.
2. Sort by parameter **name**, alphabetically, **ASCII order** (matters for batch arrays: `track[10]` sorts **before** `track[1]` since `'0' < '1'`).
3. Concatenate as `name + value` with **NO separators** (no `&`, no `=`).
4. Append the **shared secret** (raw, no key name) at the very end.
5. **MD5** with **UTF-8 encoding**, output lowercase hex.

Example (auth.getSession): `md5("api_key"+KEY+"method"+"auth.getSession"+"token"+TOKEN+SECRET)`.

**Why it happens:**
- **`format=json` gets signed by mistake.** Classic bug: build one params object, add `format=json`, then sign the whole thing. `format` (and `callback`) **must be excluded from the signature** but **still sent on the request**. Including it → error 13.
- **Non-ASCII mis-encoding.** Hashing a JS string via a lib that uses Latin-1/UTF-16 code units instead of UTF-8 bytes makes `周杰伦` hash differently than Last.fm computes → error 13 only for CJK tracks while ASCII test tracks pass. `TextEncoder().encode()` gives correct UTF-8 bytes; many MD5 libs do not by default.
- **Signing URL-encoded values** (`%E5%91%A8...`) instead of raw `周杰伦`. The concat string uses **raw** values; URL-encoding happens only when building the request.
- **Wrong sort** (by value, case-insensitive, or `localeCompare`) → error 13.
- **`sk` omitted from the signature** on authenticated calls — `sk` IS signed (only `format`/`callback` excluded).

**How to avoid:**
- One edge `sign(params)` helper: drop `format`/`callback`, sort keys with default `Array.sort()` (ASCII), concat raw `name+value`, append secret, `TextEncoder`→`crypto.subtle.digest({name:'MD5'})`→hex.
- **Test the concat string explicitly** with a CJK fixture (`{ artist:'周杰伦', track:'稻香' }`) asserting the known-good digest — the single highest-value test in P9.
- Add `format=json` **after** computing the sig, never before.
- Pass **raw** values to the signer; encode only when assembling the POST body/query.

**Warning signs:**
- Works for English tracks, error-13s for Chinese tracks → UTF-8 bug.
- Worked in a Python/PHP snippet but not your port → carried over their separator/sort wrongly.
- error 13 vanishes when you remove `format` from the params object → you were signing `format`.

**Phase to address:** **P9.**

---

### Pitfall 3: SECURITY — leaking `LASTFM_SECRET` or the user session key to the client (T-lfm-01) — P9 (highest priority)

**What goes wrong:**
The shared secret signs auth + write calls; the **session key (`sk`) has an INFINITE lifetime by default** (verified: Last.fm only invalidates it on manual user revoke). So:
- Leaking `LASTFM_SECRET` → **anyone can forge signed calls for your whole app** (account-takeover class, same blast radius as JOOX_TOKEN/T-01-04 but worse — it signs *writes*).
- Leaking a user's `sk` → **permanent** ability to scrobble/love/read their history until they notice and revoke. No expiry to save you.

**Why it happens:**
- Putting the secret in `$env/static/public` / a `PUBLIC_`-prefixed var, or referencing it from a `+page.ts`/universal `load` (runs on server **and** client → bundled).
- Echoing `sk`/secret in a JSON response, debug log, or error message (existing code already forbids logging the upstream URL — V7 / T-5ug-01; a signed URL is even more sensitive).
- Doing signing **in the browser** (impossible without shipping the secret — a whole genre of "Last.fm in frontend JS" tutorials are insecure this way).
- Returning the raw `sk` to the client after `auth.getSession` so the SPA "makes its own calls."

**How to avoid (mitigations at JOOX_TOKEN parity):**
- `LASTFM_SECRET` lives **only** in `platform.env` (already declared server-only in `Env`). Import **only** from `$env/dynamic/private` or via `platform.env` inside `+server.ts`/server `load`. Never `$env/*/public`, never a universal `load`.
- **All signing on the edge.** Client calls `/api/lastfm/scrobble` etc.; the Worker holds secret + sk, signs, forwards. Client never sees secret OR sk.
- **Store `sk` server-side, keyed to an httpOnly session cookie** (Pitfall 4) — not returned to JS, not in localStorage.
- Mirror the existing no-leak test (`similar-endpoint.test.ts`): assert response **body** and **all headers** contain neither `LASTFM_SECRET` nor `sk` nor `api_sig` for a fake-secret fixture.
- Never `console.log` the signed URL/body (contains `api_sig` derived from secret + `sk`).

**Warning signs:**
- `LASTFM_SECRET`/`api_sig`/`sk` appears in DevTools Network response, the JS bundle (grep `.svelte-kit/output/client`), or `wrangler tail`.
- The client `fetch`es `https://ws.audioscrobbler.com/...` directly (should only ever hit own `/api/...`).

**Phase to address:** **P9** (own threat-model entry T-lfm-01 here).

---

### Pitfall 4: SECURITY — session-key storage (localStorage XSS) + CSRF on scrobble/love POST endpoints (T-lfm-02, T-lfm-03) — P9

**What goes wrong:**
Two linked write-side threats:
- **T-lfm-02 (storage):** Storing `sk` (or username+sk) in `localStorage`/`IndexedDB` for resume. Any XSS (CONCERNS.md already flags the imperative DOM-building render path is one careless `innerHTML` from XSS) can read it and, given infinite `sk` lifetime, **exfiltrate permanent write access**.
- **T-lfm-03 (CSRF):** New `POST /api/lastfm/scrobble` and `/api/lastfm/love` act on the user's behalf via a server-held `sk` tied to a cookie. If they accept cross-site requests, a malicious page makes the logged-in user love/scrobble arbitrary tracks (write-CSRF). The existing GET proxies are CORS-scoped, but **CSRF ≠ CORS** — CORS doesn't stop a simple/form POST from being *sent* with the cookie.

**Why it happens:**
- "localStorage is easy" + the app is already local-first with localStorage favorites → reusing the pattern for `sk` feels natural. But favorites are low-stakes; a permanent write credential is not.
- Assuming the same-origin CORS allow-list (`http.ts`) protects writes. It governs who can **read** the response, not whether the request is **sent**.

**How to avoid:**
- Store `sk` **only server-side**, indexed by an opaque session id in an **httpOnly, Secure, SameSite=Lax (or Strict)** cookie. SameSite is the primary CSRF defense. (Server-side store on CF = Workers KV, or a signed stateless cookie holding only an opaque id — never the raw sk.)
- For state-changing POSTs, also enforce an **origin/referer check** on the edge (reuse `isAllowedOrigin` from `http.ts`); reject if absent/foreign — defense in depth beyond SameSite.
- Keep write endpoints **POST-only** (never GET) so they can't be triggered by `<img>`/`<link>` and aren't logged in URLs.
- If a CSRF token is added, make it a real double-submit/synchronizer token, not "we have CORS."

**Warning signs:**
- `sk` visible in DevTools → Application → localStorage.
- Scrobble endpoint succeeds from `curl` with no Origin/cookie, or from another origin's `fetch`.
- Cookie missing `HttpOnly`/`Secure`/`SameSite` in DevTools.

**Phase to address:** **P9.**

---

### Pitfall 5: Double-scrobbling, scrobble-when-signed-out, and wrong timestamps — P9

**What goes wrong:**
Scrobble correctness is fiddly and **publicly visible** (users see inflated/duplicate plays on their profile):
- **Double-scrobble on seek/replay/pause-resume:** firing `track.scrobble` on `ended` AND on a re-listen, or re-scrobbling when the user seeks back past the 50% mark, or when a resumed track re-crosses the threshold.
- **Scrobbling when signed out / no `sk`:** the feature is **optional/additive** — must be a **no-op** when there's no session, not an error that breaks playback.
- **Wrong timestamp:** Last.fm `timestamp` must be **UTC UNIX seconds at the moment the track STARTED playing** — not send-time, not local time, not ms. Bad values → code 3 ("too old") / code 4 ("too new") or polluted history. Using `Date.now()/1000` at *send* time is the common bug; capture `playStartedAt` at play **start**.

Eligibility rule (verified): scrobble only if the track is **longer than 30 seconds** AND has played for **at least half its duration OR 4 minutes, whichever comes first**.

**Why it happens:**
- Wiring scrobble to the wrong audio event or to a UI action instead of a guarded progress watcher.
- Forgetting the signed-out branch because dev-testing is always signed in.
- Reaching for ms (`Date.now()`) without `/1000`, or `new Date()` local components.

**How to avoid:**
- Per-play `scrobbleState`: `{ trackUid, playStartedAt (UTC sec), durationSec, scrobbled: boolean }`. Reset when a **new** track loads (hook where `playTrack`/`playFromList` set `currentTrack`).
- Capture `playStartedAt = Math.floor(Date.now()/1000)` **once at play start** (`Date.now()` is already UTC-based; just divide).
- Fire scrobble **once** per play instance: on threshold-cross set `scrobbled=true`, never fire again — even on seek/replay. A genuine new play instance only exists when you re-enter `playTrack` (new `playStartedAt`).
- Tracks **< 30s**: never scrobble.
- **Guard every scrobble/love/now-playing call** with `if (!signedIn) return;`. Failures swallowed (toast at most) — **never block or reset playback** (mirror existing `playTrack` catch / T-5ug-03 ethos).
- `track.updateNowPlaying` is optional-but-recommended; fire once at play start (also guarded). A failed updateNowPlaying must not affect the scrobble decision.

**Warning signs:**
- Your profile shows a song twice from one listen, or a song you skipped 10s into.
- Scrobbles with future (code 4) or implausibly old (code 3) timestamps.
- A signed-out test user sees console errors / broken player when a track ends.

**Phase to address:** **P9.**

---

### Pitfall 6: Offline / failed-scrobble queue edge cases (batch ≤50, ASCII array sort, 14-day window) — P9

**What goes wrong:**
A mobile PWA goes offline mid-listen (WiFi→cellular, screen lock, tunnel). Fire-and-forget loses scrobbles; a queue has sharp edges:
- **Batch limit:** `track.scrobble` accepts **≤50 scrobbles per request** via array notation. A >50 backlog must be chunked.
- **ASCII array-index sort** (Pitfall 2): `track[10]` signs before `track[1]`. A numeric `[1]<[10]` sort breaks batch scrobbles specifically.
- **Stale timestamps:** Last.fm rejects too-old start timestamps (tools cap ~14 days; code 3). A long-offline queue can hold unscrobbable entries.
- **Duplicate on retry:** a request that times out *after* the server processed it, then retried, double-scrobbles.

**Why it happens:**
- Treating the queue as a simple array flushed in one request.
- Not persisting `playStartedAt` per item (so flush uses flush-time → all wrong).

**How to avoid:**
- Persist queued scrobbles **with their captured `playStartedAt`** (never recompute at flush).
- Flush in **chunks of ≤50**, oldest first; on partial failure inspect per-track accepted/ignored in the response rather than blindly retrying the whole batch.
- Drop entries older than ~14 days at flush (rejected anyway).
- Make flush **idempotent-ish**: remove an item only after a 2xx that accepted it; tolerate the rare double on a post-success timeout (acceptable) over losing scrobbles.
- The queue is a P9 nicety — if cut, fall back to "scrobble only while online" (acceptable), still never breaking playback.

**Warning signs:**
- Batch scrobbles silently `ignored` (Last.fm returns ignored-count) → array-index sort or per-item timestamp bug.
- code 3/4 on flush after a long offline stretch.

**Phase to address:** **P9.**

---

### Pitfall 7: The new YouTube-style source — ToS/legal exposure + public-instance instability + wrong-track resolution (T-lfm-04) — P11

**What goes wrong:**
P11 resolves playable audio for Last.fm-discovered `{artist, track}` pairs (no native stream), almost certainly via YouTube through a Piped/Invidious/yt-proxy frontend. Distinct failure modes:
- **Public-instance instability (verified, MEDIUM→HIGH):** Google began IP-blocking Invidious-sourced requests in 2024; public Invidious instances were widely killed in early 2025; the public pool for both Piped and Invidious is small and churns constantly. A hardcoded public instance **will** disappear, taking the whole source offline.
- **Legal/ToS:** YouTube ToS prohibits this; same posture as the existing unofficial CN proxies (project accepts demo/educational risk per PROJECT.md + CONCERNS.md), but it's a **new** platform with its own takedown dynamics.
- **CORS / geo-block:** an instance may serve audio CORS-blocked for browser `fetch`, region-locked, or age-gated — URL resolves but `<audio>` can't play it.
- **Mismatched audio (worst UX bug):** resolving `{周杰伦, 稻香}` to a karaoke cover, a 10-hour loop, a reaction, or a different song. `{artist,track}`→video search is fuzzy; `results[0]` blindly plays the wrong thing.
- **Breaking existing playback:** if the new source throws/hangs in the shared `searchAll`/`ensureTrackDetails` path it can break the working 4-source experience.

**Why it happens:**
- Hardcoding one public instance "that works today."
- Trusting the first hit without scoring.
- Running the resolver inline in the shared fan-out without isolation/timeout.

**How to avoid:**
- **Never break existing sources:** isolate behind the same best-effort posture as everything else — `Promise.allSettled`, hard `AbortSignal.timeout`, errors → 0 results (the codebase already does this; P11 must conform). A dead YT instance degrades to "this one source returned nothing," like a down CN proxy.
- **Instance failover:** maintain a small **list** of instances with health-check/rotation, or front it with your **own Worker** (control + caching + secret-free) instead of calling a public instance from the browser. Treat any single instance as ephemeral.
- **Score the match**, don't take `[0]`: normalize + fuzzy-compare artist & title, prefer official/topic channels, penalize keywords (`cover`, `live`, `remix`, `karaoke`, `1 hour`, `reaction`), reject if best score below threshold → "no playable source" over wrong song. Use Last.fm `duration` to sanity-check candidate length.
- **Fail gracefully in UI:** a Last.fm-discovered track with no resolvable audio shows "no playable source" / falls back to searching the 4 CN sources for the same `{artist,track}` — never a silent broken play button (CONCERNS.md already flags missing error differentiation).
- Proxy the audio through your own edge if CORS/Range blocks it (reuse the existing `corsHeaders` + `Range` handling).

**Warning signs:**
- Source works for days then 100% fails → instance died; no failover.
- "Plays the wrong song / a cover" reports → no match scoring.
- A YT-source timeout stalls the whole search → not isolated/timeboxed.
- 403/CORS on the resolved media URL → geo/age/CORS block; needs proxy or skip.

**Phase to address:** **P11** (own T-lfm-04 here; reuse P-1 proxy/`allSettled`/timeout patterns).

---

### Pitfall 8: Metadata enrichment that overwrites good data, blocks playback, or trusts Last.fm defaults — P8

**What goes wrong:**
P8 layers `track/artist/album.getInfo`, tags, bios, higher-res art onto existing tracks. Pitfalls:
- **Last.fm placeholder "star" image:** with no art, Last.fm returns a default star PNG (historically image hash `2a96cbd8b46e442fc41c2b86b821562f`, and lately often **empty `#text`**). Naively using `image[].['#text']` shows a broken/placeholder cover *worse* than the CN source's real cover. **Never let a placeholder overwrite a real cover.**
- **Inconsistent image arrays:** the `image` array (small→extralarge) is frequently partially empty, sometimes missing, sometimes all-empty. Indexing `image[3]['#text']` blindly throws or yields `""`.
- **Missing `mbid`:** MusicBrainz IDs are often absent/empty — never required (see Pitfall 9).
- **No Last.fm match:** many CN/regional tracks aren't in Last.fm. `getInfo` returns error 6 ("no track matched") — enrichment must be a **silent best-effort overlay**, never a hard failure that blocks display/playback.
- **Enrichment in the critical path:** awaiting `getInfo` before showing/playing adds latency and a new dependency to the proven playback path.

**Why it happens:**
- Treating Last.fm as authoritative over the CN sources (it isn't, for CJK catalog).
- Assuming `image`/`mbid`/`getInfo` always populate.

**How to avoid:**
- Enrichment is **additive and async/lazy**, off the playback critical path. Play first, enrich the now-playing/detail view after.
- **Merge, don't replace:** fill only **missing** fields; prefer existing CN cover unless absent; explicitly **filter the placeholder hash + empty `#text`** before use.
- Defensive image access: walk the array for the largest non-empty `#text`; default to existing/none.
- Treat `mbid`/match as optional; error 6 → no enrichment, no log spam.
- Reuse the `/api/similar` posture: dedicated edge route, `LASTFM_KEY` server-side, clean normalized JSON, `{}`/empty on any failure (T-5ug-03 ethos).

**Warning signs:**
- Covers regress to a star/blank for tracks that had art.
- `Cannot read properties of undefined (reading '#text')` in logs.
- Detail view spins/errors for tracks not in Last.fm.

**Phase to address:** **P8.**

---

### Pitfall 9: Identity mismatch — local `uid` scheme vs Last.fm `{artist, track, mbid}`; favorites/loved reconciliation — P9 (sync), P8 (matching primitive)

**What goes wrong:**
The app identifies tracks by source-scoped `uid` (`netease-123`, `qq-MID`, `kuwo-RID`, `joox-MID`). Last.fm identifies by **`{artist, track}` (+ optional, often-missing `mbid`)**. Reconciling local favorites ⇄ Last.fm loved tracks is genuinely hard:
- **No stable shared key:** the same song has a different `uid` per source and *no* `uid` from Last.fm. Loving on Last.fm then pulling loved-tracks back can't map cleanly to a local `uid`.
- **Duplicate/merge conflicts:** importing loved tracks creates duplicates of already-favorited songs (different `uid`, same song), or "ghost" loved entries with no playable source.
- **Fuzzy match noise:** CJK punctuation/spacing/variant titles, feat. credits, traditional vs simplified Chinese → `{artist,track}` equality fails for the same song.
- **Two-way drift:** local unlove must propagate; conflicting states (loved on web, unfavorited locally) need a resolution rule.

**Why it happens:**
- Assuming a 1:1 `uid` ⇄ `{artist,track}` mapping exists.
- No normalization layer for matching.

**How to avoid:**
- Define a **normalized match key** = `normalize(artist) + ' ' + normalize(track)` (lowercase, trim, strip punctuation/feat./brackets, NFC-normalize, optional simplified⇄traditional fold). Store it alongside `uid` so a track has both its source `uid` AND its lastfm match-key.
- **Last.fm loved state is keyed by match-key, not `uid`.** Loving = `track.love` with `{artist,track}`. The "loved on Last.fm?" check compares match-keys, tolerating that one match-key maps to several local `uid`s.
- Reconciliation is **additive/non-destructive**: a loved-track with no local match becomes a "discoverable" entry (resolve via P11 source on play), never overwrites/deletes local favorites.
- Pick an explicit **conflict rule** (recommend: local action wins for local UI; pulled loved-tracks only *add* a flag, never remove a local favorite) and document it.
- Keep local-first working signed-out (favorites in localStorage); Last.fm love is an **optional overlay** synced only when signed in.

**Warning signs:**
- Same song shows twice (once favorited, once loved-imported).
- "Loved on Last.fm" indicator wrong for CJK tracks → normalization gap.
- Unlove on one surface doesn't reflect on the other.

**Phase to address:** **P9** owns the two-way sync + conflict rule; the **match-key normalization primitive** lands in **P8** (also used for enrichment matching) and is reused by P9/P11.

---

### Pitfall 10: SvelteKit/Cloudflare specifics — `platform.env` undefined in dev, public/private env leaks, caching personalized responses — P8 (env plumbing), P9 (auth caching)

**What goes wrong:**
- **`platform.env` is `undefined` in `vite dev`.** CF bindings exist only in the adapter runtime (prod, or `wrangler dev`/`vite preview` with the platform proxy). Existing code already guards `platform?.env` and treats absent `LASTFM_KEY` as supported fallback — **new endpoints must do the same** or auth/scrobble throws confusing nulls in plain `npm run dev`.
- **Server-only env leaking into client `load`:** referencing `LASTFM_SECRET`/`LASTFM_KEY` from a universal (`+page.ts`/`+layout.ts`) or `+page.svelte` → bundled into client. Must come from `$env/dynamic/private` or `platform.env` inside `+server.ts`/`+page.server.ts` only (ties to T-lfm-01).
- **Caching personalized (auth'd) responses:** the existing GET proxies are safely cacheable, but `user.getRecentTracks`, loved-tracks, and anything keyed to `sk` are **per-user**. Caching them at the edge/CDN (or with shared `Cache-Control: public`) can **serve one user's history to another**. Discovery (charts/tags) IS cacheable; personalized data is NOT.

**Why it happens:**
- Copy-pasting the cacheable similar/discovery pattern onto a personalized endpoint.
- Testing only in `npm run dev` (no platform) OR only prod, not both.

**How to avoid:**
- All Last.fm endpoints read `platform?.env` and degrade gracefully when undefined (parity with `/api/similar`); document that signed features need `wrangler dev`/preview locally.
- Secrets imported **only** server-side; reuse the no-leak test (body + headers) for every new endpoint.
- Mark personalized responses `Cache-Control: private, no-store`; **never** include `sk`-derived data in a shared cache key. Discovery (P10) may use a short public TTL.
- Keep the CORS allow-list (`http.ts`) — never `*` — especially now that some endpoints carry a session cookie.

**Warning signs:**
- `Cannot read properties of undefined (reading 'LASTFM_SECRET')` in dev → expected; handle, don't "fix" by hardcoding.
- A grep of the client bundle finds `LASTFM_` → server env leaked.
- A user sees someone else's recent tracks → personalized response shared-cached.

**Phase to address:** **P8** (env plumbing for the first new endpoint), **P9** (personalized-cache + cookie correctness).

---

### Pitfall 11: Last.fm rate limits / 429s on discovery + scrobble fan-out — P10 (discovery), P9 (scrobble)

**What goes wrong:**
Last.fm's limit is informal (~5 req/s/key is the widely-cited unofficial guidance; API returns **code 29 "rate limit exceeded"** + HTTP 429). App-specific amplifiers:
- **Discovery fan-out (P10):** building charts/tags tabs can fan out many `getInfo`/`getTop*` calls (e.g. enriching each of 50 chart entries) → burst over the limit.
- **Scrobble/enrich storms (P9/P8):** flushing an offline queue, or enriching a long result list, hammers the key.
- Everything shares **one** `LASTFM_KEY`, so a burst from one feature rate-limits **all** Last.fm features app-wide.

**Why it happens:**
- `Promise.all` over many Last.fm calls with no concurrency cap (mirrors CONCERNS.md "no throttling, fires all sources in parallel").

**How to avoid:**
- Reuse `fetchWithRetry` (already retries 429/5xx with backoff) for **all** Last.fm calls.
- Cap concurrency on fan-out (small pool, 3–5 in flight); prefer batch endpoints (chart/top-lists return many items in one call — don't N+1 with per-item `getInfo`).
- **Cache discovery responses** at the edge with a sensible TTL (charts change slowly) so repeated tab opens don't re-hit Last.fm.
- Enrichment is lazy/on-demand (visible/now-playing track only), not eager over whole lists.

**Warning signs:**
- Intermittent empty discovery tabs / enrichment gaps under load → silent 429s.
- code 29 in upstream responses.

**Phase to address:** **P10** (discovery fan-out + caching), **P9** (scrobble/queue throttle).

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Bundle an npm MD5 lib instead of edge `crypto.subtle.digest({name:'MD5'})` | Familiar, Node-testable | Bundle weight + supply-chain; risks signing in client | **Never** — native edge MD5 exists |
| Store `sk` in localStorage for "easy resume" | Trivial SPA state | Permanent (infinite-lifetime) write credential exposed to any XSS | **Never** — httpOnly cookie + server-side sk |
| Hardcode one public Piped/Invidious instance | Ships fast | Source dies wholesale when the instance disappears (routine) | MVP demo only, with a visible "source may be down" caveat |
| Take YT search `results[0]` as the match | Simple resolver | Wrong-song playback (covers/loops/karaoke) | **Never** for prod; needs match scoring |
| Eager-enrich every search result with `getInfo` | Rich lists | 429s, latency, N+1 over one shared key | Only with concurrency cap + cache; prefer lazy |
| `Cache-Control: public` on every `/api/lastfm/*` | Fast tabs | Personalized history leaks across users | Only on non-personalized discovery endpoints |
| Sign `{artist,track}` URL-encoded values | "Matches the request" | error 13 on all signed calls | **Never** — sign raw values |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Last.fm `api_sig` | Including `format`/`callback` in the signed string | Exclude `format` & `callback`; still send `format=json` on the request |
| Last.fm `api_sig` | MD5 of UTF-16/Latin-1 string (breaks CJK) | `TextEncoder().encode()` → UTF-8 bytes → MD5 |
| Last.fm MD5 on Workers | Assuming Web Crypto has no MD5 | `crypto.subtle.digest({name:'MD5'}, bytes)` — CF non-standard ext (edge + workerd, NOT Node/browser) |
| Last.fm `track.scrobble` | `Date.now()` (ms) at send-time as timestamp | UTC **seconds** at play **start**: `Math.floor(playStart/1000)` |
| Last.fm `track.scrobble` | >50/batch; numeric array-index sort | Chunk ≤50; ASCII sort (`track[10]` before `track[1]`) |
| Last.fm auth token | Reusing the token | One-time use; consumed by `auth.getSession` — store the resulting `sk` |
| Last.fm `*.getInfo` images | Using the default star placeholder / empty `#text` | Filter placeholder hash + empty strings; never overwrite a real cover |
| Last.fm identity | Keying on `mbid` | `mbid` often empty; key on normalized `{artist,track}` |
| Last.fm session | Assuming `sk` expires | Infinite lifetime — treat as a permanent secret until user revokes |
| YouTube frontend | Calling a public instance from the browser | Own-Worker proxy + instance failover list; isolate behind allSettled+timeout |
| SvelteKit env | `LASTFM_SECRET` via `$env/static/public`/universal `load` | `$env/dynamic/private` / `platform.env` in `+server.ts` only |
| Cloudflare `platform.env` | Expecting it in `vite dev` | `undefined` in plain dev; guard + use `wrangler dev`/preview |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Per-item `getInfo` over a chart/result list (N+1) | Slow tabs, intermittent 429 | Batch top-list endpoints; lazy/visible-only enrichment; cache | ~10+ items × repeated opens on one key |
| Unbounded `Promise.all` of Last.fm calls | code 29 / 429, empty tabs | Concurrency cap (3–5) + `fetchWithRetry` backoff | Discovery fan-out or queue flush bursts |
| Sequential YT instance probing (like JOOX URL probing) | Multi-second wait before audio | Timebox each instance; race a small healthy set; cache resolution | Whenever the first instance is slow/dead |
| Enrichment awaited on the playback path | Delayed play, new failure point | Keep enrichment off the critical path (play first, enrich after) | Any track not in Last.fm or any Last.fm slowness |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| `LASTFM_SECRET` in client bundle / public env (T-lfm-01) | App-wide write forgery (signs scrobble/love) | Server-only `platform.env`; sign on edge; no-leak test on body+headers |
| Returning/storing `sk` to the client (T-lfm-01/02) | Permanent (no-expiry) account write access via XSS | httpOnly+Secure+SameSite cookie → server-side sk lookup; never to JS |
| No CSRF defense on scrobble/love POST (T-lfm-03) | Cross-site forced loves/scrobbles | SameSite=Lax/Strict cookie + origin check (reuse `isAllowedOrigin`); POST-only |
| Logging the signed URL/body | Leaks `api_sig` + `sk` to `wrangler tail` | Never log secret-bearing URLs/bodies (extends V7 / T-5ug-01) |
| Caching `sk`-keyed responses publicly | One user's history served to another | `Cache-Control: private, no-store`; `sk` never in cache key |
| New YT source as open CORS relay | Becomes an abuse/relay magnet (cf. T-01-02) | Keep `corsHeaders` own-origin allow-list; never `*` |
| Reusing local-favorites localStorage pattern for `sk` | Low-stakes pattern applied to a high-stakes credential | Different storage tier for credentials (server + httpOnly) |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| YT source plays the wrong song (cover/loop/karaoke) | Trust-destroying | Match scoring + duration sanity-check; "no playable source" over wrong song |
| Last.fm placeholder star replaces real cover | Looks broken/regressed | Filter placeholder; prefer existing real art |
| Scrobble errors break playback for signed-out users | Core player feels broken | Guard all Last.fm calls with signed-in check; swallow failures |
| Inflated/duplicate scrobbles on public profile | User distrust, looks buggy | One scrobble per play instance; correct threshold + timestamp |
| Dead YT instance = blank source, no explanation | Confusing "why no results" | Degrade like a down CN proxy; optional "source unavailable" note |
| Loved/favorite duplicates after sync | Cluttered library | Non-destructive match-key reconciliation |

## "Looks Done But Isn't" Checklist

- [ ] **api_sig:** Often missing UTF-8/CJK correctness — verify a `周杰伦`/`稻香` signed call returns 200, not error 13.
- [ ] **api_sig:** Often signs `format` — verify the digest excludes `format`/`callback` yet the request still sends `format=json`.
- [ ] **MD5:** Often only tested in Node — verify the signer runs in the **workerd**/`wrangler dev` runtime, not just jsdom.
- [ ] **Scrobble:** Often double-fires — verify one listen = exactly one scrobble; seeking back doesn't re-scrobble.
- [ ] **Scrobble:** Often wrong timestamp — verify it equals play-**start** UTC seconds, not send-time.
- [ ] **Signed-out path:** Often untested — verify search/play/favorites all work with no Last.fm session.
- [ ] **Secret/sk leak:** Verify grep of client bundle + Network responses + `wrangler tail` shows no `LASTFM_SECRET`/`sk`/`api_sig`.
- [ ] **CSRF:** Verify scrobble/love POST is rejected without a same-origin Origin and with SameSite cookie absent.
- [ ] **Enrichment:** Verify a track NOT in Last.fm still displays + plays (error 6 handled silently).
- [ ] **Placeholder image:** Verify the star/empty `#text` never overwrites an existing cover.
- [ ] **YT match:** Verify a known mismatch case (a song with many covers) resolves to the right track or to "none."
- [ ] **YT instance:** Verify behavior when the configured instance is down (degrades, doesn't break other sources).
- [ ] **Personalized cache:** Verify `getRecentTracks`/loved responses are `private`/uncached.
- [ ] **platform.env:** Verify graceful behavior in plain `vite dev` (no env) AND `wrangler dev` (env present).

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| `LASTFM_SECRET` leaked | HIGH | Rotate secret on Last.fm immediately; all existing `sk` were signed in the old secret's context — force re-auth; purge from bundle/logs; redeploy |
| User `sk` leaked | MEDIUM | Force re-auth; user must revoke app in Last.fm settings (only way to kill an infinite-lifetime sk); rotate session cookie |
| error 13 everywhere | LOW | Diff the concat string vs a known-good reference; check format-exclusion + UTF-8 + ASCII sort + raw values |
| Double-scrobbles shipped | LOW | Fix the per-play guard; (no bulk un-scrobble API — user deletes manually); add regression test |
| Dead YT instance in prod | LOW–MEDIUM | Swap/rotate instance config (or flip to own-proxy); add failover list if absent |
| Personalized response cached publicly | MEDIUM | Add `private, no-store`; purge CDN cache; audit cache keys |
| Favorites/loved duplicated after sync | MEDIUM | De-dupe by match-key; tighten normalization; make reconciliation non-destructive |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| MD5 assumed unavailable / hand-rolled (P1) | **P9** | Signer test passes in workerd runtime; no MD5 npm dep in bundle |
| api_sig construction / UTF-8 CJK / format-exclusion (P2) | **P9** | CJK signed call returns 200; concat-string unit test with known digest |
| Secret/sk leak (T-lfm-01) (P3) | **P9** | No-leak test (body+headers); bundle + `wrangler tail` grep clean |
| sk storage + CSRF (T-lfm-02/03) (P4) | **P9** | httpOnly cookie present; cross-origin/no-origin POST rejected |
| Double-scrobble / signed-out / timestamp (P5) | **P9** | One listen = one scrobble; signed-out player intact; start-time UTC sec |
| Offline queue edge cases (P6) | **P9** | ≤50 batch chunks; per-item timestamps; idempotent flush |
| YT source ToS/instability/mismatch (T-lfm-04) (P7) | **P11** | Dead-instance degrades gracefully; match scoring rejects wrong song |
| Enrichment overwrite / placeholder / no-match (P8) | **P8** | Non-Last.fm track displays+plays; placeholder never overwrites art |
| uid ⇄ {artist,track} identity / reconciliation (P9) | **P9** sync (match-key in **P8**) | Match-key de-dupes; CJK loved-state correct; non-destructive sync |
| SvelteKit/CF env + personalized caching (P10) | **P8** env, **P9** cache | Graceful in `vite dev`; personalized responses `private`; no client env leak |
| Rate limits / 429 fan-out (P11) | **P10** discovery, **P9** scrobble | Concurrency cap + `fetchWithRetry`; discovery cached; no code 29 under load |

## Sources

- Last.fm — track.scrobble (official): https://www.last.fm/api/show/track.scrobble — timestamp UTC seconds, ≤50/batch array notation, code 3/4/29, required params incl. api_sig+sk (HIGH)
- Last.fm — Scrobbling rules (official): https://www.last.fm/api/scrobbling — >30s AND (≥50% OR 4 min, whichever first); updateNowPlaying optional/recommended (HIGH)
- Last.fm — Web Auth (official): https://www.last.fm/api/webauth — token one-time use, auth.getSession→sk, **sk infinite lifetime**, signing concat rule (HIGH)
- Unofficial Last.fm API docs — Signature: https://lastfm-docs.github.io/api-docs/auth/signature/ — exclude `format`(+`callback`), alpha sort, name+value no-separator concat, append secret, MD5 **UTF-8** (HIGH; matches official)
- Last.fm — Error codes (official): https://www.last.fm/api/errorcodes — code 13 Invalid method signature, code 6 no match, code 29 rate limit (HIGH)
- Cloudflare Workers — Web Crypto (official): https://developers.cloudflare.com/workers/runtime-apis/web-crypto/ — "MD5 is not part of the WebCrypto standard but is supported in Cloudflare Workers... Do not rely upon MD5 for security." (HIGH)
- Cloudflare Community — MD5 in Workers: https://community.cloudflare.com/t/md5-in-cloudflare-worker/260566 — `crypto.subtle.digest({name:'MD5'})` usage (MEDIUM, corroborates official)
- "Invalid method signature" issue threads (ruby-lastfm #66, php-lastfm #2, navidrome #5178): common error-13 causes — UTF-8, missing/extra params, sk hashing (MEDIUM)
- Invidious/Piped reliability 2025–2026 (Invidious docs instances page; community status posts; Techrights Feb-2025 mass-block report): Google IP-blocking, instance churn, small public pool (MEDIUM — operator/community reports)
- Existing repo: `src/routes/api/similar/+server.ts`, `similar-endpoint.test.ts`, `src/lib/proxy/http.ts`, `src/lib/proxy/proxy-types.ts`, `.planning/codebase/CONCERNS.md`, `.planning/PROJECT.md` — established T-5ug-01/T-01-04 edge-secret posture, allSettled+timeout fallback, no-leak test pattern, CORS allow-list (HIGH — primary source)

---
*Pitfalls research for: Last.fm integration on a SvelteKit + Cloudflare music PWA (v1.1)*
*Researched: 2026-06-06*
