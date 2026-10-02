"""Local execution primitives, without application or GPU-library imports.

A lease is a single checkout key; the OS returns it when its owner exits.
A managed stage is a stopwatch and logbook, not a shell or a sandbox.
"""
from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timezone
import errno
import math
import os
from pathlib import Path
import re
import signal
import stat
import subprocess
import tempfile
import time
from typing import Iterator


class ResourceBusyError(RuntimeError):
    """Another process currently holds the requested local resource."""


class StageExecutionError(RuntimeError):
    """A stage failed; ``result`` contains JSON-safe diagnostics and log paths."""

    def __init__(self, message: str, result: dict):
        super().__init__(message)
        self.result = result


_RESERVED_NAMES = {"con", "prn", "aux", "nul", "clock$"} | {
    f"{prefix}{number}" for prefix in ("com", "lpt") for number in range(1, 10)
}


def _validate_name(name: str) -> None:
    if (not isinstance(name, str)
            or re.fullmatch(r"[a-z][a-z0-9_-]{0,63}", name) is None
            or name in _RESERVED_NAMES):
        raise ValueError("Use a lowercase name starting with a letter, followed by "
                         "letters, digits, '_' or '-' (at most 64 characters).")


def _validate_stage(stage: str) -> None:
    if (not isinstance(stage, str)
            or re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,63}", stage) is None
            or stage.endswith((".", " "))):
        raise ValueError("Stage must be a safe, nonempty log name (letters, digits, '.', '_' or '-').")


def _safe_directory(path: Path) -> Path:
    """Create a local directory, rejecting traversal, links and filesystem roots.

    Callers must own/trust the root and its parents: this is not protection from
    another user concurrently replacing directories or from remote filesystems.
    """
    if not isinstance(path, Path) or ".." in path.parts:
        raise ValueError("The directory must be a pathlib.Path without '..' components.")
    absolute = path.absolute()
    if absolute == Path(absolute.anchor):
        raise ValueError("Use a dedicated working directory, not the filesystem root.")
    for part in (*reversed(absolute.parents), absolute):
        if part.is_symlink() or (hasattr(part, "is_junction") and part.is_junction()):
            raise ValueError("Working directories must not contain symbolic links or junctions.")
        if part.exists() and not part.is_dir():
            raise ValueError("The working directory path contains a non-directory.")
    absolute.mkdir(parents=True, exist_ok=True, mode=0o700)
    return absolute


@contextmanager
def resource_lease(root: Path, name: str) -> Iterator[Path]:
    """Acquire a nonblocking, process-wide local OS lock under ``root/.locks``.

    Yields the lock path. Always use the same root for a shared resource. The
    persistent file must NEVER be unlinked: deleting it would split the lock.
    Locks are released by the OS on process termination (including hard kills).
    """
    _validate_name(name)
    directory = _safe_directory(_safe_directory(root) / ".locks")
    path = directory / f"{name}.lock"
    if path.is_symlink() or (path.exists() and not path.is_file()):
        raise ValueError("The resource lock must be an ordinary local file.")
    flags = os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0)
    fd = os.open(path, flags, 0o600)
    acquired = False
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            raise ValueError("The resource lock must be a regular file without hard links.")
        try:
            if os.name == "nt":
                import msvcrt
                # Windows permits locking a byte beyond EOF; no racing initial write.
                os.lseek(fd, 0, os.SEEK_SET)
                msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            acquired = True
        except OSError as exc:
            if (exc.errno in (errno.EACCES, errno.EAGAIN, errno.EDEADLK)
                    or getattr(exc, "winerror", None) in (32, 33, 36)):
                raise ResourceBusyError(
                    f"The '{name}' resource is busy. Wait for the other local job to finish."
                ) from None
            raise
        yield path
    finally:
        try:
            if acquired:
                if os.name == "nt":
                    import msvcrt
                    os.lseek(fd, 0, os.SEEK_SET)
                    msvcrt.locking(fd, msvcrt.LK_UNLCK, 1)
                else:
                    import fcntl
                    fcntl.flock(fd, fcntl.LOCK_UN)
        finally:
            os.close(fd)


