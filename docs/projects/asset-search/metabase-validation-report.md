# Asset Search — Metabase data validation report

_Generated 2026-05-18 22:48 UTC · mode: **local-only (baseline)**_

Produced by `backend/services/integrations/validate_asset_search.py`. Every metric the Asset Search dashboard renders (`frontend/lib/queries/assetSearch.js` + `conversion.js`) is re-computed from the local W1-W6 CSVs and, in `metabase` mode, from the live `client_web` schema, then diffed.

**Verdict policy (two-tier):** exact → ✅ CONFIRMED · drift ≤5 rows / ≤0.5% (counts) or ≤0.3pp (percentages) → ⚠️ MINOR DRIFT (Rudderstack late-arrival noise, not a failure) · larger → ❌ DISCREPANT · ℹ️ INFO = informational (derived-source mismatch expected by design) · ⏳ PENDING = awaiting the credentialed Metabase run.

## Summary

| Verdict | Checks |
|---|---|
| ✅ CONFIRMED | 7 |
| ⏳ PENDING | 23 |

## Findings & corrections

### F1 — data-sources.md §0 overstated every W1-W6 row count

_Severity: doc error (resolved)_

§0 claimed query=29,582 / empty_state=12,845 / result_clicked=4,384 / cleared=3,282 / initiated=10,294 / suggestion_clicked=887. Those totals were summed from `metabase-connect/`, which holds TWO W6 exports — a superseded partial (`W6_may07-may11`) and the full week (`W6_may07-may13`) — and the partial was counted on top of the full week. Verified exactly for all six events: e.g. query 26,544 (real) + 3,038 (stale partial) = 29,582 (the doc figure). The dashboard's deployed data (`backend/data/asset_search/`, full W6 only) was always correct.

**Resolution.** data-sources.md §0 corrected to the real raw counts (query=26,544 / empty_state=11,509 / result_clicked=3,897 / cleared=2,967 / initiated=9,252 / suggestion_clicked=804). The §0 check below is now a regression guard and should read CONFIRMED.

## §0 — local CSVs vs data-sources.md (regression guard)

Does the local W1-W6 data match the row counts `data-sources.md §0` documents? (Raw `COUNT(*)`, before test-user exclusion.) Post-F1 this should read all-CONFIRMED.

| Event | data-sources.md §0 | Local CSVs (actual) | Verdict |
|---|--:|--:|---|
| `asset_search_query` | 26,544 | 26,544 | ✅ CONFIRMED |
| `asset_search_empty_state` | 11,509 | 11,509 | ✅ CONFIRMED |
| `asset_search_result_clicked` | 3,897 | 3,897 | ✅ CONFIRMED |
| `asset_search_cleared` | 2,967 | 2,967 | ✅ CONFIRMED |
| `asset_search_initiated` | 9,252 | 9,252 | ✅ CONFIRMED |
| `asset_search_suggestion_clicked` | 804 | 804 | ✅ CONFIRMED |

## Internal consistency (no Metabase needed)

Invariants on the local data alone — the numbers must be *mathematically sound* regardless of the upstream source. These catch SQL / porting bugs in the dashboard's own builders, the most likely failure mode, and need no credentials.

| Check | Invariant | Verdict |
|---|---|---|
| `funnel_buckets_sum` | success + relevance_gap + dead_end = searched, every week | ✅ CONFIRMED |
| `zrr_bounds` | 0 <= zero_result <= queries and 0 <= refinements <= queries | ✅ CONFIRMED |
| `tab_split_total` | SUM of byTab queries = COUNT(*) of asset_search_query | ✅ CONFIRMED |
| `issuer_session_bound` | issuer sessions <= all-issuer weekly query sessions | ✅ CONFIRMED |
| `issuer_buckets_sum` | success + relevance_gap + dead_end = searched, every (week, issuer) | ✅ CONFIRMED |
| `position_bound` | SUM of clicksByPosition <= COUNT(*) of asset_search_result_clicked | ✅ CONFIRMED |
| `funnel_monotonic` | distinct sessions: initiated >= queried >= clicked, every week | ✅ CONFIRMED |


## Checks

### ⏳ vol_query — Volume — asset_search_query

_Source: `asset_search_query` · verdict: **PENDING**_

| week | rows (local) | users (local) | sessions (local) | rows (metabase) | users (metabase) | sessions (metabase) | verdict |
|---|---|---|---|---|---|---|---|
| W1 | 4183 | 766 | 853 | — | — | — | ⏳ PENDING |
| W2 | 4361 | 799 | 941 | — | — | — | ⏳ PENDING |
| W3 | 4111 | 789 | 922 | — | — | — | ⏳ PENDING |
| W4 | 4911 | 838 | 1033 | — | — | — | ⏳ PENDING |
| W5 | 4577 | 775 | 910 | — | — | — | ⏳ PENDING |
| W6 | 4401 | 805 | 959 | — | — | — | ⏳ PENDING |

### ⏳ vol_empty — Volume — asset_search_empty_state

_Source: `asset_search_empty_state` · verdict: **PENDING**_

