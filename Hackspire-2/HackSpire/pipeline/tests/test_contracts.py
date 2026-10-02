import pytest
from pydantic import ValidationError

from pipeline.common.contracts import (
    Artifact,
    ReconstructionMode,
    SceneManifest,
)


def test_draft_scene_is_not_metric_capable():
    scene = SceneManifest(scene_id="phase-a", reconstruction_mode=ReconstructionMode.MVS)
    assert scene.state == "draft"
    assert not any(scene.capabilities().values())


def test_ready_scene_requires_real_artifacts():
    with pytest.raises(ValidationError, match="actual artifacts"):
        SceneManifest(
            scene_id="phase-a",
            reconstruction_mode=ReconstructionMode.MVS,
            state="ready",
        )


def test_artifact_paths_cannot_escape_scene_root():
    with pytest.raises(ValidationError, match="safe"):
        Artifact(path="../scene.glb", sha256="0" * 64, size_bytes=1, media_type="model/gltf-binary")


def test_invalid_artifact_digest_is_rejected():
    with pytest.raises(ValidationError):
        Artifact(path="mesh.glb", sha256="not-a-sha", size_bytes=1, media_type="model/gltf-binary")
