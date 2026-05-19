"""Refresh runner — a per-project registry with two entry points (spec D6):
  · imported by the refresh endpoint (routers/refresh.py)
  · run standalone:  python -m services.integrations.refresh <project_id>

Each project's fetch module exposes `run(client, data_dir) -> {status, log,
refreshed_at}`; `refresh.py` only dispatches. Adding a project = one REGISTRY
entry — no edit to the existing projects' code paths.
"""
import os
import sys
from pathlib import Path

from . import asset_search, grip_connect
from .metabase import MetabaseClient

# project_id -> run callable. Signature: run(client, data_dir) -> dict.
REGISTRY = {
    "grip_connect": grip_connect.run,
    "asset_search": asset_search.run,
}

# project_id -> post-fetch validator. Signature: validate(data_dir) -> list[str]
# (a non-empty list means the fetch output is suspect). Run by `--validate`
# after a refresh; a project absent here simply has no `--validate` support.
VALIDATORS = {
    "asset_search": asset_search.validate_data_dir,
}


def run_refresh(project_id: str, client, data_dir) -> dict:
    """Dispatch a refresh to the project's fetch module."""
    runner = REGISTRY.get(project_id)
    if runner is None:
        raise ValueError(
            f"no refresh runner registered for project '{project_id}' — "
            f"one of {sorted(REGISTRY)}")
    return runner(client, data_dir)


def main(argv: list[str] | None = None) -> int:
    """Standalone CLI: `python -m services.integrations.refresh [project_id] [--validate]`.
    project_id defaults to `grip_connect` so the existing GC workflow, which
    passes no argument, keeps working unchanged. `--validate` runs the
    project's post-fetch validator after the refresh and exits non-zero if it
    finds anything wrong — so a cron step can block a bad commit (spec §14)."""
    from dotenv import load_dotenv
    load_dotenv()
    argv = sys.argv[1:] if argv is None else argv
    flags = {a for a in argv if a.startswith("--")}
    positional = [a for a in argv if not a.startswith("--")]
    project_id = positional[0] if positional else "grip_connect"
    do_validate = "--validate" in flags
    if project_id not in REGISTRY:
        print(f"ERROR: unknown project '{project_id}' — one of {sorted(REGISTRY)}",
              file=sys.stderr)
        return 1

    base = os.getenv("METABASE_URL", "https://metabase.gripinvest.in")
    api_key = os.getenv("METABASE_API_KEY")
    email, password = os.getenv("METABASE_EMAIL"), os.getenv("METABASE_PASSWORD")
    if not api_key and not (email and password):
        print("ERROR: set METABASE_API_KEY, or METABASE_EMAIL and METABASE_PASSWORD",
              file=sys.stderr)
        return 1
    client = MetabaseClient(base, api_key=api_key)
    if not api_key:
        client.login(email, password)

    data_dir = Path(os.getenv("DATA_DIR", "./data")) / project_id
    result = run_refresh(project_id, client, data_dir)
    print("\n".join(result["log"]))
    print(f"Done ({result['status']}) — {result['refreshed_at']}")

    if do_validate:
        validator = VALIDATORS.get(project_id)
        if validator is None:
            print(f"note: --validate not supported for '{project_id}', skipping")
        else:
            errors = validator(data_dir)
            if errors:
                print("VALIDATION FAILED — fetch output is suspect:",
                      file=sys.stderr)
                for e in errors:
                    print(f"  - {e}", file=sys.stderr)
                return 1
            print(f"validation: ok ({project_id})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
