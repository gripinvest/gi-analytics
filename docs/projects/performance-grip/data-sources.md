# Performance Grip — data sources

Captured during Phase 0 discovery (2026-05-21). **Update as you learn.**

## New Relic account

- **Account ID:** `4002804`
- **Region:** US (`https://api.newrelic.com/graphql`)
- **Key type:** **User API Key** (`NEW_RELIC_API_KEY`). Insights Query Keys do NOT work with NerdGraph — confirmed via plan review CA1.
- **Active key owner:** Personal (Puru's User API Key). **TODO:** migrate to a dedicated service-account user `grip-analytics-cron` with a read-only NerdGraph custom role before cron goes live. Track in roadmap.
- **Last verified:** 2026-05-21 — auth tested against NerdGraph, returns `{id: 4002804, name: "Account 4002804"}`.

## Apps tracked (v1)

| Canonical slug (our schema) | NR `appName` value | Purpose |
|---|---|---|
| `gi-client-static` | `gi_client_static_prod` | Pre-login marketing site (SEO-driven) |
| `gi-client-web` | `gi_client_web_prod` | Post-login investing platform (conversion-driven) |

Discovered via:
```nrql
SELECT uniques(appName) FROM PageViewTiming SINCE 7 days AGO
```

## NRQL query shapes — locked from real fixtures

Fixtures live under `backend/tests/fixtures/new_relic/`:
- `Q1_pageviewtiming_response.json` (25.8K, 56 facets, filter()-wrapped variant — the correct one)
- `Q1_timeseries_response.json` (5K, 18 rows = 3 facets × 6 hour buckets — TIMESERIES verification fixture)
- `Q2_pageview_response.json` (10.8K, 75 facets)
- `Q3_javascripterror_response.json` (18.7K, 128 facets)

### Percentile response shape — LOCKED

NerdGraph returns `percentile(field, 75, 95)` as a **nested object keyed by string-percentile**:

```json
{
  "facet": ["https://www.gripinvest.in/corporate-bonds", "Desktop"],
  "lcp":  { "75": 21.1,  "95": 21.1 },
  "inp":  { "75": 0.04,  "95": 0.04 },
  "cls":  { "75": 0.001, "95": 0.001 },
  "fcp":  { "75": 20.884, "95": 20.884 },
  "ttfb": { "75": 0.0,   "95": 0.0 },
  "sample_count": 2
}
```

**Parser must access nested keys**: `result["lcp"]["75"]`, NOT `result["lcp.75"]` or `result["lcp_75"]`.

### CA2 confirmed — `timingName` discriminator IS required

`PageViewTiming` events carry ONE timing value per row, identified by a `timingName` discriminator field. Distinct `timingName` values observed:

```
cumulativeLayoutShift, windowUnload, firstPaint, firstContentfulPaint,
interactionToNextPaint, firstInteraction, pageHide, windowLoad,
largestContentfulPaint
```

(9 total — the 5 Web Vitals plus several lifecycle events.)

**`count(*)` without `WHERE timingName='X'` inflates by ~5×** because it sums across all timing-event types. Side-by-side comparison observed:

| pageUrl × device | Variant A (no filter) sample_count | Variant B (filter() WHERE timingName) sample_count | Ratio |
|---|---|---|---|
| `/corporate-bonds` Desktop | 21 | 2 | 10.5× |
| `/blog/german-silver-vs-silver` Mobile | 6 | 1 | 6× |
| `/blog/gold-crash` Mobile | 9 | 1 | 9× |
| `/blog/business-lessons` Desktop | ~21 | 1 | ~21× |

Percentile *values* (lcp, inp, etc) are nearly identical between variants because `percentile()` naturally skips nulls — the wrong-type rows contribute null values and are excluded from the percentile calc. **Only `count(*)` is broken** in the simple variant.

**Production query MUST use the `filter()`-wrapped form** for both percentile() and count(*).

### Q1 — Web Vitals timings (CORRECT form, locked)

```nrql
SELECT
  filter(percentile(largestContentfulPaint, 75, 95), WHERE timingName='largestContentfulPaint') AS lcp,
  filter(percentile(interactionToNextPaint,  75, 95), WHERE timingName='interactionToNextPaint') AS inp,
  filter(percentile(cumulativeLayoutShift,   75, 95), WHERE timingName='cumulativeLayoutShift') AS cls,
  filter(percentile(firstContentfulPaint,    75, 95), WHERE timingName='firstContentfulPaint') AS fcp,
  filter(percentile(firstByte,               75, 95), WHERE timingName='firstByte') AS ttfb,
  filter(count(*), WHERE timingName='largestContentfulPaint') AS sample_count
FROM PageViewTiming
WHERE appName = '<canonical>'
  AND pageUrl IS NOT NULL AND deviceType IS NOT NULL
SINCE … UNTIL …
WITH TIMEZONE 'Asia/Kolkata'
FACET pageUrl, deviceType LIMIT MAX
```

`sample_count` is the LCP-row count specifically — it's the canonical denominator for whether a metric has enough data to trust the p75/p95.

### Q2 — Page-view volume

```nrql
SELECT count(*) AS page_views
FROM PageView
WHERE appName = '<canonical>' AND pageUrl IS NOT NULL AND deviceType IS NOT NULL
SINCE … UNTIL …
WITH TIMEZONE 'Asia/Kolkata'
FACET pageUrl, deviceType LIMIT MAX
```

### Q3 — JS errors

```nrql
SELECT count(*) AS js_errors
FROM JavaScriptError
WHERE appName = '<canonical>' AND pageUrl IS NOT NULL
SINCE … UNTIL …
WITH TIMEZONE 'Asia/Kolkata'
FACET pageUrl, deviceType LIMIT MAX
```

**M13 guardrail:** only `count(*)` is projected. Do NOT add `message`, `stackTrace`, or `customAttributes` — those carry user IDs and auth tokens.

## Verified facts

### `pageUrl` is a full absolute URL

NR's `pageUrl` field contains scheme + host + path + query, e.g.,
`https://www.gripinvest.in/corporate-bonds`. The `clean_url` helper must
strip scheme + host (it does, via `urlparse`).

Example URL forms observed:
- `https://www.gripinvest.in/corporate-bonds` (main domain)
- `https://www.gripinvest.in/blog/german-silver-vs-silver`
- `https://www-gripinvest-in.translate.goog/blog/gold-crash` (Google Translate proxy — a different host; will collapse to its `/blog/gold-crash` path after clean_url)

### INP availability — CONFIRMED populated

`interactionToNextPaint` IS populated and queryable. INP is in scope for v1.

### TTFB field name — CONFIRMED `firstByte`

`firstByte` is the correct field (matches public docs). Note: TTFB values
are mostly `0.0` in the discovery sample — NR appears to treat `firstByte`
as a duration from a different baseline than expected. Verify behaviour
during operation; may need to revisit how we surface TTFB in the dashboard.

### `deviceType` availability

| Event | `deviceType` populated |
|---|---|
| `PageViewTiming` | required (we WHERE-filter it) |
| `PageView` | required (we WHERE-filter it) |
| `JavaScriptError` | **100% populated** in the discovery sample (128/128 buckets) |

**CA3 disconfirmed for this account:** Q3 can keep `FACET pageUrl, deviceType` as originally specced. No broadcast logic needed in `merge_rows`.

### Hourly bucketing strategy — TIMESERIES IS VIABLE

`TIMESERIES 1 hour` works cleanly with `FACET pageUrl, deviceType`. Response
shape (one row per `(facet, bucket)`):

```json
{
  "facet": ["https://...", "Mobile"],
  "beginTimeSeconds": 1779285344,
  "endTimeSeconds": 1779288944,
  "lcp": { "75": 35.064 },
  "sample_count": 1
}
```

**`LIMIT 3 TIMESERIES 1 hour` over 6h returned 18 rows = 3 facets × 6 buckets.** So `LIMIT` caps the facet count, not the (facet × bucket) count. With `LIMIT MAX` (5000 facets) × 24 hourly buckets = up to 120K rows per query — handleable.

**Decision: use TIMESERIES.** Plan Task 0.7's default decision lands here. Reduces NRQL call volume by ~24× vs per-hour queries.

**Buckets with no data** return `sample_count: 0, lcp: {75: 0.0}` — the parser must filter zero-sample buckets out (don't write them to CSV).

### Bot filtering — moot

`userAgent` IS queryable on `PageViewTiming`. But the bot filter
`WHERE userAgent LIKE '%bot%' OR LIKE '%crawl%'` returned **0 / 53,315
events** in 1 day. NR Browser agent doesn't capture telemetry from
headless / no-JS bots; the events we see are real browsers. Bot filtering
at NRQL adds no value — **omit the WHERE clause** in production queries.

### NRQL `LIMIT MAX` confirmed at 5000

H10's claim verified — `LIMIT MAX` accepts up to 5000 facets per query.
Probe threshold of 4500 is correct.

## Discovery process — replay

The Phase 0 NRQL session was scripted (not run interactively in GraphiQL).
The fixtures above came from `backend/.venv/bin/python` direct calls to
`https://api.newrelic.com/graphql`. To re-run any discovery query against
the live account, use:

```bash
backend/.venv/bin/python -c "
import os, json
from pathlib import Path
from dotenv import load_dotenv
import httpx
load_dotenv(Path('backend/.env'))
KEY, ACCT = os.environ['NEW_RELIC_API_KEY'], os.environ['NEW_RELIC_ACCOUNT_ID']
gql = '{ actor { account(id: ' + ACCT + ') { nrql(query: ' + json.dumps('<YOUR NRQL HERE>') + ') { results } } } }'
r = httpx.post('https://api.newrelic.com/graphql',
    headers={'API-Key': KEY, 'Content-Type': 'application/json'},
    json={'query': gql}, timeout=30.0)
print(json.dumps(r.json(), indent=2))
"
```

## Architecture: Path C (split-query fetch with pattern collapse)

**Decision made 2026-05-21 after Phase 0 validation.** K2 (spec §12) flipped.

### Why

Initial K2 assumed ~200 URLs per app and stored raw URLs at fetch time, applying
patterns in the dashboard layer. Phase 0 validation showed:

| App | Distinct URLs / 24h | Facet cap usage |
|---|---|---|
| `gi_client_static_prod` | ~75 (mostly blog slugs) | 1.5% |
| `gi_client_web_prod` | **4,882** | **98%** (4899/5000 — silent truncation territory) |

99% of web facets are `/external-ui/[uuid]` — per-session partner-webview URLs
with no per-URL meaning. Storing them raw saturates the cap with noise; the
meaningful named routes (`/login`, `/portfolio`, `/checkout`) get pushed below
the truncation line.

### How

**Split each fetch into two query types per `(app, hour, query)`:**

1. **Raw query** — `FACET pageUrl, deviceType LIMIT MAX` with `WHERE` clauses
   that EXCLUDE all collapse patterns AND all deprecated paths. Yields raw rows
   for the ~30 named pages.
2. **Per-pattern collapse query** — for each pattern in `route_patterns.csv`
   with `collapse_at_fetch=1`: `WHERE pageUrl LIKE 'pattern' FACET deviceType`
   (no pageUrl facet). Yields 1-3 rows (one per active device) using the pattern
   label as `page_url`.

**Validation result:** 19,438 samples captured (vs 19,415 if everything raw — the
~0.1% delta is the excluded deprecated paths). Facet count per query: 30 raw +
~12 collapse-aggregate rows ≈ 42 total rows / query (well below the 5000 cap).

### Pattern list locked in `backend/data/performance_grip/route_patterns.csv`

CSV schema:
```
app, pattern, nrql_like, collapse_at_fetch, exclude, sort_priority, notes
```

**Collapse-at-fetch patterns** (4 web + 5 static):
- web: `/external-ui/[uuid]`, `/checkout/[uuid]`, `/assetdetails/[id]`, `/assetagreement/[id]`
- static: `/blog/[slug]`, `/category/[slug]`, `/product-detail/[slug]`, `/marketing/[url]`, `/faq/[type]/...`
- static: `/[slug]` — top-level CMS catch-all (matches anything not matched by higher-priority rules)

**Excluded patterns** (not fetched at all):
- web (deprecated): `/kyc/*`, `/kyc`, `/external/*`, `/vault`, `/my-transactions`, `/account-inactive`, `/authenticate`, `/referral-dashboard`
- web (dev/system): `/health`, `/grip-icons`, `/persona-results`, `/qa-config-editor`
- static (system): `/health-static`, `/sitemap*`, `/api/*`

**Stored raw** (everything else — ~30 named pages, low cardinality each):
- web: `/`, `/discover`, `/portfolio`, `/marketplace`, `/assets`, `/assets/bonds`, `/assets/corporate-fds`, `/assets/category/[name]`, `/login`, `/signup`, `/quick-start`, `/user-kyc`, `/profile`, `/profile/[slug]`, `/preferences`, `/transactions`, `/reward-history`, `/notifications`, `/referral`, `/confirmation`, `/order-confirmation`, `/order-failure`, `/gc-confirmation`, `/pg-confirmation`, `/payment-processing`, `/demat-processing`, `/obpp-processing`, `/rfq-payment-processing`, `/gci-payment-processing`, `/gci-postpayment-processing`, `/gci/esign`, `/activate-infinite`, `/assets/[...]` (catch-all kept raw per user decision)
- static: `/`, `/home`, `/about-us`, `/legal`, `/transparency`, `/raise-capital`, `/channel-partner`, `/nse-sebi-integration`, `/corporate-bonds`, `/blog`, `/faq`, `/gc-redirection-fail`, `/marketing/sip-bonds`

### Storage schema impact

**Unchanged** — `page_url` column holds:
- Raw URL (e.g., `https://www.gripinvest.in/portfolio`) for raw-query rows
- Pattern label (e.g., `/external-ui/[uuid]`) for collapse-query rows

Dashboard logic groups by `page_url` regardless. `route_patterns.csv` doubles as
dashboard rendering config (sort_priority for the route drill-down).

### Fixtures captured at production scale

- `Q1_pageviewtiming_response_giweb_raw.json` (13 KB, 30 facets) — the raw query against web app, 24h, with full collapse+exclude WHERE clauses
- `Q1_pageviewtiming_response_giweb_collapse_external-ui.json` (1 KB, 3 device rows) — example collapse-pattern response
- `Q1_pageviewtiming_response.json` (25.8 KB) and other earlier fixtures — pre-Path-C captures, retained for reference but parser locks against the new raw + collapse shapes

## Open questions / next-step verifications (during Phase 1+)

- TTFB values being ~0 — investigate why during dashboard development. May need to switch from `firstByte` to another timing field.
- Service-account user setup for cron — currently using personal User API Key.
- INP values look very small (0.04, 0.088 in seconds) — confirm INP is in milliseconds-as-fraction-of-second vs. some other unit. Multiply by 1000 if so.
