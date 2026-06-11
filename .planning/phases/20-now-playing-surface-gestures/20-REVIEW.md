---
phase: 20-now-playing-surface-gestures
reviewed: 2026-06-11T09:08:18Z
depth: standard
files_reviewed: 4
files_reviewed_list:
  - src/lib/actions/coverSwipe.ts
  - src/lib/actions/coverSwipe.test.ts
  - src/lib/components/NowPlaying.svelte
  - src/lib/components/Nowbar.svelte
findings:
  critical: 2
  warning: 5
  info: 3
  total: 10
status: issues_found
---

# Phase 20: Code Review Report

**Reviewed:** 2026-06-11T09:08:18Z
**Depth:** standard
**Files Reviewed:** 4
**Status:** issues_found

## Summary

Reviewed the new `coverSwipe` pointer-gesture action and its two host wirings (the
NowPlaying 3-cover carousel and the Nowbar mini-player slide). The Pitfall-7 invariant
the phase was most worried about — no `setPointerCapture` on `pointerdown`, sub-slop tap
reaching `onclick`, the one-shot trailing-click suppressor — is implemented correctly and
is well covered by the 16 passing unit tests. The vertical/horizontal axis arbitration
between `coverSwipe` (X) and the `.np-top` vertical-collapse handler (Y) is logically sound
at the JS layer.

However, the action's inline-style lifecycle is broken on two of the four exit paths. The
test suite only ever drives the **spring-back** and **boundary** branches to assertion on
`node.style.transform`, so it never catches that (a) the **commit** branch leaves the strip
frozen at its dragged-off offset, and (b) the **vertical-yield** branch leaks
`transition: none` onto the strip permanently. Both produce real visual defects on the
carousel because — unlike `swipeRemove`, whose node is removed from the DOM on commit — the
`coverSwipe` node persists across the track swap and keeps whatever inline styles the action
last wrote. There is also a `touch-action` arbitration claim in the markup comments that is
inverted relative to the actual CSS, and a hardcoded `hasNext: true` that defeats the
next-boundary rubber-band.

## Critical Issues

### CR-01: Committed swipe never resets `transform` — carousel freezes off-center after every track change

**File:** `src/lib/actions/coverSwipe.ts:156-170` (commit branch of `up()`); host
`src/lib/components/NowPlaying.svelte:773-789` (`.cover-strip`, no reset effect)

**Issue:** On the commit path `up()` calls `onprev()`/`onnext()` and then falls through to
`dx = 0` **without ever resetting `node.style.transform` or restoring `node.style.transition`.**
The last value written by `move()` was `node.style.transform = 'translateX(<dx>px)'` with
`node.style.transition = 'none'` (set in `down()`). The only branches that clear the transform
are the spring-back `else` (lines 167-168) and the boundary `resisting` branch (lines 152-153).

For `swipeRemove` this is harmless because the host removes the row from the DOM on commit, so
the leftover transform dies with the node. For `coverSwipe` the **node persists** across the
`player.prev()/next()` swap — `.cover-strip` is *not* inside any `{#key}` block (the only
`{#key player.current?.uid}` wraps `.meta`, NowPlaying.svelte:798-801), and there is **no
`bind:this` on `.cover-strip` and no `$effect` that resets the inline style** after a commit.
Result: after a committed LEFT swipe (onnext) the strip stays at e.g. `translateX(-100px)` with
`transition: none`, so the freshly-swapped current cell (`left:0`) renders ~100px off-center,
frozen, with no animation back to rest. Every committed carousel/nowbar swipe leaves the
surface visibly shifted.

The NowPlaying comment (lines 318-319) explicitly claims the action is "overridden to `none`
by the action while dragging, then restored on release" — that claim is **false for the commit
path**; the transition is only ever restored on the spring-back/boundary paths.

**Fix:** Reset/animate the transform on commit so the swapped cell settles to center. Minimal
correct version inside the commit branch:

```ts
if (Math.abs(dx) >= commitDist || (Math.abs(v) > FLICK_V && Math.abs(dx) > SLOP)) {
    if (dx > 0) onprev();
    else onnext();
    // The node persists across the store swap (unlike swipeRemove): re-enable the settle
    // transition and snap the strip back to rest so the new current cell is centered.
    node.style.transition = 'transform 0.32s cubic-bezier(.22,1,.36,1)';
    node.style.transform = 'translateX(0)';
} else {
    node.style.transition = 'transform 0.28s cubic-bezier(.22,1,.36,1)';
    node.style.transform = 'translateX(0)';
}
```

Add a test that fires a full committed drag and asserts `m.style.transform === 'translateX(0)'`
(the existing commit tests assert only that `onprev/onnext` fired, never the resting transform).

### CR-02: Vertical-yield path leaks `transition: none` onto the strip permanently

**File:** `src/lib/actions/coverSwipe.ts:105` (`down()` sets `transition: 'none'`
unconditionally) + `116-119` (vertical-yield) + `140-141` (`up()` early-return)

