"""
Chat ("Ask the data") eval harness.

Runs representative questions through the real stream_chat flow against the
local DuckDB + real Anthropic key, and checks each answer. Makes live API
calls (costs money, ~seconds each) — run manually, NOT in CI.

Usage (from backend/, with the .env key available):
    PYTHONPATH=. DATA_DIR=./data \
      <venv>/bin/python evals/chat_eval.py

It also measures the assembled system-prompt token count so we can see the
context footprint shrink after the on-demand-schema refactor.
"""
import os, re, json, asyncio, pathlib, sys

# load .env from backend/ (ANTHROPIC_API_KEY etc.)
_envp = pathlib.Path(__file__).resolve().parent.parent / ".env"
if _envp.exists():
    for line in _envp.read_text().splitlines():
        m = re.match(r"\s*([A-Z_]+)\s*=\s*(.*)\s*$", line)
        if m:
            os.environ.setdefault(m.group(1), m.group(2).strip().strip('"').strip("'"))
os.environ.setdefault("DATA_DIR", "./data")

import anthropic
from services.duck import db
db.load_all_projects()  # populate table list, like main.py's lifespan
from services import claude

PROJECT = "asset_search"

# Representative of what the business team + analysts actually ask.
EVALS = [
    # — definitional / methodology (the most common business-team questions) —
    {"q": "How is the zero-result rate (ZRR) calculated?", "type": "definition",
     "expect_any": ["results_count", "zero-result", "zero result", "/ ", "divided"]},
    {"q": "What does 'dead end' mean for a search session?", "type": "definition",
     "expect_any": ["never clicked", "zero result", "no result", "every query"],
     "expect_none": ["not a metric", "not in my glossary", "don't have", "do not have", "which metric", "which would you like"]},
    {"q": "Explain the difference between a relevance gap and a dead end.", "type": "definition",
     "expect_any": ["relevance", "clicked", "results"]},
    # — trivial / capability —
    {"q": "What kinds of questions can I ask you here?", "type": "trivial",
     "expect_any": ["search", "metric", "data", "zrr", "trend"]},
    # — data / numbers —
    {"q": "How many search queries were there in total?", "type": "data", "expect_digit": True},
    {"q": "What is the zero-result rate broken down by Grip Connect partner?", "type": "data",
     "expect_digit": True, "expect_any": ["et money", "mobikwik", "paisa", "%"]},
    {"q": "What is the overall dead-end rate? Give me the number.", "type": "data",
     "expect_digit": True, "expect_none": ["not a metric", "not in my glossary", "which metric"]},
    # — off-topic (must refuse) —
    {"q": "What's the capital of France?", "type": "offtopic",
     "expect_any": ["only answer", "this project", "can only", "this dashboard"]},
]


async def ask(question: str):
    chunks = []
    async for c in claude.stream_chat(PROJECT, [{"role": "user", "content": question}]):
        chunks.append(c)
    text, label = "", None
    for c in chunks:
        if not c.startswith("data: "):
            continue
        payload = c[6:].strip()
        if payload == "[DONE]":
            continue
        try:
            d = json.loads(payload)
        except Exception:
            continue
        if d.get("type") == "model":
            label = d.get("label")
        elif d.get("type") == "text":
            text += d.get("text", "")
    err = ("BadRequestError" in text) or ("Something broke on the backend" in text)
    return label, text, err


def measure_prompt_tokens():
    sysp = claude.build_system_prompt(PROJECT)
    chars = len(sysp)
    try:
        c = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
        ct = c.messages.count_tokens(
            model="claude-haiku-4-5-20251001",
            system=sysp,
            messages=[{"role": "user", "content": "x"}],
        )
        return chars, ct.input_tokens
    except Exception as e:
        return chars, f"count_tokens failed: {type(e).__name__}: {str(e)[:120]}"


async def main():
    chars, toks = measure_prompt_tokens()
    print(f"\n=== system-prompt footprint ===")
    print(f"  chars={chars}  tokens={toks}  (model input limit = 200000)\n")

    passed = 0
    for e in EVALS:
        label, text, err = await ask(e["q"])
        ok = not err
        why = "" if ok else "backend error"
        if ok and e.get("expect_digit"):
            if not re.search(r"\d", text):
                ok, why = False, "expected a number, got none"
        if ok and e.get("expect_any"):
            if not any(k.lower() in text.lower() for k in e["expect_any"]):
                ok, why = False, f"missing any of {e['expect_any']}"
        if ok and e.get("expect_none"):
            hit = next((k for k in e["expect_none"] if k.lower() in text.lower()), None)
            if hit:
                ok, why = False, f"contains forbidden phrase {hit!r}"
        if ok and e["type"] == "offtopic" and label and label != "reject":
            # acceptable if it still refused in text, but flag if it engaged
            if not any(k.lower() in text.lower() for k in e["expect_any"]):
                ok, why = False, "off-topic not refused"
        passed += ok
        print(f"[{'PASS' if ok else 'FAIL'}] ({e['type']:10}) {e['q'][:52]}")
        print(f"        label={label} err={err} {('· ' + why) if why else ''}")
        print(f"        answer: {text[:140].replace(chr(10), ' ')}\n")

    print(f"=== {passed}/{len(EVALS)} passed ===")
    sys.exit(0 if passed == len(EVALS) else 1)


if __name__ == "__main__":
    asyncio.run(main())
