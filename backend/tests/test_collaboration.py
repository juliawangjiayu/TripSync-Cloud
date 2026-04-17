import pytest
from httpx import AsyncClient
from datetime import datetime, timezone, timedelta


async def setup_user(client: AsyncClient, email: str) -> tuple[str, dict]:
    r = await client.post("/v1/auth/register", json={"email": email, "username": "U", "password": "pw"})
    data = r.json()
    return data["user"]["id"], {"Authorization": f"Bearer {data['access_token']}"}


async def create_itinerary_with_item(client: AsyncClient, headers: dict) -> tuple[str, str, str, dict]:
    """Returns (itin_id, day_id, item_id, item_data)."""
    itin_id = (await client.post("/v1/itineraries", json={"title": "T"}, headers=headers)).json()["id"]
    day_id = (await client.post(
        f"/v1/itineraries/{itin_id}/days",
        json={"date": "2024-03-17", "day_order": 0},
        headers=headers,
    )).json()["id"]
    item_data = (await client.post(
        f"/v1/itineraries/{itin_id}/days/{day_id}/items",
        json={"spot_name": "Temple A", "item_order": 0},
        headers=headers,
    )).json()
    return itin_id, day_id, item_data["id"], item_data


@pytest.mark.asyncio
async def test_patch_accepted_no_conflict(client: AsyncClient):
    _, h = await setup_user(client, "c1@test.com")
    itin_id, _, item_id, item = await create_itinerary_with_item(client, h)

    r = await client.patch(
        f"/v1/itineraries/{itin_id}/items/{item_id}",
        json={
            "changes": [
                {
                    "field": "spot_name",
                    "value": "Temple B",
                    "based_on_updated_at": item["spot_updated_at"],
                }
            ],
        },
        headers=h,
    )
    assert r.status_code == 200
    data = r.json()
    assert "spot_name" in data["accepted"]
    assert data["conflicted"] == []
    assert data["alternatives_created"] == []


@pytest.mark.asyncio
async def test_patch_conflict_creates_alternative(client: AsyncClient):
    _, h = await setup_user(client, "c2@test.com")
    itin_id, _, item_id, item = await create_itinerary_with_item(client, h)

    actual_ts = datetime.fromisoformat(item["spot_updated_at"].replace("Z", "+00:00"))
    stale_ts = (actual_ts - timedelta(hours=1)).isoformat()

    r = await client.patch(
        f"/v1/itineraries/{itin_id}/items/{item_id}",
        json={
            "changes": [
                {
                    "field": "spot_name",
                    "value": "Conflicting Name",
                    "based_on_updated_at": stale_ts,
                }
            ],
        },
        headers=h,
    )
    assert r.status_code == 200
    data = r.json()
    assert "spot_name" in data["conflicted"]
    assert data["accepted"] == []
    assert len(data["alternatives_created"]) == 1
    assert data["alternatives_created"][0]["value"] == "Conflicting Name"


@pytest.mark.asyncio
async def test_patch_mixed_accepted_and_conflicted(client: AsyncClient):
    _, h = await setup_user(client, "c3@test.com")
    itin_id, _, item_id, item = await create_itinerary_with_item(client, h)

    actual_notes_ts = datetime.fromisoformat(item["notes_updated_at"].replace("Z", "+00:00"))
    actual_spot_ts = datetime.fromisoformat(item["spot_updated_at"].replace("Z", "+00:00"))
    stale_spot_ts = (actual_spot_ts - timedelta(hours=1)).isoformat()

    r = await client.patch(
        f"/v1/itineraries/{itin_id}/items/{item_id}",
        json={
            "changes": [
                {"field": "notes", "value": "Fresh note", "based_on_updated_at": actual_notes_ts.isoformat()},
                {"field": "spot_name", "value": "Stale spot", "based_on_updated_at": stale_spot_ts},
            ],
        },
        headers=h,
    )
    assert r.status_code == 200
    data = r.json()
    assert "notes" in data["accepted"]
    assert "spot_name" in data["conflicted"]
    assert len(data["alternatives_created"]) == 1