| week | rows (local) | users (local) | sessions (local) | rows (metabase) | users (metabase) | sessions (metabase) | verdict |
|---|---|---|---|---|---|---|---|
| W1 | 2086 | 520 | 553 | — | — | — | ⏳ PENDING |
| W2 | 1878 | 486 | 533 | — | — | — | ⏳ PENDING |
| W3 | 1574 | 473 | 524 | — | — | — | ⏳ PENDING |
| W4 | 1979 | 482 | 537 | — | — | — | ⏳ PENDING |
| W5 | 2098 | 520 | 574 | — | — | — | ⏳ PENDING |
| W6 | 1894 | 467 | 492 | — | — | — | ⏳ PENDING |

### ⏳ vol_clicked — Volume — asset_search_result_clicked

_Source: `asset_search_result_clicked` · verdict: **PENDING**_

| week | rows (local) | users (local) | sessions (local) | rows (metabase) | users (metabase) | sessions (metabase) | verdict |
|---|---|---|---|---|---|---|---|
| W1 | 478 | 344 | 378 | — | — | — | ⏳ PENDING |
| W2 | 612 | 413 | 474 | — | — | — | ⏳ PENDING |
| W3 | 687 | 429 | 489 | — | — | — | ⏳ PENDING |
| W4 | 809 | 471 | 587 | — | — | — | ⏳ PENDING |
| W5 | 560 | 370 | 429 | — | — | — | ⏳ PENDING |
| W6 | 751 | 467 | 566 | — | — | — | ⏳ PENDING |

### ⏳ vol_initiated — Volume — asset_search_initiated

_Source: `asset_search_initiated` · verdict: **PENDING**_

| week | rows (local) | users (local) | sessions (local) | rows (metabase) | users (metabase) | sessions (metabase) | verdict |
|---|---|---|---|---|---|---|---|
| W1 | 1427 | 945 | 1058 | — | — | — | ⏳ PENDING |
| W2 | 1535 | 999 | 1168 | — | — | — | ⏳ PENDING |
| W3 | 1555 | 980 | 1143 | — | — | — | ⏳ PENDING |
| W4 | 1704 | 1009 | 1229 | — | — | — | ⏳ PENDING |
| W5 | 1482 | 927 | 1087 | — | — | — | ⏳ PENDING |
| W6 | 1549 | 979 | 1155 | — | — | — | ⏳ PENDING |

### ⏳ vol_suggestion — Volume — asset_search_suggestion_clicked

_Source: `asset_search_suggestion_clicked` · verdict: **PENDING**_

| week | rows (local) | users (local) | sessions (local) | rows (metabase) | users (metabase) | sessions (metabase) | verdict |
|---|---|---|---|---|---|---|---|
| W1 | 159 | 124 | 128 | — | — | — | ⏳ PENDING |
| W2 | 123 | 98 | 100 | — | — | — | ⏳ PENDING |
| W3 | 134 | 111 | 118 | — | — | — | ⏳ PENDING |
| W4 | 120 | 104 | 109 | — | — | — | ⏳ PENDING |
| W5 | 156 | 100 | 103 | — | — | — | ⏳ PENDING |
| W6 | 112 | 88 | 97 | — | — | — | ⏳ PENDING |

### ⏳ vol_cleared — Volume — asset_search_cleared

_Source: `asset_search_cleared` · verdict: **PENDING**_

| week | rows (local) | users (local) | sessions (local) | rows (metabase) | users (metabase) | sessions (metabase) | verdict |
|---|---|---|---|---|---|---|---|
| W1 | 551 | 347 | 368 | — | — | — | ⏳ PENDING |
| W2 | 479 | 306 | 329 | — | — | — | ⏳ PENDING |
| W3 | 445 | 299 | 323 | — | — | — | ⏳ PENDING |
| W4 | 463 | 317 | 346 | — | — | — | ⏳ PENDING |
| W5 | 578 | 364 | 394 | — | — | — | ⏳ PENDING |
| W6 | 451 | 314 | 332 | — | — | — | ⏳ PENDING |

### ⏳ vol_invest — Volume — invest_now + quick_checkout (unioned)

_Source: `invest_now_button_clicked + quick_checkout_invest_clicked` · verdict: **PENDING**_

| week | rows (local) | users (local) | rows (metabase) | users (metabase) | verdict |
|---|---|---|---|---|---|
| W1 | 10087 | 3890 | — | — | ⏳ PENDING |
| W2 | 11169 | 4200 | — | — | ⏳ PENDING |
| W3 | 12214 | 4295 | — | — | ⏳ PENDING |
| W4 | 11277 | 3850 | — | — | ⏳ PENDING |
| W5 | 9657 | 3897 | — | — | ⏳ PENDING |
| W6 | 9760 | 3875 | — | — | ⏳ PENDING |

### ⏳ query_health — Query health — ZRR & refinement (queryHealthByWeek)

_Source: `asset_search_query` · verdict: **PENDING**_