**Issue:** `down()` sets `node.style.transition = 'none'` on **every** pointerdown, including
taps and gestures that will turn out vertical. When the gesture is vertical-dominant, `move()`
sets `dragging = false` and returns (lines 116-119) so the `.np-top` collapse handler can take
over. The subsequent `pointerup` hits `up()`, which early-returns at `if (!dragging) return`
(line 141). **Nothing ever clears the `transition: none` that `down()` wrote.** So after any
vertical collapse gesture that *started on the cover*, `.cover-strip` is left with inline
`transition: none`, which beats its CSS `transition: transform 0.32s` (NowPlaying.svelte:991).
The next committed swipe's settle/spring-back then animates instantly (or, combined with CR-01,
not at all). The reduced-motion CSS (line 1005-1006) is also masked by this stuck inline value
for users who do *not* have reduced-motion set.

This is a state leak across gestures, not a one-frame glitch: it persists until the next
pointerdown that goes through a spring-back/boundary branch.

**Fix:** Either (a) only set `transition: 'none'` at the moment of horizontal commit (right
after `captured = true` in `move()`), not in `down()`; or (b) clear it on the vertical-yield
path and in the `up()` early-return. Option (a) is cleanest and matches "capture-only-in-move":

```ts
// in move(), at horizontal commit:
node.setPointerCapture(e.pointerId);
node.style.transition = 'none'; // freeze the follow only once we own the gesture
captured = true;
// ...and remove the `node.style.transition = 'none'` line from down().
```

## Warnings

### WR-01: `hasNext: true` is hardcoded in both hosts — the next-boundary rubber-band can never fire

**File:** `src/lib/components/NowPlaying.svelte:780`, `src/lib/components/Nowbar.svelte:77`

**Issue:** Both hosts pass `hasNext: true` literally and only compute `hasPrev`. The action's
boundary rubber-band (D-02 / UI-SPEC §2) therefore never engages for a LEFT (next) swipe. At a
genuine end-of-queue, a next swipe commits and fires `player.next()`, which (player.svelte.ts:1391-1399)
runs `ensureAhead().then(...)` — an async best-effort grow that may add nothing if generation
fails. The user gets a committed swipe (strip slides off, see CR-01) that resolves to "nothing
happened," with no rubber-band feedback, unlike the symmetric prev boundary which *does*
rubber-band. The inline comments rationalize this ("ensureAhead keeps a neighbor"), but that is
an assumption about an async, failure-prone code path, not a guarantee.

**Fix:** Derive `hasNext` the same way as `hasPrev`, e.g. in NowPlaying:
`hasNext: nextCover !== null` (you already compute `nextCover` at line 327). In Nowbar, derive a
`hasNextNeighbor` mirroring `hasPrevNeighbor`. This gives symmetric boundary feedback and avoids
a no-op committed swipe at the true end.

### WR-02: `ondrag` reports raw `dx` during the rubber-band, not the clamped offset

**File:** `src/lib/actions/coverSwipe.ts:127` vs `131-137`

**Issue:** During a resisting (boundary) drag, `ondrag?.(dx)` (line 127) emits the **raw**
finger delta, while the strip's own visible transform uses the damped `offset` (lines 133-134).
A host that drives its own surface from `ondrag` (the documented use case, lines 33-34) would
move 1:1 with the finger while the action's node rubber-bands — the two surfaces visibly
disagree at a boundary. NowPlaying currently only sinks `dx` into the unused `coverDragX`
(see IN-01), so it is latent today, but it is a correctness trap for any future host that uses
`ondrag`.

**Fix:** Report the value actually applied: compute `offset` first, then
`ondrag?.(resisting ? offset : dx)`.

### WR-03: `enabled` flipping to `false` mid-gesture leaves the surface stuck mid-drag

**File:** `src/lib/actions/coverSwipe.ts:84-85, 108-109, 140-141`; host
`src/lib/components/Nowbar.svelte:78` (`enabled: !resolving`)

**Issue:** `enabled` is only consulted in `down()` (line 85). If a drag is in progress
(`dragging === true`, possibly `captured`) and `update()` sets `enabled = false` (Nowbar does
this reactively the instant `resolving` becomes true — e.g. a track resolve kicks off mid-swipe),
`move()` and `up()` keep running because neither re-checks `enabled`. Conversely if the host
also flips the `<button disabled>` attribute, the element stops emitting pointer events, so a
captured pointer's `pointerup` may never reach `up()` — leaving `dragging`/`captured` true and
the strip frozen at its dragged offset (the pointer capture is also never released). This is an
edge case but it is reachable: a fast swipe that triggers a resolve before release.

**Fix:** Guard `move()`/`up()` on `enabled` too, and on `update()` when `enabled` goes false
mid-drag, force a cleanup (release capture if captured, reset transform/transition, clear
`dragging`/`captured`). At minimum, release pointer capture in `up()` and in `destroy()`.

