from datetime import date

import pytest

from services.integrations import feature_week as fw


def test_week_of_launch_and_boundaries():
    assert fw.week_of(date(2026, 4, 2)) == 1          # launch day
    assert fw.week_of(date(2026, 4, 8)) == 1          # last day of W1
    assert fw.week_of(date(2026, 4, 9)) == 2          # first day of W2
    assert fw.week_of(date(2026, 5, 14)) == 7         # W7 day 1
    assert fw.week_of(date(2026, 5, 20)) == 7         # W7 last day
    assert fw.week_of(date(2026, 5, 21)) == 8         # W8 day 1


def test_week_of_before_launch_raises():
    with pytest.raises(ValueError):
        fw.week_of(date(2026, 4, 1))


def test_bounds_are_half_open_and_contiguous():
    assert fw.bounds(1) == (date(2026, 4, 2), date(2026, 4, 9))
    assert fw.bounds(7) == (date(2026, 5, 14), date(2026, 5, 21))
    # consecutive weeks abut exactly — no gap, no overlap (data-integrity #2).
    assert fw.bounds(7)[1] == fw.bounds(8)[0]


def test_label_matches_existing_csv_naming():
    # Hyphen-joined, inclusive last day — must match the committed W1-W6 files.
    assert fw.label(1) == "W1_apr02-apr08"
    assert fw.label(4) == "W4_apr23-apr29"
    assert fw.label(7) == "W7_may14-may20"


def test_is_rollover():
    assert fw.is_rollover(date(2026, 5, 14)) is True    # W7 day 1
    assert fw.is_rollover(date(2026, 5, 15)) is False
    assert fw.is_rollover(date(2026, 5, 21)) is True    # W8 day 1


def test_current_and_prior_clamps_to_first_live_week():
    # Mid-W7: prior week W6 is frozen, so only W7 is fetchable.
    assert fw.current_and_prior(date(2026, 5, 15)) == [7]
    # Mid-W8: W7 and W8 are both live.
    assert fw.current_and_prior(date(2026, 5, 24)) == [7, 8]
    # During a frozen week, nothing is fetched.
    assert fw.current_and_prior(date(2026, 5, 1)) == []
