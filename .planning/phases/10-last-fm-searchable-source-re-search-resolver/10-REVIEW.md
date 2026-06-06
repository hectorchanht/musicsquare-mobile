---
phase: 10-last-fm-searchable-source-re-search-resolver
reviewed: 2026-06-06T00:00:00Z
depth: standard
files_reviewed: 4
files_reviewed_list:
  - src/lib/services/score-match.ts
  - src/lib/services/score-match.test.ts
  - src/lib/services/discovery.ts
  - src/lib/services/discovery.test.ts
findings:
  critical: 2
  warning: 3
  info: 2
  total: 7
status: issues_found
---

# Phase 10: Code Review Report

**Reviewed:** 2026-06-06
**Depth:** standard
**Files Reviewed:** 4
**Status:** issues_found

## Summary

Phase 10 adds `scoreMatch` (pure re-ranker) and wires it into `resolveStub` inside `discovery.ts`. The structural approach is sound — pure function, no threshold, stable-max loop, null only on zero results. However, two blockers undermine the core correctness claim of the variant detector: the keyword scanner uses raw substring matching with no word-boundary guard, causing well-known song titles (`Olive`, `Discover`, `Democracy`) to be wrongly down-ranked as variant content; and the VARIANT_KEYWORDS list contains paired terms (`live`/`live版`, `现场`/`现场版`, `remix`/`remix版`) that produce double penalties on the same title string. The test suite contains a structural gap where the stable-max tie-break (the key differentiator vs. a naive `candidates[0]`) is never exercised, making regressions in that path invisible.

---

## Critical Issues

### CR-01: Substring matching on short keywords causes false-positive variant penalties

**File:** `src/lib/services/score-match.ts:114`

**Issue:** `title.includes(kw)` with no word-boundary check means short keywords fire on arbitrary substrings. Confirmed false-positive cases:

| Keyword | Legitimate song title penalized |
|---------|--------------------------------|
| `live`  | `Olive`, `Delivered`, `Relive`, `Outlive`, `Alive` |
| `cover` | `Discover`, `Recovery`, `Uncover` |
| `demo`  | `Democracy`, `Demon`, `Demonstrate` |
| `tribute` | `Distribute`, `Contribute`, `Attribute` |
| `remix` | `Premix` (obscure but real) |

A user who taps Last.fm's "Discover" (song by Charice) would have that track's clean studio version penalized by `−VARIANT_WEIGHT` relative to an arbitrary unrelated song, producing the exact wrong-song resolution the feature was built to prevent.

Note that the query-asked-for-variant exception (`queryStr.includes(kw)`) also fires on the same false positives — so when the query title itself contains the substring (`artist="X", title="Discover"`), the exception cancels the false penalty. The damage only manifests when the **candidate** title contains the substring but the **query** does not (e.g., query is an alternate title).

**Fix:** Replace bare `.includes()` with a word-boundary-aware test. Because keywords include CJK terms (which have no word separators), use a hybrid: require a non-letter/non-digit character (or start/end of string) on both sides for Latin keywords, and keep `.includes()` for CJK keywords.

```typescript
// Replace the current `title.includes(kw)` test at line 114 with:

// Pre-classify once at module load:
const LATIN_KW_RE: RegExp[] = [];
const CJK_KWS: string[] = [];
for (const kw of VARIANT_KEYWORDS) {
    // Any keyword that contains a CJK character → substring match (no spaces possible)
    if (/\p{Script=Han}/u.test(kw)) {
        CJK_KWS.push(kw);
    } else {
        // Latin keyword → word-boundary regex
        LATIN_KW_RE.push(new RegExp(`(?<![\\p{L}\\p{N}])${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'iu'));
    }
}

