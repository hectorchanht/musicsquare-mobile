---
phase: 16-playback-resilience-core
reviewed: 2026-06-10T10:01:10Z
depth: standard
files_reviewed: 23
files_reviewed_list:
  - src/lib/stores/player.svelte.ts
  - src/lib/services/fallback.ts
  - src/lib/services/downloads-queue.ts
  - src/lib/services/downloads-queue.test.ts
  - src/lib/stores/player.svelte.test.ts
  - src/lib/components/NowPlaying.svelte
  - src/routes/(app)/+layout.svelte
  - src/lib/i18n/en.ts
  - src/lib/i18n/zh-Hant.ts
  - src/lib/i18n/zh-Hans.ts
  - src/lib/i18n/es.ts
  - src/lib/i18n/fr.ts
  - src/lib/i18n/de.ts
  - src/lib/i18n/pt.ts
  - src/lib/i18n/it.ts
  - src/lib/i18n/ru.ts
  - src/lib/i18n/tr.ts
  - src/lib/i18n/ar.ts
  - src/lib/i18n/hi.ts
  - src/lib/i18n/id.ts
  - src/lib/i18n/vi.ts
  - src/lib/i18n/th.ts
findings:
  critical: 3
  warning: 7
  info: 2
  total: 12
status: issues_found
---

# Phase 16: Code Review Report

**Reviewed:** 2026-06-10T10:01:10Z
**Depth:** standard
**Files Reviewed:** 23
**Status:** issues_found

## Summary

Reviewed the Phase 16 playback-resilience engine (failure counter, 5-skip loop-guard, offline gate + downloads queue, 15s stall watchdog, prefetch-on-ended, `player.notice` channel), the layout toast host, and i18n key parity across all 15 locales.

**i18n verdict: clean.** All 15 locale dictionaries were diffed programmatically — key sets are byte-identical (269 keys each), every non-en dict is typed `const x: Dict = {...}` (compile-time parity enforcement), the 5 new keys (`toast.skipped`, `toast.skippedMany`, `toast.playbackStopped`, `toast.retry`, `toast.offlineNoDownloads`) exist in all 15 files, and the `{title}`/`{count}` interpolation tokens survived every translation. `downloads-queue.ts` is also clean — pure, never-throws, well tested.

**Resilience engine verdict: the central loop-guard mechanism is defeated in its most common path.** The 38 unit tests pass, but they mock `player.play()` and never simulate the HTML media element's real event sequence — which is exactly where three Critical defects live: the success-reset listens to the wrong media event (`play` instead of `playing`), `play()` itself has no generation re-check after its awaits (the exact stale-resolve race class this review was asked to scrutinize), and a resolve-but-unplayable source pair produces an unbounded A↔B fallback ping-pong that never increments the failure counter.

## Critical Issues

### CR-01: Loop-guard success-reset and stall-watchdog disarm are bound to the `play` event, which fires before any audio loads — FAILURE_CAP is unreachable in the dominant failure path

**File:** `src/lib/stores/player.svelte.ts:489-502`
**Issue:** The D-06 "success reset" (`consecutiveFailures = 0`, sticky-notice clear) and the D-13/D-14 watchdog disarm (`hasPlayedSinceSrc = true; disarmStall()`) are registered on `el.addEventListener('play', ...)`. Per the HTML media spec, `play` fires the moment `paused` flips false (i.e. immediately inside `audio.play()`, at `readyState = HAVE_NOTHING`, before a single byte loads). `playing` is the event that means audio actually started — the code comments throughout (lines 102-104, 493, 496-499) say "a real `playing` event", but no `playing` listener exists anywhere in the file (verified by grep).

Consequences:
1. **The 5-failure loop-guard (D-04) never trips for error-event failures.** Auto-skip chain: `next()` → `play(B)` → `audio.play()` → `play` event fires instantly → `consecutiveFailures = 0` → the dead URL's `error` event arrives later → `handleTotalFailure` increments 0→1. The counter oscillates 0↔1 forever; the cap of 5 is unreachable whenever the failure mode is "URL resolves but errors at the element" (expired/region-locked CDN URLs — the codebase's own documented dominant failure). The player auto-skips indefinitely, which is exactly the runaway D-04 was built to stop. The cap only works for the two rarer paths (`!resolved.audioUrl`, rejected `play()`), which is why the tests — which drive `runFallback` directly and mock `play()` — pass.
2. **The stall watchdog is disarmed ~instantly on every accepted `play()`.** `armStall()` runs, then `await audio.play()` fires `play` → `disarmStall()`. The "play() accepted but media never loads, no error event" silent-stall case (D-13) is therefore unprotected; only the rejected-play() case survives.

