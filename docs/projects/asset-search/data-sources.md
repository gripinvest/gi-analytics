# Asset Search — data source mapping

**DB:** Rudder Prod · `database_id 8` · schema `client_web` (PostgreSQL)
**Period:** W1–W7 · 2 Apr – 18 May 2026
**Source:** master tracking doc, validated against the local W1–W6 exports
(`metabase-connect/`) on 18 May 2026.

> Feeds the Asset Search dashboard. Pairs with [`roadmap.md`](./roadmap.md) for
> what to build next.

---

## 0. Validation status

Validated against the **local W1–W6 CSV exports** — there is no live Metabase
connection wired into this workspace, so the not-yet-exported tables (§3) could
not be schema-checked.

| Claim | Result |
|-------|--------|
| `asset_search_query` ~30K | ✅ 29,582 rows W1–W6 |
| `asset_search_empty_state` ~12K | ✅ 12,845 |
| `asset_search_result_clicked` ~4.5K | ✅ 4,384 |
| `asset_search_cleared` ~3K | ✅ 3,282 |
| `asset_search_initiated` ~8K | ⚠️ **estimate stale** — 10,294 rows in W1–W6 alone |
| `asset_search_suggestion_clicked` ~700 | ⚠️ low — 887 in W1–W6 |
| `asset_search_cleared` carries `had_results`/`any_result_clicked`/`query_text_at_clear` | ❌ **only W4 onward** — see §2a |

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

| Metric | Computable now | Notes |
|--------|:--------------:|-------|
| **Session-outcome funnel** (success / relevance-gap / dead-end) | ✅ | **Primary metric.** Live from `asset_search_query` + `result_clicked`; exact all weeks. |
| Search Success Rate | ✅ | Headline; clicked-result share of searched sessions. |
| Search adoption rate | ✅ | `view_assets` users → `search_initiated` users |
| ZRR (query-level) | ✅ | `asset_search_query.results_count` |
| Refinement rate | ✅ | `asset_search_query.is_refinement` |
| Position bias | ✅ | `asset_search_result_clicked.result_position` |
| Suggestion CTR | ✅ | `suggestion_clicked` / `initiated` |
| Search CVR (invest-now level), same-day | ✅ | invest events / search users, same day |
| Search lift vs browse CVR | ✅ | with `view_assets` denominator |
| `cleared`-based true abandonment / relevance gap | ⚠️ secondary | Exact W4+ only; **understates failure ~10×** vs the outcome funnel. Demoted to a friction signal — not the primary metric. |
| Search → payment-page rate | ❌ | needs `view_payment_page_loaded` |
| True payment completion | ❌ | needs `view_payment_status_page` (schema check) |
| Search → payment value | ❌ | needs `payble_amount` joined to search |
| Cross-day attribution | ❌→🟡 | doable now with a 7-day `anonymous_id` join |
| FTI rate via search | ❌ | needs `new_user_order` |

---

## 7. Frontend cross-check (pending)

The frontend codebase has not been cross-referenced against this map. To close
the loop, confirm every `rudderstack.track()` call in the Grip app source lands
in DB8, and check whether a `payment_success` / `payment_complete` event is
tracked into a different schema or ClickHouse.
