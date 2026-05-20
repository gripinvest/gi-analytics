# Performance Grip — Archive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the daily archive pipeline that pulls hourly Web Vitals from New Relic for two Browser apps (GI Client Static + GI Client Web), idempotently merges them into a per-(app × URL × device × hour × date) CSV, and runs reliably twice-daily via GitHub Actions. The dashboard (Plan 2) ships after this is operational.

**Architecture:** A new project follows the existing multi-project frame: per-project fetch module under `backend/services/integrations/`, project data under `backend/data/`, project workflow under `.github/workflows/`. The fetch module calls a new shared `new_relic.py` (mirrors `metabase.py` shape) for NerdGraph queries, writes per-(app, hour) atomically to `hourly_web_vitals.csv`, and is registered in `refresh.py`'s `REGISTRY` for the standalone CLI + cron entry point.

**Tech Stack:** Python 3.12, httpx, pandas, DuckDB (existing baking pipeline), pytest, GitHub Actions, NerdGraph (NRQL), pip-compile for hash-pinned deps.

**Reference spec:** [`docs/projects/performance-grip/specs/2026-05-20-performance-grip-design.md`](../specs/2026-05-20-performance-grip-design.md). When in doubt, the spec wins.

---

## Pre-flight (do this once, before Task 0.1)

- [ ] Confirm you are in the **`performance-grip-design`** worktree (`pwd` should end with `.claude/worktrees/performance-grip-design`). If you are in any other worktree or the primary checkout, stop and switch.
- [ ] Confirm the worktree branch is `performance-grip-design` (`git branch --show-current`). All commits land here, not on `main`.
- [ ] Confirm `backend/.venv` exists. If not, follow project venv setup. From `MEMORY.md`: backend worktree venv may need symlinking from primary checkout (system py3.14 cannot install duckdb 1.1.0).
- [ ] Skim §4 and §5 of the spec — these define the data layer and cron, which is everything this plan implements.

---

## Phase 0 — Discovery NRQL (HARD GATE before any code)

Per spec §11: no fetch code lands until real NerdGraph response fixtures are committed. This phase is manual investigation against the live NR account, producing fixtures + locked-in facts.

### Task 0.1: Obtain NR Insights Query Key (or service-account User API Key)

**Files:**
- Create: `docs/projects/performance-grip/data-sources.md`

**Per spec §5.4 + §10:** Prefer Insights Query Key (read-only NRQL scope). User API Key fallback only if the NR plan tier doesn't expose Query Keys.

- [ ] **Step 1: Log in to NR UI** for the gripinvest account.
- [ ] **Step 2: Check Insights Query Keys availability**: `User menu → API keys → Insights Query Keys`. If absent, fall back to User API Key.
- [ ] **Step 3: Create the key**. If Query Key: name it `performance-grip-readonly`. If User API Key fallback: create dedicated service-account user `grip-analytics-cron` with read-only NerdGraph custom role first, then make a key for that user.
- [ ] **Step 4: Capture NR account ID and region**. From any dashboard URL: `accountId=12345`. Region: `one.newrelic.com` → US, `one.eu.newrelic.com` → EU.
- [ ] **Step 5: Stash credentials locally (do NOT commit)**

Create `backend/.env` (gitignored) with:
```
NEW_RELIC_QUERY_KEY=<key>
# OR fallback:
# NEW_RELIC_USER_API_KEY=<key>
NEW_RELIC_ACCOUNT_ID=<id>
NEW_RELIC_REGION=US
```
Verify `.env` is gitignored: `git check-ignore backend/.env` should print the path.

- [ ] **Step 6: Create `data-sources.md` skeleton**

```markdown
# Performance Grip — data sources

Captured during Phase 0 discovery. **Update as you learn.**

## New Relic account

- **Account ID:** {filled in step 4}
- **Region:** {US | EU}
- **Key type:** {Insights Query Key | User API Key (fallback)}
- **NerdGraph endpoint:** `https://api.newrelic.com/graphql` (US) or `https://api.eu.newrelic.com/graphql` (EU)

## Apps tracked (v1)

(filled by Task 0.2)

## NRQL query shapes + fixtures

(filled by Tasks 0.3–0.5; fixtures under `backend/tests/fixtures/new_relic/`)

## Verified facts

(filled by Tasks 0.6–0.8)
```

- [ ] **Step 7: Commit**

```bash
cd /Users/purujit/grip/grip-code/grip_analytics/grip-analytics/.claude/worktrees/performance-grip-design
git add docs/projects/performance-grip/data-sources.md
git commit -m "docs(performance-grip): data-sources.md skeleton for Phase 0 discovery"
```

### Task 0.2: Identify NR `appName` canonical values

**Files:**
- Modify: `docs/projects/performance-grip/data-sources.md`

- [ ] **Step 1: Open NR NerdGraph API Explorer**: Apps → API Explorer → NerdGraph.
- [ ] **Step 2: Run app discovery NRQL**:

```graphql
{
  actor {
    account(id: <ACCOUNT_ID>) {
      nrql(query: "SELECT uniques(appName) FROM PageViewTiming SINCE 1 day AGO") {
        results
      }
    }
  }
}
```

- [ ] **Step 3: Capture the response** — list of `appName` strings. We expect two mapping to "static" (pre-login marketing) and "web" (post-login).
- [ ] **Step 4: Record in `data-sources.md`**:

```markdown
## Apps tracked (v1)

| Slug (in our schema) | NR `appName` value | Purpose |
|---|---|---|
| `gi-client-static` | `{exact NR value}` | Pre-login marketing (SEO) |
| `gi-client-web` | `{exact NR value}` | Post-login investing platform |
```

- [ ] **Step 5: Commit**

```bash
git add docs/projects/performance-grip/data-sources.md
git commit -m "docs(performance-grip): NR appName canonical values discovered"
```

### Task 0.3: Capture Q1 fixture (Web Vitals timings)

**Files:**
- Create: `backend/tests/fixtures/new_relic/Q1_pageviewtiming_response.json`
- Modify: `docs/projects/performance-grip/data-sources.md`

- [ ] **Step 1: Run Q1 in NerdGraph Explorer** (against static app, one hour, recent):

```graphql
{
  actor {
    account(id: <ACCOUNT_ID>) {
      nrql(query: "SELECT percentile(largestContentfulPaint, 75, 95) AS lcp, percentile(interactionToNextPaint, 75, 95) AS inp, percentile(cumulativeLayoutShift, 75, 95) AS cls, percentile(firstContentfulPaint, 75, 95) AS fcp, percentile(firstByte, 75, 95) AS ttfb, count(*) AS sample_count FROM PageViewTiming WHERE appName = '<CANONICAL>' AND pageUrl IS NOT NULL AND deviceType IS NOT NULL SINCE 2 hours ago UNTIL 1 hour ago FACET pageUrl, deviceType LIMIT 500") {
        results
        metadata { facets }
      }
    }
  }
}
```

- [ ] **Step 2: If empty, widen window** to `SINCE 2 days ago UNTIL 1 day ago`.
- [ ] **Step 3: Save the JSON to fixture**: copy the entire `data.actor.account.nrql` block to `backend/tests/fixtures/new_relic/Q1_pageviewtiming_response.json`.
- [ ] **Step 4: Document the actual percentile response shape in `data-sources.md`** — record verbatim what NR returned (e.g., `{"lcp": {"75": 2450, "95": 3920}, ...}` or whatever the actual shape is). This locks the parser in Task 2.3.
- [ ] **Step 5: Commit**

```bash
git add backend/tests/fixtures/new_relic/Q1_pageviewtiming_response.json docs/projects/performance-grip/data-sources.md
git commit -m "fixtures(performance-grip): Q1 PageViewTiming NerdGraph response captured"
```

### Task 0.4: Capture Q2 fixture (page-view volume)

**Files:**
- Create: `backend/tests/fixtures/new_relic/Q2_pageview_response.json`

- [ ] **Step 1: Run Q2** in NerdGraph Explorer:

```
SELECT count(*) AS page_views FROM PageView
WHERE appName = '<CANONICAL>' AND pageUrl IS NOT NULL AND deviceType IS NOT NULL
SINCE 2 hours ago UNTIL 1 hour ago
FACET pageUrl, deviceType LIMIT 500
```

- [ ] **Step 2: Save to** `backend/tests/fixtures/new_relic/Q2_pageview_response.json`.
- [ ] **Step 3: Commit**

```bash
git add backend/tests/fixtures/new_relic/Q2_pageview_response.json
git commit -m "fixtures(performance-grip): Q2 PageView NerdGraph response captured"
```

### Task 0.5: Capture Q3 fixture (JS errors) + verify deviceType availability

**Files:**
- Create: `backend/tests/fixtures/new_relic/Q3_javascripterror_response.json`
- Modify: `docs/projects/performance-grip/data-sources.md`

- [ ] **Step 1: Run Q3** (longer window because errors are sparse):

```
SELECT count(*) AS js_errors FROM JavaScriptError
WHERE appName = '<CANONICAL>' AND pageUrl IS NOT NULL
SINCE 1 day ago FACET pageUrl, deviceType LIMIT 500
```

- [ ] **Step 2: Save to** `backend/tests/fixtures/new_relic/Q3_javascripterror_response.json`.
- [ ] **Step 3: Inspect for `deviceType` population** — count buckets with non-null deviceType vs null. Record percent in `data-sources.md`:

```markdown
## JavaScriptError deviceType availability

- Sample: {N} facet buckets from {SINCE} window
- Buckets with non-null `deviceType`: {N} ({pct}%)
- Decision: {join on (pageUrl, deviceType) if >90% populated; else join on pageUrl only and accept device aggregation for JS errors}
```

- [ ] **Step 4: Commit**

```bash
git add backend/tests/fixtures/new_relic/Q3_javascripterror_response.json docs/projects/performance-grip/data-sources.md
git commit -m "fixtures(performance-grip): Q3 JavaScriptError captured; deviceType availability documented"
```

### Task 0.6: Verify INP availability and TTFB field name

**Files:**
- Modify: `docs/projects/performance-grip/data-sources.md`

- [ ] **Step 1: Inspect Q1 fixture for INP values**. If `inp.75` and `inp.95` are null across most facets, the Browser agent may be too old.
- [ ] **Step 2: Run `keyset()` to confirm field names**:

```
SELECT keyset() FROM PageViewTiming WHERE appName = '<CANONICAL>' SINCE 1 day ago LIMIT 10
```

- [ ] **Step 3: Verify TTFB field**. Public docs say `firstByte`; some accounts use `connectionSetupDuration`. Use whatever `keyset()` returns.
- [ ] **Step 4: Document**:

```markdown
## Field name verification