| week | queries (local) | zero_result (local) | zrr_pct (local) | refinements (local) | refinement_pct (local) | queries (metabase) | zero_result (metabase) | zrr_pct (metabase) | refinements (metabase) | refinement_pct (metabase) | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|
| W1 | 4183 | 2179 | 52.1 | 2864 | 68.5 | — | — | — | — | — | ⏳ PENDING |
| W2 | 4361 | 1946 | 44.6 | 2960 | 67.9 | — | — | — | — | — | ⏳ PENDING |
| W3 | 4111 | 1633 | 39.7 | 2716 | 66.1 | — | — | — | — | — | ⏳ PENDING |
| W4 | 4911 | 2098 | 42.7 | 3335 | 67.9 | — | — | — | — | — | ⏳ PENDING |
| W5 | 4577 | 2221 | 48.5 | 3124 | 68.3 | — | — | — | — | — | ⏳ PENDING |
| W6 | 4401 | 1964 | 44.6 | 2948 | 67 | — | — | — | — | — | ⏳ PENDING |

### ⏳ funnel — Session funnel — initiated/queried/clicked (funnelByWeek)

_Source: `asset_search_initiated/query/result_clicked` · verdict: **PENDING**_

| week | initiated (local) | queried (local) | clicked (local) | initiated (metabase) | queried (metabase) | clicked (metabase) | verdict |
|---|---|---|---|---|---|---|---|
| W1 | 1058 | 853 | 378 | — | — | — | ⏳ PENDING |
| W2 | 1168 | 941 | 474 | — | — | — | ⏳ PENDING |
| W3 | 1143 | 922 | 489 | — | — | — | ⏳ PENDING |
| W4 | 1229 | 1033 | 587 | — | — | — | ⏳ PENDING |
| W5 | 1087 | 910 | 429 | — | — | — | ⏳ PENDING |
| W6 | 1155 | 959 | 566 | — | — | — | ⏳ PENDING |

### ⏳ session_outcome — Session-outcome funnel (sessionOutcomeByWeek) — PRIMARY

_Source: `asset_search_query + asset_search_result_clicked` · verdict: **PENDING**_

| week | searched (local) | success (local) | relevance_gap (local) | dead_end (local) | success_pct (local) | searched (metabase) | success (metabase) | relevance_gap (metabase) | dead_end (metabase) | success_pct (metabase) | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|
| W1 | 854 | 377 | 277 | 200 | 44.1 | — | — | — | — | — | ⏳ PENDING |
| W2 | 942 | 472 | 292 | 178 | 50.1 | — | — | — | — | — | ⏳ PENDING |
| W3 | 923 | 487 | 286 | 150 | 52.8 | — | — | — | — | — | ⏳ PENDING |
| W4 | 1034 | 587 | 289 | 158 | 56.8 | — | — | — | — | — | ⏳ PENDING |
| W5 | 911 | 429 | 296 | 186 | 47.1 | — | — | — | — | — | ⏳ PENDING |
| W6 | 960 | 566 | 248 | 146 | 59 | — | — | — | — | — | ⏳ PENDING |

### ⏳ suggestions — Suggestion CTR (suggestionsByWeek)

_Source: `asset_search_suggestion_clicked / asset_search_initiated` · verdict: **PENDING**_

| week | suggestion_clicks (local) | focused (local) | ctr_pct (local) | suggestion_clicks (metabase) | focused (metabase) | ctr_pct (metabase) | verdict |
|---|---|---|---|---|---|---|---|
| W1 | 159 | 1058 | 12.1 | — | — | — | ⏳ PENDING |
| W2 | 123 | 1168 | 8.6 | — | — | — | ⏳ PENDING |
| W3 | 134 | 1143 | 10.3 | — | — | — | ⏳ PENDING |
| W4 | 120 | 1229 | 8.9 | — | — | — | ⏳ PENDING |
| W5 | 156 | 1087 | 9.5 | — | — | — | ⏳ PENDING |
| W6 | 112 | 1155 | 8.4 | — | — | — | ⏳ PENDING |

### ⏳ clears — Clear events per week (clearsByWeek)

_Source: `asset_search_cleared` · verdict: **PENDING**_

| week | clears (local) | clears (metabase) | verdict |
|---|---|---|---|
| W1 | 551 | — | ⏳ PENDING |
| W2 | 479 | — | ⏳ PENDING |
| W3 | 445 | — | ⏳ PENDING |
| W4 | 463 | — | ⏳ PENDING |
| W5 | 578 | — | ⏳ PENDING |
| W6 | 451 | — | ⏳ PENDING |

### ⏳ by_tab — Search volume & ZRR by tab (byTab)

_Source: `asset_search_query` · verdict: **PENDING**_

| tab | queries (local) | zrr_pct (local) | queries (metabase) | zrr_pct (metabase) | verdict |
|---|---|---|---|---|---|
| bonds | 24766 | 44 | — | — | ⏳ PENDING |
| highyieldfd | 812 | 59 | — | — | ⏳ PENDING |
| sdi | 508 | 55.3 | — | — | ⏳ PENDING |
| baskets | 458 | 85.6 | — | — | ⏳ PENDING |

### ⏳ total_sessions — Distinct query sessions overall (totalQuerySessions)

