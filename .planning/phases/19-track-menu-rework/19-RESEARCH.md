# Phase 19: Track Menu Rework - Research

**Researched:** 2026-06-11
**Domain:** Svelte 5 runes UI rework of an existing bottom-sheet against a load-bearing overlay/history invariant; client-side only (no network/secret/auth surface)
**Confidence:** HIGH (every API named below was read directly from source this session)

## Summary

Phase 19 reworks the existing `src/lib/components/TrackMenu.svelte` against four contracts (MENU-01/02/03 + QUEUE-04). It is the most constraint-dense UI change in v1.2 not because the surface is large, but because the component sits on top of a documented, empirically-tuned **overlay==history-depth invariant** (`overlays.svelte.ts`) that breaks subtly (over-pop to the previous route) if the `$effect` registration is touched incorrectly. The good news: every primitive the planner needs already exists and was verified in code — the `loading`-on-stub menu path, `ensureTrackDetails` resolve-then-act, the `player.play(track,{fresh:true})` → `regenerate` → `buildSimilarQueue` Remix path, the `manualUids` pin-preservation, the global `.marquee-inner` system + NowPlaying two-row analog, and the `longpress.ts` trailing-click guard. This phase is **wiring + a contained set of new local state**, not new infrastructure. [VERIFIED: codebase read]

The single highest-risk change is the overlay `$effect`: it must keep its dependency as `open` ONLY (never `track`), with `untrack()` around `overlays.open/dismiss`, and `{#if open && track}` as the visibility gate. The two genuinely new affordances (Close-X and Remix) were designed by the UI-SPEC specifically to require **zero new overlay registrations** — Close just flips `open` false (converging on the existing cleanup→dismiss path), and Remix needs no sub-sheet. The second-highest risk is MENU-03, which lives entirely at the **long-press trigger sites** (home tiles, library/search/artist/NowPlaying rows), NOT inside TrackMenu — and the codebase has NO global `-webkit-tap-highlight-color`, NO `@media (hover: hover)` guard, and trigger elements use sticky `.tile:active{transform:scale(.96)}` / `.row:hover` that visibly stick under a held finger on touch.

**Primary recommendation:** Treat the overlay `$effect` as immutable (do not add deps; route Close through `close()` → `onclose()` only). Add per-action in-flight state as a local `Set<string>` (or per-action booleans) inside TrackMenu, reuse `ensureTrackDetails` for the three gated actions (Download / Detail / Remix), introduce a new `'remix'` QueueContext that `effectiveUpnextMode` resolves to `'generated'`, copy NowPlaying's two-row `{#key uid}` + `.marquee-inner` header structure verbatim, and fix MENU-03 at each trigger site with `blur()` + `@media (hover: hover)` hover-guarding + `-webkit-tap-highlight-color: transparent` (the `longpress.ts` trailing-click guard already handles the double-action half).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Gated-action resolve-then-act (MENU-01)**
- **D-01:** Remove the current "`loading` hides ALL buttons behind 9 `.mi-skel` rows" gate. All action buttons render immediately when the menu opens — even on a discovery stub (home long-press) before the real Track resolves.
- **D-02:** Actions whose effect needs resolved fields are **gated on `detailsLoaded && uid`**. Tapping a gated action before resolve is allowed (resolve-then-act): it kicks off the resolve, shows a small **inline spinner on that row**, and the action **fires automatically** once data arrives. Actions that operate on the stub object alone are NOT gated and work immediately. Apply the rule per-action (Download / Detail / Remix-play are gated because they need `audioUrl`/resolved details; Play next / Add to queue / Like / Add to playlist / Go to artist work on the stub).
- **D-03:** **Double-action dedupe** — exactly one resolve is in flight per action; a second tap while a row is spinning is a no-op. On resolve failure: clear the spinner and toast gracefully (never a stuck spinner). This is a named constraint in the ROADMAP UI hint.

**Remix (QUEUE-04)**
- **D-04:** Remix plays the triggering track first, then rebuilds up-next as a genre-generated queue seeded from it. **Reuse the existing fresh-play regenerate path** — `player.play(track, { fresh: true })` → `regenerate(seed)` → `buildSimilarQueue` — which already yields `dedupeBest([seed, ...manualEntries, ...auto])`. Do NOT build a new queue mechanism.
- **D-05:** **Replace but keep manual pins** — clear the auto/generated portion of up-next but preserve user-pinned / manually-added tracks via the existing `manualUids` discipline (the regenerate path already filters `manualEntries`). The prior generated tail is discarded.
- **D-06:** Remix must **always generate**, regardless of the user's per-context up-next setting (QUEUE-03 `'same-list'` vs `'generated'`). Set a Remix `queueContext` (or otherwise force `effectiveUpnextMode === 'generated'`) so an explicit Remix never falls back to same-list. Exact mechanism → planning/research.
- **D-07:** Remix is a **gated action** (needs `audioUrl` to play the seed) — same resolve-then-act treatment as D-02. Placement: in the queue-actions cluster near Play-next / Add-to-queue. Icon: a distinct one (Shuffle is already taken by `shuffleQueue`) — Claude's discretion. Feedback: toast on trigger.

**Header layout & skeleton (MENU-02)**
- **D-08:** Header becomes **two rows** — row 1 song name, row 2 artist name — each `use:marquee` (overflow-only animate). Follow the NowPlaying analog + the project marquee rule: a `marquee-inner` child with the parent locked `flex` / `min-width: 0` / `max-width`; the marquee CSS keyframe lives in this component [CORRECTION: the keyframe is GLOBAL in app.css — see Pitfall 4] (the action only toggles `.marquee-on` + `--marquee-dx`). Replaces the single `{title} · {artist}` ellipsis line.
- **D-09:** **Like (heart) + Close (X) sit top-right** of the header, side by side. Like moves OUT of the action list — **remove the mid-list Like row** to avoid duplication. The X is a NEW explicit close affordance (today close is scrim/drag only); it only flips state false and converges on the single dismiss path (the `$effect` cleanup → `overlays.dismiss`), exactly like the existing detail-modal X.
- **D-10:** Header rows are **display-only (not tappable)**. Keep "Go to artist" as its own action row — do NOT make the artist row tap through.
- **D-11:** The opening **skeleton matches the new 2-row header shape** (two stacked bars sized to title/artist). Home stubs already carry title/artist so header text is usually present immediately; the skeleton covers the brief pre-data / marquee re-measure window and keeps layout from jumping.