**Fix:**
```ts
el.addEventListener('play', () => {
    this.playing = true;          // UI state only — `play` means paused flipped, not audio
    this.syncPlaybackState();
});
el.addEventListener('playing', () => {
    // D-13/D-14 + D-06: `playing` means audio is actually producing output.
    this.hasPlayedSinceSrc = true;
    this.disarmStall();
    this.consecutiveFailures = 0;
    if (this.notice?.kind === 'stopped') this.notice = null;
});
```
(Keep the existing `timeupdate` disarm as the belt-and-braces second signal.) Add a test that fires `play` followed by `error` per skip and asserts the counter still reaches the cap.

### CR-02: `play()` never re-checks `playGen` after its awaits — a stale slow resolve clobbers a newer play

**File:** `src/lib/stores/player.svelte.ts:795-939`
**Issue:** `playGen` is bumped at the top of `play()` (line 808) but is only ever checked by `runFallback`, `armStall`, and `reresolveCurrent` — never by `play()` itself. Trace: user taps A (`play(A)`, gen→1, `ensureTrackDetails(A)` takes ~8s on a slow proxy), then taps B (`play(B)`, gen→2, resolves in 1s, B starts playing). When A's resolve finally settles, its continuation runs unguarded: `this.current = resolved-A` (line 863), `persist()`, Media Session metadata = A, `audio.src = A-url`, `audio.play()` — the earlier, slower tap hijacks playback from the track the user actually chose. The same hole exists in the offline-blob branch (the `await blobStore.get` at line 822) and in fallback continuations (`fromFallback` deliberately doesn't bump the gen, so it must check against the value it inherited). This is precisely the stale-resolve race class the generation guard was introduced for, but the guard is not consulted on the main path.

**Fix:** snapshot the generation after the (conditional) bump and bail after every await:
```ts
if (!opts?.fromFallback) this.playGen++;
const myGen = this.playGen;
...
if (library.isDownloaded(track.uid)) {
    const offlineBlob = await blobStore.get(track.uid).catch(() => null);
    if (myGen !== this.playGen) return;   // superseded mid-IDB-read
    ...
}
const resolved = await ensureTrackDetails(track);
if (myGen !== this.playGen) return;       // superseded mid-resolve — discard
...
if (library.isDownloaded(resolved.uid)) {
    const blob = await blobStore.get(resolved.uid).catch(() => null);
    if (myGen !== this.playGen) return;
    ...
}
```
Add a deferred-promise test: `play(A)` slow, `play(B)` fast, settle A last, assert `current` and `audio.src` stay on B.

### CR-03: Resolve-but-unplayable sources cause an unbounded A↔B fallback ping-pong that bypasses the failure counter entirely

**File:** `src/lib/stores/player.svelte.ts:1028-1069`, `src/lib/services/fallback.ts:20-27,55-79`
**Issue:** `consecutiveFailures` is incremented only in `handleTotalFailure`, i.e. only when `tryFallback` returns `null`. But the common region-lock failure mode is: the detail fetch *resolves* a URL fine, and only the `<audio>` element's actual byte fetch 403s (`error` event). Trace with two enabled sources:

1. `play(A-netease)` → `error` → `runFallback(A-netease)` → `fallbackOrder` excludes only `netease` → finds A on qq, `resolved.audioUrl` truthy → `play(A-qq, fromFallback)`.
2. A-qq's URL 403s at the element → `error` → `runFallback(A-qq)` → `fallbackOrder(qq)` excludes only `qq` — **netease is back in the order** → re-resolves A-netease (resolve succeeds; only playback fails) → `play(A-netease, fromFallback)`.
3. → `error` → goto 1. Forever.

Each cycle burns 1-2 proxy round-trips plus an element error; `tryFallback` "succeeds" every time so `handleTotalFailure` never runs, `consecutiveFailures` never increments, no `playing` event ever fires, and no notice is shown (successful failover is silent by design, D-01). The never-stop engine becomes never-advance, with unbounded network traffic against third-party proxies. Note this is independent of CR-01 — fixing the event binding does not cap this loop, because the counter is never incremented at all on this path.

