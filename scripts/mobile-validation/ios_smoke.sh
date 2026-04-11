#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
IOS_SMOKE_DIR="$ROOT_DIR/tests/ios-sim"
HOST_URL="${MAGICHAT_HOST_URL:-http://127.0.0.1:18787}"
PAIRING_CODE="${MAGICHAT_PAIRING_CODE:-123456}"

if [[ -z "${DEVELOPER_DIR:-}" && -d "/Applications/Xcode.app/Contents/Developer" ]]; then
  export DEVELOPER_DIR="/Applications/Xcode.app/Contents/Developer"
fi

if ! command -v xcrun >/dev/null 2>&1; then
  echo "[ios-smoke] ERROR: xcrun is required" >&2
  exit 1
fi

cd "$IOS_SMOKE_DIR"
MAGICHAT_HOST_URL="$HOST_URL" MAGICHAT_PAIRING_CODE="$PAIRING_CODE" xcrun swift test
