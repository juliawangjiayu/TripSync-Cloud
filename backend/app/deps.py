from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from jose import JWTError
from app.core.database import get_db
from app.core.security import decode_token
from app.models.user import User
from app.models.itinerary import ItineraryMember, Itinerary, MemberRole

bearer_scheme = HTTPBearer()

async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    try:
        payload = decode_token(credentials.credentials)
        if payload.get("type") != "access":
            raise ValueError("Not an access token")
        user_id: str = payload["sub"]
    except (JWTError, ValueError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    user = await db.scalar(select(User).where(User.id == user_id))
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return user

async def require_member(
    itinerary_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> tuple[Itinerary, MemberRole]:
    """Returns (itinerary, role). Raises 404 if not found/no access."""
    itin = await db.scalar(select(Itinerary).where(Itinerary.id == itinerary_id))
    if not itin:
        raise HTTPException(status_code=404, detail="Itinerary not found")
    if itin.owner_id == current_user.id:
        return itin, MemberRole.editor
    member = await db.scalar(
        select(ItineraryMember).where(
            ItineraryMember.itinerary_id == itinerary_id,
            ItineraryMember.user_id == current_user.id,
        )
    )
    if not member:
        raise HTTPException(status_code=404, detail="Itinerary not found")
    return itin, member.role

async def require_editor(
    result: tuple = Depends(require_member),
) -> Itinerary:
    itin, role = result
    if role != MemberRole.editor:
        raise HTTPException(status_code=403, detail="Editor access required")
    return itin
