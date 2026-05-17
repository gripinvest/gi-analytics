from services.integrations.validate import validate_north_star


def test_validate_passes_on_good_rows():
    rows = [{"partner": "ET Money", "metric": "AUM", "mtd": 50.0, "unit": "cr"}]
    errors = validate_north_star(rows, expected_partners={"ET Money"})
    assert errors == []


def test_validate_flags_missing_partner_and_bad_metric():
    rows = [{"partner": "ET Money", "metric": "BOGUS", "mtd": 1.0, "unit": "cr"}]
    errors = validate_north_star(rows, expected_partners={"ET Money", "MobiKwik"})
    assert any("MobiKwik" in e for e in errors)
    assert any("BOGUS" in e for e in errors)
