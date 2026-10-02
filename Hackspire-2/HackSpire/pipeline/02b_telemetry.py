"""Parse supported sidecar telemetry and match it to frame-manifest timestamps.

This stage never fabricates GPS or camera poses. Missing/ambiguous telemetry leaves
an explicit ``unanchored`` track for later SfM and georeferencing gates.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pipeline.common.telemetry import (
    build_track,
    match_telemetry,
    parse_autel_ass,
    parse_dji_srt,
    parse_exif_xmp,
)
from pipeline.common.jobs import atomic_json


def run_telemetry(
    frames_manifest: str | Path,
    output_path: str | Path,
    srt_path: str | Path | None = None,
    ass_path: str | Path | None = None,
    exif_path: str | Path | None = None,
    max_age_seconds: float = 0.25,
) -> dict:
    manifest_path = Path(frames_manifest)
    payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    frame_records = payload.get("frames", [])
    if not isinstance(frame_records, list):
        raise ValueError("The frame manifest must contain a frames array.")

    warnings: list[str] = []
    records = []
    sources = [item for item in (srt_path, ass_path, exif_path) if item is not None]
    if len(sources) > 1:
        raise ValueError("Provide one telemetry source per run; merge is deferred until source conventions are verified.")
    if srt_path is not None:
        records = parse_dji_srt(srt_path)
    elif ass_path is not None:
        records = parse_autel_ass(ass_path)
    elif exif_path is not None:
        records = parse_exif_xmp(exif_path)
        warnings.append("EXIF/XMP record is file-level metadata; it is not a per-frame camera track.")
    else:
        warnings.append("No telemetry sidecar was supplied.")

    matched = match_telemetry(frame_records, records, max_age_seconds=max_age_seconds)
    track = build_track(records, matched, warnings)
    result = track.model_dump(mode="json")
    atomic_json(Path(output_path), result)
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Parse local drone telemetry without fabricating missing positions.")
    parser.add_argument("--frames-manifest", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    source = parser.add_mutually_exclusive_group()
    source.add_argument("--srt", type=Path, help="DJI SRT subtitle track")
    source.add_argument("--ass", type=Path, help="Autel ASS subtitle track")
    source.add_argument("--exif", type=Path, help="File with EXIF/XMP GPS metadata; file-level only")
    parser.add_argument("--max-age-seconds", type=float, default=0.25)
    args = parser.parse_args(argv)
    try:
        result = run_telemetry(
            frames_manifest=args.frames_manifest,
            output_path=args.output,
            srt_path=args.srt,
            ass_path=args.ass,
            exif_path=args.exif,
            max_age_seconds=args.max_age_seconds,
        )
    except (OSError, ValueError, RuntimeError, json.JSONDecodeError) as exc:
        print(f"ERROR: telemetry ingestion failed: {exc}", file=sys.stderr)
        return 2
    print(json.dumps({
        "status": result["status"],
        "source": result["source"],
        "records": len(result["records"]),
        "matched_frames": sum(1 for frame in result["matched_frames"] if frame["matched"]),
        "output": str(args.output),
        "warnings": result["warnings"],
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
