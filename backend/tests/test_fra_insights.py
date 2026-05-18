import base64
import pytest
from fastapi.testclient import TestClient
import routers.fra_insights as mod
from main import app

# BasicAuthMiddleware demo credentials (backend/main.py defaults).
_AUTH = "Basic " + base64.b64encode(b"gripper:unicorn@grip.status").decode()
client = TestClient(app, headers={"Authorization": _AUTH})


def test_insights_endpoint_caches_per_snapshot(monkeypatch, tmp_path):
    calls = []

    def fake_generate(brief):
        calls.append(brief)
        return {"verdict": "stub", "strengths": [], "weaknesses": [], "recommendations": []}

    monkeypatch.setattr(mod, "_generate_insights", fake_generate)
    monkeypatch.setattr(mod, "_latest_snapshot_date", lambda: "2026-05-18")
    monkeypatch.setattr(mod, "_build_brief", lambda: {"overview": []})
    monkeypatch.setattr(mod, "_INSIGHTS_DIR", tmp_path)   # isolate the disk cache
    mod._CACHE.clear()

    r1 = client.get("/api/projects/fra_youtube/insights")
    r2 = client.get("/api/projects/fra_youtube/insights")
    assert r1.status_code == 200
    assert r1.json()["verdict"] == "stub"
    assert r1.json()["snapshot_date"] == "2026-05-18"
    assert len(calls) == 1                               # second call served from cache
    assert (tmp_path / "_insights_2026-05-18.json").exists()   # persisted to disk


def test_extract_json_survives_prose_wrapped_output():
    assert mod._extract_json('Here is the analysis:\n{"verdict": "ok"}\nDone.') == {"verdict": "ok"}
    assert mod._extract_json('```json\n{"verdict": "ok"}\n```') == {"verdict": "ok"}
    with pytest.raises(ValueError):
        mod._extract_json("no json object here")
