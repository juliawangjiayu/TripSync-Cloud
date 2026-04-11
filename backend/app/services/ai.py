"""
Gemini AI chat service.
Builds an itinerary context string and streams the response as SSE tokens.
"""
from typing import AsyncGenerator
from app.core.config import settings
from app.models.itinerary import ItineraryDay, ItineraryItem
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select


def _configure_gemini():
    import google.generativeai as genai
    genai.configure(api_key=settings.GEMINI_API_KEY)
    return genai.GenerativeModel("gemini-2.0-flash")


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

    model = _configure_gemini()
    chat_history = [
        {"role": turn["role"], "parts": [turn["content"]]}
        for turn in history
    ]

    chat = model.start_chat(history=chat_history)
    full_message = f"{system_prompt}\n\nUser: {message}"

    try:
        response = chat.send_message(full_message, stream=True)
        for chunk in response:
            if chunk.text:
                text = chunk.text.replace("\n", "\\n")
                yield f"data: {text}\n\n"
    except Exception as e:
        error_msg = str(e).replace("\n", " ")
        yield f"data: [Error: {error_msg}]\\n\\n"

    yield "data: [DONE]\n\n"
