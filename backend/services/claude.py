"""
Claude service.
Implements the tool_use loop for natural language → SQL → answer.

Flow:
  1. Build system prompt with project schema + event definitions
  2. Send user message + tools=[execute_sql] to Claude
  3. Claude returns tool_use block with SQL query
  4. We execute SQL via DuckDB
  5. Return tool_result → Claude interprets and streams answer
"""

import os
import json
import anthropic
from services.duck import db

client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

# Per-question model routing. A small "advisor" call classifies each question
# as simple/medium/complex and we use the appropriate model for the actual
# answer.
#
# - haiku  → single-SQL lookups, aggregations, filters: ~80% of questions.
# - sonnet → multi-step comparisons, trend interpretation, "why did X change".
# - opus   → rare: causal/cohort reasoning, hypothesis testing, edge cases.
#
# Trade-off acknowledged: the advisor call adds ~500-1000ms before the actual
# answer starts. We pay that on every chat in exchange for capability headroom
# on the complex 20%. If the latency becomes painful, flip CHAT_ROUTER_MODEL
# to claude-haiku-4-5-20251001 to halve the routing tax; the routing decisions
# get marginally less nuanced but stay correct for the common cases.
#
# Falls back to MODEL_FALLBACK (Haiku) on any error — never fails the chat.
MODEL_FALLBACK = "claude-haiku-4-5-20251001"

MODEL_CHOICES = {
    "haiku":  "claude-haiku-4-5-20251001",
    "sonnet": "claude-sonnet-4-6",
    "opus":   "claude-opus-4-7",
}

# The advisor also gates on-topic. Same call decides BOTH the model AND
# whether the question is answerable from the product event data — no extra
# latency for the moderation step.
ROUTER_LABELS = ("reject", "haiku", "sonnet", "opus")

ROUTER_MODEL = os.getenv("CHAT_ROUTER_MODEL", "claude-sonnet-4-6")

ROUTER_SYSTEM = """You route product-analytics chat questions for Grip Invest's internal analytics platform.

The platform answers questions about the "Asset Search" product feature using ~57 weekly DuckDB tables of raw product event data:
- search behaviour: initiated, query, result_clicked, empty_state, cleared, suggestion_clicked
- conversion: invest_now_button_clicked, quick_checkout_invest_clicked, assets_page_views
- across 6 feature weeks (W1-W6, Apr 2 - May 13 2026)

Output EXACTLY ONE word: reject, haiku, sonnet, or opus

Criteria:
- reject: the question cannot be answered from the product event data above. Small talk, general knowledge, programming help, jokes, hypotheticals, world events, personal advice, anything outside the product-analytics scope.
- haiku: ON-TOPIC, single SQL query suffices. Simple lookups, aggregations, filters, sorting. "Show me X", "list the top N", "what is the Y rate", "how many Z".
- sonnet: ON-TOPIC, multi-step analysis. Comparisons across weeks or segments. Trend interpretation. "Why did X change", "compare A and B", anything needing interpretation beyond raw numbers.
- opus: ON-TOPIC, rare. Causal/cohort reasoning, hypothesis testing, multi-table interactions with edge cases.

For on-topic questions default to haiku when uncertain. For clearly off-topic questions output reject. Cost and latency matter; only escalate when truly needed."""

REJECTION_MESSAGE = (
    "I can only answer questions about the **asset_search** product data — search "
    "behaviour, query terms, zero-result rates, adoption, conversion, issuers, "
    "weekly cuts (W1–W6).\n\n"
    "Try something like:\n"
    "- *What's the zero-result rate by week?*\n"
    "- *Which issuers have the worst conversion?*\n"
    "- *Show the top 20 most-searched terms.*"
)


def _latest_user_question(messages: list[dict]) -> str:
    """Return the most recent user-role string content. Skips tool_result turns
    (which are also role=user but carry a list of result blocks, not a
    question). Returns '' if no question found, which routes to the fallback."""
    for m in reversed(messages):
        if m.get("role") != "user":
            continue
        c = m.get("content", "")
        if isinstance(c, str) and c.strip():
            return c
    return ""


