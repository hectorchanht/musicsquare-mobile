# Phase 22: Lyrics Polish - Research

**Researched:** 2026-06-12
**Domain:** SvelteKit 5 runes component (NowPlaying lyrics tab) + pure TS lyric pipeline (lrc.ts); touch-gesture / auto-scroll interplay; Unicode script detection
**Confidence:** HIGH (pure lrc.ts logic, codebase-verified) / MEDIUM (LYR-02 live-broken mechanism — root cause hypotheses below need device confirmation)

## Summary

This is a polish phase over an existing, well-factored lyrics subsystem. Almost everything needed already exists in the codebase: `lrc.ts` holds the pure `parseLRC`/`splitParenLines` functions with a Vitest suite; `NowPlaying.svelte` already has the same-timestamp group-highlight (`activeIndexAndTime`), the pressedPointers/window-pointerup touch-suspend mechanism, a mode-aware visible-band anchor `$effect`, and the `fromParen`/hide-paren render plumbing. No new libraries are required, no new architecture — the work is (1) two pure functions added to `lrc.ts` (pair-reorder + widened/script-aware bracket split), (2) a per-line `onclick` seek wired into the existing render block, (3) one constant tune (600ms → ~3s) plus a tap-overrides-suspend handler, and (4) an end spacer sized from the already-computed visible band.

The single genuinely uncertain item is **LYR-02** (touch-suspend reported broken live). The mechanism is engineered correctly on paper — `pressedPointers` Set + capture-phase `window` pointerup/pointercancel handles the scroll-takeover/pointercancel case. The likely failure is not the suspend itself but the **600ms resume firing during scroll momentum / inertial scroll**, where iOS Safari keeps scrolling after the finger lifts but emits no further pointer events — so `autoScroll` flips back to `true` mid-glide and the anchor `$effect` yanks the view back to the active line. D-10's 600ms→~3s raise will mask most of this; a momentum-aware guard (scroll-event-debounced resume) is the more robust fix. This needs **live device verification** — it cannot be unit-tested.

**Primary recommendation:** Land all four `lrc.ts` changes (reorder + script detection + widened bracket split) as pure, fixture-tested functions FIRST (node-testable, zero risk), then wire the component changes (tap-seek, 3s resume, end spacer) and verify LYR-02 / tap-feel / spacer-centering on a real iOS device. Use the ES2018 `\p{Script=...}` Unicode property escapes (Baseline since Safari 11.1 / Chrome 64) for dominant-script detection — no library, no hand-rolled codepoint ranges.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| LRC parse / pair-reorder / bracket split | Pure logic (`lrc.ts`) | — | DOM-free, deterministic per-LRC, node-testable; CLAUDE.md "BACKEND — REUSE" seam |
| Dominant-script detection | Pure logic (`lrc.ts`) | — | Pure string→enum function; Vitest fixtures CN/JP/KR/EN |
| Tap-to-seek (per-line `onclick`) | Component (`NowPlaying.svelte`) | Player store (`seekFraction`) | DOM event → store seek write; store owns the audio element |
| Seek + resume-while-paused | Player store (`player.svelte.ts`) | — | Already implemented — `seekFraction` auto-plays when `audio.paused` (D-03 free) |
| Auto-scroll suspend/resume | Component (`NowPlaying.svelte`) | — | Pointer/wheel/scroll gesture state is view-local; no store involvement |
| End spacer + centering | Component (CSS + anchor `$effect`) | — | Layout concern; sizes from the live visible band already computed in the `$effect` |

## Standard Stack

No external packages added or required. This phase uses only what is already in the project.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Svelte (runes) | 5.x (in-repo) | `$derived`/`$effect`/`$state` for lyrics reactivity | Project framework; already used throughout NowPlaying.svelte |
| Vitest | 4.1.8 (in-repo) | Pure lrc.ts fixture tests | Existing `lrc.test.ts` suite; node project in `vite.config.ts` |
| ES2018 RegExp Unicode property escapes | Native (V8 / JavaScriptCore) | `\p{Script=Han|Hiragana|Katakana|Hangul|Latin}` for dominant-script detection | Baseline since Safari 11.1 / Chrome 64 — no library needed `[CITED: caniuse / MDN]` |

