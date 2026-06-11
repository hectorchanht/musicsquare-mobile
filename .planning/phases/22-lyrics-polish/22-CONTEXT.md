# Phase 22: Lyrics Polish - Context

**Gathered:** 2026-06-12
**Status:** Ready for planning

<domain>
## Phase Boundary

The lyrics view is dependable — tapping a line seeks to its timestamp (LYR-01), touching/holding/scrolling suspends auto-scroll and resumes after idle **verified live, currently reported broken** (LYR-02), an end spacer lets the last lines center (LYR-03), CN LRCs highlight the original line (not the translation) as current (LYR-04), and "hide parenthesised translations" handles a wider set of brackets while never dropping a line that contains original lyrics (LYR-05).

Depends on Phase 20 (shares `NowPlaying.svelte`; sequenced after the gesture work). Does NOT redesign the lyrics panel layout, the translation API pipeline, or the sheet state machine.

</domain>

<decisions>
## Implementation Decisions

### Tap-to-seek (LYR-01)
- **D-01:** **Every rendered lyric `<p>` is a tap target** — main lines, extracted paren clauses, and translation pairs all seek to their line's timestamp (same-timestamp siblings seek to the same point).
- **D-02:** **Tap = explicit intent: instant re-center.** On tap: seek, re-enable auto-scroll immediately, smooth-center the tapped line (YT Music behavior). The tap handler must override the auto-scroll suspend that its own `pointerdown` just triggered — tap is NOT treated as a manual-scroll touch.
- **D-03:** **Tap while paused seeks AND starts playback** via the existing player resume path.

### CN translation/original ordering (LYR-04)
- **D-04:** **Reorder pairs on parse.** A pure step in `lrc.ts` reorders each same-timestamp group so the original renders ABOVE the translation. Existing anchor logic in `NowPlaying.svelte` stays untouched — first-of-group remains the scroll anchor, which after reordering is the original.
- **D-05:** **Original detection = dominant-script match.** Compute the lyric body's dominant script (Latin / kana / hangul / CJK); within a same-timestamp pair, the line matching the dominant script is the original, the mismatching line (usually Chinese) is the translation. Pure + node-testable with CN/JP/KR/EN fixtures. Pure-CN songs (no mismatch) are left in file order — no reorder.
- **D-06:** **Highlight styling unchanged: both lines of the current group stay highlighted.** The reorder alone fixes the anchor; no dimming of translation lines.

### Bracket hiding (LYR-05)
- **D-07:** **Widen bracket set to full CJK + ASCII square:** `（）`, `()`, `【】`, `[]`, `［］`, `「」`, `『』`, `〈〉`, `《》`. (Timestamps are already stripped by `parseLRC` before splitting runs, so `[]` is safe.)
- **D-08:** **Script-mismatch rule:** a bracketed clause splits out as `fromParen` (and is thus hideable) ONLY when its script differs from the line's main text (e.g. Latin line + CJK clause). Same-script brackets — backing vocals `(oh oh)`, `「quotes」` — stay inline as part of the lyric and are NEVER hidden. This directly implements the never-drop-original requirement.
- **D-09:** **Whole-line bracketed text (section markers like `[Chorus]` / `【副歌】` or whole-line paren clauses) passes through unsplit and renders as a normal line** — existing behavior kept, zero marker-vs-lyric guessing.

### Auto-scroll + end spacer (LYR-02 / LYR-03)
- **D-10:** **Idle resume delay raised from 600ms to ~3s** — YT Music / Spotify feel; the user gets time to read before the view returns to the current line. LYR-02 itself (suspend-while-touching) must be **verified live** — the pressedPointers/window-pointerup mechanism already exists but is reported broken.
- **D-11:** **End spacer = ~half the visible panel band** so the last line centers exactly in every sheet mode (the anchor math is already mode-aware for closed/half/full). Likely a measured/dynamic spacer rather than a constant.
- **D-12:** **No top spacer** — LYR-03 as written; first lines sitting near the top is normal (matches YT Music).

### Claude's Discretion
- Tap visual feedback (press state/ripple) on lyric lines.
- Exact dominant-script detection implementation (Unicode ranges, thresholds) — must live in `lrc.ts` as pure functions with fixtures.
- Spacer implementation (padding vs element, measured vs CSS) within the D-11 contract.
- How the tap handler coexists with `lyricsTouched` pointerdown suspend (sub-slop tap vs scroll discrimination), as long as D-02's instant-recenter contract holds.
- Smooth-scroll easing/behavior details.

