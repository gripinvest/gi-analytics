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

from . import asset_search, grip_connect, learn_education, performance_grip
from .metabase import MetabaseClient

# project_id -> run callable. Signature: run(client, data_dir) -> dict.
REGISTRY = {
    "grip_connect": grip_connect.run,
    "asset_search": asset_search.run,
    "performance_grip": performance_grip.run,
    "learn_education": learn_education.run,
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
    """Standalone CLI:  python -m services.integrations.refresh [project_id] [--since YYYY-MM-DD] [--validate]

    project_id defaults to 'grip_connect' for back-compat. --since is optional
    and only consumed by projects that accept a backfill window. --validate runs
    the project's post-fetch validator after the refresh and exits non-zero if
    it finds anything wrong — so a cron step can block a bad commit (spec §14).
    """
    from dotenv import load_dotenv
    load_dotenv()
    argv = sys.argv[1:] if argv is None else argv

    # Parse args: positional project_id, optional --since YYYY-MM-DD, optional --validate.
    positional = [a for a in argv if not a.startswith("--")]
    # Value-bearing flags (--key value); bool flags like --validate ignored here.
    flags = {argv[i]: argv[i + 1] for i in range(len(argv) - 1)
             if argv[i].startswith("--") and not argv[i + 1].startswith("--")}
    do_validate = "--validate" in argv
    project_id = positional[0] if positional else "grip_connect"

    if project_id not in REGISTRY:
        print(f"ERROR: unknown project '{project_id}' — one of {sorted(REGISTRY)}",
              file=sys.stderr)
        return 1

    # Per-project client selection. New Relic projects use NerdGraph;
    # everything else uses Metabase (current pattern).
    if project_id == "performance_grip":
        from .new_relic import NewRelicClient
        from .performance_grip import validate_since
        from datetime import datetime
        from zoneinfo import ZoneInfo

        api_key = os.getenv("NEW_RELIC_API_KEY")
        account_id = os.getenv("NEW_RELIC_ACCOUNT_ID")
        region = os.getenv("NEW_RELIC_REGION", "US")
        if not api_key or not account_id:
            print("ERROR: set NEW_RELIC_API_KEY and NEW_RELIC_ACCOUNT_ID", file=sys.stderr)
            return 1

        client = NewRelicClient(api_key=api_key, account_id=int(account_id), region=region)

        since_str = flags.get("--since") or os.getenv("SINCE", "").strip()
        since_dt = validate_since(since_str, now=datetime.now(ZoneInfo("Asia/Kolkata")))
        kwargs = {"since": since_dt}
    else:
        # Metabase path (existing behavior)
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
        kwargs = {}

    data_dir = Path(os.getenv("DATA_DIR", "./data")) / project_id  # underscore-style (CB1)
    result = REGISTRY[project_id](client, data_dir, **kwargs)
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
    return 0 if result["status"] in ("ok", "partial") else 1


if __name__ == "__main__":
    raise SystemExit(main())
