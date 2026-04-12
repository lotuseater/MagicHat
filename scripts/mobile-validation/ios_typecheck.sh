#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

if [[ -z "${DEVELOPER_DIR:-}" && -d "/Applications/Xcode.app/Contents/Developer" ]]; then
  export DEVELOPER_DIR="/Applications/Xcode.app/Contents/Developer"
fi

if ! command -v xcrun >/dev/null 2>&1; then
  echo "[ios-typecheck] ERROR: xcrun is required" >&2
  exit 1
fi

cd "${REPO_ROOT}"
find \
  mobile/ios/AppShell \
  mobile/ios/Features \
  mobile/ios/Runtime \
  -type f \
  -name '*.swift' \
  -print0 | xargs -0 xcrun swiftc -typecheck
