#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from tests.integration.mobile_host.mock_host_controller import request_json


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Replay shared contract fixtures for mobile integration conformance.")
    parser.add_argument("--contracts-dir", default="tests/contracts")
    parser.add_argument("--host-url", default="")
    parser.add_argument("--host-id", default="win-pc-01")
    parser.add_argument("--pairing-code", default="123456")
    parser.add_argument("--session-token", default="token-v1")
    parser.add_argument("--allow-empty", action="store_true")
    parser.add_argument("--include-local-fixtures", action="store_true")
    return parser.parse_args()


def render_template(value: Any, tokens: dict[str, str]) -> Any:
    if isinstance(value, str):
        for key, token in tokens.items():
            value = value.replace(f"{{{{{key}}}}}", token)
        return value
    if isinstance(value, list):
        return [render_template(item, tokens) for item in value]
    if isinstance(value, dict):
        return {k: render_template(v, tokens) for k, v in value.items()}
    return value


def replay_steps(payload: dict[str, Any], args: argparse.Namespace) -> tuple[int, int]:
    steps = payload.get("steps", [])
    if not isinstance(steps, list):
        raise ValueError("fixture 'steps' must be a list")

    tokens = {
        "host_id": args.host_id,
        "pairing_code": args.pairing_code,
        "session_token": args.session_token,
    }

    executed = 0
    skipped = 0
    for index, step in enumerate(steps, start=1):
        request = step.get("request", {})
        method = str(request.get("method", "GET")).upper()
        path = request.get("path")
        expected = int(step.get("expect_status", 200))
        if not path:
            raise ValueError(f"step {index} missing request.path")

        if not args.host_url:
            skipped += 1
            continue

        body = render_template(request.get("body"), tokens)
        headers = render_template(request.get("headers", {}), tokens)
        status, _ = request_json(method, f"{args.host_url.rstrip('/')}{render_template(path, tokens)}", body=body, headers=headers)
        executed += 1
        if status != expected:
            raise AssertionError(f"step {index}: expected {expected}, got {status}")

    return executed, skipped


def collect_fixture_files(args: argparse.Namespace) -> list[Path]:
    files: list[Path] = []
    contracts_dir = Path(args.contracts_dir)
    if contracts_dir.exists():
        files.extend(sorted(contracts_dir.glob("*.json")))

    if args.include_local_fixtures:
        local_dir = Path("tests/integration/mobile_host/fixtures")
        files.extend(sorted(local_dir.glob("*.json")))

    deduped = []
    seen: set[Path] = set()
    for file in files:
        resolved = file.resolve()
        if resolved in seen:
            continue
        deduped.append(file)
        seen.add(resolved)
    return deduped


def main() -> int:
    args = parse_args()
    fixtures = collect_fixture_files(args)

    if not fixtures and not args.allow_empty:
        print("No contract fixtures found.")
        return 2

    executed_total = 0
    skipped_total = 0

    for fixture in fixtures:
        payload = json.loads(fixture.read_text(encoding="utf-8"))
        if not isinstance(payload, dict):
            raise ValueError(f"fixture {fixture} must be a JSON object")

        executed, skipped = replay_steps(payload, args)
        executed_total += executed
        skipped_total += skipped
        print(f"fixture: {fixture} -> steps={len(payload.get('steps', []))} executed={executed} skipped={skipped}")

    print(f"summary: fixtures={len(fixtures)} executed={executed_total} skipped={skipped_total}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