_Source: `asset_search_query` · verdict: **PENDING**_

| (value) | sessions (local) | sessions (metabase) | verdict |
|---|---|---|---|
| — | 5617 | — | ⏳ PENDING |

### ⏳ clicks_by_position — Position bias — clicks by rank (clicksByPosition)

_Source: `asset_search_result_clicked` · verdict: **PENDING**_

| rank | clicks (local) | clicks (metabase) | verdict |
|---|---|---|---|
| 1 | 3070 | — | ⏳ PENDING |
| 2 | 492 | — | ⏳ PENDING |
| 3 | 228 | — | ⏳ PENDING |
| 4 | 47 | — | ⏳ PENDING |
| 5 | 23 | — | ⏳ PENDING |
| 6 | 12 | — | ⏳ PENDING |
| 7 | 10 | — | ⏳ PENDING |
| 8 | 5 | — | ⏳ PENDING |
| 9 | 1 | — | ⏳ PENDING |
| 10 | 1 | — | ⏳ PENDING |

### ⏳ top_terms — Top search terms & their ZRR (topSearchTerms)

_Source: `asset_search_query` · verdict: **PENDING**_

| term | searches (local) | zero_result (local) | zrr_pct (local) | searches (metabase) | zero_result (metabase) | zrr_pct (metabase) | verdict |
|---|---|---|---|---|---|---|---|
| akara | 376 | 69 | 18.4 | — | — | — | ⏳ PENDING |
| rbi | 348 | 60 | 17.2 | — | — | — | ⏳ PENDING |
| navi | 314 | 15 | 4.8 | — | — | — | ⏳ PENDING |
| aka | 300 | 10 | 3.3 | — | — | — | ⏳ PENDING |
| gov | 229 | 44 | 19.2 | — | — | — | ⏳ PENDING |
| mut | 226 | 126 | 55.8 | — | — | — | ⏳ PENDING |
| nav | 216 | 0 | 0 | — | — | — | ⏳ PENDING |
| uni | 208 | 3 | 1.4 | — | — | — | ⏳ PENDING |
| muth | 206 | 116 | 56.3 | — | — | — | ⏳ PENDING |
| loan | 171 | 0 | 0 | — | — | — | ⏳ PENDING |
| muthoot | 162 | 93 | 57.4 | — | — | — | ⏳ PENDING |
| keer | 154 | 89 | 57.8 | — | — | — | ⏳ PENDING |
| iifl | 146 | 17 | 11.6 | — | — | — | ⏳ PENDING |
| kee | 140 | 74 | 52.9 | — | — | — | ⏳ PENDING |
| best | 132 | 20 | 15.2 | — | — | — | ⏳ PENDING |
| akar | 131 | 4 | 3.1 | — | — | — | ⏳ PENDING |
| mufin | 126 | 3 | 2.4 | — | — | — | ⏳ PENDING |
| gold | 124 | 3 | 2.4 | — | — | — | ⏳ PENDING |

### ⏳ zero_result_terms — Top zero-result queries (topZeroResultQueries)

_Source: `asset_search_empty_state` · verdict: **PENDING**_

| term | hits (local) | avg_len (local) | hits (metabase) | avg_len (metabase) | verdict |
|---|---|---|---|---|---|
| mut | 113 | 3 | — | — | ⏳ PENDING |
| muth | 110 | 4 | — | — | ⏳ PENDING |
| vedika | 94 | 6 | — | — | ⏳ PENDING |
| lon | 91 | 3 | — | — | ⏳ PENDING |
| muthoot | 89 | 7 | — | — | ⏳ PENDING |
| ved | 88 | 3 | — | — | ⏳ PENDING |
| keer | 86 | 4 | — | — | ⏳ PENDING |
| kee | 69 | 3 | — | — | ⏳ PENDING |
| muf | 69 | 3 | — | — | ⏳ PENDING |
| rbi bon | 68 | 7 | — | — | ⏳ PENDING |
| sbi | 67 | 3 | — | — | ⏳ PENDING |
| akara | 66 | 5 | — | — | ⏳ PENDING |
| vedik | 60 | 5 | — | — | ⏳ PENDING |
| muthoo | 56 | 6 | — | — | ⏳ PENDING |

### ⏳ clicked_assets — Most-clicked assets & avg rank (topClickedAssets)

_Source: `asset_search_result_clicked` · verdict: **PENDING**_

| asset | clicks (local) | avg_rank (local) | clicks (metabase) | avg_rank (metabase) | verdict |
|---|---|---|---|---|---|
| RCBNF260202 | 224 | 1.5 | — | — | ⏳ PENDING |
| RCBPSL260301 | 170 | 1.2 | — | — | ⏳ PENDING |
| RCBKD260201 | 146 | 1.4 | — | — | ⏳ PENDING |
| RCBSFL260301 | 127 | 1.4 | — | — | ⏳ PENDING |
| RCBIM260301 | 127 | 1.1 | — | — | ⏳ PENDING |
| RCBIIFLS260201 | 105 | 1.2 | — | — | ⏳ PENDING |
| RCBAA260201 | 96 | 1.2 | — | — | ⏳ PENDING |
| RCBAP260201 | 91 | 1.3 | — | — | ⏳ PENDING |
| RCBHDC260201 | 86 | 1.1 | — | — | ⏳ PENDING |
| RCBCGL260201 | 84 | 1.1 | — | — | ⏳ PENDING |
| RCBAK260401 | 77 | 1.4 | — | — | ⏳ PENDING |
| RCBSPD251201 | 74 | 1.4 | — | — | ⏳ PENDING |