class _WindowsJob:
    """Kill-on-close Job Object; attach while suspended so children cannot escape.

    Uses documented Win32 APIs through the stdlib. Fails closed if the host's
    existing Job Object policy prevents assignment; it never runs uncontained.
    """

    def __init__(self):
        import ctypes
        from ctypes import wintypes as wt

        self.ctypes = ctypes
        self.wt = wt
        self.kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        size_t = ctypes.c_size_t

        class BasicLimits(ctypes.Structure):
            _fields_ = [("PerProcessUserTimeLimit", ctypes.c_longlong),
                        ("PerJobUserTimeLimit", ctypes.c_longlong),
                        ("LimitFlags", wt.DWORD), ("MinimumWorkingSetSize", size_t),
                        ("MaximumWorkingSetSize", size_t), ("ActiveProcessLimit", wt.DWORD),
                        ("Affinity", size_t), ("PriorityClass", wt.DWORD),
                        ("SchedulingClass", wt.DWORD)]

        class IOCounts(ctypes.Structure):
            _fields_ = [(name, ctypes.c_ulonglong) for name in (
                "ReadOperationCount", "WriteOperationCount", "OtherOperationCount",
                "ReadTransferCount", "WriteTransferCount", "OtherTransferCount")]

        class ExtendedLimits(ctypes.Structure):
            _fields_ = [("BasicLimitInformation", BasicLimits), ("IoInfo", IOCounts),
                        ("ProcessMemoryLimit", size_t), ("JobMemoryLimit", size_t),
                        ("PeakProcessMemoryUsed", size_t), ("PeakJobMemoryUsed", size_t)]

        signatures = {
            "CreateJobObjectW": ([ctypes.c_void_p, wt.LPCWSTR], wt.HANDLE),
            "SetInformationJobObject": ([wt.HANDLE, ctypes.c_int, ctypes.c_void_p, wt.DWORD], wt.BOOL),
            "AssignProcessToJobObject": ([wt.HANDLE, wt.HANDLE], wt.BOOL),
            "OpenProcess": ([wt.DWORD, wt.BOOL, wt.DWORD], wt.HANDLE),
            "OpenThread": ([wt.DWORD, wt.BOOL, wt.DWORD], wt.HANDLE),
            "ResumeThread": ([wt.HANDLE], wt.DWORD),
            "CloseHandle": ([wt.HANDLE], wt.BOOL),
            "CreateToolhelp32Snapshot": ([wt.DWORD, wt.DWORD], wt.HANDLE),
            "Thread32First": ([wt.HANDLE, ctypes.c_void_p], wt.BOOL),
            "Thread32Next": ([wt.HANDLE, ctypes.c_void_p], wt.BOOL),
        }
        for name, (argtypes, restype) in signatures.items():
            function = getattr(self.kernel, name)
            function.argtypes, function.restype = argtypes, restype
        self.handle = self.kernel.CreateJobObjectW(None, None)
        if not self.handle:
            raise ctypes.WinError(ctypes.get_last_error())
        limits = ExtendedLimits()
        limits.BasicLimitInformation.LimitFlags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        if not self.kernel.SetInformationJobObject(
                self.handle, 9, ctypes.byref(limits), ctypes.sizeof(limits)):
            error = ctypes.WinError(ctypes.get_last_error())
            self.close()
            raise error

    def attach_and_resume(self, process: subprocess.Popen) -> None:
        ct, wt, kernel = self.ctypes, self.wt, self.kernel
        handle = kernel.OpenProcess(0x0100 | 0x0001, False, process.pid)
        if not handle:
            raise ct.WinError(ct.get_last_error())
        try:
            if not kernel.AssignProcessToJobObject(self.handle, handle):
                raise ct.WinError(ct.get_last_error())
        finally:
            kernel.CloseHandle(handle)

        class ThreadEntry(ct.Structure):
            _fields_ = [("dwSize", wt.DWORD), ("cntUsage", wt.DWORD),
                        ("th32ThreadID", wt.DWORD), ("th32OwnerProcessID", wt.DWORD),
                        ("tpBasePri", wt.LONG), ("tpDeltaPri", wt.LONG), ("dwFlags", wt.DWORD)]

        snapshot = kernel.CreateToolhelp32Snapshot(0x0004, 0)  # TH32CS_SNAPTHREAD
        if snapshot == ct.c_void_p(-1).value:
            raise ct.WinError(ct.get_last_error())
        try:
            entry = ThreadEntry()
            entry.dwSize = ct.sizeof(entry)
            more = kernel.Thread32First(snapshot, ct.byref(entry))
            while more:
                if entry.th32OwnerProcessID == process.pid:
                    thread = kernel.OpenThread(0x0002, False, entry.th32ThreadID)
                    if not thread:
                        raise ct.WinError(ct.get_last_error())
                    try:
                        if kernel.ResumeThread(thread) == 0xFFFFFFFF:
                            raise ct.WinError(ct.get_last_error())
                        return
                    finally:
                        kernel.CloseHandle(thread)
                entry.dwSize = ct.sizeof(entry)
                more = kernel.Thread32Next(snapshot, ct.byref(entry))
            raise OSError("Could not resume the contained stage process.")
        finally:
            kernel.CloseHandle(snapshot)

    def close(self) -> None:
        if self.handle:
            self.kernel.CloseHandle(self.handle)
            self.handle = None


