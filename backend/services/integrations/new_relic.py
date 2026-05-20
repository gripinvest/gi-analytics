"""New Relic NerdGraph (GraphQL) client.

Mirrors `metabase.py`'s shape — a thin httpx-based wrapper exposing one
method (`nrql`) for project fetch modules. No business logic here.

Auth: Insights Query Key (preferred) or User API Key (fallback). Both sent
in the `Api-Key` header. See spec §5.4.
"""
from __future__ import annotations
import json
import random
import time


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
        """Execute one NRQL query via NerdGraph. Returns facet rows.

        Retries 3× on transient errors with backoff + ±25% jitter, capped at 30s.
        Retryable: 5xx HTTP status, httpx.RequestError (timeouts, ConnectError —
        common on cron-driven networks; H2).
        4xx HTTP status: fail loud, no retry.
        """
        import httpx

        graphql_query = (
            "{ actor { account(id: %d) { nrql(query: %s) { results } } } }"
            % (self.account_id, json.dumps(query))
        )

        backoff_seconds = [1.0, 4.0, 16.0]

        with httpx.Client(timeout=30.0) as http:
            for attempt in range(len(backoff_seconds) + 1):
                retryable = False
                try:
                    response = http.post(
                        self.endpoint,
                        headers={"API-Key": self.api_key, "Content-Type": "application/json"},
                        json={"query": graphql_query},
                    )
                    response.raise_for_status()
                    body = response.json()
                    # H1: handle GraphQL errors envelope (HTTP 200 + body.errors)
                    if body.get("errors"):
                        raise NewRelicError(f"NerdGraph errors: {body['errors']}")
                    nrql_block = body.get("data", {}).get("actor", {}).get("account", {}).get("nrql")
                    if nrql_block is None:
                        raise NewRelicError(f"NerdGraph returned null nrql block: {body}")
                    return nrql_block["results"]
                except httpx.HTTPStatusError as e:
                    status = e.response.status_code if e.response else 0
                    retryable = status >= 500
                    if not retryable or attempt >= len(backoff_seconds):
                        raise
                except httpx.RequestError:  # H2: timeouts, ConnectError, etc.
                    retryable = True
                    if attempt >= len(backoff_seconds):
                        raise

                if retryable:
                    base = backoff_seconds[attempt]
                    jitter = random.uniform(-0.25, 0.25) * base
                    time.sleep(min(base + jitter, 30.0))