### ⏳ issuer_health — Per-issuer health by week (issuerHealthByWeek)

_Source: `asset_search_query (issuer-classified)` · verdict: **PENDING**_

| week | issuer | sessions (local) | queries (local) | zrr_pct (local) | refinement_pct (local) | sessions (metabase) | queries (metabase) | zrr_pct (metabase) | refinement_pct (metabase) | verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| W1 | Adani | 11 | 48 | 6.3 | 70.8 | — | — | — | — | ⏳ PENDING |
| W2 | Adani | 19 | 72 | 2.8 | 59.7 | — | — | — | — | ⏳ PENDING |
| W3 | Adani | 13 | 26 | 0 | 30.8 | — | — | — | — | ⏳ PENDING |
| W4 | Adani | 27 | 68 | 4.4 | 52.9 | — | — | — | — | ⏳ PENDING |
| W5 | Adani | 24 | 42 | 2.4 | 28.6 | — | — | — | — | ⏳ PENDING |
| W6 | Adani | 21 | 48 | 4.2 | 45.8 | — | — | — | — | ⏳ PENDING |
| W1 | Akara Capital | 50 | 136 | 6.6 | 53.7 | — | — | — | — | ⏳ PENDING |
| W2 | Akara Capital | 33 | 76 | 6.6 | 50 | — | — | — | — | ⏳ PENDING |
| W3 | Akara Capital | 67 | 198 | 29.8 | 59.1 | — | — | — | — | ⏳ PENDING |
| W4 | Akara Capital | 44 | 135 | 4.4 | 61.5 | — | — | — | — | ⏳ PENDING |
| W5 | Akara Capital | 60 | 214 | 2.3 | 69.6 | — | — | — | — | ⏳ PENDING |
| W6 | Akara Capital | 53 | 173 | 9.2 | 64.2 | — | — | — | — | ⏳ PENDING |
| W1 | Govt / RBI Bonds | 86 | 245 | 36.7 | 53.9 | — | — | — | — | ⏳ PENDING |
| W2 | Govt / RBI Bonds | 68 | 194 | 27.8 | 64.4 | — | — | — | — | ⏳ PENDING |
| W3 | Govt / RBI Bonds | 64 | 190 | 18.9 | 55.3 | — | — | — | — | ⏳ PENDING |
| W4 | Govt / RBI Bonds | 69 | 218 | 16.5 | 63.3 | — | — | — | — | ⏳ PENDING |
| W5 | Govt / RBI Bonds | 55 | 160 | 56.9 | 61.9 | — | — | — | — | ⏳ PENDING |
| W6 | Govt / RBI Bonds | 59 | 194 | 25.3 | 68.6 | — | — | — | — | ⏳ PENDING |
| W1 | Indel Money | 15 | 19 | 0 | 15.8 | — | — | — | — | ⏳ PENDING |
| W2 | Indel Money | 23 | 50 | 0 | 40 | — | — | — | — | ⏳ PENDING |
| W3 | Indel Money | 25 | 45 | 0 | 42.2 | — | — | — | — | ⏳ PENDING |
| W4 | Indel Money | 13 | 28 | 0 | 50 | — | — | — | — | ⏳ PENDING |
| W5 | Indel Money | 14 | 40 | 2.5 | 60 | — | — | — | — | ⏳ PENDING |
| W6 | Indel Money | 16 | 28 | 0 | 32.1 | — | — | — | — | ⏳ PENDING |
| W1 | Keertana | 12 | 34 | 11.8 | 64.7 | — | — | — | — | ⏳ PENDING |
| W2 | Keertana | 16 | 25 | 0 | 16 | — | — | — | — | ⏳ PENDING |
| W3 | Keertana | 35 | 118 | 62.7 | 66.1 | — | — | — | — | ⏳ PENDING |
| W4 | Keertana | 47 | 150 | 58.7 | 63.3 | — | — | — | — | ⏳ PENDING |
| W5 | Keertana | 33 | 130 | 53.1 | 71.5 | — | — | — | — | ⏳ PENDING |
| W6 | Keertana | 51 | 94 | 12.8 | 35.1 | — | — | — | — | ⏳ PENDING |
| W1 | Mufin Finance | 21 | 52 | 38.5 | 57.7 | — | — | — | — | ⏳ PENDING |
| W2 | Mufin Finance | 13 | 49 | 69.4 | 67.3 | — | — | — | — | ⏳ PENDING |
| W3 | Mufin Finance | 17 | 43 | 34.9 | 48.8 | — | — | — | — | ⏳ PENDING |
| W4 | Mufin Finance | 30 | 64 | 3.1 | 46.9 | — | — | — | — | ⏳ PENDING |
| W5 | Mufin Finance | 28 | 115 | 54.8 | 63.5 | — | — | — | — | ⏳ PENDING |
| W6 | Mufin Finance | 13 | 54 | 48.1 | 74.1 | — | — | — | — | ⏳ PENDING |
| W1 | Muthoot Finance | 42 | 113 | 73.5 | 61.1 | — | — | — | — | ⏳ PENDING |
| W2 | Muthoot Finance | 43 | 97 | 16.5 | 51.5 | — | — | — | — | ⏳ PENDING |
| W3 | Muthoot Finance | 52 | 161 | 26.1 | 64.6 | — | — | — | — | ⏳ PENDING |
| W4 | Muthoot Finance | 47 | 141 | 80.1 | 66.7 | — | — | — | — | ⏳ PENDING |
| W5 | Muthoot Finance | 48 | 154 | 92.2 | 63.6 | — | — | — | — | ⏳ PENDING |
| W6 | Muthoot Finance | 41 | 135 | 33.3 | 66.7 | — | — | — | — | ⏳ PENDING |
| W1 | Navi | 32 | 83 | 3.6 | 51.8 | — | — | — | — | ⏳ PENDING |
| W2 | Navi | 48 | 110 | 0 | 43.6 | — | — | — | — | ⏳ PENDING |
| W3 | Navi | 36 | 61 | 0 | 31.1 | — | — | — | — | ⏳ PENDING |
| W4 | Navi | 40 | 66 | 3 | 34.8 | — | — | — | — | ⏳ PENDING |
| W5 | Navi | 51 | 135 | 5.9 | 59.3 | — | — | — | — | ⏳ PENDING |
| W6 | Navi | 69 | 141 | 5 | 41.8 | — | — | — | — | ⏳ PENDING |
| W1 | Unifinz | 45 | 176 | 6.8 | 71.6 | — | — | — | — | ⏳ PENDING |
| W2 | Unifinz | 32 | 198 | 21.2 | 79.3 | — | — | — | — | ⏳ PENDING |
| W3 | Unifinz | 11 | 30 | 16.7 | 70 | — | — | — | — | ⏳ PENDING |
| W4 | Unifinz | 36 | 103 | 0 | 60.2 | — | — | — | — | ⏳ PENDING |
| W5 | Unifinz | 25 | 75 | 6.7 | 66.7 | — | — | — | — | ⏳ PENDING |
| W6 | Unifinz | 23 | 41 | 0 | 36.6 | — | — | — | — | ⏳ PENDING |
| W1 | Vedika Credit | 15 | 40 | 100 | 62.5 | — | — | — | — | ⏳ PENDING |
| W2 | Vedika Credit | 31 | 92 | 79.3 | 60.9 | — | — | — | — | ⏳ PENDING |
| W3 | Vedika Credit | 13 | 33 | 75.8 | 60.6 | — | — | — | — | ⏳ PENDING |
| W4 | Vedika Credit | 34 | 127 | 68.5 | 70.9 | — | — | — | — | ⏳ PENDING |
| W5 | Vedika Credit | 15 | 47 | 85.1 | 68.1 | — | — | — | — | ⏳ PENDING |
| W6 | Vedika Credit | 18 | 40 | 77.5 | 52.5 | — | — | — | — | ⏳ PENDING |

