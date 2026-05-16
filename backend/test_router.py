"""
Local router test harness.

Run: cd backend && .venv/bin/python test_router.py

Hits the real Anthropic API using the local .env's ANTHROPIC_API_KEY.
Exercises select_model with a battery of conversations covering the
failure modes we've seen ('what are the conversion numbers for these
terms', 'what is ZRR', etc.) plus baseline simple/complex/off-topic
cases — across BOTH the asset_search and grip_connect projects, since
the router is now project-context-aware.

Each case lists what we EXPECT vs what we GET.
Don't commit results — this is for local iteration only.
"""

from dotenv import load_dotenv
load_dotenv()

from services.claude import select_model, _project_chat_context  # noqa: E402

ASSET_SEARCH_CTX = _project_chat_context("asset_search")
GRIP_CONNECT_CTX = _project_chat_context("grip_connect")

CASES = [
    # (label, expected_routing, messages, project_context)
    (
        "[asset_search] simple lookup",
        "haiku",
        [{"role": "user", "content": "Show the top 10 most-searched terms"}],
        ASSET_SEARCH_CTX,
    ),
    (
        "[asset_search] follow-up with pronoun",
        "haiku|sonnet",
        [
            {"role": "user", "content": "Show the top 10 most-searched terms"},
            {"role": "assistant", "content": "Here are the top 10: 1) muthoot, 2) navi, 3) ..."},
            {"role": "user", "content": "what are the conversion numbers for these terms"},
        ],
        ASSET_SEARCH_CTX,
    ),
    (
        "[asset_search] definition — ZRR",
        "haiku",
        [{"role": "user", "content": "what is ZRR?"}],
        ASSET_SEARCH_CTX,
    ),
    (
        "[asset_search] complex analysis",
        "sonnet|opus",
        [{"role": "user", "content": "Why did adoption drop in W5 and what does it correlate with?"}],
        ASSET_SEARCH_CTX,
    ),
    (
        "[asset_search] off-topic joke",
        "reject",
        [{"role": "user", "content": "Tell me a joke about programmers"}],
        ASSET_SEARCH_CTX,
    ),
    # ── Grip Connect project ────────────────────────────────────────────────
    (
        "[grip_connect] simple lookup — AUM",
        "haiku",
        [{"role": "user", "content": "Show AUM for each partner"}],
        GRIP_CONNECT_CTX,
    ),
    (
        "[grip_connect] comparison",
        "sonnet|opus",
        [{"role": "user", "content": "Compare the registration-to-KYC funnel across all four partners and tell me who's leaking the most"}],
        GRIP_CONNECT_CTX,
    ),
    (
        "[grip_connect] definition — FTI",
        "haiku",
        [{"role": "user", "content": "what does FTI mean?"}],
        GRIP_CONNECT_CTX,
    ),
    (
        "[grip_connect] follow-up with pronoun",
        "haiku|sonnet",
        [
            {"role": "user", "content": "Show AUM by partner"},
            {"role": "assistant", "content": "AUM: ET Money 5.24Cr, Paisa Bazaar 7.26Cr, ..."},
            {"role": "user", "content": "which of these grew the most month over month?"},
        ],
        GRIP_CONNECT_CTX,
    ),
    (
        "[grip_connect] off-topic joke (must still reject)",
        "reject",
        [{"role": "user", "content": "Tell me a joke about programmers"}],
        GRIP_CONNECT_CTX,
    ),
]


def run():
    print(f"{'case':<48} {'expected':<14} {'got':<9} {'verdict'}")
    print("-" * 88)
    fails = 0
    for label, expected, messages, ctx in CASES:
        _, got_label = select_model(messages, ctx)
        ok_options = expected.split("|")
        ok = got_label in ok_options
        if not ok:
            fails += 1
        verdict = "OK" if ok else "FAIL"
        print(f"{label:<48} {expected:<14} {got_label:<9} {verdict}")
    print("-" * 88)
    print(f"{len(CASES) - fails}/{len(CASES)} passed")


if __name__ == "__main__":
    run()
