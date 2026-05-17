# Grip Connect Live Data — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Grip Connect dashboard show live Metabase data via a deterministic fetch pipeline with scheduled + manual refresh.

**Architecture:** A deterministic Python module pulls 5 Metabase cards over the REST API, parses them into "layer-1" raw tables and computes "layer-2" derived tables, accumulating history by upserting on a natural key. Canonical CSVs land in DuckDB. A `POST /refresh` endpoint runs it in-container; a daily GitHub Action runs it and commits the CSVs for durability. The frontend renders the last snapshot instantly and refreshes in the background.

**Tech Stack:** Python 3.12, FastAPI, httpx, DuckDB, pytest; Next.js 14 / React; GitHub Actions.

**Spec:** `docs/specs/2026-05-17-grip-connect-live-data-design.md`

**Branch:** Implement on `feat/grip-connect-live-data` (cut from `docs/grip-connect-live-data`).

**Reference source:** `/tmp/kishor-artifacts/.claude/skills/gc-analyst/metabase_fetch.py` — the proven gc-analyst extraction. Several functions are ported from it; line numbers are cited.

**Prerequisite (does not block tasks 1–14, blocks the first live run):** `METABASE_EMAIL` + `METABASE_PASSWORD`. Metabase URL: `https://metabase.gripinvest.in`.

---

## File Structure

| File | Responsibility |
|---|---|
| `backend/requirements-dev.txt` | Dev-only deps (`pytest`). |
| `backend/conftest.py` | Puts `backend/` on `sys.path` for tests. |
| `backend/services/integrations/__init__.py` | Package marker. |
| `backend/services/integrations/metabase.py` | `MetabaseClient` — login + card query over httpx. Source-agnostic. |
| `backend/services/integrations/transforms.py` | Pure functions: `_to_float`, `compute_mtd_from_dod`, `compute_retention_metrics`, column detectors. No I/O. |
| `backend/services/integrations/grip_connect.py` | Grip Connect config + `fetch_all()` orchestration: layer-1 fetch, layer-2 derivation. |
| `backend/services/integrations/accumulate.py` | `upsert_csv()` — merge new rows into a canonical CSV by natural key. |
| `backend/services/integrations/refresh.py` | `run_refresh()` shared logic + CLI entry point + `_manifest.json` writer. |
| `backend/services/integrations/validate.py` | Deterministic output checks. |
| `backend/routers/refresh.py` | `POST /api/projects/{id}/refresh` + polling endpoint. |
| `backend/tests/` | pytest tests mirroring the modules above. |
| `.github/workflows/refresh-grip-connect.yml` | Daily scheduled refresh that commits CSVs. |
| `frontend/lib/api.ts` (modify) | `refreshProject()` + `pollRefresh()`. |
| `frontend/app/projects/[id]/page.jsx` (modify) | On-open freshness check. |
| `frontend/components/dashboards/GripConnectDashboardEditorial.jsx` (modify) | Refresh button, state chip, "as of", trend/funnel exhibits. |

---

# Phase 1 — Fetch module

### Task 1: Test scaffolding

**Files:**
- Create: `backend/requirements-dev.txt`
- Create: `backend/conftest.py`
- Create: `backend/services/integrations/__init__.py`
- Create: `backend/tests/__init__.py`

- [ ] **Step 1: Create the dev requirements file**

`backend/requirements-dev.txt`:
```
pytest==8.3.3
```

- [ ] **Step 2: Install it**

Run: `cd backend && .venv/bin/pip install -r requirements-dev.txt`
Expected: `Successfully installed pytest-8.3.3 ...`

- [ ] **Step 3: Create the package markers and conftest**

`backend/services/integrations/__init__.py`: empty file.
`backend/tests/__init__.py`: empty file.
`backend/conftest.py`:
```python
# Ensures `from services... import ...` resolves when pytest runs from backend/.
import os, sys
sys.path.insert(0, os.path.dirname(__file__))
```

- [ ] **Step 4: Verify pytest collects nothing yet (clean baseline)**

Run: `cd backend && .venv/bin/pytest -q`
Expected: `no tests ran` (exit code 5) — confirms pytest works.

- [ ] **Step 5: Commit**

```bash
git add backend/requirements-dev.txt backend/conftest.py backend/services/integrations/__init__.py backend/tests/__init__.py
git commit -m "test: add pytest scaffolding for integrations"
```

---

### Task 2: Metabase REST client

**Files:**
- Create: `backend/services/integrations/metabase.py`
- Test: `backend/tests/test_metabase.py`

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_metabase.py`:
```python
import httpx
import pytest
from services.integrations.metabase import MetabaseClient, MetabaseError


def _client(handler):
    return MetabaseClient("https://mb.test", client=httpx.Client(transport=httpx.MockTransport(handler)))


def test_login_returns_token():
    def handler(request):
        assert request.url.path == "/api/session"
        return httpx.Response(200, json={"id": "tok-123"})
    assert _client(handler).login("e@x.com", "pw") == "tok-123"


def test_login_bad_credentials_raises_clear_error():
    def handler(request):
        return httpx.Response(401, json={"errors": {"password": "did not match"}})
    with pytest.raises(MetabaseError, match="auth failed"):
        _client(handler).login("e@x.com", "wrong")


def test_fetch_card_parses_cols_and_rows():
    def handler(request):
        if request.url.path == "/api/session":
            return httpx.Response(200, json={"id": "tok"})
        assert request.url.path == "/api/card/3841/query"
        return httpx.Response(200, json={"data": {
            "cols": [{"name": "week"}, {"name": "aum"}],
            "rows": [["2026-05-04", 1000], ["2026-05-11", 2000]],
        }})
    c = _client(handler)
    c.login("e@x.com", "pw")
    rows, cols = c.fetch_card(3841)
    assert cols == ["week", "aum"]
    assert rows == [{"week": "2026-05-04", "aum": 1000}, {"week": "2026-05-11", "aum": 2000}]