function titleHasVariant(title: string): string | null {
    for (const re of LATIN_KW_RE) {
        if (re.test(title)) return re.source; // or return the original kw
    }
    for (const kw of CJK_KWS) {
        if (title.includes(kw)) return kw;
    }
    return null;
}
```

Then loop over the classified sets and return the matched keyword(s) rather than using the flat `VARIANT_KEYWORDS` iteration. The query exception check for Latin keywords should mirror the same boundary guard on `queryStr`.

---

### CR-02: Paired CJK+Latin keywords cause double penalties on the same title token

**File:** `src/lib/services/score-match.ts:27-54`

**Issue:** VARIANT_KEYWORDS contains three keyword pairs where one term is a strict substring of another:

| Short form | Long form | Relationship |
|------------|-----------|--------------|
| `live`     | `live版`  | `live` ⊂ `live版` |
| `现场`     | `现场版`  | `现场` ⊂ `现场版` |
| `remix`    | `remix版` | `remix` ⊂ `remix版` |

A candidate title `Song live版` matches **both** `live` and `live版` in the keyword loop, accumulating `−VARIANT_WEIGHT × 2 = −8` instead of `−4`. Crucially, the query-asked-for exception is symmetric — if the query contains `live版` then `queryStr.includes('live')` also fires (because `live` is a substring of `live版`), so the exception cancels both hits when the query has the variant. But when the **query does not** ask for the variant, the candidate is penalized twice, pushing it `−8` below a clean track rather than `−4`. This can drop a legitimate "稻香 live版" result below completely unrelated songs when the maximum possible similarity is only `SIM_EXACT = 10`.

**Fix:** After collecting matched keywords, deduplicate so that no parent keyword is also counted when its suffix-extended form already matched. Or, restructure the list so `live版`, `现场版`, `現場版`, and `remix版` REPLACE rather than coexist with their short forms:

```typescript
// Option A: Remove the short forms for CJK-suffixed pairs; keep only the long forms.
// 'live版', '现场版', '現場版', 'remix版' already cover the CJK variant.
// The base Latin/CJK form covers the non-版 case.
// If a title says 'Song Live' (no 版) → matched by 'live' alone → −4. Correct.
// If a title says 'Song live版'          → matched by 'live版' only (remove 'live' from competing) → −4. Correct.
// NOT correct: 'live版' in VARIANT_KEYWORDS already contains 'live', so both fire.
// Resolution: after collecting all matched keywords, deduplicate by removing any kw
// for which a strictly longer matched kw is a superset:

