import csv
from services.integrations.accumulate import upsert_csv


def _read(path):
    with open(path) as f:
        return list(csv.DictReader(f))


def test_upsert_creates_file_when_absent(tmp_path):
    path = tmp_path / "t.csv"
    upsert_csv(path, [{"partner": "ET", "week": "w1", "aum": "10"}], key=["partner", "week"])
    assert _read(path) == [{"partner": "ET", "week": "w1", "aum": "10"}]


def test_upsert_appends_new_keys_and_overwrites_existing(tmp_path):
    path = tmp_path / "t.csv"
    upsert_csv(path, [{"partner": "ET", "week": "w1", "aum": "10"}], key=["partner", "week"])
    upsert_csv(path, [
        {"partner": "ET", "week": "w1", "aum": "11"},   # correction -> overwrite
        {"partner": "ET", "week": "w2", "aum": "20"},   # new -> append
    ], key=["partner", "week"])
    rows = sorted(_read(path), key=lambda r: r["week"])
    assert rows == [{"partner": "ET", "week": "w1", "aum": "11"},
                    {"partner": "ET", "week": "w2", "aum": "20"}]
