import uuid
from datetime import datetime, timezone
from typing import Optional
from sqlalchemy import String, ForeignKey, DateTime, Integer, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base


class VersionHistory(Base):
    __tablename__ = "version_history"
    __table_args__ = (
        UniqueConstraint("itinerary_id", "version_num", name="uq_version_itinerary_num"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    itinerary_id: Mapped[str] = mapped_column(
        String, ForeignKey("itineraries.id", ondelete="CASCADE"), nullable=False
    )
    version_num: Mapped[int] = mapped_column(Integer, nullable=False)
    # Full snapshot (stored at version 1 and every 50th)
    snapshot: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    # Incremental diff for all other versions
    diff: Mapped[Optional[list]] = mapped_column(JSONB, nullable=True)
    entry_type: Mapped[str] = mapped_column(String(20), default="edit")  # 'edit' | 'rollback'
    author_id: Mapped[Optional[str]] = mapped_column(String, ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
