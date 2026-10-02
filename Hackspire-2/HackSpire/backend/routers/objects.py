from fastapi import APIRouter
from typing import List, Optional
from backend.schemas.core import Structure, Region, Project
from backend.db.queries import fetch_all_structures, fetch_all_regions, fetch_project
from backend.scene_access import scene_status

router = APIRouter(prefix="/api/objects")

@router.get("/scene")
async def get_scene_status():
    """Returns the fail-closed reconstruction mode and measurement capabilities."""
    return scene_status()


@router.get("/project", response_model=Optional[Project])
async def get_project():
    return await fetch_project(1)

@router.get("/structures", response_model=List[Structure])
async def get_structures():
    return await fetch_all_structures()

@router.get("/regions", response_model=List[Region])
async def get_regions():
    return await fetch_all_regions()
