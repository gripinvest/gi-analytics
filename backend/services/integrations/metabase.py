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