**Installation:** None. `export PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH"` before any `pnpm`/`node` command (shell default node v16 breaks vite/vitest — MEMORY note).

**Version verification:** `\p{Script=Han}` etc. confirmed working under Node v22.22.0 (V8) in this session `[VERIFIED: node -e test, this session]`. Browser Baseline confirmed `[CITED: https://caniuse.com/mdn-javascript_builtins_regexp_property_escapes]`.

## Package Legitimacy Audit

No external packages are installed in this phase — section is N/A. (All logic uses native JS + existing in-repo modules.)

## Architecture Patterns

### System Architecture Diagram

```text
                          player.current.lrc (raw LRC string)
                                      │
                                      ▼
                          ┌───────────────────────┐
                          │   parseLRC(lrc)        │  pure, existing — unchanged
                          │  → LyricLine[]         │  {time,text}, time-sorted
                          └───────────┬───────────┘
                                      │
                                      ▼
                          ┌───────────────────────┐
                          │  reorderPairs(lines)   │  NEW pure (D-04/D-05)
                          │  per same-timestamp    │  original (dominant-script)
                          │  group: original first │  rendered ABOVE translation
                          └───────────┬───────────┘  pure-CN → no reorder
                                      │
                                      ▼
                          ┌───────────────────────┐
                          │ splitParenLines(lines) │  WIDENED pure (D-07/D-08)
                          │ full CJK+ASCII brackets │  script-mismatch-only split
                          │ → fromParen:true clauses│  same-script brackets stay inline
                          └───────────┬───────────┘
                                      │  (composed in `lines` $derived, NowPlaying ~83)
                                      ▼
        ┌─────────────────────────────────────────────────────────────────┐
        │                      NowPlaying.svelte lyrics tab                 │
        │                                                                   │
        │  activeIndexAndTime  ──►  activeLine (first-of-group anchor)       │
        │   (group highlight)       activeTime (all siblings .active)        │
        │                                                                   │
        │  render {#each lines}  ──►  <p onclick={seekToLine}               │
        │                              class:active class:paren>            │
        │                                                                   │
        │  .lyrics onpointerdown={lyricsTouched}  ──► autoScroll=false       │
        │          onwheel={lyricsWheel}              (suspend)              │
        │  window pointerup/cancel ──► lyricsReleased() ──► idleTimer ~3s    │
        │                                                                   │
        │  anchor $effect (autoScroll && activeLine) ──► container.scrollTo  │
        │    visible-band center (closed/half/full mode-aware)              │
        │                                                                   │
        │  END SPACER (≈ half visible band) ──► last lines can center        │
        └───────────────────────────┬───────────────────────────────────────┘
                                     │ onclick → time→fraction
                                     ▼
                          player.seekFraction(time / duration)
                            ├─ sets audio.currentTime
                            └─ if audio.paused: audio.play()  ← D-03 already free
```

### Recommended Project Structure
```
src/lib/services/
├── lrc.ts              # parseLRC (unchanged) + reorderPairs (NEW) + splitParenLines (WIDENED) + dominantScript (NEW)
└── lrc.test.ts         # extend with CN/JP/KR/EN reorder fixtures + widened-bracket + script-mismatch fixtures

src/lib/components/
└── NowPlaying.svelte   # lines $derived composes parse→reorder→split; per-line onclick seek;
                        # idleTimer 600→~3000; tap-overrides-suspend; end spacer element + CSS
```

### Pattern 1: Compose the pure pipeline in the `lines` $derived
**What:** The existing `lines` derived already chains `splitParenLines(parseLRC(...))`. Add `reorderPairs` BETWEEN them.
**When to use:** This is the single integration seam — keep all order changes here.
**Example:**
```typescript
// NowPlaying.svelte ~83 (current)
const lines = $derived<LyricLine[]>(
    player.current?.lrc ? splitParenLines(parseLRC(player.current.lrc)) : []
);
// AFTER (D-04 locks order: parse → reorder → split)
const lines = $derived<LyricLine[]>(
    player.current?.lrc ? splitParenLines(reorderPairs(parseLRC(player.current.lrc))) : []
);
```
**Why reorder MUST precede split (verified):** `splitParenLines` emits multiple sibling entries at the SAME timestamp (parent + each `fromParen` clause). If split ran first, those split-out clauses would pollute the same-timestamp groups that `reorderPairs` inspects, and the dominant-script comparison would be done against fragments rather than whole original/translation lines. Reordering whole lines first, then splitting, keeps each step's input clean. `[VERIFIED: codebase — splitParenLines pushes {time: line.time,...} siblings, lrc.ts:77-81]`

