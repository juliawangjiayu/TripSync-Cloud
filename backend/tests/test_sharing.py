import pytest
from httpx import AsyncClient


async def setup_user(client: AsyncClient, email: str) -> tuple[str, dict]:
    r = await client.post("/v1/auth/register", json={"email": email, "username": email.split("@")[0], "password": "pw"})
    data = r.json()
    return data["user"]["id"], {"Authorization": f"Bearer {data['access_token']}"}


async def create_itinerary(client: AsyncClient, headers: dict, title: str = "Trip") -> str:
    return (await client.post("/v1/itineraries", json={"title": title}, headers=headers)).json()["id"]


# -- Share link creation --

@pytest.mark.asyncio
async def test_create_editor_share_link(client: AsyncClient):
    _, h = await setup_user(client, "s1@test.com")
    itin_id = await create_itinerary(client, h)

    r = await client.post(
        f"/v1/itineraries/{itin_id}/share-links",
        json={"role": "editor"},
        headers=h,
    )
    assert r.status_code == 200
    data = r.json()
    assert data["role"] == "editor"
    assert data["token"]
    assert "/join/" in data["url"]


@pytest.mark.asyncio
async def test_create_viewer_share_link(client: AsyncClient):
    _, h = await setup_user(client, "s2@test.com")
    itin_id = await create_itinerary(client, h)

    r = await client.post(
        f"/v1/itineraries/{itin_id}/share-links",
        json={"role": "viewer"},
        headers=h,
    )
    assert r.status_code == 200
    assert r.json()["role"] == "viewer"


