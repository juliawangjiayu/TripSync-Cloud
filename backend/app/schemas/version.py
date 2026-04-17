from pydantic import BaseModel
from datetime import datetime
from typing import Optional, Any


class DiffEntry(BaseModel):
    item_id: str
    field: str
    old_value: Optional[Any]
    new_value: Optional[Any]


class VersionListItem(BaseModel):
    """Summary row shown in the history drawer."""
    id: str
    version_num: int
    entry_type: str         # 'edit' | 'rollback'
    author_id: Optional[str]
    created_at: datetime
    change_count: int       # number of fields changed (len of diff), 0 for snapshot-only entries

    model_config = {"from_attributes": True}


class VersionDetail(BaseModel):
    """Full detail for a single version (shown on expand)."""
    id: str
    itinerary_id: str
    version_num: int
    entry_type: str
    author_id: Optional[str]
    created_at: datetime
    diff: Optional[list[DiffEntry]]
    has_snapshot: bool

    model_config = {"from_attributes": True}


class RollbackResponse(BaseModel):
    new_version_num: int
    message: str


class CreateVersionRequest(BaseModel):
    changes: list[dict]

class CreateVersionResponse(BaseModel):
    version_num: int
