from datetime import datetime, timezone
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from fastapi import HTTPException

from app.models.itinerary import ItineraryItem, ItineraryDay, Itinerary
from app.models.collaboration import Alternative
from app.schemas.collaboration import PatchItemRequest, PatchItemResponse, AlternativeOut, FieldChange, ConflictedFieldInfo
import uuid

LOCKABLE_FIELDS = {
    "time_start": "time_updated_at",
    "time_end": "time_updated_at",
    "spot_name": "spot_updated_at",
    "activity_desc": "activity_updated_at",
    "transport": "transport_updated_at",
    "estimated_cost": "cost_updated_at",
    "booking_status": "booking_status_updated_at",
    "booking_url": "booking_url_updated_at",
    "notes": "notes_updated_at",
    "rating": "rating_updated_at",
}


async def patch_item(
    item_id: str,
    payload: PatchItemRequest,
    author_id: str,
    db: AsyncSession,
) -> PatchItemResponse:
    result = await db.execute(
        select(ItineraryItem)
        .where(ItineraryItem.id == item_id)
        .with_for_update()
    )
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    accepted: list[FieldChange] = []
    conflicted: list[FieldChange] = []

    for change in payload.changes:
        field = change.field
        if field not in LOCKABLE_FIELDS:
            raise HTTPException(status_code=422, detail=f"Field '{field}' is not patchable")

        ts_field = LOCKABLE_FIELDS[field]
        current_ts: datetime = getattr(item, ts_field)

        based_on = change.based_on_updated_at
        if based_on.tzinfo is None:
            based_on = based_on.replace(tzinfo=timezone.utc)
        if current_ts.tzinfo is None:
            current_ts = current_ts.replace(tzinfo=timezone.utc)

        if based_on >= current_ts:
            accepted.append(change)
        else:
            conflicted.append(change)

    now = datetime.now(timezone.utc)
    for change in accepted:
        setattr(item, change.field, change.value)
        setattr(item, LOCKABLE_FIELDS[change.field], now)
    item.last_modified_by = author_id

    new_alts: list[Alternative] = []
    for change in conflicted:
        alt = Alternative(
            id=str(uuid.uuid4()),
            item_id=item_id,
            field_name=change.field,
            value=str(change.value) if change.value is not None else "",
            proposed_by=author_id,
        )
        db.add(alt)
        new_alts.append(alt)

    await db.flush()

    await db.commit()

    refreshed_alts = []
    for alt in new_alts:
        await db.refresh(alt)
        refreshed_alts.append(AlternativeOut.model_validate(alt))

    # Build current server values for conflicted fields so the client can update its display
    conflicted_field_infos = []
    for change in conflicted:
        ts_field = LOCKABLE_FIELDS[change.field]
        conflicted_field_infos.append(ConflictedFieldInfo(
            field=change.field,
            current_value=getattr(item, change.field),
            updated_at=getattr(item, ts_field),
        ))

    return PatchItemResponse(
        accepted=[c.field for c in accepted],
        conflicted=[c.field for c in conflicted],
        conflicted_fields=conflicted_field_infos,
        alternatives_created=refreshed_alts,
    )


async def adopt_alternative(
    alt_id: str,
    author_id: str,
    db: AsyncSession,
) -> PatchItemResponse:
    alt = await db.scalar(select(Alternative).where(Alternative.id == alt_id, Alternative.is_active == True))
    if not alt:
        raise HTTPException(status_code=404, detail="Alternative not found or already dismissed")

    item = await db.scalar(select(ItineraryItem).where(ItineraryItem.id == alt.item_id))
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    ts_field = LOCKABLE_FIELDS.get(alt.field_name)
    if not ts_field:
        raise HTTPException(status_code=422, detail=f"Field '{alt.field_name}' is not patchable")

    current_ts: datetime = getattr(item, ts_field)

    # Preserve the current value as a new alternative before overwriting
    old_value = getattr(item, alt.field_name)
    if old_value is not None and str(old_value) != "":
        old_alt = Alternative(
            id=str(uuid.uuid4()),
            item_id=alt.item_id,
            field_name=alt.field_name,
            value=str(old_value),
            proposed_by=author_id,
        )
        db.add(old_alt)

    change = FieldChange(
        field=alt.field_name,
        value=alt.value,
        based_on_updated_at=current_ts,
    )
    result = await patch_item(
        item_id=alt.item_id,
        payload=PatchItemRequest(changes=[change]),
        author_id=author_id,
        db=db,
    )

    alt.is_active = False
    await db.commit()

    return result
