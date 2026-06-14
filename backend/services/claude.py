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
from pathlib import Path
import anthropic
from services.duck import db

# Where project.json files live — mirrors routers/projects.py. Used to read
# each project's chat_context (the per-project domain glossary).
DATA_DIR = Path(os.getenv("DATA_DIR", "./data"))

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

def _router_system(project_context: str) -> str:
    """Build the router's system prompt for a given project.

    The router used to be hardcoded to the asset_search domain, which meant a
    perfectly valid question about another project (e.g. 'compare AUM across
    partners' on Grip Connect) got rejected as off-topic. We now inject the
    project's own chat_context so 'on-topic' is judged against the right
    project's vocabulary.
    """
    ctx = project_context.strip() or "(no extra project context provided)"
    return f"""You route analytics chat questions for Grip Invest's internal analytics platform.

The platform hosts multiple analytics projects. The user is currently working inside ONE project. Here is that project's domain context — treat anything it describes as ON-TOPIC:

--- PROJECT CONTEXT ---
{ctx}
--- END PROJECT CONTEXT ---

You will see the most recent few turns of the conversation, not just the latest question. Use the prior turns to interpret pronouns and references — a follow-up like "what are the conversion numbers for these" inherits its subject from the prior turn, and is ON-TOPIC if the conversation has been about this project's data even when the latest message in isolation looks vague.

Output EXACTLY ONE word: reject, haiku, sonnet, or opus

Criteria:
- reject: the question cannot be answered from this project's data AND doesn't reference anything in the project context above. Small talk, general knowledge, programming help, jokes, hypotheticals, world events, personal advice. Be conservative — if any reasonable interpretation given conversation context OR the project context is on-topic, route on-topic instead.
- haiku: ON-TOPIC. Single SQL query suffices, OR a definition / methodology question about a project term. "Show me X", "list the top N", "what is the Y rate", "how many Z", "how is X computed". Follow-ups to prior on-topic answers default here.
- sonnet: ON-TOPIC, multi-step analysis. Comparisons across segments or periods. Trend interpretation. "Why did X change", "compare A and B", anything needing interpretation beyond raw numbers.
- opus: ON-TOPIC, rare. Causal/cohort reasoning, hypothesis testing, multi-table interactions with edge cases.

For on-topic questions default to haiku when uncertain. Only reject when the question is unambiguously outside the project's analytics scope. Cost and latency matter; only escalate when truly needed."""


REJECTION_MESSAGE = (
    "I can only answer questions about this project's data. Ask about the "
    "metrics, tables, and trends this dashboard covers — for example a "
    "breakdown by segment or period, a comparison between groups, or the "
    "definition of one of the metrics shown above."
)


def _followups_system(project_context: str) -> str:
    """Build the follow-up-suggestion system prompt for a given project."""
    ctx = project_context.strip() or "(no extra project context provided)"
    return f"""You suggest 3 follow-up questions an analyst might ask next, scoped to ONE analytics project.

--- PROJECT CONTEXT ---
{ctx}
--- END PROJECT CONTEXT ---

Given the user's prior question and the analyst's answer, output 3 SHORT follow-up questions — concise, on-topic for THIS project, distinct from the original question, each ≤ 12 words. Good follow-ups dig deeper (break down by segment/period, compare groups, ask "why").

Output ONLY a JSON array of 3 strings, nothing else. Example:
["Break this down by segment", "Compare the two best performers", "Which metric moved the most?"]"""


def _suggest_followups(question: str, answer: str, project_context: str = "") -> list[str]:
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
            system=_followups_system(project_context),
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


def _sanitise_for_api(messages: list[dict]) -> list[dict]:
    """Strip frontend-only fields before passing messages to the Anthropic API.

    The FE attaches `model` and `followups` to assistant messages for the
    badge + chip UI (see frontend/lib/api.ts ChatMessage). Those fields ride
    along when the FE sends the conversation back for the next turn — and
    the API rejects them with
        BadRequestError: messages.N.model: Extra inputs are not permitted.
    That manifested as 'Something broke on the backend (BadRequestError)'
    on every follow-up that had a prior assistant turn (verified via
    /tmp/probe_chat.py 2026-05-14).

    We keep just role + content and drop everything else. content is left
    as-is — it can be a string (FE-supplied) or a list of blocks (from a
    prior tool-use response we appended in the same turn) and both are
    valid API shapes."""
    out = []
    for m in messages:
        if not isinstance(m, dict):
            continue
        cleaned = {"role": m.get("role"), "content": m.get("content", "")}
        out.append(cleaned)
    return out


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


