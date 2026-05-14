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
# Kill switch for the off-topic rejection path. Set CHAT_DISABLE_REJECT=1 to
# force the router into haiku/sonnet/opus only (a 'reject' verdict from the
# advisor gets re-mapped to haiku, the answer model handles any off-topic
# question via its own system-prompt guardrail). Use when the reject path
# is misclassifying too many on-topic follow-ups.
DISABLE_REJECT = os.getenv("CHAT_DISABLE_REJECT") == "1"

ROUTER_SYSTEM = """You route product-analytics chat questions for Grip Invest's internal analytics platform.

The platform answers questions about the "Asset Search" product feature using ~57 weekly DuckDB tables of raw product event data:
- search behaviour: initiated, query, result_clicked, empty_state, cleared, suggestion_clicked
- conversion: invest_now_button_clicked, quick_checkout_invest_clicked, assets_page_views
- across 6 feature weeks (W1-W6, Apr 2 - May 13 2026)

The platform's domain vocabulary (these are ALWAYS on-topic — definition questions about them belong on haiku):
- ZRR: zero-result rate (% of queries returning no results)
- CVR / conversion rate / search lift: searchers vs non-searchers conversion ratio
- adoption rate: share of visitors who focus the search box
- refinement rate: share of queries flagged is_refinement=true
- suggestion CTR: share of focused sessions that clicked a suggestion
- abandonment / frustrated users: sessions where the user cleared search with had_results=false
- relevance gap: sessions where had_results=true but no result was clicked
- issuers, keywords, terms, weekly cohorts (W1-W6), invest CTAs, quick checkout

You will see the most recent few turns of the conversation, not just the latest question. Use the prior turns to interpret pronouns and references — a follow-up like "what are the conversion numbers for these terms" inherits "these terms" from the prior turn, and is ON-TOPIC if the conversation has been about search data even when the latest message in isolation looks vague.

Output EXACTLY ONE word: reject, haiku, sonnet, or opus

Criteria:
- reject: the question cannot be answered from the product event data above AND the question doesn't reference any term from the domain vocabulary list above. Small talk, general knowledge, programming help, jokes, hypotheticals, world events, personal advice. Be conservative — if any reasonable interpretation given conversation context OR the domain vocabulary is on-topic, route on-topic instead.
- haiku: ON-TOPIC. Single SQL query suffices, OR a definition / methodology question about a domain term. "Show me X", "list the top N", "what is the Y rate", "how many Z", "what is ZRR", "how is adoption computed". Follow-ups to prior on-topic answers default here.
- sonnet: ON-TOPIC, multi-step analysis. Comparisons across weeks or segments. Trend interpretation. "Why did X change", "compare A and B", anything needing interpretation beyond raw numbers.
- opus: ON-TOPIC, rare. Causal/cohort reasoning, hypothesis testing, multi-table interactions with edge cases.

For on-topic questions default to haiku when uncertain. Only reject when the question is unambiguously outside the product-analytics scope AND outside the domain vocabulary. Cost and latency matter; only escalate when truly needed."""

REJECTION_MESSAGE = (
    "I can only answer questions about the **asset_search** product data — search "
    "behaviour, query terms, zero-result rates, adoption, conversion, issuers, "
    "weekly cuts (W1–W6).\n\n"
    "Try something like:\n"
    "- *What's the zero-result rate by week?*\n"
    "- *Which issuers have the worst conversion?*\n"
    "- *Show the top 20 most-searched terms.*"
)

FOLLOWUPS_SYSTEM = """You suggest 3 follow-up questions a product manager might ask next about Grip's asset_search product data.

Context: the platform answers questions over weekly product event tables (search initiated/query/cleared/empty_state, result clicks, suggestions, invest CTAs, page views) across W1-W6 (Apr 2 - May 13 2026).

Given the user's prior question and the analyst's answer, output 3 SHORT follow-up questions — concise, on-topic, distinct from the original question, each ≤ 12 words. Good follow-ups dig deeper (break down by week/issuer/term, compare segments, ask "why").

Output ONLY a JSON array of 3 strings, nothing else. Example:
["Break this down by week", "Compare W3 vs W6 on the same metric", "Which issuers dominate the top results?"]"""


