---
status: partial
phase: 18-sleep-timer
source: [18-VERIFICATION.md]
started: 2026-06-11
updated: 2026-06-11
---

## Current Test

[awaiting human testing on a real device]

## Tests

These 5 items passed code verification (11/11 must-haves) but exercise native `<audio>`
behavior that a desktop browser preview cannot reproduce. Test on a real phone
(iOS Safari + Android Chrome) once, then mark each `pass`/`issue`.

### 1. Expiry behavior — fade vs instant-pause
expected: On desktop/Android (volume-writable), at the deadline the volume ramps down over ~10s then pauses in place; tapping play resumes at full volume from the same position. On iPhone (read-only volume) it instant-pauses at the deadline (correct fallback, not a bug).
result: [pending]

### 2. D-05 gesture-abort during a live fade
expected: While the ~10s fade is in progress, tapping play/pause, next, prev, or seek aborts the fade — volume restores to full, playback continues, and the timer clears.
result: [pending]

### 3. D-03 end-of-track + repeat-one stop
expected: With an "End of track" timer armed AND repeat-one ON, at the natural track end playback STOPS (no rewind, no repeat, no advance). Indicator disappears.
result: [pending]

### 4. D-04 manual-pause past the deadline
expected: Set a minutes timer, pause manually, wait past the deadline. The indicator silently disappears — no second pause, no fade, no toast.
result: [pending]

### 5. D-09 background / lock-screen
expected: With a minutes timer armed, lock the screen / background the tab. Playback stops within seconds of the deadline (wakeTimer backstop), and the OS lock-screen / media UI reads paused. No expiry toast.
result: [pending]

## Summary

total: 5
passed: 0
issues: 0
pending: 5
skipped: 0
blocked: 0

## Gaps
