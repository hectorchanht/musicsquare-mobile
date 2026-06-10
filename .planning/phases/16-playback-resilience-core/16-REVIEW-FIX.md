---
phase: 16-playback-resilience-core
fixed_at: 2026-06-10T10:22:43Z
review_path: .planning/phases/16-playback-resilience-core/16-REVIEW.md
iteration: 1
findings_in_scope: 12
fixed: 12
skipped: 0
status: all_fixed
---

# Phase 16: Code Review Fix Report

**Fixed at:** 2026-06-10T10:22:43Z
**Source review:** .planning/phases/16-playback-resilience-core/16-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 12 (3 Critical, 7 Warning, 2 Info)
- Fixed: 12
- Skipped: 0
- Not-a-bug: 0 (every finding was a real defect or a safe cleanup)

**Verification:** `pnpm test` → 43 files / 460 tests passed (was 445 before; +13 new + 2 updated regression tests, 1 new test file). `pnpm check` → 0 errors, 0 warnings.

**No new locale keys were added** (the 15-locale parity cost was avoided): WR-03/WR-07 reuse the existing `toast.playbackStopped` / `toast.offlineNoDownloads` / `toast.skipped` / `toast.skippedMany` keys, and IN-01 *removed* a dead key.

---

## Fixed Issues

### CR-01: success-reset + watchdog-disarm bound to the wrong media event

**Files modified:** `src/lib/stores/player.svelte.ts`, `src/lib/stores/player.svelte.test.ts`
**Commit:** e2a0b34
**Applied fix:** The D-06 counter reset and the D-13/D-14 stall-watchdog disarm were registered on the audio `play` event, which fires the instant `paused` flips false (readyState HAVE_NOTHING, before a byte loads). Split the listeners: `play` now only sets UI state (`playing`/`syncPlaybackState`); a new `playing` listener owns `hasPlayedSinceSrc = true`, `disarmStall()`, `consecutiveFailures = 0`, `errorBurst = 0`, episode-set reset, and the sticky-notice clear. Regression tests: a bare `play` no longer resets the counter or disarms the watchdog, and a run of error-event failures now climbs to `FAILURE_CAP` and trips the loop-guard. Updated the two stall-watchdog tests that fired `play` to fire `playing`, and added the inverse `play`-does-not-disarm test.
**Note:** Behavioral/logic binding change — locked by regression tests; worth a human confirm that the real iOS `playing` event semantics match (it does per the HTML media spec).

### CR-02: `play()` never re-checked `playGen` after its awaits

**Files modified:** `src/lib/stores/player.svelte.ts`, `src/lib/stores/player.svelte.test.ts`
**Commit:** 21bdef5
**Applied fix:** Snapshot `const myGen = this.playGen` immediately after the conditional `playGen++` bump, then bail `if (myGen !== this.playGen) return` after every await: the offline-blob IDB read, the main `ensureTrackDetails` resolve, and the CDN-branch blob lookup. Fallback continuations (`fromFallback`) inherit the gen they were started under, so they self-supersede. Regression test (deferred promises): a slow `play(A)` settling after a fast `play(B)` is discarded — `current` + `audio.src` stay on B.

### CR-03: unbounded resolve-but-unplayable A↔B fallback ping-pong

**Files modified:** `src/lib/services/fallback.ts`, `src/lib/services/dedupe.ts`, `src/lib/services/fallback.test.ts` (commit 0b4f2f1); `src/lib/stores/player.svelte.ts`, `src/lib/stores/player.svelte.test.ts` (commit a4553c7)
**Commits:** 0b4f2f1, a4553c7
**Applied fix:** Two complementary mechanisms.
1. **Per-episode attempted set** — `fallbackOrder` now also excludes an `attempted: Set<SourceId>`; `tryFallback` threads + populates it (marking each source *before* the await so a thrown/empty source still counts). `runFallback` maintains the set keyed by normalized title+artist (`episodeKey`), seeded with the failed source, so each source is tried at most once per logical song; once the order empties `tryFallback` returns null → `handleTotalFailure` → the counter engages. The set resets on a real `playing`, in `recoverFromStop`, and at episode change.
2. **`errorBurst` backstop** — the audio `error` listener counts raw error events since the last real `playing`; at `FAILURE_CAP` it breaks a failing repeat-one loop and trips the loop-guard directly (via the extracted `tripLoopGuard()`), covering 3+ resolve-but-unplayable sources where `tryFallback` keeps "succeeding".
Regression tests: `fallbackOrder` excludes attempted sources / empties at exhaustion; `tryFallback` populates + narrows the set; a ping-pong where `tryFallback` always returns a swap trips the cap via `errorBurst`.

### WR-01: `runFallback` had no re-entrancy guard

**Files modified:** `src/lib/stores/player.svelte.ts`
**Commit:** a4553c7
**Applied fix:** Added a `fallbackGen` field (-1 = idle). `runFallback` bails `if (this.fallbackGen === gen) return` and claims `this.fallbackGen = gen`, releasing it in `finally` only if it still belongs to that generation. Prevents the stall-watchdog fire + a late `error` event from running two concurrent fallbacks at the same gen (double `audio.src` swap / double counter increment / two skipped tracks for one failure).

### WR-02: `reresolveCurrent` wrote `audio.src` after an unguarded blob await

