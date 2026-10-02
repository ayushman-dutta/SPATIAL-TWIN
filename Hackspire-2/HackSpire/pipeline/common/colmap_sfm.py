"""COLMAP sparse SfM orchestration and local camera-path export.

This module owns camera recovery only. It does not claim metric scale, geographic
CRS, dense surfaces, or a textured mesh; those are later phases.
"""
from __future__ import annotations

from dataclasses import dataclass
import json
import math
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image

from pipeline.common.jobs import atomic_json, file_digest
from pipeline.common.pose_priors import build_pose_priors, install_colmap_cartesian_priors, write_pose_priors
from pipeline.common.runtime import _safe_directory, resource_lease, run_stage
from pipeline.common.telemetry import TelemetryTrack
from pipeline.common.toolchain import inspect_toolchain


DEFAULT_RESOURCE_ROOT = Path(__file__).resolve().parents[2] / "output" / "reconstruction_jobs"
CAMERA_MODELS = {"SIMPLE_RADIAL", "RADIAL", "PINHOLE", "SIMPLE_PINHOLE", "OPENCV"}


@dataclass(frozen=True)
class SfMConfig:
    camera_model: str = "SIMPLE_RADIAL"
    max_image_size: int = 2048
    max_num_features: int = 4096
    sequential_overlap: int = 10
    loop_detection_period: int = 10
    mapper_ba_iterations: int = 50
    min_registration_percent: float = 20.0
    min_registered_images: int = 10
    use_gpu: bool = True
    stage_timeout_seconds: float = 6 * 60 * 60
    vocab_tree_path: str | None = None
    apply_pose_priors: bool = False

    def __post_init__(self) -> None:
        if self.camera_model not in CAMERA_MODELS:
            raise ValueError(f"Unsupported camera model. Choose from {sorted(CAMERA_MODELS)}.")
        for name in ("max_image_size", "max_num_features", "sequential_overlap",
                     "loop_detection_period", "mapper_ba_iterations", "min_registered_images"):
            value = getattr(self, name)
            if type(value) is not int or value < (2 if name == "min_registered_images" else 1):
                raise ValueError(f"{name} must be a positive integer (at least two images).")
        if (isinstance(self.min_registration_percent, bool)
                or not math.isfinite(self.min_registration_percent)
                or not 0 < self.min_registration_percent <= 100):
            raise ValueError("min_registration_percent must be finite and in (0, 100].")
        if (isinstance(self.stage_timeout_seconds, bool)
                or not math.isfinite(self.stage_timeout_seconds) or self.stage_timeout_seconds <= 0):
            raise ValueError("stage_timeout_seconds must be finite and positive.")
        if type(self.use_gpu) is not bool or type(self.apply_pose_priors) is not bool:
            raise ValueError("use_gpu and apply_pose_priors must be booleans.")
        if self.vocab_tree_path is not None:
            path = Path(self.vocab_tree_path)
            if not path.is_file() or path.stat().st_size == 0:
                raise ValueError("Loop detection requires a nonempty, existing local vocabulary tree.")


def _model_files(path: Path) -> bool:
    return any(all((path / f"{name}.{suffix}").is_file()
                   and (path / f"{name}.{suffix}").stat().st_size > 0
                   for name in ("cameras", "images", "points3D"))
               for suffix in ("bin", "txt"))


def _single_model(root: Path) -> Path:
    candidates = [path for path in root.iterdir() if path.is_dir() and path.name.isdigit() and _model_files(path)]
    if not candidates:
        raise RuntimeError(f"COLMAP produced no usable sparse model under {root}.")
    if len(candidates) != 1:
        raise RuntimeError("Expected exactly one sparse component; refusing to select an arbitrary model.")
    return candidates[0]


def _flag(report: dict, command: str, name: str) -> bool:
    info = report["colmap"]["commands"].get(command, {})
    return name in info.get("supported_flags", [])


