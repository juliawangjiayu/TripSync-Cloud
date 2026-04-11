"""add version_history table

Revision ID: c3a1f0b2d4e5
Revises: 86c59faddce0
Create Date: 2026-04-01 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'c3a1f0b2d4e5'
down_revision: Union[str, None] = '86c59faddce0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'version_history',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('itinerary_id', sa.String(), nullable=False),
        sa.Column('version_num', sa.Integer(), nullable=False),
        sa.Column('snapshot', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('diff', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('entry_type', sa.String(length=20), nullable=True),
        sa.Column('author_id', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['author_id'], ['users.id'], ),
        sa.ForeignKeyConstraint(['itinerary_id'], ['itineraries.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('itinerary_id', 'version_num', name='uq_version_itinerary_num'),
    )


def downgrade() -> None:
    op.drop_table('version_history')
