from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.deps import get_current_user, require_editor, require_member
from app.models.user import User
from app.models.itinerary import Itinerary, ItineraryDay, ItineraryItem
from app.models.collaboration import Alternative
from app.schemas.collaboration import (
    PatchItemRequest, PatchItemResponse,
    AlternativeCreate, AlternativeOut, AlternativeDismiss,
)
from app.services.collaboration import patch_item, adopt_alternative
import uuid

router = APIRouter(prefix="/itineraries", tags=["collaboration"])


@router.patch("/{itinerary_id}/items/{item_id}", response_model=PatchItemResponse)
async def patch_item_endpoint(
    itinerary_id: str,
    item_id: str,
    payload: PatchItemRequest,
    itin: Itinerary = Depends(require_editor),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await patch_item(item_id, payload, current_user.id, db)


@router.get(
    "/{itinerary_id}/alternatives",
    response_model=list[AlternativeOut],
)
async def list_all_alternatives(
    itinerary_id: str,
    member: tuple = Depends(require_member),
    db: AsyncSession = Depends(get_db),
):
    """Return all active alternatives for every item in this itinerary."""
    day_ids = list(await db.scalars(
        select(ItineraryDay.id).where(ItineraryDay.itinerary_id == itinerary_id)
    ))
    if not day_ids:
        return []
    item_ids = list(await db.scalars(
        select(ItineraryItem.id).where(ItineraryItem.day_id.in_(day_ids))
    ))
    if not item_ids:
        return []
    result = await db.scalars(
        select(Alternative)
        .where(Alternative.item_id.in_(item_ids), Alternative.is_active == True)
        .order_by(Alternative.created_at)
    )
    return list(result)


@router.get(
    "/{itinerary_id}/items/{item_id}/alternatives",
    response_model=list[AlternativeOut],
)
async def list_alternatives(
    itinerary_id: str,
    item_id: str,
    field: str | None = None,
    member: tuple = Depends(require_member),
    db: AsyncSession = Depends(get_db),
):
    q = select(Alternative).where(
        Alternative.item_id == item_id,
        Alternative.is_active == True,
    )
    if field:
        q = q.where(Alternative.field_name == field)
    q = q.order_by(Alternative.created_at)
    result = await db.scalars(q)
    return list(result)


@router.post(
    "/{itinerary_id}/items/{item_id}/alternatives",
    response_model=AlternativeOut,
    status_code=201,
)
async def create_alternative(
    itinerary_id: str,
    item_id: str,
    payload: AlternativeCreate,
    itin: Itinerary = Depends(require_editor),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    alt = Alternative(
        id=str(uuid.uuid4()),
        item_id=item_id,
        field_name=payload.field_name,
        value=payload.value,
        proposed_by=current_user.id,
    )
    db.add(alt)
    await db.commit()
    await db.refresh(alt)
    return AlternativeOut.model_validate(alt)


@router.patch(
    "/{itinerary_id}/items/{item_id}/alternatives/{alt_id}",
    response_model=AlternativeOut,
)
async def update_alternative(
    itinerary_id: str,
    item_id: str,
    alt_id: str,
    payload: AlternativeDismiss,
    itin: Itinerary = Depends(require_editor),
    db: AsyncSession = Depends(get_db),
):
    alt = await db.scalar(
        select(Alternative).where(Alternative.id == alt_id, Alternative.item_id == item_id)
    )
    if not alt:
        raise HTTPException(status_code=404, detail="Alternative not found")
    alt.is_active = payload.is_active
    await db.commit()
    await db.refresh(alt)
    return AlternativeOut.model_validate(alt)


@router.post(
    "/{itinerary_id}/items/{item_id}/alternatives/{alt_id}/adopt",
    response_model=PatchItemResponse,
)
async def adopt_alternative_endpoint(
    itinerary_id: str,
    item_id: str,
    alt_id: str,
    itin: Itinerary = Depends(require_editor),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await adopt_alternative(alt_id, current_user.id, db)
