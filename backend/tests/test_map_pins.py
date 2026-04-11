import pytest
from httpx import AsyncClient


async def setup_user(client: AsyncClient, email: str) -> tuple[str, dict]:
    r = await client.post("/v1/auth/register", json={"email": email, "username": "U", "password": "pw"})
    data = r.json()
    return data["user"]["id"], {"Authorization": f"Bearer {data['access_token']}"}


async def create_itinerary(client: AsyncClient, headers: dict) -> str:
    return (await client.post("/v1/itineraries", json={"title": "T"}, headers=headers)).json()["id"]


@pytest.mark.asyncio
async def test_create_map_pin(client: AsyncClient):
    _, h = await setup_user(client, "mp1@test.com")
    itin_id = await create_itinerary(client, h)

    r = await client.post(
        f"/v1/itineraries/{itin_id}/map-pins",
        json={"label": "Hotel", "lat": 35.6762, "lng": 139.6503},
        headers=h,
    )
    assert r.status_code == 201
    data = r.json()
    assert data["label"] == "Hotel"
    assert abs(data["lat"] - 35.6762) < 0.001


@pytest.mark.asyncio
async def test_list_map_pins(client: AsyncClient):
    _, h = await setup_user(client, "mp2@test.com")
    itin_id = await create_itinerary(client, h)

    await client.post(f"/v1/itineraries/{itin_id}/map-pins",
                      json={"label": "A", "lat": 1.0, "lng": 2.0}, headers=h)
    await client.post(f"/v1/itineraries/{itin_id}/map-pins",
                      json={"label": "B", "lat": 3.0, "lng": 4.0}, headers=h)

    r = await client.get(f"/v1/itineraries/{itin_id}/map-pins", headers=h)
    assert r.status_code == 200
    assert len(r.json()) == 2


@pytest.mark.asyncio
async def test_delete_map_pin(client: AsyncClient):
    _, h = await setup_user(client, "mp3@test.com")
    itin_id = await create_itinerary(client, h)

    pin_id = (await client.post(
        f"/v1/itineraries/{itin_id}/map-pins",
        json={"label": "ToDelete", "lat": 1.0, "lng": 2.0}, headers=h
    )).json()["id"]

    r = await client.delete(f"/v1/itineraries/{itin_id}/map-pins/{pin_id}", headers=h)
    assert r.status_code == 204

    r2 = await client.get(f"/v1/itineraries/{itin_id}/map-pins", headers=h)
    assert len(r2.json()) == 0


@pytest.mark.asyncio
async def test_viewer_can_list_pins_but_not_create(client: AsyncClient):
    _, owner_h = await setup_user(client, "mp4a@test.com")
    _, viewer_h = await setup_user(client, "mp4b@test.com")
    itin_id = await create_itinerary(client, owner_h)

    # Join as viewer
    token = (await client.post(
        f"/v1/itineraries/{itin_id}/share-links", json={"role": "viewer"}, headers=owner_h
    )).json()["token"]
    await client.post(f"/v1/join/{token}", headers=viewer_h)

    # Viewer can list
    r = await client.get(f"/v1/itineraries/{itin_id}/map-pins", headers=viewer_h)
    assert r.status_code == 200

    # Viewer cannot create
    r2 = await client.post(
        f"/v1/itineraries/{itin_id}/map-pins",
        json={"label": "X", "lat": 1.0, "lng": 2.0}, headers=viewer_h
    )
    assert r2.status_code == 403
