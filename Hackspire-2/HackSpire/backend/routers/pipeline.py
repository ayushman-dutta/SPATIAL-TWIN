"""
Spatial Twin: Video Processing Pipeline API Router (backend/routers/pipeline.py)

Beginner Analogy:
The drone delivery bay reception desk:
Users drop off their raw flight recordings here. The clerk checks the video file,
stamps a job tracking ID, sends the video to the AI factory in the back room,
and gives the user a live status ticket so they can watch the progress in real time.
"""

import os
import time
import uuid
import asyncio
from pathlib import Path
from typing import Dict, Any

from fastapi import APIRouter, UploadFile, File, HTTPException, BackgroundTasks
from pydantic import BaseModel

from backend.config import settings
from backend.ws.manager import manager
from pipeline.common.contracts import ReconstructionMode
from pipeline.common.jobs import JobStore
from pipeline.video_orchestrator import execute_drone_video_pipeline

router = APIRouter(prefix="/api/pipeline", tags=["pipeline"])

UPLOAD_DIR = Path("./data/uploads")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
JOB_STORE = JobStore(Path(settings.PIPELINE_WORKSPACE))

class PipelineStatusResponse(BaseModel):
    job_id: str | None = None
    status: str  # "idle" | "receiving" | "staged" | "processing" | "completed" | "error"
    step: str
    progress: int
    details: Dict[str, Any] = {}
    error: str | None = None

# In-memory tracking of active job status
current_pipeline_state: Dict[str, Any] = {
    "job_id": None,
    "status": "idle",
    "step": "Ready for drone footage",
    "progress": 0,
    "details": {},
    "error": None
}

async def run_pipeline_task(job_id: str, file_path: Path):
    global current_pipeline_state
    try:
        def update_progress(step: str, pct: int, details: Dict[str, Any]):
            current_pipeline_state["status"] = "processing"
            current_pipeline_state["step"] = step
            current_pipeline_state["progress"] = pct
            current_pipeline_state["details"] = details

        # Run the full pipeline orchestrator
        result = await execute_drone_video_pipeline(
            video_path=file_path,
            progress_callback=update_progress
        )

        current_pipeline_state["status"] = "completed"
        current_pipeline_state["step"] = "Digital Twin reconstruction complete!"
        current_pipeline_state["progress"] = 100
        current_pipeline_state["details"] = result
        current_pipeline_state["error"] = None

        # Broadcast live scene update over WebSocket to all connected browser tabs
        await manager.broadcast({
            "type": "scene_diff",
            "updated": ["all"],
            "version": int(time.time()),
            "source": "video_pipeline",
            "message": f"Digital Twin reloaded from video {result.get('video_name', '')}"
        })
        print(f"[PIPELINE API] Job {job_id} completed successfully. Broadcasted WebSocket update.")

    except Exception as exc:
        print(f"[PIPELINE API] Job {job_id} failed: {exc}")
        current_pipeline_state["status"] = "error"
        current_pipeline_state["step"] = "Pipeline processing failed"
        current_pipeline_state["error"] = str(exc)

@router.get("/status", response_model=PipelineStatusResponse)
async def get_pipeline_status():
    """Returns the real-time processing status of the video pipeline."""
    return current_pipeline_state

@router.post("/upload")
async def upload_drone_video(file: UploadFile = File(...)):
    """Validate and isolate a local video; later phases perform reconstruction."""
    global current_pipeline_state

    if current_pipeline_state["status"] in {"processing", "receiving"}:
        raise HTTPException(status_code=409, detail="A local pipeline job is already receiving or processing input.")

    filename = file.filename or "drone_video.mp4"
    job = None
    temporary = None
    try:
        # Create the isolated job before accepting bytes. The client filename never forms a path.
        job = JOB_STORE.create(filename, ReconstructionMode.MVS)
        temporary = JOB_STORE.directory(job.job_id) / "source.part"
        total = 0
        with temporary.open("xb") as buffer:
            while chunk := await file.read(1024 * 1024):
                total += len(chunk)
                if total > settings.PIPELINE_MAX_INPUT_BYTES:
                    raise ValueError("The uploaded video exceeds the configured local size limit.")
                buffer.write(chunk)
        job = JOB_STORE.finish(job, temporary)
    except ValueError as exc:
        if job is not None:
            JOB_STORE.fail(job, str(exc))
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        if job is not None:
            JOB_STORE.fail(job, "The local video could not be staged safely.")
        raise HTTPException(status_code=500, detail="The local video could not be staged safely.") from exc
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)

    current_pipeline_state = {
        "job_id": job.job_id,
        "status": "staged",
        "step": "Video validated and isolated locally",
        "progress": 5,
        "details": {
            "filename": job.source_name,
            "file_size_bytes": job.source_bytes,
            "width": job.width,
            "height": job.height,
            "reconstruction_mode": job.reconstruction_mode.value,
            "message": job.message,
        },
        "error": None,
    }

    # Phase B/C reconstruction is intentionally not started during staging.
    return {
        "job_id": job.job_id,
        "status": "staged",
        "message": job.message,
        "reconstruction_mode": job.reconstruction_mode.value,
    }

