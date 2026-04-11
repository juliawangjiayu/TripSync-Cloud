import uuid
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.deps import get_current_user, require_member, require_editor
from app.models.user import User
from app.models.itinerary import Itinerary
from app.models.map import MapPin
from app.schemas.map import MapPinCreate, MapPinOut

router = APIRouter(prefix="/itineraries", tags=["map-pins"])


@router.get("/{itinerary_id}/map-pins", response_model=list[MapPinOut])
async def list_map_pins(
    itinerary_id: str,
    member: tuple = Depends(require_member),
    db: AsyncSession = Depends(get_db),
):
    result = await db.scalars(
        select(MapPin)
        .where(MapPin.itinerary_id == itinerary_id)
        .order_by(MapPin.created_at)
    )
    return list(result)


@router.post("/{itinerary_id}/map-pins", response_model=MapPinOut, status_code=201)
async def create_map_pin(
    itinerary_id: str,
    payload: MapPinCreate,
    itin: Itinerary = Depends(require_editor),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    pin = MapPin(
        id=str(uuid.uuid4()),
        itinerary_id=itinerary_id,
        label=payload.label,
        lat=payload.lat,
        lng=payload.lng,
        created_by=current_user.id,
    )
    db.add(pin)
    await db.commit()
    await db.refresh(pin)
    return MapPinOut.model_validate(pin)


@router.delete("/{itinerary_id}/map-pins/{pin_id}", status_code=204)
async def delete_map_pin(
    itinerary_id: str,
    pin_id: str,
    itin: Itinerary = Depends(require_editor),
    db: AsyncSession = Depends(get_db),
):
    pin = await db.scalar(
        select(MapPin).where(MapPin.id == pin_id, MapPin.itinerary_id == itinerary_id)
    )
    if not pin:
        raise HTTPException(status_code=404, detail="Pin not found")
    await db.delete(pin)
    await db.commit()