def select_model(messages: list[dict]) -> tuple[str | None, str]:
    """Run the advisor. Returns (model_id, label).

    Labels: 'reject' (off-topic; model_id=None), 'haiku' | 'sonnet' | 'opus'
    (on-topic; model_id is the API model ID).

    Never raises. Any error → (Haiku, 'haiku') — degrade to "always answer
    with the cheap model" rather than failing the chat. We'd rather answer
    an off-topic question imperfectly than 500 the user.
    """
    question = _latest_user_question(messages)
    if not question:
        return None, "reject"  # empty question → don't waste an answer call
    try:
        resp = client.messages.create(
            model=ROUTER_MODEL,
            max_tokens=8,
            system=ROUTER_SYSTEM,
            messages=[{"role": "user", "content": question}],
        )
        text = "".join(b.text for b in resp.content if hasattr(b, "text")).strip().lower()
        # The advisor occasionally wraps the word in punctuation or quotes;
        # we match by `in` rather than equality so 'haiku.' or '"sonnet"'
        # still routes correctly.
        # Order matters: check 'reject' first so a question that incidentally
        # contains "haiku" or "sonnet" doesn't get the wrong label.
        for label in ROUTER_LABELS:
            if label in text:
                if label == "reject":
                    return None, "reject"
                return MODEL_CHOICES[label], label
    except Exception as e:
        print(f"⚠️  advisor fell back to Haiku: {e}")
    return MODEL_FALLBACK, "haiku"


# Kept as a backward-compat default for the sync chat() path below — also the
# value used if select_model returns the haiku label.
MODEL = MODEL_FALLBACK

# Tool definition — Claude uses this to write queries
EXECUTE_SQL_TOOL = {
    "name": "execute_sql",
    "description": (
        "Execute a DuckDB SQL query against the project's event tables. "
        "Use this to answer analytical questions. Always SELECT, never mutate. "
        "Return concise, focused result sets — add LIMIT if the result could be large."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "Valid DuckDB SQL SELECT statement."
            },
            "explanation": {
                "type": "string",
                "description": "One sentence explaining what this query computes."
            }
        },
        "required": ["query", "explanation"]
    }
}

EVENT_CONTEXT = """
Event schema notes (Grip Asset Search feature):
- asset_search_initiated: fires when user focuses search input. Payload: active_tab, assets_visible_count.
- asset_search_query: fires per query change (debounced 300ms, query ≥ 3 chars). 
  Payload: query_text, query_length, results_count, active_tab, is_refinement.
  is_refinement=true means previous query was also ≥3 chars (user iterating).
- asset_search_result_clicked: fires on result click. 
  Payload: query_text, clicked_asset_id, clicked_asset_name, clicked_asset_type, result_position (1-based), results_count, active_tab.
- asset_search_empty_state: fires once per unique query returning 0 results.
  Payload: query_text, query_length, active_tab.
- asset_search_cleared: fires when user clears input (only if previous query ≥3 chars).
  Payload: query_text_at_clear, had_results (bool), any_result_clicked (bool), active_tab.
  had_results=false → true abandonment. had_results=true + any_result_clicked=false → relevance gap.
- asset_search_suggestion_clicked: fires when user clicks a pre-typing top-YTM suggestion (on focus, before typing).
  Payload: suggestion_type, asset_id, asset_name, item_position, suggestion_count, active_tab.
  NOTE: this fires on FOCUS, not after zero results. It is a pre-search discovery event.

All tables use context_session_id for session tracking and user_id for user tracking.
Test user IDs to exclude: 3, 4, 207871, 207875, 207878, 207879.
Weeks are feature-relative from Apr 2 2026 launch: W1=Apr2-8, W2=Apr9-15, W3=Apr16-22, W4=Apr23-29, W5=Apr30-May6, W6=May7+.
"""


def build_system_prompt(project_id: str) -> str:
    schema = db.get_schema(project_id)
    return f"""You are an analytics assistant for Grip Invest's internal analytics platform.
You have direct access to raw product event data via the execute_sql tool.

{schema}

{EVENT_CONTEXT}

Guidelines:
- ONLY answer questions about the product event data above. If the user asks
  something off-topic (small talk, general knowledge, programming, jokes,
  hypotheticals), politely decline and suggest they ask about search
  behaviour, conversion, issuers, query terms, or weekly trends instead. Do
  NOT speculate, do NOT roleplay, do NOT answer the off-topic question even
  partially — a clean redirect is the right response.
- Always use execute_sql to answer data questions — never guess numbers.
- After getting results, explain them in plain English for a product/business audience.
- If a question is ambiguous, make a reasonable assumption, state it, then query.
- When showing numbers, round appropriately (no floating point noise).
- Exclude test users (IDs: 3, 4, 207871, 207875, 207878, 207879) from all queries.
- ZRR = zero-result rate. Compute at query level: rows where results_count=0 / total rows.
- "Frustrated users" = sessions in asset_search_cleared where had_results='false'.
- "Relevance gap" = sessions in asset_search_cleared where had_results='true' AND any_result_clicked='false'.
"""


