"""
Spatial Twin: Drone Video Keyframe Extractor (pipeline/video_processor.py)

Beginner Analogy:
A high-speed film scanner:
When a user uploads a drone video, this scanner inspects the flight, takes a series of evenly
spaced high-resolution snapshot photos along the drone's trajectory, and prepares them for
the AI semantic segmentation engine.
"""

from pathlib import Path
from typing import Dict, Any
import argparse
import json
import math
import sys
import numpy as np
from PIL import Image
import av

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pipeline.common.jobs import atomic_json

def extract_keyframes_from_video(
    video_path: str | Path,
    output_dir: str | Path = "./data/mill/images",
    max_frames: int = 10,
    target_size: tuple[int, int] = (512, 512)
) -> Dict[str, Any]:
    """
    Extracts evenly spaced keyframes from an uploaded drone video.
    
    Args:
        video_path: Path to the uploaded MP4/MOV video.
        output_dir: Folder to save the extracted keyframe images.
        max_frames: Maximum number of keyframes to extract.
        target_size: Width x Height for keyframe downsampling.
        
    Returns:
        Dictionary containing extraction statistics and metadata.
    """
    v_path = Path(video_path)
    out_dir = Path(output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    
    if not v_path.exists():
        raise FileNotFoundError(f"Video file does not exist: {v_path}")
        
    container = None
    video_stream = None
    try:
        container = av.open(str(v_path))
        video_stream = next((s for s in container.streams if s.type == "video"), None)
    except Exception as e:
        print(f"[WARN] PyAV video container open note: {e}")
        video_stream = None
        
    if video_stream is None:
        if container:
            container.close()
        raise ValueError(
            f"No decodable video stream was found in {v_path}. "
            "Synthetic frames are available only from explicit test fixtures."
        )
        
    total_frames = video_stream.frames
    fps = float(video_stream.average_rate) if video_stream.average_rate else 30.0
    duration_s = float(video_stream.duration * video_stream.time_base) if video_stream.duration else 0.0
    width = video_stream.width
    height = video_stream.height
    
    # Calculate step size to sample evenly across the flight
    if total_frames and total_frames > 0:
        step = max(1, total_frames // max_frames)
    else:
        step = max(1, int(fps * 1.5))

        
    extracted_paths = []
    frame_idx = 0
    saved_count = 0
    
    # Clear any previous images in the target directory to ensure clean pipeline run
    for old_file in out_dir.glob("frame_*.jpg"):
        try:
            old_file.unlink()
        except Exception:
            pass
            
    for frame in container.decode(video=0):
        if frame_idx % step == 0:
            pil_img = frame.to_image().convert("RGB")
            if target_size:
                pil_img = pil_img.resize(target_size, Image.Resampling.LANCZOS)
                
            dest_file = out_dir / f"frame_{saved_count:05d}.jpg"
            pil_img.save(dest_file, quality=92)
            extracted_paths.append(str(dest_file))
            saved_count += 1
            
            if saved_count >= max_frames:
                break
                
        frame_idx += 1
        
    container.close()
    
    # If the video was too short or 0 frames captured with step, decode at least 1 frame
    if saved_count == 0:
        container_retry = av.open(str(v_path))
        for frame in container_retry.decode(video=0):
            pil_img = frame.to_image().convert("RGB")
            if target_size:
                pil_img = pil_img.resize(target_size, Image.Resampling.LANCZOS)
            dest_file = out_dir / "frame_00000.jpg"
            pil_img.save(dest_file, quality=92)
            extracted_paths.append(str(dest_file))
            saved_count = 1
            break
        container_retry.close()
        
    return {
        "video_name": v_path.name,
        "width": width,
        "height": height,
        "fps": round(fps, 2),
        "duration_seconds": round(duration_s, 2),
        "extracted_frames_count": saved_count,
        "output_directory": str(out_dir),
        "frames": extracted_paths
    }


def _gray_thumbnail(image: Image.Image, size: tuple[int, int] = (128, 128)) -> np.ndarray:
    """Create a small luminance image without adding an OpenCV dependency."""
    return np.asarray(image.convert("L").resize(size, Image.Resampling.BILINEAR), dtype=np.float32)


def _sharpness_score(gray: np.ndarray) -> float:
    """Variance of a discrete Laplacian; useful for rejecting motion-blurred frames."""
    center = gray[1:-1, 1:-1]
    laplacian = (
        gray[:-2, 1:-1] + gray[2:, 1:-1] + gray[1:-1, :-2] + gray[1:-1, 2:]
        - 4.0 * center
    )
    return float(np.var(laplacian))


def _resize_preserving_aspect(image: Image.Image, max_dimension: int | None) -> Image.Image:
    if max_dimension is None:
        return image
    if isinstance(max_dimension, bool) or max_dimension <= 0:
        raise ValueError("max_dimension must be a positive integer or None.")
    largest = max(image.width, image.height)
    if largest <= max_dimension:
        return image
    ratio = max_dimension / largest
    size = (max(1, round(image.width * ratio)), max(1, round(image.height * ratio)))
    return image.resize(size, Image.Resampling.LANCZOS)


def extract_dense_frames(
    video_path: str | Path,
    output_dir: str | Path,
    frame_stride: int = 1,
    max_frames: int | None = None,
    max_dimension: int | None = 2048,
    min_sharpness: float = 20.0,
    duplicate_delta: float = 0.0001,
    jpeg_quality: int = 95,
) -> Dict[str, Any]:
    """Extract a dense, timestamped frame set for SfM/MVS.

    Every decoded frame (or configured stride) is inspected. Only frames rejected
    for measured blur or near-duplicate appearance are omitted. ``max_frames`` is
    intentionally optional and should only be used by preview callers.
    """
    source = Path(video_path)
    out_dir = Path(output_dir)
    if not source.is_file():
        raise FileNotFoundError(f"Video file does not exist: {source}")
    if isinstance(frame_stride, bool) or frame_stride < 1:
        raise ValueError("frame_stride must be a positive integer.")
    if max_frames is not None and (isinstance(max_frames, bool) or max_frames < 1):
        raise ValueError("max_frames must be a positive integer or None.")
    if not math.isfinite(float(min_sharpness)) or min_sharpness < 0:
        raise ValueError("min_sharpness must be finite and non-negative.")
    if not math.isfinite(float(duplicate_delta)) or not 0 <= duplicate_delta <= 1:
        raise ValueError("duplicate_delta must be between 0 and 1.")
    if isinstance(jpeg_quality, bool) or not 1 <= jpeg_quality <= 100:
        raise ValueError("jpeg_quality must be between 1 and 100.")

    out_dir.mkdir(parents=True, exist_ok=True)
    for old_file in out_dir.glob("frame_*.jpg"):
        if old_file.is_file() and not old_file.is_symlink():
            old_file.unlink()
    manifest_path = out_dir / "frames.json"
    container = None
    frames: list[dict[str, Any]] = []
    accepted_paths: list[str] = []
    previous_gray: np.ndarray | None = None
    decoded = 0
    accepted = 0
    rejected_blur = 0
    rejected_duplicate = 0
    timestamp_fallbacks = 0

    try:
        container = av.open(str(source))
        stream = next((item for item in container.streams if item.type == "video"), None)
        if stream is None:
            raise ValueError("No video stream found in the input.")
        fps = float(stream.average_rate) if stream.average_rate else 0.0
        time_base = float(stream.time_base) if stream.time_base else None
        width, height = int(stream.width), int(stream.height)
        for frame_index, frame in enumerate(container.decode(stream)):
            decoded += 1
            if frame_index % frame_stride != 0:
                continue
            timestamp_source = "pts"
            if frame.pts is not None and time_base is not None:
                timestamp_seconds = float(frame.pts * time_base)
                pts_value = int(frame.pts)
            elif fps > 0:
                timestamp_seconds = frame_index / fps
                pts_value = None
                timestamp_source = "nominal_fps_fallback"
                timestamp_fallbacks += 1
            else:
                timestamp_seconds = 0.0
                pts_value = None
                timestamp_source = "unknown"
                timestamp_fallbacks += 1

            original = frame.to_image().convert("RGB")
            gray = _gray_thumbnail(original)
            sharpness = _sharpness_score(gray)
            motion_delta = None if previous_gray is None else float(np.mean(np.abs(gray - previous_gray)) / 255.0)
            previous_gray = gray
            accepted_frame = True
            reason = "accepted"
            if sharpness < min_sharpness:
                accepted_frame = False
                reason = "motion_or_low_detail_blur"
                rejected_blur += 1
            elif motion_delta is not None and motion_delta < duplicate_delta:
                accepted_frame = False
                reason = "near_duplicate"
                rejected_duplicate += 1

            decision: dict[str, Any] = {
                "frame_index": frame_index,
                "pts": pts_value,
                "timestamp_seconds": round(timestamp_seconds, 6),
                "timestamp_source": timestamp_source,
                "sharpness": round(sharpness, 6),
                "motion_delta": None if motion_delta is None else round(motion_delta, 8),
                "accepted": accepted_frame,
                "reason": reason,
            }
            if accepted_frame:
                if max_frames is not None and accepted >= max_frames:
                    break
                image = _resize_preserving_aspect(original, max_dimension)
                filename = f"frame_{accepted:06d}.jpg"
                destination = out_dir / filename
                image.save(destination, format="JPEG", quality=jpeg_quality, optimize=True)
                decision.update({
                    "path": filename,
                    "width": image.width,
                    "height": image.height,
                })
                accepted_paths.append(str(destination))
                accepted += 1
            frames.append(decision)
            if max_frames is not None and accepted >= max_frames:
                break
    finally:
        if container is not None:
            container.close()

    if accepted == 0:
        raise ValueError("No usable frames remained after blur and duplicate filtering.")
    result = {
        "schema_version": 1,
        "video_name": source.name,
        "video_path": str(source),
        "source_width": width,
        "source_height": height,
        "fps": round(fps, 6),
        "frame_stride": frame_stride,
        "decoded_frames": decoded,
        "accepted_frames": accepted,
        "rejected_blur": rejected_blur,
        "rejected_duplicate": rejected_duplicate,
        "timestamp_fallbacks": timestamp_fallbacks,
        "output_directory": str(out_dir),
        "frames": frames,
        "accepted_paths": accepted_paths,
    }
    atomic_json(manifest_path, result)
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Extract dense real frames for local SfM/MVS.")
    parser.add_argument("video", type=Path)
    parser.add_argument("output_dir", type=Path)
    parser.add_argument("--stride", type=int, default=1)
    parser.add_argument("--max-frames", type=int, default=None)
    parser.add_argument("--max-dimension", type=int, default=2048)
    parser.add_argument("--min-sharpness", type=float, default=20.0)
    parser.add_argument("--duplicate-delta", type=float, default=0.0001)
    args = parser.parse_args()
    print(json.dumps(extract_dense_frames(
        args.video, args.output_dir, frame_stride=args.stride,
        max_frames=args.max_frames, max_dimension=args.max_dimension,
        min_sharpness=args.min_sharpness, duplicate_delta=args.duplicate_delta,
    ), indent=2))
