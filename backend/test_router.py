"""
Local router test harness.

Run: cd backend && .venv/bin/python test_router.py

Hits the real Anthropic API using the local .env's ANTHROPIC_API_KEY.
Exercises select_model with a battery of conversations covering the
failure modes we've seen ('what are the conversion numbers for these
terms', 'what is ZRR', etc.) plus baseline simple/complex/off-topic
cases. Each case lists what we EXPECT vs what we GET.

Don't commit results — this is for local iteration only.
"""

from dotenv import load_dotenv
load_dotenv()

from services.claude import select_model  # noqa: E402  (after load_dotenv)

CASES = [
    # (label, expected_routing, messages)
    (
        "simple lookup",
        "haiku",
        [{"role": "user", "content": "Show the top 10 most-searched terms"}],
    ),
    (
        "follow-up with pronoun (the failing case)",
        "haiku|sonnet",
        [
            {"role": "user", "content": "Show the top 10 most-searched terms"},
            {"role": "assistant", "content": "Here are the top 10: 1) muthoot, 2) navi, 3) ..."},
            {"role": "user", "content": "what are the conversion numbers for these terms"},
        ],
    ),
    (
        "definition question — ZRR",
        "haiku",
        [{"role": "user", "content": "what is ZRR?"}],
    ),
    (
        "definition follow-up — ZRR after context",
        "haiku",
        [
            {"role": "user", "content": "Show me the ZRR by week"},
            {"role": "assistant", "content": "ZRR by week: W1=52%, W2=44.6%, ..."},
            {"role": "user", "content": "what is ZRR?"},
        ],
    ),
    (
        "complex analysis",
        "sonnet|opus",
        [{"role": "user", "content": "Why did adoption drop in W5 and what does it correlate with?"}],
    ),
    (
        "clearly off-topic",
        "reject",
        [{"role": "user", "content": "Tell me a joke about programmers"}],
    ),
    (
        "off-topic small talk",
        "reject",
        [{"role": "user", "content": "How is your day going?"}],
    ),
    (
        "ambiguous one-word follow-up",
        "haiku|sonnet",
        [
            {"role": "user", "content": "Show me the top 10 search terms"},
            {"role": "assistant", "content": "Here are the top 10 search terms..."},
            {"role": "user", "content": "why?"},
        ],
    ),
]


def run():
    print(f"{'case':<55} {'expected':<15} {'got':<10} {'verdict'}")
    print("-" * 95)
    for label, expected, messages in CASES:
        _, got_label = select_model(messages)
        ok_options = expected.split("|")
        verdict = "✓" if got_label in ok_options else "✗ FAIL"
        print(f"{label:<55} {expected:<15} {got_label:<10} {verdict}")


if __name__ == "__main__":
    run()
