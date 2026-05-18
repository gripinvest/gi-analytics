# Grip Connect — Metrics Catalog

A single reference for the data behind the Grip Connect dashboard: which
Metabase cards we pull, what each column means, which numbers are surfaced
where, what is verifiable, and what we could add next.

This consolidates details that were previously scattered across the design
spec, code comments, Kishor's `gc-analyst` repo, and conversations with the
data and backend teams.

- **Last updated:** 2026-05-18
- **Maintained by:** whoever touches the Grip Connect pipeline next — keep it current.

---

## 1. Source

- **Platform:** Metabase — `https://metabase.gripinvest.in`
- **Collection:** `236 — General Non PII` (all Grip Connect cards live here)
- **Auth:** `backend/.env` holds `METABASE_URL`, `METABASE_API_KEY`,
  `METABASE_EMAIL`, `METABASE_PASSWORD`. On Render these are dashboard env vars
  (`sync: false` in `render.yaml`). The `.env` file is not committed.
- **Client:** `backend/services/integrations/metabase.py` (`MetabaseClient`,
  plain `httpx` — no browser, no LLM).
- **Underlying database:** the Metabase cards are analytical aggregations of
  Grip's production data. The operational schema beneath them — in particular
  the `GCI_SCHEMA` tables that power Grip Connect — is documented in
  [`gripinvest-db-schema.md`](gripinvest-db-schema.md).

### Partners and codes

The dashboard tracks four distribution partners. Metabase uses short codes;
the pipeline maps them in `backend/services/integrations/grip_connect.py`.

| Display name | `gc_name` param value | Short code | Retention code |
|---|---|---|---|
| ET Money | `ET money` | `et` | `et` |
| Paisa Bazaar | `Paisa Bazaar` | `pb` | `pb` |
| Mobikwik | `Mobikwik` | `mbk` | `mbk` |
| Tata Digital | `Tata Digital Private Ltd` | `tdl` | `tdl` |

Other channel codes seen in Metabase: `gc` = all Grip Connect partners
combined, `grip` = direct Grip app, `total` = everything.

---

## 2. Cards in use (the refresh pipeline)

These five cards are ingested by `backend/services/integrations/refresh.py`
into **layer-1** tables (raw card snapshots). Three are parameterised by
partner (`gc_name`) and fetched once per partner; two are single-row
whole-table pulls.

### Card 3841 — `GC Summary - WOW CH`  *(param: `gc_name`)*

Week-over-week summary, one row per week per partner.

| Column | Meaning |
|---|---|
| `week` | ISO week-start date |
| `no_of_registrations` | Registrations that week |
| `no_orders` | Orders placed |
| `aum` | Assets under management added (₹) |
| `aov` | Average order value (₹) |
| `fti_count` | First-time investor count |
| `fti_amount` | AUM from first-time investors (₹) |

→ layer-1 table `card_3841_summary_wow`. Surfaced in: partner dossier
"Assets, week by week" chart and "The weekly count" ledger.

### Card 3843 — `GC Summary-DOD CH`  *(param: `gc_name`)*

Day-over-day version of 3841, one row per day per partner. Same columns as
3841 except the date column is `day` (not `week`).

→ layer-1 table `card_3843_summary_dod`. Surfaced in: combined report's
"AUM — daily trajectory" table; partner dossier's monthly AUM rollup
(frontend `GROUP BY` calendar month over this table).

### Card 4499 — `Overall Journey Funnel WoW v2.0 CH`  *(param: `gc_name`)*

The full registration → KYC → investment funnel, week-over-week. ~45 columns.
The dashboard uses a subset; the rest are available.

Key columns used by the funnel section:

| Column | Meaning |
|---|---|
| `no_of_total_reg` | Total registrations (funnel denominator) |
| `email_verified_users` / `mobile_verified_users` | Verification counts |
| `no_of_full_reg` | Completed registrations |
| `landed_on_pan` | Reached the PAN step |
| `kyc_initiated_pan` | KYC initiated |
| `ucc` | UCC / KYC complete |
| `fti_on_any_day` / `any_day_repeat` | First-time / repeat investors |

Also carries (not yet surfaced): stage-by-stage KYC breakdown
(`kra_digilocker_adhaarxml`, `bank`, `nominee`, `liveliness`, `signature`,
`aof`, `demat`), same-week conversion metrics (`same_week_reg_ucc`,
`same_week_reg_fti`, …), referral metrics (`referees_registered`,
`referees_invested`), and pre-computed `%` ratio columns for each step.

→ layer-1 table `card_4499_kyc_funnel`. Surfaced in: "Registration to KYC"
funnel section.

### Card 5042 — `FTI & Repeat : MTD vs LMTD`  *(no param)*

Single row. Month-to-date vs last-month-to-date investor counts. Columns
follow the pattern `{mtd|LMTD}_{channel}_{inv|fti|repeat}` where channel is
one of `(blank=total)`, `gc`, `grip`, `tdl`, `et`, `pb`, `mbk`.

- `inv` = total investors (`inv = fti + repeat`, verified: ET 339 = 140 + 199)
- `fti` = first-time investors
- `repeat` = repeat investors

→ layer-1 table `card_5042_retention_d1` *(filename is a misnomer — this is
not D1 retention; see §5)*. Surfaced in: the dossier headline / North Star
FTI and Repeat figures (`mtd_<code>_fti`, `LMTD_<code>_fti`, etc.).

### Card 5046 — `Total Unique Inv : MTD vs LMTD`  *(no param)*

Single row. MTD vs LMTD **unique investor** counts:
`{mtd|lmtd}_{channel}_unique_inv`.

→ layer-1 table `card_5046_retention_d2` *(also a misnamed filename)*. Not
currently surfaced — `unique_inv` is a distinct population from 5042's `inv`
(ET money: `mtd_et_unique_inv` ≈ 2,640 vs `mtd_et_inv` ≈ 339), and the exact
definition needs confirmation from the data team before it can be labelled.

---

## 3. Derived data (layer-2 and frontend)

Computed from layer-1, not pulled from Metabase directly.

| Derived metric | Built by | From |
|---|---|---|
| `01_north_star` | `grip_connect.build_layer2` | 3843 (AUM MTD/LMTD), 5042 (FTI/Repeat) |
| `02_reg_to_kyc` | `grip_connect.build_layer2` | 4499 (funnel %s) |
| Monthly AUM rollup | frontend SQL `GROUP BY` | `card_3843_summary_dod` |

Hand-loaded / static (not on the live refresh yet): `03_redirect_handoff`,
`04_kyc_upload`. These lag — the dashboard's dynamic week labels expose it.

---

## 4. Cards available but not yet ingested

Discovered via Metabase search (collection 236). Candidates for future
dashboard sections.

### Card 4913 — `Unique Investors Master Cohort MoM CH`  ★ real retention

A month-over-month cohort matrix. Each row is an `(fti_month, order_month)`
pair with investor counts. 26 columns: `fti_month`, `order_month`, then
per-product totals (`grip_overall`, `bonds_overall`, `sdi_overall`,
`fds_overall`, `basket_overall`, `mf_overall`), per-channel splits
(`grip`, `gc`, and **`tdl`, `pb`, `et`, `mbk`**), product×channel cells,
and `pre_rfq` / `post_rfq`.

This is the genuine per-partner retention cohort — from it you can build a
retention curve or triangle for each partner. No `gc_name` param: it is a
whole-table pull like 5042/5046.

**Caveat:** heavy cards return HTTP `202` (async). `MetabaseClient.fetch_card`
currently assumes a synchronous `200` — ingesting 4913 needs an async-poll
step added to the client.

