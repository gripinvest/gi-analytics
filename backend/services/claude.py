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

MODEL = "claude-sonnet-4-20250514"

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
    """
    system = build_system_prompt(project_id)
    current_messages = list(messages)

    while True:
        response = client.messages.create(
            model=MODEL,
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
    """
    system = build_system_prompt(project_id)
    current_messages = list(messages)

    # Run tool_use loop until Claude is ready to answer
    while True:
        response = client.messages.create(
            model=MODEL,
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

    # Stream the final answer
    with client.messages.stream(
        model=MODEL,
        max_tokens=2048,
        system=system,
        messages=current_messages,
    ) as stream:
        for text in stream.text_stream:
            yield f"data: {json.dumps({'type': 'text', 'text': text})}\n\n"

    yield "data: [DONE]\n\n"
