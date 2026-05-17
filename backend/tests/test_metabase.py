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
