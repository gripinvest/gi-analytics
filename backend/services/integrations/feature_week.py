"""Feature-week math for the Asset Search live-data fetch.

A "feature week" is a fixed 7-day window counted from the Asset Search launch
on 2 Apr 2026: W1 = Apr 2-8, W2 = Apr 9-15, ... Every fetch is windowed by
feature week (spec §6.4 / decision D2) and every CSV filename embeds the week
label.

Pure date arithmetic — no I/O, no network. Deterministic and unit-tested.
"""
from datetime import date, timedelta

LAUNCH = date(2026, 4, 2)        # W1, day 1
WEEK_LEN = 7

# W1-W6 are frozen hand-exports (spec §11). The fetch never touches a week
# below this — current_and_prior() clamps to it, so the first daily run cannot
# rewrite the committed W6 CSVs (re-fetching W1-W3 would also corrupt them: the
# legacy thin `asset_search_cleared` schema differs from a fresh SELECT *).
FIRST_LIVE_WEEK = 7


def week_of(d: date) -> int:
    """The 1-based feature-week number containing date `d`."""
    if d < LAUNCH:
        raise ValueError(f"{d} precedes the Asset Search launch ({LAUNCH})")
    return (d - LAUNCH).days // WEEK_LEN + 1


def bounds(n: int) -> tuple[date, date]:
    """The half-open [start, end) date window for feature week `n`.

    `end` is exclusive: the fetch SQL uses `timestamp >= start AND
    timestamp < end`, so consecutive weeks abut exactly and no event can land
    in two week-files (spec §7, data-integrity mechanism 2).
    """
    if n < 1:
        raise ValueError(f"feature week must be >= 1, got {n}")
    start = LAUNCH + timedelta(days=WEEK_LEN * (n - 1))
    return start, start + timedelta(days=WEEK_LEN)


def label(n: int) -> str:
    """The CSV-stem fragment for week `n` — e.g. `W7_may14-may20`.

    The date range is hyphen-joined and the second date is the *inclusive*
    last day (start + 6). This must reproduce the existing W1-W6 filenames
    exactly so `build_duckdb.py`'s `{project}__{stem}` naming and
    `groupTables()`'s regex keep working (spec §6.2, critical naming rule).
    """
    start, end = bounds(n)
    last = end - timedelta(days=1)
    return (f"W{n}_{start.strftime('%b%d').lower()}"
            f"-{last.strftime('%b%d').lower()}")


def is_rollover(d: date) -> bool:
    """True when `d` is the first day of its feature week — the run on which
    the prior week has just fully closed. The daily job fetches the heavy
    browse/conversion tables only on a rollover run (spec D7)."""
    return bounds(week_of(d))[0] == d


def current_and_prior(today: date) -> list[int]:
    """The trailing 2-week refetch window (spec D3): the in-progress week and
    the one before it, clamped to >= FIRST_LIVE_WEEK so a frozen week is never
    returned. Sorted ascending; may be 0, 1 or 2 weeks."""
    cur = week_of(today)
    return [w for w in (cur - 1, cur) if w >= FIRST_LIVE_WEEK]
