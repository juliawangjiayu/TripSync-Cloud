"""add map_pins table

Revision ID: d4b2e1f3a567
Revises: c3a1f0b2d4e5
Create Date: 2026-04-02 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "d4b2e1f3a567"
down_revision: Union[str, None] = "c3a1f0b2d4e5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "map_pins",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("itinerary_id", sa.String(), sa.ForeignKey("itineraries.id", ondelete="CASCADE"), nullable=False),
        sa.Column("label", sa.String(200), nullable=True),
        sa.Column("lat", sa.Double(), nullable=False),
        sa.Column("lng", sa.Double(), nullable=False),
        sa.Column("created_by", sa.String(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("map_pins")
