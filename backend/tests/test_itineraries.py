import pytest
from httpx import AsyncClient

async def setup_user(client: AsyncClient, email: str) -> tuple[str, dict]:
    r = await client.post("/v1/auth/register", json={"email": email, "username": "U", "password": "pw"})
    data = r.json()
    return data["user"]["id"], {"Authorization": f"Bearer {data['access_token']}"}

@pytest.mark.asyncio
async def test_create_and_get_itinerary(client: AsyncClient):
    _, headers = await setup_user(client, "i1@test.com")
    r = await client.post("/v1/itineraries", json={"title": "Cambodia 7 Days"}, headers=headers)
    assert r.status_code == 201
    itin_id = r.json()["id"]

    r2 = await client.get(f"/v1/itineraries/{itin_id}", headers=headers)
    assert r2.status_code == 200
    assert r2.json()["title"] == "Cambodia 7 Days"
    assert r2.json()["days"] == []

@pytest.mark.asyncio
async def test_add_day_and_item(client: AsyncClient):
    _, headers = await setup_user(client, "i2@test.com")
    itin_id = (await client.post("/v1/itineraries", json={"title": "Trip"}, headers=headers)).json()["id"]

    day = (await client.post(f"/v1/itineraries/{itin_id}/days", json={"date": "2024-03-17", "day_order": 0}, headers=headers)).json()
    assert day["date"] == "2024-03-17"

    item = (await client.post(
        f"/v1/itineraries/{itin_id}/days/{day['id']}/items",
        json={"spot_name": "Angkor Wat", "time_start": "09:00", "item_order": 0},
        headers=headers,
    )).json()
    assert item["spot_name"] == "Angkor Wat"
    assert "spot_updated_at" in item

@pytest.mark.asyncio
async def test_get_itinerary_includes_days_and_items(client: AsyncClient):
    _, headers = await setup_user(client, "i3@test.com")
    itin_id = (await client.post("/v1/itineraries", json={"title": "T"}, headers=headers)).json()["id"]
    day_id = (await client.post(f"/v1/itineraries/{itin_id}/days", json={"date": "2024-03-17", "day_order": 0}, headers=headers)).json()["id"]
    await client.post(f"/v1/itineraries/{itin_id}/days/{day_id}/items", json={"spot_name": "Temple", "item_order": 0}, headers=headers)

    detail = (await client.get(f"/v1/itineraries/{itin_id}", headers=headers)).json()
    assert len(detail["days"]) == 1
    assert len(detail["days"][0]["items"]) == 1
    assert detail["days"][0]["items"][0]["spot_name"] == "Temple"

@pytest.mark.asyncio
async def test_viewer_cannot_modify(client: AsyncClient):
    _, owner_headers = await setup_user(client, "i4a@test.com")
    _, viewer_headers = await setup_user(client, "i4b@test.com")
    itin_id = (await client.post("/v1/itineraries", json={"title": "T"}, headers=owner_headers)).json()["id"]
    r = await client.patch(f"/v1/itineraries/{itin_id}", json={"title": "Hacked"}, headers=viewer_headers)
    assert r.status_code == 404

@pytest.mark.asyncio
async def test_delete_itinerary(client: AsyncClient):
    _, headers = await setup_user(client, "i5@test.com")
    itin_id = (await client.post("/v1/itineraries", json={"title": "Delete Me"}, headers=headers)).json()["id"]
    r = await client.delete(f"/v1/itineraries/{itin_id}", headers=headers)
    assert r.status_code == 204
    r2 = await client.get(f"/v1/itineraries/{itin_id}", headers=headers)
    assert r2.status_code == 404

@pytest.mark.asyncio
async def test_reorder_item_cannot_move_to_other_itinerary(client: AsyncClient):
    """An editor cannot move an item to a day in a different itinerary."""
    _, headers = await setup_user(client, "i6@test.com")
    itin_a = (await client.post("/v1/itineraries", json={"title": "A"}, headers=headers)).json()["id"]
    itin_b = (await client.post("/v1/itineraries", json={"title": "B"}, headers=headers)).json()["id"]
    day_a = (await client.post(f"/v1/itineraries/{itin_a}/days", json={"date": "2024-03-17", "day_order": 0}, headers=headers)).json()["id"]
    day_b = (await client.post(f"/v1/itineraries/{itin_b}/days", json={"date": "2024-03-18", "day_order": 0}, headers=headers)).json()["id"]
    item = (await client.post(f"/v1/itineraries/{itin_a}/days/{day_a}/items", json={"spot_name": "X", "item_order": 0}, headers=headers)).json()["id"]
    r = await client.patch(f"/v1/itineraries/{itin_a}/items/{item}/reorder", json={"day_id": day_b}, headers=headers)
    assert r.status_code == 404  # day_b not in itin_a

@pytest.mark.asyncio
async def test_clear_folder_id(client: AsyncClient):
    """PATCH with folder_id: null should clear the folder assignment."""
    _, headers = await setup_user(client, "i7@test.com")
    folder_id = (await client.post("/v1/folders", json={"name": "F"}, headers=headers)).json()["id"]
    itin = (await client.post("/v1/itineraries", json={"title": "T", "folder_id": folder_id}, headers=headers)).json()
    assert itin["folder_id"] == folder_id
    r = await client.patch(f"/v1/itineraries/{itin['id']}", json={"folder_id": None}, headers=headers)
    assert r.status_code == 200
    assert r.json()["folder_id"] is None
