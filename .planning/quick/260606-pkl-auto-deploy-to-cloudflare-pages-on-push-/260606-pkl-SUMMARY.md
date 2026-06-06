---
phase: quick-260606-pkl
plan: 01
subsystem: deploy/ci
tags: [cloudflare-pages, deploy, node-version, docs]
requires: []
provides:
  - "Node 22 pin for the Cloudflare Pages build (.nvmrc + engines.node)"
  - "docs/DEPLOY.md: native Git auto-deploy setup + production env-var reminder"
  - "README Deployment section linking docs/DEPLOY.md"
affects:
  - package.json
  - README.md
tech-stack:
  added: []
  patterns:
    - "Cloudflare Pages NATIVE Git integration (no GitHub Actions, no GitHub secrets)"
    - "Node version pinned via .nvmrc + package.json engines.node"
key-files:
  created:
    - .nvmrc
    - docs/DEPLOY.md
  modified:
    - package.json
    - README.md
decisions:
  - "Pin Node 22 via .nvmrc(22) + engines.node(>=22); document NODE_VERSION=22 dashboard fallback (D-05)"
  - "Replaced README's manual `wrangler pages deploy` block with a Deployment section pointing to docs/DEPLOY.md, keeping the manual path as a documented fallback inside DEPLOY.md (coherence fix)"
  - "Documented env-var KEYS only, never values; asserted legacy JOOX literal is absent (T-pkl-01)"
metrics:
  duration: "4m 19s"
  completed: "2026-06-06"
  tasks: 2
  files: 4
requirements: [DEPLOY-CF-PAGES]
---

# Quick Task 260606-pkl: Auto-deploy to Cloudflare Pages on push to main — Summary

Wired up automatic production deploys to Cloudflare Pages via the platform's NATIVE Git integration by adding the repo-side Node-version pin (`.nvmrc` = 22 + `package.json` `engines.node` >= 22) and authoring `docs/DEPLOY.md` (one-time dashboard connect + production env-var reminder), with a README Deployment section linking to it — no GitHub Actions, no GitHub secrets, no app/API code changes.

## What was built

**Task 1 — Pin Node 22 for the Cloudflare build** (`391c2d3`)
- Created `.nvmrc` containing `22` (the file CF Pages reads to select the Node version).
- Added a top-level `"engines": { "node": ">=22" }` to `package.json`, placed directly after `"type": "module"`, using the file's existing TAB indentation.
- No other `package.json` field changed: `packageManager` (`pnpm@8.15.5+...`), `version`, `scripts`, `dependencies`, `devDependencies`, and `pnpm` are all intact.

**Task 2 — Deploy documentation** (`7e031a5`)
- Created `docs/DEPLOY.md` (89 non-blank lines) documenting the Cloudflare Pages native Git integration: how it works (Pages watches `hectorchanht/musicsquare-mobile`, push to `main` → production deploy to openmusic.pages.dev, `/api/*` ships in the same `_worker.js`, no separate Worker); the one-time dashboard setup (account `f1868a071996e836eae6da2b65f37929` → Workers & Pages → `openmusic`, production branch `main`, build `pnpm build`, output `.svelte-kit/cloudflare`, pnpm auto-detected, `NODE_VERSION=22` fallback); the in-repo build config it reads (`wrangler.jsonc`, `svelte.config.js`, `.nvmrc`/`engines`); a prominent production env-var reminder; a verify-a-deploy section; and a manual `wrangler` escape hatch.
- Production env-var reminder uses the corrected, source-verified set: `JOOX_TOKEN` REQUIRED (the JOOX proxy throws without it — confirmed at `src/lib/proxy/joox.ts:32-34`), `LASTFM_KEY` / `LASTFM_SECRET` optional (graceful degrade — `src/lib/proxy/proxy-types.ts:17,22`), and an explicit note that `LASTFM_ENDPOINT` is NOT a variable (hardcoded constant in the `+server.ts` files).
- Updated `README.md`: replaced the old manual `wrangler pages deploy` subsection with a `## Deployment` section describing the auto-deploy-on-push model and linking to `docs/DEPLOY.md`.

