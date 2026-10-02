"""Versioned scene safety labels. Metadata is evidence, never an accuracy certificate."""

from enum import StrEnum
from pathlib import PurePosixPath
import math
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

Identifier = Annotated[str, Field(pattern=r"^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$")]
Digest = Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")]


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False, validate_assignment=True)


class ReconstructionMode(StrEnum):
    PREVIEW = "preview_monocular"
    MVS = "sfm_mvs"
    GAUSSIAN = "gaussian_splat"


class Scale(Contract):
    status: Literal["unknown", "estimated", "validated"] = "unknown"
    metres_per_unit: Annotated[float, Field(gt=0)] | None = None
    method: Literal["telemetry", "known_length", "altitude_prior"] | None = None
    evidence: Annotated[str, Field(min_length=1, max_length=500)] | None = None

    @model_validator(mode="after")
    def check_evidence(self):
        if self.status != "unknown" and (
            self.metres_per_unit is None or self.method is None or not self.evidence
        ):
            raise ValueError("Scale estimates require a positive factor, method, and evidence.")
        return self


class Georeference(Contract):
    status: Literal["unanchored", "anchored"] = "unanchored"
    horizontal_crs_epsg: Annotated[int, Field(gt=0)] | None = None
    vertical_datum: Annotated[str, Field(min_length=1, max_length=120)] | None = None
    origin_latlon_alt: tuple[float, float, float | None] | None = None
    anchor_method: Literal["telemetry", "known_world_references"] | None = None
    residual_rmse_m: Annotated[float, Field(ge=0)] | None = None
    # Maps reconstruction coordinates to the centred site-metric frame, NOT lat/lon.
    reconstruction_to_site: list[list[float]] | None = None

    @field_validator("origin_latlon_alt")
    @classmethod
    def valid_origin(cls, value):
        if value is not None:
            lat, lon, _ = value
            if not -90 <= lat <= 90 or not -180 <= lon <= 180:
                raise ValueError("Latitude/longitude are outside their valid ranges.")
        return value

    @field_validator("reconstruction_to_site")
    @classmethod
    def valid_transform(cls, value):
        if value is None:
            return value
        if len(value) != 4 or any(len(row) != 4 for row in value):
            raise ValueError("The reconstruction-to-site transform must be 4 by 4.")
        if any(not math.isfinite(x) for row in value for x in row):
            raise ValueError("Transform entries must be finite.")
        if any(abs(a - b) > 1e-8 for a, b in zip(value[3], [0, 0, 0, 1])):
            raise ValueError("The transform must be affine with last row [0, 0, 0, 1].")
        columns = [[value[r][c] for r in range(3)] for c in range(3)]
        lengths = [math.sqrt(sum(x * x for x in col)) for col in columns]
        if min(lengths) <= 0 or max(lengths) - min(lengths) > max(lengths) * 1e-6:
            raise ValueError("The transform must have positive uniform scale.")
        for i in range(3):
            for j in range(i + 1, 3):
                if abs(sum(a * b for a, b in zip(columns[i], columns[j]))) > lengths[i] * lengths[j] * 1e-6:
                    raise ValueError("A similarity transform cannot contain shear.")
        a, b, c = (row[:3] for row in value[:3])
        determinant = (a[0] * (b[1] * c[2] - b[2] * c[1])
                       - a[1] * (b[0] * c[2] - b[2] * c[0])
                       + a[2] * (b[0] * c[1] - b[1] * c[0]))
        if determinant <= 0:
            raise ValueError("The transform must preserve handedness.")
        return value

    @model_validator(mode="after")
    def anchored_requires_evidence(self):
        if self.status == "anchored" and any(value is None for value in (
            self.horizontal_crs_epsg, self.origin_latlon_alt, self.anchor_method,
            self.residual_rmse_m, self.reconstruction_to_site,
        )):
            raise ValueError("Anchoring requires CRS, origin, method, residual, and transform.")
        return self


class Quality(Contract):
    status: Literal["unassessed", "passed", "failed"] = "unassessed"
    profile: Annotated[str, Field(min_length=1, max_length=120)] | None = None
    report_sha256: Digest | None = None
    independent_accuracy: Literal["unassessed", "assessed"] = "unassessed"
    relative_accuracy_m: Annotated[float, Field(ge=0)] | None = None
    horizontal_accuracy_m: Annotated[float, Field(ge=0)] | None = None
    vertical_accuracy_m: Annotated[float, Field(ge=0)] | None = None
    gsd_cm_per_px: Annotated[float, Field(gt=0)] | None = None
    warnings: list[Annotated[str, Field(max_length=500)]] = Field(default_factory=list, max_length=100)

    @model_validator(mode="after")
    def assessed_requires_report(self):
        if self.status != "unassessed" and (not self.profile or not self.report_sha256):
            raise ValueError("A quality decision requires its profile and report digest.")
        accuracies = (self.relative_accuracy_m, self.horizontal_accuracy_m, self.vertical_accuracy_m)
        if self.independent_accuracy == "unassessed" and any(x is not None for x in accuracies):
            raise ValueError("Do not claim numeric accuracy without independent assessment.")
        if self.independent_accuracy == "assessed" and (
            not self.report_sha256 or all(x is None for x in accuracies)
        ):
            raise ValueError("Independent assessment requires a report and measured accuracy.")
        return self


class Artifact(Contract):
    path: str
    sha256: Digest
    size_bytes: Annotated[int, Field(gt=0)]
    media_type: Annotated[str, Field(min_length=1, max_length=120)]

    @field_validator("path")
    @classmethod
    def relative_asset(cls, value):
        path = PurePosixPath(value)
        if (not value or path.is_absolute() or "\\" in value or ":" in value
                or any(part in {"", ".", ".."} for part in value.split("/"))):
            raise ValueError("Artifact paths must be safe, relative POSIX paths.")
        return value


class SceneManifest(Contract):
    schema_version: Literal[1] = 1
    scene_id: Identifier
    revision: Annotated[int, Field(ge=1)] = 1
    reconstruction_mode: ReconstructionMode
    state: Literal["draft", "ready"] = "draft"
    execution_policy: Literal["local_only"] = "local_only"
    pose_revision: Digest | None = None
    scale: Scale = Field(default_factory=Scale)
    georeference: Georeference = Field(default_factory=Georeference)
    quality: Quality = Field(default_factory=Quality)
    artifacts: dict[Identifier, Artifact] = Field(default_factory=dict)
    # Future DB publication must bind the reconstructed scene to its geometry snapshot.
    geometry_revision: Digest | None = None

    @model_validator(mode="after")
    def ready_requires_artifacts(self):
        if self.state == "ready" and not self.artifacts:
            raise ValueError("A ready scene requires actual artifacts.")
        if self.georeference.status == "anchored" and self.scale.status == "unknown":
            raise ValueError("An anchored scene must have scale evidence.")
        return self

    def capabilities(self) -> dict[str, bool]:
        geometric = self.reconstruction_mode in {ReconstructionMode.MVS, ReconstructionMode.GAUSSIAN}
        checked = (self.state == "ready" and geometric and self.pose_revision is not None
                   and self.scale.status == "validated" and self.quality.status == "passed")
        # I-3 requires georeferencing for the Gaussian measurement path.
        if self.reconstruction_mode == ReconstructionMode.GAUSSIAN:
            checked = checked and self.georeference.status == "anchored"
        return {
            "measure_metres": bool(checked),
            "edit_metres": bool(checked and self.geometry_revision),
            "query_metrics": bool(checked and self.geometry_revision),
            "export_geographic": bool(checked and self.georeference.status == "anchored"),
        }
