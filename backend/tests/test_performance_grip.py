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
