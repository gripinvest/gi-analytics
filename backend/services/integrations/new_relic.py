"""New Relic NerdGraph (GraphQL) client.

Mirrors `metabase.py`'s shape — a thin httpx-based wrapper exposing one
method (`nrql`) for project fetch modules. No business logic here.

Auth: Insights Query Key (preferred) or User API Key (fallback). Both sent
in the `Api-Key` header. See spec §5.4.
"""
from __future__ import annotations
import json


class NewRelicError(Exception):
    """Raised when NerdGraph returns a GraphQL-level error (HTTP 200 + errors envelope)
    or a malformed response body (H1)."""


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
