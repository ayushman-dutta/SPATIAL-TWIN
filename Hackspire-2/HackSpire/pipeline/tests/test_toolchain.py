"""Read-only, fake-tool tests for preflight capability reporting."""
from __future__ import annotations

import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import textwrap

import pytest

from pipeline.common import toolchain
from pipeline.common.toolchain import inspect_toolchain


@pytest.mark.skipif(os.name == "nt", reason="The fake native executable uses a POSIX shebang.")
def test_preflight_reports_exact_fake_colmap_version_commands_and_flags(tmp_path: Path) -> None:
    fake = tmp_path / "colmap"
    commands = (
        "feature_extractor sequential_matcher mapper bundle_adjuster model_converter "
        "image_undistorter patch_match_stereo stereo_fusion"
    )
    fake.write_text(
        textwrap.dedent(
            f"""\
            #!/bin/sh
            if [ "$1" = "--version" ]; then echo 'COLMAP 9.8.7-fake'; exit 0; fi
            if [ "$1" = "-h" ]; then
              echo 'COLMAP 9.8.7-fake'
              for command in {commands}; do echo "  $command  command help"; done
              exit 0
            fi
            case "$1" in
              feature_extractor) echo 'Usage: feature_extractor --database_path PATH --image_path PATH';;
              sequential_matcher) echo 'Usage: sequential_matcher --database_path PATH --SequentialMatching.overlap N';;
              mapper) echo 'Usage: mapper --database_path PATH --image_path PATH --output_path PATH';;
              bundle_adjuster) echo 'Usage: bundle_adjuster --input_path PATH --output_path PATH';;
              model_converter) echo 'Usage: model_converter --input_path PATH --output_path PATH --output_type TYPE';;
              image_undistorter) echo 'Usage: image_undistorter --image_path PATH --input_path PATH --output_path PATH';;
              patch_match_stereo) echo 'Usage: patch_match_stereo --workspace_path PATH --PatchMatchStereo.geom_consistency';;
              stereo_fusion) echo 'Usage: stereo_fusion --workspace_path PATH --input_type geometric';;
              *) echo 'unknown command' >&2; exit 2;;
            esac
            exit 0
            """
        ),
        encoding="utf-8",
    )
    fake.chmod(fake.stat().st_mode | stat.S_IXUSR)

    report = inspect_toolchain(str(fake), tmp_path)
    colmap = report["colmap"]
    assert colmap["required_commands_available"] is True
    assert colmap["missing_required_commands"] == []
    assert colmap["version"] == "COLMAP 9.8.7-fake"
    assert colmap["version_probe"]["stdout"] == "COLMAP 9.8.7-fake\n"
    assert "--database_path" in colmap["commands"]["feature_extractor"]["supported_flags"]
    assert colmap["cuda_runtime_tested"] is False
    assert colmap["reconstruction_tested"] is False
    assert report["inspection_only"] is True
    json.dumps(report)


def test_preflight_keeps_failing_colmap_help_unavailable(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Simulate a native executable whose two bounded probes fail. This parser
    # boundary is cross-platform; the POSIX test above also exercises a real
    # executable and its subcommand help.
    original_probe = toolchain._probe

    def failing_probe(command: list[str]) -> dict:
        if command[-1] in ("--version", "-h"):
            return {
                "status": "failed", "returncode": 9, "stdout": "",
                "stderr": "probe failed\n", "output_truncated": False,
                "duration_seconds": 0.001, "error": "probe failed",
            }
        return original_probe(command)

    monkeypatch.setattr(toolchain, "_probe", failing_probe)
    report = inspect_toolchain(sys.executable, tmp_path)
    colmap = report["colmap"]
    assert colmap["available"] is True
    assert colmap["help_probe"]["status"] == "failed"
    assert colmap["required_commands_available"] is False
    assert set(colmap["missing_required_commands"]) == set(toolchain.REQUIRED_COMMANDS)
    assert "failed" in colmap["message"] or "unverified" in colmap["message"]


def test_preflight_reports_missing_colmap_and_no_gpu_without_fabrication(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    original_find = toolchain._find_tool
    monkeypatch.setattr(
        toolchain, "_find_tool",
        lambda executable: None if executable == "nvidia-smi" else original_find(executable),
    )
    report = inspect_toolchain(str(tmp_path / "does-not-exist"), tmp_path / "not-created")
    assert report["colmap"]["available"] is False
    assert report["colmap"]["required_commands_available"] is False
    assert report["nvidia_gpu"]["available"] is False
    assert report["nvidia_gpu"]["devices"] == []
    assert "unknown" in report["nvidia_gpu"]["message"]
    assert report["disk"]["workspace_exists"] is False
    assert not (tmp_path / "not-created").exists()
    json.dumps(report)


def test_preflight_json_cli_returns_nonzero_when_required_colmap_is_missing(
    tmp_path: Path,
) -> None:
    script = Path(__file__).resolve().parents[1] / "00_preflight.py"
    completed = subprocess.run(
        [sys.executable, str(script), "--json", "--colmap", str(tmp_path / "missing"),
         "--workspace", str(tmp_path)],
        cwd=script.parents[1], capture_output=True, text=True, check=False,
    )
    assert completed.returncode == 1
    report = json.loads(completed.stdout)
    assert report["colmap"]["required_commands_available"] is False
    assert report["inspection_only"] is True