### WR-04: Pointer capture is never explicitly released

**File:** `src/lib/actions/coverSwipe.ts:122, 140-171, 187-196`

**Issue:** `setPointerCapture` is called on horizontal commit but `releasePointerCapture` is
never called — not in `up()`, not in `destroy()`. Browsers implicitly release capture on
`pointerup`/`pointercancel` in the normal case, so this usually self-heals; but combined with
WR-03 (a `disabled` flip or an `enabled:false` update that prevents `up()` from running) or a
`destroy()` that fires while a pointer is still captured (component unmount mid-drag — entirely
possible since NowPlaying unmounts on `player.collapse()`), the capture and the
`dragging`/`captured` flags are left dangling. `swipeRemove` has the same omission, but its node
is typically removed cleanly; `coverSwipe`'s node lives on a long-lived overlay that can unmount
mid-gesture.

**Fix:** In `destroy()`, reset `dragging`/`captured` state; if you track `pointerId`, call
`node.releasePointerCapture(id)` defensively in `up()`/`destroy()` inside a try/catch.

### WR-05: A committed swipe followed by a real tap on touch can be swallowed by a stale suppressor

**File:** `src/lib/actions/coverSwipe.ts:78-82, 146`

**Issue:** On commit, `up()` arms the capture-phase `suppressClick` (line 146). On **mouse** a
trailing click fires and self-removes it. On **touch**, a committed swipe frequently produces
**no** trailing click, so the suppressor stays armed until the *next* `pointerdown` removes it
(line 88). Between those two events, if any other code path dispatches/bubbles a `click` to the
node (programmatic focus+click, assistive tech, a synthetic click from a parent), the FIRST such
click is swallowed even though the user intended it. The `down()` cleanup mitigates the common
pointer flow, but the window between a touch-commit and the next pointerdown is real. This is the
same idiom as `swipeRemove`, but `coverSwipe`'s node is a tap target (tap-to-collapse / tap-to-
expand), so a swallowed click is user-visible ("the tap did nothing") rather than benign.

**Fix:** Arm the suppressor with a short self-expiring timeout (`setTimeout(() =>
node.removeEventListener('click', suppressClick, true), 350)`) in addition to the
pointerdown-clear, so a touch-commit that never produces a click cannot eat a later genuine tap.
Clear that timer in `destroy()`.

## Info

### IN-01: `coverDragX` is dead state

**File:** `src/lib/components/NowPlaying.svelte:333, 778`

**Issue:** `coverDragX` is `$state(0)`, assigned in the `ondrag` callback, and read **nowhere**
(comment self-describes it as a "debug/extension hook"). It is dead reactive state that triggers
a re-render on every drag frame for no rendered effect, and the `ondrag` wiring exists only to
feed it.

**Fix:** Remove `coverDragX` and the `ondrag` option from the NowPlaying `use:coverSwipe` block
unless/until a host actually consumes the live dx. (If kept for the carousel strip follow, note
the action already drives `node.style.transform` itself, so `ondrag` is redundant here.)

### IN-02: Markup comment inverts the `touch-action` arbitration rationale

**File:** `src/lib/components/NowPlaying.svelte:749-752` (comment) vs CSS line 984 + action line 65

**Issue:** The axis-arbitration comment says `.np-top` "keeps `touch-action: pan-x` so the
wrapper yields the horizontal pan to the action." `touch-action: pan-x` reserves the **vertical**
axis for JS (it tells the browser to natively handle only horizontal panning), which is what the
*vertical-collapse* handler needs — the description of *why* is backwards relative to what
`pan-x` does. The action's own `pan-y` on `.cover-strip` correctly reserves the horizontal axis
for itself. The net behavior is fine; only the explanatory comment is misleading, which is a trap
for the next maintainer reasoning about a gesture-collision bug.

**Fix:** Reword the comment: `.np-top`'s `pan-x` reserves the **vertical** axis for the collapse
handler (browser keeps horizontal); the strip's `pan-y` reserves the **horizontal** axis for the
swipe (browser keeps vertical).

### IN-03: A sub-slop tap still writes `transition`/`transform` inline via the spring-back branch

**File:** `src/lib/actions/coverSwipe.ts:105, 165-169`

**Issue:** A pure tap (sub-slop) sets `transition: none` in `down()`, then on release falls into
the spring-back `else` branch (dx=0, low velocity) which writes `transition: 'transform 0.28s'`
and `transform: 'translateX(0)'`. So every tap leaves an explicit `translateX(0)` + a 0.28s
transition on the strip. Harmless visually, but it means a "tap" path touches layout-affecting
inline styles it never needed to, and slightly muddies the contract that taps are inert. The unit
test at line 93 already had to accept both `''` and `'translateX(0)'` to accommodate this.

**Fix:** In `up()`, only run the spring-back style writes when the gesture actually captured
(`if (captured) { ...spring back... }`), leaving a true tap's styles untouched.

---

_Reviewed: 2026-06-11T09:08:18Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