**Long-press release (MENU-03)**
- **D-12:** After a long-press opens the menu: **clear any stuck active/focus/hover** on the trigger element under the finger AND **suppress the synthetic click/tap** that fires on finger-up so the row does not also play/navigate (no double action). This applies at the long-press **trigger sites** (home tiles, track rows, compact rows), not inside TrackMenu. Exact mechanism (blur + `pointercancel` + suppress-next-click vs CSS hover guards) → research/planning per iOS Safari vs Android Chrome long-press→click behavior.

### Claude's Discretion
- Remix icon choice; the exact inline-spinner visual; the precise gated-vs-ungated action set (apply the `detailsLoaded && uid` rule); the long-press cleanup mechanism; whether Share is gated (depends on whether `shareUrl(track)` needs resolved fields — it likely does not).

### Deferred Ideas (OUT OF SCOPE)
- None — discussion stayed within phase scope. (Remix icon, inline-spinner visual, and the long-press cleanup mechanism are Claude's discretion within this phase, not deferred to a future one.)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MENU-01 | Menu opens instantly with all buttons visible while data resolves; gated actions are resolve-then-act (`detailsLoaded && uid`) and complete gracefully | `ensureTrackDetails` readiness guard + idempotency (catalog.ts:181–193); existing stub-resolve menu path (`tileMenu`/`menuLoading`, +page.svelte:543–558); per-action in-flight `Set` pattern (see Architecture Pattern 2) |
| MENU-02 | Two-row marquee header (song/artist) + like top-right beside close + skeleton matches new shape | NowPlaying two-row `{#key uid}` + `.marquee-inner` analog (NowPlaying.svelte:697–701); global `marquee-scroll` keyframe (app.css:72–84); `use:marquee` overflow-only action (marquee.ts); detail-modal X precedent (TrackMenu.svelte:218) |
| MENU-03 | Long-press open leaves NO stuck focus/active state on the item under the finger (+ no double action) | `longpress.ts` `suppressNextClick` already handles trailing-click; missing half = stuck `:active`/`:hover`; trigger sites enumerated below; NO global tap-highlight/hover-guard exists today |
| QUEUE-04 | "Remix" plays the triggering track then seeds genre-generated up-next from it | `player.play(track,{fresh:true})` → `regenerate(seed)` → `buildSimilarQueue` → `dedupeBest([seed, ...manualEntries, ...auto])` (player.svelte.ts:1276–1327); `manualUids` pin discipline; `effectiveUpnextMode`/`queueContext` force-generate gate (settings.svelte.ts:442–445; defaults.ts:92–109) |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Menu visibility + dismiss | Browser / Client (TrackMenu component) | — | Pure presentation; converges on `overlays` store for back-gesture/history |
| Overlay/history balance | Client store (`overlays.svelte.ts`) | — | History-API stack is a cross-cutting client concern, owned by one singleton |
| Stub→resolved data | Client service (`catalog.ts` `ensureTrackDetails`) → source adapter → SvelteKit `/api` proxy | API proxy resolves metadata; audio bytes are browser→CDN | Resolve step is the existing data-layer seam; TrackMenu only awaits it |
| Remix queue generation | Client store (`player.svelte.ts` `regenerate`) → `similar.ts` → `/api/similar` (+ `/api/deezer/related` fallback) | Last.fm key stays edge-side | Already implemented; Remix only forces the context |
| Per-action in-flight state | Browser / Client (TrackMenu local `$state`) | — | Transient UI state, never persisted, never a Track field |
| Long-press release (no stuck state) | Browser / Client (trigger components + their scoped CSS) | — | Pointer/focus/hover cleanup is per-element; NOT a TrackMenu responsibility |

## Standard Stack

This is a UI rework inside a mature, hand-rolled design system. NO new runtime dependencies. The only external UI dependency is the existing icon library.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `svelte` | 5.56.2 | Runes (`$state`/`$derived`/`$effect`/`$props`), `untrack`, `tick` | Already the project framework; runes are the established state idiom |
| `@lucide/svelte` | 1.17.0 | Icons — existing `Heart`, `X` (header cluster); NEW `Sparkles` (Remix) | Already a project dep; `Sparkles` confirmed present (icon file `sparkles.svelte` exists, same named-export pattern as `Shuffle`/`X`) [VERIFIED: node_modules read] |

### Supporting (all in-repo, no install)
| Module | Path | Purpose | When to Use |
|--------|------|---------|-------------|
| `overlays` | `src/lib/stores/overlays.svelte.ts` | History-balanced overlay stack | Already wired in TrackMenu; DO NOT touch the registration pattern |
| `player` | `src/lib/stores/player.svelte.ts` | `play(track,{fresh})`, `regenerate`, `manualUids`, `queueContext`, `setQueue`, `toggleShuffle`, `clearQueue` | Remix calls `setQueue([track], 'remix')` then `play(track,{fresh:true})` |
| `ensureTrackDetails` | `src/lib/services/catalog.ts` | Resolve a stub's `audioUrl`+lyrics; idempotent | The await target for the 3 gated actions |
| `marquee` action | `src/lib/actions/marquee.ts` | `use:marquee` overflow-only animate | Both header rows |
| `longpress` action | `src/lib/actions/longpress.ts` | `use:longpress` + trailing-click guard | Already at every trigger site; MENU-03 extends the stuck-state half at the sites |
| `library` | `src/lib/stores/library.svelte.ts` | `toggleLike`/`isLiked` | Header heart |
| `settings` | `src/lib/stores/settings.svelte.ts` | `effectiveUpnextMode(ctx)` | The gate Remix forces |
| `shareUrl` | `src/lib/services/share.ts` | Builds a share link from `uid`/`title`/`artist` + queue | Share is UNGATED (see below) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| New `'remix'` QueueContext value | Pass an explicit `mode` override param down `play()`→`regenerate()` | Threading a param through 3 methods is more invasive than one enum value; the QueueContext enum is the established force-generate seam (D-06 names it). Recommend the enum value. [ASSUMED — both work; enum is least-churn] |
| Per-action `Set<string>` in-flight guard | Per-action boolean fields (`downloadInFlight`, etc.) | A `Set<actionKey>` scales to N gated actions with one field and one guard; per-action booleans are more verbose. Either satisfies D-03. Recommend the `Set`. |
| `Sparkles` (Remix icon) | `Wand2`, `Disc3`, `RefreshCw` | `Shuffle` is taken (shuffleQueue), `Repeat`/`Repeat1` taken (transport). `Sparkles` reads "freshly generate" and is in the UI-SPEC. Confirmed present in `@lucide/svelte@1.17.0`. |

**Installation:** None. `npm install` not required — no new packages.

**Version verification:** `@lucide/svelte` resolved at `1.17.0` via `node_modules/@lucide/svelte/package.json`; `svelte` at `5.56.2` via `package.json`. [VERIFIED: installed package read]

## Package Legitimacy Audit

> Not applicable — this phase installs NO external packages. All code reuses in-repo modules and the already-installed `@lucide/svelte` / `svelte`. No registry fetch, no slopcheck target, no postinstall surface. The one NEW icon (`Sparkles`) is a named export of the existing `@lucide/svelte@1.17.0` dependency, verified by the presence of `node_modules/@lucide/svelte/dist/icons/sparkles.svelte`.

## Architecture Patterns

### System Architecture Diagram

```
                              ┌─────────────────────────── TRIGGER SITES (MENU-03 lands here) ───────────────────────────┐
                              │ home tiles (.tile/.album)  library rows (.row)  search rows  artist rows  NP queue rows   │
                              │            use:longpress onlongpress={() => openMenu(track) | tileMenu(stub)}             │
                              └───────────────────────────────────────────────┬──────────────────────────────────────────┘
        long-press fires ───────────────────────────────────────────┐         │ short tap (suppressed if longpress fired)
        (open menu + blur trigger + suppressNextClick)               │         ▼
                                                                     │   play / navigate
                                                                     ▼
                                        ┌──────────── TrackMenu.svelte (open=true) ────────────┐
   stub OR resolved Track ───track prop─▶│  $effect(dep=open ONLY, untrack(overlays.open/dismiss))│──register──▶ overlays store
   (reassigned stub→resolved             │  {#if open && track}                                  │   (1 history pushState; cleanup = sole dismiss)
    must NOT re-run effect)              │  ┌─ header: {#key track.uid} 2× use:marquee + ♥ ✕    │
                                         │  ├─ UNGATED rows: PlayNext AddQueue Like* AddPlaylist  │
                                         │  │   Sleep GoToArtist Share (+Shuffle/Clear gated      │
                                         │  │   only on queue.length>1)                           │
                                         │  └─ GATED rows: Download | Detail | Remix              │
                                         │       tap → inFlight.add(key) → ensureTrackDetails ────┼──▶ catalog → adapter → /api proxy (metadata)
                                         │       on resolve: run action once, inFlight.delete     │       (audio bytes: browser → CDN direct)
                                         │       on fail: clear spinner + toast (never stuck)     │
                                         └───────────────────────────────────────────────────────┘
                                                          │ Remix tap
                                                          ▼
                          player.setQueue([seed], 'remix') ; player.play(seed, {fresh:true})
                                                          ▼
                          effectiveUpnextMode('remix') === 'generated'  (forced by D-06)
                                                          ▼
                          regenerate(seed) → buildSimilarQueue(seed, exclude=seed+manual+removed)
                                                          ▼
                          queue = dedupeBest([seed, ...manualEntries, ...auto])   (manual pins preserved)
```

### Component Responsibilities

| File | Responsibility in this phase | Change type |
|------|------------------------------|-------------|
| `src/lib/components/TrackMenu.svelte` | Contracts 1–3: header rework, always-visible buttons + gated resolve-then-act, Remix row, Close-X | Major edit |
| `src/lib/stores/player.svelte.ts` | Possibly add nothing (Remix uses existing `play`/`regenerate`); if D-06 via enum, no method change needed | None / minimal |
| `src/lib/config/defaults.ts` | Add `'remix'` to the `QueueContext` union (D-06 mechanism) | 1-line type edit |
| `src/lib/stores/settings.svelte.ts` | If `'remix'` must force-generate, ensure `effectiveUpnextMode('remix')` returns `'generated'` — see Pattern 3 | Verify / 1-line |
| `src/lib/i18n/*.ts` (×15) | Add `menu.remix`, `toast.remixing`, `menu.preparing` to all 15 dicts (parity) | 3 keys × 15 files |
| Trigger sites (`(app)/+page.svelte`, `library/+page.svelte`, `search/+page.svelte`, `artist/[name]/+page.svelte`, `NowPlaying.svelte`) | Contract 4: blur + hover/active guard at each `use:longpress` site | CSS + handler edits |
| `src/app.css` (optional) | A global `-webkit-tap-highlight-color: transparent` + `@media (hover: hover)` hover guard would fix MENU-03 broadly in one place | Optional global edit |

### Pattern 1: Overlay `$effect` registration (MUST NOT BREAK)

**What:** The single `$effect` that registers the menu with the `overlays` stack. **When to use:** Already present — the rule is "do not change its shape." **Example (verbatim from current code — keep this exact shape):**
```typescript
// Source: src/lib/components/TrackMenu.svelte:142–158
$effect(() => {
    // DEP IS `open` ONLY — never `track`. untrack() wraps overlays.open/dismiss because
    // they READ the $state overlay stack internally; without untrack, ANY other overlay
    // push/pop would re-run this effect (cleanup+reopen → history churn).
    if (open) {
        untrack(() => overlays.open("trackmenu-menu", () => onclose()));
        return () => untrack(() => overlays.dismiss("trackmenu-menu"));
    }
});
```
**Why `track` must NOT be a dep:** the home long-press opens on a discovery STUB then reassigns `track` (stub→resolved) after `resolveStub`. If `track` were a dep, the reassignment re-runs the effect: cleanup fires `overlays.dismiss` (→ `history.back()`) and the body re-runs `overlays.open` (→ `pushState`) in the same flush — a back()+push churn that desyncs history depth and over-pops Back into the PREVIOUS route (long-press a home tile → bounced to /library or /search). The `{#if open && track}` render guard still gates visibility; `overlays.open` is idempotent. [VERIFIED: codebase read — overlays.svelte.ts:59–77 idempotency + TrackMenu.svelte:147–153 comment]

**Adding Close (X) WITHOUT a new overlay entry:** Close calls the existing `close()` which sets `pickerOpen=false` then `onclose()`; `onclose()` flips the host's `open` state false; the `$effect` cleanup is the SOLE `overlays.dismiss` caller. The new X button does the SAME thing the scrim does — `onclick={close}`. NO new `overlays.open`/`dismiss` call, exactly like the existing detail-modal X (TrackMenu.svelte:218 calls a local state-flip only). This is the single dismiss path; do not let X call `overlays.dismiss` directly.

### Pattern 2: Per-action resolve-then-act with in-flight dedupe (MENU-01)

**What:** A gated action, tappable on a stub, that kicks off `ensureTrackDetails`, shows an inline spinner on its own row, fires automatically on resolve, dedupes a second tap, and clears gracefully on failure. **When to use:** Download, Detail, Remix-play only (the `detailsLoaded && uid` set). **Pattern (Svelte 5 runes):**
```typescript
// In-flight guard — a Set of action keys (D-03: one resolve per action max).
let inFlight = $state(new Set<string>());

async function gated(actionKey: string, run: (resolved: Track) => void | Promise<void>) {
    if (!track) return;
    if (inFlight.has(actionKey)) return;               // D-03 dedupe: second tap is a no-op
    // Already resolved? run immediately (ungated fast-path).
    if (track.detailsLoaded && track.uid && track.audioUrl) { await run(track); return; }
    inFlight = new Set(inFlight).add(actionKey);        // reassign for runes reactivity
    try {
        const resolved = await ensureTrackDetails(track);  // idempotent; awaits proxy round-trip
        if (!resolved.audioUrl) { toast(t('toast.noAudio')); return; }   // graceful fail
        await run(resolved);                            // fires automatically on resolve
    } catch {
        toast(t('toast.noAudio'));                      // never a stuck spinner
    } finally {
        const next = new Set(inFlight); next.delete(actionKey); inFlight = next;  // clear spinner
    }
}
```
**Gated set (apply `detailsLoaded && uid` literally — needs resolved `audioUrl`/details):**
- **Download** — re-resolves at `settings.downloadQuality`, then `fetch(audioUrl)` → blob (TrackMenu.svelte:74–110). Needs `audioUrl`.
- **Detail** — `ensureTrackDetails(track)` to populate the detail sheet's audioUrl/quality rows (TrackMenu.svelte:123–127). Needs resolved fields.
- **Remix-play** — needs `audioUrl` to play the seed (Contract 3).

**Ungated set (work on the stub object alone — render + active immediately):**
- **Play next** (`player.playNext` — adds stub to queue, manualUids), **Add to queue** (`player.addToQueue`), **Like** (now in header; `library.toggleLike` on `{uid,title,artist,album}`), **Add to playlist** (`library.addToPlaylist`), **Go to artist** (`overlays.navigateAway(goto)` on `track.artist`), **Sleep timer** (opens global sheet), **Share** (`shareUrl(track, queue)` builds from uid/title/artist + queue — NOT resolved audio → NOT gated, confirms D-discretion), plus **Shuffle queue** / **Clear queue** (gated only on `player.queue.length > 1`, NOT on track resolution — unchanged).

**Important — current `loading` semantics to REPLACE:** today `loading` gates the WHOLE list behind 9 `.mi-skel` rows (`{#if loading} ... {:else} buttons {/if}`, TrackMenu.svelte:177–200). D-01 removes that. The `loading` prop becomes the HEADER-only skeleton signal (two stacked `.sk` bars), and the action list always renders. The home (`+page.svelte:543–558`) and album (`album/[name]/+page.svelte:213–225`) callers ALREADY pass `loading={menuLoading}` and reassign `track` stub→resolved — that wiring is correct and unchanged; only TrackMenu's internal use of `loading` changes.

### Pattern 3: Force-generate Remix context (QUEUE-04 / D-06)

**What:** Remix must always regenerate regardless of the user's per-context up-next setting. **Mechanism (recommended):**
1. Add `'remix'` to the `QueueContext` union in `defaults.ts:94–103`.
2. Remix handler: `player.setQueue([seed], 'remix')` then `player.play(seed, { fresh: true })`. `setQueue` records `queueContext='remix'`; the fresh-play branch reads `settings.effectiveUpnextMode(this.queueContext)` (player.svelte.ts:1280).
3. Ensure `effectiveUpnextMode('remix')` returns `'generated'`. Today `effectiveUpnextMode(ctx)` returns `this.upnextPerContext[ctx] ?? this.upnextMode` (settings.svelte.ts:442–445). Since the global `upnextMode` default IS `'generated'` and `upnextPerContext` has no `'remix'` key, this returns `'generated'` UNLESS the user has globally set `'same-list'`. To GUARANTEE generation, add an explicit early return: `if (ctx === 'remix') return 'generated';` at the top of `effectiveUpnextMode`. [VERIFIED: settings.svelte.ts:438–445 + defaults.ts:104–109] This single line makes D-06 airtight regardless of any user override.

**Why this preserves manual pins (D-05):** `regenerate(seed)` (player.svelte.ts:1305–1327) filters `manualEntries = queue.filter(t => manualUids.has(t.uid) && t.uid !== seed.uid)`, builds `exclude = {seed, ...manualEntries, ...removedUids}`, then `queue = dedupeBest([seed, ...manualEntries, ...auto])`. The seed plays first, manual pins survive, the prior generated tail is discarded. [VERIFIED: player.svelte.ts read] No new queue mechanism needed (D-04).

### Pattern 4: Two-row marquee header (MENU-02 / D-08)

**What:** Replace the single `.menu-head` line with two stacked marquee clips + a top-right Like/Close cluster. **Copy NowPlaying's exact structure:**
```svelte
<!-- Source: src/lib/components/NowPlaying.svelte:697–701 -->
{#key player.current?.uid}
    <div class="title" use:marquee><span class="marquee-inner">{names.dnTitle(track.title)}</span></div>
    <button class="artist" use:marquee onclick={openArtist}><span class="marquee-inner">{names.dnArtist(track.artist)}</span></button>
{/key}
```
**For TrackMenu (header rows are DISPLAY-ONLY per D-10 — use `<div>`, not `<button>`):**
- Wrap both rows in `{#key track.uid}` so a stub→resolved reassignment (text width change) REMOUNTS the clips → forces `use:marquee` to re-measure. This is the documented re-measure trigger (the clips are otherwise persistent nodes whose box width is unchanged, so `use:marquee` would never re-fire). [VERIFIED: NowPlaying.svelte:692–700 comment explains this exact rationale]
- Each clip: `overflow:hidden; white-space:nowrap; text-overflow:ellipsis; min-width:0; max-width:100%`. Inside: `<span class="marquee-inner">…</span>`.
- The keyframe is GLOBAL (`@keyframes marquee-scroll` + `.marquee-on .marquee-inner` in app.css:72–84). Do NOT redefine it in the component — `use:marquee` only sets `--marquee-dx` + toggles `.marquee-on`. [VERIFIED: app.css read] (This CORRECTS the D-08 phrasing "the keyframe lives in this component" — it lives globally; only the row CLASSES are component-scoped.)
- Reduced-motion: `marquee.ts:43–47` and the app's `:root[data-reduce-motion]` rule both kill the animation → static ellipsis. No extra work.
- Right cluster (`flex: 0 0 auto`): Like (`Heart`, fill+accent when liked, `aria-pressed`) then Close (`X`, `--color-text`), each ≥44×44 hit area. Left text column is `flex:1; min-width:0`.

### Anti-Patterns to Avoid
- **Adding `track` (or any field of it) to the overlay `$effect` deps** — over-pops Back to the previous route. (Pattern 1.)
- **Calling `overlays.dismiss` directly from the X button** — breaks the single-dismiss-path invariant → history desync. X flips state only.
- **Redefining `@keyframes marquee-scroll` in TrackMenu** — the global one already exists; a duplicate diverges from the gmy-unified system.
- **Keeping the 9-row `.mi-skel` / `.sk-bar` skeleton** — D-01 removes it; the new skeleton is HEADER-only using the global `.sk` class.
- **Showing gated actions as `disabled` on a stub** — they are TAPPABLE (resolve-then-act). `disabled` is reserved for genuinely-unavailable actions (e.g. Clear queue when `queue.length<=1`, which is simply not rendered).
- **Fixing MENU-03 inside TrackMenu** — the stuck-state fix belongs at the TRIGGER sites; TrackMenu's only related duty is not breaking the overlay invariant on the stub path.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Genre-similar Remix queue | A new queue generator | `player.play(seed,{fresh:true})` → `regenerate` → `buildSimilarQueue` | Already yields `dedupeBest([seed, ...manualEntries, ...auto])`, preserves `manualUids`, has Last.fm→Deezer→same-artist fallback (D-04) |
| Preserving user-pinned tracks across remix | A custom "pinned" Track field | `player.manualUids` Set + `regenerate`'s manualEntries filter | Established side-state discipline; keeps Track objects clean (D-05) |
| Stub resolution / "is it ready" | A bespoke detailsLoaded check | `ensureTrackDetails(track)` (idempotent readiness guard) | A resolved track short-circuits; download path threads a quality tier (MENU-01) |
| Overlay back-gesture / history balance | popstate wiring in the component | `overlays.open/dismiss` via the existing `$effect` | The invariant is empirically tuned; re-implementing risks over-pop |
| Marquee overflow detection + animation | A scroll/measure loop | `use:marquee` + global `.marquee-inner` keyframe | ResizeObserver-backed, reduced-motion-safe, twitch-guarded (MIN_OVERFLOW_PX) |
| Trailing-click suppression after long-press | A custom click eater | `longpress.ts` `suppressNextClick` (already present) | Capture-phase one-shot, self-disarms at 700ms; only the stuck-VISUAL half is missing |
| Force-generate context | A boolean param threaded through play() | A `'remix'` QueueContext value + early-return in `effectiveUpnextMode` | One enum value + one line vs 3-method param surgery (D-06) |

**Key insight:** Almost the entire QUEUE-04 behavior already ships in `player.svelte.ts`. Phase 19 is predominantly (a) a TrackMenu template/state rework, (b) one enum value + one settings line for force-generate, (c) i18n key parity, and (d) a CSS+handler pass at the long-press trigger sites. The temptation to "build a Remix engine" is the trap — there is nothing to build.

## Runtime State Inventory

> This is a rename/refactor-adjacent UI rework. It introduces no new persisted keys and migrates no stored data, but the inventory is completed explicitly per protocol.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | **None.** The new `'remix'` QueueContext is NOT persisted — `queueContext` is deliberately not written to localStorage (player.svelte.ts:160–167 comment: "intentionally NOT persisted → reload → null → global default"). The persisted player key `openmusic:player:v1` shape is unchanged. Library key `openmusic:library:v1` (Like) unchanged. | None — verified by reading `serializeTrack`/`persist` (player.svelte.ts:227–267): no queueContext field written. |
| Live service config | **None.** No external service config references the menu. | None — verified: purely client UI. |
| OS-registered state | **None.** No OS-registered names involved. | None. |
| Secrets/env vars | **None.** Client-side only; no new network/secret/auth surface (additional_context confirms). The Last.fm key used by `buildSimilarQueue` stays edge-side and is untouched. | None. |
| Build artifacts | **None.** No package rename, no egg-info/binary. The 3 new i18n keys are source edits compiled by Vite normally. | None. |

**The canonical question** — *after every file is updated, what runtime state still carries an old shape?* — answer: **nothing.** Adding `'remix'` to the `QueueContext` union is purely a compile-time type widening; no stored record uses it (queueContext is never persisted). The only cross-file consistency requirement is i18n: all 15 dictionaries must gain the 3 new keys (a code edit, not a data migration).

## Common Pitfalls

### Pitfall 1: History desync / over-pop (the headline risk)
**What goes wrong:** Back gesture (or the scrim/X) pops TWO history states or zero, snapping the URL to the previous route or leaving Back stuck.
**Why it happens:** Adding `track` to the overlay `$effect` deps (or having X call `overlays.dismiss` directly) creates a second/extra dismiss path → history depth ≠ stack depth.
**How to avoid:** Keep the `$effect` dep `open`-only with `untrack()`; X flips state only; the `$effect` cleanup is the SOLE dismiss caller. (Pattern 1.)
**Warning signs:** Long-pressing a home tile then pressing Back lands on /library or /search instead of staying on /; or Back needs two presses to close the menu.

### Pitfall 2: Marquee twitch / no re-measure on resolve
**What goes wrong:** Header text doesn't animate after stub→resolved, or twitches every frame.
**Why it happens:** Without `{#key track.uid}` the clip nodes persist (same box width) so `use:marquee` never re-measures the new (wider) resolved text. Re-measuring on every ResizeObserver tick (height/sub-pixel churn) restarts the animation → twitch (marquee.ts:71–78 already guards width-only).
**How to avoid:** Wrap both rows in `{#key track.uid}` (NowPlaying analog). Trust the action's `MIN_OVERFLOW_PX=8` + width-only re-measure.
**Warning signs:** Resolved long titles stay static/ellipsis; or a visible 2–3px jitter on the title.

### Pitfall 3: Stuck spinner on resolve failure / double-action
**What goes wrong:** A gated action's spinner never clears (resolve failed) or the action fires twice.
**Why it happens:** Missing `finally` cleanup, or no in-flight dedupe (second tap starts a second resolve).
**How to avoid:** `inFlight` Set guard at entry (D-03); clear in `finally`; toast `toast.noAudio` on `!audioUrl`/throw (D-03). (Pattern 2.)
**Warning signs:** A perpetually-spinning Download row; two "Remixing…" toasts; two downloads.

### Pitfall 4: Marquee keyframe duplication
**What goes wrong:** Header marquee animates differently from NowPlaying/home, or a console warning about a redefined keyframe.
**Why it happens:** Re-declaring `@keyframes marquee-scroll` / `.marquee-on .marquee-inner` in the component (D-08's "keyframe lives in this component" phrasing is misleading).
**How to avoid:** Use the GLOBAL keyframe in app.css:72–84; the component only styles the clip + `.marquee-inner` is global. (Pattern 4 correction.)

### Pitfall 5: i18n key parity across 15 dicts
**What goes wrong:** A new key (`menu.remix`/`toast.remixing`/`menu.preparing`) added only to `en.ts` → missing-key fallback to the raw key string in other locales, or the parity test partially passes.
**Why it happens:** 15 dictionaries (`ar/de/en/es/fr/hi/id/it/pt/ru/th/tr/vi/zh-Hans/zh-Hant`) must all carry the same keys. NOTE: the existing parity test (`i18n.test.ts:43–50`) only asserts `en`/`zh-Hant`/`zh-Hans` — it will NOT catch a missing key in the other 12.
**How to avoid:** Add all 3 keys to ALL 15 files. Consider extending the parity test to iterate `dicts` (all locales) rather than the hardcoded 3 — low-cost robustness win and Wave-0 candidate.
**Warning signs:** A French/German user sees `menu.remix` literal text; CI green despite a hole (because the test only checks 3 locales).

### Pitfall 6: Stuck `:active`/`:hover`/focus under the finger (MENU-03 core)
**What goes wrong:** After a long-press opens the menu, the trigger tile/row stays scaled-down (`.tile:active{transform:scale(.96)}`) or highlighted (`.row:hover{background}`) under the held finger; on iOS a grey `-webkit-tap-highlight` flashes/sticks.
**Why it happens:** Touch `:hover` is sticky (it latches until the next tap elsewhere); `:active` persists while the pointer is held but a long-press holds it; there is NO global `-webkit-tap-highlight-color: transparent` and NO `@media (hover: hover)` guard in app.css today. [VERIFIED: grep of app.css found none]
**How to avoid (per trigger site, or one global pass):**
- `-webkit-tap-highlight-color: transparent` (global on `button`/interactive, or per element) — kills the iOS grey flash.
- Guard hover with `@media (hover: hover) { .row:hover { background: … } }` so touch devices never latch `:hover`.
- On `onlongpress`, call `(e.currentTarget as HTMLElement).blur()` to drop focus, and rely on `longpress.ts`'s `pointercancel`/`pointerup` `clear()` for `:active` release. iOS Safari fires a synthetic `click` after a long hold (already eaten by `suppressNextClick`); Android Chrome fires `contextmenu` (already `preventDefault`'d in `longpress.ts:80`).
**Warning signs:** A home tile stays shrunk/greyed while the menu is open; a library row keeps its hover background after the menu closes.

### Pitfall 7: Removing the mid-list Like row but leaving its handler/import dangling
**What goes wrong:** Duplicate Like affordance, or an unused `like()`/`Heart` import flagged by `svelte-check`.
**Why it happens:** D-09 moves Like to the header; the mid-list `.mi` Like row (TrackMenu.svelte:191) must be removed, but `like()` is REUSED by the header heart and `Heart` is REUSED there too — so keep both, just relocate the markup.
**How to avoid:** Move the heart to the header cluster; delete only the mid-list row markup; keep `like()` + `Heart` import.

## Code Examples

### Header cluster (Like + Close, top-right) — display-only text rows on the left
```svelte
<!-- Pattern derived from NowPlaying.svelte:697–701 (marquee) + TrackMenu.svelte:218 (X precedent) -->
<div class="sheet-head">
  <div class="head-text">                                  <!-- flex:1; min-width:0 -->
    {#key track.uid}
      <div class="hd-title" use:marquee><span class="marquee-inner">{names.dnTitle(track.title)}</span></div>
      <div class="hd-artist" use:marquee><span class="marquee-inner">{names.dnArtist(track.artist)}</span></div>
    {/key}
  </div>
  <div class="head-actions">                               <!-- flex:0 0 auto; gap:18px -->
    <button class="hd-btn" aria-label={liked ? t('menu.liked') : t('menu.like')} aria-pressed={liked} onclick={like}>
      <Heart size={20} fill={liked ? 'currentColor' : 'none'} class:liked={liked} />
    </button>
    <button class="hd-btn" aria-label={t('menu.closeMenu')} onclick={close}>
      <X size={20} />
    </button>
  </div>
</div>
```

### Header-only skeleton (replaces the 9-row list skeleton) using the GLOBAL `.sk` class
```svelte
{#if loading && !track.title}
  <div class="sheet-head" aria-hidden="true">
    <div class="head-text">
      <div class="sk" style="height:15px;width:65%;border-radius:6px"></div>
      <div class="sk" style="height:12px;width:45%;border-radius:6px;margin-top:6px"></div>
    </div>
  </div>
{/if}
<!-- action list ALWAYS renders below (D-01) -->
```

### Remix action row (gated, forces generation)
```svelte
<button class="mi" onclick={() => gated('remix', doRemix)} aria-busy={inFlight.has('remix')}>
  {#if inFlight.has('remix')}<span class="row-spinner" aria-label={t('menu.preparing')}></span>{:else}<Sparkles size={18} />{/if}
  {t('menu.remix')}
</button>
```
```typescript
function doRemix(seed: Track) {
    toast(t('toast.remixing'));            // D-07 toast on trigger
    player.setQueue([seed], 'remix');      // D-06 force-generate context
    player.play(seed, { fresh: true });    // D-04 reuse existing path
    close();
}
```

### Inline row spinner (neutral, reduced-motion-aware)
```css
.row-spinner { width:16px; height:16px; border:2px solid var(--color-text-muted);
  border-top-color: transparent; border-radius:50%; animation: spin .7s linear infinite; flex:none; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .row-spinner { animation: none; } }
:root[data-reduce-motion] .row-spinner { animation: none; }
/* reduced-motion fallback: the row label still shows menu.preparing via aria-label + aria-busy */
```

## State of the Art

| Old Approach (current TrackMenu) | New Approach (this phase) | Why |
|----------------------------------|---------------------------|-----|
| `{#if loading} 9× .mi-skel {:else} buttons` (whole list hidden) | Header-only skeleton; buttons always render; gated actions resolve-then-act | Menu must never wait on network to appear (MENU-01 / D-01) |
| Single `.menu-head` `{title} · {artist}` ellipsis | Two-row `{#key uid}` marquee + top-right Like/Close cluster | MENU-02 / D-08–D-10 |
| Like as a mid-list `.mi` row | Like in header cluster (heart + accent, `aria-pressed`) | D-09 (de-dup) |
| Close via scrim/drag only | Explicit X button (flips state → single dismiss path) | D-09 |
| No Remix | `Sparkles` Remix row, force-generated context | QUEUE-04 / D-04–D-07 |
| Trigger sites: trailing-click guarded, but `:active`/`:hover` stick | Add blur + hover/active guard + tap-highlight reset | MENU-03 / D-12 |

**Deprecated/outdated in this component after the rework:**
- `.mi-skel`, `.sk-ico`, `.sk-bar`, `@keyframes mi-shimmer` (TrackMenu.svelte:244–253) — remove with the old gate; the new skeleton uses the global `.sk`.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Adding `'remix'` to the `QueueContext` union + an early `return 'generated'` in `effectiveUpnextMode` is the least-churn D-06 mechanism (vs threading a `mode` param through `play`/`regenerate`) | Pattern 3 / Stack alternatives | Low — both work; if the planner prefers a param, the regenerate logic is unchanged. The enum approach touches 2 files; the param approach touches 3 methods. |
| A2 | Share is NOT gated (`shareUrl(track, queue)` builds from uid/title/artist + queue, not resolved audio) | Pattern 2 ungated set | Low — confirmed by reading `doShare` (TrackMenu.svelte:111–122) which calls `shareUrl(track, player.queue)` with no `ensureTrackDetails`. UI-SPEC D-discretion agrees. |
| A3 | `(e.currentTarget).blur()` on `onlongpress` + existing `pointercancel`/`pointerup` clear + a `@media (hover:hover)` guard + `-webkit-tap-highlight-color:transparent` fully clears stuck state on BOTH iOS Safari and Android Chrome | Pitfall 6 / Validation | Medium — the exact iOS-vs-Android sticky-`:hover` behavior is the one thing that genuinely needs DEVICE verification (no jsdom/browser test project exists). The mechanisms are standard and well-documented, but "no stuck highlight" is a visual contract only confirmable on real hardware. |
| A4 | The existing i18n parity test (`i18n.test.ts:43–50`) only asserts en/zh-Hant/zh-Hans, so a missing key in the other 12 locales would NOT fail CI | Pitfall 5 / Validation | Low for correctness (recommend extending the test), Medium for "CI is green" false confidence if not extended. |

## Open Questions

1. **Should the i18n parity test be widened to all 15 locales?**
   - What we know: 15 dict files exist; the test checks 3 (`i18n.test.ts:43–50`).
   - What's unclear: whether the team wants the test hardened now vs accepting the en/zh-only check.
   - Recommendation: Widen it (iterate `Object.keys(dicts)`) as a cheap Wave-0 task — it makes the 3-new-key parity requirement self-enforcing for this phase and all future ones.

2. **Global vs per-site MENU-03 CSS fix?**
   - What we know: there is no global tap-highlight/hover guard today; trigger sites use `.tile:active{scale}` and `.row:hover{bg}`.
   - What's unclear: whether a single global `app.css` rule (`button { -webkit-tap-highlight-color: transparent }` + `@media (hover:hover)` wrapping) is preferred over per-component edits.
   - Recommendation: Do the global tap-highlight reset once in app.css (zero downside), and convert each trigger site's `:hover` rules to live inside `@media (hover: hover)`. This is fewer edits AND more correct than per-site patching, and matches the "trigger sites adopt the fix" contract.

## Environment Availability

> Skipped — this phase has no external tool/service/runtime dependencies beyond the project's own toolchain (already present: `pnpm`/`vite`/`vitest`/`svelte-check`). It is a client-side code/CSS/i18n change. No new CLI, database, or service is invoked at build or runtime.

## Validation Architecture

> nyquist_validation is enabled (no `workflow.nyquist_validation:false` in config). The project has a **node-only Vitest project** (no jsdom/browser project) per `vitest.config.ts` — so component DOM behavior is NOT auto-testable; only pure functions and runes-backed store logic (the SvelteKit Vite plugin transforms `$state` for node) are. This shapes the entire test map below.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.3 (single `server` project, `environment: node`) |
| Config file | `vitest.config.ts` (includes `src/**/*.{test,spec}.{js,ts}`, and `*.svelte.test.ts` runs under node since the plugin transforms runes) |
| Quick run command | `pnpm test` (= `vitest --run`) |
| Full suite command | `pnpm test` then `pnpm check` (svelte-check, type + a11y) |
| Per-commit type gate | `pnpm check` (svelte-check — 0/0 is the established bar in every quick-task log) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MENU-01 | Gating predicate `detailsLoaded && uid && audioUrl` selects the gated set correctly | unit (pure) | `pnpm test src/lib/components/track-menu-gating.test.ts` (extract the predicate to a pure helper) | ❌ Wave 0 |
| MENU-01 | In-flight dedupe: a second call while `actionKey ∈ inFlight` is a no-op | unit (pure) | pure `shouldStartResolve(inFlight, key)` helper test | ❌ Wave 0 |
| MENU-01 | Resolve failure clears the in-flight key (never stuck) | unit (pure) | pure reducer test on the inFlight Set transition | ❌ Wave 0 |
| MENU-01 | `ensureTrackDetails` idempotency (resolved track short-circuits) | unit | already covered by catalog readiness-guard behavior; add a focused test if absent | partial |
| MENU-02 | Marquee `isOverflowing(scrollWidth, clientWidth)` strict-`>` | unit (pure) | `pnpm test src/lib/actions/marquee` (helper already exported + likely tested) | ✅ exists (`marquee.ts:20`) |
| MENU-02 | Two-row header renders + `{#key}` re-measures on resolve | component-behavior | NOT auto-testable (no jsdom project) → **device/preview-verify** | n/a |
| MENU-02 | i18n: all 15 locales carry `menu.remix`/`toast.remixing`/`menu.preparing` | unit (pure) | `pnpm test src/lib/i18n` (extend `i18n.test.ts` to iterate all `dicts`) | ✅ exists but **only checks 3 locales — extend** |
| MENU-03 | Trailing-click suppressed after longpress | unit (pure) | `shouldSuppressClickAfterLongpress(fired)` already exported + tested | ✅ exists (`longpress.ts:26`) |
| MENU-03 | No stuck `:active`/`:hover`/focus under finger | manual-only | **device-verify (iOS Safari + Android Chrome)** — A3 | n/a |
| QUEUE-04 | `effectiveUpnextMode('remix') === 'generated'` regardless of user override | unit | `pnpm test src/lib/stores/settings` (call the resolver with `'remix'` after setting global `'same-list'`) | ❌ Wave 0 (add) |
| QUEUE-04 | `regenerate` output = `dedupeBest([seed, ...manualEntries, ...auto])` preserving `manualUids` | unit (runes) | `*.svelte.test.ts` under node — set queue + manualUids, stub `buildSimilarQueue`, assert order | partial (existing player tests cover regen; add a remix-context case) |

### Sampling Rate
- **Per task commit:** `pnpm test` (full node suite is fast — the project runs 600+ tests in seconds) + `pnpm check` (svelte-check 0/0).
- **Per wave merge:** `pnpm test` + `pnpm check` + a `pnpm build` smoke (Cloudflare adapter emits the worker entry) for any task touching imports/types.
- **Phase gate:** Full suite green + svelte-check 0/0 + a real-device pass on MENU-02 marquee re-measure and MENU-03 stuck-state (the two non-node-testable contracts) before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] Extract the gating predicate to a pure helper (e.g. `src/lib/components/track-menu-gate.ts` exporting `isGatedReady(track)` + `shouldStartResolve(inFlight, key)`) so MENU-01 is node-testable without a DOM. — covers MENU-01
- [ ] `src/lib/components/track-menu-gate.test.ts` — gating + dedupe + failure-clear transitions. — covers MENU-01
- [ ] Extend `src/lib/i18n/i18n.test.ts` to iterate ALL `dicts` keys (not just en/zh-Hant/zh-Hans). — covers MENU-02 i18n parity
- [ ] Add a `settings.svelte.ts` test asserting `effectiveUpnextMode('remix') === 'generated'` even when `upnextMode='same-list'`. — covers QUEUE-04 D-06
- [ ] Add a player `*.svelte.test.ts` case: Remix context → regenerate preserves a manual-pinned uid and discards the prior generated tail. — covers QUEUE-04 D-05
- [ ] No framework install needed (Vitest + svelte-check already present).

