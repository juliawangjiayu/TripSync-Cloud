import pytest
from httpx import AsyncClient


async def setup_user(client: AsyncClient, email: str) -> tuple[str, dict]:
    r = await client.post("/v1/auth/register", json={"email": email, "username": "U", "password": "pw"})
    data = r.json()
    return data["user"]["id"], {"Authorization": f"Bearer {data['access_token']}"}


async def create_itinerary_with_item(client: AsyncClient, headers: dict) -> tuple[str, str, str, dict]:
    itin_id = (await client.post("/v1/itineraries", json={"title": "T"}, headers=headers)).json()["id"]
    day_id = (await client.post(
        f"/v1/itineraries/{itin_id}/days",
        json={"date": "2024-03-17", "day_order": 0},
        headers=headers,
    )).json()["id"]
    item_data = (await client.post(
        f"/v1/itineraries/{itin_id}/days/{day_id}/items",
        json={"spot_name": "Original Spot", "item_order": 0},
        headers=headers,
    )).json()
    return itin_id, day_id, item_data["id"], item_data


async def do_patch(client: AsyncClient, itin_id: str, item_id: str, field: str,
                   value: str, based_on_ts: str, headers: dict) -> dict:
    r = await client.patch(
        f"/v1/itineraries/{itin_id}/items/{item_id}",
        json={
            "changes": [{"field": field, "value": value, "based_on_updated_at": based_on_ts}],
            "save_version": True,
        },
        headers=headers,
    )
    assert r.status_code == 200
    return r.json()


# -- Version list --

@pytest.mark.asyncio
async def test_no_versions_initially(client: AsyncClient):
    _, h = await setup_user(client, "v1@test.com")
    itin_id = (await client.post("/v1/itineraries", json={"title": "T"}, headers=h)).json()["id"]
    r = await client.get(f"/v1/itineraries/{itin_id}/versions", headers=h)
    assert r.status_code == 200
    assert r.json() == []


@pytest.mark.asyncio
async def test_version_created_after_accepted_patch(client: AsyncClient):
    _, h = await setup_user(client, "v2@test.com")
    itin_id, _, item_id, item = await create_itinerary_with_item(client, h)

    await do_patch(client, itin_id, item_id, "spot_name", "New Spot", item["spot_updated_at"], h)

    r = await client.get(f"/v1/itineraries/{itin_id}/versions", headers=h)
    assert r.status_code == 200
    versions = r.json()
    assert len(versions) == 1
    assert versions[0]["version_num"] == 1
    assert versions[0]["entry_type"] == "edit"


@pytest.mark.asyncio
async def test_multiple_patches_increment_version_num(client: AsyncClient):
    _, h = await setup_user(client, "v3@test.com")
    itin_id, _, item_id, item = await create_itinerary_with_item(client, h)

    # Patch 1
    await do_patch(client, itin_id, item_id, "spot_name", "Spot A", item["spot_updated_at"], h)
    # Re-fetch item to get updated timestamps
    detail = (await client.get(f"/v1/itineraries/{itin_id}", headers=h)).json()
    item2 = detail["days"][0]["items"][0]
    # Patch 2
    await do_patch(client, itin_id, item_id, "notes", "Some note", item2["notes_updated_at"], h)

    r = await client.get(f"/v1/itineraries/{itin_id}/versions", headers=h)
    versions = r.json()
    assert len(versions) == 2
    nums = {v["version_num"] for v in versions}
    assert nums == {1, 2}


@pytest.mark.asyncio
async def test_conflicted_patch_does_not_create_version(client: AsyncClient):
    """A fully conflicted patch (no accepted fields) should not append a version."""
    _, h = await setup_user(client, "v4@test.com")
    itin_id, _, item_id, item = await create_itinerary_with_item(client, h)
    from datetime import datetime, timedelta, timezone

    actual_ts = datetime.fromisoformat(item["spot_updated_at"].replace("Z", "+00:00"))
    stale_ts = (actual_ts - timedelta(hours=1)).isoformat()

    await client.patch(
        f"/v1/itineraries/{itin_id}/items/{item_id}",
        json={
            "changes": [{"field": "spot_name", "value": "Conflict", "based_on_updated_at": stale_ts}],
            "save_version": True,
        },
        headers=h,
    )

    r = await client.get(f"/v1/itineraries/{itin_id}/versions", headers=h)
    assert r.json() == []


# -- Version detail --

@pytest.mark.asyncio
async def test_version_detail_returns_diff(client: AsyncClient):
    _, h = await setup_user(client, "v5@test.com")
    itin_id, _, item_id, item = await create_itinerary_with_item(client, h)

    await do_patch(client, itin_id, item_id, "notes", "detail note", item["notes_updated_at"], h)

    r = await client.get(f"/v1/itineraries/{itin_id}/versions/1", headers=h)
    assert r.status_code == 200
    detail = r.json()
    assert detail["version_num"] == 1
    # version 1 is always a snapshot
    assert detail["has_snapshot"] is True


