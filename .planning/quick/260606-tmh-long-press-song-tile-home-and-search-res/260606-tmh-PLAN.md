---
phase: quick-260606-tmh
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/lib/actions/longpress.ts
  - src/lib/actions/longpress.test.ts
autonomous: true
requirements: [QUICK-260606-tmh]

must_haves:
  truths:
    - "Long-pressing a home top-pick tile (/) opens the TrackMenu and does NOT also start playback"
    - "Long-pressing a search-result row opens the TrackMenu and does NOT also start playback"
    - "A normal short tap on a home tile / search row still plays the track (tap-to-play preserved)"
    - "Long-press on the already-working lists (library / album / artist) and now-playing queue rows still opens the menu and does not regress"
  artifacts:
    - path: "src/lib/actions/longpress.ts"
      provides: "longpress action that suppresses the trailing click after a longpress fires"
      contains: "shouldSuppressClickAfterLongpress"
    - path: "src/lib/actions/longpress.test.ts"
      provides: "Node unit test for the pure suppress-after-longpress decision helper"
      contains: "shouldSuppressClickAfterLongpress"
  key_links:
    - from: "src/lib/actions/longpress.ts (timer callback)"
      to: "node click capture listener"
      via: "arm suppressNextClick = true when longpress dispatches"
      pattern: "suppressNextClick"
---

<objective>
BUG FIX: long-pressing a song tile on home (`/`) and a song row in search results does not surface the TrackMenu in practice — instead the track starts playing. The `use:longpress onlongpress={...}` wiring already exists and is byte-for-byte identical to the working library/album/artist lists, so this is a behavioral bug in the shared action, not missing wiring.

Root cause (confirmed against the code): `src/lib/actions/longpress.ts` dispatches a `longpress` CustomEvent after the 450ms hold but does NOT suppress the trailing native `click`. When the finger lifts after the hold, the element's `onclick` fires too. At every call site `onlongpress` sets `menuTrack`/`menuOpen=true` AND `onclick` runs:
- Home tile (`src/routes/(app)/+page.svelte:334`): `onclick={() => { player.setQueue(fallbackSongs); player.play(track); }}`
- Search row (`src/routes/(app)/search/+page.svelte:141`): `onclick={() => { player.setQueue(results); player.play(t); }}`

`player.play()` (`src/lib/stores/player.svelte.ts:374`) sets `this.expanded = true` when `settings.autoExpandOnPlay` is on, which pushes the full-screen NowPlaying overlay; even with auto-expand off, playback still starts unexpectedly. The library/album/artist lists only *appear* unaffected because their `onclick` plays without the same expand-overlay framing — but they ALSO fire a spurious play on long-press today. The correct fix repairs all sites uniformly at the action level.

Fix: mirror the EXISTING, proven repo idiom in `src/lib/actions/dragScroll.ts` (quick-260606-rvy FIX-B), which already suppresses a trailing click after a gesture via a one-shot CAPTURE-PHASE `click` listener plus a pure exported decision helper. Arm the suppressor when (and only when) the longpress timer fires; a normal short tap never arms it, so tap-to-play is preserved.

Purpose: long-press opens the context menu reliably and never double-fires playback, while short tap-to-play keeps working everywhere.
Output: updated `src/lib/actions/longpress.ts` + a node unit test for the pure decision helper.
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/execute-plan.md
@~/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@CLAUDE.md
@.planning/STATE.md

<interfaces>
<!-- The bug, the fix template, and the call sites. Use these directly — no further exploration needed. -->

CURRENT longpress action (the bug — dispatches longpress but never touches the trailing click)
From src/lib/actions/longpress.ts:
```typescript
export const longpress: Action<HTMLElement, number | undefined, { onlongpress: (e: CustomEvent) => void }> = (
  node,
  duration = 450
) => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let sx = 0; let sy = 0;
  const clear = () => { if (timer) { clearTimeout(timer); timer = null; } };
  const down = (e: PointerEvent) => {
    sx = e.clientX; sy = e.clientY; clear();
    timer = setTimeout(() => { timer = null; node.dispatchEvent(new CustomEvent('longpress')); }, duration ?? 450);
  };
  const move = (e: PointerEvent) => { if (timer && (Math.abs(e.clientX - sx) > 8 || Math.abs(e.clientY - sy) > 8)) clear(); };
  const ctx = (e: Event) => e.preventDefault();
  node.addEventListener('pointerdown', down);
  node.addEventListener('pointermove', move);
  node.addEventListener('pointerup', clear);
  node.addEventListener('pointerleave', clear);
  node.addEventListener('pointercancel', clear);
  node.addEventListener('contextmenu', ctx);
  return { destroy() { /* removes the six listeners above */ } };
};
```

