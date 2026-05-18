from services.integrations.fra_classify import classify_video


def test_category_from_keywords():
    assert classify_video("How Are Bonds Taxed in India?", ["taxation"])["category"] == "Taxation"
    assert classify_video("YTM vs Coupon Rate Explained", [])["category"] == "Bond Basics"
    assert classify_video("Are Corporate Bonds Really Safe?", ["risk"])["category"] == "Risk/Safety"
    assert classify_video("Random vlog", [])["category"] == "Other"


def test_title_pattern_flags():
    r = classify_video("How to Earn ₹12,000/Month?", [])
    assert r["is_question_title"] is True
    assert r["has_rupee_or_number"] is True
    assert r["title_length"] == len("How to Earn ₹12,000/Month?")

    r2 = classify_video("Bond Basics Explained", [])
    assert r2["is_question_title"] is False
    assert r2["has_rupee_or_number"] is False
