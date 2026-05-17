"""Accumulate fetched rows into a canonical CSV by upserting on a natural key.

History grows past the window a single card returns; a later fetch correcting
an earlier row overwrites it. Write is atomic (temp file + rename) so a crash
mid-write leaves the prior CSV intact.
"""
import csv
import os
from pathlib import Path


def upsert_csv(path, new_rows: list[dict], key: list[str]) -> None:
    path = Path(path)
    existing: dict[tuple, dict] = {}
    if path.exists():
        with open(path, newline="") as f:
            for row in csv.DictReader(f):
                existing[tuple(row.get(k, "") for k in key)] = row
    for row in new_rows:
        existing[tuple(str(row.get(k, "")) for k in key)] = {k: row.get(k) for k in row}

    merged = list(existing.values())
    if not merged:
        return
    fieldnames = list(merged[0].keys())
    tmp = path.with_suffix(path.suffix + ".tmp")
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(tmp, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(merged)
    os.replace(tmp, path)