def _suggest_followups(question: str, answer: str) -> list[str]:
    """Generate 3 follow-up question suggestions. Always uses Haiku — this is
    cheap classification + light creativity, not analytical reasoning. Returns
    [] on any failure (UI gracefully hides the chip row when empty).

    Truncates the answer to ~1500 chars before passing — most chat answers are
    well under that, and the suggestions only need the gist of what was just
    explained, not every percentage point."""
    if not question or not answer:
        return []
    try:
        resp = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=200,
            system=FOLLOWUPS_SYSTEM,
            messages=[{
                "role": "user",
                "content": f"User asked: {question}\n\nAnalyst answered (possibly truncated): {answer[:1500]}\n\nThree follow-up questions:",
            }],
        )
        text = "".join(b.text for b in resp.content if hasattr(b, "text")).strip()
        # Models occasionally wrap the JSON in ``` fences or add a prose
        # preface. Pull the array out by bracket-finding rather than insisting
        # on a strict JSON-only response.
        start = text.find("[")
        end = text.rfind("]")
        if start >= 0 and end > start:
            parsed = json.loads(text[start:end + 1])
            if isinstance(parsed, list):
                clean = [s.strip() for s in parsed if isinstance(s, str) and s.strip()]
                return clean[:3]
    except Exception as e:
        print(f"⚠️  follow-up generation failed: {e}")
    return []


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


