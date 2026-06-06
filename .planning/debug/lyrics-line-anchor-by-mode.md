---
gsd_debug_version: 1.0
slug: lyrics-line-anchor-by-mode
status: resolved
trigger: "lyrics tab, current line should be center middle in half open mode and at top in close mode (since there is not much space), remain at the middle in full open mode."
created: 2026-06-06T09:46:33Z
updated: 2026-06-06T10:18:00Z
---

# Debug Session: lyrics-line-anchor-by-mode

## Symptoms

- **Expected behavior:**
  - Lyrics tab active-line auto-scroll anchor should depend on the now-playing sheet open state:
    - **Closed mode:** active lyric line anchored at the **TOP** (little vertical space available).
    - **Half-open mode:** active lyric line anchored at the **center / middle**.
    - **Full-open mode:** active lyric line anchored at the **middle**.
- **Actual behavior:**
  - Active-line anchor did not adapt to sheet mode. Screenshot (half-open) showed the active line near the bottom of the visible region rather than centered.
- **Error messages:** none (visual/layout behavior).
- **Timeline:** existing behavior; lyrics auto-scroll used a single anchor regardless of mode.
- **Reproduction:** Play a track with synced lyrics → open the now-playing sheet → switch to the Lyrics tab → observe active-line position across closed / half-open / full-open sheet states.

## Likely Location

- `src/lib/components/NowPlaying.svelte` — contains both the lyrics scroll/active-line logic AND the sheet open-state (half/full/closed) state.

## Current Focus

- hypothesis: CONFIRMED — the lyrics auto-scroll $effect used a single hardcoded center anchor (`container.clientHeight / 2`) for ALL sheet states; it never read `sheetState`.
- test: Read the auto-scroll math + the half/full CSS geometry.
- expecting: scrollTo target = center-of-full-panel regardless of mode; `sheetState` absent from the $effect. — CONFIRMED.
- next_action: (complete) fix applied + verified via svelte-check and unit suite.
- reasoning_checkpoint: sheetState is LOCAL component state in NowPlaying.svelte (line 223); single-file fix.

## Evidence

- timestamp: 2026-06-06T09:55:00Z
  observation: NowPlaying.svelte:80-94 — the auto-scroll $effect computed `container.scrollTo({ top: offsetWithin - container.clientHeight / 2 + el.offsetHeight / 2 })`. FIXED center-of-panel anchor. `sheetState` never read inside the effect → single anchor for all three modes.
- timestamp: 2026-06-06T09:56:00Z
  observation: Half/full geometry — `.sheet.full, .sheet.dragging { position: absolute; inset: 0; }` (line 606). `.sheet.full` applies whenever `sheetState !== 'closed'` (line 500). In half mode the sheet content fills the full viewport then is translated DOWN by `halfOffset` px (line 503). `.panel` is `flex:1; overflow-y:auto` (line 613), so its clientHeight spans nearly the full viewport — much taller than the VISIBLE region (`viewportHeight - halfOffset`). Centering at clientHeight/2 therefore lands well below the visible midpoint → "near the bottom" symptom.
- timestamp: 2026-06-06T09:57:00Z
  observation: Closed geometry — `.sheet` (no .full) is normal flow `flex:1` under the transport → a short peek panel. Centering is numerically fine but spec wants TOP anchoring because vertical space is tiny.
- timestamp: 2026-06-06T09:58:00Z
  observation: sheetState (`closed`|`half`|`full`) declared as LOCAL $state at NowPlaying.svelte:223. player.svelte.ts and +layout.svelte contain NO sheet-state logic. Fix contained to NowPlaying.svelte.
- timestamp: 2026-06-06T10:15:00Z
  observation: After fix — `npm run check` (svelte-check): 4003 files, 0 errors, 0 warnings. `npm test` (vitest): 22 files, 186 tests, all pass. No regression.

## Eliminated

- player.svelte.ts as the sheet-state source — it is not; sheetState is local to NowPlaying.svelte.
- scrollIntoView ancestor-walk as the cause — the code already deliberately avoids it (lines 84-87) and uses bounded container.scrollTo. The bug was purely the anchor fraction, not the scroll mechanism.

## Resolution

- root_cause: The lyrics active-line auto-scroll $effect (NowPlaying.svelte) used a single hardcoded "center of the .panel container" anchor (`container.clientHeight / 2`) for every sheet state and never read `sheetState`. Two consequences: (1) closed mode centered instead of top-anchoring despite minimal space; (2) half mode centered within the FULL-viewport-tall panel (the sheet is absolute+inset:0 then translated down by halfOffset), so the target landed below the visible fold's midpoint and the active line showed near the bottom of the visible region.
- fix: Made the scroll anchor depend on sheet mode by deriving the anchor from the live VISIBLE band (the container's bounding rect intersected with the viewport) instead of the full clientHeight. `mode` (sheetState) is now a read dependency so the line re-anchors on mode change. closed → anchor near the visible top (with a 12px top pad, per "little space" spec); half / full → center within the visible band. Using the visible-band intersection makes half mode self-correct (it no longer counts the portion of the panel pushed below the fold by halfOffset). Single-file change in src/lib/components/NowPlaying.svelte.
- verification: svelte-check 0 errors/0 warnings (4003 files); vitest 186/186 pass. Visual confirmation across closed/half/full sheet states recommended in-browser (this is a layout behavior) — static verification complete.
- files_changed: src/lib/components/NowPlaying.svelte (lyrics auto-scroll $effect, ~lines 80-114).
</content>
