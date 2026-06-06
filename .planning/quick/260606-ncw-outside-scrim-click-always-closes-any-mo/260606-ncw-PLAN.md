---
phase: quick-260606-ncw
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/lib/components/TrackMenu.svelte
autonomous: true
requirements:
  - QUICK-260606-ncw
must_haves:
  truths:
    - "Clicking outside the context menu sheet closes it (scrim click-to-dismiss)."
    - "Clicking outside the playlist picker sheet closes it (and only it — the menu beneath stays put)."
    - "Clicking outside the track-detail modal closes it."
    - "Every outside-click close routes through the SAME single dismiss path (state-flip → $effect cleanup → overlays.dismiss) — no second independent close, no History-API back-stack desync."
    - "Drag-to-close and back-gesture continue to work and stay depth-balanced after the change."
  artifacts:
    - path: "src/lib/components/TrackMenu.svelte"
      provides: "Three scrim buttons (menu, picker, detail), each routing outside-click through the single overlays dismiss path"
      contains: "class=\"scrim\""
  key_links:
    - from: "src/lib/components/TrackMenu.svelte scrim onclick handlers"
      to: "overlays.dismiss(id)"
      via: "state flip ($state false / null) → $effect cleanup"
      pattern: "overlays\\.dismiss\\('trackmenu-"
---

<objective>
Guarantee that clicking outside ANY modal/bottom-sheet in the app always closes it
(scrim click-to-dismiss), consistently, through the SAME single dismiss path as
drag-to-close and the back-gesture — with no History-API back-stack desync.

The orchestrator already swept all `.svelte` files: the ONLY custom modals in the app
are TrackMenu.svelte's three sheets (context menu, playlist picker, track detail). All
other "fixed" elements (nowbar, tabbar, NowPlaying full-screen overlay + its in-flow
sheet) are not scrim modals; `prompt()`/`confirm()` are native dialogs that cannot take
a scrim. So scope is TrackMenu.svelte only.

This is primarily an AUDIT + CONSISTENCY task, NOT a build. The expected outcome may be
"already-satisfied, no code change needed" plus an explicit written report — do NOT
fabricate churn. Fix code ONLY if the audit finds a real desync or a scrim that bypasses
the single dismiss path.

Purpose: Predictable, app-wide outside-click dismissal that never desyncs the back stack.
Output: An audit report stating per-sheet whether the requirement was already met, plus
any precise fix that was actually necessary.
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/execute-plan.md
@~/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@./CLAUDE.md

@src/lib/components/TrackMenu.svelte
@src/lib/stores/overlays.svelte.ts
@src/lib/actions/dragClose.ts

<interfaces>
<!-- Key contracts the executor needs. Extracted from the codebase — no exploration required. -->

From src/lib/stores/overlays.svelte.ts (singleton `overlays`):
```typescript
// INVARIANT: history depth == overlay stack depth.
overlays.open(id: string, close: () => void): void  // pushes ONE stack entry + ONE history state (idempotent if id is already top)
overlays.dismiss(id: string): void                  // removes entry by id-filter, then history.back() ONCE (popping flag swallows echo); no-op if id not in stack
overlays.closeTop(): void                            // back-gesture path: pops top entry, runs its close()
get overlays.depth: number
```

From src/lib/components/TrackMenu.svelte (current wiring — the "single dismiss path"):
- Props: `{ track: Track | null; open: boolean; onclose: () => void }`
- Local state: `pickerOpen = $state(false)`, `detailTrack = $state<Track | null>(null)`
- `function close() { pickerOpen = false; onclose(); }`
- Three `$effect` blocks register/cleanup overlays entries while each sheet is open:
  - `open && track`      → `overlays.open('trackmenu-menu',   () => onclose())`        cleanup → `overlays.dismiss('trackmenu-menu')`
  - `pickerOpen && track`→ `overlays.open('trackmenu-picker', () => (pickerOpen = false))` cleanup → `overlays.dismiss('trackmenu-picker')`
  - `detailTrack`        → `overlays.open('trackmenu-detail', () => (detailTrack = null))`  cleanup → `overlays.dismiss('trackmenu-detail')`
- Three scrim buttons (separate sibling `<button class="scrim">`, full-viewport `inset:0`, z-index 80, sheet/modal at z-index 81):
  - menu scrim   onclick → `close`                       (line ~111)
  - picker scrim onclick → `() => (pickerOpen = false)`   (line ~127)
  - detail scrim onclick → `() => (detailTrack = null)`   (line ~138)

KEY PRINCIPLE (do not break): UI close handlers (scrim / X / drag) and the back-gesture
handler ONLY flip local state to false/null. The `$effect` CLEANUP is the SOLE caller of
`overlays.dismiss(id)`. That convergence is what keeps history depth balanced. Any "fix"
that calls `overlays.dismiss(...)` directly from a scrim handler, or adds a second close
path, is WRONG.
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Audit + harden TrackMenu scrim outside-click dismissal (single dismiss path)</name>
  <files>src/lib/components/TrackMenu.svelte</files>
  <action>
This is an AUDIT-FIRST task. Do the audit and WRITE THE FINDINGS into the SUMMARY before
touching any code. Only edit if the audit finds a concrete defect.

