---
phase: quick-260606-nqf
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/lib/components/NowPlaying.svelte
  - src/lib/actions/dragClose.ts
  - src/lib/gestures/velocity.ts
  - src/lib/gestures/velocity.test.ts
autonomous: true
requirements: [NQF-01, NQF-02, NQF-03]

must_haves:
  truths:
    - "A fast downward flick on the sheet steps it one state toward closed (full->half->closed) even when it barely moved in distance"
    - "A fast upward flick steps the sheet one state toward full (closed->half->full)"
    - "A fast downward flick on a modal/sheet using dragClose dismisses it even when not dragged past the distance threshold"
    - "A tap (small distance + low velocity) on a dragClose sheet still does NOT dismiss it (tap-preserving contract intact)"
    - "Half-open rests with the panel top flush at the post-reflow transport bottom - zero dead gap below the play-button row"
    - "On the lyrics tab in half mode, the active line auto-scrolls inside the panel WITHOUT expanding the sheet to full"
    - "Holding a finger on the lyrics list pauses auto-scroll; releasing resumes it"
  artifacts:
    - path: "src/lib/gestures/velocity.ts"
      provides: "Pure pointer-velocity tracker (sample/velocity/reset) reused by NowPlaying and dragClose"
      exports: ["createVelocityTracker"]
    - path: "src/lib/gestures/velocity.test.ts"
      provides: "Unit tests for velocity sampling/decay math"
    - path: "src/lib/components/NowPlaying.svelte"
      provides: "Velocity-aware sheet snap, post-reflow flush half offset, container-scoped lyrics scroll, touch-presence auto-scroll"
    - path: "src/lib/actions/dragClose.ts"
      provides: "Velocity-aware fast-flick dismiss preserving the tap contract"
  key_links:
    - from: "src/lib/components/NowPlaying.svelte"
      to: "src/lib/gestures/velocity.ts"
      via: "import createVelocityTracker"
      pattern: "createVelocityTracker"
    - from: "src/lib/actions/dragClose.ts"
      to: "src/lib/gestures/velocity.ts"
      via: "import createVelocityTracker"
      pattern: "createVelocityTracker"
---

<objective>
Close out three now-playing gesture regressions (follow-up to 260606-ggj / 260606-h4s):

1. Velocity/inertia snap - a fast flick should step the sheet one state in the flick direction even when it did not travel far (today the snap is distance-only, so fast short flicks bounce back). Same for modal dragClose.
2. Half-open gap (real root cause) - h4s measured the transport bottom DURING the cover's 0.32s reflow transition, so halfOffset overshoots by the cover-shrink delta. Measure the FINAL post-reflow position so the panel rests flush.
3. Lyrics tab - (a) auto-scroll uses scrollIntoView which walks ancestors and yanks the sheet to full in half mode; scope the scroll to the panel container. (b) Auto-scroll pauses on a fixed 2.5s idle timer; make it finger-presence-driven (pause while touching, resume shortly after release).

Purpose: Make the 3-state bottom sheet feel native (flick to dismiss/open) and fix the visible half-open gap plus the lyrics-tab jump-to-full and stuck-during-touch bugs.
Output: A pure velocity helper (+ tests) shared by both gesture surfaces, plus surgical edits to NowPlaying.svelte and dragClose.ts. UI layer only - no backend/data/player-store changes.
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/execute-plan.md
@~/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@./CLAUDE.md

<!-- PRIMARY: the 3-state snap machine, measureOffsets, lyrics effect, sheet/panel/lyrics markup -->
@src/lib/components/NowPlaying.svelte
@src/lib/actions/dragClose.ts

<!-- Prior fix that this plan CORRECTS. BUG 2 root cause: h4s read the transport bottom mid-reflow. -->
@.planning/quick/260606-h4s-fix-half-open-now-playing-remove-gap-bet/260606-h4s-SUMMARY.md

<interfaces>
<!-- Existing idioms the executor MUST match exactly (extracted from the two files in context). -->

NowPlaying.svelte - sheet snap machine (svelte 5 runes):
  type SheetState = 'closed' | 'half' | 'full';
  let sheetState = $state<SheetState>('closed');
  let transportEl = $state<HTMLElement | null>(null);   // bound on <div class="transport">
  let sheetDragY = $state(0);        // full-coordinate px (0 = full, closedOffset = closed)
  let sheetDragging = $state(false);
  let gripActive = $state(false);    // true only while finger is down
  let gripStartY = 0; let gripMoved = 0;
  let gripStartTab: Tab | null = null;  // subnav-tap priority - DO NOT BREAK
  let closedOffset = 300;            // plain let (read imperatively only)
  let halfOffset = $state(150);      // $state - resting-half transform reads it in markup
  function offsetFor(s: SheetState): number   // full->0, half->halfOffset, closed->closedOffset
  function measureOffsets(): void             // sets closedOffset + halfOffset from live layout
  function gripDown(e: PointerEvent)          // gripActive=true, measureOffsets(), sheetDragging=true
  function gripMove(e: PointerEvent)          // sheetDragY = clamp(start + gripMoved)
  function gripUp()                           // TAP branch (|gripMoved|<8) vs DRAG branch (snap)
  // DRAG settle: sheetDragY = offsetFor(target); snapTimer = setTimeout(..., 290)
  // settle CSS easing: transform 0.28s cubic-bezier(.22,1,.36,1)