def test_fetch_card_before_login_raises():
    c = _client(lambda r: httpx.Response(200, json={}))
    with pytest.raises(MetabaseError, match="Not logged in"):
        c.fetch_card(3841)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && .venv/bin/pytest tests/test_metabase.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'services.integrations.metabase'`

- [ ] **Step 3: Write the implementation**

`backend/services/integrations/metabase.py`:
```python
"""Deterministic Metabase REST client. No LLM, no browser — plain httpx.

Ported from gc-analyst's metabase_fetch.py (functions metabase_login /
fetch_question_data, lines 172-250), adapted to httpx (the backend's HTTP
library) and wrapped in a class so tests can inject a MockTransport.
"""
import httpx


class MetabaseError(RuntimeError):
    """Raised for auth failures and misuse — carries a human-readable message."""


class MetabaseClient:
    def __init__(self, base_url: str, client: httpx.Client | None = None):
        self.base_url = base_url.rstrip("/")
        self._client = client or httpx.Client(timeout=90.0)
        self._token: str | None = None

    def login(self, email: str, password: str) -> str:
        resp = self._client.post(
            f"{self.base_url}/api/session",
            json={"username": email, "password": password},
        )
        if resp.status_code in (401, 403):
            raise MetabaseError("Metabase auth failed — check credentials")
        resp.raise_for_status()
        self._token = resp.json()["id"]
        return self._token

    def card_param_id(self, card_id: int, param_tag: str) -> str | None:
        """A parameterised card needs its parameter's id. Mirrors
        fetch_card_param_id (metabase_fetch.py:182-192)."""
        resp = self._client.get(
            f"{self.base_url}/api/card/{card_id}",
            headers={"X-Metabase-Session": self._require_token()},
        )
        resp.raise_for_status()
        for param in resp.json().get("parameters", []):
            target = param.get("target", [])
            if (len(target) == 2 and isinstance(target[1], list)
                    and len(target[1]) == 2 and target[1][1] == param_tag):
                return param.get("id")
        return None

    def fetch_card(self, card_id: int, parameters: list[dict] | None = None
                   ) -> tuple[list[dict], list[str]]:
        """Run a card; return (rows-as-dicts, column-names). Column names use
        display_name when present (matches metabase_fetch.py:223-226)."""
        resp = self._client.post(
            f"{self.base_url}/api/card/{card_id}/query",
            headers={"X-Metabase-Session": self._require_token()},
            json={"parameters": parameters or []},
        )
        if resp.status_code in (401, 403):
            raise MetabaseError("Metabase auth failed — check credentials")
        resp.raise_for_status()
        data = resp.json().get("data", {})
        cols = [c.get("display_name") or c.get("name", f"col_{i}")
                for i, c in enumerate(data.get("cols", []))]
        rows = [dict(zip(cols, r)) for r in data.get("rows", [])]
        return rows, cols

    @staticmethod
    def gc_name_param(param_tag: str, value: str, param_id: str | None) -> dict:
        """Build the `gc_name` filter payload (metabase_fetch.py:204-210)."""
        p = {"type": "category",
             "target": ["variable", ["template-tag", param_tag]],
             "value": value}
        if param_id:
            p["id"] = param_id
        return p

    def _require_token(self) -> str:
        if not self._token:
            raise MetabaseError("Not logged in — call login() first")
        return self._token
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && .venv/bin/pytest tests/test_metabase.py -v`
Expected: PASS — 4 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/services/integrations/metabase.py backend/tests/test_metabase.py
git commit -m "feat: Metabase REST client (httpx, ported from gc-analyst)"
```

---

### Task 3: Transform functions (MTD, retention, helpers)

**Files:**
- Create: `backend/services/integrations/transforms.py`
- Test: `backend/tests/test_transforms.py`

These are pure functions ported verbatim from `metabase_fetch.py` — no network, trivially testable.

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_transforms.py`:
```python
from datetime import date
from services.integrations.transforms import (
    to_float, compute_mtd_from_dod, compute_retention_metrics, detect_week_column,
)


def test_to_float_strips_currency_and_handles_blanks():
    assert to_float("₹1,234.50") == 1234.5
    assert to_float("12%") == 12.0
    assert to_float("-") is None
    assert to_float(None) is None
    assert to_float("") is None


def test_detect_week_column_finds_week_like_name():
    assert detect_week_column(["week_start", "aum"]) == "week_start"
    assert detect_week_column(["aum", "report_date"]) == "report_date"


def test_compute_mtd_from_dod_sums_the_right_windows():
    # active week start = Wed 2026-05-13. Current window: 2026-05-01..05-13.
    # Prior window: 2026-04-01..04-13.
    rows = [
        {"d": "2026-05-02", "aum": 100}, {"d": "2026-05-13", "aum": 50},
        {"d": "2026-04-05", "aum": 200}, {"d": "2026-04-30", "aum": 999},  # out of prior window
    ]
    cur, prior = compute_mtd_from_dod(rows, "d", "aum", date(2026, 5, 13))
    assert cur == 150.0
    assert prior == 200.0


def test_compute_retention_metrics_formulas():
    d1 = {"mtd_et_repeat": 30, "LMTD_et_repeat": 20}
    d2 = {"mtd_et_unique_inv": 100, "lmtd_et_unique_inv": 80}
    fmap = {"d1_mtd_repeat": "mtd_et_repeat", "d1_lmtd_repeat": "LMTD_et_repeat",
            "d2_mtd_unique": "mtd_et_unique_inv", "d2_lmtd_unique": "lmtd_et_unique_inv"}
    r = compute_retention_metrics(d1, d2, fmap)
    assert r["repeat_rate"] == 30 / 80
    assert r["retention_mtd"] == 30 / 100
    assert r["retention_lmtd"] == 20 / 80
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && .venv/bin/pytest tests/test_transforms.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'services.integrations.transforms'`

- [ ] **Step 3: Write the implementation**

`backend/services/integrations/transforms.py` — port `_to_float` (metabase_fetch.py:315-321), `detect_week_column` (339-343), `detect_dod_date_column` (369-373), `detect_dod_aum_column` (376-380), `compute_mtd_from_dod` (383-421), `compute_retention_metrics` (253-283). Copy each function body verbatim from the reference file; rename `_to_float` → `to_float` and update its callers within this module. Keep the docstrings.

```python
"""Pure transform functions ported from gc-analyst's metabase_fetch.py.
No network, no I/O — deterministic, unit-tested."""
import re
from datetime import datetime, date, timedelta


