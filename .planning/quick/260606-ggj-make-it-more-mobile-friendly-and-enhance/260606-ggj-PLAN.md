---
phase: quick-260606-ggj
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/lib/components/NowPlaying.svelte
  - src/lib/components/TrackMenu.svelte
  - src/lib/actions/dragClose.ts
  - src/lib/stores/overlays.svelte.ts
  - src/lib/i18n/en.ts
  - src/lib/i18n/zh-Hant.ts
  - src/lib/i18n/zh-Hans.ts
autonomous: false
requirements: [GGJ-DRAG, GGJ-BACK, GGJ-SHEET3, GGJ-REFLOW, GGJ-MOBILE]
must_haves:
  truths:
    - "Every TrackMenu bottom-sheet (menu, playlist picker, detail) follows the finger down and snaps closed past ~120px or snaps back below it"
    - "The OS/browser back gesture closes the topmost open overlay instead of navigating away"
    - "The now-playing sheet has three snap states: closed (peek), half-open (~50%), and full"
    - "Dragging the subnav row moves the sheet through its snap states; a tap on a subnav item still switches tab"
    - "Clicking a subnav item while the sheet is closed opens it to half and reflows the cover to a full-bleed banner that overlaps the header and meta"
    - "All existing behavior is preserved: cover drag-collapse, queue reorder, lyrics auto-scroll, tab switching, i18n"
  artifacts:
    - path: "src/lib/actions/dragClose.ts"
      provides: "Reusable Svelte action: finger-following translateY drag-to-dismiss for any sheet element"
      min_lines: 30
    - path: "src/lib/stores/overlays.svelte.ts"
      provides: "Centralized overlay stack + History API back-to-close wiring (push on open, popstate closes topmost)"
      min_lines: 30
    - path: "src/lib/components/NowPlaying.svelte"
      provides: "Three-state sheet snap machine, subnav-as-drag-handle, cover-squeeze reflow on half-open"
    - path: "src/lib/components/TrackMenu.svelte"
      provides: "drag-to-close on all 3 sheets via use:dragClose"
  key_links:
    - from: "src/lib/components/TrackMenu.svelte"
      to: "src/lib/actions/dragClose.ts"
      via: "use:dragClose on each .menu/.modal element"
      pattern: "use:dragClose"
    - from: "src/lib/stores/overlays.svelte.ts"
      to: "window.history / popstate"
      via: "pushState on open, popstate listener closes topmost"
      pattern: "popstate|pushState"
    - from: "src/lib/components/NowPlaying.svelte"
      to: "src/lib/stores/overlays.svelte.ts"
      via: "register/unregister now-playing overlay close handler"
      pattern: "overlays\\."
---

<objective>
Mobile-UX + gesture overhaul of the now-playing experience and all bottom-sheets. Make every draggable surface dismissable by finger-drag-down AND by the OS back gesture, turn the now-playing sheet into a 3-state (closed / half-open / full) snap machine driven by both the grip and the subnav row, and reflow the cover into a full-bleed YouTube-Music-style banner when the sheet is half/full open.

Purpose: The app should feel native on a phone — sheets follow the finger, back closes overlays instead of leaving the page, and the now-playing screen reorganizes itself like YT Music when the user wants to browse the queue/lyrics.
Output: A reusable `dragClose` action, a centralized `overlays` back-gesture store, and a refactored `NowPlaying.svelte` + `TrackMenu.svelte`.
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/execute-plan.md
@~/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@CLAUDE.md

# PRIMARY FILES — read fully before editing
@src/lib/components/NowPlaying.svelte
@src/lib/components/TrackMenu.svelte
@src/lib/stores/player.svelte.ts
@src/routes/(app)/+layout.svelte
@src/lib/actions/longpress.ts

<interfaces>
<!-- Existing idioms to MIRROR exactly. Svelte 5 runes ($state/$derived/$effect). No new deps. -->

