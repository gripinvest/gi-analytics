# Asset Search — data source mapping

**DB:** Rudder Prod · `database_id 8` · schema `client_web` (PostgreSQL)
**Period:** W1–W7 · 2 Apr – 18 May 2026
**Source:** master tracking doc, validated against the local W1–W6 exports
(`metabase-connect/`) on 18 May 2026.

> Feeds the Asset Search dashboard. Pairs with [`roadmap.md`](./roadmap.md) for
> what to build next.

---

## 0. Validation status

A deterministic validation harness now exists —
`backend/services/integrations/validate_asset_search.py` — which re-computes
every dashboard metric from the local W1–W6 CSVs and, in `metabase` mode, from
the live `client_web` schema, then diffs them under a two-tier verdict policy
(exact / minor-drift / discrepant). Run `--local-only` for the no-credentials
baseline; the credentialed Metabase diff is a CI / operator job (S3 discipline).
Latest output: [`metabase-validation-report.md`](./metabase-validation-report.md).

**Row counts — W1–W6, raw `COUNT(*)`** (corrected — see the F1 note below;
confirmed against the deployed CSVs by the harness's §0 regression guard):

| Table | W1–W6 rows | Status |
|-------|-----------:|--------|
| `asset_search_query` | 26,544 | ✅ matches deployed data |
| `asset_search_empty_state` | 11,509 | ✅ matches deployed data |
| `asset_search_result_clicked` | 3,897 | ✅ matches deployed data |
| `asset_search_cleared` | 2,967 | ✅ matches deployed data |
| `asset_search_initiated` | 9,252 | ✅ matches deployed data |
| `asset_search_suggestion_clicked` | 804 | ✅ matches deployed data |
| `asset_search_cleared` carries `had_results`/`any_result_clicked`/`query_text_at_clear` | ❌ **only W4 onward** — see §2a |

> **Pending:** the rows above are confirmed against the local CSVs the dashboard
> ships. The local↔Metabase diff (these counts against the live `client_web`
> tables, plus every metric in §6) is computed by the harness but awaits the
> credentialed run — every check is `PENDING` in the current report.

**⚠️ F1 — the earlier §0 row counts were overstated (corrected 19 May 2026).**
The previous figures (`query` 29,582 / `empty_state` 12,845 / `result_clicked`
4,384 / `cleared` 3,282 / `initiated` 10,294 / `suggestion_clicked` 887) were
summed from `metabase-connect/`, which holds **two** W6 exports — a superseded
partial (`W6_may07-may11`) and the full week (`W6_may07-may13`) — and the
partial was counted on top of the full week. The dashboard's deployed data
(`backend/data/asset_search/`, full W6 only) was always correct; only this doc
was wrong. Verified exactly for all six events (e.g. 26,544 + 3,038 partial =
29,582). The §6 metric trends are unaffected — they are computed per-week from
the same correct deployed data.

**Schema change mid-window (important):** the `asset_search_cleared` export
schema changed. W1–W3 exports are **4-column** (`timestamp`,
`context_session_id`, `user_id`, `active_tab`) — *no* result payload. W4–W6 are
the full ~99-column export *with* `had_results` / `any_result_clicked` /
`query_text_at_clear`. Any metric off this event is exact only from W4.

---

## 1. Funnel map — what fires and when

```
User lands on /assets
        │
        ▼
[view_assets]                    ← Browse denominator. Full visitor context.
        │
        ├──── browses without searching ──────────────────────► [asset_card_clicked]
        │                                                              │
        ▼                                                       [view_asset_details]
[asset_search_initiated]         ← Taps search bar (fires on focus)     │
        │                                                               │
        ▼                                                               │
[asset_search_query]             ← Each debounced query ≥3 chars         │
   ├── results_count > 0 ──► [asset_search_result_clicked]               │
   └── results_count = 0  ──► [asset_search_empty_state]                 │
                               (once per unique zero-result term)        │
[asset_search_suggestion_clicked] ← Pre-typing, fires on focus (top-YTM) │
[asset_search_cleared]            ← User clears the bar (W4+ payload)    │
        │                                                               │
        ◄───────────────────────────────────────────────────────────────┘
        Search and browse paths converge:
[quick_checkout_opened] ──► [quick_checkout_invest_clicked]
[invest_now_button_clicked]  ← standard flow
        ▼
[view_payment_page_loaded]   ← payment screen (asset_id, payble_amount, gateway…)
        ▼
[view_payment_status_page]   ← payment result (success OR failure)
        ├── success → [new_user_order]  (first-ever investment)
        └── failure → not currently tracked (payment_failed is dead)
```

---

## 2. Tables in use

### 2a. Search event tables — all 6 active ✅

| Table | Rows W1–W7 | Key columns | Notes |
|-------|-----------:|-------------|-------|
| `asset_search_initiated` | ~12K¹ | `user_id`, `context_session_id`, `active_tab`, `assets_visible_count` | fires on focus |
| `asset_search_query` | ~30K | `query_text`, `results_count`, `is_refinement`, `query_length`, `active_tab` | debounced, ≥3 chars |
| `asset_search_empty_state` | ~12K | `query_text`, `query_length`, `active_tab` | once per unique 0-result term |
| `asset_search_result_clicked` | ~4.5K | `query_text`, `clicked_asset_id`, `clicked_asset_name`, `result_position`, `results_count` | `result_position` 0-indexed |
| `asset_search_suggestion_clicked` | ~900¹ | `asset_id`, `asset_name`, `item_position`, `suggestion_type` | pre-typing discovery |
| `asset_search_cleared` | ~3K | W4+: `query_text_at_clear`, `had_results`, `any_result_clicked`, `active_tab` · W1–W3: **only** timestamp/session/user/active_tab | ⚠️ schema split |

¹ Row-count estimate corrected against W1–W6 local data (see §0).

### 2d. V2 additions — new events shipped on the gi-client-web PT-37900 release

These start flowing once `feature/PT-37543-search-v2` lands in prod. Until
then, no rows exist; dashboard panels that consume them render mock data
with a "pending" pill (`engineDataState()` / `dataState()` helpers).

| Table | Rows W{cutover}+ | Key columns | Notes |
|-------|-----------------:|-------------|-------|
| `asset_search_notify_me_clicked` | TBD | `query_text`, `mapped_issuer`, `issuer_category`, `active_tab` | Tap on the "Notify me when it's back" CTA on a zero-result query. Feeds the **Outreach** section (CS workbench) + the "Issuer Demand" KPI exhibits. |
| `asset_search_alias_substituted` | TBD | `original_query`, `alias_used`, `results_count`, `active_tab` | Fires once per debounced query that hits the FE alias map (`ISSUER_REGISTRY` shortcuts: `muth→muthoot`, `rbi→goi`, …). Lets us validate which aliases are pulling weight and which are dead-weight to trim. |
| `asset_search_chip_clicked` | TBD | `query_text`, `chip_issuer`, `chip_position`, `active_tab` | Tap on an issuer-suggestion chip surfaced under the empty state. Measures the chip-rescue path on otherwise-dead-end searches. |

### 2e. `engine_version` field — V1 vs V2 release-cut split (all asset_search_* events)

Every `asset_search_*` event payload now carries an `engine_version` field
(stamped by `SEARCH_ENGINE_VERSION` in `gi-client-web/events/constants.ts`):

- `NULL` — V1 (pre-cutover; all historical W1–W{cutover-1} rows)
- `'v2'` — V2 (post-cutover from the gi-client-web PT-37900 release)

No event-schema migration is needed — Rudderstack tolerates new fields.
Existing query builders work unchanged for historical V1 data; the new
**Engine Cutover** strip on the Overview section adds a `GROUP BY engine_version`
to surface the diff.

**How to use it in a query:**

```sql
SELECT
  COALESCE(engine_version, 'v1') AS engine,
  COUNT(*)                       AS queries,
  100.0 * SUM(CASE WHEN results_count = 0 THEN 1 ELSE 0 END) / COUNT(*) AS zrr_pct
FROM asset_search_query
GROUP BY 1;
```

**Bumping the version**: when V3 (or a future engine change) ships, bump
the constant. No event-schema migration; the warehouse picks up the new
value automatically.

### 2f. Grip Connect segmentation — `gc_id` / `gc_name` (W4+ only)

Every event row carries the global GC stamp from gi-client-web
(`utils/gtm.ts` → `trackGCObject`): `gc_id` (partner gci config id),
`gc_name` (partner name), `external_user_id`. For an **own-platform** user these
are empty; for a **Grip Connect** partner journey `gc_id` / `gc_name` are set.
The split is exact per row — no mapping table.

**Segment definition (used by every GC builder in `assetSearch.js`):**

```sql
CASE WHEN gc_id IS NULL OR TRIM(CAST(gc_id AS VARCHAR)) = ''
     THEN 'Own Platform' ELSE 'Grip Connect' END
```

**Column availability — the one gotcha:** `gc_id` / `gc_name` exist only from
**W4 (Apr 23 2026) onward**. W1–W3 are narrow hand-exports (7/10/5 cols) that
predate the wide live-fetch `SELECT *` format and have **no** `gc_id` column, so
a UNION that references it over those tables errors. The dashboard handles this
with `gcScope()` + `GC_MIN_WEEK = 4`, which restricts every GC builder to
GC-capable weeks; the GC tab/section is labelled "W4 onward". Backfilling W1–W3
is tracked in [`roadmap.md`](./roadmap.md) § 4a.

| Column | Own platform | Grip Connect | Weeks |
|--------|--------------|--------------|-------|
| `gc_id` | empty | partner gci config id | W4+ |
| `gc_name` | empty | partner name (ET money, Mobikwik, …) | W4+ |
| `external_user_id` | empty | partner's external user id | W4+ |

Present on `asset_search_*` and `quick_checkout_invest_clicked`; **not** on the
pruned `invest_now_button_clicked` (4 cols) — so GC-split on the invest-now leg
is export-gated (see roadmap § 4a).

### 2b. Browse denominator ✅

| Table | Rows W1–W7 | Key columns |
|-------|-----------:|-------------|
| `view_assets` | ~520K | `user_id`, `anonymous_id`, `card_variation`, `cohort`, `entry_source`, `referrer_page`, `active_deal_count` |

### 2c. Conversion events — current ✅

| Table | Rows W1–W7 | Key columns |
|-------|-----------:|-------------|
| `invest_now_button_clicked` | ~66K | `user_id`, `anonymous_id`, `infinite` (=asset_id), `mf_investment_type`, `investment_amount`, `product_category` |
| `quick_checkout_invest_clicked` | ~5.7K | `user_id`, `anonymous_id`, `asset_id`, `product_category` |

---

## 3. Tables to add — confirmed active, not yet exported

### 3a. 🔴 HIGH — conversion-funnel completers

| Table | Rows W1–W7 | Why it matters | Key columns |
|-------|-----------:|----------------|-------------|
| `view_payment_page_loaded` | ~63.6K | One step past `invest_now_button_clicked` — user picked quantity and reached the payment screen. 96% of invest-now clicks reach here. | `asset_id`, `payble_amount`, `quantities_selected`, `payment_gateway`, `total_returns`, `venue`, `infinite` |
| `view_payment_status_page` | ~9.3K | Payment result page (success/fail) — closest signal to actual completion. | **Verify** it carries a `payment_status` column. |

`view_payment_page_loaded` is the key search-attribution unlock: its `asset_id`
joins to `asset_search_result_clicked.clicked_asset_id` for true search→payment
attribution; `payble_amount` enables value-weighted analysis.

### 3b. 🟡 MEDIUM — funnel context

| Table | Rows W1–W7 | Why |
|-------|-----------:|-----|
| `quick_checkout_opened` | ~130K | QC open rate (we only have the terminal `quick_checkout_invest_clicked`) |
| `new_user_order` | ~3K | First-ever investment — is search driving FTIs? |
| `order_summary_clicked` | ~2.5K | Intermediate checkout step |
| `asset_card_clicked` | ~370K | Browse-path asset clicks — browse-vs-search comparison at asset level |
| `view_asset_details` | ~630K | Detail-page view — stronger browse intent |

### 3c. ❌ Dead tables — empty in W1–W7, do not fetch

`investment_success` (73 rows all-time) · `transaction_complete` (stopped Dec
2025) · `payment_failed` (0 rows) · `payment_gateway_redirect` · `complete_investment_clicked`
· `invest_now_button_loaded` · `repeat_order_pay_button_clicked` · `retry_payment`
· `amount_payable_previewed` · `mandate_creation_status` · `choose_payment_tab_*`.

---

## 4. Known gaps — what we should track but don't

- **True payment completion** — `payment_failed` and `investment_success` are
  dead. `view_payment_status_page` is the best proxy; confirm it has a status column.
- **Cross-session attribution** — current CVR is same-day only (searched AND
  invested on the same calendar day). A 7-day window via `anonymous_id` join is
  doable with data already on hand.
- **Search → payment-stage** — do search users reach the payment page at higher
  rates? Needs `view_payment_page_loaded`.
- **Investment value through search** — avg deal size search vs browse. Needs
  `view_payment_page_loaded.payble_amount` (or `invest_now.investment_amount`)
  joined to search events.
- **Repeat-investor behaviour** — `new_user_order` is FTI-only; repeats can be
  approximated from `invest_now_button_clicked` grouped by `user_id` + date.

---

## 5. Recommended next exports

| # | Table | Effort | Impact |
|---|-------|--------|--------|
| 1 | `view_payment_page_loaded` | Low | 🔴 true payment-stage conversion |
| 2 | `view_payment_status_page` | Low | 🔴 closest to actual completion |
| 3 | `new_user_order` | Low | 🟡 FTI attribution to search |
| 4 | `order_summary_clicked` | Low | 🟡 intermediate checkout step |
| 5 | `asset_card_clicked` | Medium | 🟡 browse-vs-search asset comparison |

These should be pulled by the deterministic Metabase fetch pipeline once it is
extended to Asset Search — see [`roadmap.md`](./roadmap.md), not hand-exported.

---

## 6. Metric coverage

The **Validation** column maps each metric to the check that exercises it in
`validate_asset_search.py`. Every ✅ metric has a check; the harness computes
the local-CSV baseline (committed in
[`metabase-validation-report.md`](./metabase-validation-report.md)) and, on the
credentialed run, the live-Metabase diff. Status `baseline ✅ / Metabase ⏳`
means the local computation is confirmed and the Metabase diff is pending.

| Metric | Computable now | Validation check | Notes |
|--------|:--------------:|------------------|-------|
| **Session-outcome funnel** (success / relevance-gap / dead-end) | ✅ | `session_outcome`, `issuer_outcome` — baseline ✅ / Metabase ⏳ | **Primary metric.** Live from `asset_search_query` + `result_clicked`; exact all weeks. |
| Search Success Rate | ✅ | `session_outcome` (`success_pct`) — baseline ✅ / Metabase ⏳ | Headline; clicked-result share of searched sessions. |
| Search adoption rate | ✅ | `adoption` — **informational** | Local base is the derived `assets_page_views`; Metabase side is raw `view_assets` (~88–95% distinct-user overlap by design) — never marked discrepant. |
| ZRR (query-level) | ✅ | `query_health` (`zrr_pct`) — baseline ✅ / Metabase ⏳ | `asset_search_query.results_count` |
| Refinement rate | ✅ | `query_health` (`refinement_pct`) — baseline ✅ / Metabase ⏳ | `asset_search_query.is_refinement` |
| Position bias | ✅ | `clicks_by_position` — baseline ✅ / Metabase ⏳ | `asset_search_result_clicked.result_position` |
| Suggestion CTR | ✅ | `suggestions` — baseline ✅ / Metabase ⏳ | `suggestion_clicked` / `initiated` |
| Search CVR (invest-now level), same-day | ✅ | `conversion_by_week`, `search_to_invest` — baseline ✅ / Metabase ⏳ | invest events / search users, same IST day |
| Search lift vs browse CVR | ✅ | `conversion_by_week` (atoms) — baseline ✅ / Metabase ⏳ | Cohort lift is derived from the validated atoms; the launch-week cohort table (`14_…`) is a pre-computed export with no raw Metabase table. |
| `cleared`-based true abandonment / relevance gap | ⚠️ secondary | `clears` (event count) — baseline ✅ / Metabase ⏳ | Exact W4+ only; **understates failure ~10×** vs the outcome funnel. Demoted to a friction signal — not the primary metric. |
| Search → payment-page rate | ❌ | n/a — table not exported | needs `view_payment_page_loaded` |
| True payment completion | ❌ | n/a — table not exported | needs `view_payment_status_page` (schema check) |
| Search → payment value | ❌ | n/a — table not exported | needs `payble_amount` joined to search |
| Cross-day attribution | ❌→🟡 | n/a — not yet built | doable now with a 7-day `anonymous_id` join |
| FTI rate via search | ❌ | n/a — table not exported | needs `new_user_order` |

Raw event-table volumes (§2) are covered by the `vol_*` checks. The pre-computed
export rollups `10_daily_funnel_summary`, `13_asset_click_aggregated` and
`14_conversion_cohort_summary` have no raw Metabase table — they are validated
transitively through the raw events they derive from; re-deriving them belongs
to the S4/S5 fetch pipeline.

---

## 7. Frontend cross-check (pending)

The frontend codebase has not been cross-referenced against this map. To close
the loop, confirm every `rudderstack.track()` call in the Grip app source lands
in DB8, and check whether a `payment_success` / `payment_complete` event is
tracked into a different schema or ClickHouse.
