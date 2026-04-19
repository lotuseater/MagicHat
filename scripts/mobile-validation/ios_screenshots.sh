#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

MAGICHAT_IOS_RUN_HOST_SMOKE=0 "$SCRIPT_DIR/ios_smoke.sh"
"$SCRIPT_DIR/ios_screenshot_verify.sh"