def to_float(val) -> float | None:
    # verbatim from metabase_fetch.py:315-321 (renamed from _to_float)
    if val is None or str(val).strip() in ("", "-", "N/A", "null", "None"):
        return None
    try:
        return float(re.sub(r"[₹$,% ]", "", str(val)))
    except (ValueError, TypeError):
        return None


def detect_week_column(col_names: list[str]) -> str | None:
    for c in col_names:
        if re.search(r"\b(week|wk|date|period|dt)\b", c, re.I):
            return c
    return col_names[0] if col_names else None


def detect_dod_date_column(col_names: list[str]) -> str | None:
    for c in col_names:
        if re.search(r"\bdate\b|\bday\b", c, re.I):
            return c
    return col_names[0] if col_names else None


def detect_dod_aum_column(col_names: list[str]) -> str | None:
    for c in col_names:
        if re.search(r"\baum\b", c, re.I):
            return c
    return None


def compute_mtd_from_dod(dod_rows, date_col, aum_col, active_week_start):
    # verbatim from metabase_fetch.py:383-421
    cur_start = active_week_start.replace(day=1)
    cur_end = active_week_start
    prior_month_end = cur_start - timedelta(days=1)
    prior_start = prior_month_end.replace(day=1)
    prior_end_day = min(active_week_start.day, prior_month_end.day)
    prior_end = prior_start.replace(day=prior_end_day)
    cur_total, prior_total = 0.0, 0.0
    cur_found, prior_found = False, False
    for row in dod_rows:
        try:
            row_date = datetime.strptime(str(row.get(date_col, ""))[:10], "%Y-%m-%d").date()
        except ValueError:
            continue
        aum_val = to_float(row.get(aum_col))
        if aum_val is None:
            continue
        if cur_start <= row_date <= cur_end:
            cur_total += aum_val
            cur_found = True
        elif prior_start <= row_date <= prior_end:
            prior_total += aum_val
            prior_found = True
    return (cur_total if cur_found else None), (prior_total if prior_found else None)


