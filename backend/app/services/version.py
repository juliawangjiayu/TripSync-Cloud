"""
Version history service.
- append_version(): called after every successful item save
- build_full_snapshot(): serialises current itinerary items to JSONB
- rollback_to_version(): replays diffs from nearest base snapshot
"""
from datetime import datetime, timezone
from typing import Any, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, text
from fastapi import HTTPException

from app.models.itinerary import ItineraryItem, ItineraryDay
from app.models.version import VersionHistory
import uuid
import copy

SNAPSHOT_INTERVAL = 50  # full snapshot at version 1 and every Nth


# -- Snapshot builder --

async def build_full_snapshot(itinerary_id: str, db: AsyncSession) -> dict:
    """Return a dict: { items: [ {id, day_id, item_order, spot_name, ...all fields...} ] }"""
    days_result = await db.scalars(
        select(ItineraryDay).where(ItineraryDay.itinerary_id == itinerary_id)
    )
    days = list(days_result)
    day_ids = [d.id for d in days]

    items_result = await db.scalars(
        select(ItineraryItem).where(ItineraryItem.day_id.in_(day_ids))
    )
    items = list(items_result)

    def _item_to_dict(item: ItineraryItem) -> dict:
        return {
            "id": item.id,
            "day_id": item.day_id,
            "item_order": item.item_order,
            "time_start": item.time_start,
            "time_end": item.time_end,
            "spot_name": item.spot_name,
            "activity_desc": item.activity_desc,
            "transport": item.transport,
            "estimated_cost": str(item.estimated_cost) if item.estimated_cost is not None else None,
            "booking_status": item.booking_status,
            "booking_url": item.booking_url,
            "notes": item.notes,
            "rating": item.rating,
            "last_modified_by": item.last_modified_by,
        }

    return {"items": [_item_to_dict(i) for i in items]}


# -- Append version entry --

async def append_version(
    itinerary_id: str,
    changes: list,      # list of FieldChange objects (field, value, old_value optional)
    item_id: str,
    author_id: str,
    db: AsyncSession,
    entry_type: str = "edit",
    forced_snapshot: Optional[dict] = None,
) -> int:
    """
    Appends a new version entry to version_history.
    Returns the new version number.
    Uses a full snapshot at version 1 and every SNAPSHOT_INTERVAL-th version;
    otherwise stores a diff list.
    """
    # Use PostgreSQL advisory lock keyed on itinerary_id hash to prevent concurrent version inserts
    lock_key = hash(itinerary_id) % (2**31)
    await db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": lock_key})

    latest_row = (await db.execute(
        select(VersionHistory)
        .where(VersionHistory.itinerary_id == itinerary_id)
        .order_by(VersionHistory.version_num.desc())
        .limit(1)
    )).scalar_one_or_none()
    last_num = latest_row.version_num if latest_row else 0
    next_num = last_num + 1

    if next_num == 1 or next_num % SNAPSHOT_INTERVAL == 0 or forced_snapshot is not None:
        snapshot = forced_snapshot if forced_snapshot is not None else await build_full_snapshot(itinerary_id, db)
        entry = VersionHistory(
            id=str(uuid.uuid4()),
            itinerary_id=itinerary_id,
            version_num=next_num,
            snapshot=snapshot,
            diff=None,
            entry_type=entry_type,
            author_id=author_id,
        )
    else:
        diff = []
        for change in changes:
            diff.append({
                "item_id": item_id,
                "field": change.field,
                "old_value": None,
                "new_value": str(change.value) if change.value is not None else None,
            })
        entry = VersionHistory(
            id=str(uuid.uuid4()),
            itinerary_id=itinerary_id,
            version_num=next_num,
            snapshot=None,
            diff=diff,
            entry_type=entry_type,
            author_id=author_id,
        )

    db.add(entry)
    await db.flush()
    return next_num


# -- Rollback --

def _find_item_in_snapshot(snapshot: dict, item_id: str) -> Optional[dict]:
    for item in snapshot.get("items", []):
        if item["id"] == item_id:
            return item
    return None


