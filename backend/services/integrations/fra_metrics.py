"""Pure numeric helpers for FRA metric tables. No I/O, no domain logic."""


def median(values):
    xs = sorted(values)
    n = len(xs)
    if n == 0:
        return 0
    mid = n // 2
    return xs[mid] if n % 2 else (xs[mid - 1] + xs[mid]) / 2


def percentile(values, pct):
    """Linear-interpolation percentile. pct in [0, 100]."""
    xs = sorted(values)
    if not xs:
        return 0
    if len(xs) == 1:
        return xs[0]
    rank = (pct / 100) * (len(xs) - 1)
    lo = int(rank)
    hi = min(lo + 1, len(xs) - 1)
    frac = rank - lo
    return xs[lo] + (xs[hi] - xs[lo]) * frac


def gini(values):
    """Gini coefficient: 0 = perfectly equal, 1 = all on one item."""
    xs = sorted(v for v in values if v >= 0)
    n = len(xs)
    total = sum(xs)
    if n == 0 or total == 0:
        return 0.0
    weighted = sum((2 * (i + 1) - n - 1) * x for i, x in enumerate(xs))
    return weighted / (n * total)


def safe_div(num, den):
    return num / den if den else 0.0
