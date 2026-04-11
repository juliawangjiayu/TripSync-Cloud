from pydantic import BaseModel, field_validator
from datetime import datetime, date as date_type
from typing import Optional

class ItineraryCreate(BaseModel):
    title: str
    folder_id: Optional[str] = None

class ItineraryUpdate(BaseModel):
    title: Optional[str] = None
    folder_id: Optional[str] = None

class ItineraryOut(BaseModel):
    id: str
    title: str
    folder_id: Optional[str]
    owner_id: str
    created_at: datetime
    updated_at: datetime
    model_config = {"from_attributes": True}

class DayCreate(BaseModel):
    date: date_type
    day_order: int = 0

    @field_validator('date', mode='before')
    @classmethod
    def parse_date(cls, v: object) -> object:
        if isinstance(v, str):
            return date_type.fromisoformat(v)
        return v

class DayUpdate(BaseModel):
    date: Optional[date_type] = None
    day_order: Optional[int] = None
    is_collapsed: Optional[bool] = None

    @field_validator('date', mode='before')
    @classmethod
    def parse_date(cls, v: object) -> object:
        if isinstance(v, str):
            if v == '':
                return None
            return date_type.fromisoformat(v)
        return v

class DayOut(BaseModel):
    id: str
    itinerary_id: str
    date: date_type
    day_order: int
    is_collapsed: bool
    model_config = {"from_attributes": True}

class ItemCreate(BaseModel):
    item_order: int = 0
    time_start: Optional[str] = None
    time_end: Optional[str] = None
    spot_name: Optional[str] = None
    activity_desc: Optional[str] = None
    transport: Optional[str] = None
    estimated_cost: Optional[float] = None
    booking_status: Optional[str] = None
    booking_url: Optional[str] = None
    notes: Optional[str] = None
    rating: Optional[int] = None

class ItemOut(BaseModel):
    id: str
    day_id: str
    item_order: int
    time_start: Optional[str]
    time_end: Optional[str]
    spot_name: Optional[str]
    activity_desc: Optional[str]
    transport: Optional[str]
    estimated_cost: Optional[float]
    booking_status: Optional[str]
    booking_url: Optional[str]
    notes: Optional[str]
    rating: Optional[int]
    time_updated_at: datetime
    spot_updated_at: datetime
    activity_updated_at: datetime
    transport_updated_at: datetime
    cost_updated_at: datetime
    booking_status_updated_at: datetime
    booking_url_updated_at: datetime
    notes_updated_at: datetime
    rating_updated_at: datetime
    last_modified_by: Optional[str]
    model_config = {"from_attributes": True}

class ItineraryDetailOut(BaseModel):
    id: str
    title: str
    folder_id: Optional[str]
    owner_id: str
    created_at: datetime
    updated_at: datetime
    days: list["DayWithItems"]
    my_role: str = "editor"
    model_config = {"from_attributes": True}

class DayWithItems(BaseModel):
    id: str
    itinerary_id: str
    date: date_type
    day_order: int
    is_collapsed: bool
    items: list[ItemOut]
    model_config = {"from_attributes": True}

class ReorderItemRequest(BaseModel):
    day_id: Optional[str] = None
    new_order: Optional[int] = None