Existing live-drag pattern in NowPlaying.svelte (cover drag-collapse):
- coverDown(e: PointerEvent): dragging=true; startY=e.clientY; (e.currentTarget).setPointerCapture(e.pointerId)
- coverMove(e: PointerEvent): if (dragging) dragY = Math.max(0, e.clientY - startY)
- coverUp(): if (dragY > 120) player.collapse(); dragY = 0
- Element binds: style:transform={dragY ? `translateY(${dragY}px)` : undefined}
                 style:transition={dragging ? 'none' : 'transform 0.28s cubic-bezier(.22,1,.36,1)'}

Existing grip live-drag (the sheet 2-state, to be replaced by 3-state):
- panelFull $state(boolean); sheetEl $state<HTMLElement|null>; sheetDragY $state(number);
  sheetDragging $state(boolean); gripActive $state(boolean); gripMoved (plain let); peekOffset=300; snapTimer
- gripDown measures peekOffset = sheetEl.top - np.top (min 80); sets sheetDragging=true, sheetDragY=start
- gripMove: sheetDragY = clamp(0, peekOffset, start + gripMoved)
- gripUp: if |gripMoved|<8 → TAP (toggle, no offset); else snap to nearest with 290ms settle timer
- Sheet binds class:full + class:dragging; .sheet.full/.sheet.dragging go position:absolute inset:0

Tap-vs-drag threshold across the codebase = 8px (grip gripUp, longpress.ts move()).

i18n: t(key) from '$lib/i18n'. TranslationKey = keyof typeof en. To add a key, add the SAME key to
all three dicts: src/lib/i18n/en.ts, zh-Hant.ts, zh-Hans.ts (en defines the type → missing key in en is a
compile error; missing in zh dicts falls back to en at runtime but ADD all three to stay consistent).

player store (player.svelte.ts): player.expanded ($state bool), player.expand(), player.collapse().
TrackMenu.svelte props: { track, open, onclose }. It renders up to 3 independent sheets controlled by
`open` (menu), `pickerOpen` ($state), `detailTrack` ($state). Each is `scrim` (button) + `.menu`/`.modal`
with transition:fly={{ y: 240, duration: 200 }}.

