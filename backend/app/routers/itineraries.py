from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from datetime import datetime, timezone
from app.core.database import get_db
from app.deps import get_current_user, require_editor, require_member
from app.models.user import User
from app.models.itinerary import Itinerary, ItineraryMember, ItineraryDay, ItineraryItem, MemberRole
from app.schemas.itinerary import (
    ItineraryCreate, ItineraryUpdate, ItineraryOut, ItineraryDetailOut,
    DayCreate, DayUpdate, DayOut, DayWithItems,
    ItemCreate, ItemOut, ReorderItemRequest,
)
import uuid

router = APIRouter(prefix="/itineraries", tags=["itineraries"])

@router.get("", response_model=list[ItineraryOut])
async def list_itineraries(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    owned = await db.scalars(select(Itinerary).where(Itinerary.owner_id == current_user.id))
    member_ids = await db.scalars(
        select(ItineraryMember.itinerary_id).where(ItineraryMember.user_id == current_user.id)
    )
    shared = await db.scalars(select(Itinerary).where(Itinerary.id.in_(list(member_ids))))
    all_itins = {i.id: i for i in list(owned) + list(shared)}
    return list(all_itins.values())

@router.post("", response_model=ItineraryOut, status_code=201)
async def create_itinerary(payload: ItineraryCreate, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    itin = Itinerary(id=str(uuid.uuid4()), owner_id=current_user.id, title=payload.title, folder_id=payload.folder_id)
    db.add(itin)
    await db.commit()
    await db.refresh(itin)
    return itin

@router.get("/{itinerary_id}", response_model=ItineraryDetailOut)
async def get_itinerary(
    itinerary_id: str,
    member: tuple = Depends(require_member),
    db: AsyncSession = Depends(get_db),
):
    itin, role = member
    days_result = await db.scalars(
        select(ItineraryDay).where(ItineraryDay.itinerary_id == itinerary_id).order_by(ItineraryDay.date)
    )
    days = list(days_result)
    days_with_items = []
    for day in days:
        items_result = await db.scalars(
            select(ItineraryItem).where(ItineraryItem.day_id == day.id).order_by(ItineraryItem.item_order)
        )
        days_with_items.append(DayWithItems(
            id=day.id, itinerary_id=day.itinerary_id, date=day.date,
            day_order=day.day_order, is_collapsed=day.is_collapsed,
            items=[ItemOut.model_validate(i) for i in items_result],
        ))
    return ItineraryDetailOut(
        id=itin.id, title=itin.title, folder_id=itin.folder_id,
        owner_id=itin.owner_id, created_at=itin.created_at, updated_at=itin.updated_at,
        days=days_with_items, my_role=role.value,
    )

@router.patch("/{itinerary_id}", response_model=ItineraryOut)
async def update_itinerary(
    itinerary_id: str, payload: ItineraryUpdate,
    itin: Itinerary = Depends(require_editor),
    db: AsyncSession = Depends(get_db),
):
    if "title" in payload.model_fields_set and payload.title is not None:
        itin.title = payload.title
    if "folder_id" in payload.model_fields_set:
        itin.folder_id = payload.folder_id  # allows setting to None (clear folder)
    itin.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(itin)
    return itin

@router.delete("/{itinerary_id}", status_code=204)
async def delete_itinerary(
    itinerary_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    itin = await db.scalar(select(Itinerary).where(Itinerary.id == itinerary_id, Itinerary.owner_id == current_user.id))
    if not itin:
        raise HTTPException(status_code=404, detail="Itinerary not found")
    await db.delete(itin)
    await db.commit()

@router.post("/{itinerary_id}/days", response_model=DayOut, status_code=201)
async def create_day(
    itinerary_id: str, payload: DayCreate,
    itin: Itinerary = Depends(require_editor),
    db: AsyncSession = Depends(get_db),
):
    # If a day with the same date already exists, return it instead of creating a duplicate
    existing = await db.scalar(
        select(ItineraryDay).where(
            ItineraryDay.itinerary_id == itinerary_id,
            ItineraryDay.date == payload.date,
        )
    )
    if existing:
        return existing
    day = ItineraryDay(id=str(uuid.uuid4()), itinerary_id=itinerary_id, date=payload.date, day_order=payload.day_order)
    db.add(day)
    await db.commit()
    await db.refresh(day)
    return day

@router.patch("/{itinerary_id}/days/{day_id}", response_model=DayOut)
async def update_day(
    itinerary_id: str, day_id: str, payload: DayUpdate,
    itin: Itinerary = Depends(require_editor),
    db: AsyncSession = Depends(get_db),
):
    day = await db.scalar(select(ItineraryDay).where(ItineraryDay.id == day_id, ItineraryDay.itinerary_id == itinerary_id))
    if not day:
        raise HTTPException(status_code=404, detail="Day not found")
    if payload.date is not None:
        day.date = payload.date
    if payload.day_order is not None:
        day.day_order = payload.day_order
    if payload.is_collapsed is not None:
        day.is_collapsed = payload.is_collapsed

    # If date changed, re-sync day_order for all days to match date order
    if payload.date is not None:
        all_days = list(await db.scalars(
            select(ItineraryDay)
            .where(ItineraryDay.itinerary_id == itinerary_id)
            .order_by(ItineraryDay.date)
        ))
        for idx, d in enumerate(all_days):
            if d.day_order != idx:
                d.day_order = idx

    await db.commit()
    await db.refresh(day)
    return day

@router.delete("/{itinerary_id}/days/{day_id}", status_code=204)
async def delete_day(
    itinerary_id: str, day_id: str,
    itin: Itinerary = Depends(require_editor),
    db: AsyncSession = Depends(get_db),
):
    day = await db.scalar(select(ItineraryDay).where(ItineraryDay.id == day_id, ItineraryDay.itinerary_id == itinerary_id))
    if not day:
        raise HTTPException(status_code=404, detail="Day not found")
    await db.delete(day)
    await db.commit()

@router.post("/{itinerary_id}/days/{day_id}/items", response_model=ItemOut, status_code=201)
async def create_item(
    itinerary_id: str, day_id: str, payload: ItemCreate,
    itin: Itinerary = Depends(require_editor),
    db: AsyncSession = Depends(get_db),
):
    day = await db.scalar(select(ItineraryDay).where(ItineraryDay.id == day_id, ItineraryDay.itinerary_id == itinerary_id))
    if not day:
        raise HTTPException(status_code=404, detail="Day not found")
    item = ItineraryItem(id=str(uuid.uuid4()), day_id=day_id, **payload.model_dump())
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return ItemOut.model_validate(item)

@router.delete("/{itinerary_id}/items/{item_id}", status_code=204)
async def delete_item(
    itinerary_id: str, item_id: str,
    itin: Itinerary = Depends(require_editor),
    db: AsyncSession = Depends(get_db),
):
    # Join through itinerary_days to verify item belongs to this itinerary
    item = await db.scalar(
        select(ItineraryItem)
        .join(ItineraryDay, ItineraryItem.day_id == ItineraryDay.id)
        .where(ItineraryItem.id == item_id, ItineraryDay.itinerary_id == itinerary_id)
    )
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    await db.delete(item)
    await db.commit()

@router.patch("/{itinerary_id}/items/{item_id}/reorder", response_model=ItemOut)
async def reorder_item(
    itinerary_id: str, item_id: str,
    payload: ReorderItemRequest,
    itin: Itinerary = Depends(require_editor),
    db: AsyncSession = Depends(get_db),
):
    item = await db.scalar(
        select(ItineraryItem)
        .join(ItineraryDay, ItineraryItem.day_id == ItineraryDay.id)
        .where(ItineraryItem.id == item_id, ItineraryDay.itinerary_id == itinerary_id)
    )
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    if payload.day_id is not None:
        # Verify target day belongs to this itinerary
        target_day = await db.scalar(
            select(ItineraryDay).where(
                ItineraryDay.id == payload.day_id,
                ItineraryDay.itinerary_id == itinerary_id,
            )
        )
        if not target_day:
            raise HTTPException(status_code=404, detail="Target day not found in this itinerary")
        item.day_id = payload.day_id
    if payload.new_order is not None:
        item.item_order = payload.new_order
    await db.commit()
    await db.refresh(item)
    return ItemOut.model_validate(item)
