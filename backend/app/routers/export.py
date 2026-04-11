from fastapi import APIRouter, Depends, BackgroundTasks, HTTPException
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.deps import require_member
from app.schemas.export import ExportPDFResponse, ExportEmailRequest
from app.services.pdf import generate_pdf_bytes
from app.services.email import send_pdf_email

router = APIRouter(prefix="/itineraries", tags=["export"])


@router.post("/{itinerary_id}/export/pdf")
async def export_pdf(
    itinerary_id: str,
    member: tuple = Depends(require_member),
    db: AsyncSession = Depends(get_db),
):
    itin, _ = member
    try:
        pdf_bytes = await generate_pdf_bytes(itinerary_id, itin.title, db)
        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{itin.title}.pdf"'},
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"PDF generation failed: {str(e)}")


@router.post("/{itinerary_id}/export/email", status_code=202)
async def export_email(
    itinerary_id: str,
    payload: ExportEmailRequest,
    background_tasks: BackgroundTasks,
    member: tuple = Depends(require_member),
    db: AsyncSession = Depends(get_db),
):
    itin, _ = member

    async def _send():
        from weasyprint import HTML
        from jinja2 import Environment, FileSystemLoader
        from pathlib import Path
        from sqlalchemy import select
        from app.models.itinerary import ItineraryDay, ItineraryItem
        from datetime import date

        days_result = await db.scalars(
            select(ItineraryDay)
            .where(ItineraryDay.itinerary_id == itinerary_id)
            .order_by(ItineraryDay.day_order)
        )
        days = list(days_result)
        days_data = []
        for day in days:
            items_result = await db.scalars(
                select(ItineraryItem).where(ItineraryItem.day_id == day.id).order_by(ItineraryItem.item_order)
            )
            days_data.append({
                "date": str(day.date),
                "items": [{"time_start": i.time_start, "time_end": i.time_end, "spot_name": i.spot_name,
                           "activity_desc": i.activity_desc, "transport": i.transport,
                           "estimated_cost": i.estimated_cost, "notes": i.notes}
                          for i in items_result],
            })

        TEMPLATE_DIR = Path(__file__).parent.parent / "templates"
        env = Environment(loader=FileSystemLoader(str(TEMPLATE_DIR)))
        tmpl = env.get_template("itinerary_pdf.html")
        html_content = tmpl.render({"title": itin.title, "export_date": date.today().isoformat(), "days": days_data})
        pdf_bytes = HTML(string=html_content).write_pdf()
        send_pdf_email(payload.to, itin.title, pdf_bytes)

    background_tasks.add_task(_send)
    return {"message": f"PDF will be emailed to {payload.to}"}