def _required_flag(report: dict, command: str, name: str) -> None:
    if not _flag(report, command, name):
        raise RuntimeError(f"Installed COLMAP does not advertise required flag {name} for {command}.")


def _add_flag(command: list[str], report: dict, subcommand: str, name: str, value: Any) -> None:
    if _flag(report, subcommand, name):
        command.extend([name, str(value)])


def _resolve_executable(colmap_executable: str | None, workspace: Path) -> tuple[str, dict]:
    report = inspect_toolchain(colmap_executable, workspace)
    info = report["colmap"]
    required = ("feature_extractor", "sequential_matcher", "mapper", "bundle_adjuster", "model_converter")
    missing = [name for name in required if not info["commands"].get(name, {}).get("available")]
    if missing:
        raise RuntimeError(f"COLMAP SfM cannot start; required commands are unavailable: {', '.join(missing)}")
    executable = info["executable"]
    if not executable:
        raise RuntimeError("COLMAP executable was not found.")
    return executable, report


def _manifest_frames(frames_dir: Path) -> tuple[dict[str, dict[str, Any]], int, dict[int, dict[str, Any]] ]:
    manifest_path = frames_dir / "frames.json"
    if not manifest_path.is_file():
        raise FileNotFoundError(f"Dense frame manifest is required: {manifest_path}")
    payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict) or payload.get("schema_version") != 1:
        raise ValueError("Dense frame manifest must use schema_version=1.")
    frames = payload.get("frames")
    if not isinstance(frames, list) or not frames or any(not isinstance(item, dict) for item in frames):
        raise ValueError("Dense frame manifest contains no valid frame decisions.")
    if any(type(item.get("accepted")) is not bool for item in frames):
        raise ValueError("Every frame decision must have an accepted boolean.")
    accepted = [item for item in frames if item["accepted"]]
    if len(accepted) < 2:
        raise ValueError("SfM requires at least two accepted real frames.")
    lookup: dict[str, dict[str, Any]] = {}
    accepted_by_index: dict[int, dict[str, Any]] = {}
    names, indices = set(), set()
    dimensions = set()
    previous_timestamp = None
    previous_index = -1
    for item in accepted:
        name = item.get("path")
        if (not isinstance(name, str) or not name or name in {".", ".."}
                or any(char in name for char in '/\\\\:\r\n\x00')
                or Path(name).suffix.lower() not in {".jpg", ".jpeg", ".png"}):
            raise ValueError("Frame paths must be plain image filenames inside the frame directory.")
        index, timestamp = item.get("frame_index"), item.get("timestamp_seconds")
        if type(index) is not int or index <= previous_index or index in indices:
            raise ValueError("Accepted frame indices must be unique, increasing, and nonnegative.")
        if (type(timestamp) not in (int, float) or not math.isfinite(timestamp)
                or (previous_timestamp is not None and timestamp <= previous_timestamp)):
            raise ValueError("Accepted frame timestamps must be finite and strictly increasing.")
        image_path = frames_dir / name
        if name.casefold() in names or image_path.is_symlink():
            raise ValueError("Duplicate filenames and linked frame images are not allowed.")
        if not image_path.is_file():
            raise FileNotFoundError(f"Accepted frame is missing: {name}")
        with Image.open(image_path) as image:
            dimensions.add(image.size)
            if (item.get("width", image.width), item.get("height", image.height)) != image.size:
                raise ValueError(f"Image dimensions differ from the manifest: {name}")
            image.verify()
        names.add(name.casefold())
        indices.add(index)
        previous_index, previous_timestamp = index, timestamp
        lookup[name] = item
        accepted_by_index[index] = item
    if len(dimensions) != 1:
        raise ValueError("Single-camera SfM requires identical dimensions for all accepted images.")
    return lookup, len(accepted), accepted_by_index


