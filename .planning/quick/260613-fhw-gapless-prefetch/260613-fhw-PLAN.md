---
phase: quick-260613-fhw
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/lib/proxy/http.ts
  - src/lib/services/catalog.ts
  - src/lib/services/catalog.test.ts
  - src/lib/stores/player.svelte.ts
  - src/lib/stores/player.svelte.test.ts
autonomous: false
requirements: [GAPLESS-PREFETCH]
must_haves:
  truths:
    - "Concurrent multi-source search no longer hammers every proxy at the exact same instant — adapter fan-out is staggered by a small configurable delay."
    - "First-search / first-play latency is not noticeably degraded by the stagger (default ~200ms total, not per-source-serialized)."
    - "prefetchNext keeps resolving forward through queue candidates until it lands one that is fully playable (detailsLoaded + audioUrl + cover-or-no-cover-needed), instead of giving up after a single source hiccup."
    - "The forward-resolve loop is bounded (capped candidate count) and abortable via the existing prefetchController, and never blocks the current play()."
    - "All existing never-stop / CR-03 fallback / stale-guard / playGen contracts still hold (no regressions in the existing test suite)."
  artifacts:
    - path: src/lib/proxy/http.ts
      provides: "Exported `sleep(ms)` native-Promise delay helper (reuses the existing backoff pattern, no hand-rolled AbortController)."
      contains: "export function sleep"
    - path: src/lib/services/catalog.ts
      provides: "Inter-source stagger in searchAllUncached fan-out + exported STAGGER constant for tests."
      contains: "SEARCH_STAGGER_MS"
    - path: src/lib/stores/player.svelte.ts
      provides: "Hardened prefetchNext that advances through bounded candidates until a playable next track is resolved."
    - path: src/lib/stores/player.svelte.test.ts
      provides: "Coverage for the forward-resolve loop: skips a failing candidate, lands the next playable one, respects the cap, aborts on stale current."
  key_links:
    - from: src/lib/services/catalog.ts
      to: src/lib/proxy/http.ts
      via: "import { sleep }"
      pattern: "import.*sleep.*from.*proxy/http"
    - from: src/lib/stores/player.svelte.ts
      to: src/lib/services/catalog.ts
      via: "ensureTrackDetails per candidate in the forward-resolve loop"
      pattern: "ensureTrackDetails"
---

<objective>
Make never-stop playback reliable against TRANSIENT source failures by (a) staggering the concurrent multi-source search fan-out so proxies are not all hit in the same instant, and (b) hardening `prefetchNext` so it advances forward through queue candidates until it lands on a track that is actually playable — instead of silently giving up after one source hiccup.

Purpose: The reported symptom is "auto-advance stalls on a song that plays fine when later tapped manually" — classic transient proxy/rate-limit failure, not a dead track. Today `prefetchNext` pre-resolves ONLY `queue[i+1]` and, on a resolve failure, leaves the queue as-is and tries nothing else. Combined with all sources firing concurrently, a single hiccup leaves the next slot unresolved and the eventual `next()`/`onended` advance lands on an unresolved track.

Output: A staggered search fan-out and a bounded, abortable forward-resolve prefetch loop, both fully unit-tested in node, with a documented device-only verification step for the audio `canplay` streaming confirmation.
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/execute-plan.md
@~/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@CLAUDE.md

<interfaces>
<!-- Authoritative contracts extracted from the codebase. Use these directly; do NOT re-explore. -->

