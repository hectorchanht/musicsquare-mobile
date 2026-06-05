---
quick_id: 260606-5of
description: remove things that are not used or needed for this svelte project
date: 2026-06-05
status: complete
---

# Quick Task 260606-5of — Summary

Removed unused / inherited-fork files from the SvelteKit project. Four atomic commits, all user-confirmed scope. `pnpm check` (svelte-check) passes: 0 errors, 0 warnings.

## Removed

| Commit | What | Why |
|--------|------|-----|
| `4f9182d` | `src/lib/assets/favicon.svg`, `docs/logo.png`, README img fix | Orphan favicon dup (live one is `static/favicon.svg`); `docs/logo.png` already deleted on disk; README pointed at it (repointed to `static/og.svg`) |
| `8b530a6` | `legacy/index.html` + `legacy/pikachu.gif` (~220KB) | Old desktop single-page app — porting reference only, not part of build |
| `05e8cb4` | `scripts/g4f_issue_reply.py` + `.github/workflows/g4f-issue-reply.yml` | Original fork's GitHub issue auto-reply bot — CI-only, not the app |
| `e688cfe` | `.github/ISSUE_TEMPLATE/*` (14 files) + `.github/FUNDING.yml` | Inherited from charlespikachu/musicsquare fork |

Net effect: `legacy/`, `scripts/`, `.github/` directories removed entirely (all contents were cruft).

## Kept (deliberately)

- `src/routes/spike/+page.svelte` — active Phase-1 egress test rig (deployed, success criterion #5).
- All dependencies — `@lucide/svelte` + every devDependency is imported/used. `package.json` untouched.
- Every `src/lib` module — all have importers; no dead code.

## Notes

- `src/lib/**` retains `// legacy/index.html:NNNN` provenance comments. Harmless (comments only); now point at a deleted file but still document where each function was ported from. Rewriting them was out of scope.
- README.md is otherwise stale original-fork content (describes the old GitHub Pages Pikachu app). Only the broken image was fixed, per confirmed scope. A full README rewrite is a separate task.