*(Device-only items — marquee re-measure visual, MENU-03 stuck-state on iOS vs Android — cannot be automated in this repo's node-only test setup and must be human/preview-verified, consistent with how every prior gesture/visual quick-task closed.)*

## Security Domain

> `security_enforcement` is effectively not applicable to this phase. Per the objective and additional_context, this is a **client-side UI rework with no new network/secret/auth surface**. No new endpoint, no new data persisted, no PII, no crypto. The pre-existing edge-only Last.fm key (used transitively by `buildSimilarQueue` via `/api/similar`) is untouched and never reaches the client. ASVS input-validation/crypto/authn categories do not apply to a bottom-sheet rework. The only adjacent surface — `shareUrl` — is pre-existing and unchanged. No threat model delta.

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — |
| V3 Session Management | no | — |
| V4 Access Control | no | — |
| V5 Input Validation | no (no new user-supplied input reaches a sink; titles/artists are display-only and already escaped by Svelte) | Svelte auto-escaping (existing) |
| V6 Cryptography | no | — |

## Sources

### Primary (HIGH confidence)
- `src/lib/components/TrackMenu.svelte` — the component being reworked (overlay `$effect`, `loading` gate, gated action handlers, detail-modal X precedent, skeleton styles to remove)
- `src/lib/stores/overlays.svelte.ts` — history==stack invariant, `open`/`dismiss`/`closeTop`/`navigateAway`, single dismiss path, idempotent `open`
- `src/lib/stores/player.svelte.ts` — `play(track,{fresh})`, `regenerate`, `buildSimilarQueue` call, `manualUids`/`removedUids`, `queueContext`, `setQueue`, `playStub`, `effectiveUpnextMode` read site
- `src/lib/services/similar.ts` — `buildSimilarQueue` (Last.fm→Deezer→same-artist fallback)
- `src/lib/services/catalog.ts` — `ensureTrackDetails` idempotency + readiness guard + quality threading
- `src/lib/config/defaults.ts` — `QueueContext` union, `UpnextMode`, `UPNEXT_DEFAULTS.mode='generated'`
- `src/lib/stores/settings.svelte.ts` — `effectiveUpnextMode(ctx)` resolution
- `src/lib/actions/longpress.ts` — `suppressNextClick` trailing-click guard, `contextmenu` preventDefault, `pointercancel`/`pointerup` clear
- `src/lib/actions/marquee.ts` — `use:marquee`, `isOverflowing` (exported pure helper), reduced-motion guard, width-only re-measure
- `src/lib/components/NowPlaying.svelte` — two-row `{#key uid}` + `.marquee-inner` header analog (lines 692–701)
- `src/app.css` — global `marquee-scroll` keyframe (72–84), confirmed absence of tap-highlight/hover-guard/focus-reset
- `src/routes/(app)/+page.svelte`, `library/+page.svelte`, `search/+page.svelte`, `artist/[name]/+page.svelte`, `album/[name]/+page.svelte` — long-press trigger sites + the existing stub-resolve menu (`tileMenu`/`menuLoading`) wiring + `.tile:active`/`.row:hover` sticky styles
- `src/lib/i18n/*.ts` (15 files) + `i18n.test.ts` — existing `menu.*`/`toast.*` keys; parity test scope (3 of 15)
- `vitest.config.ts`, `package.json` — node-only test project; `svelte@5.56.2`, `@lucide/svelte@1.17.0`; scripts
- `node_modules/@lucide/svelte/dist/icons/sparkles.svelte` — confirms `Sparkles` named import valid

### Secondary (MEDIUM confidence)
- iOS Safari synthetic-click-after-longpress + sticky-`:hover`-on-touch + `-webkit-tap-highlight-color` behavior — well-established web platform behavior (the project's own `longpress.ts` comments already document the trailing-click and contextmenu split). Marked MEDIUM only because the exact "no stuck highlight" outcome needs device confirmation (A3).

### Tertiary (LOW confidence)
- None — every claim is grounded in a file read this session.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — versions read from installed packages; all modules read directly.
- Architecture: HIGH — overlay invariant, Remix path, marquee analog, gating predicate all read verbatim from source.
- Pitfalls: HIGH — each pitfall traces to a specific line (overlay deps, marquee re-measure, sticky `:active`/`:hover`, 15-dict parity, 3-locale test gap).
- MENU-03 device behavior: MEDIUM — mechanisms are standard; the visual "no stuck state" outcome is the one item needing real-hardware verification (A3).

**Research date:** 2026-06-11
**Valid until:** 2026-07-11 (stable — in-repo APIs; no fast-moving external deps). Re-check only if `overlays.svelte.ts`, `player.svelte.ts`, or `marquee.ts`/`longpress.ts` change before planning.
