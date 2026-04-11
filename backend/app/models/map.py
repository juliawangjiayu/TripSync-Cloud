import uuid
from datetime import datetime, timezone
from typing import Optional
from sqlalchemy import String, ForeignKey, DateTime, Double
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base


class MapPin(Base):
    __tablename__ = "map_pins"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    itinerary_id: Mapped[str] = mapped_column(
        String, ForeignKey("itineraries.id", ondelete="CASCADE"), nullable=False
    )
    label: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    lat: Mapped[float] = mapped_column(Double, nullable=False)
    lng: Mapped[float] = mapped_column(Double, nullable=False)
    created_by: Mapped[str] = mapped_column(String, ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
