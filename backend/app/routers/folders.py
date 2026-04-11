from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.core.database import get_db
from app.deps import get_current_user
from app.models.user import User
from app.models.folder import Folder
from app.schemas.folder import FolderCreate, FolderUpdate, FolderOut
import uuid

router = APIRouter(prefix="/folders", tags=["folders"])

@router.get("", response_model=list[FolderOut])
async def list_folders(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.scalars(select(Folder).where(Folder.owner_id == current_user.id).order_by(Folder.created_at))
    return list(result)

@router.post("", response_model=FolderOut, status_code=201)
async def create_folder(payload: FolderCreate, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    folder = Folder(id=str(uuid.uuid4()), owner_id=current_user.id, name=payload.name)
    db.add(folder)
    await db.commit()
    await db.refresh(folder)
    return folder

@router.patch("/{folder_id}", response_model=FolderOut)
async def update_folder(folder_id: str, payload: FolderUpdate, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    folder = await db.scalar(select(Folder).where(Folder.id == folder_id, Folder.owner_id == current_user.id))
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")
    folder.name = payload.name
    await db.commit()
    await db.refresh(folder)
    return folder

@router.delete("/{folder_id}", status_code=204)
async def delete_folder(folder_id: str, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    folder = await db.scalar(select(Folder).where(Folder.id == folder_id, Folder.owner_id == current_user.id))
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")
    await db.delete(folder)
    await db.commit()
