import asyncio
import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlalchemy.pool import NullPool
from httpx import AsyncClient, ASGITransport
from app.core.config import settings
from app.core.database import Base, get_db
from app.main import app

if not settings.TEST_DATABASE_URL:
    raise RuntimeError("TEST_DATABASE_URL is not set. Copy .env.example to .env and set TEST_DATABASE_URL.")

@pytest.fixture(scope="session")
def event_loop():
    """Create a session-scoped event loop so all async fixtures share the same loop."""
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()

# NullPool prevents connection reuse across event loop boundaries
TEST_ENGINE = create_async_engine(settings.TEST_DATABASE_URL, echo=False, poolclass=NullPool)
TestSessionLocal = async_sessionmaker(TEST_ENGINE, expire_on_commit=False)

@pytest_asyncio.fixture(scope="session", autouse=True)
async def setup_test_db():
    async with TEST_ENGINE.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with TEST_ENGINE.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)

@pytest_asyncio.fixture(autouse=True)
async def clean_tables():
    """Truncate all tables between tests to ensure isolation."""
    yield
    async with TEST_ENGINE.begin() as conn:
        for table in reversed(Base.metadata.sorted_tables):
            await conn.execute(table.delete())

@pytest_asyncio.fixture
async def db():
    async with TestSessionLocal() as session:
        yield session

@pytest_asyncio.fixture
async def client(db):
    async def override_get_db():
        yield db
    app.dependency_overrides[get_db] = override_get_db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()
