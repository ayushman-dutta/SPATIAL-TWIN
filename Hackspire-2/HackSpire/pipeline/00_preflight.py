"""Read-only local tool inventory: python pipeline/00_preflight.py --json."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

# Support both direct script execution and module execution without installation.
if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pipeline.common.toolchain import inspect_toolchain


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Inspect local disk, NVIDIA inventory and installed COLMAP CLI help. "
                    "Does not reconstruct, install tools, or verify CUDA execution."
    )
    parser.add_argument("--json", action="store_true", help="Print the full JSON inspection report.")
    parser.add_argument("--colmap", metavar="PATH", help="Native COLMAP executable name or path.")
    parser.add_argument("--workspace", type=Path, metavar="PATH",
                        help="Inspect disk capacity here (directory is not created).")
    args = parser.parse_args(argv)
    try:
        report = inspect_toolchain(args.colmap, args.workspace)
    except (ValueError, OSError) as exc:
        error = f"Preflight could not inspect the requested local paths: {exc}"
        if args.json:
            print(json.dumps({"inspection_only": True, "error": error}))
        else:
            print(error, file=sys.stderr)
        return 2
    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print(f"Python: {report['python']['version'].splitlines()[0]}")
        print(f"OS: {report['os']['system']} {report['os']['release']}")
        print(f"Disk free (bytes): {report['disk']['free_bytes']}")
        print(f"NVIDIA: {report['nvidia_gpu']['message']}")
        print(f"COLMAP: {report['colmap']['message']}")
        if report["colmap"]["version"]:
            print(f"Observed version: {report['colmap']['version']}")
        print("Inspection only: CUDA execution and reconstruction have NOT been tested.")
        print("Use --json for exact version/help probes, supported flags and diagnostics.")
    return 0 if report["colmap"]["required_commands_available"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
