import pytest
from httpx import AsyncClient

async def register_and_get_token(client: AsyncClient, email: str) -> str:
    r = await client.post("/v1/auth/register", json={"email": email, "username": "U", "password": "pw"})
    return r.json()["access_token"]

@pytest.mark.asyncio
async def test_create_and_list_folder(client: AsyncClient):
    token = await register_and_get_token(client, "f1@test.com")
    headers = {"Authorization": f"Bearer {token}"}
    r = await client.post("/v1/folders", json={"name": "Asia Trip"}, headers=headers)
    assert r.status_code == 201
    assert r.json()["name"] == "Asia Trip"

    r2 = await client.get("/v1/folders", headers=headers)
    assert len(r2.json()) == 1

@pytest.mark.asyncio
async def test_rename_folder(client: AsyncClient):
    token = await register_and_get_token(client, "f2@test.com")
    headers = {"Authorization": f"Bearer {token}"}
    folder = (await client.post("/v1/folders", json={"name": "Old"}, headers=headers)).json()
    r = await client.patch(f"/v1/folders/{folder['id']}", json={"name": "New"}, headers=headers)
    assert r.json()["name"] == "New"

@pytest.mark.asyncio
async def test_delete_folder(client: AsyncClient):
    token = await register_and_get_token(client, "f3@test.com")
    headers = {"Authorization": f"Bearer {token}"}
    folder = (await client.post("/v1/folders", json={"name": "ToDelete"}, headers=headers)).json()
    r = await client.delete(f"/v1/folders/{folder['id']}", headers=headers)
    assert r.status_code == 204
    assert len((await client.get("/v1/folders", headers=headers)).json()) == 0

@pytest.mark.asyncio
async def test_cannot_access_other_users_folder(client: AsyncClient):
    t1 = await register_and_get_token(client, "f4a@test.com")
    t2 = await register_and_get_token(client, "f4b@test.com")
    folder = (await client.post("/v1/folders", json={"name": "Private"}, headers={"Authorization": f"Bearer {t1}"})).json()
    r = await client.patch(f"/v1/folders/{folder['id']}", json={"name": "Hacked"}, headers={"Authorization": f"Bearer {t2}"})
    assert r.status_code == 404