### ⏳ issuer_outcome — Per-issuer session outcome (sessionOutcomeByIssuerWeek)

_Source: `asset_search_query + result_clicked (issuer-classified)` · verdict: **PENDING**_

| week | issuer | searched (local) | success (local) | relevance_gap (local) | dead_end (local) | searched (metabase) | success (metabase) | relevance_gap (metabase) | dead_end (metabase) | verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| W1 | Adani | 11 | 6 | 5 | 0 | — | — | — | — | ⏳ PENDING |
| W2 | Adani | 19 | 18 | 1 | 0 | — | — | — | — | ⏳ PENDING |
| W3 | Adani | 13 | 12 | 1 | 0 | — | — | — | — | ⏳ PENDING |
| W4 | Adani | 27 | 21 | 5 | 1 | — | — | — | — | ⏳ PENDING |
| W5 | Adani | 25 | 20 | 4 | 1 | — | — | — | — | ⏳ PENDING |
| W6 | Adani | 21 | 21 | 0 | 0 | — | — | — | — | ⏳ PENDING |
| W1 | Akara Capital | 50 | 30 | 20 | 0 | — | — | — | — | ⏳ PENDING |
| W2 | Akara Capital | 33 | 25 | 7 | 1 | — | — | — | — | ⏳ PENDING |
| W3 | Akara Capital | 67 | 32 | 28 | 7 | — | — | — | — | ⏳ PENDING |
| W4 | Akara Capital | 44 | 19 | 25 | 0 | — | — | — | — | ⏳ PENDING |
| W5 | Akara Capital | 60 | 23 | 35 | 2 | — | — | — | — | ⏳ PENDING |
| W6 | Akara Capital | 53 | 22 | 27 | 4 | — | — | — | — | ⏳ PENDING |
| W1 | Govt / RBI Bonds | 87 | 50 | 22 | 15 | — | — | — | — | ⏳ PENDING |
| W2 | Govt / RBI Bonds | 68 | 36 | 21 | 11 | — | — | — | — | ⏳ PENDING |
| W3 | Govt / RBI Bonds | 64 | 41 | 18 | 5 | — | — | — | — | ⏳ PENDING |
| W4 | Govt / RBI Bonds | 69 | 41 | 23 | 5 | — | — | — | — | ⏳ PENDING |
| W5 | Govt / RBI Bonds | 55 | 27 | 17 | 11 | — | — | — | — | ⏳ PENDING |
| W6 | Govt / RBI Bonds | 60 | 33 | 21 | 6 | — | — | — | — | ⏳ PENDING |
| W1 | Indel Money | 15 | 13 | 2 | 0 | — | — | — | — | ⏳ PENDING |
| W2 | Indel Money | 23 | 23 | 0 | 0 | — | — | — | — | ⏳ PENDING |
| W3 | Indel Money | 25 | 20 | 5 | 0 | — | — | — | — | ⏳ PENDING |
| W4 | Indel Money | 13 | 10 | 3 | 0 | — | — | — | — | ⏳ PENDING |
| W5 | Indel Money | 14 | 10 | 4 | 0 | — | — | — | — | ⏳ PENDING |
| W6 | Indel Money | 16 | 15 | 1 | 0 | — | — | — | — | ⏳ PENDING |
| W1 | Keertana | 12 | 11 | 1 | 0 | — | — | — | — | ⏳ PENDING |
| W2 | Keertana | 16 | 12 | 4 | 0 | — | — | — | — | ⏳ PENDING |
| W3 | Keertana | 35 | 14 | 9 | 12 | — | — | — | — | ⏳ PENDING |
| W4 | Keertana | 47 | 25 | 13 | 9 | — | — | — | — | ⏳ PENDING |
| W5 | Keertana | 33 | 13 | 10 | 10 | — | — | — | — | ⏳ PENDING |
| W6 | Keertana | 51 | 43 | 5 | 3 | — | — | — | — | ⏳ PENDING |
| W1 | Mufin Finance | 21 | 4 | 14 | 3 | — | — | — | — | ⏳ PENDING |
| W2 | Mufin Finance | 13 | 3 | 5 | 5 | — | — | — | — | ⏳ PENDING |
| W3 | Mufin Finance | 17 | 11 | 6 | 0 | — | — | — | — | ⏳ PENDING |
| W4 | Mufin Finance | 30 | 28 | 0 | 2 | — | — | — | — | ⏳ PENDING |
| W5 | Mufin Finance | 28 | 17 | 7 | 4 | — | — | — | — | ⏳ PENDING |
| W6 | Mufin Finance | 13 | 7 | 4 | 2 | — | — | — | — | ⏳ PENDING |
| W1 | Muthoot Finance | 42 | 18 | 5 | 19 | — | — | — | — | ⏳ PENDING |
| W2 | Muthoot Finance | 43 | 28 | 8 | 7 | — | — | — | — | ⏳ PENDING |
| W3 | Muthoot Finance | 52 | 39 | 6 | 7 | — | — | — | — | ⏳ PENDING |
| W4 | Muthoot Finance | 47 | 19 | 1 | 27 | — | — | — | — | ⏳ PENDING |
| W5 | Muthoot Finance | 48 | 21 | 1 | 26 | — | — | — | — | ⏳ PENDING |
| W6 | Muthoot Finance | 41 | 25 | 5 | 11 | — | — | — | — | ⏳ PENDING |
| W1 | Navi | 32 | 18 | 13 | 1 | — | — | — | — | ⏳ PENDING |
| W2 | Navi | 48 | 46 | 2 | 0 | — | — | — | — | ⏳ PENDING |
| W3 | Navi | 36 | 32 | 4 | 0 | — | — | — | — | ⏳ PENDING |
| W4 | Navi | 40 | 32 | 6 | 2 | — | — | — | — | ⏳ PENDING |
| W5 | Navi | 51 | 31 | 20 | 0 | — | — | — | — | ⏳ PENDING |
| W6 | Navi | 69 | 61 | 6 | 2 | — | — | — | — | ⏳ PENDING |
| W1 | Unifinz | 45 | 12 | 32 | 1 | — | — | — | — | ⏳ PENDING |
| W2 | Unifinz | 32 | 6 | 25 | 1 | — | — | — | — | ⏳ PENDING |
| W3 | Unifinz | 11 | 8 | 1 | 2 | — | — | — | — | ⏳ PENDING |
| W4 | Unifinz | 36 | 22 | 14 | 0 | — | — | — | — | ⏳ PENDING |
| W5 | Unifinz | 25 | 16 | 9 | 0 | — | — | — | — | ⏳ PENDING |
| W6 | Unifinz | 23 | 21 | 2 | 0 | — | — | — | — | ⏳ PENDING |
| W1 | Vedika Credit | 15 | 1 | 0 | 14 | — | — | — | — | ⏳ PENDING |
| W2 | Vedika Credit | 31 | 7 | 10 | 14 | — | — | — | — | ⏳ PENDING |
| W3 | Vedika Credit | 13 | 4 | 5 | 4 | — | — | — | — | ⏳ PENDING |
| W4 | Vedika Credit | 34 | 11 | 14 | 9 | — | — | — | — | ⏳ PENDING |
| W5 | Vedika Credit | 15 | 5 | 4 | 6 | — | — | — | — | ⏳ PENDING |
| W6 | Vedika Credit | 18 | 7 | 3 | 8 | — | — | — | — | ⏳ PENDING |