NowPlaying.svelte - lyrics:
  let lyricsEl = $state<HTMLElement | null>(null);   // bound on <div class="lyrics"> (overflow handled by .panel)
  let autoScroll = $state(true);
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  function lyricsTouched()  // currently: autoScroll=false; setTimeout(()=>autoScroll=true, 2500)
  $effect(() => { /* on activeLine change, if tab==='lyrics' AND autoScroll: scrollIntoView */ });
  // markup: <div class="lyrics" bind:this={lyricsEl} onpointerdown={lyricsTouched} onwheel={lyricsTouched}>
  // CSS: .panel { flex:1; overflow-y:auto; }  .lyrics { text-align:center; line-height:2.1; }

dragClose.ts - Action<HTMLElement, DragCloseOpts>:
  interface DragCloseOpts { onclose: () => void; threshold?: number; enabled?: boolean; }
  // down(e)/move(e)/up() pointer handlers; up() dismisses when dy > threshold (default 120), else snap-back
  // tap-preserving: never preventDefault on down; dy<8 => no dismiss
  // snap-back CSS: transform 0.28s cubic-bezier(.22,1,.36,1)
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Pure velocity tracker (+ tests) and velocity-aware snap/dismiss in NowPlaying.gripUp and dragClose.up</name>
  <files>src/lib/gestures/velocity.ts, src/lib/gestures/velocity.test.ts, src/lib/components/NowPlaying.svelte, src/lib/actions/dragClose.ts</files>
  <behavior>
    velocity.ts exports createVelocityTracker() returning an object with:
      - sample(clientY: number, timeStamp: number): void - records a (y, t) point, keeping only the last 2-3 points (trim the buffer).
      - velocity(): number - px/ms from the last two samples (delta-y / delta-t). Positive = moving DOWN (clientY increasing), negative = UP. Returns 0 when fewer than 2 samples OR when delta-t <= 0 (guard divide-by-zero).
      - reset(): void - clears samples (called on pointer down / drag start so a new gesture does not inherit the previous one's velocity).
    Tests (velocity.test.ts) assert, using synthetic numeric timeStamps (NO Date.now / performance.now):
      - Test 1: two samples 100px apart over 100ms -> velocity approx +1.0 px/ms (down).
      - Test 2: upward motion (clientY decreasing) -> negative velocity.
      - Test 3: fewer than 2 samples -> velocity() === 0.
      - Test 4: delta-t === 0 between the last two samples -> velocity() === 0 (no Infinity / NaN).
      - Test 5: reset() clears history -> velocity() back to 0.
      - Test 6: only the most recent points are used (an old far-apart sample does not skew a fresh reading).
  </behavior>
  <action>
    Create src/lib/gestures/velocity.ts exporting createVelocityTracker() per the behavior block. Tiny dependency-free pure module (UI gesture helper - the player-store/data layer is untouched). Use the last two samples for velocity; trim the buffer to at most 3 points inside sample. Treat timeStamp as the caller-supplied event time (e.timeStamp) - do NOT call Date.now / performance.now inside the module, so it stays deterministic and SSR-safe.

    Wire into NowPlaying.svelte gripUp DRAG branch (the |gripMoved| >= 8 path - currently the nearest-by-position+bias snap). Add a component-scope const gripVel = createVelocityTracker(). In gripDown: call gripVel.reset() then gripVel.sample(e.clientY, e.timeStamp). In gripMove: call gripVel.sample(e.clientY, e.timeStamp). In gripUp DRAG branch: compute const v = gripVel.velocity() and define a tuned const V = 0.5 (px/ms). If Math.abs(v) > V, STEP ONE state in the flick direction regardless of position - down (v > 0): full->half, half->closed, closed->closed (clamp at end); up (v < 0): closed->half, half->full, full->full (clamp). Otherwise fall back to the EXISTING nearest-by-position+bias snap (leave that block exactly as-is). In both cases assign sheetDragY = offsetFor(target) and keep the existing snapTimer = setTimeout(() => { sheetState = target; sheetDragging = false; sheetDragY = 0; }, 290) settle and the 0.28s cubic-bezier(.22,1,.36,1) easing. Do NOT touch the TAP branch (|gripMoved| < 8), gripStartTab subnav-tap priority, or gripKey.

    Wire into dragClose.ts up(). Add const vel = createVelocityTracker() in the action closure. In down: call vel.reset() then vel.sample(e.clientY, e.timeStamp). In move: call vel.sample(e.clientY, e.timeStamp). In up(): compute const v = vel.velocity() and define const V = 0.5. Dismiss (resetTransform(); onclose();) when dy > threshold OR (v > V AND dy > 8) - a fast downward flick dismisses even when not dragged far. Otherwise keep the existing snap-back. PRESERVE the tap-preserving contract: a tap is dy < 8 with low velocity => no dismiss; do not add preventDefault on down. Keep the Action<HTMLElement, DragCloseOpts> shape, update / destroy, and the existing snap-back easing untouched.
  </action>
  <verify>
    <automated>npm test -- velocity 2>&1 | tail -20 && npm run check 2>&1 | tail -5</automated>
  </verify>
  <done>velocity.test.ts passes (all 6 cases green); npm run check reports 0 errors / 0 warnings; createVelocityTracker is imported and used in both NowPlaying.svelte (gripDown reset+sample, gripMove sample, gripUp DRAG-branch velocity step) and dragClose.ts (down reset+sample, move sample, up velocity-or-distance dismiss). TAP branch, gripStartTab priority, and the dragClose tap contract unchanged.</done>
</task>

<task type="auto">
  <name>Task 2: Post-reflow flush half offset, container-scoped lyrics scroll, touch-presence auto-scroll</name>
  <files>src/lib/components/NowPlaying.svelte</files>
  <action>
    THREE surgical fixes in NowPlaying.svelte, all UI-layer.

    FIX A - post-reflow flush half offset (BUG 2 real cause). h4s measureOffsets() reads transportEl.getBoundingClientRect().bottom while the .cover 0.32s width/height/margin reflow is MID-transition, so halfOffset overshoots by the cover-shrink delta -> the visible gap. Make the RESTING-half value reflect the FINAL post-reflow transport position. Implement: in the resting-half $effect (currently: if (sheetState === 'half' AND !sheetDragging) measureOffsets();), defer the measurement until the cover reflow has settled. Preferred robust approach (no magic layout constants): listen for the cover's transitionend. Add let coverEl = $state<HTMLElement | null>(null) and bind:this={coverEl} on the <div class="cover">; in the resting-half effect, if coverEl is present add a one-shot coverEl.addEventListener('transitionend', measureOffsets, { once: true }) AND also schedule a double-requestAnimationFrame plus a ~340ms setTimeout fallback that calls measureOffsets() (covers cases where no transition fires - tap-entering half when already reflowed, or prefers-reduced-motion). Clean up the listener + timeout in the effect's teardown return so nothing leaks or fires after the sheet leaves half. Keep measureOffsets() itself unchanged (still clamps Math.max(20, Math.min(closedOffset - 20, halfOffset))), keep the live-drag measureOffsets() call in gripDown (live drag reads live position - correct). The resting .sheet transform must keep reading the $state halfOffset so the re-measured flush value re-renders. Do NOT alter the cover-reflow CSS transition itself; do NOT touch the back-gesture single-dismiss $effect.

    FIX B - container-scoped lyrics scroll (BUG 3a). Replace el.scrollIntoView({ behavior: 'smooth', block: 'center' }) in the active-line $effect with manual scroll math on the bounded scroll CONTAINER so it never walks ancestors / expands the sheet. The actual overflow-y:auto container is .panel (the .lyrics div is inside it). Resolve the container at effect time as const container = lyricsEl?.closest('.panel') as HTMLElement | null; guard on null, then container.scrollTo({ top: el.offsetTop - container.clientHeight / 2 + el.offsetHeight / 2, behavior: 'smooth' }). Note el.offsetTop is relative to the offset parent - verify the active line centers in the panel during the manual walkthrough; if offsets resolve against .lyrics rather than .panel, account for the .lyrics offsetTop within the container. Keep the effect guards (tab !== 'lyrics' || !autoScroll || idx < 0 || !lyricsEl) and the querySelectorAll('p')[idx] lookup unchanged. Result: scrolling stays inside .panel and NEVER changes sheetState.

    FIX C - touch-presence auto-scroll (BUG 3b). Replace the fixed 2.5s idle timer with finger-presence control. Keep the autoScroll and idleTimer declarations but change lyricsTouched() to ONLY set autoScroll = false (and clear any pending resume timer). Add lyricsReleased() that schedules a short grace re-enable: if (idleTimer) clearTimeout(idleTimer); idleTimer = setTimeout(() => (autoScroll = true), 600); (~400-800ms to avoid fighting momentum scroll). On the <div class="lyrics"> element keep onpointerdown={lyricsTouched}. For onwheel (no release event exists) point it at a small handler that pauses then schedules the same 600ms resume (e.g. call lyricsTouched() then lyricsReleased()). ADD onpointerup={lyricsReleased} and onpointercancel={lyricsReleased}. Net behavior: auto-scroll pauses while a finger is down on the lyrics and resumes ~600ms after release (and ~600ms after the last wheel event) instead of a blind 2.5s timer.
  </action>
  <verify>
    <automated>npm run check 2>&1 | tail -5; grep -n "closest('.panel')" src/lib/components/NowPlaying.svelte; grep -n "transitionend" src/lib/components/NowPlaying.svelte; grep -n "lyricsReleased" src/lib/components/NowPlaying.svelte; grep -q 'scrollIntoView' src/lib/components/NowPlaying.svelte && echo "FAIL: scrollIntoView still present" || echo "OK: scrollIntoView removed"</automated>
  </verify>
  <done>npm run check reports 0 errors / 0 warnings; scrollIntoView no longer appears in NowPlaying.svelte (replaced by container.scrollTo math on .panel); coverEl is bound and the resting-half effect re-measures on transitionend + rAF/timeout fallback with teardown cleanup; lyricsReleased exists and is wired to onpointerup/onpointercancel; lyricsTouched only pauses.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| user touch input -> pointer/wheel handlers | Untrusted client-side gesture events (clientY, timeStamp) cross into the snap-state machine. No network, no persistence, no privilege boundary. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-nqf-01 | Denial of Service | velocity() divide-by-zero / NaN on identical timeStamps | mitigate | velocity() returns 0 when delta-t <= 0 or fewer than 2 samples (covered by Test 4); no Infinity/NaN propagates into the transform |
| T-nqf-02 | Tampering | event listener / timeout leak (transitionend, rAF, setTimeout) re-firing after the sheet leaves half | mitigate | resting-half $effect teardown removes the one-shot listener and clears the fallback timeout; once:true on the listener |
| T-nqf-SC | Tampering | npm/pip/cargo installs | accept | No new dependencies added; velocity.ts is dependency-free in-repo code. No package-manager install tasks in this plan. |
</threat_model>

<verification>
- npm run check: 0 errors / 0 warnings (svelte-check over the full project).
- npm test: full vitest suite green (89+ tests), including the new velocity.test.ts cases. No service/data tests touched.
- Grep gates: createVelocityTracker imported in NowPlaying.svelte and dragClose.ts; closest('.panel') and transitionend and lyricsReleased present in NowPlaying.svelte; scrollIntoView absent from NowPlaying.svelte.

Manual on-device walkthrough (touch device or DevTools touch emulation - could not be auto-verified):
1. FAST FLICK DOWN: from near-full (~90% open), a quick short downward flick steps full->half (or half->closed); does NOT bounce back.
2. FAST FLICK UP: a quick short upward flick steps closed->half->full.
3. SLOW DRAG fallback: a slow drag still snaps to the nearest state by position+bias (unchanged).
4. HALF FLUSH: drag/tap to half-open - the subnav panel top sits flush at the transport bottom with NO dead gap; panel fills remaining height and scrolls.
5. LYRICS HALF STAYS HALF: on the lyrics tab in half mode, as lines advance the active line auto-centers WITHIN the panel and the sheet stays half (does NOT jump to full).
6. TOUCH PAUSE / RELEASE RESUME: holding a finger on the lyrics pauses auto-scroll; releasing resumes it ~600ms later. Wheel scrolling also pauses then resumes.
7. MODAL FAST-FLICK DISMISS: a fast downward flick on a dragClose modal/sheet dismisses it even when not dragged past 120px; a tap (dy<8, low velocity) still does NOT dismiss.
8. REGRESSIONS: closed<->full grip drag, full state, cover drag-down-to-collapse, queue reorder, subnav-tap tab priority, Last.fm enrichment, lyrics translation, and the back-gesture single dismiss (Back closes menu -> now-playing -> navigates) all still work.
</verification>

<success_criteria>
- Velocity-aware snap: a fast flick steps one state in the flick direction in both NowPlaying (gripUp) and dragClose (up), with the existing distance/position snap preserved as the slow-drag fallback and the tap contract intact.
- Half-open rests flush at the post-reflow transport bottom with zero gap (BUG 2 closed at its real root cause).
- Lyrics auto-scroll is panel-container-scoped (no sheet expansion) and finger-presence-driven (pause on touch, resume after release).
- npm run check 0/0 and the full vitest suite (incl. velocity.test.ts) green.
- No backend/data/player-store changes; no new dependencies; no new i18n keys.
</success_criteria>

<output>
Create .planning/quick/260606-nqf-now-playing-gesture-fixes-velocity-inert/260606-nqf-SUMMARY.md when done
</output>