def chat(project_id: str, messages: list[dict], stream_callback=None) -> str:
    """
    Run the tool_use loop for one user turn.
    Returns the final assistant text.
    stream_callback(token: str) → called with each streamed text token if provided.

    Currently unused — kept for interactive REPL use. Mirrors stream_chat's
    advisor + reject flow so any caller gets identical routing behaviour.
    """
    system = build_system_prompt(project_id)
    current_messages = list(messages)

    model_id, label = select_model(messages)
    if label == "reject":
        return REJECTION_MESSAGE

    while True:
        response = client.messages.create(
            model=model_id,
            max_tokens=2048,
            system=system,
            tools=[EXECUTE_SQL_TOOL],
            messages=current_messages,
        )

        # Collect assistant message
        assistant_msg = {"role": "assistant", "content": response.content}
        current_messages.append(assistant_msg)

        if response.stop_reason == "tool_use":
            # Extract tool calls and execute them
            tool_results = []
            for block in response.content:
                if block.type != "tool_use":
                    continue
                tool_input = block.input
                sql = tool_input.get("query", "")
                explanation = tool_input.get("explanation", "")

                try:
                    result = db.execute(sql)
                    result_text = (
                        f"Query: {sql}\n"
                        f"Purpose: {explanation}\n"
                        f"Rows returned: {result['row_count']}\n"
                        f"Columns: {result['columns']}\n"
                        f"Data: {json.dumps(result['rows'][:50], default=str)}"
                    )
                    is_error = False
                except Exception as e:
                    result_text = f"SQL error: {e}"
                    is_error = True

                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": result_text,
                    "is_error": is_error,
                })

            current_messages.append({"role": "user", "content": tool_results})
            # Loop back — Claude will interpret the results

        else:
            # End of turn — extract final text
            final_text = " ".join(
                block.text for block in response.content
                if hasattr(block, "text")
            )
            return final_text


async def stream_chat(project_id: str, messages: list[dict]):
    """
    Async generator that yields tokens as they stream.
    First executes tool_use loop (non-streaming for tool calls),
    then streams the final answer.

    Advisor flow: an initial select_model() call decides whether the question
    is on-topic and which model should answer. The label is emitted as the
    first SSE event so the UI can show a model badge and reject-state without
    needing to inspect the body.
    """
    system = build_system_prompt(project_id)
    current_messages = list(messages)

    # Route the question. ~500-1000ms of advisor latency before the actual
    # answer starts. See ROUTER_SYSTEM for the routing taxonomy.
    model_id, label = select_model(messages)
    yield f"data: {json.dumps({'type': 'model', 'label': label})}\n\n"

    # Off-topic — refuse politely with a fixed message; do NOT spend the
    # answer tokens, do NOT touch DuckDB.
    if label == "reject":
        yield f"data: {json.dumps({'type': 'text', 'text': REJECTION_MESSAGE})}\n\n"
        yield "data: [DONE]\n\n"
        return

    # Run tool_use loop until Claude is ready to answer
    while True:
        response = client.messages.create(
            model=model_id,
            max_tokens=2048,
            system=system,
            tools=[EXECUTE_SQL_TOOL],
            messages=current_messages,
        )

        if response.stop_reason != "tool_use":
            # Claude is done with tools. Don't append this turn — the streaming
            # call below regenerates the final answer so the client gets real
            # token-by-token output. (Appending it here would leave the answer
            # already in the transcript, and the stream would emit nothing.)
            break

        current_messages.append({"role": "assistant", "content": response.content})

        tool_results = []
        for block in response.content:
            if block.type != "tool_use":
                continue
            sql = block.input.get("query", "")
            explanation = block.input.get("explanation", "")

            # Yield a "thinking" token so the UI shows progress
            yield f"data: {json.dumps({'type': 'thinking', 'text': f'Running: {explanation}'})}\n\n"

            try:
                result = db.execute(sql)
                result_text = (
                    f"Query: {sql}\nPurpose: {explanation}\n"
                    f"Rows: {result['row_count']}\nColumns: {result['columns']}\n"
                    f"Data: {json.dumps(result['rows'][:50], default=str)}"
                )
                is_error = False
            except Exception as e:
                result_text = f"SQL error: {e}"
                is_error = True

            tool_results.append({
                "type": "tool_result",
                "tool_use_id": block.id,
                "content": result_text,
                "is_error": is_error,
            })

        current_messages.append({"role": "user", "content": tool_results})

    # Stream the final answer — uses the advisor-selected model from above.
    with client.messages.stream(
        model=model_id,
        max_tokens=2048,
        system=system,
        messages=current_messages,
    ) as stream:
        for text in stream.text_stream:
            yield f"data: {json.dumps({'type': 'text', 'text': text})}\n\n"

    yield "data: [DONE]\n\n"
