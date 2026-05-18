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


def test_run_sql_parses_cols_and_rows():
    def handler(request):
        if request.url.path == "/api/session":
            return httpx.Response(200, json={"id": "tok"})
        assert request.url.path == "/api/dataset"
        assert request.read()  # body carries the native query
        return httpx.Response(200, json={"data": {
            "cols": [{"name": "week"}, {"name": "rows"}],
            "rows": [["W1", 4183], ["W2", 4361]],
        }})
    c = _client(handler)
    c.login("e@x.com", "pw")
    rows, cols = c.run_sql(8, "SELECT 1")
    assert cols == ["week", "rows"]
    assert rows == [{"week": "W1", "rows": 4183}, {"week": "W2", "rows": 4361}]


def test_run_sql_surfaces_sql_error():
    # Metabase returns HTTP 202 with status=failed for a bad native query.
    def handler(request):
        if request.url.path == "/api/session":
            return httpx.Response(200, json={"id": "tok"})
        return httpx.Response(202, json={"status": "failed",
                                         "error": "column \"nope\" does not exist"})
    c = _client(handler)
    c.login("e@x.com", "pw")
    with pytest.raises(MetabaseError, match="does not exist"):
        c.run_sql(8, "SELECT nope")


def test_run_sql_before_login_raises():
    c = _client(lambda r: httpx.Response(200, json={}))
    with pytest.raises(MetabaseError, match="Not logged in"):
        c.run_sql(8, "SELECT 1")


def test_api_key_auth_skips_login_and_sends_header():
    seen = {}

    def handler(request):
        seen["api_key"] = request.headers.get("X-API-Key")
        seen["session"] = request.headers.get("X-Metabase-Session")
        return httpx.Response(200, json={"data": {
            "cols": [{"name": "n"}], "rows": [[1]]}})

    c = MetabaseClient("https://mb.test", api_key="mb_readonly_key",
                       client=httpx.Client(transport=httpx.MockTransport(handler)))
    rows, _ = c.run_sql(8, "SELECT 1")    # note: no login() call
    assert seen["api_key"] == "mb_readonly_key"
    assert seen["session"] is None
    assert rows == [{"n": 1}]
