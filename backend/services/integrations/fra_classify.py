"""Deterministic keyword classification of FRA videos.

Category taxonomy and title-pattern flags follow the Feb 2026 competitive
analysis PDF. "Other" is the fallback. Rules are intentionally simple and
fully covered by tests; tune the keyword lists here when categories drift.
"""
import re

# Ordered: first matching category wins.
CATEGORY_RULES = [
    ("Income Strategy", ["passive income", "monthly income", "income strategy", "bond ladder"]),
    ("Taxation", ["tax", "taxed", "taxation"]),
    ("Risk/Safety", ["safe", "risk", "default", "secure"]),
    ("Myths/Mistakes", ["myth", "mistake", "truth", "lie", "scam"]),
    ("FD Comparison", ["fd ", "fixed deposit", "vs fd", "savings account"]),
    ("Asset Comparison", ["vs stock", "vs mutual", "debt vs", "stock market"]),
    ("Bond Types", ["g-sec", "government bond", "corporate bond", "sdi", "debenture"]),
    ("Macro/RBI", ["rbi", "inflation", "interest rate", "repo"]),
    ("Grip Platform", ["grip"]),
    ("Bond Basics", ["bond", "ytm", "coupon", "maturity", "yield"]),
]

_QUESTION_OPENERS = ("how", "why", "what", "is", "are", "can", "should", "does", "which")
# Covers Mahjong/Domino/misc (1F000), Emoticons/Transport/Misc Symbols (1F600–1FAFF),
# Misc Symbols & Arrows / Dingbats (2600–27BF), and Regional Indicator Symbols (flags).
# Intentionally excludes Misc Technical U+2300–U+25FF (arrows, box-drawing, etc.).
_EMOJI = re.compile(
    "[\U0001F000-\U0001FAFF\U00002600-\U000027BF\U0001F1E6-\U0001F1FF]"
)


def classify_video(title: str, tags: list[str]) -> dict:
    haystack = (title + " " + " ".join(tags or []) + " ").lower()
    category = "Other"
    for name, keywords in CATEGORY_RULES:
        if any(k in haystack for k in keywords):
            category = name
            break

    first_word = title.strip().lower().split(" ")[0] if title.strip() else ""
    is_question = first_word in _QUESTION_OPENERS or title.strip().endswith("?")

    return {
        "category": category,
        "is_question_title": is_question,
        "has_rupee_or_number": bool(re.search(r"[₹\d]", title)),
        "has_emoji": bool(_EMOJI.search(title)),
        "title_length": len(title),
    }
