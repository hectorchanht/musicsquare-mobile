---
phase: quick-260611-rhx
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/routes/(app)/search/+page.svelte
autonomous: true
requirements: [RHX-01]

must_haves:
  truths:
    - "Arriving on the search page with no query auto-focuses the input so the mobile keyboard rises and the user can type immediately"
    - "Arriving on the search page with a restored/prior query (searchSession.hasPrior) does NOT steal focus"
    - "Clearing the input mid-session does NOT re-steal focus (mount-time-only semantic)"
    - "pnpm check stays 0 errors / 0 warnings (no a11y_autofocus warning introduced)"
  artifacts:
    - path: "src/routes/(app)/search/+page.svelte"
      provides: "Programmatic empty-query input focus at mount"
      contains: "bind:this"
  key_links:
    - from: "src/routes/(app)/search/+page.svelte onMount"
      to: "search input element"
      via: "queryInputEl?.focus() guarded on empty q after session restore"
      pattern: "queryInputEl\\?\\.focus\\(\\)"
---

<objective>
Focus the search query input on the search page at mount time, but ONLY when the query is empty.

Purpose: A user landing on the search page with nothing typed gets the input focused immediately (mobile keyboard rises = "feel helpful"). A user returning to a restored session (back-nav, in-memory searchSession) keeps their query and is NOT interrupted by focus theft.

Output: A single edited Svelte component (`+page.svelte`) with an input element ref and a guarded programmatic focus folded into the existing `onMount`.
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/execute-plan.md
@~/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md

Working directory: /Users/laichan/code/tung/musicsquare-mobile (SvelteKit + Svelte 5 runes).
Node >= 22 required: run `nvm use 22` (or prefix PATH=/Users/laichan/.nvm/versions/node/v22*/bin) before any pnpm command.

<interfaces>
<!-- Key facts the executor needs from src/routes/(app)/search/+page.svelte. Do NOT explore — use these. -->

The query state and its binding (lines 32, 347-360):
```svelte
let q = $state('');
...
<input
  bind:value={q}
  placeholder={t('search.placeholder')}
  autocomplete="off"
  autocapitalize="off"
  oninput={onSuggestInput}
  onfocus={() => (inputFocused = true)}
  onblur={() => { setTimeout(() => (inputFocused = false), 150); }}
/>
```

The existing onMount that restores prior session BEFORE focus should be decided (lines 302-315):
```svelte
onMount(async () => {
  searchHistory.load();
  if (searchSession.hasPrior) {
    q = searchSession.q;            // <-- prior query restored here
    results = searchSession.results;
    page = searchSession.page;
    hasMore = searchSession.hasMore;
    searched = searchSession.searched;
    await tick();
    window.scrollTo(0, searchSession.scrollY);
  }
});
```

`onMount` and `tick` are already imported from 'svelte' (line 2).
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Auto-focus the empty search input at mount</name>
  <files>src/routes/(app)/search/+page.svelte</files>
  <action>
Add a programmatic, mount-time-only focus on the search input when the query is empty (RHX-01).

1. Declare an element ref alongside the other `$state` declarations near the top of the `<script>` block (around line 32, next to `let q = $state('')`):
   `let queryInputEl = $state<HTMLInputElement | null>(null);`

2. Bind it on the search `<input>` (lines 347-360) by adding `bind:this={queryInputEl}` as an attribute. Do NOT add a bare `autofocus` attribute — that triggers the `a11y_autofocus` compiler warning and `pnpm check` must stay 0/0. Programmatic `.focus()` is the chosen mechanism.

3. Fold the focus into the EXISTING `onMount` (lines 302-315) so it runs AFTER the `searchSession.hasPrior` restore. At the end of the `onMount` callback, after the existing `if (searchSession.hasPrior) { ... }` block, focus only when the query is empty:
   `if (!q.trim()) queryInputEl?.focus();`
   This evaluates `q` after a possible session restore (a restored prior query makes `q` non-empty → no focus theft). Mount-time-only is the chosen semantic: clearing the input mid-session does NOT re-steal focus because this runs once at mount, not in a reactive `$effect`.

Rationale for placement: putting the check inside `onMount` (not a `$effect` keyed on `q`) guarantees one-shot behavior and respects the session restore ordering. The `?.` optional chaining tolerates the brief window before the input ref is attached.
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/musicsquare-mobile && export PATH="$(echo /Users/laichan/.nvm/versions/node/v22*/bin):$PATH" && pnpm check 2>&1 | tail -20</automated>
  </verify>
  <done>
- `pnpm check` reports 0 errors and 0 warnings (no `a11y_autofocus` warning).
- `+page.svelte` contains `bind:this={queryInputEl}` on the search input and `queryInputEl?.focus()` guarded by `!q.trim()` at the end of `onMount`.
- The focus call sits AFTER the `searchSession.hasPrior` restore block, so a restored query suppresses focus.
- No existing behavior broken: the ql0 debounced typeahead (`oninput={onSuggestInput}`), the D-05 recent-search block, the focus/blur `inputFocused` tracking, and session restore all remain intact.
  </done>
</task>

</tasks>

<verification>
- `pnpm check` (Node 22) passes 0/0 — no new TypeScript or a11y warnings.
- If any test touches the search page, the existing suite stays green: `cd /Users/laichan/code/tung/musicsquare-mobile && export PATH="$(echo /Users/laichan/.nvm/versions/node/v22*/bin):$PATH" && pnpm test 2>&1 | tail -20` (skip if no test references this page — the change is mount-only DOM focus that node tests typically don't cover).
- Manual smoke (optional, executor's judgment): load /search fresh → input focused; navigate away after a search and return → input NOT focused, query preserved.
</verification>

<success_criteria>
- Fresh visit to /search with empty query: input receives focus (keyboard rises on mobile).
- Return visit with a restored session query: focus is NOT stolen; the query and results are preserved.
- Mid-session clearing of the input does not re-grab focus.
- `pnpm check` remains 0 errors / 0 warnings.
</success_criteria>

<output>
Create `.planning/quick/260611-rhx-focus-the-search-query-input-if-it-is-em/260611-rhx-SUMMARY.md` when done.
</output>
