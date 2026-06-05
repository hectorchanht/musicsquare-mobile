# Testing Patterns

**Analysis Date:** 2026-06-05

## Test Framework

**None.** There is no test framework, no test runner, no test files, and no test configuration in this repository.

Confirmed absent:
- No `jest.config.*`, `vitest.config.*`, `mocha.*`, or `karma.conf.*`
- No `*.test.*` or `*.spec.*` files
- No `__tests__/` directory
- No `package.json` (no npm ecosystem at all)
- No test scripts in `scripts/` (the only file there is `g4f_issue_reply.py`)

## CI Pipeline

One GitHub Actions workflow exists: `.github/workflows/g4f-issue-reply.yml`.

**What it does:** On every new GitHub issue opened by a non-bot user, it runs `scripts/g4f_issue_reply.py` to auto-post an AI-generated reply using g4f / OpenAI-compatible APIs.

**What it does NOT do:**
- No linting step
- No build step
- No tests of any kind
- No deployment

The `.github/ISSUE_TEMPLATE/` directory contains bilingual (Chinese / English) templates for bug reports, feature requests, questions, performance issues, documentation, and tasks. These are process aids only — not automated quality gates.

## Current Manual Testing Approach

Testing is entirely manual and browser-based:

1. Open `index.html` directly in a browser (no server required for most functionality — some API calls may need CORS headers, but all APIs are third-party and allow cross-origin requests).
2. Type a keyword into the search box and click Search.
3. Click a result to play.
4. Verify lyrics highlight, cover image, quality badge, playlist operations.

There is no documented test checklist or regression guide in the repo.

## What a Mobile Rebuild Must Add

The mobile rebuild should introduce a testing baseline from the start. Recommended approach based on the codebase's structure:

### Unit Tests for Pure Logic Functions

The following functions are pure or nearly pure and can be tested without a DOM or network:

| Function | File (line) | What to test |
|----------|-------------|--------------|
| `parseLRC(txt)` | `index.html` ~2517 | Parses LRC timestamps; handles malformed lines; returns sorted array |
| `formatTime(sec)` | `index.html` ~1685 | Edge cases: negative, Infinity, 0, values > 60 min |
| `inferQualityFromUrl(url)` | `index.html` ~1747 | `.flac`, `.wav`, `.mp3`, `.m4a`, query-string URLs |
| `serializeTrack(track)` | `index.html` ~1762 | Strips ephemeral fields; returns null for invalid input |
| `deserializeTrack(raw)` | `index.html` ~1780 | Strips migu source; round-trips with serializeTrack |
| `getInterleavedSearchList()` | `index.html` ~1691 | Interleaves per-source results in correct order |
| `neteaseQualityToTag(q)` | `index.html` ~1731 | Regex match on various quality strings |
| `kuwoQualityToTag(...)` | `index.html` ~1736 | Multi-arg version of same |

### Integration Tests for Fetch Layer

The four search functions and four detail-fetch functions make real HTTP calls to third-party APIs. For testing:

- **Mock `fetch` globally** (using `vitest`'s `vi.stubGlobal` or Jest's `jest.spyOn(global, 'fetch')`)
- Test happy-path JSON responses using fixtures captured from the live APIs
- Test error paths: non-200 status, malformed JSON, network timeout

Functions to cover:

| Function | File (line) | API base URL |
|----------|-------------|--------------|
| `searchNetease(kw, page, num)` | `index.html` ~1986 | `api.qijieya.cn/meting` |
| `searchQQ(kw, limit)` | `index.html` ~2041 | `tang.api.s01s.cn/music_open_api.php` |
| `searchKuwo(kw, limit)` | `index.html` ~2123 | `kw-api.cenguigui.cn` |
| `searchJoox(kw, limit)` | `index.html` ~2169 | `apicx.asia/api/joox_music` |
| `fetchNeteaseDetails(track)` | `index.html` ~2268 | `api.qijieya.cn/meting` |
| `fetchQQDetails(track)` | `index.html` ~2311 | `tang.api.s01s.cn/music_open_api.php` |
| `fetchKuwoDetails(track)` | `index.html` ~2398 | `kw-api.cenguigui.cn` |
| `fetchJooxDetails(track)` | `index.html` ~2424 | `apicx.asia/api/joox_music` |

Key edge cases: partial/missing fields in API response, fallback field logic in `fetchQQDetails`'s `pickBestPlayUrl`, JOOX `probeJooxAudioUrl` URL probe chain.

### Recommended Framework for Mobile Rebuild

When the project moves to a proper module structure:

```bash
# Recommended stack (all zero-config for ESM)
npm install -D vitest @vitest/coverage-v8

# Run tests
npx vitest

# Coverage
npx vitest --coverage
```

**Why Vitest:** supports ESM natively, no transpile config needed, `vi.stubGlobal` for fetch mocking, fast with native parallelism.

**Test file location:** co-locate with source files using the `.test.js` suffix convention:

```
src/
  search/
    netease.js
    netease.test.js    # unit + fetch-mock integration
  player/
    parseLRC.js
    parseLRC.test.js
  storage/
    library.js
    library.test.js
```

### Recommended CI Addition

Add a test job to `.github/workflows/` alongside the existing `g4f-issue-reply.yml`:

```yaml
# .github/workflows/test.yml  (to be created)
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: npm test
```

### Storage / State Testing

`saveLibraryToStorage` and `loadLibraryFromStorage` use `localStorage`. In a test environment:

- Use `vitest`'s `jsdom` environment (configure via `vitest.config.js`)
- `localStorage` is available in jsdom — no additional mock needed
- Test round-trip: save a known state → reload → verify equality

### What NOT to Test (initially)

- Canvas particle animation (`setupParticles`) — visual, animation-frame dependent
- Ripple DOM injection (`setupRipple`) — visual micro-interaction
- Full playback via `HTMLAudioElement` — requires a real audio stack; mock the `audio` element with a spy object

---

*Testing analysis: 2026-06-05*