+layout.svelte renders {#if player.expanded}<NowPlaying />{/if}; nowbar opens via player.expand().
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Reusable dragClose action + centralized back-gesture overlay store</name>
  <files>src/lib/actions/dragClose.ts, src/lib/stores/overlays.svelte.ts</files>
  <action>
Create TWO net-new primitives, both framework-idiomatic (mirror longpress.ts action style and player.svelte.ts runes-class style). No new dependencies.

(A) `src/lib/actions/dragClose.ts` — a Svelte `Action<HTMLElement, DragCloseOpts>` that makes ANY element finger-draggable downward to dismiss. Mirror the existing coverDown/coverMove/coverUp pattern (GGJ-DRAG):
- Options: `{ onclose: () => void; threshold?: number; enabled?: boolean }`. Default threshold = 120 (matches the cover's existing 120px).
- pointerdown: record startY, set dragging, call node.setPointerCapture(pointerId). Set node.style.touchAction='none' and node.style.userSelect='none' on attach so dragging never selects text or scrolls (GGJ-MOBILE).
- pointermove: dy = Math.max(0, clientY - startY); apply node.style.transform=`translateY(${dy}px)` and node.style.transition='none' while dragging.
- pointerup/pointercancel: if dy > threshold → set transition back + translateY(100%) then call onclose() after a short settle (use a ~200ms timeout matching the fly duration, OR call onclose immediately and let the {#if} fly-out handle the exit — choose immediate onclose so Svelte's existing transition:fly plays the close animation; just reset transform/transition first). If dy <= threshold → animate transform back to translateY(0) (transition on) = snap-back. Reset dragging state.
- Guard: if a pointerdown originates on an interactive child that needs the tap (e.g. a `.mi` menu button), the drag still starts but only DISMISSES past threshold — taps (dy<8 on pointerup) must NOT swallow the click. Do NOT preventDefault on pointerdown; only manage transform. This keeps menu-item onclick working.
- Support reactive `update(opts)` to toggle `enabled` and swap `onclose`. Clean up all listeners + reset inline styles in `destroy()`.
- Export a typed event-less action (no custom events needed — uses the onclose callback). Add a JSDoc header in the same terse style as longpress.ts explaining the threshold + tap-preservation contract.

(B) `src/lib/stores/overlays.svelte.ts` — a centralized History-API back-to-close stack (GGJ-BACK). NET-NEW; no popstate/history wiring exists today.
- A module-scoped singleton class `Overlays` (export `const overlays = new Overlays()`), runes-style like player.svelte.ts.
- Internal stack: array of `{ id: string; close: () => void }` (plain array, not necessarily $state — it drives history, not the DOM; but a `$state` depth counter is fine if useful).
- `open(id, close)`: push entry; if in browser, `history.pushState({ gsdOverlay: id }, '')`. Idempotent — if `id` already top, do nothing.
- `closeTop()`: pop the top entry and call its close(). Used by the popstate handler.
- `dismiss(id)`: programmatic close (e.g. user tapped the scrim or X) — remove the entry from the stack AND if it was pushed onto history, call `history.back()` ONCE to keep the history stack balanced (guard against double-pop: set a flag so the resulting popstate does NOT re-invoke close()). This is the tricky part — document the invariant: "history depth == overlay stack depth; scrim-close pops both, back-gesture pops both."
- `init()` (call once from the app layout `onMount`): attach a single `window.addEventListener('popstate', ...)`. On popstate: if our stack is non-empty AND the pop wasn't triggered by our own dismiss(), call closeTop() (which runs the overlay's close handler). Return a teardown that removes the listener.
- SSR-safe: every `window`/`history` access guarded by `typeof window !== 'undefined'`.
- Keep it small and reusable: NowPlaying and TrackMenu both just call `overlays.open(...)` when they open and `overlays.dismiss(...)` when they close via UI; the back gesture is handled centrally.
  </action>
  <verify>
    <automated>npm run check</automated>
    Manual: temporarily import both in a scratch component is NOT required; svelte-check must compile the action's generic signature + the store class with zero new errors. `grep -n "popstate\|pushState" src/lib/stores/overlays.svelte.ts` shows both. `grep -n "touch-action\|touchAction\|userSelect" src/lib/actions/dragClose.ts` shows the no-select/no-scroll guard.
  </verify>
  <done>dragClose.ts exports a typed Action with threshold + onclose options and tap-preserving drag-to-dismiss; overlays.svelte.ts exports a singleton with open/closeTop/dismiss/init and a popstate listener; `npm run check` is clean.</done>
</task>

<task type="auto">
  <name>Task 2: NowPlaying 3-state sheet snap machine + subnav drag handle + cover-squeeze reflow</name>
  <files>src/lib/components/NowPlaying.svelte, src/lib/i18n/en.ts, src/lib/i18n/zh-Hant.ts, src/lib/i18n/zh-Hans.ts</files>
  <action>
Refactor the now-playing sheet from 2-state (peek/full via `panelFull`) into a 3-state snap machine, make the subnav row a drag handle, and reflow the cover on half/full open. Preserve EVERY existing behavior (cover drag-collapse, queue reorder, lyrics auto-scroll, tab switching, related, i18n). Svelte 5 runes; mirror the existing gripDown/gripMove/gripUp idiom exactly.

(1) Three-state model (GGJ-SHEET3): replace `panelFull: boolean` with `sheetState = $state<'closed' | 'half' | 'full'>('closed')`. Measure TWO offsets at drag start instead of one `peekOffset`:
   - `closedOffset` = current peek distance (sheetEl.top - np.top, min 80) — the translateY for 'closed'.
   - `halfOffset` = ~50% of the np container height (np.getBoundingClientRect().height * 0.5) — the translateY for 'half'. 'full' = 0.
   The sheet's resting translateY is derived from sheetState (closed→closedOffset, half→halfOffset, full→0). While dragging, follow the finger: `sheetDragY = clamp(0, closedOffset, startOffsetForState + gripMoved)`.
   Snap rules on pointerup (per ask): from CLOSED, swipe up past a threshold → half (sticky); from HALF, swipe UP past threshold → full, swipe DOWN past threshold → closed; from FULL, swipe down → half (then a further drag/swipe → closed). Pick the nearest snap point to the released position, biased by drag direction, so a deliberate swipe overshoots one state. Keep the existing 290ms settle timer (transition on once gripActive=false, then commit sheetState).
   Grip TAP (|moved| < 8): expand to 'half' when closed (was: toggle full); when half/full, tap collapses toward closed (or half→closed, full→half — choose half→closed and full→half for a predictable single-step). Keep keyboard Enter/Space on the grip mapping to the same step.

(2) Subnav row is ALSO a drag handle (GGJ-SHEET3 / ask 3): attach the SAME pointer handlers (gripDown/gripMove/gripUp) to the `.subnav <nav>` element so dragging the subnav row moves the sheet identically to the grip. Distinguish tap vs drag by the existing 8px threshold: in the subnav button onclick, only switch tab — but suppress the tab-switch if the gesture was a drag (set a `subnavMoved` flag in gripMove and check it in the button click, OR rely on pointer-capture so the click fires only on a genuine tap; verify the click still fires for taps). Tapping a subnav item must STILL switch the active tab (existing behavior) — do not break queue/lyrics/related.

(3) Subnav-item click → half-open + cover squeeze (GGJ-REFLOW / ask 5): when a subnav item is tapped while sheetState==='closed', set sheetState='half' AND switch to that tab. When already half/full, a subnav tap just switches the tab (no state change). Drive a reflow class on the `.np` root, e.g. `class:reflow={sheetState !== 'closed'}`:
   - `.np.reflow .cover`: remove the auto `margin: 10px auto` and the `width: min(72vw,320px)` square; make it full-bleed edge-to-edge (negate the .np `padding: 8px 18px` via negative margins `margin: 0 -18px`, width auto, drop aspect-ratio:1/1, give it a fixed shorter banner height e.g. `height: 30vh` so it becomes a short full-width banner), and position it so the header overlaps the TOP of the cover (header gets a higher z-index / the cover sits behind it — use position + z-index, keep the header readable with a subtle gradient scrim on the cover top if needed).
   - `.np.reflow .meta`: pull it UP to overlap the BOTTOM of the cover (negative margin-top) so title/artist reclaim the same vertical space — YT-Music style.
   - When sheetState returns to 'closed', the cover/meta return to the current centered-square layout (no reflow class). Use CSS transitions on width/height/margin so the reflow animates smoothly.
   Keep the cover's existing drag-collapse (coverDown/Move/Up) working in BOTH layouts.

(4) Mobile-friendliness (GGJ-MOBILE): ensure `touch-action: none` stays on cover/grip/subnav/sheet draggable surfaces; add `user-select: none` to the sheet/grip/subnav so dragging never selects text. Verify touch targets on subnav buttons stay >=40px tall in both layouts.

(5) i18n: reuse existing nowplaying.* keys. The grip aria-label currently toggles collapsePanel/expandPanel — keep that mapping sensible for 3 states (closed→expandPanel, half/full→collapsePanel is acceptable; OR add `nowplaying.halfOpenPanel` if you want a third label). If you add ANY new key, add it to ALL THREE dicts (en.ts, zh-Hant.ts, zh-Hans.ts) — note added keys in the SUMMARY. Do not remove existing keys.

Do NOT touch player.svelte.ts data/queue logic, the data/fetch/source backend, or the queue-reorder gripDrag* handlers (they must keep working unchanged).
  </action>
  <verify>
    <automated>npm run check</automated>
    Manual gesture walkthrough (phone or devtools touch emulation):
    1. Closed sheet: drag the GRIP up slowly → sheet follows finger; release ~half → sticks at half-open. Drag up again → full. Drag down from full → half → closed.
    2. Drag the SUBNAV ROW up/down → sheet moves identically to the grip.
    3. TAP a subnav item while closed → sheet opens to half AND that tab is active AND cover becomes a full-bleed banner with the header overlapping its top and the meta overlapping its bottom.
    4. TAP a subnav item while half/full → only the tab switches, no state/reflow change.
    5. Return sheet to closed → cover/meta animate back to centered square.
    6. Regression: cover drag-down still collapses now-playing; queue reorder (right grip) still works; lyrics auto-scroll still works; tab content (queue/lyrics/related) renders.
  </verify>
  <done>Sheet has closed/half/full snap states reachable by grip-drag, subnav-drag, grip-tap, and subnav-tap; cover reflows to a full-bleed banner overlapping header+meta on half/full and returns to square on closed; all listed regressions pass; `npm run check` clean; any new i18n keys exist in all three dicts.</done>
</task>

<task type="auto">
  <name>Task 3: Wire drag-to-close + back-gesture into TrackMenu sheets and the now-playing overlay</name>
  <files>src/lib/components/TrackMenu.svelte, src/lib/components/NowPlaying.svelte, src/routes/(app)/+layout.svelte</files>
  <action>
Apply the Task-1 primitives so every draggable overlay is finger-dismissable AND back-gesture-dismissable (GGJ-DRAG + GGJ-BACK).

(1) `+layout.svelte`: call `overlays.init()` once in the existing `onMount` (it already runs library.load()/settings.load()); store and run its teardown in onMount's return. This installs the single popstate listener.

(2) TrackMenu.svelte — drag-to-close on all 3 sheets (GGJ-DRAG):
   - Add `use:dragClose={{ onclose: close }}` to the `.menu` element (the options menu) — it already has a `close()` that resets pickerOpen + calls onclose().
   - Add `use:dragClose={{ onclose: () => (pickerOpen = false) }}` to the playlist-picker `.menu`.
   - Add `use:dragClose={{ onclose: () => (detailTrack = null) }}` to the detail `.modal`.
   - Each sheet keeps its existing `transition:fly` for the close animation; dragClose resets its own inline transform before invoking onclose so the fly-out plays cleanly. Verify menu-item taps (`.mi` onclick) still fire — the action must NOT swallow clicks (tap dy<8 ⇒ no dismiss, click proceeds).
   - Back-gesture for these sheets: register with `overlays` on open and dismiss on close. Use `$effect` blocks keyed on each sheet's open condition — when `open && track` becomes true call `overlays.open('trackmenu-menu', close)`; when it becomes false the effect cleanup calls `overlays.dismiss('trackmenu-menu')`. Do the same for `pickerOpen` (`'trackmenu-picker'`) and `detailTrack` (`'trackmenu-detail'`). The scrim onclick and X button already call the close handlers → those handlers route through `overlays.dismiss(...)` (call dismiss inside close()/the picker+detail closers, or let the $effect cleanup handle it — pick ONE path and document it so history depth stays balanced; recommended: UI close handlers set the state false, and the $effect cleanup calls overlays.dismiss, so there is a single dismiss path).

(3) NowPlaying.svelte — back-gesture closes the full-screen overlay (GGJ-BACK):
   - Register the now-playing overlay with `overlays` when it mounts/`player.expanded` is true: an `$effect` that calls `overlays.open('nowplaying', () => player.collapse())` on mount and `overlays.dismiss('nowplaying')` in cleanup. (NowPlaying only renders while player.expanded is true — see +layout — so component mount == overlay open.)
   - Behavior: pressing Back while now-playing is full-screen collapses it to the nowbar instead of navigating away; pressing Back again (no overlay) navigates normally. The cover drag-down collapse and the header ChevronDown both already call player.collapse() → ensure these also balance history (they should route through the same dismiss path: have the collapse-triggering UI call player.collapse() and let the $effect cleanup dismiss — single path, documented).
   - Also register each TrackMenu sub-sheet ABOVE the now-playing overlay in the stack (TrackMenu is rendered inside NowPlaying) so Back closes the menu first, then the now-playing overlay — the stack ordering from (2) already gives this for free since the menu opens after now-playing.

(4) Edge cases to handle and note: opening a sheet, then collapsing now-playing via the cover-drag (which unmounts both) — the $effect cleanups must dismiss in the right order without leaving stale history entries; guard `overlays.dismiss` to be a no-op if the id isn't in the stack. Rapid open/close must not desync history depth — the idempotent `open` and guarded `dismiss` from Task 1 cover this.
  </action>
  <verify>
    <automated>npm run check</automated>
    Manual gesture walkthrough:
    1. Open the now-playing options menu → drag it DOWN past ~120px → it dismisses (fly-out). Drag down <120px → snaps back open.
    2. Repeat for the playlist picker and the detail modal — each drag-closes.
    3. Tap a menu item (e.g. "Add to queue") → it still fires (drag-to-close does not swallow taps).
    4. Back gesture / browser Back with the menu open → menu closes, page does NOT navigate. Back again with now-playing full-screen → collapses to nowbar, no navigation. Back again with nothing open → normal navigation.
    5. Scrim tap closes the sheet AND a subsequent Back does not double-close or get stuck (history depth balanced).
    6. Regression: TrackMenu actions (play next, like, share, download, detail, playlist) all still work.
  </verify>
  <done>All 3 TrackMenu sheets drag-to-close past ~120px and snap back below it without swallowing item taps; OS/browser Back closes the topmost overlay (menu → now-playing → page) instead of navigating; scrim/X/cover-collapse paths keep history depth balanced; `npm run check` clean.</done>
</task>

</tasks>

<verification>
- `npm run check` (svelte-check) is clean after every task — zero new errors/warnings.
- `npm run test` still passes (this is UI-only; no service/data tests should regress).
- Full manual gesture walkthrough across all three tasks passes on a phone or devtools touch emulation:
  - Every bottom-sheet (3 in TrackMenu) drags down to dismiss and snaps back below threshold.
  - Back gesture closes the topmost overlay (TrackMenu sheet → now-playing → page) instead of navigating.
  - Now-playing sheet snaps between closed / half / full via grip-drag, subnav-drag, grip-tap, and subnav-tap.
  - Subnav-tap-while-closed opens to half + reflows cover to a full-bleed banner overlapping header+meta; returns to square on closed.
  - No accidental text-selection or page-scroll while dragging any surface.
- All preserved behaviors intact: cover drag-collapse, queue reorder, lyrics auto-scroll, tab switching, related, i18n via t().
</verification>

<success_criteria>
- The 6 user asks are met: (1) universal modal drag-to-close, (2) back-gesture closes overlays, (3) subnav-as-drag-handle with tap-still-switches-tab, (4) 3-state sheet, (5) subnav-tap → half-open + cover squeeze, (6) general mobile-friendliness.
- Reusable primitives exist: `src/lib/actions/dragClose.ts` (action) and `src/lib/stores/overlays.svelte.ts` (back-gesture stack) — applied to both TrackMenu and now-playing.
- No new dependencies; Svelte 5 runes idioms match NowPlaying.svelte; data/fetch/source backend untouched.
- History depth stays balanced across scrim-close, X-close, drag-close, cover-collapse, and back-gesture paths (no stuck/double-close).
</success_criteria>

<output>
Create `.planning/quick/260606-ggj-make-it-more-mobile-friendly-and-enhance/260606-ggj-SUMMARY.md` when done. In the SUMMARY, list any NEW i18n keys added (key + en/zh-Hant/zh-Hans values) and document the single dismiss path chosen for history-depth balance.
</output>