@contextmanager
def _managed_process(command: list[str], **kwargs) -> Iterator[subprocess.Popen]:
    """Internal runner shared with read-only probes; clean up all normal children."""
    job = _WindowsJob() if os.name == "nt" else None
    process = None
    try:
        if job is not None:
            kwargs["creationflags"] = 0x00000004 | subprocess.CREATE_NEW_PROCESS_GROUP
        else:
            kwargs["start_new_session"] = True
        process = subprocess.Popen(command, shell=False, stdin=subprocess.DEVNULL, **kwargs)
        if job is not None:
            job.attach_and_resume(process)
        yield process
    finally:
        # Kill the whole group even if its leader already exited: grandchildren
        # may still be alive and holding log handles. No filesystem deletion.
        if job is not None:
            job.close()
        if process is not None:
            if os.name != "nt":
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            if process.poll() is None:
                process.kill()  # also covers Windows assignment failure
            process.wait()


def _validate_command(command: list[str]) -> None:
    if (not isinstance(command, list) or not command
            or any(not isinstance(arg, str) or "\x00" in arg for arg in command)
            or not command[0].strip()):
        raise ValueError("Command must be a nonempty list of strings without NUL bytes.")
    # Windows may invoke .bat/.cmd through a shell despite shell=False.
    if os.name == "nt" and Path(command[0]).suffix.lower() in {".bat", ".cmd"}:
        raise ValueError("Use a native executable, not a Windows batch/shell script.")


def run_stage(command: list[str], workspace: Path, stage: str,
              timeout_seconds: float, env: dict | None = None) -> dict:
    """Run one local executable with separate, unique stdout/stderr stage logs.

    ``env`` is an optional overlay on the inherited environment. Structured
    results never record argv values or environment values (including on error).
    Raw child output can contain secrets: logs stay local and are NOT redacted.
    Invalid inputs raise ValueError before execution; launch/exit/timeout errors
    raise StageExecutionError with the same result shape as successful runs.
    POSIX containment covers ordinary descendants, not deliberately daemonized
    processes that escape their session. Only run trusted local executables.
    """
    _validate_command(command)
    _validate_stage(stage)
    if (isinstance(timeout_seconds, bool) or not isinstance(timeout_seconds, (int, float))
            or not math.isfinite(timeout_seconds) or timeout_seconds <= 0):
        raise ValueError("Stage timeout must be a finite, positive number of seconds.")
    if env is not None:
        if (not isinstance(env, dict)
                or any(not isinstance(key, str) or not key or "=" in key or "\x00" in key
                       or not isinstance(value, str) or "\x00" in value
                       for key, value in env.items())):
            raise ValueError("Environment overrides must map valid names to string values.")
    root = _safe_directory(workspace)
    logs = _safe_directory(root / "logs")
    started = time.monotonic()
    result = {
        "stage": stage,
        "status": "launch_failed",
        "command": {"argument_count": len(command), "arguments_recorded": False},
        "workspace": str(root),
        "started_at": datetime.now(timezone.utc).isoformat(),
        "finished_at": None,
        "duration_seconds": None,
        "timeout_seconds": float(timeout_seconds),
        "returncode": None,
        "timed_out": False,
        "stdout_log": None,
        "stderr_log": None,
        "error": None,
    }
    # NamedTemporaryFile chooses exclusive, private files; reruns never clobber logs.
    with tempfile.NamedTemporaryFile(dir=logs, prefix=f"{stage}-", suffix=".stdout.log",
                                     delete=False) as stdout, \
            tempfile.NamedTemporaryFile(dir=logs, prefix=f"{stage}-", suffix=".stderr.log",
                                        delete=False) as stderr:
        result["stdout_log"], result["stderr_log"] = stdout.name, stderr.name
        process = None
        try:
            with _managed_process(command, cwd=root, stdout=stdout, stderr=stderr,
                                  env=None if env is None else {**os.environ, **env}) as process:
                try:
                    process.wait(timeout=timeout_seconds)
                    result["status"] = "succeeded" if process.returncode == 0 else "failed"
                except subprocess.TimeoutExpired:
                    result["status"] = "timed_out"
                    result["timed_out"] = True
            result["returncode"] = process.returncode
        except OSError as exc:
            # OSError/TimeoutExpired text may echo secret argv, paths or env.
            result["error"] = {"type": type(exc).__name__, "errno": exc.errno}
            if process is not None:
                result["returncode"] = process.returncode
        finally:
            result["finished_at"] = datetime.now(timezone.utc).isoformat()
            result["duration_seconds"] = round(time.monotonic() - started, 6)
    if result["status"] != "succeeded":
        messages = {
            "timed_out": "exceeded its time limit; its process tree was stopped",
            "failed": "exited unsuccessfully",
            "launch_failed": "could not start; check the executable and local permissions",
        }
        raise StageExecutionError(
            f"Stage '{stage}' {messages[result['status']]}. See the local stdout/stderr logs.",
            result,
        ) from None
    return result