- LCP: `largestContentfulPaint` (confirmed)
- INP: `interactionToNextPaint` — {confirmed populated | null on this account → defer to v1.5 after agent upgrade}
- CLS: `cumulativeLayoutShift`
- FCP: `firstContentfulPaint`
- TTFB: `{firstByte | connectionSetupDuration | other}` — actual confirmed field
```

- [ ] **Step 5: Commit**

```bash
git add docs/projects/performance-grip/data-sources.md
git commit -m "docs(performance-grip): NR field names verified"
```

### Task 0.7: Decide hourly bucketing strategy

**Files:**
- Modify: `docs/projects/performance-grip/data-sources.md`
- Optional: Create: `backend/tests/fixtures/new_relic/Q1_timeseries_response.json`

The choice: 24 per-hour NRQL calls per app vs single `TIMESERIES 1 hour` call.

- [ ] **Step 1: Test TIMESERIES variant**:

```
SELECT percentile(largestContentfulPaint, 75, 95) AS lcp, count(*) AS sample_count
FROM PageViewTiming
WHERE appName = '<CANONICAL>' AND pageUrl IS NOT NULL AND deviceType IS NOT NULL
SINCE 1 day ago WITH TIMEZONE 'Asia/Kolkata'
FACET pageUrl, deviceType
LIMIT 500
TIMESERIES 1 hour
```

- [ ] **Step 2: Inspect response shape** — one row per facet with array of buckets, or one row per `(facet × bucket)`?
- [ ] **Step 3: Verify facet cap with TIMESERIES** — does `LIMIT 500` apply per facet or per `(facet × bucket)`?
- [ ] **Step 4: Decide and document**:

```markdown
## Hourly bucketing strategy

- **Approach chosen:** {per-hour queries | TIMESERIES 1 hour}
- **Reasoning:** {response shape; facet cap behaviour}
- **Estimated call volume per cron run (12h catch-up):**
  - Per-hour: 12 × 3 × 2 = 72 NRQL calls
  - TIMESERIES: 3 × 2 = 6 calls
```

- [ ] **Step 5: Capture TIMESERIES fixture if chosen** to `backend/tests/fixtures/new_relic/Q1_timeseries_response.json`.
- [ ] **Step 6: Commit**

```bash
git add docs/projects/performance-grip/data-sources.md backend/tests/fixtures/new_relic/Q1_timeseries_response.json 2>/dev/null || git add docs/projects/performance-grip/data-sources.md
git commit -m "docs(performance-grip): hourly bucketing strategy decided"
```

### Task 0.8: Verify userAgent queryability for bot filtering

**Files:**
- Modify: `docs/projects/performance-grip/data-sources.md`

- [ ] **Step 1: Try filtering on userAgent**:

```
SELECT count(*) FROM PageViewTiming
WHERE appName = '<CANONICAL>'
  AND userAgent NOT LIKE '%bot%' AND userAgent NOT LIKE '%crawl%'
SINCE 1 day ago
```

- [ ] **Step 2: Compare against unfiltered** count.
- [ ] **Step 3: Document**:

```markdown
## Bot filtering

- `userAgent` queryable on `PageViewTiming`: {yes | no}
- Decision: {NRQL-level filter active in v1 | accept noise in v1, refine in v1.5}
```

- [ ] **Step 4: Commit**

```bash
git add docs/projects/performance-grip/data-sources.md
git commit -m "docs(performance-grip): bot-filtering capability verified"
```

---

## Phase 1 — NewRelic NerdGraph client (`new_relic.py`)

### Task 1.1: Create `new_relic.py` skeleton + region validation

**Files:**
- Create: `backend/services/integrations/new_relic.py`
- Create: `backend/tests/test_new_relic_client.py`

- [ ] **Step 1: Write the failing test**

```python
"""Unit tests for new_relic.py — fixture-driven, no network calls."""
import json
from pathlib import Path
import pytest

from services.integrations.new_relic import NewRelicClient

FIXTURES = Path(__file__).parent / "fixtures" / "new_relic"


def test_client_constructed_with_required_args():
    client = NewRelicClient(api_key="dummy", account_id=12345, region="US")
    assert client.endpoint == "https://api.newrelic.com/graphql"


def test_client_eu_region_uses_eu_endpoint():
    client = NewRelicClient(api_key="dummy", account_id=12345, region="EU")
    assert client.endpoint == "https://api.eu.newrelic.com/graphql"


def test_client_rejects_unknown_region():
    with pytest.raises(ValueError, match="region must be 'US' or 'EU'"):
        NewRelicClient(api_key="x", account_id=1, region="APAC")
```

- [ ] **Step 2: Run** `cd backend && .venv/bin/pytest tests/test_new_relic_client.py -v` — expect ImportError.

- [ ] **Step 3: Write minimal implementation**:

```python
"""New Relic NerdGraph (GraphQL) client.

Mirrors `metabase.py`'s shape — a thin httpx-based wrapper exposing one
method (`nrql`) for project fetch modules. No business logic here.

Auth: Insights Query Key (preferred) or User API Key (fallback). Both sent
in the `Api-Key` header. See spec §5.4.
"""
from __future__ import annotations
import json


class NewRelicClient:
    _ENDPOINTS = {
        "US": "https://api.newrelic.com/graphql",
        "EU": "https://api.eu.newrelic.com/graphql",
    }

    def __init__(self, api_key: str, account_id: int, region: str = "US"):
        if region not in self._ENDPOINTS:
            raise ValueError(f"region must be 'US' or 'EU', got {region!r}")
        self.api_key = api_key
        self.account_id = account_id
        self.region = region
        self.endpoint = self._ENDPOINTS[region]

    def nrql(self, query: str) -> list[dict]:
        """Execute one NRQL query via NerdGraph. Returns the facet rows."""
        raise NotImplementedError("Task 1.2 implements this")
```

- [ ] **Step 4: Run tests** — expect 3 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/services/integrations/new_relic.py backend/tests/test_new_relic_client.py
git commit -m "feat(new_relic): NewRelicClient skeleton with region validation"
```

### Task 1.2: Implement `nrql()` against fixture (happy path)

**Files:**
- Modify: `backend/services/integrations/new_relic.py`
- Modify: `backend/tests/test_new_relic_client.py`

- [ ] **Step 1: Add failing tests**

```python
from unittest.mock import MagicMock, patch


def test_nrql_returns_facet_rows_from_fixture():
    fixture = json.loads((FIXTURES / "Q1_pageviewtiming_response.json").read_text())
    client = NewRelicClient(api_key="x", account_id=12345, region="US")

    mock_response = MagicMock()
    mock_response.json.return_value = {"data": {"actor": {"account": {"nrql": fixture}}}}
    mock_response.status_code = 200
    mock_response.raise_for_status = MagicMock()

    with patch("httpx.Client.post", return_value=mock_response):
        rows = client.nrql("SELECT count(*) FROM PageViewTiming")

    assert len(rows) > 0
    assert isinstance(rows[0], dict)


def test_nrql_sends_correct_graphql_payload():
    client = NewRelicClient(api_key="my-secret-key", account_id=98765, region="US")
    captured = {}

    def capture_post(url, **kwargs):
        captured["url"] = url
        captured["json"] = kwargs.get("json")
        captured["headers"] = kwargs.get("headers", {})
        mock = MagicMock()
        mock.json.return_value = {"data": {"actor": {"account": {"nrql": {"results": []}}}}}
        mock.status_code = 200
        mock.raise_for_status = MagicMock()
        return mock

    with patch("httpx.Client.post", side_effect=capture_post):
        client.nrql("SELECT count(*) FROM PageViewTiming")

    assert captured["url"] == "https://api.newrelic.com/graphql"
    assert captured["headers"]["Api-Key"] == "my-secret-key"
    assert "account(id: 98765)" in captured["json"]["query"]
    assert "SELECT count(*) FROM PageViewTiming" in captured["json"]["query"]
```

- [ ] **Step 2: Run tests** — expect 2 failures with NotImplementedError.

- [ ] **Step 3: Replace `nrql` stub**:

```python
    def nrql(self, query: str) -> list[dict]:
        """Execute one NRQL query via NerdGraph. Returns facet rows.

        The GraphQL wrapper is constant; only the embedded NRQL string varies.
        Auth header `Api-Key` accepts both Query Key and User API Key.
        """
        import httpx

        graphql_query = (
            "{ actor { account(id: %d) { nrql(query: %s) { results } } } }"
            % (self.account_id, json.dumps(query))
        )

        with httpx.Client(timeout=30.0) as http:
            response = http.post(
                self.endpoint,
                headers={"Api-Key": self.api_key, "Content-Type": "application/json"},
                json={"query": graphql_query},
            )
            response.raise_for_status()
            body = response.json()

        return body["data"]["actor"]["account"]["nrql"]["results"]
```

- [ ] **Step 4: Run tests** — expect 5 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/services/integrations/new_relic.py backend/tests/test_new_relic_client.py
git commit -m "feat(new_relic): nrql() implemented and fixture-tested"
```

### Task 1.3: Retry with exponential backoff + jitter

**Files:**
- Modify: `backend/services/integrations/new_relic.py`
- Modify: `backend/tests/test_new_relic_client.py`

Per spec §7: retry 3× with backoff `1s, 4s, 16s` + ±25% jitter, cap at 30s.

- [ ] **Step 1: Add failing tests**

```python
def test_nrql_retries_on_transient_5xx():
    client = NewRelicClient(api_key="x", account_id=1, region="US")
    call_count = [0]

    def flaky_post(*args, **kwargs):
        import httpx
        call_count[0] += 1
        if call_count[0] < 3:
            mock = MagicMock()
            mock.raise_for_status.side_effect = httpx.HTTPStatusError(
                "503", request=MagicMock(), response=MagicMock(status_code=503))
            return mock
        mock = MagicMock()
        mock.json.return_value = {"data": {"actor": {"account": {"nrql": {"results": [{"n": 1}]}}}}}
        mock.status_code = 200
        mock.raise_for_status = MagicMock()
        return mock

    with patch("httpx.Client.post", side_effect=flaky_post):
        with patch("time.sleep"):
            rows = client.nrql("SELECT count(*) FROM PageView")

    assert call_count[0] == 3
    assert rows == [{"n": 1}]


