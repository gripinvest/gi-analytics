"""Deterministic checks on refresh output. Run after a refresh; a non-empty
return list means something is wrong and should block cut-over / page an alert."""

VALID_METRICS = {"AUM", "FTI", "Repeat"}


def validate_north_star(rows: list[dict], expected_partners: set[str]) -> list[str]:
    errors: list[str] = []
    seen = {r.get("partner") for r in rows}
    for p in expected_partners - seen:
        errors.append(f"missing partner: {p}")
    for r in rows:
        if r.get("metric") not in VALID_METRICS:
            errors.append(f"unexpected metric: {r.get('metric')}")
        mtd = r.get("mtd")
        if mtd is not None and not isinstance(mtd, (int, float)):
            errors.append(f"non-numeric mtd for {r.get('partner')}/{r.get('metric')}")
    return errors


# ── Asset Search fetch validation (spec §14) ────────────────────────────────
#
# Post-fetch sanity checks on one (feature-week, event) CSV's rows. They guard
# the fetch *output*: schema drift, a test-user leak, a window bug. Metric
# correctness is a separate concern — that is validate_asset_search.py (S3).

ASSET_SEARCH_TEST_USERS = {3, 4, 207871, 207875, 207878, 207879}

# Minimum columns each search event must carry for the assetSearch.js builders
# to work — the schema-drift early warning. Scoped to the W4+ full-payload
# schema (the W1-W3 thin schema is frozen and out of scope).
ASSET_SEARCH_REQUIRED_COLS = {
    "asset_search_query": {"timestamp", "context_session_id", "query_text",
                           "results_count", "is_refinement"},
    "asset_search_result_clicked": {"timestamp", "context_session_id",
                                    "query_text", "result_position"},
    "asset_search_initiated": {"timestamp", "context_session_id"},
    "asset_search_empty_state": {"timestamp", "query_text"},
    "asset_search_cleared": {"timestamp", "context_session_id"},
    "asset_search_suggestion_clicked": {"timestamp", "context_session_id"},
}


def _as_int(v):
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return None


def _ts_in_window(ts, start, end) -> bool:
    """`ts` (any date/datetime string) falls in the half-open [start, end)."""
    if ts is None:
        return False
    day = str(ts)[:10]              # 'YYYY-MM-DD' prefix
    return str(start) <= day < str(end)


def validate_asset_search_week(stem: str, rows: list[dict],
                               start, end) -> list[str]:
    """Validate one fetched (feature-week, event) CSV. `start`/`end` are the
    week's [start, end) date bounds. A non-empty return list means the fetch
    output is suspect and should block cut-over / page an alert (spec §14)."""
    errors: list[str] = []
    if not rows:
        return [f"{stem}: zero rows"]
    cols = set(rows[0].keys())

    for table, required in ASSET_SEARCH_REQUIRED_COLS.items():
        if stem.endswith(table):
            missing = required - cols
            if missing:
                errors.append(f"{stem}: missing columns {sorted(missing)}")
            break

    if "user_id" in cols:
        leaked = sorted({_as_int(r.get("user_id")) for r in rows
                         if _as_int(r.get("user_id")) in ASSET_SEARCH_TEST_USERS})
        if leaked:
            errors.append(f"{stem}: test-user rows leaked: {leaked}")

    if "timestamp" in cols:
        out = sum(1 for r in rows
                  if not _ts_in_window(r.get("timestamp"), start, end))
        if out:
            errors.append(
                f"{stem}: {out} rows with timestamp outside [{start}, {end})")

    return errors


def validate_asset_search_row_counts(event: str, by_week: dict[int, int],
                                     *, factor: int = 10) -> list[str]:
    """Row-count sanity band (spec §14): flag a >`factor`x swing in one event's
    row count between consecutive feature weeks. A 10x jump or collapse is
    almost always a fetch bug (a broken window, a schema change, a duplicate
    join) rather than real product movement. Weeks with zero rows are skipped —
    the per-week check already flags those — so this never divides by zero."""
    errors: list[str] = []
    weeks = sorted(by_week)
    for prev, cur in zip(weeks, weeks[1:]):
        a, b = by_week[prev], by_week[cur]
        if a == 0 or b == 0:
            continue
        if max(a, b) / min(a, b) > factor:
            errors.append(
                f"{event}: row-count swing W{prev}={a} -> W{cur}={b} (>{factor}x)")
    return errors
