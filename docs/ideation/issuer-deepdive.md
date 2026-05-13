# Issuer deep-dive — per-keyword breakdown, unavailable-issuer view

> **Status (2026-05-13, user input):** the asset_search dashboard's Issuers section currently rolls up to one row per issuer (sessions, ZRR, abandonment, the read). The user wants to drill down a level further — **per-keyword stats inside each issuer**, an explicit **most-searched-but-unavailable** view, and answers to three Nikhil-questions about reach and fallbacks. This thread captures what's needed and why.

## Why

A roll-up like "Muthoot: 274 sessions, 58.9% ZRR" hides the actually interesting structure underneath: which **typed terms** drive that ZRR. The samples the user pasted show the pattern clearly:

```
Muthoot Finance — 832 total searches, 52.4% overall ZRR
  mut       111 searches    36.9% ZRR  ✅ shows results
  Mut       102 searches    83.3% ZRR  ❌ high failure rate (case sensitive!)
  muth      101 searches    38.6% ZRR  ✅
  Muth       95 searches    81.1% ZRR  ❌
  muthoot    74 searches    37.8% ZRR  ✅
  mufin      51 searches     5.9% ZRR  ✅ matches MuFin (different issuer)
```

The aggregate ZRR averages the cases that work and the cases that don't. Showing the keywords splits the problem into **engine behaviour** (does it match "mut" but not "Mut"? case-sensitivity bug) versus **catalog availability** (does "muthoot" return zero because the asset isn't on the platform?). Those are different fixes.

## Pointers

### A. The new SQL — per-issuer × per-keyword

Today's `issuerHealthByWeek` returns one row per (week, issuer). We need a sibling query that returns one row per (issuer, keyword) aggregated across the full window:

```sql
WITH all_q AS (
  SELECT query_text, results_count
  FROM (<union of W1–W6 asset_search_query>) raw
  WHERE query_text IS NOT NULL
),
normalised AS (
  SELECT LOWER(TRIM(query_text)) AS qt_lower,
         TRIM(query_text)        AS qt_original,  -- preserve case for the "Mut vs mut" story
         results_count,
         (CASE … issuerCaseExpr …) AS issuer       -- existing matching
  FROM all_q
)
SELECT
  issuer,
  qt_lower,
  qt_original,
  COUNT(*) AS searches,
  ROUND(100.0 * SUM(CASE WHEN results_count = 0 THEN 1 ELSE 0 END) / COUNT(*), 1) AS zrr_pct,
  -- detect case-sensitivity differential
  SUM(CASE WHEN qt_original = LOWER(qt_original) THEN 1 ELSE 0 END) AS lower_count,
  SUM(CASE WHEN qt_original != LOWER(qt_original) THEN 1 ELSE 0 END) AS mixed_count
FROM normalised
WHERE issuer IS NOT NULL
GROUP BY issuer, qt_lower, qt_original
HAVING COUNT(*) >= 5
ORDER BY issuer, searches DESC
```

Decisions to make before this lands:
- **Group by raw `query_text`** (preserves "Mut" vs "mut" as separate rows — needed for the case-sensitivity story) **or by lowercase** (cleaner roll-up, hides the bug)? Recommend **both** in two views — same SQL, two GROUP BY shapes.
- **Minimum threshold**: the sample mentions ≥5; setting it lower surfaces long-tail noise, higher hides real terms. ≥5 looks right for a 6-week window; tune based on total query volume.

### B. Unavailable issuers — the "we have the demand, we don't have the asset" view

The user's analysis lists "TOP 5 MOST SEARCHED BUT UNAVAILABLE":
- Muthoot Finance, Keertana Finserv, Vedika Credit, Mufin Green Finance, RBI Bonds

These already exist in `ISSUER_MAP` with `category: "availability"` or `"catalog_gap"`. The roll-up is "filter where category in {availability, catalog_gap}, sort by total searches desc, show alongside the ZRR." The data is here today; we just don't surface it as a separate panel.

Two UI options:
- **B1** Filter chip in the existing Issuers section (already implemented — clicking "Availability" or "Catalog gap" filters to those). Cheap. Doesn't name the insight ("these are the BD signals") explicitly.
- **B2** A separate exhibit / lead story above the issuer list — *"FIVE ISSUERS WE'RE LEAVING ON THE TABLE"* — pulled into both Classic and Editorial. Names the insight. More memorable for stakeholders.

Recommend B2 in the editorial dashboard as a pull-quote-style block before the issuer list. The classic dashboard can keep B1.

### C. Mapping to Nikhil's questions