def test_nrql_does_not_retry_on_4xx():
    import httpx
    client = NewRelicClient(api_key="x", account_id=1, region="US")
    call_count = [0]

    def auth_fail(*args, **kwargs):
        call_count[0] += 1
        mock = MagicMock()
        mock.raise_for_status.side_effect = httpx.HTTPStatusError(
            "401", request=MagicMock(), response=MagicMock(status_code=401))
        return mock

    with patch("httpx.Client.post", side_effect=auth_fail):
        with patch("time.sleep"):
            with pytest.raises(httpx.HTTPStatusError):
                client.nrql("SELECT count(*) FROM PageView")

    assert call_count[0] == 1
```

- [ ] **Step 2: Run tests** — expect failures.

- [ ] **Step 3: Replace `nrql()` with retry loop**

Add `import random; import time` at the top, then replace the method:

```python
    def nrql(self, query: str) -> list[dict]:
        """Execute one NRQL query via NerdGraph. Returns facet rows.

        Retries 3× on transient 5xx with backoff + ±25% jitter, capped at 30s.
        4xx errors fail loud, no retry.
        """
        import httpx

        graphql_query = (
            "{ actor { account(id: %d) { nrql(query: %s) { results } } } }"
            % (self.account_id, json.dumps(query))
        )

        backoff_seconds = [1.0, 4.0, 16.0]
        last_exc: Exception | None = None

        with httpx.Client(timeout=30.0) as http:
            for attempt in range(len(backoff_seconds) + 1):
                try:
                    response = http.post(
                        self.endpoint,
                        headers={"Api-Key": self.api_key, "Content-Type": "application/json"},
                        json={"query": graphql_query},
                    )
                    response.raise_for_status()
                    body = response.json()
                    return body["data"]["actor"]["account"]["nrql"]["results"]
                except httpx.HTTPStatusError as e:
                    status = e.response.status_code if e.response else 0
                    if status < 500 or attempt >= len(backoff_seconds):
                        raise
                    last_exc = e
                    base = backoff_seconds[attempt]
                    jitter = random.uniform(-0.25, 0.25) * base
                    time.sleep(min(base + jitter, 30.0))

        raise RuntimeError(f"nrql() retry loop exited unexpectedly: {last_exc}")
```

- [ ] **Step 4: Run tests** — expect 7 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/services/integrations/new_relic.py backend/tests/test_new_relic_client.py
git commit -m "feat(new_relic): exponential backoff with jitter for transient 5xx"
```

### Task 1.4: Defensive Api-Key log scrubbing

**Files:**
- Modify: `backend/services/integrations/new_relic.py`
- Modify: `backend/tests/test_new_relic_client.py`

Per spec §7 + M11.

- [ ] **Step 1: Add failing test**

```python
def test_auth_failure_does_not_leak_api_key():
    import httpx
    client = NewRelicClient(api_key="super-secret-key-12345", account_id=1, region="US")

    def auth_fail(*args, **kwargs):
        mock = MagicMock()
        mock.raise_for_status.side_effect = httpx.HTTPStatusError(
            "401", request=MagicMock(), response=MagicMock(status_code=401))
        return mock

    with patch("httpx.Client.post", side_effect=auth_fail):
        with patch("time.sleep"):
            with pytest.raises(httpx.HTTPStatusError) as exc_info:
                client.nrql("SELECT count(*) FROM PageView")

    assert "super-secret-key-12345" not in str(exc_info.value)
```

