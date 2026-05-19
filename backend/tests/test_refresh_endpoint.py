import time

from fastapi.testclient import TestClient


def _app(monkeypatch, calls=None):
    """Build an app with the refresh router, with all I/O stubbed out:
    no network (Metabase login), no real fetch, no DuckDB reload.
    `calls` — optional list the stubbed run_refresh appends its args to."""
    monkeypatch.setenv("METABASE_EMAIL", "test@x.com")
    monkeypatch.setenv("METABASE_PASSWORD", "pw")

    import services.integrations.metabase as mb
    monkeypatch.setattr(mb.MetabaseClient, "login", lambda self, e, p: "tok")

    import services.integrations.refresh as refresh_mod

    def _stub_run_refresh(*args, **kwargs):
        if calls is not None:
            calls.append(args)
        return {"status": "ok", "log": ["done"], "refreshed_at": "now"}

    monkeypatch.setattr(refresh_mod, "run_refresh", _stub_run_refresh)

    import services.duck as duck_mod
    monkeypatch.setattr(duck_mod.db, "load_csvs_for_project", lambda *a, **k: None)

    from routers.refresh import router, _JOBS
    _JOBS.clear()
    from fastapi import FastAPI
    app = FastAPI()
    app.include_router(router, prefix="/api/projects")
    return app


def _wait_terminal(client, project_id, job_id):
    """Poll until the background job leaves 'running' — keeps tests deterministic."""
    for _ in range(100):
        status = client.get(f"/api/projects/{project_id}/refresh/{job_id}").json()["status"]
        if status != "running":
            return status
        time.sleep(0.02)
    return "running"


def test_post_refresh_returns_job_id(monkeypatch):
    client = TestClient(_app(monkeypatch))
    resp = client.post("/api/projects/proj_a/refresh")
    assert resp.status_code == 200
    assert "job_id" in resp.json()
    _wait_terminal(client, "proj_a", resp.json()["job_id"])  # let the thread finish


def test_poll_refresh_reports_status(monkeypatch):
    client = TestClient(_app(monkeypatch))
    job_id = client.post("/api/projects/proj_b/refresh").json()["job_id"]
    final = _wait_terminal(client, "proj_b", job_id)
    assert final == "done"


def test_refresh_dispatches_project_id_to_run_refresh(monkeypatch):
    # The router must pass the project_id as run_refresh's first arg
    # (spec D6) so the registry dispatches to the right project.
    calls: list = []
    client = TestClient(_app(monkeypatch, calls=calls))
    job_id = client.post("/api/projects/asset_search/refresh").json()["job_id"]
    _wait_terminal(client, "asset_search", job_id)
    assert calls and calls[0][0] == "asset_search"