### ⏳ conversion_by_week — Conversion atoms by week (conversionByWeek)

_Source: `asset_search_initiated/result_clicked + invest events` · verdict: **PENDING**_

| week | searchers (local) | conv_searchers (local) | clickers (local) | conv_clickers (local) | invest_events (local) | invest_users (local) | searchers (metabase) | conv_searchers (metabase) | clickers (metabase) | conv_clickers (metabase) | invest_events (metabase) | invest_users (metabase) | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| W1 | 945 | 228 | 344 | 100 | 10087 | 3890 | — | — | — | — | — | — | ⏳ PENDING |
| W2 | 999 | 303 | 413 | 156 | 11169 | 4200 | — | — | — | — | — | — | ⏳ PENDING |
| W3 | 980 | 329 | 429 | 175 | 12214 | 4295 | — | — | — | — | — | — | ⏳ PENDING |
| W4 | 1009 | 296 | 471 | 189 | 11277 | 3850 | — | — | — | — | — | — | ⏳ PENDING |
| W5 | 927 | 238 | 370 | 109 | 9657 | 3897 | — | — | — | — | — | — | ⏳ PENDING |
| W6 | 979 | 255 | 467 | 151 | 9760 | 3875 | — | — | — | — | — | — | ⏳ PENDING |

### ⏳ search_to_invest — Search -> invest, asset-level same-day (searchToInvestRate)