@pytest.mark.asyncio
async def test_create_share_link_invalid_role(client: AsyncClient):
    _, h = await setup_user(client, "s3@test.com")
    itin_id = await create_itinerary(client, h)

    r = await client.post(
        f"/v1/itineraries/{itin_id}/share-links",
        json={"role": "admin"},
        headers=h,
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_non_editor_cannot_create_share_link(client: AsyncClient):
    _, owner_h = await setup_user(client, "s4a@test.com")
    _, other_h = await setup_user(client, "s4b@test.com")
    itin_id = await create_itinerary(client, owner_h)

    r = await client.post(
        f"/v1/itineraries/{itin_id}/share-links",
        json={"role": "editor"},
        headers=other_h,
    )
    assert r.status_code == 404


# -- Join preview (unauthenticated) --

@pytest.mark.asyncio
async def test_join_preview_returns_itinerary_info(client: AsyncClient):
    _, h = await setup_user(client, "s5@test.com")
    itin_id = await create_itinerary(client, h, "My Adventure")

    token = (await client.post(
        f"/v1/itineraries/{itin_id}/share-links",
        json={"role": "editor"},
        headers=h,
    )).json()["token"]

    r = await client.get(f"/v1/join/{token}")
    assert r.status_code == 200
    data = r.json()
    assert data["itinerary_title"] == "My Adventure"
    assert data["role"] == "editor"
    assert data["itinerary_id"] == itin_id


@pytest.mark.asyncio
async def test_join_preview_invalid_token_returns_404(client: AsyncClient):
    r = await client.get("/v1/join/nonexistent-token-xyz")
    assert r.status_code == 404


# -- Join via link (authenticated) --

@pytest.mark.asyncio
async def test_join_as_editor_via_link(client: AsyncClient):
    _, owner_h = await setup_user(client, "s6a@test.com")
    _, bob_h = await setup_user(client, "s6b@test.com")
    itin_id = await create_itinerary(client, owner_h)

    token = (await client.post(
        f"/v1/itineraries/{itin_id}/share-links",
        json={"role": "editor"},
        headers=owner_h,
    )).json()["token"]

    r = await client.post(f"/v1/join/{token}", headers=bob_h)
    assert r.status_code == 200
    data = r.json()
    assert data["role"] == "editor"
    assert data["itinerary_id"] == itin_id

    # Bob can now access the itinerary
    r2 = await client.get(f"/v1/itineraries/{itin_id}", headers=bob_h)
    assert r2.status_code == 200


@pytest.mark.asyncio
async def test_join_as_viewer_via_link(client: AsyncClient):
    _, owner_h = await setup_user(client, "s7a@test.com")
    _, viewer_h = await setup_user(client, "s7b@test.com")
    itin_id = await create_itinerary(client, owner_h)

    token = (await client.post(
        f"/v1/itineraries/{itin_id}/share-links",
        json={"role": "viewer"},
        headers=owner_h,
    )).json()["token"]

    await client.post(f"/v1/join/{token}", headers=viewer_h)

    # Viewer can read
    r = await client.get(f"/v1/itineraries/{itin_id}", headers=viewer_h)
    assert r.status_code == 200

    # Viewer cannot write (add day)
    r2 = await client.post(
        f"/v1/itineraries/{itin_id}/days",
        json={"date": "2024-03-17", "day_order": 0},
        headers=viewer_h,
    )
    assert r2.status_code == 403


@pytest.mark.asyncio
async def test_join_twice_is_idempotent(client: AsyncClient):
    _, owner_h = await setup_user(client, "s8a@test.com")
    _, bob_h = await setup_user(client, "s8b@test.com")
    itin_id = await create_itinerary(client, owner_h)

    token = (await client.post(
        f"/v1/itineraries/{itin_id}/share-links",
        json={"role": "editor"},
        headers=owner_h,
    )).json()["token"]

    await client.post(f"/v1/join/{token}", headers=bob_h)
    r = await client.post(f"/v1/join/{token}", headers=bob_h)
    assert r.status_code == 200  # no error on second join


@pytest.mark.asyncio
async def test_owner_join_own_itinerary_returns_ok(client: AsyncClient):
    _, h = await setup_user(client, "s9@test.com")
    itin_id = await create_itinerary(client, h)

    token = (await client.post(
        f"/v1/itineraries/{itin_id}/share-links",
        json={"role": "editor"},
        headers=h,
    )).json()["token"]

    r = await client.post(f"/v1/join/{token}", headers=h)
    assert r.status_code == 200


# -- Member management --

@pytest.mark.asyncio
async def test_list_members_includes_owner_and_joined_user(client: AsyncClient):
    _, owner_h = await setup_user(client, "s10a@test.com")
    bob_id, bob_h = await setup_user(client, "s10b@test.com")
    itin_id = await create_itinerary(client, owner_h)

    token = (await client.post(
        f"/v1/itineraries/{itin_id}/share-links",
        json={"role": "editor"},
        headers=owner_h,
    )).json()["token"]
    await client.post(f"/v1/join/{token}", headers=bob_h)

    r = await client.get(f"/v1/itineraries/{itin_id}/members", headers=owner_h)
    assert r.status_code == 200
    members = r.json()
    user_ids = [m["user_id"] for m in members]
    assert bob_id in user_ids


@pytest.mark.asyncio
async def test_owner_can_change_member_role(client: AsyncClient):
    _, owner_h = await setup_user(client, "s11a@test.com")
    bob_id, bob_h = await setup_user(client, "s11b@test.com")
    itin_id = await create_itinerary(client, owner_h)

    token = (await client.post(
        f"/v1/itineraries/{itin_id}/share-links",
        json={"role": "editor"},
        headers=owner_h,
    )).json()["token"]
    await client.post(f"/v1/join/{token}", headers=bob_h)

    r = await client.patch(
        f"/v1/itineraries/{itin_id}/members/{bob_id}",
        json={"role": "viewer"},
        headers=owner_h,
    )
    assert r.status_code == 200
    assert r.json()["role"] == "viewer"

    # Bob should now be blocked from write actions
    day_r = await client.post(
        f"/v1/itineraries/{itin_id}/days",
        json={"date": "2024-04-01", "day_order": 0},
        headers=bob_h,
    )
    assert day_r.status_code == 403


@pytest.mark.asyncio
async def test_non_owner_cannot_change_member_role(client: AsyncClient):
    _, owner_h = await setup_user(client, "s12a@test.com")
    bob_id, bob_h = await setup_user(client, "s12b@test.com")
    carol_id, carol_h = await setup_user(client, "s12c@test.com")
    itin_id = await create_itinerary(client, owner_h)

    token = (await client.post(
        f"/v1/itineraries/{itin_id}/share-links",
        json={"role": "editor"},
        headers=owner_h,
    )).json()["token"]
    await client.post(f"/v1/join/{token}", headers=bob_h)
    await client.post(f"/v1/join/{token}", headers=carol_h)

    # Carol (editor, not owner) tries to change Bob's role
    r = await client.patch(
        f"/v1/itineraries/{itin_id}/members/{bob_id}",
        json={"role": "viewer"},
        headers=carol_h,
    )
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_owner_can_remove_member(client: AsyncClient):
    _, owner_h = await setup_user(client, "s13a@test.com")
    bob_id, bob_h = await setup_user(client, "s13b@test.com")
    itin_id = await create_itinerary(client, owner_h)

    token = (await client.post(
        f"/v1/itineraries/{itin_id}/share-links",
        json={"role": "editor"},
        headers=owner_h,
    )).json()["token"]
    await client.post(f"/v1/join/{token}", headers=bob_h)

    r = await client.delete(
        f"/v1/itineraries/{itin_id}/members/{bob_id}",
        headers=owner_h,
    )
    assert r.status_code == 204

    # Bob can no longer access the itinerary
    r2 = await client.get(f"/v1/itineraries/{itin_id}", headers=bob_h)
    assert r2.status_code == 404


@pytest.mark.asyncio
async def test_non_owner_cannot_remove_member(client: AsyncClient):
    _, owner_h = await setup_user(client, "s14a@test.com")
    bob_id, bob_h = await setup_user(client, "s14b@test.com")
    carol_id, carol_h = await setup_user(client, "s14c@test.com")
    itin_id = await create_itinerary(client, owner_h)

    token = (await client.post(
        f"/v1/itineraries/{itin_id}/share-links",
        json={"role": "editor"},
        headers=owner_h,
    )).json()["token"]
    await client.post(f"/v1/join/{token}", headers=bob_h)
    await client.post(f"/v1/join/{token}", headers=carol_h)

    r = await client.delete(
        f"/v1/itineraries/{itin_id}/members/{bob_id}",
        headers=carol_h,
    )
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_viewer_can_list_members(client: AsyncClient):
    _, owner_h = await setup_user(client, "s15a@test.com")
    _, viewer_h = await setup_user(client, "s15b@test.com")
    itin_id = await create_itinerary(client, owner_h)

    token = (await client.post(
        f"/v1/itineraries/{itin_id}/share-links",
        json={"role": "viewer"},
        headers=owner_h,
    )).json()["token"]
    await client.post(f"/v1/join/{token}", headers=viewer_h)

    r = await client.get(f"/v1/itineraries/{itin_id}/members", headers=viewer_h)
    assert r.status_code == 200
