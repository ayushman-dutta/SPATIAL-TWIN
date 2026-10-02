"""Focused tests for local process leases and bounded stage execution."""
from __future__ import annotations

import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import textwrap
import time

import pytest

from pipeline.common.runtime import (
    ResourceBusyError,
    StageExecutionError,
    resource_lease,
    run_stage,
)


REPO_ROOT = Path(__file__).resolve().parents[2]


def _child_env() -> dict[str, str]:
    env = os.environ.copy()
    env["PYTHONPATH"] = os.pathsep.join(
        [str(REPO_ROOT), env.get("PYTHONPATH", "")]
    ).rstrip(os.pathsep)
    return env


def _lock_child(root: Path, name: str, ready_file: Path, mode: str) -> subprocess.Popen:
    code = textwrap.dedent(
        """
        import pathlib, sys, time
        from pipeline.common.runtime import resource_lease
        root, name, ready, mode = map(str, sys.argv[1:])
        try:
            with resource_lease(pathlib.Path(root), name):
                pathlib.Path(ready).write_text("held", encoding="utf-8")
                if mode == "hold":
                    time.sleep(60)
                else:
                    print("acquired", flush=True)
        except Exception as exc:
            print(type(exc).__name__, flush=True)
            raise SystemExit(3)
        """
    )
    return subprocess.Popen(
        [sys.executable, "-c", code, str(root), name, str(ready_file), mode],
        env=_child_env(), stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
    )


def _wait_for_file(path: Path, timeout: float = 5.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if path.exists():
            return
        time.sleep(0.02)
    raise AssertionError(f"Timed out waiting for {path}")


def _stop(process: subprocess.Popen) -> None:
    if process.poll() is None:
        if os.name == "nt":
            process.kill()
        else:
            os.kill(process.pid, signal.SIGTERM)
    process.wait(timeout=5)


def test_resource_lease_is_exclusive_across_processes_and_releases(tmp_path: Path) -> None:
    ready = tmp_path / "held"
    process = _lock_child(tmp_path, "gpu", ready, "hold")
    try:
        _wait_for_file(ready)
        with pytest.raises(ResourceBusyError):
            with resource_lease(tmp_path, "gpu"):
                pass

        second_ready = tmp_path / "second"
        second = _lock_child(tmp_path, "gpu", second_ready, "once")
        stdout, _ = second.communicate(timeout=5)
        assert second.returncode == 3
        assert "ResourceBusyError" in stdout
    finally:
        _stop(process)

    # The OS releases a flock when the owner terminates; no lock-file deletion is needed.
    with resource_lease(tmp_path, "gpu"):
        pass
    assert (tmp_path / ".locks" / "gpu.lock").is_file()


def test_resource_lease_rejects_unsafe_names(tmp_path: Path) -> None:
    for name in ("", "../gpu", "GPU", "gpu.lock", "con", "a" * 65):
        with pytest.raises(ValueError):
            with resource_lease(tmp_path, name):
                pass


def test_run_stage_captures_logs_and_keeps_command_private(tmp_path: Path) -> None:
    result = run_stage(
        [sys.executable, "-c", "print('hello stage'); print('secret?', file=__import__('sys').stderr)"],
        tmp_path, "small_stage", 5,
    )
    assert result["status"] == "succeeded"
    assert result["returncode"] == 0
    assert result["command"]["arguments_recorded"] is False
    assert "secret?" not in json.dumps(result)
    assert Path(result["stdout_log"]).read_text(encoding="utf-8").strip() == "hello stage"
    assert Path(result["stderr_log"]).read_text(encoding="utf-8").strip() == "secret?"
    json.dumps(result)  # the public result must be JSON serializable


def test_run_stage_failure_carries_result_and_timeout_kills_descendant(tmp_path: Path) -> None:
    with pytest.raises(StageExecutionError) as failure:
        run_stage([sys.executable, "-c", "raise SystemExit(7)"], tmp_path, "bad_stage", 5)
    assert failure.value.result["status"] == "failed"
    assert failure.value.result["returncode"] == 7

    marker = tmp_path / "child-survived"
    code = textwrap.dedent(
        f"""
        import subprocess, sys, time
        subprocess.Popen([sys.executable, '-c',
            "import pathlib,time; time.sleep(0.3); pathlib.Path({str(marker)!r}).write_text('bad')"])
        time.sleep(60)
        """
    )
    started = time.monotonic()
    with pytest.raises(StageExecutionError) as timeout:
        run_stage([sys.executable, "-c", code], tmp_path, "timeout_stage", 0.2)
    assert timeout.value.result["status"] == "timed_out"
    assert timeout.value.result["timed_out"] is True
    assert time.monotonic() - started < 5
    time.sleep(0.5)
    assert not marker.exists(), "a descendant survived stage timeout"


def test_run_stage_validates_input_before_creating_logs(tmp_path: Path) -> None:
    with pytest.raises(ValueError):
        run_stage([], tmp_path, "stage", 1)
    with pytest.raises(ValueError):
        run_stage([sys.executable], tmp_path, "stage", 0)
    with pytest.raises(ValueError):
        run_stage([sys.executable], tmp_path, "../stage", 1)
    assert not (tmp_path / "logs").exists()
