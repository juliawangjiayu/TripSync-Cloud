from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from app.core.database import get_db
from app.deps import require_member
from app.services.ai import stream_chat_response

router = APIRouter(prefix="/itineraries", tags=["ai"])


class ChatMessage(BaseModel):
    role: str   # 'user' | 'assistant'
    content: str


class ChatRequest(BaseModel):
    message: str
    history: list[ChatMessage] = []


@router.post("/{itinerary_id}/ai/chat")
async def ai_chat(
    itinerary_id: str,
    payload: ChatRequest,
    member: tuple = Depends(require_member),
    db: AsyncSession = Depends(get_db),
):
    itin, _ = member
    history = [{"role": m.role, "content": m.content} for m in payload.history]

    async def generate():
        async for chunk in stream_chat_response(
            itinerary_id, itin.title, payload.message, history, db
        ):
            yield chunk

    return StreamingResponse(generate(), media_type="text/event-stream")
