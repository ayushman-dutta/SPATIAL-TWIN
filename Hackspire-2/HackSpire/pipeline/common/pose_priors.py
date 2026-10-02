"""Convert matched telemetry into optional COLMAP Cartesian pose priors.

The conversion is intentionally local and unvalidated. It is useful as an SfM
initialization prior, but it is not a geographic transform or metric certification.
"""
from __future__ import annotations

import math
import sqlite3
import struct
from pathlib import Path
from typing import Any

from pipeline.common.jobs import atomic_json
from pipeline.common.telemetry import TelemetryTrack


EARTH_RADIUS_M = 6_378_137.0


def _local_cartesian(latitude: float, longitude: float, altitude: float | None,
                     origin: tuple[float, float, float]) -> list[float]:
    lat0, lon0, alt0 = origin
    lat_rad = math.radians(lat0)
    east = math.radians(longitude - lon0) * EARTH_RADIUS_M * math.cos(lat_rad)
    north = math.radians(latitude - lat0) * EARTH_RADIUS_M
    up = 0.0 if altitude is None or not math.isfinite(altitude) else altitude - alt0
    return [round(east, 6), round(north, 6), round(up, 6)]


def build_pose_priors(
    telemetry_path: str | Path,
    accepted_by_index: dict[int, dict[str, Any]],
) -> dict:
    """Build a versioned local prior artifact from matched, timestamped telemetry."""
    path = Path(telemetry_path).resolve()
    if not path.is_file():
        raise FileNotFoundError(f"Telemetry artifact does not exist: {path}")
    track = TelemetryTrack.model_validate_json(path.read_text(encoding="utf-8"))
    candidates = [
        frame for frame in track.matched_frames
        if frame.matched and frame.frame_index in accepted_by_index
        and frame.latitude_deg is not None and frame.longitude_deg is not None
    ]
    if not candidates:
        return {
            "schema_version": 1,
            "status": "unavailable",
            "coordinate_system": "local_cartesian_unvalidated",
            "source": str(path),
            "origin_wgs84": None,
            "priors": [],
            "note": "No accepted frame has a matched latitude and longitude.",
        }
    origin = (
        float(candidates[0].latitude_deg),
        float(candidates[0].longitude_deg),
        float(candidates[0].altitude_m) if candidates[0].altitude_m is not None else 0.0,
    )
    priors = []
    for frame in candidates:
        item = accepted_by_index[frame.frame_index]
        priors.append({
            "frame_index": frame.frame_index,
            "image_name": Path(str(item["path"])).name,
            "timestamp_seconds": frame.timestamp_seconds,
            "age_seconds": frame.age_seconds,
            "position_local": _local_cartesian(
                float(frame.latitude_deg), float(frame.longitude_deg),
                frame.altitude_m, origin,
            ),
            "source_position_wgs84": {
                "latitude_deg": frame.latitude_deg,
                "longitude_deg": frame.longitude_deg,
                "altitude_m": frame.altitude_m,
                "altitude_reference": frame.altitude_reference,
            },
        })
    return {
        "schema_version": 1,
        "status": "candidate",
        "coordinate_system": "local_cartesian_unvalidated",
        "source": str(path),
        "origin_wgs84": {
            "latitude_deg": origin[0], "longitude_deg": origin[1], "altitude_m": origin[2],
        },
        "priors": priors,
        "note": "Local tangent-plane positions are SfM priors only; Phase D must independently validate scale and georeferencing.",
    }


def install_colmap_cartesian_priors(database_path: str | Path, artifact: dict) -> int:
    """Insert local Cartesian priors into COLMAP 4.2's pose_priors table."""
    if artifact.get("status") != "candidate" or not artifact.get("priors"):
        raise ValueError("No usable telemetry pose priors are available.")
    database = Path(database_path)
    with sqlite3.connect(database) as connection:
        columns = {row[1] for row in connection.execute("PRAGMA table_info(pose_priors)")}
        required = {"pose_prior_id", "corr_data_id", "corr_sensor_id", "corr_sensor_type",
                    "position", "position_covariance", "gravity", "coordinate_system"}
        if not required.issubset(columns):
            raise RuntimeError("Installed COLMAP database has no compatible pose_priors schema.")
        rows = []
        for prior in artifact["priors"]:
            image = connection.execute(
                "SELECT image_id, camera_id FROM images WHERE name = ?",
                (prior["image_name"],),
            ).fetchone()
            if image is None:
                continue
            position = [float(value) for value in prior["position_local"]]
            if len(position) != 3 or not all(math.isfinite(value) for value in position):
                continue
            rows.append((
                int(image[0]), int(image[0]), int(image[1]), 0,
                struct.pack("<3d", *position), None, None, 2,  # CARTESIAN = 2 in COLMAP 4.2.
            ))
        if not rows:
            raise ValueError("Telemetry priors did not match any extracted COLMAP images.")
        connection.executemany(
            "INSERT OR REPLACE INTO pose_priors "
            "(pose_prior_id, corr_data_id, corr_sensor_id, corr_sensor_type, position, "
            "position_covariance, gravity, coordinate_system) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            rows,
        )
        connection.commit()
    return len(rows)


def write_pose_priors(path: str | Path, artifact: dict) -> None:
    atomic_json(Path(path), artifact)
