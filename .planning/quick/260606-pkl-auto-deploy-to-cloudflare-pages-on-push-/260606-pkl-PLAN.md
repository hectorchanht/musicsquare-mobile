---
phase: quick-260606-pkl
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - package.json
  - .nvmrc
  - docs/DEPLOY.md
  - README.md
autonomous: true
requirements: [DEPLOY-CF-PAGES]
must_haves:
  truths:
    - "A push to main triggers a Cloudflare Pages build + production deploy with no manual step (after the one-time dashboard connect documented in docs/DEPLOY.md)."
    - "The Cloudflare Pages build uses Node 22 deterministically (.nvmrc=22 + engines.node, with NODE_VERSION=22 documented as fallback)."
    - "docs/DEPLOY.md gives exact dashboard steps to connect hectorchanht/musicsquare-mobile to the openmusic project on account f1868a071996e836eae6da2b65f37929, production branch main."
    - "docs/DEPLOY.md reminds the operator to set the production runtime secrets (JOOX_TOKEN, LASTFM_KEY, LASTFM_SECRET) or /api/* breaks in production."
    - "Local dev/build/check/test remain green after adding .nvmrc and engines.node."
  artifacts:
    - path: ".nvmrc"
      provides: "Node version pin (22) that Cloudflare Pages reads"
      contains: "22"
    - path: "package.json"
      provides: "engines.node pin for the CF build toolchain"
      contains: "engines"
    - path: "docs/DEPLOY.md"
      provides: "Step-by-step Cloudflare Pages native Git integration setup + production env-var reminder"
      min_lines: 40
    - path: "README.md"
      provides: "Deployment section linking to docs/DEPLOY.md"
      contains: "DEPLOY.md"
  key_links:
    - from: "docs/DEPLOY.md"
      to: "wrangler.jsonc"
      via: "references pages_build_output_dir / nodejs_compat as the in-repo build config CF reads"
      pattern: "pages_build_output_dir|wrangler"
    - from: "docs/DEPLOY.md"
      to: "src/routes/api/**/+server.ts (platform.env)"
      via: "production env-var reminder lists the exact secrets the server routes read"
      pattern: "JOOX_TOKEN|LASTFM_KEY|LASTFM_SECRET"
---

<objective>
Wire up automatic production deploys to Cloudflare Pages (project `openmusic`, openmusic.pages.dev) on every push to `main`, using Cloudflare Pages' NATIVE Git integration — NOT a GitHub Actions workflow.

Because the agent cannot touch the Cloudflare dashboard, the deliverable is the repo-side config Cloudflare reads at build time plus precise setup DOCUMENTATION the operator follows once to connect the repo.

Purpose: One push to main -> one production deploy, no manual `wrangler deploy`, no GitHub secrets.

Output:
- `.nvmrc` (`22`) and `engines.node` in `package.json` so the CF build pins Node 22.
- `docs/DEPLOY.md` — exact dashboard steps + production env-var reminder.
- A short "Deployment" section in `README.md` linking to `docs/DEPLOY.md`.

NON-GOALS (locked in CONTEXT.md): no `.github/workflows/deploy.yml`, no GitHub secrets, no separate Worker, no PR/preview deploys, no app/API code changes, no secrets committed to the repo.
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/execute-plan.md
@~/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/quick/260606-pkl-auto-deploy-to-cloudflare-pages-on-push-/260606-pkl-CONTEXT.md
@package.json
@wrangler.jsonc
@svelte.config.js
@README.md

<facts>
<!-- Verified against the repo on 2026-06-06 — use these exact values. -->

- package.json today: `packageManager: "pnpm@8.15.5+..."`, NO `engines` field, NO `.nvmrc`.
  Build script `build: "vite build"`; test `test: "vitest --run"`; check `check: "svelte-kit sync && svelte-check ..."`.
