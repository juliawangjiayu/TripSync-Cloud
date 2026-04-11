from pydantic import BaseModel
from datetime import datetime
from typing import Optional


class MapPinCreate(BaseModel):
    label: Optional[str] = None
    lat: float
    lng: float


class MapPinOut(BaseModel):
    id: str
    itinerary_id: str
    label: Optional[str]
    lat: float
    lng: float
    created_by: str
    created_at: datetime

    model_config = {"from_attributes": True}