def compute_retention_metrics(d1_row, d2_row, field_map):
    # verbatim from metabase_fetch.py:253-283
    mtd_repeat = to_float(d1_row.get(field_map["d1_mtd_repeat"]))
    lmtd_repeat = to_float(d1_row.get(field_map["d1_lmtd_repeat"]))
    mtd_unique = to_float(d2_row.get(field_map["d2_mtd_unique"]))
    lmtd_unique = to_float(d2_row.get(field_map["d2_lmtd_unique"]))

    def _safe_div(num, den):
        if num is None or den is None or den == 0:
            return None
        return num / den

    return {
        "repeat_rate": _safe_div(mtd_repeat, lmtd_unique),
        "retention_mtd": _safe_div(mtd_repeat, mtd_unique),
        "retention_lmtd": _safe_div(lmtd_repeat, lmtd_unique),
        "mtd_repeat": mtd_repeat, "lmtd_repeat": lmtd_repeat,
        "mtd_unique": mtd_unique, "lmtd_unique": lmtd_unique,
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && .venv/bin/pytest tests/test_transforms.py -v`
Expected: PASS — 4 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/services/integrations/transforms.py backend/tests/test_transforms.py
git commit -m "feat: port MTD/retention transform functions from gc-analyst"
```

---

### Task 4: Grip Connect fetch orchestration

**Files:**
- Create: `backend/services/integrations/grip_connect.py`
- Test: `backend/tests/test_grip_connect.py`

This module owns the Grip Connect config and produces **layer-1** (raw card rows tagged with `partner`) and **layer-2** (the derived North Star + funnel) as in-memory lists of dicts. Writing them to disk is Task 5.

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_grip_connect.py`:
```python
from services.integrations.grip_connect import CARDS, PARTNERS, build_layer1, build_layer2


class FakeClient:
    """Stands in for MetabaseClient — returns canned rows per (card_id)."""
    def __init__(self, by_card):
        self.by_card = by_card
    def card_param_id(self, card_id, tag):
        return "p1"
    def fetch_card(self, card_id, parameters=None):
        return list(self.by_card.get(card_id, [])), []


def test_cards_and_partners_config():
    assert CARDS["summary_wow"]["id"] == 3841
    assert CARDS["kyc_funnel"]["id"] == 4499
    assert CARDS["summary_dod"]["id"] == 3843
    assert CARDS["retention_d1"]["id"] == 5042
    assert CARDS["retention_d2"]["id"] == 5046
    assert "ET money" in PARTNERS


def test_build_layer1_tags_rows_with_partner():
    client = FakeClient({3841: [{"week": "2026-05-04", "aum": 1e7}]})
    l1 = build_layer1(client, partners=["ET money"], cards=["summary_wow"])
    rows = l1["card_3841_summary_wow"]
    assert rows == [{"partner": "ET money", "week": "2026-05-04", "aum": 1e7}]


def test_build_layer2_north_star_has_one_row_per_partner_metric():
    layer1 = {
        "card_3841_summary_wow": [{"partner": "ET money", "week": "2026-05-11",
                                   "aum": 5e7, "fti_count": 12}],
        "card_3843_summary_dod": [{"partner": "ET money", "date": "2026-05-11", "aum": 1e7}],
        "card_5042_retention_d1": [{"mtd_et_repeat": 30, "LMTD_et_repeat": 20}],
        "card_5046_retention_d2": [{"mtd_et_unique_inv": 100, "lmtd_et_unique_inv": 80}],
    }
    l2 = build_layer2(layer1, partners=["ET money"], active_week_start=__import__("datetime").date(2026, 5, 11))
    ns = l2["01_north_star"]
    metrics = {r["metric"] for r in ns if r["partner"] == "ET money"}
    assert metrics == {"AUM", "FTI", "Repeat"}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && .venv/bin/pytest tests/test_grip_connect.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'services.integrations.grip_connect'`

- [ ] **Step 3: Write the implementation**

`backend/services/integrations/grip_connect.py`:
```python
"""Grip Connect fetch orchestration. Config + layer-1/layer-2 builders.

Layer 1 = raw card output, one dict per row, tagged with `partner`.
Layer 2 = derived dashboard tables (North Star, reg-to-KYC funnel).
Card IDs, partner list and RETENTION_FIELD_MAP are lifted from
gc-analyst's metabase_fetch.py.
"""
from datetime import date
from .transforms import (
    compute_mtd_from_dod, compute_retention_metrics,
    detect_dod_date_column, detect_dod_aum_column, to_float,
)

# Card registry — keyed by a stable short name. (metabase_fetch.py:35-54 + 5042/5046)
CARDS = {
    "summary_wow":   {"id": 3841, "table": "card_3841_summary_wow",   "param": "gc_name"},
    "kyc_funnel":    {"id": 4499, "table": "card_4499_kyc_funnel",    "param": "gc_name"},
    "summary_dod":   {"id": 3843, "table": "card_3843_summary_dod",   "param": "gc_name"},
    "retention_d1":  {"id": 5042, "table": "card_5042_retention_d1",  "param": None},
    "retention_d2":  {"id": 5046, "table": "card_5046_retention_d2",  "param": None},
}

# v1 partners — the four the current dashboard covers. Strings MUST match the
# Metabase `gc_name` filter values exactly (metabase_fetch.py:57-69).
PARTNERS = ["ET money", "Paisa Bazaar", "Mobikwik", "Tata Digital Private Ltd"]

# Per-partner retention column map (metabase_fetch.py:94-125).
RETENTION_FIELD_MAP = {
    "ET money": {"d1_mtd_repeat": "mtd_et_repeat", "d1_lmtd_repeat": "LMTD_et_repeat",
                 "d2_mtd_unique": "mtd_et_unique_inv", "d2_lmtd_unique": "lmtd_et_unique_inv"},
    "Tata Digital Private Ltd": {"d1_mtd_repeat": "mtd_tdl_repeat", "d1_lmtd_repeat": "LMTD_tdl_repeat",
                 "d2_mtd_unique": "mtd_tdl_unique_inv", "d2_lmtd_unique": "lmtd_tdl_unique_inv"},
    "Paisa Bazaar": {"d1_mtd_repeat": "mtd_pb_repeat", "d1_lmtd_repeat": "LMTD_pb_repeat",
                 "d2_mtd_unique": "mtd_pb_unique_inv", "d2_lmtd_unique": "lmtd_pb_unique_inv"},
    "Mobikwik": {"d1_mtd_repeat": "mtd_mbk_repeat", "d1_lmtd_repeat": "LMTD_mbk_repeat",
                 "d2_mtd_unique": "mtd_mbk_unique_inv", "d2_lmtd_unique": "lmtd_mbk_unique_inv"},
}

# Partner string -> the display name used in the dashboard (metabase_fetch.py:72-79).
DISPLAY_NAMES = {"ET money": "ET Money", "Paisa Bazaar": "Paisabazaar",
                 "Mobikwik": "MobiKwik", "Tata Digital Private Ltd": "Tata Digital"}


def build_layer1(client, partners=PARTNERS, cards=None) -> dict[str, list[dict]]:
    """Fetch each card; return {table_name: [row, ...]} with `partner` tagged on
    every parameterised-card row. Unparameterised cards (retention) fetched once."""
    cards = cards or list(CARDS)
    out: dict[str, list[dict]] = {}
    for key in cards:
        cfg = CARDS[key]
        rows: list[dict] = []
        if cfg["param"]:
            pid = client.card_param_id(cfg["id"], cfg["param"])
            for partner in partners:
                param = {"type": "category",
                         "target": ["variable", ["template-tag", cfg["param"]]],
                         "value": partner}
                if pid:
                    param["id"] = pid
                card_rows, _ = client.fetch_card(cfg["id"], [param])
                for r in card_rows:
                    rows.append({"partner": partner, **r})
        else:
            card_rows, _ = client.fetch_card(cfg["id"])
            rows = card_rows
        out[cfg["table"]] = rows
    return out


def build_layer2(layer1, partners=PARTNERS, active_week_start: date | None = None
                 ) -> dict[str, list[dict]]:
    """Derive the dashboard tables from layer-1.

    01_north_star: long format — one row per (partner, metric in AUM/FTI/Repeat).
    02_reg_to_kyc: the funnel — passed through from card 4499, latest week per partner.
    """
    active_week_start = active_week_start or date.today()
    wow = layer1.get("card_3841_summary_wow", [])
    dod = layer1.get("card_3843_summary_dod", [])
    d1 = layer1.get("card_5042_retention_d1", [{}])
    d2 = layer1.get("card_5046_retention_d2", [{}])
    funnel = layer1.get("card_4499_kyc_funnel", [])

    north_star: list[dict] = []
    for partner in partners:
        # AUM — MTD vs LMTD from the DoD card.
        p_dod = [r for r in dod if r.get("partner") == partner]
        date_col = detect_dod_date_column(list(p_dod[0])) if p_dod else "date"
        aum_col = detect_dod_aum_column(list(p_dod[0])) if p_dod else "aum"
        cur, prior = compute_mtd_from_dod(p_dod, date_col, aum_col, active_week_start)
        north_star.append(_metric_row(partner, "AUM", cur, prior, unit="cr", scale=1e7))

        # FTI — latest WoW row's fti_count.
        p_wow = [r for r in wow if r.get("partner") == partner]
        latest = p_wow[-1] if p_wow else {}
        north_star.append(_metric_row(partner, "FTI", to_float(latest.get("fti_count")),
                                      None, unit="count", scale=1))

        # Repeat — from retention cards.
        fmap = RETENTION_FIELD_MAP.get(partner)
        rep = compute_retention_metrics(d1[0], d2[0], fmap) if fmap else {}
        north_star.append(_metric_row(partner, "Repeat", rep.get("mtd_repeat"),
                                      rep.get("lmtd_repeat"), unit="count", scale=1))

    # Funnel: keep the latest row per partner.
    by_partner: dict[str, dict] = {}
    for r in funnel:
        by_partner[r.get("partner")] = r
    return {"01_north_star": north_star, "02_reg_to_kyc": list(by_partner.values())}


def _metric_row(partner, metric, mtd_raw, lmtd_raw, unit, scale):
    mtd = (mtd_raw / scale) if mtd_raw is not None else None
    lmtd = (lmtd_raw / scale) if lmtd_raw is not None else None
    delta = None
    if mtd is not None and lmtd not in (None, 0):
        delta = round(100.0 * (mtd - lmtd) / lmtd, 2)
    return {"partner": DISPLAY_NAMES.get(partner, partner), "metric": metric,
            "mtd": mtd, "lmtd": lmtd, "delta_pct": delta, "unit": unit}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && .venv/bin/pytest tests/test_grip_connect.py -v`
Expected: PASS — 3 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/services/integrations/grip_connect.py backend/tests/test_grip_connect.py
git commit -m "feat: Grip Connect layer-1/layer-2 fetch orchestration"
```

---

### Task 5: Accumulation (upsert by natural key)

**Files:**
- Create: `backend/services/integrations/accumulate.py`
- Test: `backend/tests/test_accumulate.py`

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_accumulate.py`:
```python
import csv
from services.integrations.accumulate import upsert_csv


def _read(path):
    with open(path) as f:
        return list(csv.DictReader(f))


def test_upsert_creates_file_when_absent(tmp_path):
    path = tmp_path / "t.csv"
    upsert_csv(path, [{"partner": "ET", "week": "w1", "aum": "10"}], key=["partner", "week"])
    assert _read(path) == [{"partner": "ET", "week": "w1", "aum": "10"}]


def test_upsert_appends_new_keys_and_overwrites_existing(tmp_path):
    path = tmp_path / "t.csv"
    upsert_csv(path, [{"partner": "ET", "week": "w1", "aum": "10"}], key=["partner", "week"])
    upsert_csv(path, [
        {"partner": "ET", "week": "w1", "aum": "11"},   # correction -> overwrite
        {"partner": "ET", "week": "w2", "aum": "20"},   # new -> append
    ], key=["partner", "week"])
    rows = sorted(_read(path), key=lambda r: r["week"])
    assert rows == [{"partner": "ET", "week": "w1", "aum": "11"},
                    {"partner": "ET", "week": "w2", "aum": "20"}]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && .venv/bin/pytest tests/test_accumulate.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'services.integrations.accumulate'`

- [ ] **Step 3: Write the implementation**

`backend/services/integrations/accumulate.py`:
```python
"""Accumulate fetched rows into a canonical CSV by upserting on a natural key.

History grows past the window a single card returns; a later fetch correcting
an earlier row overwrites it. Write is atomic (temp file + rename) so a crash
mid-write leaves the prior CSV intact.
"""
import csv
import os
from pathlib import Path


def upsert_csv(path, new_rows: list[dict], key: list[str]) -> None:
    path = Path(path)
    existing: dict[tuple, dict] = {}
    if path.exists():
        with open(path, newline="") as f:
            for row in csv.DictReader(f):
                existing[tuple(row.get(k, "") for k in key)] = row
    for row in new_rows:
        existing[tuple(str(row.get(k, "")) for k in key)] = {k: row.get(k) for k in row}

    merged = list(existing.values())
    if not merged:
        return
    fieldnames = list(merged[0].keys())
    tmp = path.with_suffix(path.suffix + ".tmp")
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(tmp, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(merged)
    os.replace(tmp, path)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && .venv/bin/pytest tests/test_accumulate.py -v`
Expected: PASS — 2 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/services/integrations/accumulate.py backend/tests/test_accumulate.py
git commit -m "feat: upsert-by-key CSV accumulation"
```

---

### Task 6: Refresh runner + CLI + manifest

**Files:**
- Create: `backend/services/integrations/refresh.py`
- Test: `backend/tests/test_refresh_runner.py`

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_refresh_runner.py`:
```python
import json
from datetime import date
from services.integrations.refresh import run_refresh


class FakeClient:
    def card_param_id(self, card_id, tag):
        return "p1"
    def fetch_card(self, card_id, parameters=None):
        canned = {
            3841: [{"week": "2026-05-11", "aum": 5e7, "fti_count": 12}],
            3843: [{"date": "2026-05-11", "aum": 1e7}],
            4499: [{"no_of_total_reg": 100}],
            5042: [{"mtd_et_repeat": 30, "LMTD_et_repeat": 20}],
            5046: [{"mtd_et_unique_inv": 100, "lmtd_et_unique_inv": 80}],
        }
        return list(canned.get(card_id, [])), []


def test_run_refresh_writes_csvs_and_manifest(tmp_path):
    result = run_refresh(FakeClient(), data_dir=tmp_path, partners=["ET money"],
                         active_week_start=date(2026, 5, 11))
    assert (tmp_path / "card_3841_summary_wow.csv").exists()
    assert (tmp_path / "01_north_star.csv").exists()
    manifest = json.loads((tmp_path / "_manifest.json").read_text())
    assert "01_north_star" in manifest["tables"]
    assert manifest["tables"]["01_north_star"]["last_refreshed_at"]
    assert result["status"] == "ok"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && .venv/bin/pytest tests/test_refresh_runner.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'services.integrations.refresh'`

- [ ] **Step 3: Write the implementation**

`backend/services/integrations/refresh.py`:
```python
"""Refresh runner — the single source of truth, two entry points:
  · imported by the refresh endpoint (routers/refresh.py)
  · run standalone:  python -m services.integrations.refresh
"""
import json
import os
import sys
from datetime import date, datetime, timezone
from pathlib import Path

from .grip_connect import CARDS, PARTNERS, build_layer1, build_layer2
from .metabase import MetabaseClient

# Natural keys per canonical table — used by upsert accumulation.
KEYS = {
    "card_3841_summary_wow":  ["partner", "week"],
    "card_4499_kyc_funnel":   ["partner", "week"],
    "card_3843_summary_dod":  ["partner", "date"],
    "card_5042_retention_d1": ["partner"],
    "card_5046_retention_d2": ["partner"],
    "01_north_star":          ["partner", "metric"],
    "02_reg_to_kyc":          ["partner"],
}


def _active_week_start() -> date:
    today = date.today()
    return today - __import__("datetime").timedelta(days=today.weekday() + 7)


def run_refresh(client, data_dir, partners=PARTNERS, active_week_start=None) -> dict:
    """Fetch -> accumulate -> derive -> write CSVs + manifest. Returns a summary.

    NOTE: the exact `week`/`date` column names are confirmed against a live card
    response in the first run (spec §16). If a card's week column is not literally
    `week`/`date`, adjust KEYS above — this is the one Phase-1 pin.
    """
    from .accumulate import upsert_csv  # local import keeps this importable w/o cycles
    data_dir = Path(data_dir)
    active_week_start = active_week_start or _active_week_start()
    log: list[str] = []

    layer1 = build_layer1(client, partners=partners)
    for table, rows in layer1.items():
        upsert_csv(data_dir / f"{table}.csv", rows, key=KEYS.get(table, ["partner"]))
        log.append(f"{table}: {len(rows)} rows")

    layer2 = build_layer2(layer1, partners=partners, active_week_start=active_week_start)
    for table, rows in layer2.items():
        upsert_csv(data_dir / f"{table}.csv", rows, key=KEYS.get(table, ["partner"]))
        log.append(f"{table}: {len(rows)} rows")

    now = datetime.now(timezone.utc).isoformat()
    all_tables = list(layer1) + list(layer2)
    manifest = {"refreshed_at": now,
                "tables": {t: {"last_refreshed_at": now} for t in all_tables}}
    (data_dir / "_manifest.json").write_text(json.dumps(manifest, indent=2))
    return {"status": "ok", "log": log, "refreshed_at": now}


def main() -> int:
    base = os.getenv("METABASE_URL", "https://metabase.gripinvest.in")
    email, password = os.getenv("METABASE_EMAIL"), os.getenv("METABASE_PASSWORD")
    if not email or not password:
        print("ERROR: set METABASE_EMAIL and METABASE_PASSWORD", file=sys.stderr)
        return 1
    client = MetabaseClient(base)
    client.login(email, password)
    data_dir = Path(os.getenv("DATA_DIR", "./data")) / "grip_connect"
    result = run_refresh(client, data_dir)
    print("\n".join(result["log"]))
    print(f"Done — {result['refreshed_at']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && .venv/bin/pytest tests/test_refresh_runner.py -v`
Expected: PASS — 1 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/services/integrations/refresh.py backend/tests/test_refresh_runner.py
git commit -m "feat: refresh runner + CLI + manifest"
```

---

### Task 7: Output validation

**Files:**
- Create: `backend/services/integrations/validate.py`
- Test: `backend/tests/test_validate.py`

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_validate.py`:
```python
from services.integrations.validate import validate_north_star


def test_validate_passes_on_good_rows():
    rows = [{"partner": "ET Money", "metric": "AUM", "mtd": 50.0, "unit": "cr"}]
    errors = validate_north_star(rows, expected_partners={"ET Money"})
    assert errors == []


def test_validate_flags_missing_partner_and_bad_metric():
    rows = [{"partner": "ET Money", "metric": "BOGUS", "mtd": 1.0, "unit": "cr"}]
    errors = validate_north_star(rows, expected_partners={"ET Money", "MobiKwik"})
    assert any("MobiKwik" in e for e in errors)
    assert any("BOGUS" in e for e in errors)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && .venv/bin/pytest tests/test_validate.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'services.integrations.validate'`

- [ ] **Step 3: Write the implementation**

`backend/services/integrations/validate.py`:
```python
"""Deterministic checks on refresh output. Run after a refresh; a non-empty
return list means something is wrong and should block cut-over / page an alert."""

VALID_METRICS = {"AUM", "FTI", "Repeat"}


def validate_north_star(rows: list[dict], expected_partners: set[str]) -> list[str]:
    errors: list[str] = []
    seen = {r.get("partner") for r in rows}
    for p in expected_partners - seen:
        errors.append(f"missing partner: {p}")
    for r in rows:
        if r.get("metric") not in VALID_METRICS:
            errors.append(f"unexpected metric: {r.get('metric')}")
        mtd = r.get("mtd")
        if mtd is not None and not isinstance(mtd, (int, float)):
            errors.append(f"non-numeric mtd for {r.get('partner')}/{r.get('metric')}")
    return errors
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && .venv/bin/pytest tests/test_validate.py -v`
Expected: PASS — 2 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/services/integrations/validate.py backend/tests/test_validate.py
git commit -m "feat: deterministic refresh-output validation"
```

---

# Phase 3 — Refresh endpoint

### Task 8: Refresh job registry + endpoints

**Files:**
- Create: `backend/routers/refresh.py`
- Modify: `backend/main.py`
- Modify: `backend/.env.example`
- Test: `backend/tests/test_refresh_endpoint.py`

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_refresh_endpoint.py`:
```python
from fastapi.testclient import TestClient


def _app(monkeypatch):
    # Patch the runner so the endpoint test never touches Metabase.
    import services.integrations.refresh as refresh_mod
    monkeypatch.setattr(refresh_mod, "run_refresh",
                        lambda *a, **k: {"status": "ok", "log": ["done"], "refreshed_at": "now"})
    from routers.refresh import router, _JOBS
    _JOBS.clear()
    from fastapi import FastAPI
    app = FastAPI()
    app.include_router(router, prefix="/api/projects")
    return app


def test_post_refresh_returns_job_id(monkeypatch):
    client = TestClient(_app(monkeypatch))
    resp = client.post("/api/projects/grip_connect/refresh")
    assert resp.status_code == 200
    assert "job_id" in resp.json()


def test_poll_refresh_reports_status(monkeypatch):
    client = TestClient(_app(monkeypatch))
    job_id = client.post("/api/projects/grip_connect/refresh").json()["job_id"]
    poll = client.get(f"/api/projects/grip_connect/refresh/{job_id}")
    assert poll.status_code == 200
    assert poll.json()["status"] in ("running", "done")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && .venv/bin/pytest tests/test_refresh_endpoint.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'routers.refresh'`

- [ ] **Step 3: Write the router**

`backend/routers/refresh.py`:
```python
"""Manual refresh endpoint — async + polling, one job per project at a time.
Runs the same run_refresh() the CLI uses, in a background thread, in-container."""
import os
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, HTTPException

from services.duck import db
from services.integrations.metabase import MetabaseClient
from services.integrations import refresh as refresh_mod

router = APIRouter()

_JOBS: dict[str, dict] = {}          # job_id -> {status, log, error, ...}
_LOCKS: dict[str, threading.Lock] = {}  # project_id -> lock
DATA_DIR = Path(os.getenv("DATA_DIR", "./data"))


def _run_job(job_id: str, project_id: str):
    job = _JOBS[job_id]
    try:
        base = os.getenv("METABASE_URL", "https://metabase.gripinvest.in")
        email, password = os.getenv("METABASE_EMAIL"), os.getenv("METABASE_PASSWORD")
        if not email or not password:
            raise RuntimeError("METABASE_EMAIL/METABASE_PASSWORD not set")
        client = MetabaseClient(base)
        client.login(email, password)
        csv_dir = DATA_DIR / project_id
        result = refresh_mod.run_refresh(client, csv_dir)
        db.load_csvs_for_project(project_id, csv_dir)  # reload DuckDB
        job.update(status="done", log=result["log"],
                   finished_at=datetime.now(timezone.utc).isoformat())
    except Exception as exc:  # surfaced to the UI verbatim
        job.update(status="error", error=str(exc))
    finally:
        _LOCKS[project_id].release()


@router.post("/{project_id}/refresh")
def start_refresh(project_id: str):
    lock = _LOCKS.setdefault(project_id, threading.Lock())
    if not lock.acquire(blocking=False):
        running = next((j for j in _JOBS.values()
                        if j["project_id"] == project_id and j["status"] == "running"), None)
        raise HTTPException(409, detail={"message": "refresh already running",
                                         "job_id": running["job_id"] if running else None})
    job_id = uuid.uuid4().hex[:12]
    _JOBS[job_id] = {"job_id": job_id, "project_id": project_id,
                     "status": "running", "log": [], "error": None}
    threading.Thread(target=_run_job, args=(job_id, project_id), daemon=True).start()
    return {"job_id": job_id}


@router.get("/{project_id}/refresh/{job_id}")
def poll_refresh(project_id: str, job_id: str):
    job = _JOBS.get(job_id)
    if not job:
        raise HTTPException(404, detail="unknown job")
    return job
```

- [ ] **Step 4: Register the router in `backend/main.py`**

Add to the imports line (currently `from routers import projects, upload, chat`):
```python
from routers import projects, upload, chat, refresh
```
Add after the existing `app.include_router(...)` calls:
```python
app.include_router(refresh.router, prefix="/api/projects", tags=["refresh"])
```

- [ ] **Step 5: Document the env vars in `backend/.env.example`**

Append:
```
# Metabase — required for the live-data refresh (Grip Connect).
METABASE_URL=https://metabase.gripinvest.in
METABASE_EMAIL=
METABASE_PASSWORD=
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd backend && .venv/bin/pytest tests/test_refresh_endpoint.py -v`
Expected: PASS — 2 passed.

- [ ] **Step 7: Run the full backend suite**

Run: `cd backend && .venv/bin/pytest -q`
Expected: PASS — all tests green.

- [ ] **Step 8: Commit**

```bash
git add backend/routers/refresh.py backend/main.py backend/.env.example backend/tests/test_refresh_endpoint.py
git commit -m "feat: manual refresh endpoint with job polling"
```

---

# Phase 4 — Frontend

> Frontend has no JS test runner. These tasks verify manually + with a Playwright check script. Each task still ends with a commit.

### Task 9: API client methods

**Files:**
- Modify: `frontend/lib/api.ts`

- [ ] **Step 1: Add the refresh + poll methods**

In `frontend/lib/api.ts`, following the existing fetch-wrapper pattern in that file, add:
```typescript
// Kick a background refresh; returns a job id to poll.
export async function refreshProject(projectId: string): Promise<{ job_id: string }> {
  const res = await fetch(`/api/proxy/api/projects/${projectId}/refresh`, { method: "POST" });
  if (res.status === 409) {
    const body = await res.json();
    return { job_id: body?.detail?.job_id ?? "" };
  }
  if (!res.ok) throw new Error(`refresh failed: ${res.status}`);
  return res.json();
}

// Poll a refresh job. status is "running" | "done" | "error".
export async function pollRefresh(projectId: string, jobId: string):
  Promise<{ status: string; log?: string[]; error?: string | null }> {
  const res = await fetch(`/api/proxy/api/projects/${projectId}/refresh/${jobId}`);
  if (!res.ok) throw new Error(`poll failed: ${res.status}`);
  return res.json();
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/lib/api.ts
git commit -m "feat: refreshProject + pollRefresh API client methods"
```

---

### Task 10: On-open freshness + Refresh button

**Files:**
- Modify: `frontend/app/projects/[id]/page.jsx`
- Modify: `frontend/components/dashboards/GripConnectDashboardEditorial.jsx`
- Modify: `backend/data/grip_connect/project.json`

- [ ] **Step 1: Add freshness config to `project.json`**

Add these keys to `backend/data/grip_connect/project.json`:
```json
"refreshable": true,
"freshness": { "reuse_window_minutes": 60 }
```

- [ ] **Step 2: Add the Refresh button + state + as-of marker to the dashboard**

In `GripConnectDashboardEditorial.jsx`, add a header control. State machine: `idle → running → done(3s) → idle`, or `→ error`. Use `refreshProject` + `pollRefresh` (poll every 2s). On `done`, re-fetch the dashboard's queries and update in place; show `as of <_manifest.refreshed_at>`. On `error`, show a ⚠ chip whose click reveals `error`. The button is disabled for 60s after a refresh (cooldown) with a tooltip.

```jsx
// near the top of the component
const [refresh, setRefresh] = useState({ state: "idle", error: null });

async function handleRefresh() {
  setRefresh({ state: "running", error: null });
  try {
    const { job_id } = await refreshProject("grip_connect");
    // poll until terminal
    for (;;) {
      await new Promise((r) => setTimeout(r, 2000));
      const p = await pollRefresh("grip_connect", job_id);
      if (p.status === "done") { setRefresh({ state: "done", error: null }); break; }
      if (p.status === "error") { setRefresh({ state: "error", error: p.error }); return; }
    }
    await reloadDashboardData();           // re-run the project queries
    setTimeout(() => setRefresh({ state: "idle", error: null }), 3000);
  } catch (e) {
    setRefresh({ state: "error", error: String(e) });
  }
}
```
Render a button that calls `handleRefresh`, disabled while `state === "running"`. Touch target ≥44×44 px (mobile-first). The chip text: `Refreshing…` / `Updated ✓` / `Refresh failed ⚠`.

- [ ] **Step 3: Trigger background refresh on open when stale**

In `frontend/app/projects/[id]/page.jsx`, after the project loads, read `_manifest.json` (expose it via the existing query path or a small `/api/projects/{id}` field). If `refreshed_at` is older than `freshness.reuse_window_minutes`, call `handleRefresh()` once in a `useEffect` — the page has already rendered the cached snapshot, so this only updates in place. Never block the initial render on it.

- [ ] **Step 4: Manual verification — desktop**

Run: `cd frontend && npm run dev` and the backend (`cd backend && .venv/bin/uvicorn main:app --reload`).
Open `http://localhost:3000/projects/grip_connect`. Confirm: dashboard renders immediately; Refresh button visible; clicking it shows `Refreshing…` then `Updated ✓`; numbers stay sensible.

- [ ] **Step 5: Manual verification — mobile (375×844)**

In DevTools device mode at 375×844: no horizontal page scroll; the Refresh button is tappable (≥44px); the state chip is readable. Per `docs/ideation/mobile-first.md` §C.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/projects/[id]/page.jsx frontend/components/dashboards/GripConnectDashboardEditorial.jsx backend/data/grip_connect/project.json
git commit -m "feat: live refresh button + on-open freshness for Grip Connect"
```

---

### Task 11: Trend + funnel exhibits

**Files:**
- Modify: `frontend/components/dashboards/GripConnectDashboardEditorial.jsx`

- [ ] **Step 1: Add an AUM trend exhibit**

Add a section that queries `grip_connect__card_3843_summary_dod` (daily AUM) via the existing `/api/projects/grip_connect/query` path and renders a line chart (reuse the chart primitive in `frontend/components/charts/index.jsx`), one line per partner, x = date.

- [ ] **Step 2: Add the full reg→KYC funnel exhibit**

Add a section that queries `grip_connect__card_4499_kyc_funnel` and renders the funnel stages (`no_of_total_reg` → `%landed on PAN/full_reg` → `%_kyc_initiated` → `%ucc/kyc_initiation` → `%_fti_on_any_day/ucc`) per partner. Stage labels from `KYC_COLS` in the spec.

- [ ] **Step 3: Manual verification at 375 + 1280**

Run dev servers; confirm both exhibits render with data, legends visible without hover (mobile-first §A), no horizontal page scroll at 375×844.

- [ ] **Step 4: Commit**

```bash
git add frontend/components/dashboards/GripConnectDashboardEditorial.jsx
git commit -m "feat: AUM trend + reg-to-KYC funnel exhibits from layer-1 data"
```

---

# Phase 5 — Scheduled refresh

### Task 12: Daily GitHub Action

**Files:**
- Create: `.github/workflows/refresh-grip-connect.yml`

- [ ] **Step 1: Write the workflow**

`.github/workflows/refresh-grip-connect.yml`:
```yaml
name: Refresh Grip Connect data
on:
  schedule:
    - cron: "30 3 * * *"   # 09:00 IST daily
  workflow_dispatch: {}

jobs:
  refresh:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.12" }
      - name: Install deps
        run: pip install -r backend/requirements.txt
      - name: Run refresh
        working-directory: backend
        env:
          METABASE_URL: https://metabase.gripinvest.in
          METABASE_EMAIL: ${{ secrets.METABASE_EMAIL }}
          METABASE_PASSWORD: ${{ secrets.METABASE_PASSWORD }}
        run: python -m services.integrations.refresh
      - name: Commit refreshed data if changed
        run: |
          git config user.name  "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add backend/data/grip_connect/
          git diff --staged --quiet || git commit -m "chore: refresh Grip Connect data"
          git push
```

- [ ] **Step 2: Document the required secrets**

Add to the repo README (or `docs/specs/...`): the workflow needs repo secrets `METABASE_EMAIL` and `METABASE_PASSWORD` set under Settings → Secrets → Actions. Note this in the commit message since the secrets cannot be set from code.

- [ ] **Step 3: Verify YAML is valid**

Run: `python -c "import yaml,sys; yaml.safe_load(open('.github/workflows/refresh-grip-connect.yml'))"`
Expected: no output, exit 0.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/refresh-grip-connect.yml
git commit -m "ci: daily scheduled Grip Connect data refresh"
```

---

# Post-implementation — live validation (needs Metabase credentials)

Not a code task — the cut-over gate. Once `METABASE_EMAIL`/`METABASE_PASSWORD` are available:

- [ ] Put creds in `backend/.env`. Run `cd backend && .venv/bin/python -m services.integrations.refresh`.
- [ ] Confirm `backend/data/grip_connect/card_*.csv` and `01_north_star.csv` / `02_reg_to_kyc.csv` are written.
- [ ] Diff the new `01_north_star.csv` numbers against the previous hand-exported CSV and the gc-analyst digest — they should match. If a card's `week`/`date` column name differs from the `KEYS` assumption in `refresh.py`, fix `KEYS` (the spec §16 Phase-1 pin) and re-run.
- [ ] Run `cd backend && .venv/bin/pytest -q` — all green.

---

## Self-Review

**Spec coverage** — every spec section maps to a task:
- §4/§6 fetch module → Tasks 2–6 · §7 two-layer model → Tasks 4 (build), 5 (accumulate) · §8 refresh (manual) → Task 8 · §8 scheduled → Task 12 · §9 frontend → Tasks 9–11 · §10 credentials → Task 8 step 5 · §11 validation → Task 7 · §12 error handling → Task 8 (`_run_job` try/except, 409 on concurrent) · §13 testing → tests in every backend task.
- Spec §5 lists `backend/build_duckdb.py` "confirm naming" — covered implicitly: the new CSVs use the `{project}__{stem}` rule via the existing loader; no code change. The live-validation checklist confirms the tables appear.

**Placeholder scan** — no TBD/TODO; all code blocks complete. The one genuine unknown (exact card column names) is explicitly handled: column *detectors* (`detect_week_column` etc.) are used instead of hardcoded names, and the live-validation checklist is the pin point.

**Type consistency** — `MetabaseClient.fetch_card` / `card_param_id` signatures match their use in `build_layer1`; `run_refresh(client, data_dir, partners, active_week_start)` matches its call in `routers/refresh.py` and the tests; `_JOBS` / `_LOCKS` names consistent across Task 8.