THE FIX TEMPLATE — dragScroll already does exactly this (one-shot capture-phase click suppressor + pure helper)
From src/lib/actions/dragScroll.ts:
```typescript
export function shouldSuppressClick(totalDx: number, threshold = 6): boolean { return Math.abs(totalDx) > threshold; }
// ...
let suppressNextClick = false;            // armed by the gesture, eats the next click
function clickCapture(e: MouseEvent) {    // CAPTURE phase: intercept before the child button's onclick
  if (suppressNextClick) { e.preventDefault(); e.stopPropagation(); suppressNextClick = false; }
}
node.addEventListener('click', clickCapture, true); // true = capture
// destroy() removes it with the same `true` capture flag
```

EXISTING node-only test idiom (no jsdom — extract a pure helper and test that; DOM flow is manual)
From src/lib/actions/dragScroll.test.ts:
```typescript
import { describe, it, expect } from 'vitest';
import { shouldSuppressClick } from './dragScroll';
describe('shouldSuppressClick — drag-vs-tap threshold (FIX-B)', () => {
  it('a zero-movement release is a tap → no suppression', () => { expect(shouldSuppressClick(0)).toBe(false); });
  // ...
});
```

CALL SITES (already correctly wired — DO NOT edit; they are the regression surface to preserve)
- src/routes/(app)/+page.svelte:334  → `use:longpress onlongpress={() => { menuTrack = track; menuOpen = true; }} onclick={() => { player.setQueue(fallbackSongs); player.play(track); }}`
- src/routes/(app)/search/+page.svelte:141 → `use:longpress onlongpress={() => { menuTrack = t; menuOpen = true; }} onclick={() => { player.setQueue(results); player.play(t); }}`
- src/routes/(app)/library/+page.svelte:44,65,81 → `use:longpress onlongpress={() => openMenu(track)} onclick={() => playList(...)}` (working reference)