### Pattern 2: Dominant-script detection via Unicode property escapes
**What:** Count codepoints by script class, return the dominant non-trivial script of a line body.
**When to use:** D-05 original detection; D-08 script-mismatch bracket guard.
**Example:**
```typescript
// Source: ES2018 Unicode property escapes — Baseline Safari 11.1+ / Chrome 64+
// CITED: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Regular_expressions/Unicode_character_class_escape
type Script = 'han' | 'kana' | 'hangul' | 'latin' | 'other';
function dominantScript(text: string): Script {
    let han = 0, kana = 0, hangul = 0, latin = 0;
    for (const ch of text) {                       // iterate by codepoint, not UTF-16 unit
        if (/\p{Script=Han}/u.test(ch)) han++;
        else if (/\p{Script=Hiragana}/u.test(ch) || /\p{Script=Katakana}/u.test(ch)) kana++;
        else if (/\p{Script=Hangul}/u.test(ch)) hangul++;
        else if (/\p{Script=Latin}/u.test(ch)) latin++;
        // whitespace/punctuation/digits ignored — not counted
    }
    // JP heuristic: any kana presence means the line is Japanese even if Han (kanji) dominates count
    if (kana > 0) return 'kana';
    const max = Math.max(han, hangul, latin);
    if (max === 0) return 'other';
    if (han === max) return 'han';
    if (hangul === max) return 'hangul';
    return 'latin';
}
```
**Critical heuristic note (kana):** Japanese lyrics mix kanji (Han) + kana. A pure max-count would mislabel a kanji-heavy JP line as `han` (== Chinese), breaking JP/CN disambiguation. **Any kana presence ⇒ `kana`** is the correct rule. `[ASSUMED — confirm with a JP fixture; flagged A1]`

### Pattern 3: reorderPairs — original-first within same-timestamp groups
**What:** Group consecutive lines sharing a `time`; if a group has exactly an original+translation pair (script mismatch), reorder so the dominant-script-of-the-whole-song-body line (the original) is first. Pure-CN songs (no mismatch) keep file order.
**When to use:** D-04/D-05.
**Example skeleton:**
```typescript
function reorderPairs(lines: LyricLine[]): LyricLine[] {
    // 1. Compute the song's dominant script across ALL line bodies (the "original language").
    //    A CN translation embedded under EN originals means song-dominant = latin/kana/hangul.
    // 2. Walk same-`time` groups. Within a group, if a line's dominantScript === songDominant
    //    and a sibling's !== songDominant, move the matching (original) line to the front.
    // 3. Pure-CN song (songDominant === 'han', no mismatched siblings) → return group unchanged.
    // 4. Preserve relative order of non-reordered lines (stable).
}
```
**Anchor implication (D-04):** `activeIndexAndTime` already anchors on the FIRST entry of a group. After reorder, first-of-group = original, so the existing anchor logic (`NowPlaying.svelte:92-107`) needs **zero changes** — exactly as D-04 states. `[VERIFIED: codebase — activeLine = activeIndexAndTime.idx = first index reaching maxTime]`

### Pattern 4: Widened, script-mismatch-only bracket split (D-07/D-08)
**What:** Extend `splitParenLines`' `parenRe` to the full bracket set; only split out a clause as `fromParen` when its dominant script differs from the line's main (stripped) text.
**Example:**
```typescript
// D-07 bracket pairs: （）()【】[]［］「」『』〈〉《》
// Build a pair-aware regex (each open matched to its close). Timestamps already stripped by
// parseLRC, so bare [] is safe (D-07 note). VERIFIED: parseLRC strips [mm:ss.xxx] before this runs.
const bracketRe = /[（(【［「『〈《]([^）)】］」』〉》]+)[）)】］」』〉》]/g;
// D-08: for each match, compute dominantScript(inner) vs dominantScript(strippedMainText).
//   mismatch  → split out as { fromParen: true }  (hideable)
//   same      → leave inline, do NOT split        (backing vocals (oh oh) / 「quotes」 preserved)
// D-09: whole-line bracket (stripped main text empty) → pass through unsplit (existing branch kept).
```
**Never-drop guarantee (D-08 → LYR-05):** Because only script-MISMATCHED clauses are extracted, a line whose brackets are same-script as its body is never split and therefore never hideable — the original lyric text can never be dropped. This is the structural implementation of the requirement, not a runtime check. `[VERIFIED: logic derived from D-08 + existing fromParen render gate, NowPlaying.svelte:899]`

