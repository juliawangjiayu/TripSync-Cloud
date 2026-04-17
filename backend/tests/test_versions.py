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


# -- Create version --

@pytest.mark.asyncio
async def test_no_versions_initially(client: AsyncClient):
    _, h = await setup_user(client, "v1@test.com")
    itin_id = (await client.post("/v1/itineraries", json={"title": "T"}, headers=h)).json()["id"]
    r = await client.get(f"/v1/itineraries/{itin_id}/versions", headers=h)
    assert r.status_code == 200
    assert r.json() == []


@pytest.mark.asyncio
async def test_create_version_with_edit(client: AsyncClient):
    _, h = await setup_user(client, "v2@test.com")
    itin_id, _, item_id, _ = await create_itinerary_with_item(client, h)

    r = await client.post(
        f"/v1/itineraries/{itin_id}/versions",
        json={"changes": [
            {"action": "edit", "item_id": item_id, "field": "spot_name", "old_value": "Original Spot", "new_value": "New Spot"}
        ]},
        headers=h,
    )
    assert r.status_code == 201
    assert r.json()["version_num"] == 1

    versions = (await client.get(f"/v1/itineraries/{itin_id}/versions", headers=h)).json()
    assert len(versions) == 1
    assert versions[0]["change_count"] == 1


@pytest.mark.asyncio
async def test_create_version_with_multiple_actions(client: AsyncClient):
    _, h = await setup_user(client, "v3@test.com")
    itin_id, day_id, item_id, _ = await create_itinerary_with_item(client, h)

    changes = [
        {"action": "edit", "item_id": item_id, "field": "spot_name", "old_value": "Original Spot", "new_value": "Edited"},
        {"action": "create", "item_id": "new-item-1", "day_id": day_id, "spot_name": "New Place"},
        {"action": "delete", "item_id": "deleted-item-1"},
        {"action": "reorder", "item_id": item_id, "old_day_id": day_id, "new_day_id": day_id, "old_order": 0, "new_order": 1},
    ]
    r = await client.post(
        f"/v1/itineraries/{itin_id}/versions",
        json={"changes": changes},
        headers=h,
    )
    assert r.status_code == 201
    assert r.json()["version_num"] == 1

    versions = (await client.get(f"/v1/itineraries/{itin_id}/versions", headers=h)).json()
    assert versions[0]["change_count"] == 4


@pytest.mark.asyncio
async def test_create_version_empty_changes_returns_400(client: AsyncClient):
    _, h = await setup_user(client, "v4@test.com")
    itin_id, _, _, _ = await create_itinerary_with_item(client, h)

    r = await client.post(
        f"/v1/itineraries/{itin_id}/versions",
        json={"changes": []},
        headers=h,
    )
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_multiple_saves_increment_version_num(client: AsyncClient):
    _, h = await setup_user(client, "v5@test.com")
    itin_id, _, item_id, _ = await create_itinerary_with_item(client, h)

    for i in range(3):
        await client.post(
            f"/v1/itineraries/{itin_id}/versions",
            json={"changes": [{"action": "edit", "item_id": item_id, "field": "notes", "old_value": f"n{i}", "new_value": f"n{i+1}"}]},
            headers=h,
        )

    versions = (await client.get(f"/v1/itineraries/{itin_id}/versions", headers=h)).json()
    assert len(versions) == 3
    nums = {v["version_num"] for v in versions}
    assert nums == {1, 2, 3}


# -- Version detail --

@pytest.mark.asyncio
async def test_version_detail_returns_diff(client: AsyncClient):
    _, h = await setup_user(client, "v6@test.com")
    itin_id, _, item_id, _ = await create_itinerary_with_item(client, h)

    await client.post(
        f"/v1/itineraries/{itin_id}/versions",
        json={"changes": [{"action": "edit", "item_id": item_id, "field": "notes", "old_value": None, "new_value": "detail note"}]},
        headers=h,
    )

    r = await client.get(f"/v1/itineraries/{itin_id}/versions/1", headers=h)
    assert r.status_code == 200
    detail = r.json()
    assert detail["version_num"] == 1
    assert detail["has_snapshot"] is True


@pytest.mark.asyncio
async def test_version_detail_404_for_missing(client: AsyncClient):
    _, h = await setup_user(client, "v7@test.com")
    itin_id = (await client.post("/v1/itineraries", json={"title": "T"}, headers=h)).json()["id"]
    r = await client.get(f"/v1/itineraries/{itin_id}/versions/99", headers=h)
    assert r.status_code == 404


# -- Pagination --