def select_model(messages: list[dict], project_context: str = "") -> tuple[str | None, str]:
    """Run the advisor. Returns (model_id, label).

    Labels: 'reject' (off-topic; model_id=None), 'haiku' | 'sonnet' | 'opus'
    (on-topic; model_id is the API model ID).

    `project_context` is the active project's chat_context — it's injected
    into the router prompt so 'on-topic' is judged against the right
    project's vocabulary (a Grip Connect question must not be rejected just
    because it isn't about asset_search).

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
            system=_router_system(project_context),
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

# Lets Claude pull a dataset's columns + exact table names ON DEMAND instead of
# us front-loading every table's schema (which overflowed the 200K context
# window — see backend/evals/chat_eval.py). Mirrors how skills / tool-search
# load detail only when needed; keeps the system prompt flat as weekly tables
# accumulate.
DESCRIBE_TABLE_TOOL = {
    "name": "describe_table",
    "description": (
        "Get the columns and exact table names for ONE dataset before querying it. "
        "Pass a dataset name from the data map in the system prompt (e.g. "
        "'asset_search_query'). Returns column names/types and the per-week table "
        "names to use in execute_sql. Call this only for datasets needed to answer a "
        "DATA question — skip it entirely for definition/methodology questions, which "
        "you answer from the metric glossary."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "dataset": {
                "type": "string",
                "description": "Dataset (or concrete table) name to describe.",
            }
        },
        "required": ["dataset"],
    },
}

# The fixed tool set sent on every answer call. Stable order so it stays a
# cacheable prefix.
CHAT_TOOLS = [DESCRIBE_TABLE_TOOL, EXECUTE_SQL_TOOL]

# Default domain context for the asset_search project. Projects can override
# this with a `chat_context` string in their project.json (see
# _project_chat_context below) — asset_search keeps this hardcoded default for
# back-compat since its project.json predates the chat_context convention.
ASSET_SEARCH_CONTEXT = """
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
Test user IDs to exclude from all queries: 3, 4, 207871, 207875, 207878, 207879.
Weeks are feature-relative from Apr 2 2026 launch: W1=Apr2-8, W2=Apr9-15, W3=Apr16-22, W4=Apr23-29, W5=Apr30-May6, W6=May7+.

Metric definitions (you may answer definition questions about these directly, no SQL needed):
- ZRR = zero-result rate. Computed at query level: rows where results_count=0 / total rows in asset_search_query.
- CVR / search lift = searchers' conversion rate ÷ non-searchers' conversion rate. Searcher = appears in asset_search_initiated. Converted = appears in invest_now_button_clicked / quick_checkout_invest_clicked.
- Adoption rate = COUNT(DISTINCT user_id) in asset_search_initiated ÷ COUNT(DISTINCT user_id) in (assets_page_views ∪ asset_search_initiated), per week.
- "Frustrated users" / abandonment = sessions in asset_search_cleared where had_results='false'.
- "Relevance gap" = sessions in asset_search_cleared where had_results='true' AND any_result_clicked='false'.
"""


def _project_chat_context(project_id: str) -> str:
    """Return the domain glossary for a project's chat system prompt.

    Resolution order:
      1. `chat_context` string in the project's project.json — the per-project
         convention; every new project should set this.
      2. ASSET_SEARCH_CONTEXT for the asset_search project — back-compat, its
         project.json predates the convention.
      3. Empty string — the schema dump alone still lets the model query; it
         just lacks the human glossary.
    """
    meta_path = DATA_DIR / project_id / "project.json"
    if meta_path.exists():
        try:
            meta = json.loads(meta_path.read_text())
            ctx = meta.get("chat_context")
            if isinstance(ctx, str) and ctx.strip():
                return ctx
        except Exception as e:
            print(f"⚠️  could not read chat_context for {project_id}: {e}")
    if project_id == "asset_search":
        return ASSET_SEARCH_CONTEXT
    return ""


def build_system_prompt(project_id: str) -> str:
    # Compact data MAP (dataset names only), not a full schema dump. Columns +
    # exact table names are fetched on demand via the describe_table tool — this
    # keeps the prompt small and bounded regardless of how many weekly tables
    # accumulate (the full-schema dump overflowed the 200K context window).
    data_map = db.get_data_map(project_id)
    context = _project_chat_context(project_id)
    return f"""You are an analytics assistant for Grip Invest's internal analytics platform.