async def rollback_to_version(
    itinerary_id: str,
    target_version: int,
    requester_id: str,
    db: AsyncSession,
) -> int:
    """
    Restores itinerary items to the state at target_version.
    Saves current state as a new rollback version entry first.
    Returns the new version number.
    """
    # Verify target version exists
    versions = list(await db.scalars(
        select(VersionHistory)
        .where(
            VersionHistory.itinerary_id == itinerary_id,
            VersionHistory.version_num <= target_version,
        )
        .order_by(VersionHistory.version_num)
    ))

    if not versions:
        raise HTTPException(status_code=404, detail=f"No version history found up to v{target_version}")

    target_exists = any(v.version_num == target_version for v in versions)
    if not target_exists:
        raise HTTPException(status_code=404, detail=f"Version {target_version} not found")

    # Find the most recent base snapshot at or before target_version
    base = None
    for v in reversed(versions):
        if v.snapshot is not None:
            base = v
            break

    if base is None:
        raise HTTPException(status_code=500, detail="No base snapshot found — history may be corrupted")

    # Deep copy snapshot state
    state = copy.deepcopy(base.snapshot)

    # Replay diffs from base+1 up to target_version
    base_index = versions.index(base)
    for v in versions[base_index + 1:]:
        if v.version_num > target_version:
            break
        if v.diff:
            for change in v.diff:
                item = _find_item_in_snapshot(state, change["item_id"])
                if item is not None:
                    item[change["field"]] = change["new_value"]

    # Save current state as a rollback entry before overwriting
    current_snapshot = await build_full_snapshot(itinerary_id, db)
    new_version_num = await append_version(
        itinerary_id=itinerary_id,
        changes=[],
        item_id="",
        author_id=requester_id,
        db=db,
        entry_type="rollback",
        forced_snapshot=current_snapshot,
    )

    # Overwrite itinerary items with rolled-back state
    await _overwrite_itinerary_items(itinerary_id, state, requester_id, db)

    await db.flush()
    return new_version_num


async def _overwrite_itinerary_items(
    itinerary_id: str,
    state: dict,
    author_id: str,
    db: AsyncSession,
) -> None:
    """
    Replaces all items in the itinerary with the items from `state`.
    Matched by item id; unmatched items are deleted; new items in state are created.
    """
    days_result = await db.scalars(
        select(ItineraryDay).where(ItineraryDay.itinerary_id == itinerary_id)
    )
    days = list(days_result)
    day_ids = {d.id for d in days}

    # Fetch current items
    current_items_result = await db.scalars(
        select(ItineraryItem).where(ItineraryItem.day_id.in_(day_ids))
    )
    current_items = {i.id: i for i in current_items_result}

    now = datetime.now(timezone.utc)
    state_item_ids = {item["id"] for item in state.get("items", [])}

    # Delete items not in rollback state
    for item_id, item in current_items.items():
        if item_id not in state_item_ids:
            await db.delete(item)

    # Update or create items from rollback state
    FIELD_TO_TS = {
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

    for item_data in state.get("items", []):
        item_id = item_data["id"]
        if item_id in current_items:
            item = current_items[item_id]
        else:
            # Item was deleted after the target version — recreate it
            item = ItineraryItem(id=item_id, day_id=item_data["day_id"])
            db.add(item)

        # Apply all fields from snapshot
        for field in ["item_order", "time_start", "time_end", "spot_name", "activity_desc",
                       "transport", "booking_status", "booking_url", "notes", "rating", "last_modified_by"]:
            if field in item_data:
                setattr(item, field, item_data[field])

        if "estimated_cost" in item_data and item_data["estimated_cost"] is not None:
            item.estimated_cost = float(item_data["estimated_cost"])

        # Advance all field timestamps to reflect the rollback
        seen_ts = set()
        for _, ts_field in FIELD_TO_TS.items():
            if ts_field not in seen_ts:
                setattr(item, ts_field, now)
                seen_ts.add(ts_field)

        item.last_modified_by = author_id