@pytest.mark.asyncio
async def test_patch_invalid_field_returns_422(client: AsyncClient):
    _, h = await setup_user(client, "c4@test.com")
    itin_id, _, item_id, item = await create_itinerary_with_item(client, h)

    r = await client.patch(
        f"/v1/itineraries/{itin_id}/items/{item_id}",
        json={
            "changes": [{"field": "id", "value": "hack", "based_on_updated_at": item["spot_updated_at"]}],
        },
        headers=h,
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_viewer_cannot_patch(client: AsyncClient):
    _, owner_h = await setup_user(client, "c5a@test.com")
    _, viewer_h = await setup_user(client, "c5b@test.com")
    itin_id, _, item_id, item = await create_itinerary_with_item(client, owner_h)

    r = await client.patch(
        f"/v1/itineraries/{itin_id}/items/{item_id}",
        json={
            "changes": [{"field": "notes", "value": "x", "based_on_updated_at": item["notes_updated_at"]}],
        },
        headers=viewer_h,
    )
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_create_alternative_active_mode(client: AsyncClient):
    _, h = await setup_user(client, "c6@test.com")
    itin_id, _, item_id, _ = await create_itinerary_with_item(client, h)

    r = await client.post(
        f"/v1/itineraries/{itin_id}/items/{item_id}/alternatives",
        json={"field_name": "spot_name", "value": "Alternative Spot"},
        headers=h,
    )
    assert r.status_code == 201
    alt = r.json()
    assert alt["field_name"] == "spot_name"
    assert alt["value"] == "Alternative Spot"
    assert alt["is_active"] is True


@pytest.mark.asyncio
async def test_list_alternatives(client: AsyncClient):
    _, h = await setup_user(client, "c7@test.com")
    itin_id, _, item_id, _ = await create_itinerary_with_item(client, h)

    await client.post(f"/v1/itineraries/{itin_id}/items/{item_id}/alternatives", json={"field_name": "spot_name", "value": "Opt A"}, headers=h)
    await client.post(f"/v1/itineraries/{itin_id}/items/{item_id}/alternatives", json={"field_name": "notes", "value": "Note Opt"}, headers=h)

    r = await client.get(f"/v1/itineraries/{itin_id}/items/{item_id}/alternatives", headers=h)
    assert r.status_code == 200
    assert len(r.json()) == 2

    r2 = await client.get(f"/v1/itineraries/{itin_id}/items/{item_id}/alternatives?field=spot_name", headers=h)
    assert len(r2.json()) == 1
    assert r2.json()[0]["field_name"] == "spot_name"


@pytest.mark.asyncio
async def test_dismiss_alternative(client: AsyncClient):
    _, h = await setup_user(client, "c8@test.com")
    itin_id, _, item_id, _ = await create_itinerary_with_item(client, h)

    alt_id = (await client.post(
        f"/v1/itineraries/{itin_id}/items/{item_id}/alternatives",
        json={"field_name": "spot_name", "value": "To dismiss"},
        headers=h,
    )).json()["id"]

    r = await client.patch(f"/v1/itineraries/{itin_id}/items/{item_id}/alternatives/{alt_id}", json={"is_active": False}, headers=h)
    assert r.status_code == 200
    assert r.json()["is_active"] is False

    r2 = await client.get(f"/v1/itineraries/{itin_id}/items/{item_id}/alternatives", headers=h)
    assert all(a["is_active"] for a in r2.json())


@pytest.mark.asyncio
async def test_adopt_alternative(client: AsyncClient):
    _, h = await setup_user(client, "c9@test.com")
    itin_id, _, item_id, _ = await create_itinerary_with_item(client, h)

    alt_id = (await client.post(
        f"/v1/itineraries/{itin_id}/items/{item_id}/alternatives",
        json={"field_name": "spot_name", "value": "Adopted Spot"},
        headers=h,
    )).json()["id"]

    r = await client.post(f"/v1/itineraries/{itin_id}/items/{item_id}/alternatives/{alt_id}/adopt", headers=h)
    assert r.status_code == 200
    data = r.json()
    assert "spot_name" in data["accepted"]

    alts = (await client.get(f"/v1/itineraries/{itin_id}/items/{item_id}/alternatives", headers=h)).json()
    assert all(a["id"] != alt_id for a in alts)
