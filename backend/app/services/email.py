"""
Sends the itinerary PDF as an email attachment via AWS SES.
"""
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.application import MIMEApplication

import boto3
from app.core.config import settings


SENDER_EMAIL = "noreply@tripsync.example.com"  # must be SES-verified


def send_pdf_email(to_address: str, itinerary_title: str, pdf_bytes: bytes) -> None:
    """Sends an email with the PDF as an attachment using AWS SES raw send."""
    msg = MIMEMultipart()
    msg["Subject"] = f"Your TripSync Itinerary: {itinerary_title}"
    msg["From"] = SENDER_EMAIL
    msg["To"] = to_address

    body = MIMEText(f"Please find your itinerary '{itinerary_title}' attached.", "plain")
    msg.attach(body)

    attachment = MIMEApplication(pdf_bytes, _subtype="pdf")
    safe_name = "".join(c if c.isalnum() or c in "-_ " else "_" for c in itinerary_title)
    attachment.add_header("Content-Disposition", "attachment", filename=f"{safe_name}.pdf")
    msg.attach(attachment)

    ses = boto3.client("ses", region_name=settings.AWS_REGION)
    ses.send_raw_email(
        Source=SENDER_EMAIL,
        Destinations=[to_address],
        RawMessage={"Data": msg.as_bytes()},
    )
