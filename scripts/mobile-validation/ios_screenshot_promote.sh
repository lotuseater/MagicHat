#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
SOURCE_DIR="${MAGICHAT_IOS_SIM_ARTIFACTS_DIR:-$ROOT_DIR/.magichat/artifacts/ios-sim}/screenshots"

usage() {
  echo "usage: ./scripts/mobile-validation/ios_screenshot_promote.sh <empty-baseline-screenshot-dir>" >&2
}

if [[ "$#" -ne 1 ]]; then
  usage
  exit 1
fi

DESTINATION_DIR="$1"

if [[ ! -d "$SOURCE_DIR" ]]; then
  echo "[ios-screenshot-promote] ERROR: screenshot directory '$SOURCE_DIR' does not exist" >&2
  echo "[ios-screenshot-promote] Run ./scripts/mobile-validation/ios_screenshots.sh first." >&2
  exit 1
fi

"$SCRIPT_DIR/ios_screenshot_verify.sh"

mkdir -p "$DESTINATION_DIR"
if find "$DESTINATION_DIR" -mindepth 1 -maxdepth 1 -print -quit | grep -q .; then
  echo "[ios-screenshot-promote] ERROR: destination directory '$DESTINATION_DIR' is not empty" >&2
  echo "[ios-screenshot-promote] Choose an empty directory so the baseline stays explicit." >&2
  exit 1
fi

cp -R "$SOURCE_DIR/." "$DESTINATION_DIR/"

echo "[ios-screenshot-promote] Promoted verified screenshot bundle to $DESTINATION_DIR"
echo "[ios-screenshot-promote] Compare future runs with ./scripts/mobile-validation/ios_screenshot_diff.sh $DESTINATION_DIR"
