"""
DeepSeek AI chat service (OpenAI-compatible API).
Builds an itinerary context string and streams the response as SSE tokens.
"""
from typing import AsyncGenerator
from openai import AsyncOpenAI
from app.core.config import settings
from app.models.itinerary import ItineraryDay, ItineraryItem
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

_client: AsyncOpenAI | None = None

def _get_client() -> AsyncOpenAI:
    global _client
    if _client is None:
        _client = AsyncOpenAI(
            api_key=settings.DEEPSEEK_API_KEY,
            base_url="https://api.deepseek.com",
        )
    return _client


async def build_itinerary_context(itinerary_id: str, title: str, db: AsyncSession) -> str:
    days_result = await db.scalars(
        select(ItineraryDay).where(ItineraryDay.itinerary_id == itinerary_id).order_by(ItineraryDay.day_order)
    )
    days = list(days_result)
    lines = [f"Itinerary: {title}"]
    for i, day in enumerate(days, 1):
        items_result = await db.scalars(
            select(ItineraryItem).where(ItineraryItem.day_id == day.id).order_by(ItineraryItem.item_order)
        )
        items = list(items_result)
        lines.append(f"\nDay {i} ({day.date}):")
        for item in items:
            parts = []
            if item.time_start:
                parts.append(f"{item.time_start}")
            if item.spot_name:
                parts.append(item.spot_name)
            if item.activity_desc:
                parts.append(item.activity_desc)
            if item.transport:
                parts.append(f"({item.transport})")
            lines.append("  - " + " | ".join(parts) if parts else "  - (empty)")
    return "\n".join(lines)


async def stream_chat_response(
    itinerary_id: str,
    title: str,
    message: str,
    history: list[dict],
    db: AsyncSession,
) -> AsyncGenerator[str, None]:
    """Yields SSE-formatted data lines."""
    context = await build_itinerary_context(itinerary_id, title, db)
    system_prompt = (
        "You are a helpful travel planning assistant. "
        "The user's current itinerary is below. Use it to give context-aware suggestions.\n\n"
        f"{context}"
    )

    messages = [{"role": "system", "content": system_prompt}]
    for turn in history:
        messages.append({"role": turn["role"], "content": turn["content"]})
    messages.append({"role": "user", "content": message})

    client = _get_client()
    try:
        stream = await client.chat.completions.create(
            model="deepseek-chat",
            messages=messages,
            stream=True,
        )
        async for chunk in stream:
            delta = chunk.choices[0].delta
            if delta.content:
                text = delta.content.replace("\n", "\\n")
                yield f"data: {text}\n\n"
    except Exception as e:
        error_msg = str(e).replace("\n", " ")
        yield f"data: [Error: {error_msg}]\\n\\n"

    yield "data: [DONE]\n\n"