## How it works

`wrangler.jsonc` already declares `name: openmusic`, `compatibility_flags: ["nodejs_compat"]`, and `pages_build_output_dir: ".svelte-kit/cloudflare"`, and `svelte.config.js` uses `@sveltejs/adapter-cloudflare`. With those committed, the only remaining gap to deterministic auto-deploys was the Node-version pin (now `.nvmrc` + `engines.node`) and the operator-facing connection steps (now `docs/DEPLOY.md`). The dashboard connection itself is the one manual step the agent cannot perform; the repo now contains everything Cloudflare reads at build time plus the exact instructions to wire it once.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Restored dependencies via frozen lockfile**
- **Found during:** Task 1 verification (`pnpm build`).
- **Issue:** The fresh worktree had no `node_modules`, so the initial `pnpm build` failed against stale generated files (pnpm warned "node_modules missing").
- **Fix:** Ran `pnpm install --frozen-lockfile` — this restores the EXISTING locked dependencies (no new package added, no lockfile change), so it is permitted under the package-install exclusion. Confirmed Node v22.22.0 and pnpm 8.15.5. Adding `engines.node` did not block the install.
- **Files modified:** none committed (node_modules is gitignored).
- **Commit:** n/a (environment setup).

**2. [Rule 1 - Coherence] Replaced contradictory manual-deploy block in README**
- **Found during:** Task 2.
- **Issue:** README's existing `### Deploy (Cloudflare Pages)` subsection documented a manual `wrangler pages deploy` + `wrangler pages secret put` flow that directly contradicts the new auto-deploy-on-push model. Adding a second Deployment section alongside it would have left two conflicting deploy stories.
- **Fix:** Replaced that subsection with the new `## Deployment` section pointing to `docs/DEPLOY.md`; the manual `wrangler` path is preserved as a clearly-labeled fallback inside `docs/DEPLOY.md` (section 6) rather than being lost. The rest of README is untouched.
- **Files modified:** README.md.
- **Commit:** `7e031a5`.

## Verification

- `cat .nvmrc` → `22`.
- `node -e "...engines"` → `{ node: '>=22' }`; `packageManager` still `pnpm@8.15.5+sha1...`.
- `pnpm build` → exit 0; `.svelte-kit/cloudflare` produced.
- `pnpm check` → 0 errors / 0 warnings (4005 files).
- `pnpm test` → 23 files / 201 tests passed.
- `docs/DEPLOY.md` → 89 non-blank lines; contains `hectorchanht/musicsquare-mobile`, `f1868a071996e836eae6da2b65f37929`, `.svelte-kit/cloudflare`, `JOOX_TOKEN`, `LASTFM_KEY`, `LASTFM_SECRET`, and the "`LASTFM_ENDPOINT` is NOT a variable" note.
- `README.md` → links to `docs/DEPLOY.md`.
- No real secret committed: grep for the legacy JOOX literal `f84ao9lMF_q7husBWRfgUw` in `docs/DEPLOY.md` and `README.md` returns nothing (threat T-pkl-01 mitigated).

## Threat surface scan

No new security-relevant surface introduced (config + docs only; no endpoints, auth paths, or schema changes). Threat register dispositions honored: T-pkl-01 (no secret values in docs — verified absent), T-pkl-02 (only `engines` added to package.json; `packageManager` unchanged), T-pkl-03 (env-var reminder surfaced loudly as REQUIRED in DEPLOY.md), T-pkl-SC (no package installs introducing new deps).

## Known Stubs

None.

## Self-Check: PASSED

- Files verified present: `.nvmrc`, `package.json`, `docs/DEPLOY.md`, `README.md`, `260606-pkl-SUMMARY.md`.
- Commits verified present: `391c2d3` (Task 1), `7e031a5` (Task 2).
