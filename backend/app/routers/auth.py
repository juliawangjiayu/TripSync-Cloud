from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from jose import JWTError
from app.core.database import get_db
from app.core.security import decode_token, create_token
from app.schemas.auth import RegisterRequest, LoginRequest, TokenResponse, RefreshRequest, UserOut
from app.services.auth import register_user, login_user
from app.models.user import User
from app.deps import get_current_user
from fastapi import HTTPException

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
