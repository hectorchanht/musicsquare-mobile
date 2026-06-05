# Phase 1: Data Layer + Proxy Foundation - Discussion Log

> **Audit trail only.** Not consumed by planning/research/execution agents. Decisions live in `01-CONTEXT.md`.

**Date:** 2026-06-05
**Phase:** 01-data-layer-proxy-foundation
**Mode:** discuss (default, interactive)
**Areas offered:** Repo layout & old UI fate · Cloudflare target for spike · Proxy shape (passthrough vs normalize) · Track identity & dedup
**Areas selected by user:** Repo layout & old UI fate · Cloudflare target for spike
**Areas left to researched default (Claude's discretion):** Proxy shape · Track identity & dedup

## Area: Repo layout & old UI fate

| Question | Options presented | User selection |
|----------|-------------------|----------------|
| App location | Repo root / Subfolder (app/) / You decide | **Repo root** |
| Old index.html | Move to legacy/ / Keep at root / Delete | **Move to legacy/** |
| Package manager | pnpm / npm / bun | **pnpm** |

## Area: Cloudflare target for spike

| Question | Options presented | User selection |
|----------|-------------------|----------------|
| CF account | Personal (frank.chan) / Flow Account | **Other:** scope to F147259@gmail.com's account — `f1868a071996e836eae6da2b65f37929` (new account, not in the offered list) |
| Spike approach | Provision + deploy now / Local wrangler first / You decide | **Provision + deploy now** (real edge) |
| Project name | musicsquare-mobile / Pick at deploy time | initially musicsquare-mobile, then **amended via Other → `openmusic`** (openmusic.pages.dev) |

## Notes & clarifications
- User specified a Cloudflare account (`F147259@gmail.com` / `f1868a071996e836eae6da2b65f37929`) that the currently-connected CF MCP token does not list — flagged in CONTEXT D-08 as an access-verification blocker before provisioning.
- Final readiness gate: user responded via Other with "rename the project to openmusic in cf" — interpreted as a decision amendment (CF project → openmusic) + ready for context. CF Pages project = `openmusic`; git repo stays `musicsquare-mobile`.

## Deferred ideas raised
- None outside phase scope. (Audio/persistence/new-sources deferrals are normal phase boundaries, recorded in CONTEXT `<deferred>`.)
