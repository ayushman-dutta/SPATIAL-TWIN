"""Run the local COLMAP Structure-from-Motion phase."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pipeline.common.colmap_sfm import SfMConfig, run_colmap_sfm


def main() -> int:
    parser = argparse.ArgumentParser(description="Recover sparse camera poses with local COLMAP.")
    parser.add_argument("--frames", required=True, help="Phase B dense-frame directory containing frames.json")
    parser.add_argument("--workspace", required=True, help="Isolated per-job workspace for SfM artifacts")
    parser.add_argument("--colmap", default=None, help="COLMAP executable; defaults to PATH/project preflight resolution")
    parser.add_argument("--telemetry", default=None, help="Optional telemetry artifact to preserve in the SfM summary")
    parser.add_argument("--camera-model", default="SIMPLE_RADIAL")
    parser.add_argument("--max-image-size", type=int, default=2048)
    parser.add_argument("--max-num-features", type=int, default=4096)
    parser.add_argument("--sequential-overlap", type=int, default=10)
    parser.add_argument("--loop-detection-period", type=int, default=10)
    parser.add_argument("--vocab-tree", default=None, help="Optional local COLMAP vocabulary tree for loop closure")
    parser.add_argument("--apply-pose-priors", action="store_true", help="Opt in to local Cartesian telemetry priors")
    parser.add_argument("--mapper-ba-iterations", type=int, default=50)
    parser.add_argument("--min-registration-percent", type=float, default=20.0)
    parser.add_argument("--min-registered-images", type=int, default=10)
    parser.add_argument("--cpu-only", action="store_true", help="Disable CUDA for SIFT extraction and matching")
    args = parser.parse_args()
    if (
        args.max_image_size <= 0 or args.max_num_features <= 0 or args.sequential_overlap <= 0
        or args.min_registration_percent < 0 or args.min_registered_images < 2
    ):
        parser.error("image size, feature count, overlap, and registration thresholds are invalid")
    result = run_colmap_sfm(
        frames_dir=args.frames,
        workspace=args.workspace,
        colmap_executable=args.colmap,
        telemetry_path=args.telemetry,
        config=SfMConfig(
            camera_model=args.camera_model,
            max_image_size=args.max_image_size,
            max_num_features=args.max_num_features,
            sequential_overlap=args.sequential_overlap,
            loop_detection_period=args.loop_detection_period,
            vocab_tree_path=args.vocab_tree,
            apply_pose_priors=args.apply_pose_priors,
            mapper_ba_iterations=args.mapper_ba_iterations,
            min_registration_percent=args.min_registration_percent,
            min_registered_images=args.min_registered_images,
            use_gpu=not args.cpu_only,
        ),
    )
    print(json.dumps(result, indent=2))
    if result["status"] != "sparse_ready":
        print("ERROR: COLMAP produced insufficient registration coverage; downstream phases are blocked.", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