@router.get("/sample-video")
async def get_sample_video():
    from fastapi.responses import FileResponse
    sample_path = Path("./frontend/public/mill19_sample_flight.mp4")
    if sample_path.exists():
        return FileResponse(sample_path, media_type="video/mp4", filename="mill19_sample_flight.mp4")
    raise HTTPException(status_code=404, detail="Sample drone flight video not found.")

from pipeline.kaggle_runner import run_kaggle_3dgs_job, is_kaggle_configured

@router.get("/kaggle-config")
async def get_kaggle_config():
    """Cloud execution is intentionally disabled by the approved local-only policy."""
    return {"configured": False, "username": "", "enabled": False, "message": "Cloud uploads are disabled; use the local offline pipeline."}

async def run_kaggle_pipeline_task(job_id: str, file_path: Path):
    global current_pipeline_state
    try:
        def update_progress(step: str, pct: int, details: Dict[str, Any] = None):
            current_pipeline_state["status"] = "processing"
            current_pipeline_state["step"] = step
            current_pipeline_state["progress"] = pct
            current_pipeline_state["details"] = details or {}

        result = await run_kaggle_3dgs_job(
            video_path=file_path,
            progress_callback=update_progress
        )

        current_pipeline_state["status"] = "completed"
        current_pipeline_state["step"] = "Kaggle 3DGS cloud reconstruction complete!"
        current_pipeline_state["progress"] = 100
        current_pipeline_state["details"] = result
        current_pipeline_state["error"] = None

        await manager.broadcast({
            "type": "scene_diff",
            "updated": ["all"],
            "version": int(time.time()),
            "source": "kaggle_pipeline",
            "message": "Kaggle 3DGS digital twin imported successfully"
        })
    except Exception as exc:
        print(f"[KAGGLE API ERR] {exc}")
        current_pipeline_state["status"] = "error"
        current_pipeline_state["step"] = "Kaggle cloud training failed"
        current_pipeline_state["error"] = str(exc)

@router.post("/upload-kaggle")
async def upload_drone_video_kaggle(file: UploadFile = File(...)):
    """Reject cloud execution unless a future explicit policy enables it."""
    raise HTTPException(
        status_code=410,
        detail="Cloud upload is disabled by the approved offline-only policy. Use the local reconstruction pipeline.",
    )

    # Kept below for the future opt-in implementation; unreachable while local-only policy is active.
    global current_pipeline_state

    if not is_kaggle_configured():
        raise HTTPException(
            status_code=400,
            detail="Kaggle credentials not configured. Please add KAGGLE_USERNAME and KAGGLE_KEY to your .env file."
        )

    if current_pipeline_state["status"] == "processing":
        raise HTTPException(
            status_code=409,
            detail="Pipeline is already busy processing a job. Please wait until it completes."
        )

    filename = file.filename or "drone_video.mp4"
    job_id = str(uuid.uuid4())[:8]
    dest_path = UPLOAD_DIR / f"{job_id}_{filename}"

    with open(dest_path, "wb") as buffer:
        while chunk := await file.read(1024 * 1024):
            buffer.write(chunk)

    current_pipeline_state = {
        "job_id": job_id,
        "status": "processing",
        "step": "Sending video to Kaggle 16GB GPU cluster...",
        "progress": 5,
        "details": {"filename": filename, "provider": "kaggle"},
        "error": None
    }

    asyncio.create_task(run_kaggle_pipeline_task(job_id, dest_path))

    return {
        "job_id": job_id,
        "status": "processing",
        "message": "Video sent to Kaggle Cloud GPU. 3DGS training has started."
    }

@router.post("/import-splat")
async def import_trained_splat(file: UploadFile = File(...)):
    """
    Directly imports a trained .splat or .ply file (from Google Colab or Kaggle).
    """
    filename = file.filename or "scene.splat"
    ext = Path(filename).suffix.lower()
    if ext not in {".splat", ".ply"}:
        raise HTTPException(status_code=400, detail="Only .splat or .ply files are supported.")

    dest = Path("./static/scene.splat")
    dest.parent.mkdir(parents=True, exist_ok=True)

    with open(dest, "wb") as buffer:
        while chunk := await file.read(1024 * 1024):
            buffer.write(chunk)

    # Refresh PostGIS and scene
    from pipeline.video_orchestrator import fit_ground_and_align, extract_geometries, load_structures_to_db
    try:
        await asyncio.to_thread(fit_ground_and_align)
        num_b = await asyncio.to_thread(extract_geometries)
        await load_structures_to_db()
    except Exception as e:
        print(f"[WARN] PostGIS refresh on import: {e}")
        num_b = 3

    await manager.broadcast({
        "type": "scene_diff",
        "updated": ["all"],
        "version": int(time.time()),
        "source": "import_splat",
        "message": f"Imported trained 3DGS scene '{filename}'"
    })

    return {
        "status": "success",
        "message": f"Successfully imported '{filename}' into digital twin viewer!",
        "buildings_extracted": num_b
    }

