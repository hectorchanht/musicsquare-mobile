---
quick: 260611-fr9
title: Restyle nowbar to blend with bottom nav
status: tasks-1-2-complete-awaiting-checkpoint
date: 2026-06-11
duration: 3 min
requirements: [FR9-NOWBAR-BLEND, FR9-NAV-ICONS, FR9-NP-TOP-PAD]
commits:
  - e4a6ae7  # Task 1: docked nowbar blend
  - 1003463  # Task 2: nav icons + NowPlaying flush top
files_modified:
  - src/lib/components/Nowbar.svelte
  - src/routes/(app)/+layout.svelte
  - src/lib/components/NowPlaying.svelte
---

# Quick 260611-fr9: Restyle Nowbar to Blend with Bottom Nav — Summary

CSS/markup-only restyle making the docked nowbar read as one continuous bottom surface flush on top of the tabbar (rounded top, square bottom, single divider), filled/outline active-state bottom-nav icons via the existing Lucide `fill` idiom, and a flush NowPlaying top. No store or persistence changes — `player.restore()` (root layout) already surfaces the persisted last-played track + up-next queue, and was left untouched.

## What Changed (per file)

### src/lib/components/Nowbar.svelte (Task 1, commit e4a6ae7)
Restyled ONLY the docked `.nowbar` rule (the `.nowbar.embed` variant is byte-identical):
- `left: 8px; right: 8px;` → `left: 0; right: 0;` (full-width, no side insets).
- `bottom: calc(var(--tabbar-h) + 6px);` → `bottom: var(--tabbar-h);` (flush directly on top of the tabbar; the tabbar owns the safe-area inset, so no safe-area padding is added here — avoids double-counting; the +6px gap is removed).
- `border-radius: 14px;` → `border-radius: var(--radius-lg) var(--radius-lg) 0 0;` (rounded TOP corners only, square bottom).
- Removed the gap-producing margins: deleted the stray `margin-top: 4px;` and changed `margin: 2px auto 0;` → `margin: 0 auto;`. Kept `max-width: 704px;` (centered on wide/desktop).
- Switched `border: 1px solid rgba(255,255,255,0.08);` → top+sides-only border (`border-width: 1px 1px 0 1px;` + `border-style`/`border-color`) so there is no bottom border drawing a second divider against the tabbar's own `border-top`.
- `.nowbar::before` (decorative blur pseudo) now has `border-radius: inherit;` so it follows the rounded-top/square-bottom shape and no square corner peeks out. Blur / z-index / pointer-events logic left intact.
- Added a `quick-260611-fr9` comment documenting the blend intent.

### src/routes/(app)/+layout.svelte (Task 2A, commit 1003463)
- In the `{#each tabs}` block, computed `{@const active = page.url.pathname === tab.href}` and changed the rendered icon from `<Icon size={20} />` to `<Icon size={20} fill={active ? 'currentColor' : 'none'} strokeWidth={active ? 1.5 : 2} />`. Active route → FILLED glyph (adopts `.tab.active` bright text color), inactive → OUTLINE (muted via `.tab`). The lighter active stroke-width keeps the filled glyph from looking heavy. No new icon library — uses the existing Lucide `fill` prop idiom (matches `NowPlaying` `Heart fill={...}`).
- The `class:active` shorthand was used (`class:active` since the local `active` const name matches). `.app { padding-bottom: calc(var(--nowbar-h) + var(--tabbar-h)); }` left unchanged (combined surface height unchanged). No structural markup/divider change — the tabbar's `border-top` remains the single divider.

### src/lib/components/NowPlaying.svelte (Task 2B, commit 1003463)
- The `.np` rule already had `0px` top padding; normalized `padding: 0px 18px env(safe-area-inset-bottom);` → `padding: 0 18px env(safe-area-inset-bottom);` and added a `quick-260611-fr9` comment noting the top is intentionally FLUSH. Confirmed no other top inset above the header `.bar`/`.np-top` (neither carries a top margin). Bottom safe-area inset preserved. `.np.fullshrink .sheet.full` reserved-space rule and all sheet/drag/lyrics/queue logic left unchanged.

## Verification

- `pnpm run check` (svelte-check, Node v22.22.0): **0 ERRORS 0 WARNINGS** after Task 1 and again after Task 2. No new errors; no pre-existing errors observed either.
- `git diff --stat` confirms only the 3 expected files changed (Nowbar.svelte, (app)/+layout.svelte, NowPlaying.svelte).
- `src/lib/stores/player.svelte.ts` NOT touched (persistence untouched).
- `package.json` NOT changed (no new dependencies).
- `.nowbar.embed` rules byte-identical (verified via `git show HEAD:...`).
- No file deletions in either commit.

## Deviations from Plan

None — plan executed as written. Task 2B was a confirm-and-document step (top padding was already `0`); normalized `0px`→`0` and added the intent comment as the plan directed.

## Note (non-blocking, environment)

A stale gpg keydb lock (`~/.gnupg/public-keys.d/pubring.db.lock`, owner pid 7137 — a dead process) blocked the first two commit attempts with `gpg: signing failed: Operation timed out`. Verified the lock owner was not running, removed the stale lock, restarted gpg-agent (`gpgconf --kill gpg-agent`), and the commits then succeeded normally (signed). No code impact.

## Task 3 — BLOCKING human-verify checkpoint (NOT performed; orchestrator owns it)

Stop here. The following must be visually verified on a mobile-sized viewport (DevTools device toolbar, e.g. iPhone) with `pnpm run dev` (Node 22 PATH):

1. `pnpm run dev`, open in a mobile-sized viewport.
2. Play a song. Confirm the nowbar + bottom nav read as ONE continuous bottom surface: nowbar sits flush on top of the tabbar, NO gap, rounded TOP corners, square bottom, no double divider line.
3. Hard-reload the page (cold load). Confirm the nowbar STILL shows the last-played song (title/artist/cover) without playing — proves persisted `current` still surfaces after the restyle.
4. Tap the nowbar to expand NowPlaying → open the "Up Next" tab. Confirm the persisted queue still lists tracks (persisted up-next intact).
5. Confirm the NowPlaying page content starts FLUSH at the top (no gap above the ChevronDown/kebab header).
6. Tab through Home / Search / Library: the current tab's icon is FILLED, the other two are OUTLINE.
7. Verify iOS home-indicator clearance: the tabbar's bottom safe-area padding is intact (nothing clipped at the very bottom).
8. Toggle light theme (settings) and re-check the blend reads correctly in both themes.

Resume signal: "approved" or a description of what looks off (residual gap, divider line, icon not filling, top still padded).

## Self-Check: PASSED

- Files exist: Nowbar.svelte, (app)/+layout.svelte, NowPlaying.svelte, 260611-fr9-SUMMARY.md — all FOUND.
- Commits reachable: e4a6ae7 (Task 1), 1003463 (Task 2) — both FOUND.
- `.planning/HANDOFF.json` left modified-but-unstaged as required; SUMMARY left for the orchestrator's docs commit.