STEP A — Audit each of the three scrims against the requirement. For each sheet
(context menu `trackmenu-menu`, playlist picker `trackmenu-picker`, track detail
`trackmenu-detail`), confirm and record a yes/no with one-line reasoning:

  1. The `.scrim` is a separate sibling `<button>`, full-viewport (`position:fixed; inset:0`),
     z-index strictly BELOW its sheet (scrim 80, sheet/modal 81). Inside-click does NOT
     close (the sheet is a sibling, not a child of the scrim) — confirm this is the case.
  2. The scrim `onclick` ONLY flips local state false/null (menu→`close`, picker→
     `() => (pickerOpen=false)`, detail→`() => (detailTrack=null)`). It must NOT call
     `overlays.dismiss(...)` directly.
  3. Flipping that state false/null causes the matching `$effect` cleanup to run, which is
     the SINGLE site calling `overlays.dismiss(id)`. So scrim, X, drag, and back-gesture
     all converge on one dismiss site.
  4. Each scrim keeps its `aria-label` (close menu / close).

STEP B — Audit the nested-stacking edge case (the orchestrator's primary suspect).
Open path: tapping "Add to playlist" in the menu sets `pickerOpen = true` while the menu
is still rendered (`open && track` is still true). So BOTH `{#if open && track}` (menu)
and `{#if pickerOpen && track}` (picker) render simultaneously, stacked, and the overlay
stack is `[trackmenu-menu, trackmenu-picker]` (history depth 2). Trace and confirm:

  - The picker's scrim is rendered AFTER and at the SAME z-index (80) as the menu's scrim,
    so it sits on top in DOM paint order and is the element that actually receives an
    "outside the picker" click. Confirm clicking there fires the picker scrim handler
    (`pickerOpen = false`), NOT the menu scrim handler.
  - `pickerOpen = false` → picker `$effect` cleanup → `overlays.dismiss('trackmenu-picker')`.
    Because `trackmenu-picker` is the TOP of the stack here, the id-filter removes the top
    entry AND `history.back()` pops exactly the picker's history state → depth returns to 1
    (menu still open), perfectly balanced. Confirm this is correct and that the menu is
    LEFT OPEN (correct layer closed).
  - Confirm the menu's `close()` flipping `pickerOpen=false` as a side effect is harmless:
    while the picker is open the menu scrim is COVERED by the picker scrim (same z-index,
    painted later) so the menu scrim is not clickable; and the menu's back-gesture handler
    is `() => onclose()` (does NOT touch pickerOpen), so the two stacked entries pop
    independently and in order under repeated Back. Record whether this holds.

STEP C — Decide and act:
  - If EVERY check in A and B passes (expected, per the orchestrator audit): make NO code
    change. State explicitly in the SUMMARY: "Already satisfied — all three scrims close
    on outside-click via the single dismiss path; nested menu→picker stack stays
    depth-balanced. No code change needed." This is an acceptable, correct outcome.
  - If a check FAILS (e.g. the picker scrim closes the wrong layer, a scrim calls
    `overlays.dismiss` directly, the nested stack desyncs history depth, or z-index lets
    an inside-click close the sheet), apply the MINIMAL precise fix in TrackMenu.svelte
    (and ONLY in overlays.svelte.ts if the defect is provably in the dismiss/stack logic
    — note: `files_modified` currently lists only TrackMenu.svelte, so editing
    overlays.svelte.ts also requires recording why in the SUMMARY). Keep all existing
    drag-close, back-gesture, X-button, and toast behavior intact. Do NOT introduce a
    second close path and do NOT change the `.scrim` z-index relationship.

CONSTRAINTS: Svelte 5 runes only, no new dependencies, UI layer only. Do not modify the
native `prompt()`/`confirm()` flows (new-playlist name, etc.) — they cannot take a scrim.
Reuse existing handlers; never add an independent close that bypasses the
state-flip → $effect-cleanup → overlays.dismiss convergence.
  </action>
  <verify>
    <automated>npm run check && npm test</automated>
  </verify>
  <done>
- `npm run check` reports 0 errors / 0 warnings.
- `npm test` is green (full vitest run).
- The SUMMARY contains an explicit per-sheet audit table (menu / picker / detail) with
  yes/no + reasoning for STEP A checks, and a verdict for the STEP B nested-stack case.
- Manual verification recorded in the SUMMARY (run `npm run dev`):
  * Open the context menu (⋯ on a track) → click the dimmed area outside the sheet → it closes.
  * Open the playlist picker (menu → "Add to playlist") → click outside → ONLY the picker
    closes, the menu beneath remains; click outside again → the menu closes.
  * Open track detail (menu → "Detail") → click outside → it closes.
  * After each, the browser Back gesture is balanced (one Back per open overlay, no
    stuck-Back, no double-close).
- Either no code changed (audit confirms already-satisfied) OR a minimal, precisely-scoped
  fix was applied with the defect described in the SUMMARY. No fabricated churn.
  </done>
</task>

</tasks>

<verification>
- `npm run check` → 0 errors, 0 warnings.
- `npm test` → all suites pass.
- Manual (dev server): each of the three sheets closes on outside-click; nested
  menu→picker closes the correct layer; back-gesture stays depth-balanced.
</verification>

<success_criteria>
- All three TrackMenu sheets dismiss on outside (scrim) click, consistently, through the
  single dismiss path (state flip → $effect cleanup → overlays.dismiss).
- Nested menu→picker stack closes the correct layer with no History-API depth desync.
- Drag-to-close and back-gesture preserved and balanced.
- The work product clearly states what (if anything) actually needed fixing — an honest
  "no change needed" is a valid, correct result.
</success_criteria>

<output>
Create `.planning/quick/260606-ncw-outside-scrim-click-always-closes-any-mo/260606-ncw-SUMMARY.md` when done.
</output>
