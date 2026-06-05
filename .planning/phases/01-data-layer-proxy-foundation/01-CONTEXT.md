# Phase 1: Data Layer + Proxy Foundation - Context

**Gathered:** 2026-06-05
**Status:** Ready for planning

<domain>
## Phase Boundary

Extract the proven search / detail / LRC logic from the monolith `index.html` into typed SvelteKit modules behind a `SourceAdapter` / `ProxyAdapter` registry. All four existing sources (Netease, QQ, Kuwo, JOOX) must work end-to-end through a same-origin SvelteKit `+server.ts` metadata proxy at `/api/*`, with the JOOX token hidden server-side. A spike must confirm whether each source's audio CDN URL plays browser-direct from a deployed Cloudflare edge, locking the metadata-proxy-vs-browser-direct-audio decision.

Headless phase — no UI. Requirements: DATA-01, DATA-02, DATA-03, DATA-04, SRC-01.

Out of this phase: audio engine/playback (Phase 2), persistence/library (Phase 3), any UI (Phase 4), PWA (Phase 5), background audio (Phase 6), new sources + queue (Phase 7).
</domain>

<decisions>
## Implementation Decisions

### Repo layout & old UI fate
- **D-01:** The new SvelteKit app lives at the **repo root** (`src/`, `package.json`, `svelte.config.js`, `vite.config.ts` at top level) — cleanest for Cloudflare Pages deploy.
- **D-02:** The existing desktop `index.html` is **moved to `legacy/`** (e.g. `legacy/index.html`), preserved as the porting reference for the data layer and kept out of the build path. Git history + the `upstream` remote also preserve it.
- **D-03:** Package manager is **pnpm**.
- **D-04:** This is a clean rebuild — no requirement to keep the tree mergeable with `upstream` (CharlesPikachu/musicsquare). Diverge freely.

