import pytest
from unittest.mock import patch, AsyncMock
from httpx import AsyncClient


async def setup_user_and_itinerary(client: AsyncClient, email: str) -> tuple[dict, str]:
    r = await client.post("/v1/auth/register", json={"email": email, "username": "U", "password": "pw"})
    data = r.json()
    headers = {"Authorization": f"Bearer {data['access_token']}"}
    itin_id = (await client.post("/v1/itineraries", json={"title": "Tokyo Trip"}, headers=headers)).json()["id"]
    return headers, itin_id


@pytest.mark.asyncio
async def test_export_pdf_returns_presigned_url(client: AsyncClient):
    """Mock S3 and WeasyPrint so the test doesn't need AWS credentials."""
    headers, itin_id = await setup_user_and_itinerary(client, "ex1@test.com")

    with patch("app.routers.export.generate_pdf_and_upload") as mock_gen:
        mock_gen.return_value = "https://s3.amazonaws.com/bucket/exports/test.pdf?AWSAccessKeyId=x"

        r = await client.post(f"/v1/itineraries/{itin_id}/export/pdf", headers=headers)
        assert r.status_code == 200
        data = r.json()
        assert "url" in data
        assert "s3.amazonaws.com" in data["url"]


@pytest.mark.asyncio
async def test_export_email_accepted(client: AsyncClient):
    """Mock the background task — just verify the endpoint returns 202."""
    headers, itin_id = await setup_user_and_itinerary(client, "ex2@test.com")

    with patch("app.routers.export.BackgroundTasks.add_task"):
        r = await client.post(
            f"/v1/itineraries/{itin_id}/export/email",
            json={"to": "friend@example.com"},
            headers=headers,
        )
    assert r.status_code == 202


@pytest.mark.asyncio
async def test_export_requires_membership(client: AsyncClient):
    headers1, itin_id = await setup_user_and_itinerary(client, "ex3a@test.com")
    r2 = await client.post("/v1/auth/register", json={"email": "ex3b@test.com", "username": "B", "password": "pw"})
    headers2 = {"Authorization": f"Bearer {r2.json()['access_token']}"}

    r = await client.post(f"/v1/itineraries/{itin_id}/export/pdf", headers=headers2)
    assert r.status_code == 404