const matched: string[] = [];
for (const kw of VARIANT_KEYWORDS) {
    if (!title.includes(kw)) continue;
    if (queryStr.includes(kw)) continue;
    matched.push(kw);
}
// Dedup: remove any kw that is a prefix/substring of another matched kw
const deduped = matched.filter(kw =>
    !matched.some(other => other !== kw && other.includes(kw))
);
penalty += deduped.length * VARIANT_WEIGHT;
```

---

## Warnings

### WR-01: Stable-max tie-break in `resolveStub` has no test coverage

**File:** `src/lib/services/discovery.test.ts:101-110`

**Issue:** The test named "falls back to dedupeBest order (preferredSource/quality) among equal-scored candidates" is supposed to verify that when two candidates have equal `scoreMatch`, the stable-max loop (`s > bestScore`, not `>=`) preserves `dedupeBest`'s ordering. However, the two mocked tracks (`first`=netease/稻香, `second`=qq/稻香) share the **same `dedupeBest` deduplication key** (`norm('稻香')|norm('周杰伦')`). `dedupeBest` collapses them to a single winner (netease wins on `SOURCE_RANK`) before `scoreMatch` ever runs — so `candidates.length === 1`, the `for` loop body is never executed, and the stable-max invariant is never exercised. The test passes for the wrong reason.

The critical distinction between `>` and `>=` in the tie-break is never validated. A change to `>=` would silently invert the stable-max semantic (last wins instead of first), breaking D-02 intent, and no test would catch it.

**Fix:** Use two candidates with **different** normalized titles so `dedupeBest` keeps both, then verify that the first (lower-index) wins the tie:

```typescript
it('falls back to dedupeBest order among equal-scored candidates', async () => {
    // Two DIFFERENT songs with the same artist — same scoreMatch because both
    // artist+title normalize to an exact query match.
    const query = { artist: '周杰伦', title: '稻香' };
    const first = mk('netease', 'first', '周杰伦', { title: '稻香' });
    // Use a DIFFERENT title so dedupeBest does NOT collapse them:
    const second = mk('qq', 'second', '林俊杰', { title: '江南' }); // clearly different
    // Make their scores equal by tweaking — or use identical artist+title on different songs
    // (harder). The simplest approach: two identical-artist/title tracks from different
    // dedupe-surviving sources by giving them bracket suffixes that norm() strips:
    const firstA = mk('netease', 'a', '周杰伦', { title: '稻香 [2003]' });
    const firstB = mk('qq', 'b', '周杰伦', { title: '稻香 (Special Edition)' });
    // norm() strips both brackets → same matchKey for scoreMatch → equal similarity
    // BUT dedupe key = norm(title)|norm(artist) → both 'norm([2003])' handled... 
    // In practice: use scoreMatch-verified equal candidates with distinct dedupe keys.
    vi.spyOn(catalog, 'searchAll').mockResolvedValue(result([firstA, firstB]));
    const out = await resolveStub('周杰伦', '稻香');
    expect(out?.uid).toBe(firstA.uid); // stable max: first dedupeBest slot wins on tie
});
```

---

### WR-02: Query exception checks raw `artist+title` string, not title only — artist names containing variant keywords suppress all variant penalties

**File:** `src/lib/services/score-match.ts:110-115`

**Issue:** `queryStr` is built as `"${query.artist} ${query.title}"`, so if the artist name contains a variant keyword, the exception fires globally for all candidates regardless of their variant status.

- Query `{ artist: 'Live', title: 'Lightning Crashes' }` → `queryStr = 'live lightning crashes'` → `queryStr.includes('live') === true` → **no live penalty applied to any candidate**, including a random live-performance track by a different artist.
- Query `{ artist: 'The Covers Project', title: 'Song' }` → `queryStr.includes('cover') === true` → all cover variants escape penalty.

This inverts the ranking when the artist name matches. The Last.fm artist name is the exact artist from the stub, so "Live" (the 1990s rock band) is a real case.

**Fix:** Restrict the query exception to the **title component only**, matching the spec intent ("the user tapped a Live track"):

```typescript
// Change line 110 from:
const queryStr = `${query.artist || ''} ${query.title || ''}`.toLowerCase();
// To:
const queryStr = (query.title || '').toLowerCase();
// The exception is "query asked for this variant in the TITLE" — artist name is irrelevant.
// If needed, also scan query.artist but only for CJK terms where it's unambiguous.
```

---

### WR-03: `discovery.test.ts` line 59 test description is misleading about what is being verified

**File:** `src/lib/services/discovery.test.ts:59-65`

**Issue:** The test name is "returns the FIRST track (best cross-source hit) when several are returned". The comment and name imply this exercises scoreMatch's handling of multiple candidates. It does not: both `first` and `second` have identical artist and title (`周杰伦`/`稻香`), so `dedupeBest` collapses them to a single track (netease wins by `SOURCE_RANK`) before `scoreMatch` runs. The assertion `out?.uid === first.uid` passes because `dedupeBest` chose netease, not because of any scoreMatch or stable-max logic. This makes it impossible to tell from the test whether the ordering would survive a `scoreMatch` inversion.

**Fix:** Rename the test to accurately describe what it verifies — or replace it with a test that actually presents two distinct candidates to the scoring loop:

```typescript
it('returns the best-quality source when deduplication collapses same-song results', async () => {
    // Both tracks are the same song — dedupeBest picks netease (higher SOURCE_RANK).
    const neteaseCut = mk('netease', 'first', '周杰伦', { title: '稻香' });
    const qqCut = mk('qq', 'second', '周杰伦', { title: '稻香' });
    vi.spyOn(catalog, 'searchAll').mockResolvedValue(result([neteaseCut, qqCut]));

    const out = await resolveStub('周杰伦', '稻香');
    expect(out?.uid).toBe(neteaseCut.uid); // dedupeBest SOURCE_RANK: netease > qq
});
```

---

## Info

### IN-01: `speed up` (common platform label) missing from VARIANT_KEYWORDS; only `sped up` present

**File:** `src/lib/services/score-match.ts:33`

**Issue:** Many streaming platforms (particularly QQ Music and Netease) label sped-up content as `"速度版"`, `"speed up"`, or `"加速版"` rather than `"sped up"`. The current list catches `"sped up"` but misses `"speed up"` and the CJK equivalents. This is a coverage gap, not a crash risk.

**Fix:** Add the common alternates:

```typescript
// After line 33 ('sped up'):
'speed up',
'加速版',   // CJK speed-up label
```

---

### IN-02: `score-match.test.ts` has no tests for empty-input or all-negative-score edge cases

**File:** `src/lib/services/score-match.test.ts`

**Issue:** The spec mandates "never null/NaN" and correct behavior when "all candidates are variants". Neither is tested directly:
1. `scoreMatch({ artist: '', title: '' }, candidate)` — empty query (handled correctly by the guard `(s || '')` in matchKey and the falsy check in similarity, but not covered by a test).
2. A scenario where every candidate has a variant keyword and all scores are negative — `resolveStub` should still return the least-bad candidate, not null.

These are test coverage gaps, not bugs in the implementation, but they leave the "never NaN, no threshold" guarantees unverifiable.

**Fix:** Add two tests:

```typescript
it('returns a finite number (not NaN) even for empty artist/title inputs', () => {
    const c = mk('netease', 'c', '', { title: '' });
    const s = scoreMatch({ artist: '', title: '' }, c);
    expect(typeof s).toBe('number');
    expect(Number.isFinite(s)).toBe(true);
});

it('can return negative scores when all candidates are variant-heavy (no threshold)', () => {
    const query = { artist: 'X', title: 'Song' };
    const heavyVariant = mk('netease', 'v', 'X', {
        title: 'Song (Live Karaoke Cover Remix)'
    });
    const s = scoreMatch(query, heavyVariant);
    // Negative score is valid — resolveStub must still return it rather than null
    expect(Number.isFinite(s)).toBe(true);
});
```

---

_Reviewed: 2026-06-06_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
