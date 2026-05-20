"""Unit tests for new_relic.py — fixture-driven, no network calls."""
import json
from pathlib import Path
from unittest.mock import MagicMock, patch

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
    assert captured["headers"]["API-Key"] == "my-secret-key"
    assert "account(id: 98765)" in captured["json"]["query"]
    assert "SELECT count(*) FROM PageViewTiming" in captured["json"]["query"]