Vitest runs under the `node` project only (no jsdom client project) — see vite.config.ts. So the unit test MUST target a pure exported function, exactly like dragScroll.test.ts.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Suppress the trailing click after a longpress in the shared action (+ pure-helper unit test)</name>
  <files>src/lib/actions/longpress.ts, src/lib/actions/longpress.test.ts</files>
  <behavior>
    - shouldSuppressClickAfterLongpress(fired: boolean): returns `true` when a longpress fired (suppress the trailing click), `false` otherwise (a short tap → let onclick through). This is the pure decision helper, mirroring dragScroll's shouldSuppressClick.
    - Test 1: shouldSuppressClickAfterLongpress(true) === true (longpress fired → suppress play)
    - Test 2: shouldSuppressClickAfterLongpress(false) === false (short tap → tap-to-play preserved)
  </behavior>
  <action>
    Edit `src/lib/actions/longpress.ts` to suppress the trailing native `click` that fires after a longpress is dispatched, mirroring the EXISTING idiom in `src/lib/actions/dragScroll.ts` (quick-260606-rvy FIX-B). Do NOT touch any call site — the fix is action-level only so home, search, library, album, artist, and now-playing rows are all corrected uniformly.

    Concretely:
    1. Export a pure helper `shouldSuppressClickAfterLongpress(fired: boolean): boolean` that returns `fired` (true → suppress the click). This makes the decision unit-testable under the node-only vitest project, matching how dragScroll exports `shouldSuppressClick`. Document it with a short comment block (mirror dragScroll's tone) explaining WHY: the action dispatches `longpress` but the OS still fires a trailing `click`, which at every call site runs an `onclick` that starts playback — the menu opens but play also fires, so it looks like the menu "didn't open."
    2. Add a `suppressNextClick = false` flag inside the action closure.
    3. In the `setTimeout` callback, AFTER `node.dispatchEvent(new CustomEvent('longpress'))`, arm the suppressor by setting `suppressNextClick = true` (gated through `shouldSuppressClickAfterLongpress(true)`).
    4. Add a CAPTURE-PHASE click listener `clickCapture(e: MouseEvent)`: when `suppressNextClick` is set, call `e.preventDefault()` + `e.stopPropagation()` and reset `suppressNextClick = false`. Register with `node.addEventListener('click', clickCapture, true)` (the `true` capture flag is load-bearing — it must intercept BEFORE the element's own bubble-phase `onclick`). Remove it in `destroy()` with the same `true` flag.
    5. SAFETY DISARM (important — do not leave a stale armed flag that eats a future legitimate tap): some mobile browsers do NOT emit a synthetic `click` after a long hold. So when arming in the timer callback, also schedule a short self-disarm: `setTimeout(() => { suppressNextClick = false; }, 700)` (store the handle so `clear()`/`destroy()` can cancel it). This guarantees `suppressNextClick` is only ever true for the brief window in which a trailing click could arrive; a subsequent independent short tap is never swallowed.
    6. Keep all existing behavior intact: the >8px move cancel, the `contextmenu` preventDefault, and the pointerup/leave/cancel `clear()`. `clear()` must also cancel the pending disarm timer if present. Do NOT clear `suppressNextClick` on `pointerup` (the trailing click arrives AFTER pointerup, so disarming on pointerup would defeat the fix) — rely on the click handler and the safety-disarm timeout to reset it.

    Then create `src/lib/actions/longpress.test.ts` mirroring `src/lib/actions/dragScroll.test.ts`: import `shouldSuppressClickAfterLongpress` and assert Test 1 + Test 2 from the behavior block. Add a top comment noting the DOM capture-phase flow itself is verified manually (node project has no jsdom), exactly as dragScroll.test.ts documents.

    Avoid: do NOT add per-call-site guards, do NOT edit any `+page.svelte` / NowPlaying file, do NOT change the 450ms duration or the 8px move threshold, do NOT touch `player.svelte.ts` or `settings`.
  </action>
  <verify>
    <automated>pnpm check 2>&1 | tail -5 && pnpm test --run src/lib/actions/longpress.test.ts 2>&1 | tail -15</automated>
    <human-check>
      On a touch device / device-emulation: (1) Long-press a home top-pick tile (/) → TrackMenu opens and NO playback starts. (2) Long-press a search-result row → TrackMenu opens, no playback. (3) Short-tap a home tile and a search row → track plays as before. (4) Long-press a library/liked row → menu still opens (no regression).
    </human-check>
  </verify>
  <done>
    `pnpm check` reports 0 errors. `pnpm test --run` is fully green including the new longpress.test.ts (Test 1 + Test 2 pass). The longpress action exports `shouldSuppressClickAfterLongpress`, arms a one-shot capture-phase click suppressor when the longpress fires, and self-disarms within ~700ms. No call-site file was modified.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| user pointer input → UI action | Touch/click gestures are interpreted by `use:longpress`; misclassification (tap vs hold) is the bug surface. No network or untrusted-data boundary is crossed by this change. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-tmh-01 | Tampering (event flow) | longpress click suppressor | mitigate | Capture-phase one-shot + 700ms self-disarm ensures only the trailing click of an actual longpress is swallowed; a later independent tap is never eaten (covered by `shouldSuppressClickAfterLongpress(false) === false` test). |
| T-tmh-02 | Denial of Service (UX) | tap-to-play | accept | Worst case if suppressor mis-fires is one missed tap; self-disarm bounds it to a 700ms window. No persistence, no data loss. Low risk, no PII. |
| T-tmh-SC | Tampering (supply chain) | npm/pnpm installs | accept | No new dependencies are added by this plan; nothing to audit. |
</threat_model>

<verification>
- `pnpm check` → 0 errors (svelte-check strict).
- `pnpm test --run` → all existing tests green + new `src/lib/actions/longpress.test.ts` passing.
- Manual: the four human-check steps above pass on a touch device / emulator.
</verification>

<success_criteria>
- Long-press opens TrackMenu on BOTH the home tile and the search-result row, and does NOT also start playback.
- Short tap still plays the track on both surfaces (tap-to-play preserved).
- No regression on library/album/artist long-press or now-playing queue rows (action-level fix applies uniformly).
- `pnpm check` 0 errors; `pnpm test --run` green.
</success_criteria>

<working_tree_hygiene>
CRITICAL — Phase 14 is executing in PARALLEL; the working tree has unrelated in-flight changes.
- Stage ONLY the two files this plan edits, by explicit path:
  `git add src/lib/actions/longpress.ts src/lib/actions/longpress.test.ts`
- NEVER run `git add -A`, `git add .`, `git commit -a`, or any wildcard/all-files stage.
- Do NOT modify README.md or ROADMAP.md.
</working_tree_hygiene>

<output>
Create `.planning/quick/260606-tmh-long-press-song-tile-home-and-search-res/260606-tmh-SUMMARY.md` when done.
</output>