_Source: `asset_search_result_clicked + invest events` · verdict: **PENDING**_

| (value) | click_events (local) | matched (local) | click_events (metabase) | matched (metabase) | verdict |
|---|---|---|---|---|---|
| — | 3352 | 612 | — | — | ⏳ PENDING |

### ⏳ adoption — Search adoption by week (weeklyAdoption)

_Source: `view_assets / assets_page_views UNION asset_search_initiated` · verdict: **PENDING**_

| week | visitors (local) | searchers (local) | adoption_pct (local) | visitors (metabase) | searchers (metabase) | adoption_pct (metabase) | verdict |
|---|---|---|---|---|---|---|---|
| W1 | 15858 | 945 | 6 | — | — | — | ⏳ PENDING |
| W2 | 15105 | 999 | 6.6 | — | — | — | ⏳ PENDING |
| W3 | 16233 | 980 | 6 | — | — | — | ⏳ PENDING |
| W4 | 15929 | 1009 | 6.3 | — | — | — | ⏳ PENDING |
| W5 | 16894 | 927 | 5.5 | — | — | — | ⏳ PENDING |
| W6 | 16627 | 979 | 5.9 | — | — | — | ⏳ PENDING |

---

## Method & known calibration points

- **Window anchoring** — each Metabase relation is filtered to the exact `[min,max]` UTC `timestamp` of its local CSV slice. CSV timestamps load as naive UTC (`read_csv_auto`), matching the naive-UTC `timestamp` column the export guide assumes.
- **Test users** `3,4,207871,207875,207878,207879` are excluded on both sides (`user_id` cast to DOUBLE — W1-W3 store it as `"622564.0"`).
- **Read-only by construction** — the harness prefers a `METABASE_API_KEY` (scope it read-only in Metabase) over a session login, and every query it sends is asserted to be a single bare `SELECT`/`WITH` (`assert_read_only`). It cannot write to Metabase even if asked to.
- **Internal-consistency tier** runs on the local data alone (no Metabase, no credentials) — see the section above. It is the validation you can trust without ever touching production.
- **`adoption` is INFORMATIONAL** — its local visitor base is the *derived* `assets_page_views` (a 6-column projection of `view_assets` by `metabase-connect/derive_page_views.py`); the Metabase side is raw `view_assets`. An ~88-95% distinct-user overlap is expected by design, so it is never marked DISCREPANT.
- **Pre-computed export tables** `10_daily_funnel_summary`, `13_asset_click_aggregated`, `14_conversion_cohort_summary` are analyst rollups with no raw Metabase table; they are validated transitively (the raw events they derive from are checked here). Re-deriving them belongs to the S4/S5 fetch pipeline.
- **First credentialed run** may need two adjustments, like the Grip Connect pipeline's Phase-1 pin: (1) the `timestamp` column is assumed naive-UTC — if Metabase stores `timestamptz`, the window literals need a tz cast; (2) `user_id` is cast via TEXT→DOUBLE — if the column holds non-numeric values the cast must be guarded. Both surface immediately as a SQL error, not silent.
