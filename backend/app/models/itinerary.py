from __future__ import annotations
import uuid
from datetime import datetime, timezone, date
from typing import Optional
from sqlalchemy import String, ForeignKey, DateTime, Date, Integer, Boolean, Numeric, SmallInteger, Text, Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base
import enum

class MemberRole(str, enum.Enum):
    viewer = "viewer"
    editor = "editor"

class Itinerary(Base):
    __tablename__ = "itineraries"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    folder_id: Mapped[Optional[str]] = mapped_column(String, ForeignKey("folders.id", ondelete="SET NULL"), nullable=True)
    owner_id: Mapped[str] = mapped_column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

class ItineraryMember(Base):
    __tablename__ = "itinerary_members"

    itinerary_id: Mapped[str] = mapped_column(String, ForeignKey("itineraries.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    role: Mapped[MemberRole] = mapped_column(SAEnum(MemberRole), default=MemberRole.editor)
    invited_via: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

class ShareLink(Base):
    __tablename__ = "share_links"

    token: Mapped[str] = mapped_column(String(64), primary_key=True)
    itinerary_id: Mapped[str] = mapped_column(String, ForeignKey("itineraries.id", ondelete="CASCADE"), nullable=False)
    role: Mapped[MemberRole] = mapped_column(SAEnum(MemberRole), nullable=False)
    created_by: Mapped[str] = mapped_column(String, ForeignKey("users.id"), nullable=False)
    expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

class ItineraryDay(Base):
    __tablename__ = "itinerary_days"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    itinerary_id: Mapped[str] = mapped_column(String, ForeignKey("itineraries.id", ondelete="CASCADE"), nullable=False)
    date: Mapped[date] = mapped_column(Date, nullable=False)
    day_order: Mapped[int] = mapped_column(Integer, default=0)
    is_collapsed: Mapped[bool] = mapped_column(Boolean, default=False)

_TS = lambda: datetime.now(timezone.utc)

class ItineraryItem(Base):
    __tablename__ = "itinerary_items"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    day_id: Mapped[str] = mapped_column(String, ForeignKey("itinerary_days.id", ondelete="CASCADE"), nullable=False)
    item_order: Mapped[int] = mapped_column(Integer, default=0)
    time_start: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    time_end: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    spot_name: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    activity_desc: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    transport: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    estimated_cost: Mapped[Optional[float]] = mapped_column(Numeric(10, 2), nullable=True)
    booking_status: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    booking_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    rating: Mapped[Optional[int]] = mapped_column(SmallInteger, nullable=True)
    time_updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_TS)
    spot_updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_TS)
    activity_updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_TS)
    transport_updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_TS)
    cost_updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_TS)
    booking_status_updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_TS)
    booking_url_updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_TS)
    notes_updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_TS)
    rating_updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_TS)
    last_modified_by: Mapped[Optional[str]] = mapped_column(String, ForeignKey("users.id"), nullable=True)
