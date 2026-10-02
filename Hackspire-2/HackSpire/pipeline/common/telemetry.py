"""Explicit, fixture-driven drone telemetry parsing and frame matching.

Telemetry is evidence for camera priors, not a replacement for SfM. Unknown values
remain unknown; this module never invents a moving-camera track.
"""
from __future__ import annotations

from datetime import datetime, timezone
import json
import math
from pathlib import Path
import re
import shutil
import subprocess
from typing import Any, Iterable, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class TelemetryRecord(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    timestamp_seconds: float = Field(ge=0)
    source: Literal["dji_srt", "autel_ass", "exif_xmp"]
    latitude_deg: float | None = None
    longitude_deg: float | None = None
    altitude_m: float | None = None
    altitude_reference: str | None = None
    gimbal_yaw_deg: float | None = None
    gimbal_pitch_deg: float | None = None
    gimbal_roll_deg: float | None = None
    raw_text: str = ""

    @field_validator("latitude_deg")
    @classmethod
    def valid_latitude(cls, value):
        if value is not None and not -90 <= value <= 90:
            raise ValueError("Telemetry latitude is outside [-90, 90].")
        return value

    @field_validator("longitude_deg")
    @classmethod
    def valid_longitude(cls, value):
        if value is not None and not -180 <= value <= 180:
            raise ValueError("Telemetry longitude is outside [-180, 180].")
        return value

    @field_validator("altitude_m", "gimbal_yaw_deg", "gimbal_pitch_deg", "gimbal_roll_deg")
    @classmethod
    def finite_values(cls, value):
        if value is not None and not math.isfinite(value):
            raise ValueError("Telemetry numeric values must be finite.")
        return value


class FrameTelemetry(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    frame_index: int = Field(ge=0)
    timestamp_seconds: float = Field(ge=0)
    matched: bool
    telemetry_index: int | None = None
    age_seconds: float | None = Field(default=None, ge=0)
    latitude_deg: float | None = None
    longitude_deg: float | None = None
    altitude_m: float | None = None
    altitude_reference: str | None = None
    gimbal_yaw_deg: float | None = None
    gimbal_pitch_deg: float | None = None
    gimbal_roll_deg: float | None = None


class TelemetryTrack(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: Literal[1] = 1
    status: Literal["anchored_candidate", "unanchored"]
    source: Literal["dji_srt", "autel_ass", "exif_xmp", "none"]
    parser_version: str = "phase-b-1"
    records: list[TelemetryRecord] = Field(default_factory=list)
    matched_frames: list[FrameTelemetry] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    generated_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


def _number(value: str) -> float | None:
    try:
        parsed = float(value.strip())
    except (TypeError, ValueError):
        return None
    return parsed if math.isfinite(parsed) else None


def _first_number(text: str, patterns: Iterable[str]) -> float | None:
    for pattern in patterns:
        match = re.search(pattern, text, flags=re.IGNORECASE)
        if match:
            value = _number(match.group(1))
            if value is not None:
                return value
    return None


def _extract_values(text: str, source: Literal["dji_srt", "autel_ass"]) -> dict[str, Any]:
    latitude = _first_number(text, (r"\blat(?:itude)?\s*[:=]\s*([-+]?\d+(?:\.\d+)?)",))
    longitude = _first_number(text, (r"\blon(?:gitude)?\s*[:=]\s*([-+]?\d+(?:\.\d+)?)",))
    altitude = _first_number(text, (
        r"\b(?:relative[_ ]?alt(?:itude)?|rel[_ ]?alt)\s*[:=]\s*([-+]?\d+(?:\.\d+)?)",
        r"\b(?:absolute[_ ]?alt(?:itude)?|abs[_ ]?alt|altitude|alt)\s*[:=]\s*([-+]?\d+(?:\.\d+)?)",
    ))
    altitude_reference = None
    if re.search(r"relative[_ ]?alt|rel[_ ]?alt", text, re.IGNORECASE):
        altitude_reference = "relative_to_takeoff_or_device"
    elif re.search(r"absolute[_ ]?alt|abs[_ ]?alt", text, re.IGNORECASE):
        altitude_reference = "vendor_absolute_reference_unknown"

    yaw = _first_number(text, (
        r"\b(?:gimbal[_ ]?)?(?:yaw|heading)[^:=]*[:=]\s*([-+]?\d+(?:\.\d+)?)",
        r"\bgb[_ ]?yaw\s*[:=]\s*([-+]?\d+(?:\.\d+)?)",
    ))
    pitch = _first_number(text, (
        r"\b(?:gimbal[_ ]?)?pitch[^:=]*[:=]\s*([-+]?\d+(?:\.\d+)?)",
        r"\bgb[_ ]?pitch\s*[:=]\s*([-+]?\d+(?:\.\d+)?)",
    ))
    roll = _first_number(text, (
        r"\b(?:gimbal[_ ]?)?roll[^:=]*[:=]\s*([-+]?\d+(?:\.\d+)?)",
        r"\bgb[_ ]?roll\s*[:=]\s*([-+]?\d+(?:\.\d+)?)",
    ))

    # Some DJI exports use "GPS (lat, lon, alt)" rather than named fields.
    if latitude is None or longitude is None:
        gps = re.search(
            r"GPS\s*\(\s*([-+]?\d+(?:\.\d+)?)\s*,\s*([-+]?\d+(?:\.\d+)?)"
            r"(?:\s*,\s*([-+]?\d+(?:\.\d+)?))?\s*\)", text, re.IGNORECASE,
        )
        if gps:
            latitude = latitude if latitude is not None else _number(gps.group(1))
            longitude = longitude if longitude is not None else _number(gps.group(2))
            if altitude is None and gps.group(3):
                altitude = _number(gps.group(3))
                altitude_reference = "vendor_reference_unknown"

    return {
        "latitude_deg": latitude,
        "longitude_deg": longitude,
        "altitude_m": altitude,
        "altitude_reference": altitude_reference,
        "gimbal_yaw_deg": yaw,
        "gimbal_pitch_deg": pitch,
        "gimbal_roll_deg": roll,
    }


def _srt_seconds(value: str) -> float:
    match = re.fullmatch(r"(\d+):(\d{2}):(\d{2})[,.](\d{3})", value.strip())
    if not match:
        raise ValueError(f"Invalid SRT timestamp: {value}")
    hours, minutes, seconds, milliseconds = (int(item) for item in match.groups())
    return hours * 3600 + minutes * 60 + seconds + milliseconds / 1000


def _ass_seconds(value: str) -> float:
    match = re.fullmatch(r"(\d+):(\d{2}):(\d{2})[.](\d{2})", value.strip())
    if not match:
        raise ValueError(f"Invalid ASS timestamp: {value}")
    hours, minutes, seconds, centiseconds = (int(item) for item in match.groups())
    return hours * 3600 + minutes * 60 + seconds + centiseconds / 100


def parse_dji_srt(path: str | Path) -> list[TelemetryRecord]:
    """Parse DJI SRT cues; unsupported/missing fields stay None."""
    source = Path(path)
    text = source.read_text(encoding="utf-8-sig", errors="replace")
    blocks = re.split(r"\n\s*\n", text.replace("\r\n", "\n"))
    records: list[TelemetryRecord] = []
    for block in blocks:
        timing = re.search(r"(?m)^\s*(\d{2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,.]\d{3})", block)
        if not timing:
            continue
        start = _srt_seconds(timing.group(1))
        values = _extract_values(block, "dji_srt")
        if any(values[key] is not None for key in ("latitude_deg", "longitude_deg", "altitude_m", "gimbal_yaw_deg", "gimbal_pitch_deg", "gimbal_roll_deg")):
            records.append(TelemetryRecord(timestamp_seconds=start, source="dji_srt", raw_text=block.strip(), **values))
    return records


def parse_autel_ass(path: str | Path) -> list[TelemetryRecord]:
    """Parse ASS/SSA Dialogue cues with timing-preserving record boundaries."""
    source = Path(path)
    records: list[TelemetryRecord] = []
    for line in source.read_text(encoding="utf-8-sig", errors="replace").replace("\r\n", "\n").splitlines():
        if not line.startswith("Dialogue:"):
            continue
        fields = line.split(",", 9)
        if len(fields) != 10:
            continue
        try:
            timestamp = _ass_seconds(fields[1])
        except ValueError:
            continue
        body = fields[9]
        values = _extract_values(body, "autel_ass")
        if any(values[key] is not None for key in ("latitude_deg", "longitude_deg", "altitude_m", "gimbal_yaw_deg", "gimbal_pitch_deg", "gimbal_roll_deg")):
            records.append(TelemetryRecord(timestamp_seconds=timestamp, source="autel_ass", raw_text=body, **values))
    return records


def parse_exif_xmp(path: str | Path, executable: str = "exiftool") -> list[TelemetryRecord]:
    """Read one file-level GPS record through optional ExifTool; never invent per-frame data."""
    tool = shutil.which(executable)
    if tool is None:
        raise FileNotFoundError("ExifTool is not installed; EXIF/XMP telemetry is unavailable.")
    completed = subprocess.run(
        [tool, "-j", "-n", "-GPSLatitude", "-GPSLongitude", "-GPSAltitude", str(path)],
        check=False, capture_output=True, text=True, timeout=10,
    )
    if completed.returncode != 0:
        raise RuntimeError("ExifTool could not read the requested EXIF/XMP metadata.")
    payload = json.loads(completed.stdout or "[]")
    if not payload or not isinstance(payload[0], dict):
        return []
    item = payload[0]
    lat = _number(str(item.get("GPSLatitude", "")))
    lon = _number(str(item.get("GPSLongitude", "")))
    alt = _number(str(item.get("GPSAltitude", "")))
    if lat is None and lon is None and alt is None:
        return []
    return [TelemetryRecord(
        timestamp_seconds=0.0, source="exif_xmp", latitude_deg=lat, longitude_deg=lon,
        altitude_m=alt, altitude_reference="EXIF reference unspecified", raw_text=json.dumps(item, sort_keys=True),
    )]


def match_telemetry(
    frame_records: Iterable[dict[str, Any]],
    telemetry: list[TelemetryRecord],
    max_age_seconds: float = 0.25,
) -> list[FrameTelemetry]:
    """Nearest timestamp association; no interpolation or extrapolation is performed."""
    if max_age_seconds < 0 or not math.isfinite(max_age_seconds):
        raise ValueError("max_age_seconds must be finite and non-negative.")
    ordered = sorted(telemetry, key=lambda item: item.timestamp_seconds)
    matched: list[FrameTelemetry] = []
    for frame in frame_records:
        index = int(frame["frame_index"])
        timestamp = float(frame["timestamp_seconds"])
        if not ordered:
            matched.append(FrameTelemetry(frame_index=index, timestamp_seconds=timestamp, matched=False))
            continue
        nearest_index = min(range(len(ordered)), key=lambda i: abs(ordered[i].timestamp_seconds - timestamp))
        record = ordered[nearest_index]
        age = abs(record.timestamp_seconds - timestamp)
        if age > max_age_seconds:
            matched.append(FrameTelemetry(frame_index=index, timestamp_seconds=timestamp, matched=False, age_seconds=age))
            continue
        matched.append(FrameTelemetry(
            frame_index=index, timestamp_seconds=timestamp, matched=True,
            telemetry_index=nearest_index, age_seconds=age,
            latitude_deg=record.latitude_deg, longitude_deg=record.longitude_deg,
            altitude_m=record.altitude_m, altitude_reference=record.altitude_reference,
            gimbal_yaw_deg=record.gimbal_yaw_deg, gimbal_pitch_deg=record.gimbal_pitch_deg,
            gimbal_roll_deg=record.gimbal_roll_deg,
        ))
    return matched


def build_track(records: list[TelemetryRecord], matched: list[FrameTelemetry], warnings: list[str] | None = None) -> TelemetryTrack:
    has_position = sum(record.latitude_deg is not None and record.longitude_deg is not None for record in records)
    status = "anchored_candidate" if has_position >= 3 else "unanchored"
    track_warnings = list(warnings or [])
    if not records:
        track_warnings.append("No supported telemetry records were found; the scene remains unanchored.")
    if records and has_position < 3:
        track_warnings.append("Fewer than three records have latitude and longitude; georeferencing is underconstrained.")
    return TelemetryTrack(
        status=status, source=records[0].source if records else "none",
        records=records, matched_frames=matched, warnings=track_warnings,
    )
