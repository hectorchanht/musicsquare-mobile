---
quick_id: 260611-ql0
slug: add-autocomplete-for-song-artist-names-i
date: 2026-06-11
status: complete
requirements: [QL0-AUTOCOMPLETE]
commits:
  - 39c3001  # test(ql0-01): failing test for autocomplete logic (TDD RED)
  - 6cf47fa  # feat(ql0-01): pure autocomplete logic module (TDD GREEN)
  - 40e08c4  # feat(ql0-02): wire debounced + abort-guarded typeahead into +page.svelte (+ en source key)
  - 97a7af7  # feat(ql0-03): add search.suggestions key to remaining 14 locales
key-files:
  created:
    - src/lib/search/autocomplete-logic.ts
    - src/lib/search/autocomplete-logic.test.ts
  modified:
    - src/routes/(app)/search/+page.svelte
    - src/lib/i18n/en.ts (+ 14 other locale dicts)
metrics:
  tasks: 3
  files: 18
  duration: ~6 min
---

# Quick Task 260611-ql0 — Add Search Autocomplete (Song + Artist Typeahead) Summary

Typeahead autocomplete on the search page using the EXISTING keyless Deezer client helper
`deezerSearchTopN(term, limit, signal)` — no new API route, no new service fetch code, no new
npm dependency, no new env var. Typing ≥2 chars surfaces debounced (300ms) song + artist
suggestions under the search bar; a newer keystroke aborts the prior in-flight fetch; tapping a
suggestion fills the input and runs the full multi-source search. The recent-search history block
is unchanged and never co-renders with suggestions.

## What shipped

### Task 1 — Pure autocomplete logic module (TDD)
- **`src/lib/search/autocomplete-logic.ts`** — mirrors the `search-history-logic.ts` pure/runes-free
  split (node-Vitest-testable; type-only `DeezerHit` import; no runes/`$app`/fetch/DOM/timers-over-runes):
  - `deriveSuggestions(hits, query)`: `<MIN_QUERY_LEN` → `[]`; song suggestions in Deezer relevance
    order (empty titles skipped, case-insensitive `title|artist` dedupe); distinct artist suggestions
    (case-insensitive dedupe, first-seen casing); combined list capped at `SUGGEST_CAP=8`, interleaved
    songs-first → artists-near-top → fill; stable unique `key` per row. Tolerant of nullish title/artist.
  - `debounce<F>(fn, ms)`: framework-free trailing debounce with `.cancel()`.
  - exported consts `MIN_QUERY_LEN=2`, `SUGGEST_DEBOUNCE_MS=300`, `SUGGEST_CAP=8`, the `Suggestion`
    interface.
- **`src/lib/search/autocomplete-logic.test.ts`** — 14 tests: empty/whitespace/1-char → [], no-hits → [],
  song order, empty-title drop, distinct case-insensitive artists, empty-artist skip, song dedupe,
  cap + unique keys, artist interleave, nullish-tolerance; debounce fires-once / resets-within-window /
  cancel() / default-window. RED→GREEN gate sequence followed (test commit then feat commit).

### Task 2 — Wire into the search page
- **`src/routes/(app)/search/+page.svelte`**:
  - Imports `deezerSearchTopN` + `deriveSuggestions/debounce/MIN_QUERY_LEN/SUGGEST_CAP`.
  - `suggestions = $state<Suggestion[]>([])` + page-local `suggestAc: AbortController | null`
    (transient — never lifted into `searchSession`, same discipline as `ac`/`moreAc`).
  - `fetchSuggestions` = `debounce(..., 300)`: aborts in-flight, fresh `AbortController`, calls
    `deezerSearchTopN(kw, SUGGEST_CAP, sig)` (never throws), stale-query guard (`sig.aborted || kw !== q.trim()`)
    before `suggestions = deriveSuggestions(hits, kw)`.
  - `oninput` on the input (kept `bind:value`): `<2` chars → cancel + abort + clear; else schedule fetch.
  - `run()` closes the typeahead (cancel debounce + abort + clear) next to `ac?.abort()`/`moreAc?.abort()`.
  - Render block gated `inputFocused && q.trim().length >= MIN_QUERY_LEN && suggestions.length > 0`,
    placed right after the recent block (mutually exclusive — recent needs `q.trim()===''`). Reuses the
    `.suggest`/`.suggest-row`/`.list` styling; each row is a real `<button>` with
    `onmousedown preventDefault` (tap before blur); tap → `pickSuggestion(s)` fills `q` with `s.title`
    and runs. Heading uses `t('search.suggestions')`. Songs show `names.dnTitle` + muted `names.dnArtist`;
    artists show `names.dnArtist`. Minimal CSS added (`.suggest-kind/.suggest-meta/.suggest-sub`).

