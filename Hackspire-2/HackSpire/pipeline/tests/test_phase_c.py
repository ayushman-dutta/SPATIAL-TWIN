import json
import sqlite3
from pathlib import Path

from PIL import Image

from pipeline.common import colmap_sfm
from pipeline.common.colmap_sfm import SfMConfig, run_colmap_sfm


def _capability_report():
    commands = {}
    flags = {
        "feature_extractor": ["--ImageReader.single_camera", "--ImageReader.camera_model", "--FeatureExtraction.type", "--FeatureExtraction.use_gpu", "--FeatureExtraction.max_image_size", "--SiftExtraction.max_num_features"],
        "sequential_matcher": ["--FeatureMatching.use_gpu", "--FeatureMatching.guided_matching", "--SequentialMatching.overlap", "--SequentialMatching.loop_detection", "--SequentialMatching.loop_detection_period"],
        "mapper": ["--Mapper.multiple_models", "--Mapper.max_num_models", "--Mapper.min_model_size", "--Mapper.ba_global_max_num_iterations", "--Mapper.ba_use_gpu"],
        "bundle_adjuster": ["--BundleAdjustmentCeres.max_num_iterations", "--BundleAdjustmentCeres.use_gpu"],
        "model_converter": [],
        "pose_prior_mapper": ["--Mapper.multiple_models", "--Mapper.max_num_models", "--Mapper.min_model_size", "--Mapper.ba_global_max_num_iterations", "--Mapper.ba_use_gpu", "--overwrite_priors_covariance", "--prior_position_std_x", "--prior_position_std_y", "--prior_position_std_z"],
        "image_undistorter": [],
        "patch_match_stereo": [],
        "stereo_fusion": [],
    }
    for name, supported in flags.items():
        commands[name] = {"available": True, "supported_flags": supported}
    return {
        "colmap": {
            "executable": "colmap",
            "required_commands_available": True,
            "missing_required_commands": [],
            "commands": commands,
        },
        "nvidia_gpu": {"available": False},
    }


def test_colmap_runner_exports_local_trajectory_without_metric_claims(tmp_path, monkeypatch):
    frames = tmp_path / "frames"
    frames.mkdir()
    (frames / "frames.json").write_text(json.dumps({
        "schema_version": 1,
        "frames": [
            {"frame_index": 0, "timestamp_seconds": 0.0, "accepted": True, "path": "frame_000000.jpg", "width": 8, "height": 6},
            {"frame_index": 1, "timestamp_seconds": 1.0, "accepted": True, "path": "frame_000001.jpg", "width": 8, "height": 6},
        ]
    }), encoding="utf-8")
    for name in ("frame_000000.jpg", "frame_000001.jpg"):
        Image.new("RGB", (8, 6), (20, 30, 40)).save(frames / name)
    calls = []

    def fake_stage(command, workspace, stage, timeout_seconds, env=None):
        calls.append((stage, command))
        workspace = Path(workspace)
        if stage == "feature_extractor":
            connection = sqlite3.connect(workspace / "database.db")
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
        elif stage in ("mapper", "pose_prior_mapper"):
            (workspace / "sparse" / "0").mkdir(parents=True, exist_ok=True)
            for name in ("cameras.bin", "images.bin", "points3D.bin"):
                (workspace / "sparse" / "0" / name).write_bytes(b"fixture")
        elif stage == "bundle_adjuster":
            (workspace / "refined").mkdir(parents=True, exist_ok=True)
            for name in ("cameras.bin", "images.bin", "points3D.bin"):
                (workspace / "refined" / name).write_bytes(b"fixture")
        elif stage == "model_converter_txt":
            (workspace / "txt").mkdir(parents=True, exist_ok=True)
            (workspace / "txt" / "images.txt").write_text(
                "# header\n1 1 0 0 0 0 0 0 1 frame_000000.jpg\n0 0 -1\n"
                "2 1 0 0 0 1 0 0 1 frame_000001.jpg\n0 0 -1\n",
                encoding="utf-8",
            )
        elif stage == "model_converter_ply":
            Path(command[command.index("--output_path") + 1]).write_bytes(b"ply\n")
        return {"stage": stage, "status": "succeeded", "returncode": 0}

    monkeypatch.setattr(colmap_sfm, "inspect_toolchain", lambda *_args: _capability_report())
    monkeypatch.setattr(colmap_sfm, "run_stage", fake_stage)
    result = run_colmap_sfm(
        frames, tmp_path / "workspace", colmap_executable="colmap",
        config=SfMConfig(use_gpu=False, min_registered_images=2, stage_timeout_seconds=1),
    )

    assert [stage for stage, _ in calls] == [
        "feature_extractor", "sequential_matcher", "mapper", "bundle_adjuster",
        "model_converter_txt", "model_converter_ply",
    ]
    assert result["status"] == "sparse_ready"
    assert result["registered_images"] == 2
    assert result["coverage_percent"] == 100.0
    assert result["scale_status"] == "unknown"
    assert result["georeference_status"] == "unanchored"
    assert result["pose_priors_applied"] is False
    trajectory = json.loads((tmp_path / "workspace" / "trajectory.json").read_text(encoding="utf-8"))
    assert trajectory["poses"][1]["camera_center"] == [-1.0, 0.0, 0.0]
    geojson = json.loads((tmp_path / "workspace" / "flight_path.geojson").read_text(encoding="utf-8"))
    assert geojson["features"] == []
    assert geojson["properties"]["crs_status"] == "not_georeferenced"


