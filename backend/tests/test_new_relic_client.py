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


def test_nrql_retries_on_transient_5xx_with_correct_backoff():
    """Verify retry actually waits between attempts.

    Capture time.sleep calls; assert sleep durations approximate [1, 4]s
    within ±25% jitter. A no-retry implementation has 0 sleep calls and
    this test would fail.
    """
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

    sleep_calls: list[float] = []
    with patch("httpx.Client.post", side_effect=flaky_post):
        with patch("time.sleep", side_effect=lambda s: sleep_calls.append(s)):
            rows = client.nrql("SELECT count(*) FROM PageView")

    assert call_count[0] == 3
    assert rows == [{"n": 1}]
    # 2 sleeps for the 2 failed attempts before success
    assert len(sleep_calls) == 2, f"expected 2 sleeps, got {len(sleep_calls)}: {sleep_calls}"
    assert 0.75 <= sleep_calls[0] <= 1.25, f"first sleep {sleep_calls[0]} outside [0.75, 1.25]"
    assert 3.0 <= sleep_calls[1] <= 5.0, f"second sleep {sleep_calls[1]} outside [3.0, 5.0]"


def test_nrql_does_not_retry_on_4xx():
    """4xx errors must fail loud immediately; no sleeps, no retries."""
    import httpx
    client = NewRelicClient(api_key="x", account_id=1, region="US")
    call_count = [0]
    sleep_calls: list[float] = []

    def auth_fail(*args, **kwargs):
        call_count[0] += 1
        mock = MagicMock()
        mock.raise_for_status.side_effect = httpx.HTTPStatusError(
            "401", request=MagicMock(), response=MagicMock(status_code=401))
        return mock

    with patch("httpx.Client.post", side_effect=auth_fail):
        with patch("time.sleep", side_effect=lambda s: sleep_calls.append(s)):
            with pytest.raises(httpx.HTTPStatusError):
                client.nrql("SELECT count(*) FROM PageView")

    assert call_count[0] == 1
    assert sleep_calls == [], f"4xx must not retry; got sleeps {sleep_calls}"
