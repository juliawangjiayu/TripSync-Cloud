from datetime import date, timedelta
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from fastapi import HTTPException, status
from app.models.user import User
from app.models.itinerary import Itinerary, ItineraryDay, ItineraryItem
from app.core.security import hash_password, verify_password, create_token
from app.schemas.auth import RegisterRequest, LoginRequest, TokenResponse
import uuid


async def _create_sample_itinerary(user_id: str, db: AsyncSession) -> None:
    """Create a sample itinerary with example data for new users."""
    itin_id = str(uuid.uuid4())
    itin = Itinerary(id=itin_id, owner_id=user_id, title="Sample Trip - Singapore 3 Days")
    db.add(itin)

    today = date.today()
    days_data = [
        {
            "date": today,
            "items": [
                {"item_order": 0, "time_start": "09:00", "time_end": "11:00", "spot_name": "Marina Bay Sands", "activity_desc": "Visit the SkyPark observation deck", "transport": "MRT", "estimated_cost": 26.00, "notes": "Book tickets online for shorter queue"},
                {"item_order": 1, "time_start": "12:00", "time_end": "13:30", "spot_name": "Lau Pa Sat", "activity_desc": "Lunch at the hawker centre", "transport": "Walk", "estimated_cost": 15.00, "booking_status": "not_needed"},
                {"item_order": 2, "time_start": "14:30", "time_end": "17:00", "spot_name": "Gardens by the Bay", "activity_desc": "Explore Cloud Forest and Flower Dome", "transport": "Walk", "estimated_cost": 32.00},
            ],
        },
        {
            "date": today + timedelta(days=1),
            "items": [
                {"item_order": 0, "time_start": "10:00", "time_end": "13:00", "spot_name": "Sentosa Island", "activity_desc": "Beach and cable car ride", "transport": "MRT + Monorail", "estimated_cost": 35.00},
                {"item_order": 1, "time_start": "14:00", "time_end": "16:00", "spot_name": "S.E.A. Aquarium", "activity_desc": "World's largest aquarium", "transport": "Walk", "estimated_cost": 41.00, "notes": "Don't miss the Open Ocean habitat"},
            ],
        },
        {
            "date": today + timedelta(days=2),
            "items": [
                {"item_order": 0, "time_start": "09:00", "time_end": "11:30", "spot_name": "Chinatown", "activity_desc": "Morning walk through the heritage district", "transport": "MRT", "estimated_cost": 0, "notes": "Try the local breakfast at a kopitiam"},
                {"item_order": 1, "time_start": "12:00", "time_end": "14:00", "spot_name": "Little India", "activity_desc": "Lunch and explore Tekka Centre", "transport": "MRT", "estimated_cost": 12.00},
            ],
        },
    ]

    for i, day_data in enumerate(days_data):
        day_id = str(uuid.uuid4())
        db.add(ItineraryDay(id=day_id, itinerary_id=itin_id, date=day_data["date"], day_order=i))
        for item_data in day_data["items"]:
            db.add(ItineraryItem(id=str(uuid.uuid4()), day_id=day_id, last_modified_by=user_id, **item_data))


async def register_user(payload: RegisterRequest, db: AsyncSession) -> tuple[User, TokenResponse]:
    existing = await db.scalar(select(User).where(User.email == payload.email))
    if existing:
        raise HTTPException(status_code=409, detail="Email already registered")
    user = User(
        id=str(uuid.uuid4()),
        email=payload.email,
        username=payload.username,
        password_hash=hash_password(payload.password),
    )
    db.add(user)
    await db.flush()
    await _create_sample_itinerary(user.id, db)
    await db.commit()
    await db.refresh(user)
    tokens = TokenResponse(
        access_token=create_token(user.id, "access"),
        refresh_token=create_token(user.id, "refresh"),
    )
    return user, tokens

async def login_user(payload: LoginRequest, db: AsyncSession) -> tuple[User, TokenResponse]:
    user = await db.scalar(select(User).where(User.email == payload.email))
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )
    tokens = TokenResponse(
        access_token=create_token(user.id, "access"),
        refresh_token=create_token(user.id, "refresh"),
    )
    return user, tokens
