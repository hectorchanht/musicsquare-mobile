# Phase 22: Lyrics Polish - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-12
**Phase:** 22-lyrics-polish
**Areas discussed:** Tap-to-seek behavior, CN original-line fix, Bracket hiding scope, Auto-scroll + spacer feel

---

## Tap-to-seek behavior (LYR-01)

**Q1: After tapping a line (seek fires), how should auto-scroll behave?**

| Option | Description | Selected |
|--------|-------------|----------|
| Instant re-center (Recommended) | Tap = explicit intent: seek, re-enable auto-scroll immediately, smooth-center the tapped line. YT Music behavior. Tap handler must override the pointerdown suspend it just triggered. | ✓ |
| Wait idle delay | Seek happens but auto-scroll resumes only after the normal idle grace. | |
| You decide | Claude picks during planning. | |

**Q2: Tap a line while playback is paused — what happens?**

| Option | Description | Selected |
|--------|-------------|----------|
| Seek + start playing (Recommended) | Tap-to-seek implies listening intent; matches YT Music. Uses existing player resume path. | ✓ |
| Seek, stay paused | Position moves, playback state untouched. | |
| You decide | Claude picks during planning. | |

**Q3: Which lines are tappable seek targets?**

| Option | Description | Selected |
|--------|-------------|----------|
| All lines (Recommended) | Main lines + extracted paren clauses + translation pairs — every rendered `<p>` seeks to its timestamp. | ✓ |
| Main lines only | Paren/translation sub-lines inert. | |

---

## CN original-line fix (LYR-04)

**Q1: CN LRC ships translation+original at the same timestamp; sometimes translation comes FIRST. How should the fix work?**

| Option | Description | Selected |
|--------|-------------|----------|
| Detect + anchor original (Recommended) | Keep file order on screen; anchor + emphasis go to detected original. | |
| Reorder pairs on parse | Pure lrc.ts step reorders each same-timestamp group so original renders above translation; anchor logic untouched. | ✓ |
| Group as sub-line | Render translation as indented sub-line under the original. | |

**Q2: What heuristic decides which line of a same-timestamp pair is the ORIGINAL?**

| Option | Description | Selected |
|--------|-------------|----------|
| Dominant-script match (Recommended) | Lyric body's dominant script; within a pair, the matching line = original. Handles EN/JP/KR songs with CN translations. | ✓ |
| Per-file consistent order | Decide once file-wide whether translations lead or trail. | |
| You decide | Claude picks/combines — pure + node-testable in lrc.ts. | |

**Q3: How should the detected translation line look while its pair is current?**

| Option | Description | Selected |
|--------|-------------|----------|
| Dimmed, not bold (Recommended) | Original gets full .active; translation stays muted. | |
| Both highlighted | Keep today's whole-group highlight; only ordering/anchor fixed. | ✓ |
| You decide | Claude picks during planning. | |

---

## Bracket hiding scope (LYR-05)

**Q1: Which bracket types should splitParenLines recognise beyond ()/（）?**

| Option | Description | Selected |
|--------|-------------|----------|
| Full CJK set + [] (Recommended) | 【】 [] ［］ 「」 『』 〈〉 《》 — covers CN LRC inline-translation styles; timestamps already stripped so [] safe. | ✓ |
| Conservative: 【】+ [] only | Two most common carriers only. | |
| You decide | Claude picks the set with fixtures per bracket type. | |

**Q2: When should a bracketed clause be treated as a hideable translation?**

| Option | Description | Selected |
|--------|-------------|----------|
| Script-mismatch only (Recommended) | Clause splits as fromParen ONLY when its script differs from the line's main text; same-script brackets (backing vocals, quotes) stay inline. | ✓ |
| All bracketed clauses | Every clause splits and is hideable — hide-setting eats backing vocals. | |
| You decide | Claude picks/combines; never-drop-original locked. | |

**Q3: Section markers like [Chorus] / 【副歌】 in lyric text — what should happen?**

| Option | Description | Selected |
|--------|-------------|----------|
| Leave as-is (Recommended) | Whole-line bracket passes through unsplit; renders as normal line. | ✓ |
| Treat as hideable | Hide whole-line markers — needs marker-vs-lyric guess, riskier. | |

---

## Auto-scroll + spacer feel (LYR-02 / LYR-03)

**Q1: Idle delay before auto-scroll resumes after finger lift / wheel stop? (currently 600ms)**

| Option | Description | Selected |
|--------|-------------|----------|
| ~3s (Recommended) | YT Music / Spotify feel — time to read before view snaps back. | ✓ |
| Keep 600ms | Snappy return — current value, verify live. | |
| ~1.5s middle | Compromise. | |

**Q2: End spacer size so last lines can center (LYR-03)?**

| Option | Description | Selected |
|--------|-------------|----------|
| Half visible band (Recommended) | Spacer ≈ 50% of visible panel height — last line centers exactly in every sheet mode. | ✓ |
| Fixed large padding | Constant padding-bottom, approximate centering. | |
| You decide | Contract = last line can center in half AND full. | |

**Q3: Also add a TOP spacer so the FIRST lines center?**

| Option | Description | Selected |
|--------|-------------|----------|
| No, end only (Recommended) | Stick to LYR-03 as written; matches YT Music. | ✓ |
| Yes, symmetric | Top + bottom spacers. | |

---

## Claude's Discretion

- Tap visual feedback (press state/ripple) on lyric lines
- Dominant-script detection implementation (Unicode ranges, thresholds) — pure functions in lrc.ts with fixtures
- Spacer implementation (padding vs element, measured vs CSS)
- Tap-handler coexistence with lyricsTouched suspend (sub-slop discrimination)
- Smooth-scroll easing details

## Deferred Ideas

None — discussion stayed within phase scope.