**Files modified:** `src/lib/stores/player.svelte.ts`, `src/lib/stores/player.svelte.test.ts`
**Commit:** c982252
**Applied fix:** Re-check `if (myGen !== this.playGen) return` after the downloaded-track `blobStore.get` await (the gap the existing post-`ensureTrackDetails` check didn't cover). Regression test drives `reresolveCurrent` with a deferred blob read, bumps `playGen` mid-read, and asserts a concurrent play's `audio.src` is not clobbered.

### WR-03: notice `msg` advertised t()-able tokens that existed in no dictionary

**Files modified:** `src/lib/stores/player.svelte.ts`
**Commit:** a4553c7
**Applied fix:** Chose option (a). `PlayerNotice.msg` is now typed `TranslationKey` (type-only i18n import — no runtime UI dependency, the store stays i18n-free). The store emits the real `toast.skipped`/`toast.skippedMany`/`toast.playbackStopped`/`toast.offlineNoDownloads` keys instead of the phantom `player.notice.*` tokens. Updated the contract doc comment.

### WR-04: stale `'skip'` notice resurrected on language change

**Files modified:** `src/lib/stores/player.svelte.ts` (commit a4553c7); `src/routes/(app)/+layout.svelte` (commit 8092dc9)
**Commits:** a4553c7, 8092dc9
**Applied fix:** Both ends. Store: `emitSkipNotice`'s debounce now clears the `'skip'` notice when the burst window closes, and `SKIP_BURST_WINDOW_MS` is raised to 2500 to match the host's `SKIP_DISMISS_MS` so the channel reaches "nothing to show" exactly when the toast leaves. Host: the `$effect`'s text computation is wrapped in `untrack()` so the only reactive dependency is `player.notice` identity — a `settings.appLang` change (read transitively by `t()`) no longer re-runs the effect against a stale notice.

### WR-05: stall watchdog ignored an explicit user pause

**Files modified:** `src/lib/stores/player.svelte.ts`, `src/lib/stores/player.svelte.test.ts`
**Commit:** c982252
**Applied fix:** Disarm the watchdog in the `pause` listener (a pause during the initial-load window means the user opted out of this load), mirroring the `ended` disarm. This was masked before CR-01 by the early `play`-event disarm and became reachable after CR-01. Regression test: a `pause` during the load window → no failover at the timeout.

### WR-06: `tryFallback` adopted `candidates[0]` with no identity check

**Files modified:** `src/lib/services/fallback.ts`, `src/lib/services/dedupe.ts`, `src/lib/services/fallback.test.ts`
**Commit:** 0b4f2f1
**Applied fix:** Exported `sameSongKey(a, b)` from `dedupe.ts` (reusing its own `key()` normalization; a blank/untitled key never matches). `tryFallback` now adopts `candidates.find((c) => sameSongKey(c, failed))` instead of `candidates[0]`, so a fuzzy upstream search returning an unrelated song is rejected (continue to the next source) rather than silently auto-playing the wrong track under the original's identity. Regression tests cover accept (case/punctuation-insensitive) and reject (wrong song never even resolved).

### WR-07: hardcoded English error strings beside localized toasts

**Files modified:** `src/lib/stores/player.svelte.ts` (commit a4553c7); `src/lib/i18n/index.ts`, `src/lib/components/Nowbar.svelte`, `src/lib/components/NowPlaying.svelte` (commit 8092dc9)
**Commits:** a4553c7, 8092dc9
**Applied fix:** Applied the token discipline to the `error` channel. The three hardcoded strings (`'playback failed…'` ×2, `'no playable audio…'`, `'offline — no downloaded tracks…'`) now store the existing `toast.playbackStopped` / `toast.offlineNoDownloads` i18n keys (no new keys → no parity cost). Nowbar and NowPlaying render `player.error` through a new tolerant `tMaybeKey()` helper: a known key is localized, while the catch-all dynamic exception message (`e.message`) falls through to render verbatim. A zh-Hant user now sees a single localized message instead of localized-toast + raw-English-inline.

### IN-01: dead `nowplaying.repeatModeAll` key in all 15 locales

**Files modified:** all 15 `src/lib/i18n/*.ts` dictionaries
**Commit:** 3584005
**Applied fix:** Removed the key (grep-verified zero consumers outside the dicts — the repeat-all mode was dropped in the PLAY-10/D-10 2-state collapse). The `Dict` type enforces consistent removal; the i18n parity test stays green.

### IN-02: `vi.stubGlobal('navigator', …)` never unstubbed

**Files modified:** `src/lib/stores/player.svelte.test.ts`
**Commit:** 286ba34
**Applied fix:** Added `vi.unstubAllGlobals()` to the top-level `afterEach` (since `vi.restoreAllMocks()` doesn't undo `stubGlobal`), then re-established the module-level `localStorage` stub that `unstubAllGlobals` also tears down (it's set once at import, and the restore()/persist() tests depend on it). Dropped the offline block's now-redundant `onLine:true` re-stub.

---

## Skipped Issues

None — all 12 in-scope findings were fixed.

## Not-a-bug Assessments

None — every finding in the review was confirmed a real defect (CR/WR) or a safe, consumer-free cleanup (IN-01/IN-02). No finding was reclassified.

## Notes on commit grouping

Per-finding atomicity was preserved where files were separable. Several Warnings were interleaved inside `src/lib/stores/player.svelte.ts` and only compile together (e.g. `tripLoopGuard` referencing a `toast.*` key requires the `msg: TranslationKey` type change), so they were grouped into compilable commits with the constituent finding IDs named in each message:
- CR-03 + WR-06 fallback-layer (0b4f2f1)
- CR-03 store + WR-01 + WR-03 + WR-04(store) + WR-07(store) (a4553c7)
- WR-04(UI) + WR-07(UI) (8092dc9)
- WR-02 + WR-05 (c982252)

---

_Fixed: 2026-06-10T10:22:43Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
