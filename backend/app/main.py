from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import auth, folders, itineraries, collaboration
from app.routers import versions, sharing, map_pins, export, ai
from app.core.config import settings

app = FastAPI(title="TripSync API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        settings.FRONTEND_ORIGIN,
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/v1")
app.include_router(folders.router, prefix="/v1")
app.include_router(itineraries.router, prefix="/v1")
app.include_router(collaboration.router, prefix="/v1")
app.include_router(versions.router, prefix="/v1")
app.include_router(sharing.router, prefix="/v1")
app.include_router(map_pins.router, prefix="/v1")
app.include_router(export.router, prefix="/v1")
app.include_router(ai.router, prefix="/v1")
