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