**Fix:** make the *audio-error → runFallback* entry itself count as a failure attempt for the current logical song, and/or thread an "already-attempted sources" set through the fallback chain so each source is tried at most once per song. Minimal version:
```ts
// In the error listener (non-seek branch), before runFallback:
this.errorBurst++;                       // reset to 0 on a real `playing` event
if (this.errorBurst >= Player.FAILURE_CAP) {
    this.handleTotalFailure(failed);     // trip the existing loop-guard / skip policy
    return;
}
void this.runFallback(failed);
```
or carry `attempted: Set<SourceId>` on the fallback chain: `tryFallback(failed, preferred, signal, attempted)` and have `fallbackOrder` exclude every member, treating exhaustion of the set as total failure.

## Warnings

### WR-01: `runFallback` has no re-entrancy guard — stall watchdog + a late `error` event run two concurrent fallbacks at the same generation

**File:** `src/lib/stores/player.svelte.ts:1028-1069`
**Issue:** Both the stall watchdog (15s) and the `error` listener route into `runFallback`, and a successful fallback's `play(swap, { fromFallback: true })` deliberately does not bump `playGen`. So if the watchdog fires at 15s and a slow CDN error event lands at 16s, two `runFallback` calls run concurrently with the *same* gen — both pass every gen check. Outcomes: two swaps raced onto `audio.src`, or both reaching `handleTotalFailure` (counter += 2, `next()` called twice → two tracks skipped for one failure).
**Fix:** add an in-flight guard keyed to the generation:
```ts
private fallbackGen = -1;
private async runFallback(failed: Track) {
    if (this.fallbackGen === this.playGen) return; // already failing-over this play
    this.fallbackGen = this.playGen;
    try { ... } finally { if (this.fallbackGen === this.playGen) this.fallbackGen = -1; ... }
}
```

### WR-02: `reresolveCurrent` writes `audio.src` after an unguarded await — stale seek-recovery can clobber a newer play

**File:** `src/lib/stores/player.svelte.ts:343-368`
**Issue:** The gen check (line 338) runs after `ensureTrackDetails`, but for downloaded tracks there is a second await (`blobStore.get`, line 349) between the check and `audio.src = src` (line 359). A `play()` that lands inside that IDB-read window gets its freshly set src overwritten with the *old* track's URL plus an `audio.play()` — wrong audio under the new track's metadata.
**Fix:** re-check after the blob await:
```ts
const blob = await blobStore.get(resolved.uid).catch(() => null);
if (myGen !== this.playGen) return; // a newer play() landed mid-IDB-read
```

### WR-03: Notice-channel contract advertises `msg` as a t()-able token, but `player.notice.*` keys exist in no dictionary

