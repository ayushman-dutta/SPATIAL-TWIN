"""Read-only, bounded inspection of the installed local reconstruction toolchain.

This is an inventory, not a test drive: CLI help cannot prove CUDA or SfM/MVS
works. All probes are version/help or NVIDIA inventory queries, never a stage.
"""
from __future__ import annotations

import csv
import io
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import sys
import tempfile
import time

from .runtime import _managed_process, _validate_command


REQUIRED_COMMANDS = (
    "feature_extractor", "sequential_matcher", "mapper", "bundle_adjuster",
    "model_converter", "image_undistorter", "patch_match_stereo", "stereo_fusion",
)
OPTIONAL_COMMANDS = (
    "poisson_mesher", "delaunay_mesher", "pose_prior_mapper", "pose_prior_matcher",
)
OPTIONAL_CAPABILITY_COMMANDS = {
    "mesh": ("poisson_mesher", "delaunay_mesher"),
    "pose_prior": ("pose_prior_mapper", "pose_prior_matcher"),
}
PROBE_TIMEOUT_SECONDS = 5.0
MAX_PROBE_OUTPUT_BYTES = 128 * 1024
_FLAG_PATTERN = re.compile(r"(?<![\w-])--[A-Za-z][A-Za-z0-9_.-]*")


def _probe(command: list[str]) -> dict:
    """Keep exact observed stdout/stderr up to a marked cap, with bounded time.

    Temporary output handles use the OS temp directory, never the workspace.
    This avoids pipe deadlocks/unbounded RAM when a broken executable is noisy.
    """
    _validate_command(command)
    result = {"status": "unavailable", "returncode": None, "stdout": "", "stderr": "",
              "output_truncated": False, "duration_seconds": None, "error": None}
    started = time.monotonic()
    with tempfile.TemporaryFile() as stdout, tempfile.TemporaryFile() as stderr:
        process = None
        try:
            with _managed_process(command, stdout=stdout, stderr=stderr) as process:
                try:
                    process.wait(timeout=PROBE_TIMEOUT_SECONDS)
                    result["status"] = "ok" if process.returncode == 0 else "failed"
                except subprocess.TimeoutExpired:
                    result["status"] = "timed_out"
                    result["error"] = "The inspection command exceeded its time limit."
            result["returncode"] = process.returncode
        except OSError as exc:
            result["error"] = f"Cannot execute the local tool ({type(exc).__name__}, errno={exc.errno})."
            if process is not None:
                result["returncode"] = process.returncode
        for name, stream in (("stdout", stdout), ("stderr", stderr)):
            stream.seek(0)
            data = stream.read(MAX_PROBE_OUTPUT_BYTES + 1)
            result["output_truncated"] |= len(data) > MAX_PROBE_OUTPUT_BYTES
            result[name] = data[:MAX_PROBE_OUTPUT_BYTES].decode("utf-8", errors="replace")
    result["duration_seconds"] = round(time.monotonic() - started, 6)
    return result


def _text(probe: dict) -> str:
    return probe["stdout"] + "\n" + probe["stderr"]


def _find_tool(executable: str) -> str | None:
    found = shutil.which(executable)
    # Avoid implicit cmd.exe invocation of Windows launchers despite shell=False.
    if found and os.name == "nt" and Path(found).suffix.lower() in {".bat", ".cmd"}:
        return None
    return str(Path(found).absolute()) if found else None


def _inspect_colmap(executable: str | None) -> dict:
    requested = "colmap" if executable is None else executable
    found = _find_tool(requested)
    result = {
        "requested_executable": requested,
        "executable": found,
        "available": found is not None,
        "required_commands_available": False,
        "version": None,
        "version_source": None,
        "version_probe": None,
        "help_probe": None,
        "commands": {},
        "optional_capabilities": {},
        "missing_required_commands": list(REQUIRED_COMMANDS),
        "cuda_runtime_tested": False,
        "reconstruction_tested": False,
        "message": "COLMAP was not found. Install/configure a native COLMAP executable or pass --colmap PATH.",
    }
    if found is None:
        return result
    version = result["version_probe"] = _probe([found, "--version"])
    help_probe = result["help_probe"] = _probe([found, "-h"])
    # Many COLMAP builds expose their version only in the top-level help header.
    # Preserve the full exact probes, and extract only an actually observed line.
    for source, probe in (("--version", version), ("-h", help_probe)):
        if probe["status"] == "ok":
            match = re.search(r"(?im)^\s*(COLMAP\s+\d[^\r\n]*)", _text(probe))
            if match:
                result["version"] = match.group(1).strip()
                result["version_source"] = source
                break
    top_help = _text(help_probe)
    top_valid = help_probe["status"] == "ok" and bool(top_help.strip())
    for command in (*REQUIRED_COMMANDS, *OPTIONAL_COMMANDS):
        advertised = bool(top_valid and re.search(
            rf"(?m)^\s*{re.escape(command)}(?:\s|$)", top_help))
        probe = _probe([found, command, "-h"]) if advertised else None
        flags = sorted(set(_FLAG_PATTERN.findall(_text(probe)))) if probe else []
        # Unknown subcommands can return generic top-level help with exit 0.
        # Require actual options, not just the top-level command list / --help.
        help_available = bool(
            probe and probe["status"] == "ok" and set(flags) - {"--help", "--version"}
            and _text(probe).strip() != top_help.strip()
        )
        result["commands"][command] = {
            "required": command in REQUIRED_COMMANDS,
            "advertised": advertised,
            "available": help_available,
            "supported_flags": flags if help_available else [],
            "help_probe": probe,
        }
    missing = [name for name in REQUIRED_COMMANDS if not result["commands"][name]["available"]]
    result["missing_required_commands"] = missing
    result["required_commands_available"] = not missing
    result["optional_capabilities"] = {
        capability: {
            "available": any(result["commands"][name]["available"] for name in names),
            "commands": list(names),
        }
        for capability, names in OPTIONAL_CAPABILITY_COMMANDS.items()
    }
    if not top_valid:
        result["message"] = "COLMAP exists, but its top-level help failed or was empty; capabilities are unverified."
    elif missing:
        result["message"] = "Required COLMAP CLI commands are missing or their help failed: " + ", ".join(missing)
    else:
        result["message"] = ("Required CLI help is available. This does NOT establish working CUDA, "
                             "sufficient VRAM, or successful reconstruction.")
    return result