def _qvec_to_rotation(qvec: list[float]) -> np.ndarray:
    qw, qx, qy, qz = qvec
    norm = float(np.linalg.norm(qvec))
    if not math.isfinite(norm) or norm <= 1e-12 or not np.isfinite(qvec).all():
        raise ValueError("COLMAP image pose contains an invalid quaternion.")
    qw, qx, qy, qz = (value / norm for value in (qw, qx, qy, qz))
    return np.array([
        [1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy - qz * qw), 2 * (qx * qz + qy * qw)],
        [2 * (qx * qy + qz * qw), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz - qx * qw)],
        [2 * (qx * qz - qy * qw), 2 * (qy * qz + qx * qw), 1 - 2 * (qx * qx + qy * qy)],
    ], dtype=np.float64)


def _parse_images_txt(path: Path, frame_lookup: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    lines = path.read_text(encoding="utf-8").splitlines()
    images: list[dict[str, Any]] = []
    seen_ids, seen_names = set(), set()
    index = 0
    while index < len(lines):
        line = lines[index].strip()
        index += 1
        if not line or line.startswith("#"):
            continue
        tokens = line.split(maxsplit=9)
        if len(tokens) != 10:
            raise ValueError("Invalid COLMAP images.txt pose record.")
        try:
            image_id = int(tokens[0])
            qvec = [float(value) for value in tokens[1:5]]
            tvec = np.array([float(value) for value in tokens[5:8]], dtype=np.float64)
            camera_id = int(tokens[8])
        except ValueError as exc:
            raise ValueError(f"Invalid COLMAP images.txt pose line: {line}") from exc
        if index >= len(lines):
            raise ValueError(f"COLMAP images.txt is missing POINTS2D for image {image_id}.")
        observations = lines[index].split()
        index += 1
        if len(observations) % 3:
            raise ValueError(f"Invalid POINTS2D record for image {image_id}.")
        for i in range(0, len(observations), 3):
            if not all(math.isfinite(float(v)) for v in observations[i:i + 2]):
                raise ValueError("Nonfinite POINTS2D coordinates.")
            int(observations[i + 2])
        name = tokens[9]
        if (image_id <= 0 or camera_id <= 0 or image_id in seen_ids or name in seen_names
                or name not in frame_lookup or not np.isfinite(tvec).all()):
            raise ValueError("COLMAP poses contain duplicate/unknown images or invalid IDs/translations.")
        seen_ids.add(image_id)
        seen_names.add(name)
        rotation = _qvec_to_rotation(qvec)
        qvec = (np.asarray(qvec) / np.linalg.norm(qvec)).tolist()
        center = (-rotation.T @ tvec).tolist()
        if not np.isfinite(center).all():
            raise ValueError("COLMAP camera center is nonfinite.")
        frame = frame_lookup[name]
        images.append({
            "image_id": image_id,
            "name": name,
            "camera_id": camera_id,
            "qvec_wxyz": qvec,
            "tvec": tvec.tolist(),
            "camera_center": [round(float(value), 9) for value in center],
            "frame_index": frame.get("frame_index") if frame else None,
            "timestamp_seconds": frame.get("timestamp_seconds") if frame else None,
        })
    return images


def _write_trajectory(output_dir: Path, images: list[dict[str, Any]], accepted_frames: int, telemetry_path: Path | None) -> dict:
    ordered = sorted(images, key=lambda item: item["frame_index"])
    registered = len(images)
    trajectory = {
        "schema_version": 1,
        "coordinate_frame": "colmap_local_similarity_frame",
        "scale_status": "unknown",
        "georeference_status": "unanchored",
        "registered_images": registered,
        "input_accepted_frames": accepted_frames,
        "coverage_percent": round(100 * registered / accepted_frames, 3) if accepted_frames else 0.0,
        "registration_quality_status": "pending",
        "pose_convention": "COLMAP world-to-camera: x_cam = R(q_wxyz) x_world + t; center = -R.T t",
        "units": "arbitrary; not metres",
        "telemetry_artifact": str(telemetry_path) if telemetry_path else None,
        "poses": ordered,
    }
    atomic_json(output_dir / "trajectory.json", trajectory)
    geojson = {
        "type": "FeatureCollection",
        "name": "flight_path_colmap_local",
        "properties": {
            "coordinate_frame": "colmap_local_similarity_frame",
            "crs_status": "not_georeferenced",
            "note": "Geographic geometry withheld. Local camera centers are in trajectory.json; Phase D must validate the transform.",
        },
        # RFC 7946 coordinates mean WGS84 longitude/latitude. Local coordinates
        # must not be silently interpreted as degrees by an ordinary GIS viewer.
        "features": [],
    }
    atomic_json(output_dir / "flight_path.geojson", geojson)
    return trajectory


def _run_colmap_sfm(
    frames_dir: str | Path,
    workspace: str | Path,
    colmap_executable: str | None = None,
    telemetry_path: str | Path | None = None,
    config: SfMConfig | None = None,
) -> dict:
    """Run local COLMAP SfM and export an explicitly unscaled camera trajectory."""
    cfg = config or SfMConfig()
    frames = Path(frames_dir).resolve()
    root = Path(workspace).resolve()
    root.mkdir(parents=True, exist_ok=True)
    manifest_path = frames / "frames.json"
    if not frames.is_dir():
        raise FileNotFoundError(f"Frame directory does not exist: {frames}")
    lookup, accepted_frames, accepted_by_index = _manifest_frames(frames)
    executable, capabilities = _resolve_executable(colmap_executable, root)
    sfm_root = root / "sfm"
    database = sfm_root / "database.db"
    sparse_root = sfm_root / "sparse"
    refined_root = sfm_root / "refined"
    txt_root = sfm_root / "txt"
    sparse_root.mkdir(parents=True, exist_ok=True)
    stages: list[dict] = []
    gpu = bool(cfg.use_gpu and capabilities["nvidia_gpu"]["available"])
    telemetry = Path(telemetry_path).resolve() if telemetry_path else None
    telemetry_summary = {"status": "not_supplied", "records": 0, "matched_position_frames": 0}
    pose_artifact_path = root / "pose_priors.json"
    pose_artifact = None
    applied_pose_prior_count = 0
    if telemetry is not None:
        if not telemetry.is_file():
            raise FileNotFoundError(f"Telemetry artifact does not exist: {telemetry}")
        track = TelemetryTrack.model_validate_json(telemetry.read_text(encoding="utf-8"))
        telemetry_summary = {
            "status": track.status,
            "source": track.source,
            "records": len(track.records),
            "matched_position_frames": sum(
                1 for frame in track.matched_frames
                if frame.matched and frame.latitude_deg is not None and frame.longitude_deg is not None
            ),
        }
        pose_artifact = build_pose_priors(telemetry, accepted_by_index)
        write_pose_priors(pose_artifact_path, pose_artifact)
    if cfg.apply_pose_priors:
        if pose_artifact is None:
            raise ValueError("--apply-pose-priors requires a validated telemetry artifact.")
        if not capabilities["colmap"]["commands"].get("pose_prior_mapper", {}).get("available"):
            raise RuntimeError("Installed COLMAP does not advertise pose_prior_mapper.")

    feature = [executable, "feature_extractor", "--database_path", str(database), "--image_path", str(frames)]
    _required_flag(capabilities, "feature_extractor", "--ImageReader.single_camera")
    _required_flag(capabilities, "feature_extractor", "--ImageReader.camera_model")
    feature.extend(["--ImageReader.single_camera", "1", "--ImageReader.camera_model", cfg.camera_model])
    _add_flag(feature, capabilities, "feature_extractor", "--FeatureExtraction.type", "SIFT")
    _add_flag(feature, capabilities, "feature_extractor", "--FeatureExtraction.use_gpu", int(gpu))
    _add_flag(feature, capabilities, "feature_extractor", "--FeatureExtraction.max_image_size", cfg.max_image_size)
    _add_flag(feature, capabilities, "feature_extractor", "--SiftExtraction.max_num_features", cfg.max_num_features)
    stages.append(run_stage(feature, sfm_root, "feature_extractor", cfg.stage_timeout_seconds))

    matcher = [executable, "sequential_matcher", "--database_path", str(database)]
    _add_flag(matcher, capabilities, "sequential_matcher", "--FeatureMatching.use_gpu", int(gpu))
    _add_flag(matcher, capabilities, "sequential_matcher", "--FeatureMatching.guided_matching", 1)
    _add_flag(matcher, capabilities, "sequential_matcher", "--SequentialMatching.overlap", cfg.sequential_overlap)
    # Dense video has many nearly identical neighbors. Disable COLMAP's quadratic
    # sequential expansion; loop detection below still adds non-local closures.
    _add_flag(matcher, capabilities, "sequential_matcher", "--SequentialMatching.quadratic_overlap", 0)
    _add_flag(matcher, capabilities, "sequential_matcher", "--SequentialMatching.loop_detection", 1)
    _add_flag(matcher, capabilities, "sequential_matcher", "--SequentialMatching.loop_detection_period", cfg.loop_detection_period)
    if cfg.vocab_tree_path:
        _add_flag(matcher, capabilities, "sequential_matcher", "--SequentialMatching.vocab_tree_path", cfg.vocab_tree_path)
    stages.append(run_stage(matcher, sfm_root, "sequential_matcher", cfg.stage_timeout_seconds))

    mapper_command = "pose_prior_mapper" if cfg.apply_pose_priors else "mapper"
    if cfg.apply_pose_priors:
        applied_pose_prior_count = install_colmap_cartesian_priors(database, pose_artifact)
    mapper = [executable, mapper_command, "--database_path", str(database), "--image_path", str(frames), "--output_path", str(sparse_root)]
    _add_flag(mapper, capabilities, mapper_command, "--Mapper.multiple_models", 0)
    _add_flag(mapper, capabilities, mapper_command, "--Mapper.max_num_models", 1)
    _add_flag(mapper, capabilities, mapper_command, "--Mapper.min_model_size", 10)
    _add_flag(mapper, capabilities, mapper_command, "--Mapper.ba_global_max_num_iterations", cfg.mapper_ba_iterations)
    _add_flag(mapper, capabilities, mapper_command, "--Mapper.ba_use_gpu", 0)
    if cfg.apply_pose_priors:
        _add_flag(mapper, capabilities, mapper_command, "--overwrite_priors_covariance", 1)
        _add_flag(mapper, capabilities, mapper_command, "--prior_position_std_x", 10)
        _add_flag(mapper, capabilities, mapper_command, "--prior_position_std_y", 10)
        _add_flag(mapper, capabilities, mapper_command, "--prior_position_std_z", 10)
    stages.append(run_stage(mapper, sfm_root, mapper_command, cfg.stage_timeout_seconds))
    sparse_model = _single_model(sparse_root)

    refined_root.mkdir(parents=True, exist_ok=True)
    bundle = [executable, "bundle_adjuster", "--input_path", str(sparse_model), "--output_path", str(refined_root)]
    _add_flag(bundle, capabilities, "bundle_adjuster", "--BundleAdjustmentCeres.max_num_iterations", cfg.mapper_ba_iterations)
    _add_flag(bundle, capabilities, "bundle_adjuster", "--BundleAdjustmentCeres.use_gpu", 0)
    stages.append(run_stage(bundle, sfm_root, "bundle_adjuster", cfg.stage_timeout_seconds))
    refined_model = refined_root if _model_files(refined_root) else sparse_model

    txt_root.mkdir(parents=True, exist_ok=True)
    converter_txt = [executable, "model_converter", "--input_path", str(refined_model), "--output_path", str(txt_root), "--output_type", "TXT"]
    stages.append(run_stage(converter_txt, sfm_root, "model_converter_txt", cfg.stage_timeout_seconds))
    converter_ply = [executable, "model_converter", "--input_path", str(refined_model), "--output_path", str(sfm_root / "sparse.ply"), "--output_type", "PLY"]
    stages.append(run_stage(converter_ply, sfm_root, "model_converter_ply", cfg.stage_timeout_seconds))

    images_txt = txt_root / "images.txt"
    if not images_txt.is_file():
        raise RuntimeError(f"COLMAP TXT export did not produce {images_txt}.")
    images = _parse_images_txt(images_txt, lookup)
    trajectory = _write_trajectory(root, images, accepted_frames, telemetry)
    coverage = trajectory["coverage_percent"]
    quality_passed = (
        len(images) >= cfg.min_registered_images
        and coverage >= cfg.min_registration_percent
    )
    trajectory["registration_quality_status"] = "passed" if quality_passed else "failed"
    atomic_json(root / "trajectory.json", trajectory)
    summary = {
        "schema_version": 1,
        "status": "sparse_ready" if quality_passed else "registration_failed",
        "coordinate_frame": "colmap_local_similarity_frame",
        "scale_status": "unknown",
        "georeference_status": "unanchored",
        "input_frames": accepted_frames,
        "registered_images": len(images),
        "coverage_percent": coverage,
        "registration_quality_gate": {
            "status": "passed" if quality_passed else "failed",
            "min_registered_images": cfg.min_registered_images,
            "min_registration_percent": cfg.min_registration_percent,
            "reason": None if quality_passed else (
                f"Only {len(images)} of {accepted_frames} accepted frames registered "
                f"({coverage:.3f}%), below the Phase C evidence threshold."
            ),
        },
        "sparse_model": str(refined_model),
        "sparse_ply": str(sfm_root / "sparse.ply"),
        "input_manifest_sha256": file_digest(manifest_path),
        "artifact_sha256": {
            "database": file_digest(database),
            "sparse_ply": file_digest(sfm_root / "sparse.ply"),
            "images_txt": file_digest(images_txt),
            "trajectory": file_digest(root / "trajectory.json"),
            **({"pose_priors": file_digest(pose_artifact_path)} if pose_artifact_path.is_file() else {}),
        },
        "stages": stages,
        "telemetry_artifact": str(telemetry) if telemetry else None,
        "telemetry_summary": telemetry_summary,
        "pose_priors_applied": cfg.apply_pose_priors,
        "pose_priors_used": applied_pose_prior_count,
        "pose_priors_artifact": str(pose_artifact_path) if pose_artifact is not None else None,
        "pose_priors_note": (
            "Local Cartesian telemetry priors were applied to pose_prior_mapper; scale and geographic validity remain unvalidated."
            if cfg.apply_pose_priors else
            "Telemetry is validated and preserved; pose-prior optimization was not requested."
        ),
    }
    atomic_json(root / "sfm_summary.json", summary)
    return summary


def run_colmap_sfm(
    frames_dir: str | Path,
    workspace: str | Path,
    colmap_executable: str | None = None,
    telemetry_path: str | Path | None = None,
    config: SfMConfig | None = None,
) -> dict:
    """Run SfM once in an empty isolated workspace under the local COLMAP lease."""
    frames = Path(frames_dir).resolve()
    root = Path(workspace).resolve()
    if root == Path(root.anchor) or root.is_symlink() or (root.exists() and not root.is_dir()):
        raise ValueError("SfM workspace must be a dedicated local directory.")
    if root.exists() and any(root.iterdir()):
        raise FileExistsError(f"SfM workspace must be empty for an isolated run: {root}")
    _safe_directory(root.parent)
    with resource_lease(root.parent, "colmap"):
        return _run_colmap_sfm(
            frames_dir=frames,
            workspace=root,
            colmap_executable=colmap_executable,
            telemetry_path=telemetry_path,
            config=config,
        )
