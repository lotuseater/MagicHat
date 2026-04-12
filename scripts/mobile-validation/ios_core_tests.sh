#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
IOS_CORE_DIR="$ROOT_DIR/mobile/ios"

if [[ -z "${DEVELOPER_DIR:-}" && -d "/Applications/Xcode.app/Contents/Developer" ]]; then
  export DEVELOPER_DIR="/Applications/Xcode.app/Contents/Developer"
fi

if ! command -v xcrun >/dev/null 2>&1; then
  echo "[ios-core-tests] ERROR: xcrun is required" >&2
  exit 1
fi

cd "$IOS_CORE_DIR"
xcrun swift test