@pytest.mark.asyncio
async def test_version_list_pagination(client: AsyncClient):
    _, h = await setup_user(client, "v8@test.com")
    itin_id, _, item_id, _ = await create_itinerary_with_item(client, h)

    for i in range(5):
        await client.post(
            f"/v1/itineraries/{itin_id}/versions",
            json={"changes": [{"action": "edit", "item_id": item_id, "field": "notes", "old_value": f"n{i}", "new_value": f"n{i+1}"}]},
            headers=h,
        )

    r1 = await client.get(f"/v1/itineraries/{itin_id}/versions?page=1&per_page=3", headers=h)
    assert len(r1.json()) == 3

    r2 = await client.get(f"/v1/itineraries/{itin_id}/versions?page=2&per_page=3", headers=h)
    assert len(r2.json()) == 2


# -- Rollback --

@pytest.mark.asyncio
async def test_rollback_restores_item_field(client: AsyncClient):
    _, h = await setup_user(client, "v9@test.com")
    itin_id, _, item_id, item = await create_itinerary_with_item(client, h)

    # Patch item to "First Edit"
    await client.patch(
        f"/v1/itineraries/{itin_id}/items/{item_id}",
        json={"changes": [{"field": "spot_name", "value": "First Edit", "based_on_updated_at": item["spot_updated_at"]}]},
        headers=h,
    )
    # Create version v1
    await client.post(
        f"/v1/itineraries/{itin_id}/versions",
        json={"changes": [{"action": "edit", "item_id": item_id, "field": "spot_name", "old_value": "Original Spot", "new_value": "First Edit"}]},
        headers=h,
    )

    # Patch item to "Second Edit"
    detail_v1 = (await client.get(f"/v1/itineraries/{itin_id}", headers=h)).json()
    item_v1 = detail_v1["days"][0]["items"][0]
    await client.patch(
        f"/v1/itineraries/{itin_id}/items/{item_id}",
        json={"changes": [{"field": "spot_name", "value": "Second Edit", "based_on_updated_at": item_v1["spot_updated_at"]}]},
        headers=h,
    )
    # Create version v2
    await client.post(
        f"/v1/itineraries/{itin_id}/versions",
        json={"changes": [{"action": "edit", "item_id": item_id, "field": "spot_name", "old_value": "First Edit", "new_value": "Second Edit"}]},
        headers=h,
    )

    # Rollback to v1
    r = await client.post(f"/v1/itineraries/{itin_id}/versions/1/rollback", headers=h)
    assert r.status_code == 200
    new_v = r.json()["new_version_num"]
    assert new_v == 3

    detail_rolled = (await client.get(f"/v1/itineraries/{itin_id}", headers=h)).json()
    assert detail_rolled["days"][0]["items"][0]["spot_name"] == "First Edit"


@pytest.mark.asyncio
async def test_rollback_appends_new_version_entry(client: AsyncClient):
    _, h = await setup_user(client, "v10@test.com")
    itin_id, _, item_id, item = await create_itinerary_with_item(client, h)

    await client.patch(
        f"/v1/itineraries/{itin_id}/items/{item_id}",
        json={"changes": [{"field": "spot_name", "value": "Changed", "based_on_updated_at": item["spot_updated_at"]}]},
        headers=h,
    )
    await client.post(
        f"/v1/itineraries/{itin_id}/versions",
        json={"changes": [{"action": "edit", "item_id": item_id, "field": "spot_name", "old_value": "Original Spot", "new_value": "Changed"}]},
        headers=h,
    )

    await client.post(f"/v1/itineraries/{itin_id}/versions/1/rollback", headers=h)

    versions = (await client.get(f"/v1/itineraries/{itin_id}/versions", headers=h)).json()
    rollback_entries = [v for v in versions if v["entry_type"] == "rollback"]
    assert len(rollback_entries) == 1


@pytest.mark.asyncio
async def test_rollback_to_nonexistent_version_returns_404(client: AsyncClient):
    _, h = await setup_user(client, "v11@test.com")
    itin_id = (await client.post("/v1/itineraries", json={"title": "T"}, headers=h)).json()["id"]
    r = await client.post(f"/v1/itineraries/{itin_id}/versions/999/rollback", headers=h)
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_viewer_cannot_rollback(client: AsyncClient):
    _, owner_h = await setup_user(client, "v12a@test.com")
    _, viewer_h = await setup_user(client, "v12b@test.com")
    itin_id, _, item_id, _ = await create_itinerary_with_item(client, owner_h)

    await client.post(
        f"/v1/itineraries/{itin_id}/versions",
        json={"changes": [{"action": "edit", "item_id": item_id, "field": "spot_name", "old_value": "Original Spot", "new_value": "X"}]},
        headers=owner_h,
    )

    r = await client.post(f"/v1/itineraries/{itin_id}/versions/1/rollback", headers=viewer_h)
    assert r.status_code == 404