### Cloudflare target & egress spike
- **D-05:** The project is scoped to the Cloudflare account **F147259@gmail.com** — `account_id: f1868a071996e836eae6da2b65f37929` (dash: https://dash.cloudflare.com/f1868a071996e836eae6da2b65f37929/home/overview).
- **D-06:** Cloudflare Pages project name is **`openmusic`** → `openmusic.pages.dev`. (The git repo remains `musicsquare-mobile`; only the CF project/subdomain is `openmusic`.)
- **D-07:** **Provision + deploy now.** Create the `openmusic` Pages project and deploy a minimal proxy during Phase 1 so the browser-direct-audio egress spike (success criterion #5) runs on a **real Cloudflare edge** — edge egress IP differs from a home/dev IP, which is precisely the risk being tested.
- **D-08:** **RESOLVED (2026-06-05).** CF access to account `f1868a071996e836eae6da2b65f37929` is unblocked on both paths: (a) `wrangler login` completed locally (dev + local spike), and (b) `CLOUDFLARE_API_TOKEN` added as a GitHub **repository secret** (CI deploy). Deploy the `openmusic` egress-spike via either path; the CI path (Cloudflare Pages GitHub integration / `cloudflare/wrangler-action` reading the repo secret) is preferred for the "real edge" deploy. Executor should still run `wrangler whoami` to confirm the active account is `f1868a071996e836eae6da2b65f37929` before provisioning, since the connected CF MCP token covers different accounts.

### Proxy shape (Claude's discretion — researched default)
- **D-09:** The `/api/*` `+server.ts` proxy is a **thin pass-through** for the four existing sources (forward upstream JSON, client adapter normalizes to the canonical Track shape) — lowest porting risk per `.planning/research/ARCHITECTURE.md`. New sources (Phase 7) may normalize server-side from the start. The proxy still owns CORS, bounded retry, and JOOX-token injection from `platform.env`.

### Track identity & dedup (Claude's discretion — researched default)
- **D-10:** Canonical track ID = **`{source}:{songid}`** (generalizes the monolith's `uid` + `trackMap` dedup). Detail/lyrics resolution keys off this stable ID — NOT a positional index — so JOOX returns the *selected* track after the result set is reordered/paginated (success criterion #4).

### Language / typing (Claude's discretion)
- **D-11:** Ported data layer is **TypeScript (strict)** with a shared `Track` type — SvelteKit default; gives the typed-module contract the phase goal calls for.
</decisions>

<specifics>
## Specific Ideas

- The four upstream proxy contracts are already documented per-source (endpoints, params, response shapes, JOOX URL-probing) in `.planning/codebase/INTEGRATIONS.md` — port from there, do not re-derive.
- The adapter abstraction's acceptance test: adding a hypothetical source must touch only a new client adapter file + a new proxy adapter file + one registry import — zero edits to aggregation/dispatch code (success criterion #3).
- "openmusic" is the public-facing Cloudflare name; internal repo/code identity stays musicsquare-mobile.
</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### This phase's contract
- `.planning/ROADMAP.md` §"Phase 1: Data Layer + Proxy Foundation" — goal, 5 success criteria, requirements (DATA-01..04, SRC-01), research flag
- `.planning/REQUIREMENTS.md` — DATA-01..04, SRC-01 exact wording

### The data layer being extracted (the "backend" to reuse)
- `.planning/codebase/INTEGRATIONS.md` — per-source endpoints/params/response shapes, JOOX token + URL probing, CORS notes (PRIMARY port reference)
- `.planning/codebase/ARCHITECTURE.md` — REUSE/REPLACE function inventory with `index.html` line numbers (`searchAllSources`, `ensureTrackDetails`, `parseLRC`, `trackMap`, etc.)
- `legacy/index.html` — the actual source to port (after D-02 move; currently `index.html`)

### Target architecture for this phase
- `.planning/research/ARCHITECTURE.md` — SourceAdapter/ProxyAdapter registry design, Worker-proxies-metadata / audio-browser-direct split, build order, normalize-vs-passthrough recommendation
- `.planning/research/STACK.md` — SvelteKit + `adapter-cloudflare` versions, `+server.ts`-as-proxy guidance, `platform.env` for secrets
- `.planning/research/PITFALLS.md` — Worker egress geo-mismatch (the egress spike rationale), Range/206 audio handling, `Promise.allSettled` + typed-failure adapters, JOOX position-index identity trap

### Project-level
- `.planning/PROJECT.md` — constraints (SvelteKit + Cloudflare, git push as hectorchanht via `github-b`), Out of Scope
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets (port targets — all in `index.html`, moving to `legacy/index.html`)
- `searchNetease` (~1986), `searchQQ` (~2041), `searchKuwo` (~2123), `searchJoox` (~2169) → per-source client `SourceAdapter.search`
- `searchAllSources` (~2216, parallel fan-out) → registry-driven `Promise.allSettled` aggregator
- `fetchNeteaseDetails` (~2268), `fetchQQDetails` (~2311), `fetchKuwoDetails` (~2398), `fetchJooxDetails` (~2424, incl. `probeJooxAudioUrl` ~2434) → per-source `SourceAdapter.detail`
- `ensureTrackDetails` (~2506, `switch(source)` dispatcher) → registry dispatch
- `parseLRC` (~2517) → shared lyrics util
- `trackMap` (~1657) + `uid` dedup → canonical `source:songid` ID (D-10)
- `getInterleavedSearchList` (~1691) → interleaved result ordering

### Established Patterns
- Monolith couples data with DOM in one IIFE — this phase's job is to sever that: extract data fns into typed `src/lib/` modules with no DOM references.
- The JOOX adapter passes a hardcoded token in the browser today — must move to `platform.env` server-side (success criterion #2).

### Integration Points
- New: `src/routes/api/[...]/+server.ts` (or per-source `/api/<source>/...`) = the metadata proxy.
- New: `src/lib/sources/` = client `SourceAdapter` registry; proxy adapters live alongside the route.
- New: shared `Track` type consumed by all adapters.
- Audio bytes do NOT pass through the proxy (pending D-07 spike confirmation) — client will set `<audio>.src` directly in Phase 2.
</code_context>

<deferred>
## Deferred Ideas

- Audio engine / playback wiring, `<audio>` element, MediaSession — Phase 2
- Library persistence (`pikachu-music-library-v1` localStorage key continuity, idb migration) — Phase 3
- Server-side response normalization for *new* sources (Kugou/Migu) — Phase 7 (existing 4 stay passthrough per D-09)
- Custom domain for `openmusic` (beyond `.pages.dev`) — not needed this phase

None of these block Phase 1.
</deferred>

---

*Phase: 01-data-layer-proxy-foundation*
*Context gathered: 2026-06-05*
