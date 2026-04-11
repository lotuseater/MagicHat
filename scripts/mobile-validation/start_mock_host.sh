#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PORT="${MAGICHAT_MOCK_PORT:-18787}"
PAIRING_CODE="${MAGICHAT_PAIRING_CODE:-123456}"
SESSION_TOKEN="${MAGICHAT_SESSION_TOKEN:-token-v1}"

cd "$ROOT_DIR"
exec python3 tests/integration/mobile_host/mock_host_server.py \
  --port "$PORT" \
  --pairing-code "$PAIRING_CODE" \
  --session-token "$SESSION_TOKEN"
