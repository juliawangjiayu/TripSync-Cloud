import pytest
from httpx import AsyncClient

@pytest.mark.asyncio
async def test_register_success(client: AsyncClient):
    r = await client.post("/v1/auth/register", json={
        "email": "alice@example.com",
        "username": "Alice",
        "password": "secret123",
    })
    assert r.status_code == 200
    data = r.json()
    assert "access_token" in data
    assert "refresh_token" in data
    assert data["user"]["email"] == "alice@example.com"

@pytest.mark.asyncio
async def test_register_duplicate_email(client: AsyncClient):
    payload = {"email": "bob@example.com", "username": "Bob", "password": "secret123"}
    await client.post("/v1/auth/register", json=payload)
    r = await client.post("/v1/auth/register", json=payload)
    assert r.status_code == 409

@pytest.mark.asyncio
async def test_login_success(client: AsyncClient):
    await client.post("/v1/auth/register", json={
        "email": "carol@example.com", "username": "Carol", "password": "pass"
    })
    r = await client.post("/v1/auth/login", json={"email": "carol@example.com", "password": "pass"})
    assert r.status_code == 200
    assert "access_token" in r.json()

@pytest.mark.asyncio
async def test_login_wrong_password(client: AsyncClient):
    await client.post("/v1/auth/register", json={
        "email": "dave@example.com", "username": "Dave", "password": "correct"
    })
    r = await client.post("/v1/auth/login", json={"email": "dave@example.com", "password": "wrong"})
    assert r.status_code == 401

@pytest.mark.asyncio
async def test_refresh_token(client: AsyncClient):
    reg = await client.post("/v1/auth/register", json={
        "email": "eve@example.com", "username": "Eve", "password": "pw"
    })
    refresh_token = reg.json()["refresh_token"]
    r = await client.post("/v1/auth/refresh", json={"refresh_token": refresh_token})
    assert r.status_code == 200
    assert "access_token" in r.json()
