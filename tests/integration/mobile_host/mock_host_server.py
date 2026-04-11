#!/usr/bin/env python3
"""Local mock MagicHat host for mobile integration tests.

This server mirrors the current MagicHat v1 host surface:
- POST /v1/pairing/session
- GET /v1/host
- GET/POST /v1/instances
- GET/DELETE /v1/instances/{instance}
- POST /v1/instances/{instance}/prompt
- POST /v1/instances/{instance}/follow-up
- POST /v1/instances/{instance}/restore
- GET /v1/instances/{instance}/poll
- GET /v1/instances/{instance}/updates
"""

from __future__ import annotations

import argparse
import json
import threading
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def now_ms() -> int:
    return int(time.time() * 1000)


@dataclass
class MockState:
    host_id: str
    display_name: str
    host_address: str
    pairing_code: str
    session_token: str
    stale_hosts: bool = False
    instances: dict[str, dict[str, Any]] = field(default_factory=dict)

    def seed(self) -> None:
        if self.instances:
            return
        self.instances["wizard_team_app_311_1000"] = build_instance(
            instance_id="wizard_team_app_311_1000",
            pid=311,
            session_id="session-initial",
            task="Initial Team App Session",
            summary="Worker swarm active",
        )


def build_instance(
    instance_id: str,
    pid: int,
    session_id: str,
    task: str,
    summary: str,
    restore_state_path: str | None = None,
) -> dict[str, Any]:
    started_at = now_ms() - 5_000
    restore_path = restore_state_path or f"C:/wizard_team_app/runs/{session_id}/session_restore.json"
    return {
        "contract_version": "1.0.0",
        "beacon_schema_version": "1.0.0",
        "instance_id": instance_id,
        "automation_prefix": "wizard_team_app",
        "pid": pid,
        "hwnd": 200 + pid,
        "session_id": session_id,
        "phase": "running",
        "current_task_state": {
            "phase": "running",
            "task": task,
            "workers_done": 1,
            "pending_resumes": 0,
            "review_round": 0,
            "oversight_round": 0,
        },
        "artifact_dir": f"C:/tmp/wizard_team_app/{pid}",
        "cmd_path": f"C:/tmp/wizard_team_app/{pid}/cmd.json",
        "resp_path": f"C:/tmp/wizard_team_app/{pid}/resp.jsonl",
        "events_path": f"C:/tmp/wizard_team_app/{pid}/events.jsonl",
        "run_artifact_dir": f"C:/tmp/wizard_team_app/runs/{session_id}",
        "run_log_path": f"C:/tmp/wizard_team_app/runs/{session_id}/team_app_run.jsonl",
        "restore_state_path": restore_path,
        "started_at": started_at,
        "heartbeat_ts": now_ms(),
        "last_activity_ts": now_ms(),
        "result_summary": {
            "short_text": summary,
            "source": "summary_text",
            "truncated": False,
        },
        "health": {
            "network_available": True,
            "had_agent_errors": False,
            "pending_resumes": 0,
        },
        "summary_text": summary,
        "terminals_by_agent": {
            "erasmus": "Plan ready",
            "worker-1": "Running checks",
        },
        "chat": [
            {
                "role": "assistant",
                "agent_id": "erasmus",
                "text": summary,
            }
        ],
    }


def render_public_instance(instance: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": instance["instance_id"],
        "contract_version": instance["contract_version"],
        "beacon_schema_version": instance["beacon_schema_version"],
        "instance_id": instance["instance_id"],
        "automation_prefix": instance["automation_prefix"],
        "pid": instance["pid"],
        "hwnd": instance["hwnd"],
        "session_id": instance["session_id"],
        "phase": instance["phase"],
        "current_task_state": instance["current_task_state"],
        "artifact_dir": instance["artifact_dir"],
        "cmd_path": instance["cmd_path"],
        "resp_path": instance["resp_path"],
        "events_path": instance["events_path"],
        "run_artifact_dir": instance["run_artifact_dir"],
        "run_log_path": instance["run_log_path"],
        "restore_state_path": instance["restore_state_path"],
        "started_at": instance["started_at"],
        "heartbeat_ts": instance["heartbeat_ts"],
        "last_activity_ts": instance["last_activity_ts"],
        "result_summary": instance["result_summary"],
        "health": instance["health"],
    }


def render_detail(instance: dict[str, Any]) -> dict[str, Any]:
    public = render_public_instance(instance)
    public.update(
        {
            "status": "ok",
            "snapshot": {
                "phase": instance["phase"],
                "task_state": instance["current_task_state"],
                "result_summary": instance["result_summary"],
                "restore_refs": {
                    "restore_state_path": instance["restore_state_path"],
                    "run_log_path": instance["run_log_path"],
                },
                "health": instance["health"],
            },
            "chat": instance["chat"],
            "summary_text": instance["summary_text"],
            "terminals_by_agent": instance["terminals_by_agent"],
            "run_log_path": instance["run_log_path"],
        }
    )
    return public


