from services.integrations.fra_metrics import gini, percentile, median


def test_median():
    assert median([100, 400, 1000, 3000, 8000]) == 1000
    assert median([1, 3]) == 2.0
    assert median([]) == 0


def test_percentile():
    data = [100, 400, 1000, 3000, 8000]
    assert percentile(data, 0) == 100
    assert percentile(data, 100) == 8000
    assert percentile(data, 50) == 1000


def test_gini_known_values():
    assert gini([5, 5, 5, 5]) == 0.0          # perfectly equal
    assert round(gini([0, 0, 0, 100]), 3) == 0.750
