from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from jose import JWTError
from app.core.database import get_db
from app.core.security import decode_token, create_token
from app.schemas.auth import RegisterRequest, LoginRequest, TokenResponse, RefreshRequest, UserOut
from app.services.auth import register_user, login_user
from app.models.user import User
from app.models.itinerary import ItineraryItem, ShareLink
from app.models.collaboration import Alternative
from app.models.version import VersionHistory
from app.models.map import MapPin
from app.deps import get_current_user

router = APIRouter(prefix="/auth", tags=["auth"])

@router.post("/register", response_model=dict)
async def register(payload: RegisterRequest, db: AsyncSession = Depends(get_db)):
    user, tokens = await register_user(payload, db)
    return {"user": UserOut(id=user.id, email=user.email, username=user.username, has_completed_onboarding=user.has_completed_onboarding), **tokens.model_dump()}

@router.post("/login", response_model=dict)
async def login(payload: LoginRequest, db: AsyncSession = Depends(get_db)):
    user, tokens = await login_user(payload, db)
    return {"user": UserOut(id=user.id, email=user.email, username=user.username, has_completed_onboarding=user.has_completed_onboarding), **tokens.model_dump()}

@router.post("/refresh", response_model=TokenResponse)
async def refresh(payload: RefreshRequest, db: AsyncSession = Depends(get_db)):
    try:
        data = decode_token(payload.refresh_token)
        if data.get("type") != "refresh":
            raise ValueError
    except (JWTError, ValueError):
        raise HTTPException(status_code=401, detail="Invalid refresh token")
    user = await db.scalar(select(User).where(User.id == data["sub"]))
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return TokenResponse(
        access_token=create_token(user.id, "access"),
        refresh_token=create_token(user.id, "refresh"),
    )

@router.post("/logout", status_code=204)
async def logout():
    return

@router.patch("/me/onboarding-complete", status_code=204)
async def complete_onboarding(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    current_user.has_completed_onboarding = True
    await db.commit()


@router.delete("/me", status_code=204)
async def delete_account(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    uid = current_user.id
    # Nullify nullable foreign keys referencing this user
    await db.execute(update(ItineraryItem).where(ItineraryItem.last_modified_by == uid).values(last_modified_by=None))
    await db.execute(update(VersionHistory).where(VersionHistory.author_id == uid).values(author_id=None))
    # Delete non-nullable references to this user in other users' data
    await db.execute(Alternative.__table__.delete().where(Alternative.proposed_by == uid))
    await db.execute(MapPin.__table__.delete().where(MapPin.created_by == uid))
    await db.execute(ShareLink.__table__.delete().where(ShareLink.created_by == uid))
    # Delete user — cascades to folders, itineraries, members
    await db.delete(current_user)
    await db.commit()
