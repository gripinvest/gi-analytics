"""
chat.py — streaming chat endpoint using Claude tool_use
"""
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from services.claude import stream_chat

router = APIRouter()


@router.post("/{project_id}")
async def chat_endpoint(project_id: str, body: dict):
    """
    SSE streaming endpoint.
    Body: { "messages": [{"role": "user", "content": "..."}] }
    Streams: data: {"type": "thinking"|"text"|"done", "text": "..."}
    """
    messages = body.get("messages", [])
    if not messages:
        return {"error": "No messages provided"}

    return StreamingResponse(
        stream_chat(project_id, messages),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",   # disable nginx buffering on Railway
        },
    )
