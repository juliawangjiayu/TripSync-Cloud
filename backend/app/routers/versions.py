from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from fastapi import HTTPException

from app.core.database import get_db
from app.deps import require_editor, require_member
from app.models.version import VersionHistory
from app.models.itinerary import Itinerary
from app.schemas.version import VersionListItem, VersionDetail, DiffEntry, RollbackResponse, CreateVersionRequest, CreateVersionResponse
from app.services.version import rollback_to_version, append_version
from app.deps import get_current_user
from app.models.user import User

router = APIRouter(prefix="/itineraries", tags=["versions"])


@router.get("/{itinerary_id}/versions", response_model=list[VersionListItem])
async def list_versions(
    itinerary_id: str,
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=20, ge=1, le=100),
    member: tuple = Depends(require_member),
    db: AsyncSession = Depends(get_db),
):
    offset = (page - 1) * per_page
    result = await db.scalars(
        select(VersionHistory)
        .where(VersionHistory.itinerary_id == itinerary_id)
        .order_by(VersionHistory.version_num.desc())
        .offset(offset)
        .limit(per_page)
    )
    versions = list(result)

    items = []
    for v in versions:
        change_count = len(v.diff) if v.diff else 0
        items.append(VersionListItem(
            id=v.id,
            version_num=v.version_num,
            entry_type=v.entry_type,
            author_id=v.author_id,
            created_at=v.created_at,
            change_count=change_count,
        ))
    return items


@router.post("/{itinerary_id}/versions", response_model=CreateVersionResponse, status_code=201)
async def create_version(
    itinerary_id: str,
    payload: CreateVersionRequest,
    itin: Itinerary = Depends(require_editor),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not payload.changes:
        raise HTTPException(status_code=400, detail="No changes to record")
    version_num = await append_version(
        itinerary_id=itinerary_id,
        diff=payload.changes,
        author_id=current_user.id,
        db=db,
    )
    await db.commit()
    return CreateVersionResponse(version_num=version_num)


@router.get("/{itinerary_id}/versions/{version_num}", response_model=VersionDetail)
async def get_version_detail(
    itinerary_id: str,
    version_num: int,
    member: tuple = Depends(require_member),
    db: AsyncSession = Depends(get_db),
):
    v = await db.scalar(
        select(VersionHistory).where(
            VersionHistory.itinerary_id == itinerary_id,
            VersionHistory.version_num == version_num,
        )
    )
    if not v:
        raise HTTPException(status_code=404, detail=f"Version {version_num} not found")

    diff_entries = None
    if v.diff:
        diff_entries = [
            DiffEntry(
                item_id=d["item_id"],
                field=d["field"],
                old_value=d.get("old_value"),
                new_value=d.get("new_value"),
            )
            for d in v.diff
        ]

    return VersionDetail(
        id=v.id,
        itinerary_id=v.itinerary_id,
        version_num=v.version_num,
        entry_type=v.entry_type,
        author_id=v.author_id,
        created_at=v.created_at,
        diff=diff_entries,
        has_snapshot=v.snapshot is not None,
    )


@router.post("/{itinerary_id}/versions/{version_num}/rollback", response_model=RollbackResponse)
async def rollback(
    itinerary_id: str,
    version_num: int,
    itin: Itinerary = Depends(require_editor),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    new_num = await rollback_to_version(itinerary_id, version_num, current_user.id, db)
    await db.commit()
    return RollbackResponse(
        new_version_num=new_num,
        message=f"Rolled back to v{version_num}. Current state saved as v{new_num}.",
    )
