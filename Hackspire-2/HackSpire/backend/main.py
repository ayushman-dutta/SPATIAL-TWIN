from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from pathlib import Path
from fastapi.staticfiles import StaticFiles
from backend.config import settings
from backend.db.connection import connect_to_db, close_db_connection
from backend.routers import status, objects, query, edit, pipeline
from backend.ws.manager import manager
from backend.agent.ollama_client import ollama_client

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await connect_to_db()
    await ollama_client.warmup()
    yield
    # Shutdown
    await close_db_connection()

app = FastAPI(title="Spatial Twin API", lifespan=lifespan)

# Setup CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # For dev only, restrict in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount static assets directory for 3D splats and binary sidecars
static_path = Path(settings.STATIC_ASSETS_DIR)
if static_path.exists():
    app.mount("/static", StaticFiles(directory=str(static_path)), name="static")

# Include routers
app.include_router(status.router)
app.include_router(objects.router)
app.include_router(query.router)
app.include_router(edit.router)
app.include_router(pipeline.router)

# WebSocket endpoint for real-time scene updates
@app.websocket("/ws/scene")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            # For now, just listen for disconnects
            data = await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)
