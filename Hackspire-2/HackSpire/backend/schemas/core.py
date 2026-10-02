from pydantic import BaseModel
from typing import Any

class Region(BaseModel):
    id: str
    name: str
    boundary: Any

class Project(BaseModel):
    id: int
    name: str
    scale_factor: float
    frame_transform: Any

class Structure(BaseModel):
    id: int
    project_id: int
    class_name: str
    footprint: Any
    height_m: float
    area_m2: float
    region: str | None = None
    splat_bbox: dict | None = None
    original_height_m: float | None = None
    version: int

class SystemStatus(BaseModel):
    status: str
    db_connected: bool
