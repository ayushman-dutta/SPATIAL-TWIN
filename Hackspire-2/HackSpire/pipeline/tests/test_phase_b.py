import json
from pathlib import Path

import pytest

from pipeline.common.telemetry import (
    build_track,
    match_telemetry,
    parse_autel_ass,
    parse_dji_srt,
)
from pipeline.video_processor import extract_dense_frames, extract_keyframes_from_video


DJI_SRT = """1
00:00:00,000 --> 00:00:00,033
[latitude: 37.1000] [longitude: -122.1000] [rel_alt: 10.0] [gb_yaw: 2.0]

2
00:00:01,000 --> 00:00:01,033
[latitude: 37.1001] [longitude: -122.1001] [rel_alt: 10.2] [gb_yaw: 2.5]

3
00:00:02,000 --> 00:00:02,033
[latitude: 37.1002] [longitude: -122.1002] [rel_alt: 10.4] [gb_yaw: 3.0]
"""


ASS = """[Events]
Dialogue: 0,0:00:00.00,0:00:00.03,Default,,0,0,0,,GPS (37.1, -122.1, 10) yaw: 2
"""


def test_dji_srt_preserves_timestamps_and_gimbal_values(tmp_path: Path):
    path = tmp_path / "flight.srt"
    path.write_text(DJI_SRT, encoding="utf-8")
    records = parse_dji_srt(path)
    assert [record.timestamp_seconds for record in records] == [0.0, 1.0, 2.0]
    assert records[0].latitude_deg == pytest.approx(37.1)
    assert records[0].gimbal_yaw_deg == pytest.approx(2.0)
    assert records[0].altitude_reference == "relative_to_takeoff_or_device"


def test_autel_ass_parses_gps_text(tmp_path: Path):
    path = tmp_path / "flight.ass"
    path.write_text(ASS, encoding="utf-8")
    records = parse_autel_ass(path)
    assert len(records) == 1
    assert records[0].longitude_deg == pytest.approx(-122.1)
    assert records[0].altitude_m == pytest.approx(10.0)


def test_timestamp_matching_does_not_extrapolate():
    records = parse_dji_srt_from_text(DJI_SRT, "dji_srt")
    frames = [
        {"frame_index": 0, "timestamp_seconds": 0.02},
        {"frame_index": 1, "timestamp_seconds": 3.0},
    ]
    matched = match_telemetry(frames, records, max_age_seconds=0.25)
    assert matched[0].matched is True
    assert matched[0].telemetry_index == 0
    assert matched[1].matched is False
    assert build_track(records, matched).status == "anchored_candidate"


def parse_dji_srt_from_text(text: str, source: str):
    # Keep the fixture test file-based while avoiding a private parser API.
    import tempfile
    from pipeline.common.telemetry import parse_dji_srt
    with tempfile.NamedTemporaryFile("w", suffix=".srt", encoding="utf-8", delete=False) as handle:
        handle.write(text)
        name = handle.name
    try:
        return parse_dji_srt(name)
    finally:
        Path(name).unlink(missing_ok=True)


def test_dense_frames_keep_pts_as_source_of_time(tmp_path: Path):
    manifest = extract_dense_frames(
        Path("output/test_sample.mp4"),
        tmp_path / "frames",
        max_dimension=160,
        min_sharpness=0,
        duplicate_delta=0.0001,
    )
    assert manifest["decoded_frames"] >= manifest["accepted_frames"] > 1
    assert manifest["timestamp_fallbacks"] == 0
    assert manifest["rejected_duplicate"] > 0
    assert all(frame["timestamp_source"] == "pts" for frame in manifest["frames"])
    assert all((tmp_path / "frames" / frame["path"]).is_file() for frame in manifest["frames"] if frame["accepted"])
    json.loads((tmp_path / "frames" / "frames.json").read_text(encoding="utf-8"))


def test_dense_frames_rejects_invalid_duplicate_delta(tmp_path: Path):
    with pytest.raises(ValueError, match="duplicate_delta"):
        extract_dense_frames(Path("output/test_sample.mp4"), tmp_path, duplicate_delta=2)


def test_legacy_extractor_does_not_fabricate_frames_for_bad_video(tmp_path: Path):
    source = tmp_path / "bad.mp4"
    source.write_bytes(b"not a video")
    with pytest.raises(ValueError, match="Synthetic frames"):
        extract_keyframes_from_video(source, tmp_path / "frames")
    assert not list((tmp_path / "frames").glob("frame_*.jpg"))
