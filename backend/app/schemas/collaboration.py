from pydantic import BaseModel
from datetime import datetime
from typing import Optional

class FieldChange(BaseModel):
    field: str
    value: Optional[str | int | float | bool] = None
    based_on_updated_at: datetime

class PatchItemRequest(BaseModel):
    changes: list[FieldChange]

class AlternativeOut(BaseModel):
    id: str
    item_id: str
    field_name: str
    value: str
    proposed_by: str
    created_at: datetime
    is_active: bool
    model_config = {"from_attributes": True}

class ConflictedFieldInfo(BaseModel):
    field: str
    current_value: Optional[str | int | float | bool] = None
    updated_at: datetime

class PatchItemResponse(BaseModel):
    accepted: list[str]
    conflicted: list[str]
    conflicted_fields: list[ConflictedFieldInfo] = []
    alternatives_created: list[AlternativeOut]

class AlternativeCreate(BaseModel):
    field_name: str
    value: str

class AlternativeDismiss(BaseModel):
    is_active: bool