### Task 3 — i18n parity
- Added `'search.suggestions'` to all 15 locale dicts (non-blank, translated, matching each file's
  quote style): en "Suggestions", zh-Hant 建議, zh-Hans 建议, es Sugerencias, fr Suggestions,
  de Vorschläge, pt Sugestões, it Suggerimenti, ru Подсказки, tr Öneriler, ar اقتراحات, hi सुझाव,
  id Saran, vi Gợi ý, th คำแนะนำ.

## Verification (actual results)

- **`pnpm test`** (full suite) → **53 files, 672/672 passing**. Includes the 14 new
  `autocomplete-logic` tests and the i18n parity + no-blank gate (`i18n.test.ts` 12/12).
- **`pnpm check`** → **0 errors / 0 warnings / 0 files with problems**.
- TDD gate sequence confirmed in git log: `test(ql0-01)` (39c3001) → `feat(ql0-01)` (6cf47fa).

## Deviations from Plan

**[Rule 3 — Blocking issue] Verify command + Node version corrections**
- **Found during:** Task 1 verify.
- **Issue:** The plan's verify command `pnpm test --run <file>` fails — the repo's `test` script is
  already `vitest --run`, so `--run` is an unknown pnpm option. Separately, the prompt-suggested Node
  path (`v20.11.1`) violates the repo's `engines.node: >=22` and pnpm refuses to run.
- **Fix:** Used `pnpm test -- <file>` (positional vitest filter) and Node **v22.22.0** (available via
  nvm, satisfies `>=22`). No source change — runner invocation only.

**[Rule 3 — Blocking issue] `en.ts` source key landed with Task 2 instead of Task 3**
- **Found during:** Task 2 verify (`pnpm check`).
- **Issue:** `TranslationKey` is derived from `en.ts` and every other locale is typed as `Dict`
  (the exact `en` key set). The Task 2 component's `t('search.suggestions')` cannot typecheck until the
  key exists in `en.ts`, and adding it to `en` alone makes the other 14 fail typecheck — so the
  component (Task 2) and all 15 locales (Task 3) are coupled by the type system.
- **Fix:** Added the `en` source key in the Task 2 commit (it is what the component typechecks against);
  the remaining 14 locales landed in the Task 3 commit. Each commit's stated verify still holds:
  Task 2 `pnpm check` 0/0 and Task 3 i18n parity test green were both confirmed after the 14 locales
  were added. No behavior change vs. the plan's intent (one key, all 15 locales, non-blank).

## Known Stubs

None. The suggestion UI is wired to the live `deezerSearchTopN` client (no mock/placeholder data);
`deriveSuggestions` derives from real `DeezerHit[]`. Failures degrade silently to no suggestion UI by
design (`deezerSearchTopN` returns `[]` on abort/non-ok/malformed JSON; never throws).

## Threat surface scan

No new security-relevant surface beyond the plan's `<threat_model>`. The only network path is the
already-shipped own-origin `/api/deezer/search` edge proxy via the existing `deezerSearchTopN` helper
(keyless, host-allow-listed covers, 6h client TTL + 24h edge cache). T-ql0-01 self-DoS mitigations are
present in the wiring: 300ms debounce + `MIN_QUERY_LEN=2` gate + AbortController cancel-in-flight +
`SUGGEST_CAP=8`. No env var read, no new dependency, no new route.

## Notes / follow-ups

- Manual device smoke (type "jay" → suggestions after a pause; rapid typing → one trailing fetch;
  tap → fill + full search; clear-to-empty + focus → recent list; offline → no suggestion UI) is the
  remaining human-verify step — not node-testable. The automated gates (`pnpm test`, `pnpm check`) and
  the abort/stale-guard logic are covered in code + unit tests.

## Self-Check: PASSED
- FOUND: src/lib/search/autocomplete-logic.ts
- FOUND: src/lib/search/autocomplete-logic.test.ts
- FOUND: src/routes/(app)/search/+page.svelte (modified)
- FOUND commit 39c3001, 6cf47fa, 40e08c4, 97a7af7
