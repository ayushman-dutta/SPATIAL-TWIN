"""
Test suite for Video Pipeline Upload & Status API (backend/tests/test_pipeline_api.py)
"""

import pytest
from pathlib import Path
from httpx import AsyncClient, ASGITransport
from backend.main import app

@pytest.mark.asyncio
async def test_pipeline_status_idle():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        response = await ac.get("/api/pipeline/status")
        assert response.status_code == 200
        data = response.json()
        assert "status" in data
        assert "progress" in data
        assert "step" in data

@pytest.mark.asyncio
async def test_pipeline_upload_invalid_extension(tmp_path):
    fake_txt = tmp_path / "test.txt"
    fake_txt.write_text("not a video")
    
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        with open(fake_txt, "rb") as f:
            response = await ac.post(
                "/api/pipeline/upload",
                files={"file": ("test.txt", f, "text/plain")}
            )
        assert response.status_code == 400
        assert "Unsupported file format" in response.json()["detail"]

@pytest.mark.asyncio
async def test_pipeline_upload_valid_video():
    video_path = Path("output/test_sample.mp4")
    if not video_path.exists():
        pytest.skip("Test sample video not found")
        
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        with open(video_path, "rb") as f:
            response = await ac.post(
                "/api/pipeline/upload",
                files={"file": ("test_sample.mp4", f, "video/mp4")}
            )
        assert response.status_code == 200
        data = response.json()
        assert "job_id" in data
        assert data["status"] == "staged"
        assert data["reconstruction_mode"] == "sfm_mvs"
        assert "Phase A does not reconstruct" in data["message"]

@pytest.mark.asyncio
async def test_kaggle_config_endpoint():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        response = await ac.get("/api/pipeline/kaggle-config")
        assert response.status_code == 200
        data = response.json()
        assert "configured" in data
        assert "username" in data

@pytest.mark.asyncio
async def test_import_splat_endpoint(tmp_path):
    fake_splat = tmp_path / "test.splat"
    fake_splat.write_bytes(b"SPLAT" + b"\x00" * 27)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        with open(fake_splat, "rb") as f:
            response = await ac.post(
                "/api/pipeline/import-splat",
                files={"file": ("test.splat", f, "application/octet-stream")}
            )
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "success"