def _conversation_excerpt(messages: list[dict], max_chars: int = 1800) -> str:
    """Format the recent conversation for the router.

    Walks backwards from the latest message and collects user + assistant
    turns until we've used ~max_chars. The router needs prior turns so a
    follow-up like 'what are the conversion numbers for these terms' can be
    resolved against the previous answer's context — without that, the
    pronoun-resolution problem makes the latest message look off-topic in
    isolation and rejects fire incorrectly.

    Assistant content here is the API response object (list of blocks);
    we serialise just the text blocks. Tool-result turns are skipped — they
    carry SQL output, not conversation we want the router to read.
    """
    parts: list[str] = []
    total = 0
    for m in reversed(messages):
        role = m.get("role", "")
        content = m.get("content", "")
        if isinstance(content, list):
            # assistant tool-use response OR user tool_results — pull just
            # the text blocks (the SQL/result blocks are mechanical noise
            # for routing).
            text = " ".join(
                b.get("text", "") if isinstance(b, dict) else getattr(b, "text", "")
                for b in content
                if (isinstance(b, dict) and b.get("type") == "text")
                or (hasattr(b, "type") and b.type == "text")
            )
        elif isinstance(content, str):
            text = content
        else:
            text = ""
        text = text.strip()
        if not text:
            continue
        chunk = f"{role.upper()}: {text}"
        if total + len(chunk) > max_chars and parts:
            break
        parts.append(chunk)
        total += len(chunk)
    return "\n\n".join(reversed(parts))


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

    # Pass the recent conversation excerpt to the router so it can resolve
    # follow-up references. Without this a follow-up like 'what are the
    # conversion numbers for these terms' reads as ambiguous-and-rejected;
    # with the prior turn visible, it's clearly on-topic.
    excerpt = _conversation_excerpt(messages)
    router_input = (
        f"Recent conversation:\n{excerpt}\n\n"
        f"Route the latest user message ({question!r}) — pick reject/haiku/sonnet/opus."
    )

    try:
        resp = client.messages.create(
            model=ROUTER_MODEL,
            max_tokens=8,
            system=ROUTER_SYSTEM,
            messages=[{"role": "user", "content": router_input}],
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
                    if DISABLE_REJECT:
                        # Kill-switch active: re-route to haiku and let the
                        # answer model's system-prompt guardrail handle the
                        # off-topic question politely. Visible in logs so the
                        # user can tell it kicked in.
                        print("⚠️  router said reject but CHAT_DISABLE_REJECT=1 → haiku")
                        return MODEL_FALLBACK, "haiku"
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
- Use execute_sql for DATA questions (anything requiring numbers from the
  tables). For DEFINITION / METHODOLOGY questions about platform terms (ZRR,
  CVR, adoption rate, refinement rate, search lift, abandonment, relevance
  gap, etc.) you may answer directly from the definitions below WITHOUT
  calling execute_sql — those questions don't need a query, just a clear
  explanation grounded in the schema.
- Never guess numbers — if a number isn't available from execute_sql or
  from a prior tool call in this turn, say you'd need to query.
- After getting results, explain them in plain English for a product/business audience.
- If a question is ambiguous, make a reasonable assumption, state it, then query.
- When showing numbers, round appropriately (no floating point noise).
- Exclude test users (IDs: 3, 4, 207871, 207875, 207878, 207879) from all queries.
- ZRR = zero-result rate. Computed at query level: rows where results_count=0 / total rows in asset_search_query.
- CVR / search lift = searchers' conversion rate ÷ non-searchers' conversion rate. Searcher = appears in asset_search_initiated. Converted = appears in invest_now_button_clicked / quick_checkout_invest_clicked.
- Adoption rate = COUNT(DISTINCT user_id) in asset_search_initiated ÷ COUNT(DISTINCT user_id) in (assets_page_views ∪ asset_search_initiated), per week.
- "Frustrated users" / abandonment = sessions in asset_search_cleared where had_results='false'.
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


MAX_TOOL_ITERATIONS = 6
# Cap on how many SQL-call rounds we'll do in one chat turn. Without this a
# model that keeps proposing failing SQL (e.g. for a malformed question) can
# loop indefinitely, eat tokens, and look to the user like a hang. 6 rounds
# is plenty for the most complex multi-step questions; if we hit this the
# answer model gets a single chance to wrap up with whatever it has.


async def stream_chat(project_id: str, messages: list[dict]):
    """
    Async generator that yields tokens as they stream.
    First executes tool_use loop (non-streaming for tool calls),
    then streams the final answer.

    Advisor flow: an initial select_model() call decides whether the question
    is on-topic and which model should answer. The label is emitted as the
    first SSE event so the UI can show a model badge and reject-state without
    needing to inspect the body.

    Wrapped in a try/except: a backend exception (API error, network blip,
    DuckDB hiccup) used to silently kill the SSE stream — the frontend would
    see the 'model' event then nothing, which read as "stuck after thinking
    for a few seconds". We now catch and emit a friendly error chunk so the
    user knows the chat failed (and the print() leaves a server-log
    breadcrumb so we can debug).
    """
    system = build_system_prompt(project_id)
    current_messages = list(messages)

    try:
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

        # Run tool_use loop until Claude is ready to answer (or we hit the cap)
        for _ in range(MAX_TOOL_ITERATIONS):
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
        # We also collect the full text so the follow-up generator (below) can
        # condition on it. Capturing is essentially free; we'd be holding the
        # tokens in memory anyway for the SSE encoder.
        answer_text = ""
        with client.messages.stream(
            model=model_id,
            max_tokens=2048,
            system=system,
            messages=current_messages,
        ) as stream:
            for text in stream.text_stream:
                answer_text += text
                yield f"data: {json.dumps({'type': 'text', 'text': text})}\n\n"

        # If the model produced no text (e.g., it returned a tool_use that we
        # hit the MAX_TOOL_ITERATIONS cap on), give the user SOMETHING so the
        # turn doesn't read as a silent failure.
        if not answer_text.strip():
            fallback = "I couldn't get to a clean answer for this one — try rephrasing or breaking it into two questions?"
            yield f"data: {json.dumps({'type': 'text', 'text': fallback})}\n\n"
            yield "data: [DONE]\n\n"
            return

        # Follow-up suggestions — a small Haiku call kicked off AFTER the answer
        # finishes streaming, so the user sees the answer immediately and the
        # suggestions appear shortly after. _suggest_followups returns [] on
        # any failure, and the UI hides the chip row when the array is empty,
        # so this path can never break the chat.
        user_question = _latest_user_question(messages)
        suggestions = _suggest_followups(user_question, answer_text)
        if suggestions:
            yield f"data: {json.dumps({'type': 'followups', 'suggestions': suggestions})}\n\n"

        yield "data: [DONE]\n\n"

    except Exception as e:
        # Don't let a backend exception look like a stuck UI. Log loudly,
        # send a visible error chunk, terminate cleanly with [DONE].
        print(f"❌ stream_chat failed: {type(e).__name__}: {e}")
        yield f"data: {json.dumps({'type': 'text', 'text': f'Something broke on the backend ({type(e).__name__}). Please retry — if it keeps happening, refresh the page.'})}\n\n"
        yield "data: [DONE]\n\n"
