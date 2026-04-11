"""
Renders itinerary to PDF via WeasyPrint.
Returns raw PDF bytes.
"""
from datetime import date
from pathlib import Path

from jinja2 import Environment, FileSystemLoader
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.itinerary import ItineraryDay, ItineraryItem


TEMPLATE_DIR = Path(__file__).parent.parent / "templates"


def _build_template_context(title: str, days_data: list[dict]) -> dict:
    return {
        "title": title,
        "export_date": date.today().isoformat(),
        "days": days_data,
    }


async def generate_pdf_bytes(
    itinerary_id: str,
    title: str,
    db: AsyncSession,
) -> bytes:
    """
    Builds the itinerary PDF and returns raw bytes.
    """
    days_result = await db.scalars(
        select(ItineraryDay)
        .where(ItineraryDay.itinerary_id == itinerary_id)
        .order_by(ItineraryDay.day_order)
    )
    days = list(days_result)
    days_data = []
    for day in days:
        items_result = await db.scalars(
            select(ItineraryItem)
            .where(ItineraryItem.day_id == day.id)
            .order_by(ItineraryItem.item_order)
        )
        days_data.append({
            "date": str(day.date),
            "items": [
                {
                    "time_start": i.time_start,
                    "time_end": i.time_end,
                    "spot_name": i.spot_name,
                    "activity_desc": i.activity_desc,
                    "transport": i.transport,
                    "estimated_cost": i.estimated_cost,
                    "notes": i.notes,
                }
                for i in items_result
            ],
        })

    env = Environment(loader=FileSystemLoader(str(TEMPLATE_DIR)))
    template = env.get_template("itinerary_pdf.html")
    html_content = template.render(_build_template_context(title, days_data))

    from weasyprint import HTML
    pdf_bytes = HTML(string=html_content).write_pdf()

    return pdf_bytes