You answer questions about ONE project's product data, using the metric glossary
and the data tools below.

--- METRIC GLOSSARY & PROJECT CONTEXT ---
{context}
--- END GLOSSARY ---

--- DATA MAP (dataset names only — get columns/tables via describe_table) ---
{data_map}
--- END DATA MAP ---

How to answer:
- DEFINITION / METHODOLOGY / capability questions (e.g. "what is ZRR", "how is
  dead-end computed", "what can I ask here"): answer directly from the glossary
  above. Do NOT call any tool — no describe_table, no execute_sql. These need
  no data.
- DATA / NUMBER questions: first call describe_table(dataset) for each dataset
  you need (it returns columns + the exact per-week table names), THEN call
  execute_sql with a DuckDB SELECT against those exact tables. Never guess
  column or table names — always get them from describe_table first.
- Only ever query THIS project's tables (the data map above).
- Exclude test users 3, 4, 207871, 207875, 207878, 207879 in every data query.
- Never invent numbers; if you don't have a value from execute_sql, say you'd
  need to query for it.
- After getting results, explain them in plain English for a business audience;
  when you cite a metric you may add a one-line note on how it's computed.
- Off-topic questions (small talk, general knowledge, jokes, programming):
  politely decline and redirect to this project's metrics. Don't answer even
  partially.
- When showing numbers, round appropriately (no floating-point noise)."""


def chat(project_id: str, messages: list[dict], stream_callback=None) -> str:
    """
    Run the tool_use loop for one user turn.
    Returns the final assistant text.
    stream_callback(token: str) → called with each streamed text token if provided.

    Currently unused — kept for interactive REPL use. Mirrors stream_chat's
    advisor + reject flow so any caller gets identical routing behaviour.
    """
    system = build_system_prompt(project_id)
    project_context = _project_chat_context(project_id)
    current_messages = _sanitise_for_api(messages)

    model_id, label = select_model(current_messages, project_context)
    if label == "reject":
        return REJECTION_MESSAGE

    while True:
        response = client.messages.create(
            model=model_id,
            max_tokens=2048,
            system=_cached_system(system),
            tools=CHAT_TOOLS,
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

                if block.name == "describe_table":
                    ds = block.input.get("dataset", "")
                    result_text, is_error = db.describe_table(project_id, ds), False
                elif block.name == "execute_sql":
                    sql = block.input.get("query", "")
                    explanation = block.input.get("explanation", "")
                    try:
                        result = db.execute(sql, project_id=project_id)
                        result_text = _format_sql_result(sql, explanation, result)
                        is_error = False
                    except Exception as e:
                        result_text, is_error = f"SQL error: {e}", True
                else:
                    result_text, is_error = f"Unknown tool: {block.name}", True

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


# Cap a single tool_result's serialized data. Wide event tables (~100 cols) at
# 50 rows are huge and get re-sent on every subsequent turn, so the rolling
# context can balloon. Bound it.
TOOL_RESULT_MAX_ROWS = 40
TOOL_RESULT_MAX_CHARS = 6000
# Backstop: if the assembled prompt approaches the window, stop and answer with
# what we have rather than 400. ~3 chars/token is conservative, so 540K chars
# ≈ 180K tokens — safely under the 200K limit.
MAX_PROMPT_CHARS = 540_000

# Shown instead of the generic "something broke" when we (or the API) detect the
# prompt is too large — actionable for the user.
TOO_LONG_MESSAGE = (
    "That question pulled in more data than I can reason over at once. Try "
    "narrowing it — a specific week or segment, an aggregate, or a smaller "
    "breakdown — and I'll answer."
)


def _format_sql_result(sql: str, explanation: str, result: dict) -> str:
    """Serialize an execute_sql result for the model, capping rows + total size
    so a wide/large result can't blow up the rolling context."""
    data = json.dumps(result["rows"][:TOOL_RESULT_MAX_ROWS], default=str)
    extra = ""
    if len(data) > TOOL_RESULT_MAX_CHARS:
        data = data[:TOOL_RESULT_MAX_CHARS]
        extra = (f"\n…(truncated; {result['row_count']} rows total — aggregate or "
                 f"add a tighter filter/LIMIT for a complete answer)")
    return (f"Query: {sql}\nPurpose: {explanation}\n"
            f"Rows: {result['row_count']}\nColumns: {result['columns']}\nData: {data}{extra}")


def _prompt_chars(system: str, messages: list[dict]) -> int:
    """Cheap char-based estimate of request size (avoids a count_tokens API call
    every iteration). Used only for the fail-soft backstop."""
    try:
        return len(system) + len(json.dumps(messages, default=str))
    except Exception:
        return len(system)


def _cached_system(system: str) -> list[dict]:
    """Wrap the system prompt as a cacheable block. The breakpoint sits at the
    end of the system text; since render order is tools -> system -> messages,
    this caches BOTH the (stable) tool definitions and the system prompt. The
    answer model re-sends this identical prefix on every tool-loop iteration and
    every multi-turn message, so caching it cuts repeat input cost. Verify with
    usage.cache_read_input_tokens. (Glossary/data-map must stay byte-stable for
    a given project — no timestamps — or the cache silently misses.)"""
    return [{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}]


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
    project_context = _project_chat_context(project_id)
    # Strip frontend-only fields (model, followups) before any API call —
    # see _sanitise_for_api docstring. This MUST happen before select_model
    # too because the router builds an excerpt from messages that gets sent
    # to the API, and a dirty message there would also 400.
    current_messages = _sanitise_for_api(messages)

    try:
        # Route the question. ~500-1000ms of advisor latency before the actual
        # answer starts. The project_context scopes 'on-topic' to this project.
        model_id, label = select_model(current_messages, project_context)
        yield f"data: {json.dumps({'type': 'model', 'label': label})}\n\n"

        # Off-topic — refuse politely with a fixed message; do NOT spend the
        # answer tokens, do NOT touch DuckDB.
        if label == "reject":
            yield f"data: {json.dumps({'type': 'text', 'text': REJECTION_MESSAGE})}\n\n"
            yield "data: [DONE]\n\n"
            return

        # Run tool_use loop until Claude is ready to answer (or we hit the cap)
        for _ in range(MAX_TOOL_ITERATIONS):
            # Fail-soft backstop: if accumulated tool results have grown the
            # request near the context window, stop and tell the user rather
            # than letting the API 400 with "prompt is too long".
            if _prompt_chars(system, current_messages) > MAX_PROMPT_CHARS:
                yield f"data: {json.dumps({'type': 'text', 'text': TOO_LONG_MESSAGE})}\n\n"
                yield "data: [DONE]\n\n"
                return
            response = client.messages.create(
                model=model_id,
                max_tokens=2048,
                system=_cached_system(system),
                tools=CHAT_TOOLS,
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

                if block.name == "describe_table":
                    ds = block.input.get("dataset", "")
                    yield f"data: {json.dumps({'type': 'thinking', 'text': f'Looking up dataset: {ds}'})}\n\n"
                    result_text, is_error = db.describe_table(project_id, ds), False
                elif block.name == "execute_sql":
                    sql = block.input.get("query", "")
                    explanation = block.input.get("explanation", "")
                    yield f"data: {json.dumps({'type': 'thinking', 'text': f'Running: {explanation}'})}\n\n"
                    try:
                        result = db.execute(sql, project_id=project_id)
                        result_text = _format_sql_result(sql, explanation, result)
                        is_error = False
                    except Exception as e:
                        result_text, is_error = f"SQL error: {e}", True
                else:
                    result_text, is_error = f"Unknown tool: {block.name}", True

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
            system=_cached_system(system),
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
        user_question = _latest_user_question(current_messages)
        suggestions = _suggest_followups(user_question, answer_text, project_context)
        if suggestions:
            yield f"data: {json.dumps({'type': 'followups', 'suggestions': suggestions})}\n\n"

        yield "data: [DONE]\n\n"

    except Exception as e:
        # Don't let a backend exception look like a stuck UI. Log loudly,
        # send a visible error chunk, terminate cleanly with [DONE].
        print(f"❌ stream_chat failed: {type(e).__name__}: {e}")
        # A "prompt is too long" 400 should never reach here now (data map +
        # caps + backstop), but if it does, give the actionable message instead
        # of the opaque generic one.
        msg = TOO_LONG_MESSAGE if "prompt is too long" in str(e).lower() else (
            f"Something broke on the backend ({type(e).__name__}). Please retry "
            f"— if it keeps happening, refresh the page."
        )
        yield f"data: {json.dumps({'type': 'text', 'text': msg})}\n\n"
        yield "data: [DONE]\n\n"