- [ ] **Step 2: Run** — likely passes (httpx doesn't leak headers by default). Test pins the behaviour.

- [ ] **Step 3: Add the defensive scrubber helper**

Append to `new_relic.py`:

```python
def _safe_message(exc: BaseException) -> str:
    """Strip Api-Key headers from any exception's string form.

    Use this anywhere `new_relic.py` (or callers) log exception bodies.
    """
    import re
    return re.sub(
        r"Api-Key[:=]\s*[^\s\"'<>]+",
        "Api-Key: <redacted>",
        str(exc),
        flags=re.IGNORECASE,
    )
```

- [ ] **Step 4: Run all tests** — expect 8 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/services/integrations/new_relic.py backend/tests/test_new_relic_client.py
git commit -m "feat(new_relic): defensive Api-Key scrubbing + regression test"
```

---

## Phase 2 — Performance Grip fetch module (`performance_grip.py`)

### Task 2.1: Module skeleton + URL cleanup helper

**Files:**
- Create: `backend/services/integrations/performance_grip.py`
- Create: `backend/tests/test_performance_grip.py`

- [ ] **Step 1: Write failing tests**

```python
"""Unit tests for performance_grip.py."""
import json
from pathlib import Path
import pytest

from services.integrations.performance_grip import clean_url

FIXTURES = Path(__file__).parent / "fixtures" / "new_relic"


class TestCleanUrl:
    def test_strips_query_string(self):
        assert clean_url("/checkout?utm_source=email") == "/checkout"

    def test_strips_fragment(self):
        assert clean_url("/page#section-2") == "/page"

    def test_strips_both(self):
        assert clean_url("/page?ref=foo#section") == "/page"

    def test_strips_trailing_slash(self):
        assert clean_url("/about/") == "/about"

    def test_preserves_root_slash(self):
        assert clean_url("/") == "/"

    def test_preserves_case(self):
        assert clean_url("/Assets/ABC-2024") == "/Assets/ABC-2024"

    def test_handles_full_url(self):
        assert clean_url("https://gripinvest.in/checkout?x=1") == "/checkout"
```

- [ ] **Step 2: Run** — expect ImportError.

- [ ] **Step 3: Implement**:

```python
"""Performance Grip fetch module — daily archive of NR Web Vitals.

Orchestrates per-(app, hour) fetch loop, parses NerdGraph responses,
merges idempotently into hourly_web_vitals.csv.

- Spec: docs/projects/performance-grip/specs/2026-05-20-performance-grip-design.md
- Discovery: docs/projects/performance-grip/data-sources.md
"""
from __future__ import annotations

from urllib.parse import urlparse


def clean_url(raw_url: str) -> str:
    """Normalise a URL for storage at fetch time.

    Rules (spec §4.6):
    1. Strip query string.
    2. Strip fragment.
    3. Trim trailing slash (except root).
    4. Preserve case.
    5. No path collapsing (patterns applied in dashboard layer).
    """
    if "://" in raw_url:
        path = urlparse(raw_url).path
    else:
        path = raw_url.split("?", 1)[0].split("#", 1)[0]

    if path == "":
        return "/"
    if path != "/" and path.endswith("/"):
        path = path.rstrip("/")
    return path
```

- [ ] **Step 4: Run tests** — expect 7 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/services/integrations/performance_grip.py backend/tests/test_performance_grip.py
git commit -m "feat(performance_grip): clean_url helper for fetch-time normalisation"
```

### Task 2.2: Target-window computation

**Files:**
- Modify: `backend/services/integrations/performance_grip.py`
- Modify: `backend/tests/test_performance_grip.py`

- [ ] **Step 1: Add failing tests**

```python
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from services.integrations.performance_grip import target_hours

IST = ZoneInfo("Asia/Kolkata")


class TestTargetHours:
    def test_fresh_start_returns_last_closed_hour(self):
        now = datetime(2026, 5, 20, 14, 30, tzinfo=IST)
        result = target_hours(latest_in_csv=None, now=now, since=None)
        assert result[-1] == (datetime(2026, 5, 20, 13, tzinfo=IST),
                              datetime(2026, 5, 20, 14, tzinfo=IST))

    def test_gap_after_last_csv_row(self):
        latest = datetime(2026, 5, 19, 18, tzinfo=IST)
        now = datetime(2026, 5, 20, 14, 30, tzinfo=IST)
        result = target_hours(latest_in_csv=latest, now=now, since=None)
        # First missing: 19:00 May 19. Last closed: 13:00 May 20. Total = 19.
        assert len(result) == 19
        assert result[0][0] == datetime(2026, 5, 19, 19, tzinfo=IST)
        assert result[-1][0] == datetime(2026, 5, 20, 13, tzinfo=IST)

    def test_since_overrides_latest(self):
        now = datetime(2026, 5, 13, 5, 30, tzinfo=IST)
        since = datetime(2026, 5, 12, 0, tzinfo=IST)
        result = target_hours(latest_in_csv=datetime(2026, 5, 13, 2, tzinfo=IST),
                              now=now, since=since)
        # 24h on May 12 + hours 0-4 on May 13 = 29
        assert len(result) == 29
        assert result[0][0] == datetime(2026, 5, 12, 0, tzinfo=IST)
        assert result[-1][0] == datetime(2026, 5, 13, 4, tzinfo=IST)

    def test_caught_up_returns_empty(self):
        now = datetime(2026, 5, 20, 14, 30, tzinfo=IST)
        latest = datetime(2026, 5, 20, 13, tzinfo=IST)
        assert target_hours(latest_in_csv=latest, now=now, since=None) == []
```

- [ ] **Step 2: Run** — expect ImportError for `target_hours`.

- [ ] **Step 3: Implement**

Add to `performance_grip.py`:

```python
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

IST = ZoneInfo("Asia/Kolkata")


def target_hours(
    latest_in_csv: datetime | None,
    now: datetime,
    since: datetime | None,
) -> list[tuple[datetime, datetime]]:
    """Compute the (start, end) IST hour-buckets to fetch.

    Each entry is [start, start + 1h). The latest *closed* hour is the
    upper bound: at now=14:30, the latest closed hour is [13:00, 14:00).
    """
    # Floor `now` to the hour, then go back one more to get the latest closed hour.
    floor = now.replace(minute=0, second=0, microsecond=0)
    latest_closed = floor - timedelta(hours=1)

    if since is not None:
        first = since
    elif latest_in_csv is not None:
        first = latest_in_csv + timedelta(hours=1)
    else:
        first = latest_closed  # cold start: just the last hour

    if first > latest_closed:
        return []

    result = []
    cursor = first
    while cursor <= latest_closed:
        result.append((cursor, cursor + timedelta(hours=1)))
        cursor += timedelta(hours=1)
    return result
```

- [ ] **Step 4: Run tests** — expect all passing.

- [ ] **Step 5: Commit**

```bash
git add backend/services/integrations/performance_grip.py backend/tests/test_performance_grip.py
git commit -m "feat(performance_grip): target_hours computes fetch windows"
```

### Task 2.3: Q1 response parser — fixture-locked

**Files:**
- Modify: `backend/services/integrations/performance_grip.py`
- Modify: `backend/tests/test_performance_grip.py`

THE critical task — parser locked to actual fixture shape (per spec C1).

- [ ] **Step 1: Add failing tests**

```python
class TestParseQ1:
    def test_extracts_rows_from_real_fixture(self):
        fixture = json.loads((FIXTURES / "Q1_pageviewtiming_response.json").read_text())
        from services.integrations.performance_grip import parse_q1_response

        rows = parse_q1_response(fixture)
        assert len(rows) > 0
        sample = rows[0]
        assert "page_url" in sample
        assert "device" in sample
        for metric in ["lcp", "inp", "cls", "fcp", "ttfb"]:
            assert f"{metric}_p75" in sample
            assert f"{metric}_p95" in sample
        assert "sample_count" in sample

    def test_handles_null_percentiles(self):
        """If NR returns null for INP on older browsers, parsed value is None."""
        synthetic = {
            "results": [{
                "facet": ["/test", "Mobile"],
                "lcp": {"75": 2450, "95": 3920},
                "inp": {"75": None, "95": None},
                "cls": {"75": 0.08, "95": 0.21},
                "fcp": {"75": 1100, "95": 2200},
                "ttfb": {"75": 320, "95": 780},
                "sample_count": 100,
            }]
        }
        from services.integrations.performance_grip import parse_q1_response
        rows = parse_q1_response(synthetic)
        assert rows[0]["inp_p75"] is None
        assert rows[0]["lcp_p75"] == 2450
```

> **Discovery-shape note:** the synthetic case assumes the nested `{"75": v, "95": v}` shape. If the actual fixture from Task 0.3 has a different shape, **update both the synthetic test and the parser together** before continuing. The first test (real fixture) is the ground truth.

- [ ] **Step 2: Run** — expect failures.

- [ ] **Step 3: Implement**

```python
from typing import Any


def parse_q1_response(nrql_response: dict) -> list[dict]:
    """Parse Q1 (Web Vitals timings) NerdGraph response.

    Per spec C1: percentile() returns nested {"75": v, "95": v} objects.
    Verify against captured fixture; adapt parser if actual shape differs.

    Input: {"results": [{"facet": ["/page", "Mobile"], "lcp": {"75": ..., "95": ...}, ...}]}
    Output: list of dicts: page_url, device, {metric}_p75, {metric}_p95, sample_count
    """
    metrics = ["lcp", "inp", "cls", "fcp", "ttfb"]
    out = []
    for entry in nrql_response.get("results", []):
        facet = entry.get("facet", [None, None])
        page_url = clean_url(facet[0]) if facet[0] else None
        device = (facet[1] or "").lower()
        if page_url is None or not device:
            continue
        row: dict[str, Any] = {
            "page_url": page_url,
            "device": device,
            "sample_count": entry.get("sample_count"),
        }
        for m in metrics:
            mobj = entry.get(m) or {}
            row[f"{m}_p75"] = mobj.get("75")
            row[f"{m}_p95"] = mobj.get("95")
        out.append(row)
    return out
```

- [ ] **Step 4: Run tests** — adapt parser to match real fixture if it diverges.

- [ ] **Step 5: Commit**

```bash
git add backend/services/integrations/performance_grip.py backend/tests/test_performance_grip.py
git commit -m "feat(performance_grip): parse_q1_response — fixture-locked"
```

### Task 2.4: Q2 + Q3 response parsers

**Files:**
- Modify: `backend/services/integrations/performance_grip.py`
- Modify: `backend/tests/test_performance_grip.py`

- [ ] **Step 1: Add failing tests**

```python
class TestParseQ2:
    def test_extracts_page_view_counts(self):
        fixture = json.loads((FIXTURES / "Q2_pageview_response.json").read_text())
        from services.integrations.performance_grip import parse_q2_response
        rows = parse_q2_response(fixture)
        assert len(rows) > 0
        assert all("page_url" in r and "device" in r and "page_views" in r for r in rows)
        assert all(isinstance(r["page_views"], int) and r["page_views"] >= 0 for r in rows)


class TestParseQ3:
    def test_extracts_js_error_counts(self):
        fixture = json.loads((FIXTURES / "Q3_javascripterror_response.json").read_text())
        from services.integrations.performance_grip import parse_q3_response
        rows = parse_q3_response(fixture)
        if rows:  # Q3 may legitimately return 0
            assert all("page_url" in r and "js_errors" in r for r in rows)
```

- [ ] **Step 2: Run** — expect failures.

- [ ] **Step 3: Implement**

```python
def parse_q2_response(nrql_response: dict) -> list[dict]:
    """Parse Q2 (PageView count) response."""
    out = []
    for entry in nrql_response.get("results", []):
        facet = entry.get("facet", [None, None])
        page_url = clean_url(facet[0]) if facet[0] else None
        device = (facet[1] or "").lower()
        if page_url is None or not device:
            continue
        out.append({
            "page_url": page_url,
            "device": device,
            "page_views": int(entry.get("page_views") or 0),
        })
    return out


def parse_q3_response(nrql_response: dict) -> list[dict]:
    """Parse Q3 (JavaScriptError count) response.

    M13 GUARDRAIL: only `count` is projected. Do NOT extend Q3 to event-body
    fields (message, stackTrace, customAttributes) — they carry user IDs and
    auth tokens.
    """
    out = []
    for entry in nrql_response.get("results", []):
        facet = entry.get("facet", [None, None])
        page_url = clean_url(facet[0]) if facet[0] else None
        device = (facet[1] or "").lower() if len(facet) > 1 and facet[1] else None
        if page_url is None:
            continue
        out.append({
            "page_url": page_url,
            "device": device,  # may be None — handled in merge_rows
            "js_errors": int(entry.get("js_errors") or 0),
        })
    return out
```

- [ ] **Step 4: Run tests** — expect all passing.

- [ ] **Step 5: Commit**

```bash
git add backend/services/integrations/performance_grip.py backend/tests/test_performance_grip.py
git commit -m "feat(performance_grip): Q2 + Q3 parsers (M13 PII guardrail noted)"
```

### Task 2.5: Merge Q1+Q2+Q3 into row set

**Files:**
- Modify: `backend/services/integrations/performance_grip.py`
- Modify: `backend/tests/test_performance_grip.py`

- [ ] **Step 1: Add failing tests**

```python
class TestMergeRows:
    BASE_Q1 = {
        "page_url": "/a", "device": "mobile",
        "lcp_p75": 2400, "lcp_p95": 3900,
        "inp_p75": 180, "inp_p95": 420,
        "cls_p75": 0.08, "cls_p95": 0.21,
        "fcp_p75": 1100, "fcp_p95": 2200,
        "ttfb_p75": 320, "ttfb_p95": 780,
        "sample_count": 100,
    }

    def test_merge_joins_on_page_and_device(self):
        from services.integrations.performance_grip import merge_rows
        q1 = [self.BASE_Q1]
        q2 = [{"page_url": "/a", "device": "mobile", "page_views": 50000}]
        q3 = [{"page_url": "/a", "device": "mobile", "js_errors": 5}]
        rows = merge_rows(q1, q2, q3, app="gi-client-static",
                          date="2026-05-19", hour=14,
                          fetched_at="2026-05-20T01:30:00+05:30")
        assert len(rows) == 1
        r = rows[0]
        assert r["app"] == "gi-client-static"
        assert r["date"] == "2026-05-19"
        assert r["hour"] == 14
        assert r["page_url"] == "/a"
        assert r["device"] == "mobile"
        assert r["lcp_p75_ms"] == 2400
        assert r["page_views"] == 50000
        assert r["js_errors"] == 5

    def test_no_q3_yields_zero_errors(self):
        from services.integrations.performance_grip import merge_rows
        rows = merge_rows([self.BASE_Q1],
                          [{"page_url": "/a", "device": "mobile", "page_views": 50000}],
                          [], app="x", date="2026-05-19", hour=14, fetched_at="x")
        assert rows[0]["js_errors"] == 0

    def test_drops_rows_with_no_q1(self):
        from services.integrations.performance_grip import merge_rows
        rows = merge_rows([],
                          [{"page_url": "/x", "device": "mobile", "page_views": 1}],
                          [], app="x", date="2026-05-19", hour=14, fetched_at="x")
        assert rows == []
```

- [ ] **Step 2: Run** — expect failures.

- [ ] **Step 3: Implement**

```python
def merge_rows(
    q1: list[dict],
    q2: list[dict],
    q3: list[dict],
    *,
    app: str,
    date: str,
    hour: int,
    fetched_at: str,
) -> list[dict]:
    """Merge per-query rows into canonical schema. Q1 is the spine.

    Q2 left-joined for page_views (missing = 0).
    Q3 left-joined for js_errors (missing = 0). Q3 device may be None;
    falls back to (page_url, *) bucket if exact match misses.
    """
    q2_idx = {(r["page_url"], r["device"]): r["page_views"] for r in q2}
    q3_idx: dict = {}
    for r in q3:
        key = (r["page_url"], r.get("device") or "*")
        q3_idx[key] = q3_idx.get(key, 0) + r["js_errors"]

    out = []
    for q1_row in q1:
        key = (q1_row["page_url"], q1_row["device"])
        merged = {
            "date": date,
            "hour": hour,
            "app": app,
            "page_url": q1_row["page_url"],
            "device": q1_row["device"],
            "page_views": q2_idx.get(key, 0),
            "js_errors": q3_idx.get(key, q3_idx.get((q1_row["page_url"], "*"), 0)),
            "sample_count": q1_row.get("sample_count"),
            "lcp_p75_ms": q1_row.get("lcp_p75"),
            "lcp_p95_ms": q1_row.get("lcp_p95"),
            "inp_p75_ms": q1_row.get("inp_p75"),
            "inp_p95_ms": q1_row.get("inp_p95"),
            "cls_p75":    q1_row.get("cls_p75"),
            "cls_p95":    q1_row.get("cls_p95"),
            "fcp_p75_ms": q1_row.get("fcp_p75"),
            "fcp_p95_ms": q1_row.get("fcp_p95"),
            "ttfb_p75_ms": q1_row.get("ttfb_p75"),
            "ttfb_p95_ms": q1_row.get("ttfb_p95"),
            "fetched_at": fetched_at,
        }
        out.append(merged)
    return out
```

- [ ] **Step 4: Run tests** — expect all passing.

- [ ] **Step 5: Commit**

```bash
git add backend/services/integrations/performance_grip.py backend/tests/test_performance_grip.py
git commit -m "feat(performance_grip): merge_rows joins Q1/Q2/Q3"
```

### Task 2.6: Idempotent per-(app, hour) CSV write

**Files:**
- Modify: `backend/services/integrations/performance_grip.py`
- Modify: `backend/tests/test_performance_grip.py`

- [ ] **Step 1: Add failing tests**

```python
import csv
import tempfile

class TestAppendHourAtomic:
    BASE_ROW = {
        "date": "2026-05-19", "hour": 14, "app": "gi-client-static",
        "page_url": "/a", "device": "mobile",
        "page_views": 100, "js_errors": 1, "sample_count": 100,
        "lcp_p75_ms": 2400, "lcp_p95_ms": 3900,
        "inp_p75_ms": 180, "inp_p95_ms": 420,
        "cls_p75": 0.08, "cls_p95": 0.21,
        "fcp_p75_ms": 1100, "fcp_p95_ms": 2200,
        "ttfb_p75_ms": 320, "ttfb_p95_ms": 780,
        "fetched_at": "2026-05-20T01:00:00+05:30",
    }

    def test_first_write_creates_csv_with_header(self):
        from services.integrations.performance_grip import append_hour_atomic
        with tempfile.TemporaryDirectory() as tmpdir:
            csv_path = Path(tmpdir) / "hourly_web_vitals.csv"
            append_hour_atomic(csv_path, [self.BASE_ROW],
                               app="gi-client-static", date="2026-05-19", hour=14)
            assert csv_path.exists()
            with open(csv_path) as f:
                rows = list(csv.DictReader(f))
            assert len(rows) == 1
            assert rows[0]["page_url"] == "/a"

    def test_rerun_overwrites_not_duplicates(self):
        from services.integrations.performance_grip import append_hour_atomic
        with tempfile.TemporaryDirectory() as tmpdir:
            csv_path = Path(tmpdir) / "h.csv"
            append_hour_atomic(csv_path, [self.BASE_ROW],
                               app="gi-client-static", date="2026-05-19", hour=14)
            updated = {**self.BASE_ROW, "page_views": 200}
            append_hour_atomic(csv_path, [updated],
                               app="gi-client-static", date="2026-05-19", hour=14)
            with open(csv_path) as f:
                rows = list(csv.DictReader(f))
            assert len(rows) == 1
            assert rows[0]["page_views"] == "200"

    def test_different_apps_same_hour_coexist(self):
        from services.integrations.performance_grip import append_hour_atomic
        with tempfile.TemporaryDirectory() as tmpdir:
            csv_path = Path(tmpdir) / "h.csv"
            append_hour_atomic(csv_path, [{**self.BASE_ROW, "app": "gi-client-static"}],
                               app="gi-client-static", date="2026-05-19", hour=14)
            append_hour_atomic(csv_path, [{**self.BASE_ROW, "app": "gi-client-web"}],
                               app="gi-client-web", date="2026-05-19", hour=14)
            with open(csv_path) as f:
                rows = list(csv.DictReader(f))
            assert len(rows) == 2
            assert {r["app"] for r in rows} == {"gi-client-static", "gi-client-web"}
```

- [ ] **Step 2: Run** — expect ImportError.

- [ ] **Step 3: Implement**

```python
import csv as _csv
import os

CSV_COLUMNS = [
    "date", "hour", "app", "page_url", "device",
    "page_views", "js_errors", "sample_count",
    "lcp_p75_ms", "lcp_p95_ms",
    "inp_p75_ms", "inp_p95_ms",
    "cls_p75", "cls_p95",
    "fcp_p75_ms", "fcp_p95_ms",
    "ttfb_p75_ms", "ttfb_p95_ms",
    "fetched_at",
]


def append_hour_atomic(
    csv_path: Path,
    new_rows: list[dict],
    *,
    app: str,
    date: str,
    hour: int,
) -> None:
    """Atomically replace any existing rows for (app, date, hour) and append new ones.

    Algorithm: read existing → filter out (app, date, hour) matches → append
    new → write to .tmp → atomic rename. Crash leaves CSV intact; partial
    .tmp is discarded.
    """
    existing: list[dict] = []
    if csv_path.exists():
        with open(csv_path, newline="") as f:
            existing = list(_csv.DictReader(f))

    filtered = [
        r for r in existing
        if not (r.get("app") == app and r.get("date") == date and str(r.get("hour")) == str(hour))
    ]

    combined = filtered + [{k: row.get(k, "") for k in CSV_COLUMNS} for row in new_rows]
    combined.sort(key=lambda r: (r["date"], int(r["hour"]) if r["hour"] != "" else 0,
                                  r["app"], r["page_url"], r["device"]))

    tmp = csv_path.with_suffix(".csv.tmp")
    tmp.parent.mkdir(parents=True, exist_ok=True)
    with open(tmp, "w", newline="") as f:
        writer = _csv.DictWriter(f, fieldnames=CSV_COLUMNS)
        writer.writeheader()
        for row in combined:
            writer.writerow(row)
    os.replace(tmp, csv_path)
```

- [ ] **Step 4: Run tests** — expect all passing.

- [ ] **Step 5: Commit**

```bash
git add backend/services/integrations/performance_grip.py backend/tests/test_performance_grip.py
git commit -m "feat(performance_grip): append_hour_atomic — idempotent per-(app, hour)"
```

### Task 2.7: `latest_in_csv` helper

**Files:**
- Modify: `backend/services/integrations/performance_grip.py`
- Modify: `backend/tests/test_performance_grip.py`

- [ ] **Step 1: Add failing tests**

```python
class TestLatestInCsv:
    def test_missing_csv_returns_none(self):
        from services.integrations.performance_grip import latest_in_csv
        with tempfile.TemporaryDirectory() as tmpdir:
            assert latest_in_csv(Path(tmpdir) / "missing.csv", app="x") is None

    def test_returns_max_for_app(self):
        from services.integrations.performance_grip import (
            latest_in_csv, append_hour_atomic
        )
        with tempfile.TemporaryDirectory() as tmpdir:
            csv_path = Path(tmpdir) / "h.csv"
            base = TestAppendHourAtomic.BASE_ROW
            for h in (10, 11, 13):
                append_hour_atomic(csv_path,
                                   [{**base, "date": "2026-05-19", "hour": h,
                                     "app": "gi-client-static"}],
                                   app="gi-client-static", date="2026-05-19", hour=h)
            result = latest_in_csv(csv_path, app="gi-client-static")
            assert result == datetime(2026, 5, 19, 13, tzinfo=IST)
```

- [ ] **Step 2: Run** — expect failure.

- [ ] **Step 3: Implement**

```python
def latest_in_csv(csv_path: Path, app: str) -> datetime | None:
    """Return the latest (date, hour) for the given app, as an IST datetime."""
    if not csv_path.exists():
        return None
    latest: datetime | None = None
    with open(csv_path, newline="") as f:
        for row in _csv.DictReader(f):
            if row.get("app") != app:
                continue
            try:
                dt = datetime.strptime(row["date"], "%Y-%m-%d").replace(
                    hour=int(row["hour"]), tzinfo=IST
                )
            except (ValueError, KeyError):
                continue
            if latest is None or dt > latest:
                latest = dt
    return latest
```

- [ ] **Step 4: Run tests** — expect passing.

- [ ] **Step 5: Commit**

```bash
git add backend/services/integrations/performance_grip.py backend/tests/test_performance_grip.py
git commit -m "feat(performance_grip): latest_in_csv per-app checkpoint"
```

### Task 2.8: `--since` input validation

**Files:**
- Modify: `backend/services/integrations/performance_grip.py`
- Modify: `backend/tests/test_performance_grip.py`

Per spec H3.

- [ ] **Step 1: Add failing tests**

```python
class TestValidateSince:
    def test_valid_within_window(self):
        from services.integrations.performance_grip import validate_since
        now = datetime(2026, 5, 20, 14, tzinfo=IST)
        assert validate_since("2026-05-16", now=now) == datetime(2026, 5, 16, 0, tzinfo=IST)

    def test_malformed_raises(self):
        from services.integrations.performance_grip import validate_since
        now = datetime(2026, 5, 20, 14, tzinfo=IST)
        with pytest.raises(ValueError, match="YYYY-MM-DD"):
            validate_since("not-a-date", now=now)
        with pytest.raises(ValueError, match="YYYY-MM-DD"):
            validate_since("2026-13-99", now=now)

    def test_future_raises(self):
        from services.integrations.performance_grip import validate_since
        now = datetime(2026, 5, 20, 14, tzinfo=IST)
        with pytest.raises(ValueError, match="future"):
            validate_since("2026-05-25", now=now)

    def test_outside_retention_raises(self):
        from services.integrations.performance_grip import validate_since
        now = datetime(2026, 5, 20, 14, tzinfo=IST)
        with pytest.raises(ValueError, match="retention"):
            validate_since("2026-05-11", now=now)  # 9 days ago

    def test_empty_returns_none(self):
        from services.integrations.performance_grip import validate_since
        now = datetime(2026, 5, 20, 14, tzinfo=IST)
        assert validate_since("", now=now) is None
        assert validate_since(None, now=now) is None
```

- [ ] **Step 2: Run** — expect failures.

- [ ] **Step 3: Implement**

```python
import re

_SINCE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def validate_since(value: str | None, *, now: datetime) -> datetime | None:
    """Validate the --since input. Returns IST midnight datetime or None.

    Rejects: malformed, future, or older than 8 days (NR retention).
    """
    if not value:
        return None
    if not _SINCE_RE.match(value):
        raise ValueError(f"--since must be YYYY-MM-DD, got {value!r}")
    try:
        parsed = datetime.strptime(value, "%Y-%m-%d").replace(tzinfo=IST)
    except ValueError as e:
        raise ValueError(f"--since must be YYYY-MM-DD: {e}")
    if parsed.date() > now.date():
        raise ValueError(f"--since cannot be in the future ({value} > {now.date()})")
    if (now - parsed).days > 8:
        raise ValueError(
            f"--since {value} is outside NR's 8-day retention window; data is gone."
        )
    return parsed
```

- [ ] **Step 4: Run tests** — expect passing.

- [ ] **Step 5: Commit**

```bash
git add backend/services/integrations/performance_grip.py backend/tests/test_performance_grip.py
git commit -m "feat(performance_grip): validate_since rejects malformed/future/out-of-window"
```

### Task 2.9: Facet-cap probe (C2)

**Files:**
- Modify: `backend/services/integrations/performance_grip.py`
- Modify: `backend/tests/test_performance_grip.py`

- [ ] **Step 1: Add failing tests**

```python
class TestFacetCap:
    def test_below_threshold_returns_ok(self):
        from services.integrations.performance_grip import check_facet_cap
        check_facet_cap(unique_count=300, app="x", hour="2026-05-19 14")

    def test_at_or_above_threshold_raises(self):
        from services.integrations.performance_grip import (
            check_facet_cap, FacetCapExceeded
        )
        with pytest.raises(FacetCapExceeded, match="facet cap"):
            check_facet_cap(unique_count=1900, app="x", hour="2026-05-19 14")
        with pytest.raises(FacetCapExceeded):
            check_facet_cap(unique_count=2000, app="x", hour="2026-05-19 14")
```

- [ ] **Step 2: Run** — expect failures.

- [ ] **Step 3: Implement**

```python
class FacetCapExceeded(RuntimeError):
    """uniqueCount(pageUrl) too close to NerdGraph's 2000-facet cap (spec C2)."""


def check_facet_cap(unique_count: int, *, app: str, hour: str) -> None:
    if unique_count >= 1900:
        raise FacetCapExceeded(
            f"{app} hour {hour}: uniqueCount(pageUrl) = {unique_count} — "
            f"approaching NerdGraph's facet cap of 2000. Likely truncating long tail."
        )
```

- [ ] **Step 4: Run tests** — expect passing.

- [ ] **Step 5: Commit**

```bash
git add backend/services/integrations/performance_grip.py backend/tests/test_performance_grip.py
git commit -m "feat(performance_grip): facet-cap probe (C2 mitigation)"
```

### Task 2.10: Orchestrator `run()` + REGISTRY registration

**Files:**
- Modify: `backend/services/integrations/performance_grip.py`
- Modify: `backend/services/integrations/refresh.py`
- Modify: `backend/tests/test_performance_grip.py`

- [ ] **Step 1: Inspect refresh.py**

```bash
cat backend/services/integrations/refresh.py
```

Note `REGISTRY` shape and `main()` structure.

- [ ] **Step 2: Add integration test for `run()`**

```python
class TestRunOrchestrator:
    def test_run_returns_status_log_refreshed_at(self):
        from services.integrations.performance_grip import run
        q1_fixture = json.loads((FIXTURES / "Q1_pageviewtiming_response.json").read_text())
        q2_fixture = json.loads((FIXTURES / "Q2_pageview_response.json").read_text())
        q3_fixture = json.loads((FIXTURES / "Q3_javascripterror_response.json").read_text())

        class MockClient:
            def nrql(self, query: str):
                if "uniqueCount" in query:
                    return [{"uniqueCount": 100}]
                if "PageViewTiming" in query:
                    return q1_fixture["results"]
                if "PageView" in query:
                    return q2_fixture["results"]
                if "JavaScriptError" in query:
                    return q3_fixture["results"]
                return []

        with tempfile.TemporaryDirectory() as tmpdir:
            data_dir = Path(tmpdir)
            result = run(client=MockClient(), data_dir=data_dir,
                         now=datetime(2026, 5, 20, 14, 30, tzinfo=IST),
                         since=None)
            assert result["status"] in ("ok", "partial")
            assert isinstance(result["log"], list)
            assert "refreshed_at" in result
            assert (data_dir / "hourly_web_vitals.csv").exists()
```

- [ ] **Step 3: Run** — expect ImportError.

- [ ] **Step 4: Implement `run()`**

Append to `performance_grip.py`:

```python
APP_CONFIG = [
    # (canonical slug, NR appName) — REPLACE with values from Task 0.2.
    ("gi-client-static", "GI Client Static"),
    ("gi-client-web",   "GI Client Web"),
]


def _nrql_q1(nr_app: str, since: datetime, until: datetime) -> str:
    return (
        "SELECT percentile(largestContentfulPaint, 75, 95) AS lcp, "
        "percentile(interactionToNextPaint,  75, 95) AS inp, "
        "percentile(cumulativeLayoutShift,   75, 95) AS cls, "
        "percentile(firstContentfulPaint,    75, 95) AS fcp, "
        "percentile(firstByte,               75, 95) AS ttfb, "
        "count(*) AS sample_count "
        "FROM PageViewTiming "
        f"WHERE appName = '{nr_app}' "
        "AND pageUrl IS NOT NULL AND deviceType IS NOT NULL "
        f"SINCE '{since.strftime('%Y-%m-%d %H:%M:%S')}' "
        f"UNTIL '{until.strftime('%Y-%m-%d %H:%M:%S')}' "
        "WITH TIMEZONE 'Asia/Kolkata' "
        "FACET pageUrl, deviceType LIMIT 500"
    )


def _nrql_q2(nr_app: str, since: datetime, until: datetime) -> str:
    return (
        "SELECT count(*) AS page_views FROM PageView "
        f"WHERE appName = '{nr_app}' "
        "AND pageUrl IS NOT NULL AND deviceType IS NOT NULL "
        f"SINCE '{since.strftime('%Y-%m-%d %H:%M:%S')}' "
        f"UNTIL '{until.strftime('%Y-%m-%d %H:%M:%S')}' "
        "WITH TIMEZONE 'Asia/Kolkata' "
        "FACET pageUrl, deviceType LIMIT 500"
    )


def _nrql_q3(nr_app: str, since: datetime, until: datetime) -> str:
    # M13 PII GUARDRAIL: never extend to message/stackTrace/customAttributes.
    return (
        "SELECT count(*) AS js_errors FROM JavaScriptError "
        f"WHERE appName = '{nr_app}' "
        "AND pageUrl IS NOT NULL "
        f"SINCE '{since.strftime('%Y-%m-%d %H:%M:%S')}' "
        f"UNTIL '{until.strftime('%Y-%m-%d %H:%M:%S')}' "
        "WITH TIMEZONE 'Asia/Kolkata' "
        "FACET pageUrl, deviceType LIMIT 500"
    )


def _nrql_probe(nr_app: str, since: datetime, until: datetime) -> str:
    return (
        "SELECT uniqueCount(pageUrl) FROM PageViewTiming "
        f"WHERE appName = '{nr_app}' AND pageUrl IS NOT NULL "
        f"SINCE '{since.strftime('%Y-%m-%d %H:%M:%S')}' "
        f"UNTIL '{until.strftime('%Y-%m-%d %H:%M:%S')}' "
        "WITH TIMEZONE 'Asia/Kolkata'"
    )


def run(
    client,
    data_dir: Path,
    *,
    now: datetime | None = None,
    since: datetime | None = None,
) -> dict:
    """Orchestrate per-(app, hour) fetch loop. Per spec §4.4."""
    now = now or datetime.now(IST)
    csv_path = Path(data_dir) / "hourly_web_vitals.csv"
    csv_path.parent.mkdir(parents=True, exist_ok=True)

    log_lines: list[str] = []
    successes = 0
    failures = 0

    for app_slug, nr_app in APP_CONFIG:
        last = latest_in_csv(csv_path, app=app_slug)
        windows = target_hours(latest_in_csv=last, now=now, since=since)
        log_lines.append(f"[{app_slug}] {len(windows)} hour-windows to fetch")

        for win_start, win_end in windows:
            try:
                probe = client.nrql(_nrql_probe(nr_app, win_start, win_end))
                unique_count = probe[0].get("uniqueCount", 0) if probe else 0
                check_facet_cap(unique_count, app=app_slug, hour=win_start.isoformat())

                q1_raw = client.nrql(_nrql_q1(nr_app, win_start, win_end))
                q2_raw = client.nrql(_nrql_q2(nr_app, win_start, win_end))
                q3_raw = client.nrql(_nrql_q3(nr_app, win_start, win_end))

                q1 = parse_q1_response({"results": q1_raw})
                q2 = parse_q2_response({"results": q2_raw})
                q3 = parse_q3_response({"results": q3_raw})

                if not q1 or not q2:
                    log_lines.append(
                        f"[{app_slug}] EMPTY {win_start.isoformat()}: Q1={len(q1)} Q2={len(q2)}"
                    )
                    failures += 1
                    continue

                merged = merge_rows(
                    q1, q2, q3,
                    app=app_slug,
                    date=win_start.strftime("%Y-%m-%d"),
                    hour=win_start.hour,
                    fetched_at=datetime.now(IST).isoformat(),
                )
                append_hour_atomic(
                    csv_path, merged,
                    app=app_slug,
                    date=win_start.strftime("%Y-%m-%d"),
                    hour=win_start.hour,
                )
                successes += 1
                log_lines.append(
                    f"[{app_slug}] {win_start.isoformat()}: {len(merged)} rows committed"
                )
            except Exception as e:
                failures += 1
                log_lines.append(
                    f"[{app_slug}] FAILED {win_start.isoformat()}: {type(e).__name__}: {e}"
                )

    status = "ok" if failures == 0 else ("partial" if successes > 0 else "fail")
    return {
        "status": status,
        "log": log_lines,
        "refreshed_at": datetime.now(IST).isoformat(),
    }
```

- [ ] **Step 5: Replace `APP_CONFIG` placeholders** with the canonical NR appName values from Task 0.2.

- [ ] **Step 6: Register in refresh.py**

Edit `backend/services/integrations/refresh.py`:

```python
# Change:
from . import asset_search, grip_connect
# To:
from . import asset_search, grip_connect, performance_grip
```

```python
# Change REGISTRY to:
REGISTRY = {
    "grip_connect": grip_connect.run,
    "asset_search": asset_search.run,
    "performance_grip": performance_grip.run,
}
```

- [ ] **Step 7: Add the performance_grip CLI branch in refresh.py's `main()`**

Insert this block just after `argv` parsing and before the existing Metabase client setup:

```python
    if project_id == "performance_grip":
        from .new_relic import NewRelicClient
        from .performance_grip import validate_since
        from datetime import datetime
        from zoneinfo import ZoneInfo

        api_key = os.getenv("NEW_RELIC_QUERY_KEY") or os.getenv("NEW_RELIC_USER_API_KEY")
        account_id = os.getenv("NEW_RELIC_ACCOUNT_ID")
        region = os.getenv("NEW_RELIC_REGION", "US")
        if not api_key or not account_id:
            print(
                "ERROR: set NEW_RELIC_QUERY_KEY (preferred) or NEW_RELIC_USER_API_KEY, "
                "plus NEW_RELIC_ACCOUNT_ID",
                file=sys.stderr,
            )
            return 1

        client = NewRelicClient(
            api_key=api_key, account_id=int(account_id), region=region
        )
        since_dt = validate_since(
            os.getenv("SINCE", "").strip(),
            now=datetime.now(ZoneInfo("Asia/Kolkata")),
        )

        data_dir = Path(os.getenv("DATA_DIR", "./data")) / "performance-grip"
        result = performance_grip.run(client, data_dir, since=since_dt)
        print("\n".join(result["log"]))
        print(f"Done ({result['status']}) — {result['refreshed_at']}")
        return 0 if result["status"] in ("ok", "partial") else 1
```

- [ ] **Step 8: Run all tests**

```bash
cd backend
.venv/bin/pytest tests/test_performance_grip.py tests/test_new_relic_client.py -v
```

Expected: all passing.

- [ ] **Step 9: Commit**

```bash
git add backend/services/integrations/performance_grip.py backend/services/integrations/refresh.py backend/tests/test_performance_grip.py
git commit -m "feat(performance_grip): run() orchestrator + REGISTRY + CLI wiring"
```

---

## Phase 3 — Project metadata + config

### Task 3.1: `project.json`

**Files:**
- Create: `backend/data/performance-grip/project.json`

- [ ] **Step 1: Write the file**

```json
{
  "name": "Performance Grip",
  "description": "Leadership-facing weekly performance hygiene dashboard, backed by a daily archive of New Relic Web Vitals data that outlives NR's 8-day retention window. v1: 2 web Browser apps (gi-client-static, gi-client-web); hourly storage; Editorial dashboard.",
  "status": "active",
  "tags": ["performance", "web-vitals", "leadership-review", "hourly-archive"],
  "updated_at": "2026-05-20",
  "dashboard_component": "PerformanceGripEditorial",
  "refreshable": true,
  "owner": "Puru",
  "chat_context": "Performance Grip archives hourly Web Vitals (LCP, INP, CLS, FCP, TTFB at p75 and p95) plus page-view counts and JS error counts, from New Relic Browser, for two apps: gi-client-static (pre-login marketing) and gi-client-web (post-login investing platform). Hourly grain because peak-hour patterns matter for an investing platform. Per (date, hour, app, page_url, device). See docs/projects/performance-grip/ for spec, data sources, and roadmap."
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/data/performance-grip/project.json
git commit -m "feat(performance-grip): project.json registration"
```

### Task 3.2: `route_patterns.csv` skeleton

**Files:**
- Create: `backend/data/performance-grip/route_patterns.csv`

- [ ] **Step 1: Write the file**

```csv
pattern_regex,label,sort_priority
^/$,Home,1
^/login$,Login,2
^/signup$,Signup,3
^/checkout(/|$),Checkout,10
^/order/[^/]+/?$,Order detail,11
^/assets(/|$),Assets listing,20
^/assets/[^/]+/?$,Asset detail,21
^/portfolio(/|$),Portfolio,30
^/kyc(/|$),KYC,40
^/profile(/|$),Profile,50
^/about,About,80
^/contact,Contact,81
```

Starting skeleton; refined in v1.5 from observed week-1 URLs.

- [ ] **Step 2: Commit**

```bash
git add backend/data/performance-grip/route_patterns.csv
git commit -m "feat(performance-grip): route_patterns.csv skeleton"
```

### Task 3.3: `roadmap.md`

**Files:**
- Create: `docs/projects/performance-grip/roadmap.md`

- [ ] **Step 1: Write the roadmap**

```markdown
# Performance Grip — roadmap

## v1 (this plan + Plan 2 dashboard)

- [x] Spec authored, 8-pass reviewed.
- [ ] Phase 0 discovery — fixtures, NR app names, response shapes, bucketing.
- [ ] Phase 1: NewRelicClient.
- [ ] Phase 2: performance_grip.py fetch.
- [ ] Phase 3: metadata + route_patterns.csv + docs.
- [ ] Phase 4: pip --require-hashes setup.
- [ ] Phase 5: GitHub workflow (twice-daily, concurrency-locked).
- [ ] Phase 6: First production backfill + verification.
- [ ] **Plan 2 (separate):** Editorial dashboard.

## v1.5 (after ~30 days of operation)

- [ ] Refine route_patterns.csv from observed traffic.
- [ ] Classic dashboard alongside Editorial.
- [ ] Slack-on-failure alerts (trigger: first real miss).
- [ ] Cross-app status pills in hero.
- [ ] Print stylesheet / `?print=1` route.
- [ ] 6th metric card (JS errors per 1K page views) — if leadership asks.

## v2

- [ ] Mobile app metrics (separate spec).
- [ ] Cross-app comparison charts.
- [ ] Date-range `[ 30d | 90d ]` formal toggle.
- [ ] PDF / CSV export.
- [ ] Threshold-breach alerts.

## v3+

- [ ] Editorial prose with deploy-correlation context.
- [ ] Causal attribution (regressions ↔ deploys).
- [ ] Hourly drill-down view at the UI layer.

See spec §10 (open questions) and §12 (decisions log).
```

- [ ] **Step 2: Commit**

```bash
git add docs/projects/performance-grip/roadmap.md
git commit -m "docs(performance-grip): roadmap.md"
```

### Task 3.4: `session-log.md`

**Files:**
- Create: `docs/projects/performance-grip/session-log.md`

- [ ] **Step 1: Write the initial entry**

```markdown
# Performance Grip — session log

Append new dated entries at the top each session.

## 2026-05-20 — Brainstorming + plan authoring (Session 1)

**Where we stood at session end:**

- Spec authored: [`specs/2026-05-20-performance-grip-design.md`](./specs/2026-05-20-performance-grip-design.md).
- 8-pass review: [`specs/2026-05-20-performance-grip-review-findings.md`](./specs/2026-05-20-performance-grip-review-findings.md).
- Decisions: K1 (Slack deferred to v1.5), K2 (raw URL PII risk accepted in private repo), K3 (hourly + twice-daily cron), Q1 (NR alternatives priced).
- Spec hardened: all 7 CRITICAL findings applied, most HIGHs, 6 high-value MEDIUMs.
- Plan 1 (Archive): [`plans/2026-05-20-performance-grip-archive-plan.md`](./plans/2026-05-20-performance-grip-archive-plan.md).
- **Plan 2 (Dashboard) not yet written** — wait for Plan 1 to be operational + ~7 days of real data.

**Pick up next:**

Phase 0 of the archive plan: manual NRQL discovery against live NR.
**Do not start Phase 1 until Phase 0 fixtures are committed.** (Spec §11 hard gate.)
```

- [ ] **Step 2: Commit**

```bash
git add docs/projects/performance-grip/session-log.md
git commit -m "docs(performance-grip): session-log.md initial entry"
```

---

## Phase 4 — pip dependency hashing (H7)

### Task 4.1: Inspect current deps + install pip-tools

**Files:**
- Read-only

- [ ] **Step 1: View current `backend/requirements.txt`**: `cat backend/requirements.txt`. Note top-level deps vs transitive.
- [ ] **Step 2: Install pip-tools**: `backend/.venv/bin/pip install pip-tools`.

### Task 4.2: Create `requirements.in` + generate `requirements.lock`

**Files:**
- Create: `backend/requirements.in`
- Create: `backend/requirements.lock`

- [ ] **Step 1: Author `requirements.in`** with only top-level deps (illustrative — adapt to actual):

```
fastapi
uvicorn
duckdb
pandas
httpx
python-dotenv
pytest
```

- [ ] **Step 2: Generate the lock**:

```bash
cd backend
.venv/bin/pip-compile --generate-hashes requirements.in -o requirements.lock
```

Verify the output has `--hash=sha256:...` lines.

- [ ] **Step 3: Verify install in a fresh venv**:

```bash
python3.12 -m venv /tmp/perfgrip-venv-test
/tmp/perfgrip-venv-test/bin/pip install --require-hashes -r requirements.lock
rm -rf /tmp/perfgrip-venv-test
```

- [ ] **Step 4: Commit**

```bash
git add backend/requirements.in backend/requirements.lock
git commit -m "build(backend): pip-compile workflow + hash-pinned requirements.lock"
```

### Task 4.3: Add Dependabot config

**Files:**
- Create or modify: `.github/dependabot.yml`

- [ ] **Step 1: Check existing**: `cat .github/dependabot.yml 2>/dev/null || echo "none"`.
- [ ] **Step 2: Author/extend**:

```yaml
version: 2
updates:
  - package-ecosystem: "pip"
    directory: "/backend"
    schedule:
      interval: "weekly"
    open-pull-requests-limit: 5
  - package-ecosystem: "github-actions"
    directory: "/"
    schedule:
      interval: "weekly"
```

- [ ] **Step 3: Commit**

```bash
git add .github/dependabot.yml
git commit -m "build: Dependabot config for pip + github-actions"
```

---

## Phase 5 — GitHub workflow

### Task 5.1: Author the workflow file

**Files:**
- Create: `.github/workflows/refresh-performance-grip.yml`

- [ ] **Step 1: Reference a sibling for patterns**: `cat .github/workflows/refresh-grip-connect.yml`.

- [ ] **Step 2: Look up current SHAs for pinned actions**:

```bash
gh api repos/actions/checkout/git/ref/tags/v4.1.7 --jq '.object.sha' 2>/dev/null \
  || echo "use GitHub UI: github.com/actions/checkout/releases/tag/v4.1.7"
gh api repos/actions/setup-python/git/ref/tags/v5.1.0 --jq '.object.sha' 2>/dev/null \
  || echo "use GitHub UI"
```

- [ ] **Step 3: Write the workflow**:

```yaml
name: Refresh Performance Grip data

# Daily archive of NR Web Vitals (gi-client-static, gi-client-web). Twice-daily
# because NR's 8-day retention makes missed days unrecoverable.
# Spec: docs/projects/performance-grip/specs/2026-05-20-performance-grip-design.md

on:
  schedule:
    - cron: "30 19 * * *"   # 01:00 IST — previous day complete
    - cron: "30  7 * * *"   # 13:00 IST — intra-day + drift safety
  workflow_dispatch:
    inputs:
      since:
        description: "Backfill from date (YYYY-MM-DD). Omit for normal fetch."
        required: false
        type: string

concurrency:
  group: refresh-performance-grip
  cancel-in-progress: false

permissions:
  contents: write

jobs:
  refresh:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    env:
      NEW_RELIC_QUERY_KEY:    ${{ secrets.NEW_RELIC_QUERY_KEY }}
      NEW_RELIC_USER_API_KEY: ${{ secrets.NEW_RELIC_USER_API_KEY }}
      NEW_RELIC_ACCOUNT_ID:   ${{ vars.NEW_RELIC_ACCOUNT_ID }}
      NEW_RELIC_REGION:       US
      SINCE:                  ${{ inputs.since }}
    steps:
      - uses: actions/checkout@<REPLACE-WITH-SHA>     # actions/checkout v4.1.7
      - uses: actions/setup-python@<REPLACE-WITH-SHA> # actions/setup-python v5.1.0
        with:
          python-version: "3.12"
      - name: Install deps (hash-verified)
        run: pip install --require-hashes -r backend/requirements.lock
      - name: Run refresh
        working-directory: backend
        run: python -m services.integrations.refresh performance_grip
      - name: Commit refreshed data if changed
        if: github.ref == 'refs/heads/main'
        run: |
          git config user.name  "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git pull --rebase
          git add backend/data/performance-grip/
          git diff --staged --quiet || git commit -m "chore: refresh Performance Grip data"
          git push
```

Replace `<REPLACE-WITH-SHA>` with actual values from Step 2.

- [ ] **Step 4: Validate YAML**:

```bash
python3.12 -c "import yaml; yaml.safe_load(open('.github/workflows/refresh-performance-grip.yml'))"
```

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/refresh-performance-grip.yml
git commit -m "ci(performance-grip): twice-daily cron, concurrency-locked, SHA-pinned actions"
```

### Task 5.2: Configure secrets and variables (GitHub UI, manual)

**Files:**
- None — manual GitHub UI

- [ ] **Step 1: Settings → Secrets and variables → Actions, add secrets**:

| Name | Value |
|---|---|
| `NEW_RELIC_QUERY_KEY` | from Task 0.1 (if Insights Query Key available) |
| `NEW_RELIC_USER_API_KEY` | fallback only |

- [ ] **Step 2: Add variable** (not secret):

| Name | Value |
|---|---|
| `NEW_RELIC_ACCOUNT_ID` | numeric account ID from Task 0.1 |

- [ ] **Step 3: Trigger a no-op workflow_dispatch**: Actions → Refresh Performance Grip → Run workflow. Empty `since`. Watch the run.

Expected: runner installs deps, `python -m services.integrations.refresh performance_grip` runs, and either reports "N hour-windows to fetch" with rows committed, or surfaces a clear NR-side error (confirms reachability).

- [ ] **Step 4: Inspect run log** for structured `[gi-client-static]` and `[gi-client-web]` lines.

---

## Phase 6 — First production backfill + verification

### Task 6.1: Initial 7-day backfill

**Files:**
- Generated: `backend/data/performance-grip/hourly_web_vitals.csv`

- [ ] **Step 1: Trigger workflow_dispatch** with `since=` set to today − 7 days (YYYY-MM-DD).
- [ ] **Step 2: Watch the run** — expect ~5 min. Up to 7 days × 24 × 2 × 3 = ~1000 NRQL calls (or ~6 with TIMESERIES per Task 0.7).
- [ ] **Step 3: Pull and inspect**:

```bash
git pull
wc -l backend/data/performance-grip/hourly_web_vitals.csv
```

Expected: tens of thousands of rows.

- [ ] **Step 4: Spot-check contents**:

```bash
head -3 backend/data/performance-grip/hourly_web_vitals.csv
tail -3 backend/data/performance-grip/hourly_web_vitals.csv
```

Verify header matches `CSV_COLUMNS`; recent rows have plausible values (LCP ~1000–5000ms).

### Task 6.2: Spot-check against NR native dashboard

**Files:**
- None — verification

- [ ] **Step 1: In NR UI**, open Browser → gi-client-static → Web Vitals → yesterday.
- [ ] **Step 2: Note NR's p75 LCP for the day** (e.g., 2.4s).
- [ ] **Step 3: Compute the same from our CSV**:

```python
# In python with the venv active:
import pandas as pd
df = pd.read_csv("backend/data/performance-grip/hourly_web_vitals.csv")
df = df[(df["app"] == "gi-client-static") & (df["date"] == "2026-05-19")]
total = df["page_views"].sum()
weighted_p75 = (df["lcp_p75_ms"] * df["page_views"]).sum() / total
print(f"Our weighted p75 LCP: {weighted_p75:.0f}ms")
```

- [ ] **Step 4: Compare** — expect within ±10%. >25% diff = parsing or scope issue; investigate before enabling cron.

### Task 6.3: Verify scheduled cron + update session log

**Files:**
- Modify: `docs/projects/performance-grip/session-log.md`

- [ ] **Step 1: Wait for next scheduled run** (next 01:00 or 13:00 IST).
- [ ] **Step 2: Verify run executed within ±30 min** of scheduled time (some drift normal).
- [ ] **Step 3: Pull and verify new rows landed**:

```bash
git pull
tail -5 backend/data/performance-grip/hourly_web_vitals.csv
```

- [ ] **Step 4: Update `session-log.md`** — append at the top:

```markdown
## 2026-MM-DD — First production backfill (Session 2)

- 7-day backfill via workflow_dispatch: {N} rows in hourly_web_vitals.csv.
- Spot-check vs NR native: ±{X}% on p75 LCP for gi-client-static yesterday.
- Twice-daily cron live (01:00 + 13:00 IST). First scheduled run drift: {±N} min.
- **Archive operational.** Plan 2 (Dashboard) is unblocked.
```

- [ ] **Step 5: Commit**

```bash
git add docs/projects/performance-grip/session-log.md
git commit -m "docs(performance-grip): session log — archive operational, Plan 2 unblocked"
```

---

## Plan 1 complete

At this point:
- `backend/data/performance-grip/hourly_web_vitals.csv` is populated and growing twice daily.
- Twice-daily cron verified, autonomously committing.
- Every day Plan 2 is delayed = one more day of historical data accumulating.

**Next:** write Plan 2 (Editorial dashboard), ideally after this archive has run for ~7 days. The dashboard work calibrates against real data (route patterns, threshold-band opacity, sample-size distributions, query shapes).

Plan 2 will land at: `docs/projects/performance-grip/plans/YYYY-MM-DD-performance-grip-dashboard-plan.md`.

---

## Self-review (run by the plan author before delivery)

**Spec coverage:**
- §1 (why): captured in Phase 0 task 0.1 step 6 (data-sources records the alternatives).
- §2 (audience/non-goals): no implementation task — informational.
- §3 (architecture): Tasks 1.x, 2.x, 3.x, 5.x cover the file layout.
- §4.1 NerdGraph fetch: Tasks 1.1–1.4.
- §4.2 NRQL: Tasks 0.3–0.5, 2.3–2.5, 2.10.
- §4.3 schema: Task 2.6 `CSV_COLUMNS`.
- §4.4 idempotent append: Tasks 2.6, 2.10.
- §4.5 backfill: Tasks 2.8, 6.1.
- §4.6 URL cleanup: Task 2.1.
- §4.7 unknowns: resolved by Phase 0.
- §5.1, §5.2 schedule + workflow: Task 5.1.
- §5.3 failure handling: Tasks 2.10 (empty-result), 5.1 (timeout, concurrency).
- §5.4 secrets: Task 5.2.
- §6 dashboard: **NOT in this plan** — Plan 2.
- §7 error handling: Tasks 1.3, 1.4, 2.9, 2.10.
- §8 testing: every code task is TDD; integration smoke in Task 6.2.
- §9 future work: in `roadmap.md` (Task 3.3).
- §10 open questions: resolved by Phase 0; recorded in `data-sources.md`.
- §11 implementation order: this plan expands §11 with code.
- §12 decisions log: in the spec, not duplicated.

**Placeholder scan:** searched for "TBD", "TODO", "fill in" — only present in step-1-of-discovery placeholders in `data-sources.md` skeleton (intended for the engineer to fill in during that step) and `<REPLACE-WITH-SHA>` in Task 5.1 step 3 (explicit user action).

**Type consistency:** `NewRelicClient` constructor stable across Tasks 1.1, 1.2, 1.3, 1.4. `parse_q1_response` output keys consumed unchanged by `merge_rows` in 2.5. `CSV_COLUMNS` defined once in 2.6, used unchanged in 2.10. No mismatches found.

---

## Execution Handoff

Plan saved to: `docs/projects/performance-grip/plans/2026-05-20-performance-grip-archive-plan.md`

Two execution options:

**1. Subagent-Driven (recommended)** — fresh subagent per task, review between tasks, fast iteration. Best for a multi-day implementation with checkpoints.

**2. Inline Execution** — execute in this session via executing-plans, batch with checkpoints. Best if you want to drive it interactively now.

**Phase 0 (discovery) is human work** — neither mode replaces logging into NR and running queries. The user (you) does Phase 0; the engineer/agent picks up at Phase 1 once fixtures are committed.

Which approach for Phase 1 onward?
