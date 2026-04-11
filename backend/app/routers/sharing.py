import os
import secrets
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.deps import get_current_user, require_editor, require_member
from app.models.user import User
from app.models.itinerary import Itinerary, ItineraryMember, ShareLink, MemberRole
from app.schemas.sharing import (
    ShareLinkCreate, ShareLinkOut,
    JoinResponse,
    MemberOut, MemberRoleUpdate,
)

router = APIRouter(tags=["sharing"])


# -- Share link generation --

@router.post("/itineraries/{itinerary_id}/share-links", response_model=ShareLinkOut)
async def create_share_link(
    itinerary_id: str,
    payload: ShareLinkCreate,
    request: Request,
    itin: Itinerary = Depends(require_editor),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if payload.role not in ("viewer", "editor"):
        raise HTTPException(status_code=422, detail="role must be 'viewer' or 'editor'")

    token = secrets.token_urlsafe(32)
    link = ShareLink(
        token=token,
        itinerary_id=itinerary_id,
        role=MemberRole(payload.role),
        created_by=current_user.id,
        expires_at=payload.expires_at,
    )
    db.add(link)
    await db.commit()
    await db.refresh(link)

    # Use FRONTEND_URL env var, or derive from Origin/Referer header, fallback to request base
    frontend_url = os.environ.get("FRONTEND_URL", "").rstrip("/")
    if not frontend_url:
        origin = request.headers.get("origin") or request.headers.get("referer", "")
        if origin:
            # Strip path from referer to get just the origin
            from urllib.parse import urlparse
            parsed = urlparse(origin)
            frontend_url = f"{parsed.scheme}://{parsed.netloc}"
        else:
            frontend_url = str(request.base_url).rstrip("/")

    return ShareLinkOut(
        token=link.token,
        itinerary_id=link.itinerary_id,
        role=link.role.value,
        created_by=link.created_by,
        expires_at=link.expires_at,
        url=f"{frontend_url}/join/{token}",
    )


# -- Join via share link --

async def _validate_token(token: str, db: AsyncSession) -> ShareLink:
    """Fetch and validate a share link. Raises 404 if missing/expired."""
    link = await db.scalar(select(ShareLink).where(ShareLink.token == token))
    if not link:
        raise HTTPException(status_code=404, detail="Share link not found")
    if link.expires_at is not None:
        now = datetime.now(timezone.utc)
        expires = link.expires_at
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        if now > expires:
            raise HTTPException(status_code=410, detail="Share link has expired")
    return link


@router.get("/join/{token}", response_model=dict)
async def preview_join(
    token: str,
    db: AsyncSession = Depends(get_db),
):
    link = await _validate_token(token, db)
    itin = await db.scalar(select(Itinerary).where(Itinerary.id == link.itinerary_id))
    if not itin:
        raise HTTPException(status_code=404, detail="Itinerary not found")
    return {
        "itinerary_id": itin.id,
        "role": link.role.value,
        "itinerary_title": itin.title,
    }


@router.post("/join/{token}", response_model=JoinResponse)
async def join_via_link(
    token: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Authenticated join — adds the current user to itinerary_members."""
    link = await _validate_token(token, db)
    itin = await db.scalar(select(Itinerary).where(Itinerary.id == link.itinerary_id))
    if not itin:
        raise HTTPException(status_code=404, detail="Itinerary not found")

    # Owner doesn't need to join
    if itin.owner_id == current_user.id:
        return JoinResponse(
            itinerary_id=itin.id,
            role="editor",
            itinerary_title=itin.title,
            message="You are the owner of this itinerary.",
        )

    # Check if already a member
    existing = await db.scalar(
        select(ItineraryMember).where(
            ItineraryMember.itinerary_id == link.itinerary_id,
            ItineraryMember.user_id == current_user.id,
        )
    )
    if existing:
        # Upgrade role if the link grants a higher permission
        if link.role == MemberRole.editor and existing.role == MemberRole.viewer:
            existing.role = MemberRole.editor
            await db.commit()
        return JoinResponse(
            itinerary_id=itin.id,
            role=existing.role.value,
            itinerary_title=itin.title,
            message="You are already a member of this itinerary.",
        )

    member = ItineraryMember(
        itinerary_id=link.itinerary_id,
        user_id=current_user.id,
        role=link.role,
        invited_via="link",
    )
    db.add(member)
    await db.commit()

    return JoinResponse(
        itinerary_id=itin.id,
        role=link.role.value,
        itinerary_title=itin.title,
        message=f"You have joined '{itin.title}' as {link.role.value}.",
    )


# -- Member management --

@router.get("/itineraries/{itinerary_id}/members", response_model=list[MemberOut])
async def list_members(
    itinerary_id: str,
    member: tuple = Depends(require_member),
    db: AsyncSession = Depends(get_db),
):
    itin, _ = member
    members_result = await db.scalars(
        select(ItineraryMember).where(ItineraryMember.itinerary_id == itinerary_id)
    )
    members = list(members_result)

    # Resolve user details
    user_ids = [m.user_id for m in members]
    users_result = await db.scalars(select(User).where(User.id.in_(user_ids)))
    users_by_id = {u.id: u for u in users_result}

    # Include owner as editor
    owner = await db.scalar(select(User).where(User.id == itin.owner_id))
    result = []

    if owner:
        result.append(MemberOut(
            user_id=owner.id,
            username=owner.username,
            email=owner.email,
            role="editor",
            joined_at=itin.created_at,
            invited_via=None,
        ))

    for m in members:
        u = users_by_id.get(m.user_id)
        if u:
            result.append(MemberOut(
                user_id=u.id,
                username=u.username,
                email=u.email,
                role=m.role.value,
                joined_at=m.joined_at,
                invited_via=m.invited_via,
            ))
    return result


@router.patch("/itineraries/{itinerary_id}/members/{user_id}", response_model=MemberOut)
async def update_member_role(
    itinerary_id: str,
    user_id: str,
    payload: MemberRoleUpdate,
    itin: Itinerary = Depends(require_editor),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Owner-only: change a member's role."""
    if itin.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Only the owner can change member roles")
    if payload.role not in ("viewer", "editor"):
        raise HTTPException(status_code=422, detail="role must be 'viewer' or 'editor'")

    m = await db.scalar(
        select(ItineraryMember).where(
            ItineraryMember.itinerary_id == itinerary_id,
            ItineraryMember.user_id == user_id,
        )
    )
    if not m:
        raise HTTPException(status_code=404, detail="Member not found")

    m.role = MemberRole(payload.role)
    await db.commit()
    await db.refresh(m)

    u = await db.scalar(select(User).where(User.id == user_id))
    return MemberOut(
        user_id=u.id,
        username=u.username,
        email=u.email,
        role=m.role.value,
        joined_at=m.joined_at,
        invited_via=m.invited_via,
    )


@router.delete("/itineraries/{itinerary_id}/members/{user_id}", status_code=204)
async def remove_member(
    itinerary_id: str,
    user_id: str,
    itin: Itinerary = Depends(require_editor),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Owner-only: remove a member from the itinerary."""
    if itin.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Only the owner can remove members")
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="Owner cannot remove themselves")

    m = await db.scalar(
        select(ItineraryMember).where(
            ItineraryMember.itinerary_id == itinerary_id,
            ItineraryMember.user_id == user_id,
        )
    )
    if not m:
        raise HTTPException(status_code=404, detail="Member not found")

    await db.delete(m)
    await db.commit()