| Nikhil's question | What we have today | What's needed |
|---|---|---|
| **1. Top 10 searched issuers/ISINs** | Top 10 by sessions, rolled up by issuer (asset_search dashboard, both designs). | **ISINs are not in the current event schema.** The closest is `asset_id` on `asset_search_result_clicked` and `clicked_asset_id` on the invest events — those are *internal asset IDs*, not ISINs. Need to either (a) join with an external assets table that has ISIN, or (b) accept "asset_id" as the answer. |
| **2. % of times user didn't see the issuer they were looking for** | Per-issuer ZRR (live in the dashboard). | **Define "looking for"** more sharply — is it "the user typed an issuer keyword and got 0 results" (current ZRR per issuer) or "the user typed anything and the engine returned nothing" (overall ZRR)? Current dashboard answers the first; the second is `health.zero_result / health.queries` already computed. Both deserve to coexist with clear labels. |
| **3. % of times in #2 user was not shown alternative options** | Sort of. `asset_search_empty_state` events fire when the empty state is shown, which is when no alternative options exist. `asset_search_result_clicked` after a zero-result query implies an alternative was shown and tapped. | **The cleanest signal is in the re-export the dashboard already flags**: `asset_search_cleared` with `had_results=false` and `any_result_clicked=false` is exactly "zero results, no alternatives clicked." Today we approximate with the offline `analyze_search.py` "true abandonment" counts. **Re-export `asset_search_cleared` with those two fields** to make it live. |

The first slice can answer all three with the current data — they just need to be **explicit in the UI** rather than buried.

### D. Asset codes (RCBTB, RCBLK, …) the user mentioned

The user's source called out asset code prefixes like "RCBNF = Navi Finserv", "RCBLK = Akara", etc. These are internal asset codes that already live in the events (the `asset_id` field on result_clicked + invest events). If `ISSUER_MAP` got an additional `asset_codes` field, we could:

1. Display the codes as small mono chips in the issuer detail panel ("MATCHED ASSETS: RCBLK · RCBAC · RCBKB")
2. Join to the invest events directly via asset code to answer "of users who searched for X, how many invested in X's assets" — a tighter version of search-to-invest

Pre-req: get the asset-code → issuer mapping from someone who actually knows (the trading desk, not the analytics team).

## Trade-offs

- **Per-keyword breakdown explodes the row count** in the detail panel — 30 keywords for a single issuer is plausible. Cap to top 10 by volume + an expandable "show all" link in editorial; top 12 in classic table.
- **Case-sensitive vs case-insensitive rollup**: showing both doubles the cognitive load. Default to case-folded; offer a toggle "treat case-variants as separate" for the curious. **Or** flag only the issuers where case-folding ZRR differs from raw-case ZRR by >10pt — those are the cases worth investigating.
- **Naming "unavailable issuers" prominently** is a strong claim. Make sure each issuer in the panel really *is* unavailable (cross-check against the catalog) before printing it. Mufin Green is listed "PARTIALLY AVAILABLE" — the panel needs that nuance, not just a binary "unavailable" badge.
- **Nikhil's Q3 needs the re-export to be honest live.** Otherwise we're showing offline-analysis numbers in a section that implies real-time truth.

## Open questions

1. **Group keywords by case-folded form or raw?** Recommend: case-folded, with a flag on issuers where the case-sensitive split is >10pt different. Asks the user once they see it: "is the engine actually case-sensitive, or is this aliasing weird at the keyword level?"
2. **ISINs vs asset codes** for Nikhil's Q1: do we have an ISIN field anywhere in our data, or is "asset_id" the most we can show? If asset_id, we need an ISIN dictionary from outside.
3. **Catalog availability**: is there a canonical source for "is asset X currently on the platform"? Need that to distinguish "PARTIALLY AVAILABLE" from "AVAILABLE" / "UNAVAILABLE" honestly.
4. **Per-issuer detail panel: cap keyword list at how many?** 10 default + expand link, or show all if ≤20, paginate above?

## Suggested first slice

The smallest slice that meaningfully answers Nikhil + lands the per-keyword story:

1. **Add `keywordsByIssuer` SQL** to `lib/queries/assetSearch.js`. Returns rows of (issuer, keyword, searches, zrr_pct), GROUP BY case-folded keyword, HAVING ≥5. Single new query — no schema changes.
2. **Wire it into the Issuers detail panel** (both designs): below the inline stats, before the "THE READ" sidebar, add a "Keyword breakdown" table — Term · Searches · ZRR. Sort by searches desc, top 10, "show all" expander.
3. **Add a "FIVE ISSUERS WE'RE LEAVING ON THE TABLE" exhibit** at the top of the Issuers section in editorial only (option B2). Pulls from `issuers.filter(category in {availability, catalog_gap}).sort(by sessions)[:5]`.
4. **Add a small "Nikhil's questions" exhibit** to the Conversion section: three numbered lines, each answering one question with the current data. Mark Q3 explicitly as "from offline analysis — pending event re-export."
5. **Document the gap** for ISINs and asset-code mapping. Don't ship a half-built ISIN view; either we have the dictionary or we say "asset_id is the closest we have today."

Pre-requisites:
- None for steps 1–4. The data exists; this is plumbing + UI.
- Step 5 needs either an ISIN dictionary file or the user's call to stop asking for ISINs and start saying "asset codes."