src/lib/proxy/http.ts — has a PRIVATE `backoff(attempt)` at line 78-82 using the native-Promise pattern
`return new Promise((resolve) => setTimeout(resolve, ms))`. There is NO exported `sleep` today
(the grounding note's "sleep at http.ts:81" actually refers to this private backoff). This plan
ADDS an exported `sleep(ms)` next to it, same pattern, no hand-rolled AbortController.

src/lib/services/catalog.ts:105 — `async function searchAllUncached(keyword, page, prefs, signal?, onPartial?)`:
  const adapters = getEnabledAdapters(prefs);   // ordered list
  const sig = signal ?? new AbortController().signal;
  const acc: SettledSourceResult[] = [];
  let pending = adapters.length;
  await Promise.all(adapters.map((a) => a.search(keyword, page, sig).then(...).catch(...).finally(...)));
  // .finally pushes into acc, decrements pending, fires onPartial?.({ perSource:[...acc], interleaved: interleave(acc), pending })
  // ABORT GUARD inside .finally: `if (sig.aborted) return;`
  return { perSource: acc, interleaved: interleave(acc) };

src/lib/services/catalog.ts:181 — `export async function ensureTrackDetails(track, signal?, quality?): Promise<Track>`:
  - readiness guard: `if (track.detailsLoaded && track.audioUrl && (track.lrc || !track.lrcUrl)) return track;`
  - else `return SOURCES[track.source].resolve(track, sig, quality);`
  - REJECTS on a source failure (no internal catch).

src/lib/stores/player.svelte.ts — fields (private, NOT $state):
  prefetchingUid: string | null     (line 519)  — in-flight dedupe guard
  prefetchController: AbortController | null  (line 521) — aborts a superseded prefetch
  preloadedAudio/Url/Uid, preloadedCover/Url/Uid  (522-527) — asset-warm caches
  playGen (line 204) — monotonic; play() bumps it (line 1306, except fromFallback)

src/lib/stores/player.svelte.ts:1121 — current `prefetchNext()` (the function to harden):
  - i = indexOf(current); if i<0 return; nextIndex=i+1; if >=length return;
  - target=queue[nextIndex]; preloadNextCover(target);
  - if target already complete → prewarmNextAssets(target); return;
  - if prefetchingUid===target.uid return;  (dedupe)
  - prefetchController?.abort(); prefetchingUid=target.uid; prefetchController=new AbortController(); sig=.signal;
  - seedUid=current?.uid;  (stale-guard)
  - try { resolved = await ensureTrackDetails(target, sig);
      if current?.uid===seedUid { j=indexOf(current); slot=j+1; if j>=0 && queue[slot]?.uid===target.uid { queue[slot]=resolved; prewarmNextAssets(resolved) } } }
    catch { /* best-effort */ }
    finally { if prefetchingUid===target.uid { prefetchingUid=null; prefetchController=null } }

src/lib/stores/player.svelte.ts — helpers to REUSE (do not change behavior):
  prewarmNextAssets(track), preloadNextAudio(track), preloadNextCover(track)  (1168-1207)
  ensureAhead() (1061) — grows the queue when within 2 of the end
  primeNext() (1209) — `await ensureAhead(); await prefetchNext();` — fired from play()

src/lib/stores/player.svelte.test.ts — test harness patterns:
  - `mockEnsure` mocks `ensureTrackDetails` (line 14 region); `mk(source,id,artist,title)` = resolved track,
    `stub(...)` = unresolved (audioUrl null). `installAssetPreloadMocks()` stubs Audio/Image ctors.
  - drive private methods via bracket access: `(player as unknown as { prefetchNext(): Promise<void> })['prefetchNext']()`.
  - `deferred<Track>()` for controllable in-flight promises; `flush()` to drain microtasks.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Add inter-source stagger to the search fan-out</name>
  <files>src/lib/proxy/http.ts, src/lib/services/catalog.ts, src/lib/services/catalog.test.ts</files>
  <behavior>
    - `sleep(ms)` resolves after ~ms via the native-Promise/setTimeout pattern (mirrors private `backoff`); never hand-rolls AbortController.
    - `searchAllUncached` starts adapter N's `.search()` ~`SEARCH_STAGGER_MS * N` after the first (adapter 0 fires immediately). This is a STAGGERED START, not serialization: once started, searches still overlap, and total added latency for K sources is ~`SEARCH_STAGGER_MS * (K-1)`, defaulting to a small value so first-search feel is preserved.
    - The existing contracts are unchanged: `Promise.all` still never rejects (every promise stays `.catch`-guarded), `onPartial` still streams growing deduped sets, the `if (sig.aborted) return` abort guard still suppresses partials after a superseded query, and the final `{ perSource, interleaved }` shape is identical.
    - A query aborted DURING the stagger window must not keep launching later staggered searches (check `sig.aborted` before each staggered start).
  </behavior>
  <action>
    In `src/lib/proxy/http.ts`, export a `sleep(ms: number): Promise<void>` helper using the SAME native pattern as the private `backoff` (`return new Promise((resolve) => setTimeout(resolve, ms))`). Do NOT add an AbortController — reuse the existing pattern per the http.ts line-4 research note. Leave `backoff` as-is (it may optionally delegate to `sleep`, but that is not required).

    In `src/lib/services/catalog.ts`: import `sleep` from `$lib/proxy/http`. Add an exported constant `export const SEARCH_STAGGER_MS = 200;` (sensible default in the requested 150-300ms band; a single small value so the user-felt first search is not noticeably slowed — total added latency for the typical enabled-source count stays at a few hundred ms, and partial results still stream in via onPartial as each source lands). In `searchAllUncached`, wrap each adapter's launch so adapter at index `idx` first `await sleep(SEARCH_STAGGER_MS * idx)` before calling `a.search(...)`, then keep the EXACT existing `.then/.catch/.finally` accumulator + `onPartial` + abort-guard logic. Guard the staggered start: if `sig.aborted` is already true after the sleep, skip launching that adapter (treat as no-op / do not push a result, just decrement `pending` consistently with the abort-guard so a superseded query stops firing new searches). Keep `pending` accounting correct so the final partial still reaches `pending: 0`. Do NOT change `interleave`, `searchAll` (the cache wrapper), or the return shape.

    In `src/lib/services/catalog.test.ts`: add tests under the existing `searchAll` describe (or a new `searchAllUncached stagger` describe) using fake timers (vitest `vi.useFakeTimers()`), asserting (1) adapters are invoked in staggered order — assert adapter[1].search has NOT been called until the timer is advanced by `SEARCH_STAGGER_MS`; (2) with all timers run, the final `{ perSource, interleaved }` membership matches the un-staggered expectation (reuse the existing fan-out fixtures); (3) aborting the signal during the stagger window stops later adapters from being invoked. Keep the existing onPartial/abort tests green.
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/openmusic && npx vitest --run src/lib/services/catalog.test.ts</automated>
  </verify>
  <done>`sleep` is exported from http.ts; `SEARCH_STAGGER_MS` is exported from catalog.ts and applied as a per-adapter staggered start in `searchAllUncached`; new stagger tests pass; all pre-existing catalog tests (onPartial streaming, abort suppression, cache-hit, fan-out membership) still pass.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Harden prefetchNext into a bounded forward-resolve loop</name>
  <files>src/lib/stores/player.svelte.ts, src/lib/stores/player.svelte.test.ts</files>
  <behavior>
    - prefetchNext walks forward from `queue[indexOf(current)+1]`, attempting `ensureTrackDetails` on each candidate, until it lands one that is PLAYABLE (`detailsLoaded && audioUrl` present after resolve — cover is best-effort and does NOT block: if cover is absent the existing async cover tier still applies, so do not fail a candidate solely on a missing cover) OR it exhausts a bounded number of candidates.
    - A candidate whose resolve REJECTS (transient proxy failure) or resolves WITHOUT an audioUrl is skipped, and the loop moves to the next queue entry — it does NOT give up after the first hiccup.
    - The loop is BOUNDED: it tries at most `PREFETCH_MAX_CANDIDATES` (propose 4) candidates per invocation, then stops (never spins forever, never blocks play()).
    - The loop is ABORTABLE and stale-guarded: it reuses the single `prefetchController` (a superseding prefetch aborts the in-flight one) and the `seedUid` / `current?.uid === seedUid` stale-guard, so a `current` change mid-loop discards remaining work and never clobbers the queue. The `prefetchingUid` in-flight dedupe still prevents a duplicate concurrent loop for the same starting target.
    - On landing a playable candidate, the resolved track is written in-place into its queue slot (same in-place sync play() does) and `prewarmNextAssets(resolved)` warms audio+cover — so the later play() no-ops. An already-complete first candidate still short-circuits and just warms assets (today's fast path is preserved).
    - prefetchNext remains best-effort: fired as `void this.prefetchNext()` from primeNext()/play(); never throws; never bumps playGen; never calls next()/runFallback/tripLoopGuard — it composes with the never-stop chain, it does not replace it.
  </behavior>
  <action>
    In `src/lib/stores/player.svelte.ts`, add a private constant `private static PREFETCH_MAX_CANDIDATES = 4;` near `FAILURE_CAP`. Rewrite `prefetchNext()` (lines ~1121-1166) into a bounded forward-resolve loop while preserving every existing guard:

    1. `i = indexOf(current); if (i < 0) return;`
    2. Compute the candidate window: indices `i+1 .. min(i+PREFETCH_MAX_CANDIDATES, queue.length-1)`. If none, return (end of queue — growth stays ensureAhead's job).
    3. ALWAYS `preloadNextCover(queue[i+1])` up front (preserve current cover-warm-of-the-immediate-next behavior).
    4. First-candidate fast path: if `queue[i+1]` is already complete (`detailsLoaded && audioUrl && (lrc || !lrcUrl)`) → `prewarmNextAssets(queue[i+1])` and return (unchanged).
    5. In-flight dedupe: if `prefetchingUid === queue[i+1].uid` return (the loop is keyed to the immediate-next uid, same as today).
    6. Supersede + claim: `prefetchController?.abort(); prefetchingUid = queue[i+1].uid; prefetchController = new AbortController(); const sig = this.prefetchController.signal; const seedUid = this.current?.uid;`
    7. try-block loop over the candidate window (in queue order): for each `target`:
       - if `sig.aborted` break.
       - if target already complete → that's the landing slot: write nothing (already resolved), `prewarmNextAssets(target)`, break.
       - `let resolved; try { resolved = await ensureTrackDetails(target, sig); } catch { continue; }` (skip on transient reject — move to next candidate).
       - Stale-guard AFTER the await: if `this.current?.uid !== seedUid` break (current changed away — discard remaining work, never clobber).
       - if `!resolved.audioUrl` → `continue` (resolved but unplayable; try next candidate).
       - LANDED: locate the slot freshly — `const j = this.indexOf(this.current); const slot = j + 1 + offsetWithinWindow`? Simpler and matches today's contract: only ever write back the slot whose uid still equals `target.uid` relative to the recomputed current. Recompute `const idx = this.queue.findIndex((t) => t.uid === target.uid);` and write `this.queue[idx] = resolved` ONLY if `idx >= 0` AND `idx > this.indexOf(this.current)` (still ahead of current). Then `prewarmNextAssets(resolved); break;`
       Note: prefer recomputing the target slot by uid at write-time (Pitfall 1 — never a closed-over index) so a queue mutation mid-loop cannot write the wrong slot.
    8. catch (outer): best-effort — leave queue as-is.
    9. finally: clear the in-flight guard ONLY if `prefetchingUid` still equals the immediate-next uid claimed in step 6 (a superseding prefetch may have claimed a newer uid) — same pattern as today.

    Do NOT alter `prewarmNextAssets`, `preloadNextAudio`, `preloadNextCover`, `ensureAhead`, `primeNext`, `next()`, `runFallback`, or any playGen/CR-03 machinery. The loop must remain a pure pre-resolve optimization that composes with them.

    In `src/lib/stores/player.svelte.test.ts`, extend the existing `player.prefetchNext` describe with: (a) "skips a candidate whose resolve REJECTS and lands the next playable one" — queue [cur, badStub, goodStub]; mockEnsure rejects for badStub, resolves goodStub with audioUrl → assert queue slot for goodStub is written, badStub untouched, assets warmed for the landed track; (b) "skips a candidate that resolves WITHOUT audioUrl and lands the next" — mockEnsure resolves badStub with `audioUrl: null` then goodStub with a url; (c) "respects PREFETCH_MAX_CANDIDATES — tries at most N candidates then stops" — queue of N+2 all-rejecting stubs → assert mockEnsure called at most N times and queue unchanged; (d) preserve/adapt the existing in-flight dedupe + stale-current tests (current changes mid-loop → no write-back). Reuse `mk`/`stub`/`deferred`/`flush`/`installAssetPreloadMocks`.
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/openmusic && npx vitest --run src/lib/stores/player.svelte.test.ts</automated>
  </verify>
  <done>prefetchNext advances through bounded candidates, skipping rejecting / no-audioUrl candidates and landing the first playable one; the candidate cap, abort, and stale-current guards all hold; new tests pass and ALL pre-existing player tests (never-stop, CR-03, fallback, stale-guard, dedupe) stay green.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <what-built>
    (1) A ~200ms inter-source stagger on the concurrent search fan-out so proxies are no longer hit in the same instant.
    (2) A bounded, abortable forward-resolve prefetch loop that keeps resolving the next song through queue candidates until it lands one with a real audioUrl — instead of giving up after a single source hiccup.
    Node unit tests cover the stagger ordering/abort and the forward-resolve skip/land/cap/stale logic. They CANNOT cover the real-device requirement: that the audio element actually begins to STREAM the prefetched URL (the `canplay`/byte-buffering confirmation depends on a live CDN + real mobile browser audio stack and is out of scope for node/vitest). This step verifies that on-device behavior + the user-felt first-search latency.
  </what-built>
  <how-to-verify>
    1. Run the app locally on a real phone (or the deployed preview): `cd /Users/laichan/code/tung/openmusic && npm run dev`, open on an iOS Safari + an Android Chrome device.
    2. FIRST-SEARCH FEEL: search a common song. Confirm results still appear promptly (the ~200ms stagger should not feel slower than before; partial results should still stream in as each source lands).
    3. NEVER-STOP RELIABILITY: start a song and let it auto-advance through several tracks (lock the screen for part of it to confirm background audio still advances). Confirm the player keeps moving forward to a song that actually plays, rather than stalling on an unresolved next track.
    4. TRANSIENT-FAILURE REPRO: queue/play through a stretch where the previously-reported stall happened (a song that "plays when tapped but stalled on auto-advance"). Confirm auto-advance now lands a playable next song instead of stalling.
    5. NO REGRESSION: confirm manual next/prev, repeat-one, the loop-guard "stopped" notice on a genuinely dead track, and offline behavior are all unchanged.
  </how-to-verify>
  <resume-signal>Type "approved" if first-search feel is unchanged AND auto-advance reliably lands playable songs on-device, or describe the issues observed.</resume-signal>
</task>

</tasks>

<verification>
- `npx vitest --run` passes the FULL suite (no regressions across player, catalog, discovery, fallback).
- `grep -n "export function sleep\|export const sleep" src/lib/proxy/http.ts` returns a match.
- `grep -n "SEARCH_STAGGER_MS" src/lib/services/catalog.ts` returns a match used in `searchAllUncached`.
- `grep -n "PREFETCH_MAX_CANDIDATES" src/lib/stores/player.svelte.ts` returns a match used in `prefetchNext`.
- Device verification (Task 3 checkpoint) confirms the audio `canplay`/streaming behavior that node cannot.
</verification>

<success_criteria>
- Concurrent search fan-out is staggered by a small configurable delay; first-search feel is preserved.
- prefetchNext keeps resolving forward through bounded candidates until a playable next song lands, surviving a single-source transient hiccup.
- The forward-resolve loop is bounded, abortable, stale-guarded, never blocks play(), and composes with (does not bypass) the existing never-stop / CR-03 / playGen contracts.
- New unit tests cover stagger ordering/abort and forward-resolve skip/land/cap/stale; the existing suite stays green.
- Device verification confirms on-device streaming reliability and unchanged first-search latency.
</success_criteria>

<output>
Create `.planning/quick/260613-fhw-gapless-prefetch/260613-fhw-SUMMARY.md` when done.
</output>