def test_colmap_runner_applies_opt_in_pose_priors(tmp_path, monkeypatch):
    frames = tmp_path / "frames"
    frames.mkdir()
    (frames / "frames.json").write_text(json.dumps({
        "schema_version": 1,
        "frames": [
            {"frame_index": 0, "timestamp_seconds": 0.0, "accepted": True, "path": "frame_000000.jpg", "width": 8, "height": 6},
            {"frame_index": 1, "timestamp_seconds": 1.0, "accepted": True, "path": "frame_000001.jpg", "width": 8, "height": 6},
        ]
    }), encoding="utf-8")
    for name in ("frame_000000.jpg", "frame_000001.jpg"):
        Image.new("RGB", (8, 6), (20, 30, 40)).save(frames / name)
    telemetry = tmp_path / "telemetry.json"
    telemetry.write_text(json.dumps({
        "schema_version": 1, "status": "anchored_candidate", "source": "dji_srt",
        "parser_version": "phase-b-1", "records": [], "warnings": [],
        "generated_at": "2026-10-03T00:00:00+00:00", "matched_frames": [
            {"frame_index": 0, "timestamp_seconds": 0.0, "matched": True, "telemetry_index": 0,
             "age_seconds": 0.0, "latitude_deg": 37.0, "longitude_deg": -122.0, "altitude_m": 10.0,
             "altitude_reference": "relative_to_takeoff_or_device"},
            {"frame_index": 1, "timestamp_seconds": 1.0, "matched": True, "telemetry_index": 1,
             "age_seconds": 0.0, "latitude_deg": 37.0001, "longitude_deg": -122.0, "altitude_m": 10.5,
             "altitude_reference": "relative_to_takeoff_or_device"},
        ],
    }), encoding="utf-8")
    calls = []
    monkeypatch.setattr(colmap_sfm, "inspect_toolchain", lambda *_args: _capability_report())
    # Provide deterministic stage outputs through a local fake COLMAP shim.
    def stage_with_outputs(command, workspace, stage, timeout_seconds, env=None):
        workspace = Path(workspace)
        if stage == "feature_extractor":
            connection = sqlite3.connect(workspace / "database.db")
            connection.executescript(
                "CREATE TABLE images (image_id INTEGER PRIMARY KEY, name TEXT, camera_id INTEGER);"
                "CREATE TABLE pose_priors (pose_prior_id INTEGER PRIMARY KEY, corr_data_id INTEGER, corr_sensor_id INTEGER, corr_sensor_type INTEGER, position BLOB, position_covariance BLOB, gravity BLOB, coordinate_system INTEGER);"
            )
            connection.executemany("INSERT INTO images VALUES (?, ?, ?)", [(1, "frame_000000.jpg", 1), (2, "frame_000001.jpg", 1)])
            connection.commit(); connection.close()
        elif stage == "pose_prior_mapper":
            (workspace / "sparse" / "0").mkdir(parents=True, exist_ok=True)
            for name in ("cameras.bin", "images.bin", "points3D.bin"):
                (workspace / "sparse" / "0" / name).write_bytes(b"fixture")
        elif stage == "bundle_adjuster":
            (workspace / "refined").mkdir(parents=True, exist_ok=True)
            for name in ("cameras.bin", "images.bin", "points3D.bin"):
                (workspace / "refined" / name).write_bytes(b"fixture")
        elif stage == "model_converter_txt":
            (workspace / "txt").mkdir(parents=True, exist_ok=True)
            (workspace / "txt" / "images.txt").write_text("1 1 0 0 0 0 0 0 1 frame_000000.jpg\n0 0 -1\n2 1 0 0 0 1 0 0 1 frame_000001.jpg\n0 0 -1\n", encoding="utf-8")
        elif stage == "model_converter_ply":
            Path(command[command.index("--output_path") + 1]).write_bytes(b"ply\n")
        calls.append(stage)
        return {"stage": stage, "status": "succeeded", "returncode": 0}
    monkeypatch.setattr(colmap_sfm, "run_stage", stage_with_outputs)
    result = run_colmap_sfm(
        frames, tmp_path / "workspace", colmap_executable="colmap", telemetry_path=telemetry,
        config=SfMConfig(use_gpu=False, apply_pose_priors=True, min_registered_images=2, stage_timeout_seconds=1),
    )
    assert result["pose_priors_applied"] is True
    assert result["pose_priors_used"] == 2
    assert "pose_prior_mapper" in calls
    assert json.loads((tmp_path / "workspace" / "pose_priors.json").read_text())["status"] == "candidate"


def test_colmap_runner_requires_dense_manifest(tmp_path, monkeypatch):
    frames = tmp_path / "frames"
    frames.mkdir()
    monkeypatch.setattr(colmap_sfm, "inspect_toolchain", lambda *_args: _capability_report())
    try:
        run_colmap_sfm(frames, tmp_path / "workspace", colmap_executable="colmap")
    except FileNotFoundError as exc:
        assert "frames.json" in str(exc)
    else:
        raise AssertionError("missing dense manifest was accepted")


def test_sfm_config_and_workspace_fail_closed(tmp_path):
    import pytest

    with pytest.raises(ValueError, match="camera model"):
        SfMConfig(camera_model="UNKNOWN")
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    (workspace / "old.txt").write_text("stale", encoding="utf-8")
    with pytest.raises(FileExistsError, match="empty"):
        run_colmap_sfm(tmp_path / "frames", workspace, colmap_executable="colmap")
