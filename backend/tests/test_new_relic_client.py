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