Single-partner variants (subset of 4913): `4550` (TATA), `4551` (Paisa
Bazaar). No standalone ET Money / Mobikwik cohort card exists — use 4913.

### Other candidates

| Card | Name | Shape | Could power |
|---|---|---|---|
| 2943 | Repeat investors from previous month - MoM CH | `month_year`, `distinct_investors`, `repeat_from_prev_month` | A simple MoM repeat-rate trend (not per-partner) |
| 3919 | Cohort UCC - FTI MoM - CH | `month`, `uccmonth`, `fti` | KYC-completion cohort |
| 3604 | Unique Investors Cohort V3 - MoM CH | `fti_month`, `order_month`, `Investors` | Overall (non-partner-split) cohort |
| 4493 | GC - Users Trading Activity CH | per-user units bought/sold (`user_id`, …) | User-level analysis — PII-adjacent, not for the shared dashboard |

---

## 5. Verifiability notes

The product rule: **only show numbers that are 100% verifiable** — i.e. they
trace to a Metabase source column through a deterministic transformation
(SUM, COUNT, a ratio of two real columns). No projections, run-rates, or
forecasts.

- **Verifiable, surfaced:** weekly counts (3841), daily AUM (3843), monthly
  AUM rollup (calendar-month SUM of 3843), FTI/Repeat counts (5042), funnel
  step percentages (4499).
- **`card_5042`/`card_5046` filenames say `retention_d1`/`retention_d2` —
  they are not retention.** They are MTD-vs-LMTD investor-count snapshots.
  Real retention lives in the cohort cards (§4). Rename these layer-1 files
  when convenient.
- **`5042.inv` vs `5046.unique_inv`** are different populations. Do not
  present `unique_inv` until the data team confirms its exact definition.
- **Funnel percentages** use two derivation paths: the first three steps are
  `count / total_reg` re-derived from raw 4499 columns; later steps pass
  through 4499's pre-computed `%` columns. Both are verifiable; show the raw
  numerator/denominator if precise auditing is needed.
- **"Repeat money"** in the AUM bar chart is the residual `aum - fti_amount`,
  not a source column. Accurate as long as `aum` and `fti_amount` are
  consistent in 3841/3843.

---

## 6. How to extract a new card

1. Find the card ID in Metabase (the number in `…/question/<ID>`), confirm
   its collection and whether it has a `gc_name` parameter.
2. Add it to the `CARDS` registry in
   `backend/services/integrations/grip_connect.py`.
3. If parameterised, it is fetched once per partner; if not, it is a single
   whole-table pull (pattern: 5042/5046).
4. `refresh.py` writes the rows to a layer-1 CSV (`card_<id>_<name>.csv`) via
   `accumulate.upsert_csv`; `build_duckdb.py` bakes it into the `.duckdb`
   file at deploy.
5. Surface it in the dashboard (a layer-2 derivation in `build_layer2`, or a
   direct frontend query against the layer-1 table).

Heavy cards (e.g. 4913) return HTTP `202` — add async polling to
`MetabaseClient.fetch_card` before relying on them.

Discovery scripts used to compile this catalog are one-off and not committed
(they live in `/tmp`); re-run the Metabase search if the inventory needs
refreshing.

---

## 7. Candidate dashboard additions

Verifiable metrics we could add, in rough priority order:

1. **Per-partner retention cohort** — from card 4913. A retention triangle or
   curve per partner. The headline gap today.
2. **Monthly order count** — alongside the monthly AUM chart; same
   `GROUP BY` over 3843.
3. **First-time vs repeat AUM mix over time** — ratio of `fti_amount` to
   `aum`, trended.
4. **Funnel trend** — 4499 is already week-over-week; today only the latest
   week shows. Trend the reg→KYC conversion across weeks.
5. **Same-week conversion** — 4499 carries `same_week_reg_ucc`,
   `same_week_reg_fti` — speed-of-conversion metrics, not yet surfaced.
