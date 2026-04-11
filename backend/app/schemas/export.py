from pydantic import BaseModel, EmailStr


class ExportPDFResponse(BaseModel):
    url: str


class ExportEmailRequest(BaseModel):
    to: EmailStr
