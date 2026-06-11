---
status: partial
phase: 20-now-playing-surface-gestures
source: [20-03-SUMMARY.md, 20-04-SUMMARY.md]
started: 2026-06-11T17:15:00.000Z
updated: 2026-06-11T17:15:00.000Z
---

## Current Test

[awaiting human testing — run on a real phone or DevTools touch emulation, track playing, non-empty up-next queue]

## Tests

### 1. NowPlaying cover — tap-collapse (NP-03)
expected: In the HALF sheet state, a single tap on the cover collapses the sheet to `closed`. Tapping in closed/full does nothing new.
result: [pending]

### 2. NowPlaying cover — horizontal swipe changes track (NP-01)
expected: Drag the cover L→R past ~28% of its width → previous track (prev art peeks in 1:1 and snaps to centre). R→L → next track. A quick flick in either direction also commits. After a committed swipe the new cover sits centred (NOT frozen off-centre — CR-01 fix).
result: [pending]

### 3. NowPlaying cover — sub-commit nudge springs back
expected: A short horizontal nudge (under ~28%, no flick) springs the cover back with no track change.
result: [pending]

### 4. NowPlaying cover — prev-boundary rubber-band (D-02)
expected: On the very first track (queue index 0, currentTime ≤ 3), drag L→R (prev) → the cover rubber-bands and springs back with NO track change, even on a hard flick.
result: [pending]

### 5. NowPlaying cover — vertical collapse still works (D-05 axis arbitration)
expected: Dragging the cover straight DOWN still collapses the sheet (no carousel hijack). The horizontal carousel and the vertical collapse never both capture. After a vertical-collapse gesture that starts on the cover, the strip's CSS settle transition still works (CR-02 fix).
result: [pending]

### 6. NowPlaying cover — tap vs committed swipe never both fire
expected: A sub-slop tap still collapses; a committed swipe changes track and never also triggers tap-collapse.
result: [pending]

### 7. NowPlaying cover — reduced motion
expected: With reduce-motion on (OS or app), the track change still happens, just without the slide animation.
result: [pending]

### 8. Nowbar mini-player — horizontal swipe changes track (NP-05)
expected: On the docked nowbar, swipe content R→L → next; L→R → prev; a flick commits. Thumb art + text slide with the finger and snap. After commit the swapped content is centred (CR-01 fix).
result: [pending]

### 9. Nowbar mini-player — sub-commit nudge springs back
expected: A short nudge (under ~28%, no flick) springs the content back with no track change.
result: [pending]

### 10. Nowbar mini-player — tap-to-expand preserved (D-07)
expected: A single tap (not a swipe) expands now-playing. A committed swipe never also expands.
result: [pending]

### 11. Nowbar mini-player — loader rail stays pinned
expected: While a track is loading, the top running-line loader rail stays pinned and does NOT slide with the swiped `.np-open` content.
result: [pending]

### 12. Nowbar mini-player — prev-boundary rubber-band
expected: On the first track (currentTime ≤ 3), swipe L→R (prev) → content rubber-bands and springs back, no track change even on a hard flick.
result: [pending]

### 13. Nowbar mini-player — reduced motion + full-state nesting
expected: Reduce-motion on → track still changes without the slide. In now-playing FULL state, the embedded nowbar tap still collapses the sheet (its onOpen override) and the swipe still changes track.

### 14. NowPlaying top loader (NP-04) + scroll containment (NP-02)
expected: The NP-04 running-line loader appears flush under the notch (safe-area inset) while loading and does not visually duplicate the embedded nowbar's own loader in FULL. Half-open over-scroll/bounce stops at the panel edges and never scroll-chains the page behind the sheet (Android Chrome + iOS Safari ≥16; iOS <16 best-effort).
result: [pending]

## Summary

total: 14
passed: 0
issues: 0
pending: 14
skipped: 0
blocked: 0

## Gaps