**File:** `src/lib/stores/player.svelte.ts:61-66,1105,1137,1180`; `src/lib/i18n/en.ts`
**Issue:** The `PlayerNotice` contract states "`msg` holds a stable token key for hosts that prefer a direct lookup" and "16-03 maps … via `t()`". The store emits `'player.notice.skip'`, `'player.notice.loopGuard'`, `'player.notice.offline'` — none of which exist in any of the 15 dicts (the actual host uses `toast.*` keys instead; verified by grep — zero consumers of `notice.msg`). A future host following the documented contract would render the raw token string (via `lookupKey`'s raw-key fallback), and `t(n.msg)` wouldn't even typecheck since `msg: string` is not a `TranslationKey`.
**Fix:** either (a) change the emitted tokens to the real keys (`'toast.skipped'`/`'toast.skippedMany'`, `'toast.playbackStopped'`, `'toast.offlineNoDownloads'`) and type `msg: TranslationKey`, or (b) rewrite the doc comment to state `msg` is a non-i18n diagnostic tag and the structured fields are the only supported mapping input.

### WR-04: Store never clears a `'skip'` notice; the layout effect's hidden `t()` dependency resurrects dismissed toasts on language change

**File:** `src/routes/(app)/+layout.svelte:47-76`; `src/lib/stores/player.svelte.ts:1133-1146`
**Issue:** Only `'stopped'` notices are ever cleared by the store (on the play event). After the host's 2.5s auto-dismiss, `player.notice` still holds the stale `'skip'` object. The host `$effect` calls `t(...)`, which reads `settings.appLang` (`$state`) — a tracked dependency. Any later language switch re-runs the effect, sees the stale notice, and re-shows "{n} songs skipped" out of nowhere with a fresh 2.5s timer (days later, potentially). The same stale notice would also re-toast if the layout ever remounts.
**Fix:** clear the channel in the store when the burst window closes, and align the host timer with it:
```ts
this.skipBurstTimer = setTimeout(() => {
    this.skipBurst = 0;
    this.skipBurstTimer = null;
    if (this.notice?.kind === 'skip') this.notice = null; // channel reflects "nothing to show"
}, Player.SKIP_BURST_WINDOW_MS);
```
(If the 1.5s window is too short a display time, raise `SKIP_BURST_WINDOW_MS`/`SKIP_DISMISS_MS` together, or additionally wrap the host's text computation in `untrack()` so only `player.notice` identity drives the effect.)

### WR-05: Stall watchdog ignores an explicit user pause — failover can auto-play against the user's intent

**File:** `src/lib/stores/player.svelte.ts:465-475`
**Issue:** The watchdog callback checks gen, `hasPlayedSinceSrc`, and `current` — but not whether the user has since paused. A user who starts a slow track and taps pause within the 15s window gets, 15s later, `runFallback` → `play(swap)` → `audio.play()`: music starts after an explicit pause. Today this path is masked by CR-01 (the early `play` event disarms everything); fixing CR-01 makes it reachable, so fix them together.
**Fix:** in the watchdog callback, bail when playback was explicitly paused: `if (this.audio?.paused && !this.playing && this.userPaused) return;` — simplest form: disarm the watchdog in the `pause` listener (a pause during initial load means the user opted out of this load), mirroring the `ended` disarm.

### WR-06: `tryFallback` adopts `candidates[0]` with no identity check — silent wrong-song substitution

**File:** `src/lib/services/fallback.ts:66-73`
**Issue:** The fallback searches `"{artist} {title}"` on another source and adopts the first deduped result unconditionally (`dedupeBest` preserves first-appearance order; it does not verify relevance). A fuzzy upstream search can return a different song entirely, which then auto-plays with zero user-visible indication (successful failover is silent by design, D-01) and is written into the queue slot (line 1054 of the store), replacing the original track's identity.
**Fix:** gate adoption on a normalized identity match before resolving, reusing the dedupe normalizer:
```ts
const stub = candidates.find((c) => sameSongKey(c, failed)); // normalized title+artist equality
if (!stub) continue;
```
where `sameSongKey` applies the same `key()` normalization `dedupe.ts` already uses (export it or duplicate the regex chain).

### WR-07: New hardcoded English error strings render beside localized toasts — mixed-language UI for the same event

**File:** `src/lib/stores/player.svelte.ts:1096,1179` (also pre-existing 878)
**Issue:** This phase added `this.error = 'playback failed (source may be region-locked or expired)'` (re-set in `handleTotalFailure`) and `this.error = 'offline — no downloaded tracks available'` (`handleOffline`). `player.error` is rendered verbatim in Nowbar (`Nowbar.svelte:52`) and NowPlaying (`NowPlaying.svelte:684-686`). A zh-Hant user offline therefore sees the localized toast "你目前離線 — 沒有已下載的歌曲可播放" and the raw English "offline — no downloaded tracks available" inline at the same moment. The phase went to the trouble of keeping the notice channel i18n-free with localized rendering, but the parallel `error` channel for the same events stayed hardcoded English.
**Fix:** apply the same token discipline to `error` — store a key (`'toast.offlineNoDownloads'`, a new `'error.playbackFailed'`) and have Nowbar/NowPlaying render `t(player.error)`; or set `error` to the same structured shape as `notice` and let the UI own wording.

## Info

### IN-01: `nowplaying.repeatModeAll` is a dead key in all 15 locales after the 2-state collapse

**File:** `src/lib/i18n/en.ts:195` (and the equivalent line in the other 14 dicts)
**Issue:** The repeat-all mode was removed (PLAY-10/D-10); grep finds zero consumers of `nowplaying.repeatModeAll` outside the dictionaries. 15 files carry a dead translation.
**Fix:** delete the key from `en.ts` and all 14 sibling dicts (the `Dict` type will enforce the removal everywhere).

### IN-02: Test hygiene — `vi.stubGlobal('navigator', ...)` is never unstubbed

**File:** `src/lib/stores/player.svelte.test.ts:488,669,674`
**Issue:** `vi.restoreAllMocks()` (the file's `afterEach`) does not undo `vi.stubGlobal`; the stubbed `{ onLine: ... }` navigator persists for the remainder of the worker. The offline suite re-stubs `onLine: true` on exit, which papers over it, but any later suite in this file relying on a *real* (absent-in-node) `navigator` — e.g. the `ms` accessor's feature detection — now sees a truthy navigator without `mediaSession`. Currently harmless (the `'mediaSession' in navigator` check still fails closed) but a latent ordering trap.
**Fix:** add `vi.unstubAllGlobals()` to the relevant `afterEach` blocks.

---

_Reviewed: 2026-06-10T10:01:10Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