### Pattern 5: Tap-to-seek that overrides the pointerdown suspend (D-01/D-02)
**What:** Per-line `<p onclick>`. The `.lyrics` container's `onpointerdown={lyricsTouched}` fires first and sets `autoScroll=false`. A genuine tap (sub-slop, finger didn't drag) still produces a native `click` on the `<p>` after pointerup. The onclick handler seeks AND re-enables auto-scroll + clears the idle timer, overriding its own pointerdown-suspend.
**Example:**
```typescript
function seekToLine(line: LyricLine) {
    if (player.duration > 0) player.seekFraction(line.time / player.duration); // D-03 free: auto-plays if paused
    if (idleTimer) clearTimeout(idleTimer);
    autoScroll = true;          // D-02: override the suspend lyricsTouched just set
    // anchor $effect re-runs on autoScroll flip → smooth-centers the (now active) line
}
```
```svelte
<p onclick={() => seekToLine(l)} class:active={...} class:paren={l.fromParen}> ... </p>
```
**Why this is safe (slop discrimination):** Project rule — never `setPointerCapture` on lyric pointerdown (the `.lyrics` handler doesn't). A real scroll-drag moves > slop and the browser fires `pointercancel`/no `click`, so `seekToLine` never runs and the suspend holds (correct). A sub-slop tap fires `click` → seek + re-center. This mirrors the Phase 15/20 tap-vs-scroll idiom and the `longpress` trailing-click guard. `[VERIFIED: codebase — lyricsTouched has no setPointerCapture; longpress.ts documents the sub-slop tap→click contract]`

### Anti-Patterns to Avoid
- **Ancestor-walking `scrollIntoView`:** Yanks the sheet to full in half-mode. All scroll writes go through `container.scrollTo` on the `.panel` (existing rule). `[VERIFIED: NowPlaying.svelte:165-187 comment]`
- **`setPointerCapture` on lyric pointerdown:** Breaks the sub-slop tap → onclick path. Project rule. Do not add it.
- **Seeking by seconds:** The store has NO seconds-based seek — only `seekFraction(0..1)`. Convert `line.time / player.duration`. Guard `duration > 0`. `[VERIFIED: player.svelte.ts:1810]`
- **Hand-rolled Unicode codepoint ranges:** Use `\p{Script=...}` — maintained by the engine, covers extension blocks (CJK Ext A–G) that hand ranges miss.
- **Reordering inside the render `{#each}` or after split:** Order must change in `lrc.ts` BEFORE split (Pattern 1).
- **Keying `{#each lines as l, i (i)}` by index while reorder changes order mid-track:** Reorder is deterministic per-LRC and recomputes only when `player.current.lrc` changes, so within a track the order is stable — index key is safe. But SEE the Translation-Alignment pitfall below.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Detect script of a character | Manual `charCodeAt` range tables | `\p{Script=Han/Hiragana/Katakana/Hangul/Latin}/u` | Engine-maintained, covers all CJK extension blocks, Baseline-supported |
| Seek to a timestamp | New `seekSeconds`/`seekTo` on the store | `player.seekFraction(time / duration)` | Already clamps, parks pendingSeek pre-metadata, AND auto-plays-when-paused (D-03) |
| Resume playback on tap-while-paused | Explicit `player.play()`/`toggle()` after seek | (nothing) — `seekFraction` already calls `audio.play()` when `audio.paused` | D-03 is satisfied for free `[VERIFIED: player.svelte.ts:1826-1834]` |
| Center the active line | `scrollIntoView({block:'center'})` | Existing visible-band `container.scrollTo` math | Mode-aware (closed/half/full); scrollIntoView yanks the sheet |
| Suppress trailing click after a gesture | New guard | Existing `longpress` capture-phase suppressor pattern (reference only) | Documented idiom; lyric tap is the OPPOSITE (we WANT the tap click) |

**Key insight:** The hardest-looking parts (seek+resume, group-anchor, mode-aware centering, touch-suspend) are already built. The net-new code is ~3 pure functions in `lrc.ts` and a handful of component lines.

## Runtime State Inventory

This is a code-only phase. No stored data, services, OS state, secrets, or build artifacts are renamed or migrated.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — lyrics are derived live from `player.current.lrc`; no persisted lyric/order state | None |
| Live service config | None | None |
| OS-registered state | None | None |
| Secrets/env vars | None | None |
| Build artifacts | None — no package rename | None |

**Settings persistence note (not a migration):** `lyricsHideParenTranslation` / `lyricsHideParenLines` are existing persisted boolean flags (settings store + defaults.ts). LYR-05 changes WHICH clauses become `fromParen` (the split rule), not the flag shape — no settings migration needed. `[VERIFIED: settings.svelte.ts:248-255, defaults.ts:68-72]`

## Common Pitfalls

### Pitfall 1: LYR-02 — resume fires during iOS Safari inertial/momentum scroll (LIKELY ROOT CAUSE)
**What goes wrong:** User flicks the lyrics, lifts the finger; the panel keeps gliding (momentum). `windowPointerUp` fires on the real finger-lift → `lyricsReleased()` → 600ms later `autoScroll=true` → the anchor `$effect` runs `container.scrollTo` back to the active line WHILE the momentum glide is still moving — the view fights the user and "snaps back" too early. This matches "reported broken in live use."
**Why it happens:** The resume timer is anchored to pointer-lift, but iOS momentum scrolling continues with NO further pointer events after lift; `onwheel` does not fire for touch momentum either. So nothing extends the suspend through the glide.
**How to avoid:** (1) D-10's raise to ~3s already covers most momentum durations. (2) More robust: add an `onscroll` listener on `.panel`/`.lyrics` that, while `autoScroll===false`, debounces the resume — i.e. each scroll event re-arms the idle timer, so resume only fires ~3s after scrolling truly STOPS (including momentum). This is the YT-Music/Spotify feel. **Discretion area (D-10 contract: ~3s idle).**
**Warning signs:** View jumps back to current line while the list is still visibly drifting; resume feels "too eager." MUST be verified on a real iOS device — cannot be unit-tested.

### Pitfall 2: Translation alignment breaks after reorder (CRITICAL — flagged for planner)
**What goes wrong:** The translation `$effect` (NowPlaying.svelte:194-235) builds `translated[]` aligned to `lines[]` BY INDEX (`stitch = lines.map((l,i) => ...)`, render reads `translated[i]`). It also caches on `trKey = uid:lang:n:skip`. If `lines[]` order or length changes, `translated[i]` must correspond to the SAME `lines[i]`.
**Why it's actually safe (verified):** `translated` is rebuilt from the FINAL composed `lines` derived (post-reorder, post-split) — it reads `lines.length` and `lines[i].text` after all transforms. Reorder is deterministic per-LRC and only recomputes when `player.current.lrc` changes (same trigger as a new track), and `trKey` includes `uid` + `n` (line count). So a reorder cannot change order mid-track without also being a new track that re-runs the effect. Alignment holds. `[VERIFIED: translated derived from post-transform lines, NowPlaying.svelte:208/219-228; render translated[i] at :903/:906]`
**Residual risk the planner MUST check:** The widened bracket split (D-07/D-08) changes `n` (line count) for the SAME track vs. today (more or fewer `fromParen` splits). That's fine WITHIN this phase (the effect keys on the new `n`), but verify no other code persisted/cached a line-count or per-index lyric mapping for a track across the change. Grep for any other `translated[`/per-index lyric indexing. **Action: confirm during planning; add a fixture asserting `reorderPairs` then `splitParenLines` is a pure function of input (idempotent order).**

### Pitfall 3: End spacer must grow scrollHeight, not just pad visually
**What goes wrong:** Adding `padding-bottom` to `.lyrics` p or a zero-height spacer won't let the last line center if `container.scrollHeight - scrollTop` can't exceed the anchor target. The anchor `$effect` computes `top: offsetWithin - anchorWithin`; for the last line, `offsetWithin` is near the bottom and `anchorWithin` ≈ half the visible band — the browser clamps `scrollTo` to `scrollHeight - clientHeight`. Without extra trailing scrollable height, the last line stops short of center.
**Why it happens:** Browsers clamp programmatic scroll to content bounds.
**How to avoid (D-11):** Add a real trailing spacer element (or `padding-bottom` on `.lyrics`) of height ≈ **half the visible band** so there is enough scrollable runway for the last line to reach the visible-band center. The visible band is already computed in the anchor `$effect` (`visHeight`); reuse that measure to size the spacer (a `$state` height written when the band is measured, or a CSS var). D-12: NO top spacer — first lines top-pinned in closed mode is correct.
**Warning signs:** Last 2-3 lines never center in half/full mode; `scrollTo` visibly stops short at the bottom. Verify in BOTH half and full sheet modes (different visible-band sizes).

### Pitfall 4: Bracket regex must pair open-with-close (not any-open…any-close)
**What goes wrong:** A naive class-based regex `[（(...]( ... )[）)...]` matches a `（` open with a `]` close across mismatched pairs, corrupting splits on lines mixing bracket types.
**How to avoid:** Either a pair-aware alternation (`（[^）]+）|\([^)]+\)|【[^】]+】|…`) or accept the existing class approach ONLY if fixtures prove mixed-bracket lines behave. The current `splitParenLines` uses a class for just `()（）` (same visual pair shape); widening to 9 pairs raises mismatch risk. **Add a mixed-bracket fixture** (e.g. `愛（love）【chorus】`) to lock behavior. Note `[Chorus]` whole-line markers are protected by D-09's empty-stripped-main passthrough.

### Pitfall 5: `\p{Script}` requires the `u` flag and codepoint iteration
**What goes wrong:** `\p{Script=Han}` without `/u` throws SyntaxError; `for (const ch of str)` is required (not `str[i]`) so astral-plane CJK extension chars iterate as single codepoints.
**How to avoid:** Always `/u` flag; iterate with `for...of`. `[VERIFIED: node test this session; MDN]`

## Code Examples

### Convert a tapped line's time to a seek (D-01/D-03)
```typescript
// Source: codebase — player.svelte.ts:1810 seekFraction (only seek API; auto-plays when paused)
function seekToLine(line: LyricLine) {
    if (player.duration > 0) player.seekFraction(line.time / player.duration);
    if (idleTimer) clearTimeout(idleTimer);
    autoScroll = true; // D-02 instant re-center: override the pointerdown suspend
}
```

### Momentum-safe resume (LYR-02 robust fix — discretion within D-10 ~3s)
```typescript
// Re-arm the idle resume on every scroll event so resume fires ~3s after scrolling STOPS
// (covers iOS momentum, which emits no pointer/wheel events). Attach onscroll to .lyrics/.panel.
const RESUME_MS = 3000; // D-10
function bumpResume() {
    if (autoScroll) return;          // only while suspended
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => (autoScroll = true), RESUME_MS);
}
// onscroll={bumpResume} on the scroller; lyricsReleased() also uses RESUME_MS.
```

### End spacer sized from the live visible band (D-11)
```svelte
<!-- inside .lyrics, after the {#each}; spacerH is a $state px written when the band is measured -->
<div class="lyrics-end-spacer" style:height="{spacerH}px" aria-hidden="true"></div>
```
```typescript
// in the anchor $effect, after computing visHeight:
spacerH = Math.round(visHeight / 2); // ≈ half visible band → last line can center (D-11)
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Hand-rolled CJK codepoint range checks | `\p{Script=…}/u` property escapes | ES2018 (Baseline Safari 11.1 / Chrome 64) | Use native — no library, covers extension blocks |
| `scrollIntoView({block:'center'})` for lyric centering | Scoped `container.scrollTo` with visible-band math | Established in this codebase (Phase 20 sheet work) | Continue — scrollIntoView yanks the sheet |
| `()`/`（）`-only paren split | Full CJK + ASCII square bracket set, script-mismatch gated | This phase (D-07/D-08) | Wider coverage, structurally never drops originals |

**Deprecated/outdated:** Nothing deprecated. The 600ms resume constant is being tuned to ~3s (D-10), not removed.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | "Any kana presence ⇒ Japanese (`kana`)" correctly disambiguates JP from CN for original-detection | Pattern 2 | A kanji-heavy JP line with no kana in that specific line could misclassify as `han`; mitigate by computing dominant script over the whole SONG body, not per-line, for the original-language baseline. Confirm with a JP fixture. |
| A2 | LYR-02's live breakage is the momentum/early-resume case (not a fundamentally broken pressedPointers Set) | Pitfall 1 | If the Set mechanism itself is broken (e.g. window listener never attached on iOS), the 3s raise won't fix it — needs device repro to confirm which. Verify on device before assuming the fix. |
| A3 | Index-keyed `{#each lines as l,i (i)}` stays correct because reorder is per-LRC deterministic | Pattern 1 / Pitfall 2 | If any future path mutates `lines` order mid-track, translation alignment desyncs; current code does not. |
| A4 | Spacer height ≈ `visHeight / 2` lets the last line center in all modes | Pitfall 3 / D-11 | Exact divisor may need device tuning (closed mode uses top-pin, not center, so spacer mainly matters for half/full). Verify in half AND full. |

**If this table is empty:** It is not — four assumptions need confirmation (A1 + A4 via fixtures/device; A2 via device repro; A3 is verified-but-fragile).

## Open Questions

1. **Is LYR-02 broken due to early resume, or a non-firing window listener on iOS?**
   - What we know: The pressedPointers + capture-phase window pointerup mechanism is correctly coded; D-10 already plans the 3s raise.
   - What's unclear: Whether the live break is the momentum/early-resume case (A2) or the Set never releasing / listener never firing on iOS Safari.
   - Recommendation: Reproduce on a real iOS device FIRST. If it's early-resume → momentum-safe `onscroll` re-arm (Pitfall 1). If the Set is stuck → audit the window listener attach/detach under iOS scroll-takeover.

2. **Does any other code depend on the current line COUNT for a track (cross the bracket-widening change)?**
   - What we know: The translation effect re-keys on `n`; alignment is internal to the final `lines`.
   - What's unclear: Whether MediaSession, persistence, or another component caches a per-index lyric mapping.
   - Recommendation: Grep `translated[`, `lines[`, `lyric` indexing during planning; the verified evidence says only NowPlaying consumes it.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node (nvm) | vitest / build | ✓ | v22.22.0 (must PATH-prefix; default v16 breaks) | none — required |
| pnpm | test/build runner | ✓ | (in-repo) | none |
| Vitest | lrc.test.ts | ✓ | 4.1.8 | none |
| `\p{Script=…}` regex | dominantScript | ✓ | V8 / JavaScriptCore native | none — Baseline |

**Missing dependencies with no fallback:** None.
**Missing dependencies with fallback:** None.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.8 (node project) |
| Config file | `vite.config.ts` (test.projects[0], `environment: 'node'`, include `src/**/*.{test,spec}.{js,ts}`) |
| Quick run command | `export PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH"; pnpm vitest run src/lib/services/lrc.test.ts` |
| Full suite command | `export PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH"; pnpm vitest run` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| LYR-04 | `reorderPairs`: CN-translation-above-EN-original → original first; pure-CN → unchanged; JP/KR fixtures | unit | `pnpm vitest run src/lib/services/lrc.test.ts -t reorderPairs` | ✅ (extend lrc.test.ts) |
| LYR-04 | `dominantScript`: CN/JP(kana)/KR/EN/mixed → correct enum | unit | `pnpm vitest run src/lib/services/lrc.test.ts -t dominantScript` | ✅ (extend) |
| LYR-05 | widened `splitParenLines`: full bracket set recognized; script-mismatch splits, same-script stays inline; whole-line passthrough; mixed-bracket line | unit | `pnpm vitest run src/lib/services/lrc.test.ts -t splitParenLines` | ✅ (extend) |
| LYR-05 | never-drop: a line whose only brackets are same-script is never `fromParen` | unit | (same suite) | ✅ |
| LYR-01 | tap-to-seek calls `seekFraction(time/duration)` | unit-ish | (extract seek-math helper to test, OR manual) | ❌ Wave 0 (optional helper) / else manual |
| LYR-01 | tap while paused starts playback | manual (device) | — | n/a (verified by reading `seekFraction` auto-play; device-confirm) |
| LYR-02 | touch/hold/scroll suspends auto-scroll; resumes ~3s after idle (incl. momentum) | manual (iOS device) | — | n/a — REPORTED BROKEN, primary live-verify item |
| LYR-03 | last lines center via end spacer in half AND full modes | manual (device) | — | n/a |
| LYR-02/03 | tap re-centers instantly and overrides suspend | manual (device) | — | n/a |

### Sampling Rate
- **Per task commit:** `pnpm vitest run src/lib/services/lrc.test.ts` (pure lrc functions — fast, < 1s)
- **Per wave merge:** `pnpm vitest run` (full suite green)
- **Phase gate:** Full suite green + manual device pass for LYR-01(paused-play), LYR-02, LYR-03 before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] Extend `src/lib/services/lrc.test.ts` — fixtures for `reorderPairs` (CN-above-EN, pure-CN no-op, JP kana, KR hangul, 3-lines-per-timestamp from prior split)
- [ ] Extend `lrc.test.ts` — `dominantScript` fixtures (han/kana/hangul/latin/other/mixed)
- [ ] Extend `lrc.test.ts` — widened `splitParenLines` (9 bracket pairs, script-mismatch-only, same-script inline, mixed-bracket, whole-line passthrough, never-drop)
- [ ] (Optional) extract a pure `lineSeekFraction(time, duration)` helper for a LYR-01 unit test
- Framework install: none — Vitest already present and green (13 tests passing, verified this session)

## Security Domain

No security-relevant surface in this phase. LRC text is already-fetched, rendered as text (no `{@html}`); lyric content is inserted via Svelte text interpolation (auto-escaped). No new input, network, auth, crypto, or storage. ASVS V5 (Input Validation) is the only nominally-relevant category and is satisfied by Svelte's default text-escaping of `{l.text}` / `{translated[i]}`.

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V5 Input Validation / Output Encoding | yes (trivially) | Svelte auto-escapes text interpolation; no `{@html}` on lyric content |
| V2/V3/V4/V6 | no | No auth/session/access-control/crypto in scope |

## Sources

### Primary (HIGH confidence)
- Codebase: `src/lib/services/lrc.ts`, `src/lib/services/lrc.test.ts`, `src/lib/components/NowPlaying.svelte` (lines 78-235, 440-622, 894-912, 1073-1100), `src/lib/stores/player.svelte.ts` (seekFraction :1810, auto-play-when-paused :1826-1834), `src/lib/stores/settings.svelte.ts` (:127-255), `src/lib/config/defaults.ts` (:58-72), `src/lib/actions/longpress.ts`, `vite.config.ts`
- `node -e` test this session: `\p{Script=Han|Hiragana|Katakana|Hangul|Latin}/u` all true under V8 (Node v22.22.0)
- `pnpm vitest run src/lib/services/lrc.test.ts` → 13 tests passing this session

### Secondary (MEDIUM confidence)
- MDN — Unicode character class escape `\p{…}`: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Regular_expressions/Unicode_character_class_escape
- caniuse — RegExp property escapes (Baseline Safari 11.1 / Chrome 64): https://caniuse.com/mdn-javascript_builtins_regexp_property_escapes
- Mathias Bynens — Unicode property escapes: https://mathiasbynens.be/notes/es-unicode-property-escapes

### Tertiary (LOW confidence)
- LYR-02 iOS momentum-scroll root-cause hypothesis (Pitfall 1 / A2) — reasoned from the code + known iOS Safari momentum-scroll behavior; NOT device-verified. Flagged for live confirmation.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no external deps; native `\p{Script}` Baseline-confirmed; vitest verified running
- Architecture / pure lrc.ts changes: HIGH — composition seam, reorder-before-split ordering, and anchor implication all verified against current code
- Tap-to-seek (LYR-01) + D-03 resume: HIGH — `seekFraction` already auto-plays-when-paused (verified); only the time→fraction conversion + autoScroll override are new
- LYR-02 (touch-suspend) root cause + fix: MEDIUM — mechanism understood, but live breakage cause is a reasoned hypothesis requiring device repro
- End spacer centering (LYR-03): MEDIUM — approach sound; exact divisor needs device tuning in half/full
- Pitfalls (translation alignment, bracket pairing): HIGH — verified against code

**Research date:** 2026-06-12
**Valid until:** 2026-07-12 (stable — in-repo logic + Baseline web platform; no fast-moving deps)
