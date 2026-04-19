#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEFAULT_CURRENT_DIR="${MAGICHAT_IOS_SIM_ARTIFACTS_DIR:-$ROOT_DIR/.magichat/artifacts/ios-sim}/screenshots"
EXPECTED_SCREENSHOTS=(
  "01_launch_pairing.png"
  "02_pairing_connected.png"
  "03_connected_instances.png"
  "04_prompt_composer.png"
  "05_status_trust_prompt.png"
  "06_restore_flow.png"
  "07_error_banner.png"
)

usage() {
  echo "usage: ./scripts/mobile-validation/ios_screenshot_diff.sh <baseline-screenshot-dir> [current-screenshot-dir]" >&2
}

if [[ "$#" -lt 1 || "$#" -gt 2 ]]; then
  usage
  exit 1
fi

BASELINE_DIR="$1"
CURRENT_DIR="${2:-$DEFAULT_CURRENT_DIR}"

for target_dir in "$BASELINE_DIR" "$CURRENT_DIR"; do
  if [[ ! -d "$target_dir" ]]; then
    echo "[ios-screenshot-diff] ERROR: screenshot directory '$target_dir' does not exist" >&2
    exit 1
  fi
done

changed_count=0
unchanged_count=0

for expected_file in "${EXPECTED_SCREENSHOTS[@]}"; do
  baseline_file="$BASELINE_DIR/$expected_file"
  current_file="$CURRENT_DIR/$expected_file"

  if [[ ! -f "$baseline_file" ]]; then
    echo "[ios-screenshot-diff] ERROR: baseline screenshot '$baseline_file' is missing" >&2
    exit 1
  fi
  if [[ ! -f "$current_file" ]]; then
    echo "[ios-screenshot-diff] ERROR: current screenshot '$current_file' is missing" >&2
    exit 1
  fi

  baseline_hash="$(shasum -a 256 "$baseline_file" | awk '{print $1}')"
  current_hash="$(shasum -a 256 "$current_file" | awk '{print $1}')"
  if [[ "$baseline_hash" == "$current_hash" ]]; then
    echo "[ios-screenshot-diff] UNCHANGED $expected_file"
    unchanged_count=$((unchanged_count + 1))
    continue
  fi

  echo "[ios-screenshot-diff] CHANGED   $expected_file"
  echo "[ios-screenshot-diff]   baseline: $baseline_hash"
  echo "[ios-screenshot-diff]   current : $current_hash"
  changed_count=$((changed_count + 1))
done

echo "[ios-screenshot-diff] Summary: $unchanged_count unchanged, $changed_count changed"
echo "[ios-screenshot-diff] Baseline: $BASELINE_DIR"
echo "[ios-screenshot-diff] Current : $CURRENT_DIR"
