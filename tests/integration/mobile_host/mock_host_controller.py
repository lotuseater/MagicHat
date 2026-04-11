#!/usr/bin/env python3
from __future__ import annotations

import json
import http.client
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


def pick_free_port(host: str = "127.0.0.1") -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind((host, 0))
        return int(sock.getsockname()[1])


def request_json(
    method: str,
    url: str,
    body: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
    timeout: float = 3.0,
) -> tuple[int, dict[str, Any] | None]:
    last_error: Exception | None = None
    for attempt in range(3):
        payload = None
        merged_headers = {"Accept": "application/json"}
        if headers:
            merged_headers.update(headers)
        if body is not None:
            payload = json.dumps(body).encode("utf-8")
            merged_headers.setdefault("Content-Type", "application/json")

        req = urllib.request.Request(url=url, data=payload, headers=merged_headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as response:
                raw = response.read().decode("utf-8")
                parsed = json.loads(raw) if raw else None
                return response.status, parsed
        except urllib.error.HTTPError as exc:
            raw = exc.read().decode("utf-8")
            parsed = json.loads(raw) if raw else None
            return exc.code, parsed
        except (http.client.RemoteDisconnected, ConnectionResetError, TimeoutError) as exc:
            last_error = exc
            if attempt < 2:
                time.sleep(0.05)
                continue
            raise
    if last_error is not None:
        raise last_error
    raise RuntimeError("request_json reached unexpected state")


class MockHostProcess:
    def __init__(
        self,
        repo_root: Path,
        port: int = 0,
        host_id: str = "win-pc-01",
        pairing_code: str = "123456",
        session_token: str = "token-v1",
        persist_file: Path | None = None,
    ) -> None:
        self.repo_root = repo_root
        self.port = port if port > 0 else pick_free_port()
        self.host_id = host_id
        self.pairing_code = pairing_code
        self.session_token = session_token
        self.persist_file = persist_file
        self.proc: subprocess.Popen[str] | None = None

    @property
    def base_url(self) -> str:
        return f"http://127.0.0.1:{self.port}"

    def start(self) -> None:
        script = self.repo_root / "tests" / "integration" / "mobile_host" / "mock_host_server.py"
        cmd = [
            sys.executable,
            str(script),
            "--port",
            str(self.port),
            "--host-id",
            self.host_id,
            "--pairing-code",
            self.pairing_code,
            "--session-token",
            self.session_token,
        ]
        if self.persist_file is not None:
            cmd += ["--persist-file", str(self.persist_file)]

        self.proc = subprocess.Popen(
            cmd,
            cwd=self.repo_root,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )

        deadline = time.time() + 8.0
        while time.time() < deadline:
            if self.proc.poll() is not None:
                output = self.proc.stdout.read() if self.proc.stdout else ""
                raise RuntimeError(f"mock host exited early: {output}")
            try:
                status, _ = request_json("GET", f"{self.base_url}/healthz")
                if status == 200:
                    return
            except Exception:
                pass
            time.sleep(0.12)

        self.stop()
        raise TimeoutError("mock host failed to start")

    def stop(self) -> None:
        if self.proc is None:
            return
        if self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                self.proc.kill()
                self.proc.wait(timeout=2)
        self.proc = None

    def pair(self) -> tuple[str, str]:
        status, pair_payload = request_json(
            "POST",
            f"{self.base_url}/v1/pairing/session",
            body={"pairing_code": self.pairing_code, "device_name": "android-test"},
        )
        if status != 201 or not pair_payload:
            raise RuntimeError(f"failed to pair: {status} {pair_payload}")

        return pair_payload["host_id"], pair_payload["session_token"]