class MockHandler(BaseHTTPRequestHandler):
    server: "MockHostServer"

    def _json(self, code: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _unauthorized(self) -> None:
        self._json(HTTPStatus.UNAUTHORIZED, {"error": "unauthorized"})

    def _parse_json(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length) if length else b"{}"
        try:
            return json.loads(raw.decode("utf-8") or "{}")
        except json.JSONDecodeError:
            return {}

    def _require_auth(self) -> bool:
        expected = f"Bearer {self.server.state.session_token}"
        got = self.headers.get("Authorization", "")
        if got != expected:
            self._unauthorized()
            return False
        return True

    def _find_instance(self, selector: str) -> dict[str, Any] | None:
        with self.server.state_lock:
            if selector in self.server.state.instances:
                return self.server.state.instances[selector]
            for instance in self.server.state.instances.values():
                if str(instance["pid"]) == selector:
                    return instance
        return None

    def do_GET(self) -> None:  # noqa: N802
        path = urlparse(self.path).path

        if path == "/healthz":
            self._json(200, {"status": "ok", "service": "magichat-host", "ts": now_ms()})
            return

        if path == "/v1/host":
            if not self._require_auth():
                return
            self._json(
                200,
                {
                    "host_id": self.server.state.host_id,
                    "host_name": self.server.state.display_name,
                    "lan_address": self.server.state.host_address,
                    "api_version": "1.0.0",
                    "scope": "lan_only_v1",
                },
            )
            return

        if path == "/v1/instances":
            if not self._require_auth():
                return
            with self.server.state_lock:
                instances = [
                    render_public_instance(instance)
                    for instance in self.server.state.instances.values()
                ]
            instances.sort(key=lambda item: item.get("started_at") or 0, reverse=True)
            self._json(200, {"instances": instances})
            return

        if path.startswith("/v1/instances/"):
            if path.endswith("/updates"):
                if not self._require_auth():
                    return
                self._stream_events(path)
                return

            if not self._require_auth():
                return

            parts = [part for part in path.split("/") if part]
            selector = parts[2] if len(parts) >= 3 else ""
            instance = self._find_instance(selector)
            if instance is None:
                self._json(404, {"error": "instance_not_found"})
                return

            if len(parts) == 3 or (len(parts) == 4 and parts[3] == "poll"):
                self._json(200, render_detail(instance))
                return

        self._json(404, {"error": "not_found", "path": path})

    def do_POST(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        body = self._parse_json()

        if path == "/v1/pairing/session":
            if body.get("pairing_code") != self.server.state.pairing_code:
                self._json(401, {"error": "unauthorized"})
                return
            self._json(
                201,
                {
                    "session_token": self.server.state.session_token,
                    "expires_at": (datetime.now(timezone.utc) + timedelta(hours=24))
                    .replace(microsecond=0)
                    .isoformat()
                    .replace("+00:00", "Z"),
                    "host_id": self.server.state.host_id,
                    "host_name": self.server.state.display_name,
                },
            )
            return

        if path == "/v1/instances":
            if not self._require_auth():
                return
            with self.server.state_lock:
                next_pid = max((item["pid"] for item in self.server.state.instances.values()), default=300) + 1
                instance_id = f"wizard_team_app_{next_pid}_{next_pid * 10}"
                restore_path = body.get("restore_state_path")
                session_id = f"session-{next_pid}"
                summary = "Launch accepted"
                task = body.get("title") or f"Team App {next_pid}"
                if restore_path:
                    session_id = f"restored-{Path(str(restore_path)).stem}"
                    summary = "Session restore queued"
                    task = f"Restored from {Path(str(restore_path)).name}"
                created = build_instance(
                    instance_id=instance_id,
                    pid=next_pid,
                    session_id=session_id,
                    task=task,
                    summary=summary,
                    restore_state_path=str(restore_path) if restore_path else None,
                )
                self.server.state.instances[instance_id] = created
            self.server.persist_state()
            self._json(201, render_public_instance(created))
            return

        if path.startswith("/v1/instances/") and path.endswith("/prompt"):
            if not self._require_auth():
                return
            selector = path.split("/")[-2]
            instance = self._find_instance(selector)
            if instance is None:
                self._json(404, {"error": "instance_not_found"})
                return
            prompt = str(body.get("prompt", "")).strip()
            with self.server.state_lock:
                instance["summary_text"] = f"Prompt accepted: {prompt[:80]}"
                instance["result_summary"]["short_text"] = instance["summary_text"]
                instance["last_activity_ts"] = now_ms()
            self.server.persist_state()
            self._json(202, {"status": "queued"})
            return

        if path.startswith("/v1/instances/") and path.endswith("/follow-up"):
            if not self._require_auth():
                return
            selector = path.split("/")[-2]
            instance = self._find_instance(selector)
            if instance is None:
                self._json(404, {"error": "instance_not_found"})
                return
            message = str(body.get("message", "")).strip()
            with self.server.state_lock:
                instance["summary_text"] = f"Follow-up accepted: {message[:80]}"
                instance["result_summary"]["short_text"] = instance["summary_text"]
                instance["last_activity_ts"] = now_ms()
            self.server.persist_state()
            self._json(202, {"status": "queued"})
            return

        if path.startswith("/v1/instances/") and path.endswith("/restore"):
            if not self._require_auth():
                return
            selector = path.split("/")[-2]
            instance = self._find_instance(selector)
            if instance is None:
                self._json(404, {"error": "instance_not_found"})
                return
            restore_path = str(body.get("restore_state_path", "")).strip()
            if not restore_path:
                self._json(400, {"error": "bad_request"})
                return
            with self.server.state_lock:
                instance["restore_state_path"] = restore_path
                instance["summary_text"] = f"Restore queued: {Path(restore_path).name}"
                instance["result_summary"]["short_text"] = instance["summary_text"]
                instance["last_activity_ts"] = now_ms()
            self.server.persist_state()
            self._json(202, {"status": "queued"})
            return

        self._json(404, {"error": "not_found", "path": path})

    def do_DELETE(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path.startswith("/v1/instances/"):
            if not self._require_auth():
                return
            selector = path.split("/")[-1]
            instance = self._find_instance(selector)
            if instance is None:
                self._json(404, {"error": "instance_not_found"})
                return
            with self.server.state_lock:
                self.server.state.instances.pop(instance["instance_id"], None)
            self.server.persist_state()
            self._json(202, {"status": "queued"})
            return

        self._json(404, {"error": "not_found", "path": path})

    def _stream_events(self, path: str) -> None:
        parts = [part for part in path.split("/") if part]
        if len(parts) < 4:
            self._json(400, {"error": "bad_sse_path"})
            return

        selector = parts[2]
        instance = self._find_instance(selector)
        if instance is None:
            self._json(404, {"error": "instance_not_found"})
            return

        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.end_headers()

        for idx in range(3):
            event = {
                "type": "status",
                "instance_id": instance["instance_id"],
                "health": instance["phase"],
                "message": f"tick {idx}",
                "output_chunk": f"chunk {idx}",
                "updated_at": now_iso(),
            }
            payload = f"event: status\ndata: {json.dumps(event)}\n\n".encode("utf-8")
            self.wfile.write(payload)
            self.wfile.flush()
            time.sleep(0.15)

    def log_message(self, *_args: Any) -> None:
        return


class MockHostServer(ThreadingHTTPServer):
    def __init__(self, host: str, port: int, state: MockState, persist_file: Path | None):
        super().__init__((host, port), MockHandler)
        self.state = state
        self.persist_file = persist_file
        self.state_lock = threading.RLock()

    def persist_state(self) -> None:
        if self.persist_file is None:
            return
        with self.state_lock:
            payload = {
                "host_id": self.state.host_id,
                "display_name": self.state.display_name,
                "host_address": self.state.host_address,
                "pairing_code": self.state.pairing_code,
                "session_token": self.state.session_token,
                "stale_hosts": self.state.stale_hosts,
                "instances": self.state.instances,
            }
            self.persist_file.parent.mkdir(parents=True, exist_ok=True)
            tmp_path = self.persist_file.with_suffix(f"{self.persist_file.suffix}.tmp")
            tmp_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
            tmp_path.replace(self.persist_file)


def load_state(args: argparse.Namespace) -> MockState:
    persist_file = Path(args.persist_file).expanduser() if args.persist_file else None

    if persist_file and persist_file.exists():
        try:
            payload = json.loads(persist_file.read_text(encoding="utf-8"))
            if isinstance(payload, dict):
                state = MockState(
                    host_id=payload["host_id"],
                    display_name=payload["display_name"],
                    host_address=payload["host_address"],
                    pairing_code=payload["pairing_code"],
                    session_token=payload["session_token"],
                    stale_hosts=payload.get("stale_hosts", False),
                    instances=payload.get("instances", {}),
                )
                state.seed()
                return state
        except (json.JSONDecodeError, KeyError, TypeError):
            pass

    state = MockState(
        host_id=args.host_id,
        display_name=args.display_name,
        host_address=args.host_address,
        pairing_code=args.pairing_code,
        session_token=args.session_token,
        stale_hosts=args.stale_hosts,
    )
    state.seed()
    return state


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=18787)
    parser.add_argument("--host-id", default="win-pc-01")
    parser.add_argument("--display-name", default="Windows Team App Host")
    parser.add_argument("--host-address", default="192.168.1.10")
    parser.add_argument("--pairing-code", default="123456")
    parser.add_argument("--session-token", default="token-v1")
    parser.add_argument("--stale-hosts", action="store_true")
    parser.add_argument("--persist-file", default="")
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    state = load_state(args)
    persist_file = Path(args.persist_file).expanduser() if args.persist_file else None

    server = MockHostServer(args.host, args.port, state, persist_file)
    print(f"mock-host listening on http://{args.host}:{args.port}", flush=True)
    try:
        server.serve_forever(poll_interval=0.2)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        server.persist_state()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
