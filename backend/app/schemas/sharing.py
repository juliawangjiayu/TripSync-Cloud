from pydantic import BaseModel
from datetime import datetime
from typing import Optional


class ShareLinkCreate(BaseModel):
    role: str  # 'viewer' | 'editor'
    expires_at: Optional[datetime] = None


class ShareLinkOut(BaseModel):
    token: str
    itinerary_id: str
    role: str
    created_by: str
    expires_at: Optional[datetime]
    url: str   # convenience field built by the router

    model_config = {"from_attributes": True}


class JoinResponse(BaseModel):
    itinerary_id: str
    role: str
    itinerary_title: str
    message: str


class MemberOut(BaseModel):
    user_id: str
    username: str
    email: str
    role: str
    joined_at: datetime
    invited_via: Optional[str]

    model_config = {"from_attributes": True}


class MemberRoleUpdate(BaseModel):
    role: str  # 'viewer' | 'editor'