def _inspect_gpu() -> dict:
    found = _find_tool("nvidia-smi")
    result = {"available": False, "executable": found, "devices": [], "probe": None,
              "cuda_runtime_tested": False,
              "message": "nvidia-smi was not found; NVIDIA GPU availability is unknown."}
    if found is None:
        return result
    probe = result["probe"] = _probe([
        found, "--query-gpu=index,name,memory.free,memory.total", "--format=csv,noheader,nounits",
    ])
    if probe["status"] != "ok":
        result["message"] = "NVIDIA GPU inspection failed; no usable GPU has been established."
        return result
    try:
        for row in csv.reader(io.StringIO(probe["stdout"])):
            if not row or not any(cell.strip() for cell in row):
                continue
            if len(row) != 4:
                raise ValueError("Unexpected NVIDIA inventory columns.")
            index, name, free, total = (cell.strip() for cell in row)
            # Integer MiB are the units explicitly requested from nvidia-smi.
            device = {"index": int(index), "name": name,
                      "memory_free_mib": int(free), "memory_total_mib": int(total)}
            if (device["index"] < 0 or not name or device["memory_free_mib"] < 0
                    or device["memory_total_mib"] <= 0
                    or device["memory_free_mib"] > device["memory_total_mib"]):
                raise ValueError("Invalid NVIDIA memory inventory.")
            result["devices"].append(device)
        if probe["output_truncated"]:
            raise ValueError("NVIDIA inventory was truncated.")
    except (ValueError, csv.Error):
        result["devices"] = []
        result["message"] = "nvidia-smi returned unreadable GPU/memory information; availability is unverified."
        return result
    result["available"] = bool(result["devices"])
    result["message"] = (
        "NVIDIA devices were reported by the driver; the COLMAP CUDA runtime was NOT tested."
        if result["available"] else "nvidia-smi reported no NVIDIA devices."
    )
    return result


def _inspect_disk(workspace: Path | None) -> dict:
    requested = Path.cwd() if workspace is None else workspace
    if not isinstance(requested, Path) or ".." in requested.parts:
        raise ValueError("Workspace must be a pathlib.Path without '..' components.")
    requested = requested.absolute()
    inspected = requested
    while not inspected.exists() and inspected != inspected.parent:
        inspected = inspected.parent
    if not inspected.is_dir():
        raise ValueError("Workspace must be a directory, not a file.")
    result = {"workspace": str(requested), "workspace_exists": requested.is_dir(),
              "inspected_path": str(inspected), "total_bytes": None, "used_bytes": None,
              "free_bytes": None, "error": None}
    try:
        usage = shutil.disk_usage(inspected)
        result.update(total_bytes=usage.total, used_bytes=usage.used, free_bytes=usage.free)
    except OSError as exc:
        result["error"] = f"Disk information is unavailable ({type(exc).__name__}, errno={exc.errno})."
    return result


def inspect_toolchain(colmap_executable: str | None = None, workspace: Path | None = None) -> dict:
    """Return JSON-safe, read-only observations; never install or reconstruct.

    Each subprocess has a five-second timeout and capped captured output. A
    nonexistent workspace is not created; disk usage is from its nearest existing
    parent. Only ``colmap.required_commands_available`` controls the CLI exit code;
    it is NOT a production/reconstruction readiness or CUDA certification flag.
    """
    if colmap_executable is not None and (
            not isinstance(colmap_executable, str) or not colmap_executable.strip()
            or "\x00" in colmap_executable):
        raise ValueError("COLMAP executable must be a nonempty local executable name or path.")
    disk = _inspect_disk(workspace)
    return {
        "schema_version": 1,
        "inspection_only": True,
        "python": {"version": sys.version, "executable": sys.executable,
                   "implementation": platform.python_implementation()},
        "os": {"system": platform.system(), "release": platform.release(),
               "version": platform.version(), "machine": platform.machine()},
        "disk": disk,
        "nvidia_gpu": _inspect_gpu(),
        "colmap": _inspect_colmap(colmap_executable),
        "limitations": [
            "No reconstruction, CUDA kernels, or GPU workloads were executed.",
            "CLI availability does not prove CUDA support or runtime compatibility.",
            "Free disk/VRAM are point-in-time observations, not reservations or capacity approval.",
        ],
    }
