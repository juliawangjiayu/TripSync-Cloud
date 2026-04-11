from pydantic import BaseModel
from datetime import datetime

class FolderCreate(BaseModel):
    name: str

class FolderUpdate(BaseModel):
    name: str

class FolderOut(BaseModel):
    id: str
    name: str
    owner_id: str
    created_at: datetime

    model_config = {"from_attributes": True}
