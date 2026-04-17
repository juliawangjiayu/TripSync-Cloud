from pydantic import BaseModel
from datetime import datetime
from typing import Optional, Any


class DiffEntry(BaseModel):
    item_id: str
    field: str
    old_value: Optional[Any]
    new_value: Optional[Any]


class ChangeSummary(BaseModel):
    edits: int = 0
    creates: int = 0
    deletes: int = 0
    reorders: int = 0


class VersionListItem(BaseModel):
    """Summary row shown in the history drawer."""
    id: str
    version_num: int
    entry_type: str         # 'edit' | 'rollback'
    author_id: Optional[str]
    created_at: datetime
    change_count: int       # total number of diff entries
    change_summary: ChangeSummary

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
