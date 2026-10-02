"""Fail-closed scene capabilities; uploaded files can never self-certify a scene."""

from contextlib import contextmanager
from pathlib import Path

from fastapi import HTTPException
from pydantic import ValidationError

from backend.config import settings
from pipeline.common.contracts import SceneManifest
from pipeline.common.jobs import file_digest
from pipeline.common.runtime import ResourceBusyError, resource_lease

CAPABILITIES = ("measure_metres", "edit_metres", "query_metrics", "export_geographic")


def active_scene() -> SceneManifest | None:
    root = Path(settings.STATIC_ASSETS_DIR).resolve()
    manifest_path = root / "scene.json"
    try:
        if manifest_path.stat().st_size > 1024 * 1024:
            return None
        scene = SceneManifest.model_validate_json(manifest_path.read_text(encoding="utf-8"))
        if scene.state != "ready":
            return None
        # Metadata alone cannot certify missing or substituted artifacts. This conservative
        # validator runs before metric access; an immutable-asset cache can be added later.
        for artifact in scene.artifacts.values():
            path = (root / artifact.path).resolve()
            if not path.is_relative_to(root) or not path.is_file():
                return None
            if path.stat().st_size != artifact.size_bytes or file_digest(path) != artifact.sha256:
                return None
        if scene.quality.status != "unassessed":
            report = scene.artifacts.get("quality_report")
            if report is None or report.sha256 != scene.quality.report_sha256:
                return None
        if scene.geometry_revision is not None:
            geometry = scene.artifacts.get("geometry")
            if geometry is None or geometry.sha256 != scene.geometry_revision:
                return None
        return scene
    except (OSError, ValueError, ValidationError):
        return None


def scene_status() -> dict:
    scene = active_scene()
    if scene is None:
        return {
            "schema_version": 1,
            "scene_id": None,
            "revision": None,
            "reconstruction_mode": "unknown",
            "execution_policy": "local_only",
            "scale_status": "unknown",
            "georeference_status": "unanchored",
            "quality_status": "unassessed",
            "independent_accuracy": "unassessed",
            "capabilities": dict.fromkeys(CAPABILITIES, False),
            "message": "No validated scene manifest. Legacy assets are an unverified visual preview only.",
        }
    return {
        "schema_version": scene.schema_version,
        "scene_id": scene.scene_id,
        "revision": scene.revision,
        "reconstruction_mode": scene.reconstruction_mode.value,
        "execution_policy": scene.execution_policy,
        "scale_status": scene.scale.status,
        "georeference_status": scene.georeference.status,
        "quality_status": scene.quality.status,
        "independent_accuracy": scene.quality.independent_accuracy,
        "capabilities": scene.capabilities(),
        "message": "Accuracy is not independently assessed." if scene.quality.independent_accuracy == "unassessed" else "See the scene quality report and its assessment scope.",
    }


def require_capability(capability: str) -> SceneManifest:
    if capability not in CAPABILITIES:
        raise ValueError("Unknown scene capability.")
    scene = active_scene()
    if scene is None or not scene.capabilities()[capability]:
        raise HTTPException(
            status_code=409,
            detail=("This scene is an unverified preview or has not passed the required scale/quality checks. "
                    "Measurements, metre-based edits, and geographic exports are unavailable. "
                    "Complete and validate the offline geometric reconstruction first."),
        )
    return scene


@contextmanager
def metric_access(capability: str):
    """Hold the publication lease through validation and the DB operation."""
    try:
        with resource_lease(Path(settings.PIPELINE_WORKSPACE) / ".locks", "publication"):
            yield require_capability(capability)
    except ResourceBusyError as exc:
        raise HTTPException(status_code=409, detail="Scene publication is busy. Please retry shortly.") from exc