@pytest.mark.asyncio
async def test_version_detail_404_for_missing(client: AsyncClient):
    _, h = await setup_user(client, "v6@test.com")
    itin_id = (await client.post("/v1/itineraries", json={"title": "T"}, headers=h)).json()["id"]
    r = await client.get(f"/v1/itineraries/{itin_id}/versions/99", headers=h)
    assert r.status_code == 404


# -- Pagination --

@pytest.mark.asyncio
async def test_version_list_pagination(client: AsyncClient):
    _, h = await setup_user(client, "v7@test.com")
    itin_id, _, item_id, item = await create_itinerary_with_item(client, h)

    # Create 5 versions
    current_item = item
    for i in range(5):
        await do_patch(client, itin_id, item_id, "notes", f"note {i}", current_item["notes_updated_at"], h)
        detail = (await client.get(f"/v1/itineraries/{itin_id}", headers=h)).json()
        current_item = detail["days"][0]["items"][0]

    r1 = await client.get(f"/v1/itineraries/{itin_id}/versions?page=1&per_page=3", headers=h)
    assert len(r1.json()) == 3

    r2 = await client.get(f"/v1/itineraries/{itin_id}/versions?page=2&per_page=3", headers=h)
    assert len(r2.json()) == 2  # remaining 2


# -- Rollback --

@pytest.mark.asyncio
async def test_rollback_restores_item_field(client: AsyncClient):
    _, h = await setup_user(client, "v8@test.com")
    itin_id, _, item_id, item = await create_itinerary_with_item(client, h)

    # v1: patch spot_name to "First Edit" (snapshot captures state after this edit)
    await do_patch(client, itin_id, item_id, "spot_name", "First Edit",
                   item["spot_updated_at"], h)

    # Refresh item timestamps
    detail_v1 = (await client.get(f"/v1/itineraries/{itin_id}", headers=h)).json()
    item_v1 = detail_v1["days"][0]["items"][0]
    assert item_v1["spot_name"] == "First Edit"

    # v2: patch spot_name to "Second Edit"
    await do_patch(client, itin_id, item_id, "spot_name", "Second Edit",
                   item_v1["spot_updated_at"], h)

    detail_v2 = (await client.get(f"/v1/itineraries/{itin_id}", headers=h)).json()
    assert detail_v2["days"][0]["items"][0]["spot_name"] == "Second Edit"

    # Rollback to v1 (which captured state with "First Edit")
    r = await client.post(f"/v1/itineraries/{itin_id}/versions/1/rollback", headers=h)
    assert r.status_code == 200
    assert "new_version_num" in r.json()
    new_v = r.json()["new_version_num"]
    assert new_v == 3  # current state saved as v3 (rollback entry)

    # Check item was restored to v1 state
    detail_rolled = (await client.get(f"/v1/itineraries/{itin_id}", headers=h)).json()
    assert detail_rolled["days"][0]["items"][0]["spot_name"] == "First Edit"


@pytest.mark.asyncio
async def test_rollback_appends_new_version_entry(client: AsyncClient):
    """Rolling back creates a new rollback version entry — audit trail preserved."""
    _, h = await setup_user(client, "v9@test.com")
    itin_id, _, item_id, item = await create_itinerary_with_item(client, h)

    await do_patch(client, itin_id, item_id, "spot_name", "Changed",
                   item["spot_updated_at"], h)

    # Roll back to v1
    await client.post(f"/v1/itineraries/{itin_id}/versions/1/rollback", headers=h)

    versions = (await client.get(f"/v1/itineraries/{itin_id}/versions", headers=h)).json()
    rollback_entries = [v for v in versions if v["entry_type"] == "rollback"]
    assert len(rollback_entries) == 1


@pytest.mark.asyncio
async def test_rollback_to_nonexistent_version_returns_404(client: AsyncClient):
    _, h = await setup_user(client, "v10@test.com")
    itin_id = (await client.post("/v1/itineraries", json={"title": "T"}, headers=h)).json()["id"]
    r = await client.post(f"/v1/itineraries/{itin_id}/versions/999/rollback", headers=h)
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_viewer_cannot_rollback(client: AsyncClient):
    _, owner_h = await setup_user(client, "v11a@test.com")
    _, viewer_h = await setup_user(client, "v11b@test.com")
    itin_id, _, item_id, item = await create_itinerary_with_item(client, owner_h)
    await do_patch(client, itin_id, item_id, "spot_name", "X", item["spot_updated_at"], owner_h)

    r = await client.post(f"/v1/itineraries/{itin_id}/versions/1/rollback", headers=viewer_h)
    assert r.status_code == 404  # viewer has no membership
