# Quick Task 260606-pkl: Auto-deploy to Cloudflare Pages on push to main - Context

**Gathered:** 2026-06-06
**Status:** Ready for planning

<domain>
## Task Boundary

Make every push to `main` automatically build + deploy the app to Cloudflare Pages (project `openmusic`, openmusic.pages.dev) with no manual step. CI/CD + config + docs only — NO app code changes.
</domain>

<decisions>
## Implementation Decisions

### Deploy method — Cloudflare Pages NATIVE Git integration (dashboard)
- Use Cloudflare Pages' built-in Git integration, NOT a GitHub Actions workflow. CF watches the connected GitHub repo and auto-builds on push.
- Consequence: there is NO `.github/workflows/deploy.yml` to write, and NO GitHub-side CLOUDFLARE_API_TOKEN/ACCOUNT_ID secrets needed (the dashboard owns auth). The agent CANNOT configure the dashboard programmatically — the deliverable is precise step-by-step setup DOCUMENTATION plus the repo-side config that CF Pages reads.

### Scope — Pages only (no separate Worker)
- The API proxy is SvelteKit `+server.ts` routes bundled into the Pages deploy by `@sveltejs/adapter-cloudflare` (produces `_worker.js`). There is NO standalone Worker in this repo. So a single Pages build/deploy covers both the app and the `/api/*` proxy. No second `wrangler deploy`.

### Branches — main → production only
- Only `main` deploys, to the production environment (openmusic.pages.dev). No PR/preview deployments configured for now (keep it simple; can enable later in the dashboard).

### Cloudflare target
- Account ID: **f1868a071996e836eae6da2b65f37929** (owns the `openmusic` Pages project — confirmed via the dashboard URL the user provided: dash.cloudflare.com/f1868a071996e836eae6da2b65f37929/pages/view/openmusic/settings/production). NOTE: this is a THIRD account, not the two surfaced by the MCP (Flow / Frank.chan).
- Pages project name: `openmusic` (matches `wrangler.jsonc` `name`).
- Connected GitHub repo: `hectorchanht/musicsquare-mobile` (the `origin` remote = `github-b:hectorchanht/musicsquare-mobile.git`). Production branch = `main`.

### Node version
- Pin **Node 22 LTS**. Add `.nvmrc` (`22`) AND an `engines.node` field in package.json so the Cloudflare Pages build (which respects `.nvmrc` / a `NODE_VERSION` env var) uses Node 22 deterministically. Document the `NODE_VERSION=22` dashboard env var as a belt-and-suspenders fallback.

### Build
- Package manager: pnpm@8.15.5 (frozen `pnpm-lock.yaml`). CF Pages auto-detects pnpm from the lockfile.
- Build command: `pnpm build` (= `vite build`).
- Build output directory: `.svelte-kit/cloudflare` (matches `wrangler.jsonc` `pages_build_output_dir`; adapter-cloudflare).
- `wrangler.jsonc` already declares `name`, `compatibility_date`, `compatibility_flags: [nodejs_compat]`, `pages_build_output_dir` — CF Pages git integration reads this, so the build config is already correct in-repo.
</decisions>

<specifics>
## Specific Ideas

- Deliverable: a clear DEPLOY doc (e.g. `docs/DEPLOY.md` or a README section) covering: connect repo in CF dashboard → Workers & Pages → openmusic → Settings → Builds & deployments / Git; set production branch = main; build command `pnpm build`; output dir `.svelte-kit/cloudflare`; Node 22 (.nvmrc / NODE_VERSION env); and a reminder to set RUNTIME secrets/vars (e.g. Last.fm API key/secret added in Phases 8/11 — `LASTFM_API_KEY`, `LASTFM_SECRET`, any others in the `/api` routes) in the Pages project's Production environment variables, or production `/api/*` calls will fail.
- Repo config to ADD: `.nvmrc` (22) + `engines.node` in package.json. Confirm `wrangler.jsonc` is sufficient (it is) and reference it in the doc.
- Verify: `pnpm install --frozen-lockfile && pnpm build` produces `.svelte-kit/cloudflare` locally (proves the exact build CF will run). `pnpm check`/tests stay green. Adding `.nvmrc`/engines must not break local dev.
</specifics>

<canonical_refs>
## Canonical References

- `svelte.config.js` (adapter `@sveltejs/adapter-cloudflare`), `package.json` (scripts: build=`vite build`, packageManager pnpm@8.15.5), `wrangler.jsonc` (name `openmusic`, pages_build_output_dir `.svelte-kit/cloudflare`, nodejs_compat), `pnpm-lock.yaml`.
- CLAUDE.md: deploy on Cloudflare (Pages + Workers), free/edge model; `origin` pushes as `hectorchanht` via SSH host `github-b`; `upstream` is the original fork.
- Cloudflare account for openmusic: f1868a071996e836eae6da2b65f37929.
</canonical_refs>
