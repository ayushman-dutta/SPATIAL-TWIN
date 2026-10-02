"""Isolated, restart-readable local jobs. Staging input is NOT reconstruction."""

from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import uuid
from typing import Literal

from pydantic import Field, field_validator

from pipeline.common.contracts import Contract, Digest, ReconstructionMode, SceneManifest

VIDEO_EXTENSIONS = {".mp4", ".mov", ".avi", ".mkv"}


def atomic_json(path: Path, value: dict) -> None:
    """Replace a complete record, never expose a partially written JSON file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        with temporary.open("x", encoding="utf-8") as handle:
            json.dump(value, handle, indent=2, allow_nan=False)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def file_digest(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def clean_video_name(filename: str) -> str:
    if not filename or "\x00" in filename or len(filename) > 255:
        raise ValueError("Please provide a valid video filename.")
    # A display name only; client filenames never determine directories.
    name = filename.replace("\\", "/").split("/")[-1]
    if not name or Path(name).suffix.lower() not in VIDEO_EXTENSIONS:
        raise ValueError("Unsupported file format. Please upload MP4, MOV, AVI, or MKV footage.")
    return name


class JobRecord(Contract):
    schema_version: Literal[1] = 1
    job_id: str
    reconstruction_mode: ReconstructionMode
    execution_policy: Literal["local_only"] = "local_only"
    status: Literal["receiving", "staged", "failed"] = "receiving"
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    source_name: str
    source_sha256: Digest | None = None
    source_bytes: int = Field(default=0, ge=0)
    width: int | None = Field(default=None, gt=0)
    height: int | None = Field(default=None, gt=0)
    error: str | None = None
    message: str = "Receiving local input. No reconstruction has started."

    @field_validator("job_id")
    @classmethod
    def valid_id(cls, value):
        if len(value) != 32 or any(c not in "0123456789abcdef" for c in value):
            raise ValueError("Invalid local job identifier.")
        return value


class JobStore:
    def __init__(self, root: Path):
        self.root = Path(root).resolve()

    def directory(self, job_id: str) -> Path:
        JobRecord.valid_id(job_id)
        directory = self.root / job_id
        if directory.resolve().parent != self.root or directory.is_symlink():
            raise ValueError("The job directory must stay inside the local workspace.")
        return directory

    def create(self, filename: str, mode: ReconstructionMode) -> JobRecord:
        name = clean_video_name(filename)
        record = JobRecord(job_id=uuid.uuid4().hex, reconstruction_mode=mode, source_name=name)
        directory = self.directory(record.job_id)
        directory.mkdir(parents=True, exist_ok=False)
        self.save(record)
        scene = SceneManifest(scene_id=record.job_id, reconstruction_mode=mode)
        atomic_json(directory / "scene.json", scene.model_dump(mode="json"))
        return record

    def save(self, record: JobRecord) -> None:
        record.updated_at = datetime.now(timezone.utc)
        atomic_json(self.directory(record.job_id) / "job.json", record.model_dump(mode="json"))

    def load(self, job_id: str) -> JobRecord:
        record = JobRecord.model_validate_json((self.directory(job_id) / "job.json").read_text(encoding="utf-8"))
        if record.job_id != job_id:
            raise ValueError("Job record identity mismatch.")
        return record

    def source_path(self, record: JobRecord) -> Path:
        return self.directory(record.job_id) / ("source" + Path(record.source_name).suffix.lower())

    def finish(self, record: JobRecord, part: Path) -> JobRecord:
        """Decode a frame to reject disguised/corrupt media; dense extraction is Phase B."""
        import av

        try:
            with av.open(str(part)) as container:
                stream = next((s for s in container.streams if s.type == "video"), None)
                if stream is None:
                    raise ValueError("No video stream found.")
                frame = next(container.decode(stream), None)
                if frame is None:
                    raise ValueError("No decodable video frame found.")
                record.width, record.height = frame.width, frame.height
        except Exception as exc:
            raise ValueError("The file is not a decodable video. Please supply the original recording.") from exc
        record.source_bytes = part.stat().st_size
        record.source_sha256 = file_digest(part)
        os.replace(part, self.source_path(record))
        record.status = "staged"
        record.message = (
            "Video validated and staged locally. Phase A does not reconstruct a model; "
            "frame processing and COLMAP stages require the next approved phases. "
            "The published scene is unchanged."
        )
        self.save(record)
        return record

    def fail(self, record: JobRecord, message: str) -> None:
        record.status = "failed"
        record.error = message
        record.message = "Input staging failed. The published scene is unchanged."
        (self.directory(record.job_id) / "source.part").unlink(missing_ok=True)
        self.save(record)

    def stage_file(self, source: Path, mode: ReconstructionMode, max_bytes: int) -> JobRecord:
        source = Path(source)
        name = clean_video_name(source.name)
        if max_bytes <= 0 or not source.is_file() or source.stat().st_size == 0:
            raise ValueError("Please provide a non-empty local video and a positive upload limit.")
        if source.stat().st_size > max_bytes:
            raise ValueError("Video exceeds the configured local input size limit.")
        record = self.create(name, mode)
        part = self.directory(record.job_id) / "source.part"
        try:
            total = 0
            with source.open("rb") as incoming, part.open("xb") as output:
                for chunk in iter(lambda: incoming.read(1024 * 1024), b""):
                    total += len(chunk)
                    if total > max_bytes:
                        raise ValueError("Video exceeds the configured local input size limit.")
                    output.write(chunk)
            return self.finish(record, part)
        except BaseException:
            self.fail(record, "Could not validate and stage the input video.")
            raise
