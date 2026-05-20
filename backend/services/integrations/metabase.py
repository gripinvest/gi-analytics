"""Deterministic Metabase REST client. No LLM, no browser — plain httpx.

Ported from gc-analyst's metabase_fetch.py (functions metabase_login /
fetch_question_data, lines 172-250), adapted to httpx (the backend's HTTP
library) and wrapped in a class so tests can inject a MockTransport.
"""
import httpx


class MetabaseError(RuntimeError):
    """Raised for auth failures and misuse — carries a human-readable message."""


class MetabaseClient:
    def __init__(self, base_url: str, client: httpx.Client | None = None,
                 api_key: str | None = None):
        """`api_key` — a Metabase API key (`X-API-Key`). When supplied the
        client authenticates with it directly and `login()` is unnecessary;
        scope the key read-only in Metabase for validation/read workloads."""
        self.base_url = base_url.rstrip("/")
        self._client = client or httpx.Client(timeout=90.0)
        self._token: str | None = None
        self._api_key = api_key

    def _auth_headers(self) -> dict[str, str]:
        """The auth header for an API call — an API key if one was given,
        otherwise the session token from login()."""
        if self._api_key:
            return {"X-API-Key": self._api_key}
        return {"X-Metabase-Session": self._require_token()}

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
            headers=self._auth_headers(),
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
            headers=self._auth_headers(),
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

    def run_sql(self, database_id: int, sql: str,
                raw_columns: bool = False) -> tuple[list[dict], list[str]]:
        """Run an ad-hoc native SQL query against `database_id` via /api/dataset;
        return (rows-as-dicts, column-names).

        Used by validation/diagnostic scripts and (paged) by the Asset Search
        fetch pipeline. NOTE: `/api/dataset` caps the result at Metabase's
        default 2000 `max-results-bare-rows`. The Asset Search fetch handles
        this by walking the rows with `ORDER BY id LIMIT 2000 OFFSET n` — see
        `asset_search._fetch_paginated`. A bad query comes back HTTP 202 with
        a JSON `error`/`status: failed` body (Metabase does not use 4xx for
        SQL errors), so that case is checked explicitly and surfaced as a
        MetabaseError.

        `raw_columns` — when True, column names are the raw DB column (`name`);
        when False (default) the humanised `display_name` is preferred. The
        fetch pipeline passes True so the CSV headers are the exact columns the
        `assetSearch.js` builders reference."""
        resp = self._client.post(
            f"{self.base_url}/api/dataset",
            headers=self._auth_headers(),
            json={"database": database_id, "type": "native",
                  "native": {"query": sql}},
        )
        if resp.status_code in (401, 403):
            raise MetabaseError("Metabase auth failed — check credentials")
        resp.raise_for_status()
        body = resp.json()
        if body.get("status") == "failed" or body.get("error"):
            raise MetabaseError(f"Metabase SQL error: {body.get('error', 'unknown')}")
        data = body.get("data", {})
        if raw_columns:
            cols = [c.get("name", f"col_{i}")
                    for i, c in enumerate(data.get("cols", []))]
        else:
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
