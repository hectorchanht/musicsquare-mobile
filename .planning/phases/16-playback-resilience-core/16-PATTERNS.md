# Phase 16: Playback Resilience Core - Pattern Map

**Mapped:** 2026-06-10
**Files analyzed:** 8 (3 primary modified, 5 supporting/analog)
**Analogs found:** 7 / 8 (1 cross-cutting gap with no analog — store→UI toast bridge)

> This phase is **policy + wiring + UI on an existing engine**, not new subsystems. The
> failover (`runFallback`/`tryFallback`), prefetch (`prefetchNext`), queue-growth
> (`ensureAhead`/`regenerate`), and generation-guard (`playGen`) primitives already exist
> in `src/lib/stores/player.svelte.ts`. Almost every "analog" is therefore an **in-file
> sibling pattern** — the code you copy lives in the same file you are editing. Match the
> existing style precisely (it is dense, comment-heavy, generation-guarded).

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/lib/stores/player.svelte.ts` (MODIFY) | store | event-driven | itself (in-file siblings: `runFallback`, `prefetchNext`, `cycleRepeat`, `restore`) | exact (self) |
| `src/lib/services/fallback.ts` (likely MODIFY) | service | request-response | itself (`tryFallback` loop) | exact (self) |
| `src/lib/components/NowPlaying.svelte` (MODIFY — repeat 2-state) | component | event-driven | in-file repeat button (line 706-708) + shuffle button (line 700) | exact (self) |
| Skip / loop-guard toast surface (NEW or MODIFY) | component | event-driven | `+page.svelte` toast (210-216, 797) / `NowPlaying.svelte` npToast (34-39, 793) | role-match |
| Store→UI message channel for sticky toast (NEW — see "No Analog") | store→UI bridge | pub-sub | `player.error` → `Nowbar.svelte:52` (one-way reactive read) | partial |
| i18n keys for skip/loop-guard/offline (MODIFY all 15 locales) | config | n/a | `en.ts` `toast.*` block (239-254) | exact |
| Offline downloads-queue builder (NEW — player or service, planner's call) | service | transform | `ensureAhead` (510-524) + `library.isDownloaded`/`blobStore.get` usage in `play` (683-709) | role-match |
| `src/lib/stores/player.svelte.test.ts` (MODIFY/EXTEND) | test | n/a | itself (deferred-promise + gen-timing harness, 44-60) | exact |

## Pattern Assignments

### `src/lib/stores/player.svelte.ts` — failure counter + skip-on-total-failure (PLAY-07, PLAY-08)

**Analog:** in-file `runFallback` (lines 870-898) + the `error` listener (421-447).

**The existing total-failure exit point you hook into** — `runFallback`, lines 891-893:
```typescript
// Every remaining source exhausted — surface the error as before.
this.error = 'playback failed (source may be region-locked or expired)';
this.clearMedia();
```
This is the single place "all sources failed for this song" is known. The skip-and-count
policy (D-02, D-04, D-05) replaces these two lines: instead of just setting `this.error`,
increment a consecutive-failure counter, emit the skip toast, and call `this.next()` —
UNLESS the counter trips the loop-guard (~5, D-04), in which case pause + emit the sticky
toast and do NOT advance.

**Generation-guard discipline to copy** (runFallback, 870-883) — every new async resilience
path MUST snapshot `playGen` and bail if a newer `play()` superseded it:
```typescript
const gen = this.playGen;
// ...
const watchdog = setInterval(() => {
	if (this.playGen !== gen) ac.abort();
}, 200);
try {
	const swap = await tryFallback(failed, settings.preferredSource, ac.signal);
	if (this.playGen !== gen) return; // a newer play() supersedes — discard silently
```

**Counter-reset hook** (D-06) — add to the `play` event listener (attach, 372-375):
```typescript
el.addEventListener('play', () => {
	this.playing = true;
	this.syncPlaybackState();
	// PLAY-08 add: reset consecutive-failure counter on a real `playing` event (D-06).
});
```
Note `playing` is the *play* event; a successful start is the natural counter reset.

**Rejected `play()` promises count as failures (D-06)** — current code swallows them. There
are FOUR `void audio.play().catch(() => {})` sites that must be revisited (271/295 reresolve,
414 repeat-one ended, 703/760 play): the milestone locks "never silent `.catch(() => {})`".
The `play` listener firing is the success signal; a rejection that produces NO subsequent
`play` event is the failure signal. Example site, `play()` line 760-762:
```typescript
this.audio.src = src;
await this.audio.play().catch(() => {
	/* autoplay may require a gesture — the controls still work */
});
```

### `src/lib/stores/player.svelte.ts` — stall timeout → failover (PLAY-07 / D-13, D-14)

**Analog:** the `error` listener (421-447) is the existing "treat as failure → runFallback"
entry. D-13 adds a ~15s initial-load watchdog that routes into the SAME `runFallback(failed)`
path when a freshly started track produces no audio.

**Pattern to copy for the timer constant + private field** (mirror `SEEK_ERROR_WINDOW_MS`,
308-309):
```typescript
private lastSeekAt = 0;
private static SEEK_ERROR_WINDOW_MS = 1500;
```
Add a `private static STALL_TIMEOUT_MS = 15000;` and a `private stallTimer` cleared on the
`playing`/`timeupdate`/`error` events. **D-14 mid-track distinction:** only arm the stall
watchdog on initial load (no `timeupdate` has fired since src-set), NOT when the buffer runs
dry mid-track — copy the timeupdate listener (380-386) as the "we are actually playing, disarm
stall" signal.

**AbortController interaction (Claude's discretion, line 49 of CONTEXT):** `runFallback`
already owns an `AbortController` + 200ms watchdog (874-880). The stall timeout fires BEFORE
runFallback starts, so it just calls `void this.runFallback(this.current)` — runFallback's
own gen-guard handles supersedence.

### `src/lib/stores/player.svelte.ts` — repeat 2-state (PLAY-10 / D-10, D-11, D-12)

**Analog:** in-file `cycleRepeat` (857-861), the `ended` repeat-one branch (406-420), and
`next()` repeat-all branch (804-820).

**D-10 — collapse to off ↔ one.** Current `cycleRepeat`, lines 858-860:
```typescript
cycleRepeat() {
	this.repeatMode = this.repeatMode === 'off' ? 'one' : this.repeatMode === 'one' ? 'all' : 'off';
	this.persist();
}
```
Becomes a 2-state toggle (`off → one → off`). Type at line 77 (`'off' | 'one' | 'all'`) and
the `repeatMode` field, the persist payload (140), the restore type (169), and the `next()`
repeat-all branch (810-813) all reference `'all'` — D-10/D-11 remove the `'all'` arm.

**D-11 — migrate persisted `'all'` → `'off'` at restore.** Current restore assignment, line 200:
```typescript
this.repeatMode = payload.repeatMode ?? 'off';
```
Becomes one-line map: `this.repeatMode = payload.repeatMode === 'one' ? 'one' : 'off';`
(any persisted `'all'` or missing value collapses to `'off'`).

**D-12 — repeat-one + total failure BREAKS repeat.** The repeat-one loop lives in the `ended`
listener (412-418); but a *failure* of the looping track flows through the `error` listener →
`runFallback`. In the runFallback total-failure exit (891-893), before skipping: if
`this.repeatMode === 'one'`, set it to `'off'` first, then toast + continue with up-next.
Never-stop wins over explicit repeat.

### `src/lib/services/fallback.ts` — offline gate (PLAY-09 / D-08)

**Analog:** in-file `tryFallback` per-source loop (45-69). The gate is `navigator.onLine`.

**Where the gate lands (D-08):** offline resolve failures must NOT burn the loop-guard
counter. The cleanest gate is at the **caller** (`runFallback` in player.svelte.ts, before
calling `tryFallback`) so the counter logic sees "offline ≠ failure". `tryFallback`'s loop
already swallows per-source throws (64-66) and returns null on exhaustion — the caller cannot
distinguish "offline" from "all sources genuinely dry" without checking `navigator.onLine`
itself. Add the check in `runFallback`:
```typescript
// D-08: offline → do NOT enter the failure chain / burn the counter.
if (typeof navigator !== 'undefined' && navigator.onLine === false) { /* offline path */ }
```
The signal-abort pattern in `tryFallback` (54, 57, 60, 62) is the template for any new
abortable step.

### `src/lib/stores/player.svelte.ts` — offline auto-switch to downloads (PLAY-09 / D-07)

**Analog:** `ensureAhead` (510-524) for queue growth + the offline-blob branch in `play`
(683-709) and `restore` (208-234) for downloaded-track playback.

**Queue-from-downloads builder** — mirror `ensureAhead`'s guarded best-effort shape (510-524):
```typescript
private async ensureAhead() {
	if (this.growing) return;
	const i = this.indexOf(this.current);
	if (i < 0 || this.queue.length - i > 2) return;
	this.growing = true;
	try {
		const have = new Set(this.queue.map((t) => t.uid));
		const more = await buildDiversePicks(8, have);
		if (more.length) this.queue = dedupeBest([...this.queue, ...more], settings.preferredSource);
	} catch { /* sources dry — leave the queue as-is */ } finally { this.growing = false; }
}
```
The downloads source is `library` Downloads + `blobStore` — already imported and used in `play`
(683-689):
```typescript
if (library.isDownloaded(track.uid)) {
	const offlineBlob = await blobStore.get(track.uid).catch(() => null);
	if (offlineBlob && this.audio) { /* play straight from local blob */ }
}
```
**Where it lives (Claude's discretion):** CONTEXT D-07 + line 47 leaves player-vs-service open.
A pure builder in a service (testable in node, like `picks.ts`/`similar.ts`) fed into
`this.queue = dedupeBest(...)` matches "services never throw; stores never import the player."

### `src/lib/components/NowPlaying.svelte` — repeat button 2-state (PLAY-10 / D-10)

**Analog:** the in-file repeat button (706-708) and the icon imports (line 6).

**Current 3-state button** (706-708):
```svelte
<button class="t" class:on={player.repeatMode !== 'off'} aria-label={player.repeatMode === 'one' ? t('nowplaying.repeatModeOne') : player.repeatMode === 'all' ? t('nowplaying.repeatModeAll') : t('nowplaying.repeat')} onclick={() => player.cycleRepeat()}>
	{#if player.repeatMode === 'one'}<Repeat1 size={20} />{:else}<Repeat size={20} />{/if}
</button>
```
2-state: drop the `'all'` arm of the aria-label ternary. Icon logic already only branches
one/else, so it needs no change. `Repeat1`/`Repeat` already imported (line 6). The
`'nowplaying.repeatModeAll'` key (en.ts:195) becomes dead — leave or remove per i18n-parity
cost.

### Skip / loop-guard toast surface (PLAY-08 / D-02, D-03, D-04, D-05)

**Analog:** `+page.svelte` toast (210-216 logic, 797 markup, 862 CSS) and `NowPlaying.svelte`
npToast (34-39, 793). These are the canonical component-local toast pattern.

**Component-local toast logic** (`+page.svelte`, 210-216):
```typescript
let toastMsg = $state('');
let toastTimer: ReturnType<typeof setTimeout> | null = null;
function toast(m: string) {
	toastMsg = m;
	if (toastTimer) clearTimeout(toastTimer);
	toastTimer = setTimeout(() => (toastMsg = ''), 2000);
}
```
**Markup + transition** (`+page.svelte`, 797):
```svelte
{#if toastMsg}<div class="toast" transition:fly={{ y: -20, duration: 180 }}>{toastMsg}</div>{/if}
```
**CSS** (`+page.svelte`, 862): pill, fixed top, `z-index: 90`, `border-radius: 999px`.

**Critical adaptation for D-02/D-04:** these existing toasts are **auto-dismissing and
action-less** — perfect for the skip toast (D-03 confirms no action button on skip toasts).
But the **loop-guard sticky toast (D-04) needs (a) persistence — no auto-dismiss timer, and
(b) a Retry action button** — neither exists in any current toast. This is new UI on top of
the existing pattern. D-05: Retry / tap-play → `this.next()` + counter reset (NOT
retry-current, NOT regenerate). The skip-burst batching (D-02 "{n} songs skipped") needs a
counter + a debounce window (Claude's discretion on the window) layered on the `toast()`
helper above.

## Shared Patterns

### Generation guard (`playGen`) — apply to EVERY new async playback path
**Source:** `player.svelte.ts` field (79-82), usage in `play` (670), `runFallback` (871, 883),
`reresolveCurrent` (264, 270), `prefetchNext` (564, 571).
```typescript
private playGen = 0;
// at start of an async path:
const myGen = this.playGen;
// ... await something ...
if (myGen !== this.playGen) return; // newer play() superseded — discard silently
```
**Apply to:** stall-timeout handler, skip/counter logic, offline-switch builder. PITFALLS.md
flags stale-fallback races + generation-guard discipline as the top P-FAILOVER risk.

### AbortController + watchdog for in-flight async
**Source:** `runFallback` (874-880) and `prefetchNext` (560-563).
```typescript
this.prefetchController?.abort();          // supersede prior in-flight
this.prefetchController = new AbortController();
const sig = this.prefetchController.signal;
```
**Apply to:** any new resolve-ahead / offline-queue step that can be superseded.

### Best-effort, never-throw async (`void this.x()`; try/catch swallow)
**Source:** `ensureAhead` (510-524), `regenerate` (785-796), `prefetchNext` (578-587),
fired non-blocking from `play` (766-772). Services never throw — null-return + degrade
(`fallback.ts` 64-66; `blobStore.get(...).catch(() => null)` throughout `play`).
**Apply to:** offline-queue builder, prefetch trigger extension.

### Persist on imperative state change
**Source:** `persist()` (125-146) + `persistThrottled()` (148-154); called from `setQueue`
(484), `cycleRepeat` (860), `toggleShuffle` (842/854), `play` (717).
```typescript
private persist() {
	if (!browser) return;
	// ... localStorage.setItem(STATE_KEY, JSON.stringify({ v: 1, ..., repeatMode: this.repeatMode }))
}
```
**Apply to:** repeat 2-state change (cycleRepeat already calls persist — keep it). The
`repeatMode` is in the payload (140) and restore (200) — the D-11 migration is in restore.

### i18n: reactive `t(key)` + 15-locale parity
**Source:** `i18n/index.ts` `t()` (106-108); `TranslationKey = keyof typeof en` (45) makes a
missing key a COMPILE error. New keys MUST be added to `en.ts` AND all 14 other locale files.
**Apply to:** every new skip/loop-guard/offline toast string. D-03 locks "keep new i18n keys
minimal." Reuse `toast.noAudio` (en.ts:242) / `home.unplayable` (27) where wording fits before
adding new keys. Existing `toast.*` block to mirror: en.ts lines 239-254.

## No Analog Found

| File / Need | Role | Data Flow | Reason |
|-------------|------|-----------|--------|
| Store→UI sticky-toast channel | store→UI bridge | pub-sub | No global toast store exists. Every toast today is **component-local** (`+page.svelte`, `NowPlaying.svelte`, `TrackMenu.svelte` each own a private `toastMsg` `$state`). The never-stop chain originates **inside the player store** (`runFallback` total-failure, stall timeout), which currently surfaces messages ONLY via the reactive `player.error` string read by `Nowbar.svelte:52` and `NowPlaying.svelte:684`. A sticky toast WITH a Retry button and skip-burst batching cannot be expressed as a plain `error` string. Planner must decide: (a) add a small reactive channel on the player store (e.g. `player.notice = $state<{msg, action?}>`) consumed by a layout-level toast host, mirroring the `player.error → Nowbar` one-way read; or (b) extend the component-local pattern with a store-driven trigger. Option (a) matches the "stores never import the player; UI reads store state reactively" convention and is the only clean home for a store-originated sticky toast. The Retry action (D-05) calls `player.next()` + resets the counter — a method on the store. |
| Loop-guard sticky toast (persistent + action button) | component | event-driven | The persistent + Retry-button toast is genuinely new UI; existing toasts are all auto-dismiss + action-less (see Skip toast section). Build on the `+page.svelte` toast CSS/markup but add no-timer + a button. |

## Metadata

**Analog search scope:** `src/lib/stores/`, `src/lib/services/`, `src/lib/components/`,
`src/lib/i18n/`, `src/lib/actions/`, `src/routes/(app)/`, `src/routes/+layout.svelte`
**Files scanned:** player.svelte.ts (958 lines, full read), fallback.ts (69, full), i18n/index.ts
(full), NowPlaying.svelte (repeat/toast sections), +page.svelte (toast sections),
player.svelte.test.ts (harness), Nowbar.svelte (error/now-bar), plus greps across all 15 locale
files, TrackMenu.svelte, overlays/library/settings stores, +layout.svelte.
**Pattern extraction date:** 2026-06-10
**Canonical refs to read before planning (from CONTEXT):** `.planning/research/SUMMARY.md`,
`.planning/research/PITFALLS.md` (P-FAILOVER: infinite skip loop, iOS play() rejection after
async src swap, stale-fallback races, generation-guard discipline), `.planning/research/ARCHITECTURE.md`.