</decisions>

<specifics>
## Specific Ideas

- Auto-scroll resume + tap-to-seek should feel like **YouTube Music**: tap jumps and re-centers instantly; manual scroll holds position ~3s after release before drifting back to the current line.
- Bracket hiding exists to suppress inline translations the CN sources embed — it must never eat backing vocals, ad-libs, or quote-bracketed lyric text (hence the script-mismatch rule).

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

No external specs/ADRs exist for this phase. Canonical references are in-repo requirements plus the load-bearing modules this work extends.

### Requirements & roadmap
- `.planning/REQUIREMENTS.md` — LYR-01..LYR-05 (### Lyrics)
- `.planning/ROADMAP.md` — Phase 22 goal, Success Criteria 1–5, Research flag (LOW: pure logic with an existing test file; touch-suspend needs live confirmation)

### Lyrics pipeline (MUST read)
- `src/lib/services/lrc.ts` — `parseLRC` + `splitParenLines` (currently `()`/`（）` only) + `LyricLine {time,text,fromParen?}`; D-04/D-05/D-07/D-08 land here as pure functions
- `src/lib/services/lrc.test.ts` — existing Vitest suite the new fixtures extend (parseLRC, splitParenLines, inferQualityFromUrl)
- `src/lib/components/NowPlaying.svelte` — lyrics tab: `lines` derived (~83), `activeIndexAndTime` group-highlight + first-of-group anchor (~92–107), touch-suspend `pressedPointers`/window-pointerup mechanism + 600ms idle timer (~108–153), mode-aware visible-band anchor `$effect` (~154–188), render block with `lyricsHideParenLines`/`lyricsHideParenTranslation` (~894–912)
- `src/lib/stores/settings.svelte.ts` + `src/lib/config/defaults.ts` — `lyricsHideParenTranslation` / `lyricsHideParenLines` flags the split feeds
- `src/lib/stores/player.svelte.ts` — seek + resume path D-01/D-03 calls (`currentTime` write / audio seek, play/resume)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`splitParenLines` + `fromParen` flag** — the split/hide plumbing already flows through render + settings; LYR-05 widens its regex and adds the script-mismatch guard, no new render wiring.
- **`activeIndexAndTime` group logic** — same-timestamp groups already computed; D-04 reorder upstream means anchor-by-first-of-group just works.
- **Touch-suspend mechanism** (`pressedPointers` Set + window-level capture pointerup) — already engineered for the pointercancel-during-scroll case; LYR-02 is live-verification + the 3s tune, not a rewrite.
- **Mode-aware visible-band anchor `$effect`** — centering math already handles closed/half/full; the end spacer (D-11) sizes against the same visible band.
- **`lrc.test.ts`** — fixture pattern for pure lrc functions; new CN/JP/EN pair-reorder and bracket fixtures extend it.

### Established Patterns
- **Pure + node-testable lyric logic in `lrc.ts`** — all parsing/splitting/reordering stays DOM-free with Vitest fixtures; the component only renders.
- **Tap vs scroll discrimination** — Phase 15/20 slop idiom (sub-slop = tap, never capture on pointerdown); the lyric tap handler must not break the suspend-on-touch path.
- **Scoped `.panel` scrolling** — never ancestor-walking scrollIntoView (yanks sheet to full in half mode); all scroll writes go through `container.scrollTo`.
- **Marquee + skeleton project rules** — unaffected; lyrics lines wrap (`overflow-wrap: anywhere`).

### Integration Points
- **`lrc.ts` pipeline order:** `parseLRC` → (new) pair-reorder (D-04/D-05) → `splitParenLines` widened (D-07/D-08); `NowPlaying.svelte` `lines` derived consumes the same composed call.
- **Lyrics render block (`NowPlaying.svelte` ~897–911)** — where per-line `onclick` seek (D-01) attaches alongside existing `onpointerdown={lyricsTouched}`.
- **`lyricsReleased` idle timer** — the 600ms→3s change (D-10); tap path bypasses it via instant re-center (D-02).
- **End of `.lyrics` container** — where the D-11 spacer mounts, sized from the visible band already computed in the anchor `$effect`.
- **`player` store** — seek write + paused→play resume for D-03.

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 22-lyrics-polish*
*Context gathered: 2026-06-12*
