import json
import sqlite3
from pathlib import Path

from pipeline.common.pose_priors import build_pose_priors, install_colmap_cartesian_priors


def _telemetry_payload():
    return {
        "schema_version": 1,
        "status": "anchored_candidate",
        "source": "dji_srt",
        "parser_version": "phase-b-1",
        "records": [],
        "matched_frames": [
            {
                "frame_index": 0, "timestamp_seconds": 0.0, "matched": True,
                "telemetry_index": 0, "age_seconds": 0.0,
                "latitude_deg": 37.0, "longitude_deg": -122.0, "altitude_m": 20.0,
                "altitude_reference": "relative_to_takeoff_or_device",
            },
            {
                "frame_index": 1, "timestamp_seconds": 1.0, "matched": True,
                "telemetry_index": 1, "age_seconds": 0.0,
                "latitude_deg": 37.0001, "longitude_deg": -122.0, "altitude_m": 20.5,
                "altitude_reference": "relative_to_takeoff_or_device",
            },
        ],
        "warnings": [],
        "generated_at": "2026-10-03T00:00:00+00:00",
    }


def test_pose_priors_are_local_candidates_and_not_georeference_claims(tmp_path: Path):
    telemetry = tmp_path / "telemetry.json"
    telemetry.write_text(json.dumps(_telemetry_payload()), encoding="utf-8")
    artifact = build_pose_priors(telemetry, {
        0: {"path": "frame_000000.jpg"},
        1: {"path": "frame_000001.jpg"},
    })
    assert artifact["status"] == "candidate"
    assert artifact["coordinate_system"] == "local_cartesian_unvalidated"
    assert artifact["origin_wgs84"]["latitude_deg"] == 37.0
    assert artifact["priors"][1]["position_local"][1] > 10
    assert artifact["priors"][1]["position_local"][2] == 0.5


def test_pose_priors_can_be_installed_in_colmap_database(tmp_path: Path):
    database = tmp_path / "database.db"
    connection = sqlite3.connect(database)
    connection.executescript(
        "CREATE TABLE images (image_id INTEGER PRIMARY KEY, name TEXT, camera_id INTEGER);"
        "CREATE TABLE pose_priors (pose_prior_id INTEGER PRIMARY KEY, corr_data_id INTEGER, "
        "corr_sensor_id INTEGER, corr_sensor_type INTEGER, position BLOB, "
        "position_covariance BLOB, gravity BLOB, coordinate_system INTEGER);"
    )
    connection.executemany("INSERT INTO images VALUES (?, ?, ?)", [
        (1, "frame_000000.jpg", 1), (2, "frame_000001.jpg", 1),
    ])
    connection.commit()
    connection.close()
    telemetry = tmp_path / "telemetry.json"
    telemetry.write_text(json.dumps(_telemetry_payload()), encoding="utf-8")
    artifact = build_pose_priors(telemetry, {
        0: {"path": "frame_000000.jpg"}, 1: {"path": "frame_000001.jpg"},
    })
    assert install_colmap_cartesian_priors(database, artifact) == 2
    connection = sqlite3.connect(database)
    assert connection.execute("SELECT COUNT(*) FROM pose_priors WHERE coordinate_system = 2").fetchone()[0] == 2
    connection.close()