- `wrangler.jsonc` ALREADY declares everything CF needs: `name: "openmusic"`, `compatibility_flags: ["nodejs_compat"]`, `pages_build_output_dir: ".svelte-kit/cloudflare"`. Do NOT edit it.
- Adapter is `@sveltejs/adapter-cloudflare` (svelte.config.js); a `pnpm build` produces `.svelte-kit/cloudflare` (confirmed: artifact exists locally). This is the exact directory CF serves.
- Cloudflare target: account `f1868a071996e836eae6da2b65f37929`, Pages project `openmusic`, connected repo `hectorchanht/musicsquare-mobile`, production branch `main`. (`origin` = `github-b:hectorchanht/musicsquare-mobile.git`.)
- PRODUCTION RUNTIME SECRETS — the CORRECTED, verified list (read from `platform.env`; see `src/app.d.ts` and `src/lib/proxy/proxy-types.ts`):
  - `JOOX_TOKEN` (string) — REQUIRED. `src/lib/proxy/joox.ts:32-34` THROWS if missing, so the JOOX source breaks in prod without it. (CLAUDE.md's "hardcoded JOOX_TOKEN" note describes the LEGACY index.html, NOT this SvelteKit rebuild.)
  - `LASTFM_KEY` (optional) — Last.fm read features (`/api/similar`, `/api/lastfm/*`). Absent = those features degrade gracefully (empty results); app still runs.
  - `LASTFM_SECRET` (optional) — signed Last.fm calls (auth/scrobble). Absent = those features unavailable; read-only still works.
  - `LASTFM_ENDPOINT` is NOT an env var — it is a hardcoded constant `https://ws.audioscrobbler.com/2.0/` inside the `+server.ts` files. Do NOT list it as a required var (this corrects the original task brief).
- Node 22.x is the intended runtime; CF Pages reads `.nvmrc` / a `NODE_VERSION` build env var to select the Node version.
</facts>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Pin Node 22 for the Cloudflare build (.nvmrc + engines.node)</name>
  <files>.nvmrc, package.json</files>
  <action>
Create `.nvmrc` at the repo root containing exactly `22` (single line, trailing newline). This is the file Cloudflare Pages' build system reads to select the Node version (locked decision D-05).

In `package.json`, add a new top-level `"engines"` field with `"node": ">=22"` so the build toolchain pins to Node 22 LTS. Place it as a sibling of the existing top-level keys (for example directly after the `"type": "module"` line) using the file's existing TAB indentation. Do NOT bump, remove, reorder, or otherwise alter any other field — leave `packageManager`, `version`, `scripts`, `dependencies`, `devDependencies`, and `pnpm` exactly as they are. This implements D-05 (a belt-and-suspenders Node pin alongside the documented `NODE_VERSION=22` dashboard fallback).

Do NOT commit any secret/token. Do NOT touch `wrangler.jsonc`, `svelte.config.js`, or any `src/**` file.
  </action>
  <verify>
    <automated>node -e "const p=require('./package.json'); if(!p.engines||!p.engines.node){process.exit(1)}; if(p.packageManager.indexOf('pnpm@8.15.5')!==0){process.exit(2)}" && grep -qx '22' .nvmrc && pnpm build && test -d .svelte-kit/cloudflare && pnpm check && pnpm test</automated>
  </verify>
  <done>`.nvmrc` contains `22`; `package.json` has `engines.node` (>=22) with all other fields unchanged; `pnpm build` produces `.svelte-kit/cloudflare`; `pnpm check` reports 0 errors / 0 warnings; `pnpm test` is green.</done>
</task>

<task type="auto">
  <name>Task 2: Write docs/DEPLOY.md + add a Deployment section to README.md</name>
  <files>docs/DEPLOY.md, README.md</files>
  <action>
Create the `docs/` directory and write `docs/DEPLOY.md` documenting the Cloudflare Pages NATIVE Git integration setup (NO GitHub Actions, NO GitHub secrets — per locked decisions D-01..D-06). Structure it so a first-time operator can connect the repo and have every push to `main` auto-deploy to production. Use the EXACT verified values from `<facts>`. Cover, in order:

1. Overview — how it works: Cloudflare Pages watches the connected GitHub repo `hectorchanht/musicsquare-mobile`; a push to `main` triggers a build + production deploy to openmusic.pages.dev. No `wrangler deploy`, no GitHub Actions, no GitHub secrets. The API proxy ships inside the same Pages build (adapter-cloudflare `_worker.js`) — no separate Worker.

2. One-time dashboard setup (the manual part the agent cannot do):
   - Go to the Cloudflare dashboard for account `f1868a071996e836eae6da2b65f37929` -> Workers & Pages -> `openmusic`.
   - Settings -> Build / Git: connect (or confirm) the GitHub repo `hectorchanht/musicsquare-mobile`.
   - Production branch: `main`.
   - Build command: `pnpm build`.
   - Build output directory: `.svelte-kit/cloudflare`.
   - Note that pnpm is auto-detected from `pnpm-lock.yaml` (frozen install).
   - Node version: handled by the in-repo `.nvmrc` (`22`); document setting a `NODE_VERSION=22` build environment variable as a belt-and-suspenders fallback.

3. In-repo build config (already correct — reference, do not change): `wrangler.jsonc` declares `name: openmusic`, `compatibility_flags: ["nodejs_compat"]`, and `pages_build_output_dir: ".svelte-kit/cloudflare"`; `svelte.config.js` uses `@sveltejs/adapter-cloudflare`. Cloudflare's Git integration reads these, so the build config lives in the repo.

4. PRODUCTION RUNTIME ENV VARS — a prominent reminder that these must be set in the Pages project's Production environment variables (Settings -> Variables and Secrets), or `/api/*` breaks in production. Use the CORRECTED list from `<facts>`:
   - `JOOX_TOKEN` — REQUIRED (the JOOX proxy throws without it; JOOX search/playback fails). Mark as a Secret.
   - `LASTFM_KEY` — optional (Last.fm read features degrade to empty without it). Mark as a Secret.
   - `LASTFM_SECRET` — optional (signed Last.fm auth/scrobble unavailable without it). Mark as a Secret.
   - Explicitly state that `LASTFM_ENDPOINT` is NOT a variable (it is hardcoded in the server routes) so the operator does not add a phantom var.
   - WARNING: never commit these values to the repo; set them only in the dashboard.

5. Verify a deploy — push a trivial commit to `main`, watch the build in Workers & Pages -> `openmusic` -> Deployments, then load https://openmusic.pages.dev and confirm search works (proves JOOX_TOKEN reached the runtime).

Then update `README.md`: add a short `## Deployment` section (place it logically, e.g. after the Architecture/Features content) stating that pushes to `main` auto-deploy to Cloudflare Pages via native Git integration and linking to `docs/DEPLOY.md` (relative link `docs/DEPLOY.md`). Keep it to a few lines; the detail lives in DEPLOY.md. Do not restructure or rewrite the rest of README.md.

Do NOT write any real secret value into either file.
  </action>
  <verify>
    <automated>test -f docs/DEPLOY.md && [ "$(grep -cve '^[[:space:]]*$' docs/DEPLOY.md)" -ge 40 ] && grep -q 'hectorchanht/musicsquare-mobile' docs/DEPLOY.md && grep -q 'f1868a071996e836eae6da2b65f37929' docs/DEPLOY.md && grep -q '.svelte-kit/cloudflare' docs/DEPLOY.md && grep -q 'JOOX_TOKEN' docs/DEPLOY.md && grep -q 'LASTFM_KEY' docs/DEPLOY.md && grep -q 'LASTFM_SECRET' docs/DEPLOY.md && grep -q 'DEPLOY.md' README.md && ! grep -Eq 'f84ao9lMF_q7husBWRfgUw' docs/DEPLOY.md README.md</automated>
  </verify>
  <done>`docs/DEPLOY.md` (>=40 non-blank lines) documents the native Git integration with the exact account/repo/branch/build/output values, pins Node 22 via `.nvmrc`/`NODE_VERSION`, and prominently reminds the operator to set `JOOX_TOKEN`/`LASTFM_KEY`/`LASTFM_SECRET` in Production (and that `LASTFM_ENDPOINT` is not a var); `README.md` has a Deployment section linking to `docs/DEPLOY.md`; no real secret value appears in either file.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| repo (public/forkable) -> docs | Documentation must not leak real secret values into version control. |
| operator -> Cloudflare dashboard | Production secrets are configured out-of-band in the dashboard, never in the repo. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-pkl-01 | Information Disclosure | docs/DEPLOY.md, README.md | mitigate | Docs name env-var KEYS only, never values; Task 2 verify greps to assert the legacy JOOX token literal `f84ao9lMF_q7husBWRfgUw` is absent. |
| T-pkl-02 | Tampering | package.json | mitigate | Only `engines` is added; verify asserts `packageManager` (pnpm@8.15.5) is unchanged; no dependency edits. |
| T-pkl-03 | Denial of Service | production /api/* | accept | If the operator skips the env-var reminder, JOOX 5xxs in prod — surfaced loudly in DEPLOY.md (REQUIRED) and in the verify-a-deploy step; cannot be enforced from the repo. |
| T-pkl-SC | Tampering | npm/pip/cargo installs | mitigate | No package installs in this plan (config + docs only); no new dependencies introduced. |
</threat_model>

<verification>
After both tasks:
- `cat .nvmrc` -> `22`.
- `node -e "console.log(require('./package.json').engines)"` -> shows `{ node: '>=22' }`; `packageManager` still `pnpm@8.15.5+...`.
- `pnpm build` -> succeeds and `.svelte-kit/cloudflare` exists (the exact artifact CF builds).
- `pnpm check` -> 0 errors / 0 warnings.
- `pnpm test` -> all suites green.
- `docs/DEPLOY.md` renders, internal facts match `<facts>`, and the `README.md` -> `docs/DEPLOY.md` link resolves.
- No real secret value committed anywhere (grep for the legacy JOOX literal returns nothing).
</verification>

<success_criteria>
- `.nvmrc` (`22`) and `package.json` `engines.node` (>=22) pin Node 22 for the CF build; no other package.json field changed.
- `docs/DEPLOY.md` lets an operator connect `hectorchanht/musicsquare-mobile` to the `openmusic` Pages project (account `f1868a071996e836eae6da2b65f37929`, production branch `main`, build `pnpm build`, output `.svelte-kit/cloudflare`) and have pushes to `main` auto-deploy — with a prominent reminder to set `JOOX_TOKEN`/`LASTFM_KEY`/`LASTFM_SECRET` in Production.
- `README.md` points to `docs/DEPLOY.md`.
- Local dev/build/check/test remain green; no GitHub Actions workflow, no GitHub secrets, no app/API code changes, no committed secrets.
</success_criteria>

<output>
Create `.planning/quick/260606-pkl-auto-deploy-to-cloudflare-pages-on-push-/260606-pkl-SUMMARY.md` when done.
</output>
