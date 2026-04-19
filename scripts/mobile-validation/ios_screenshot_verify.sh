#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ARTIFACTS_DIR="${MAGICHAT_IOS_SIM_ARTIFACTS_DIR:-$ROOT_DIR/.magichat/artifacts/ios-sim}"
SCREENSHOT_DIR="$ARTIFACTS_DIR/screenshots"
EXPECTED_SCREENSHOTS=(
  "01_launch_pairing.png"
  "02_pairing_connected.png"
  "03_connected_instances.png"
  "04_prompt_composer.png"
  "05_status_trust_prompt.png"
  "06_restore_flow.png"
  "07_error_banner.png"
)
REQUIRED_ARTIFACTS=(
  "manifest.txt"
  "legend.txt"
  "command.txt"
  "sources.txt"
  "sha256.txt"
  "index.html"
  "metadata.json"
)

if [[ ! -d "$SCREENSHOT_DIR" ]]; then
  echo "[ios-screenshot-verify] ERROR: screenshot directory '$SCREENSHOT_DIR' does not exist" >&2
  echo "[ios-screenshot-verify] Run ./scripts/mobile-validation/ios_screenshots.sh first." >&2
  exit 1
fi

tmp_manifest="$(mktemp)"
tmp_hashes="$(mktemp)"
cleanup() {
  rm -f "$tmp_manifest" "$tmp_hashes"
}
trap cleanup EXIT

for required_artifact in "${REQUIRED_ARTIFACTS[@]}"; do
  if [[ ! -f "$SCREENSHOT_DIR/$required_artifact" ]]; then
    echo "[ios-screenshot-verify] ERROR: required artifact '$SCREENSHOT_DIR/$required_artifact' is missing" >&2
    exit 1
  fi
done

for expected_file in "${EXPECTED_SCREENSHOTS[@]}"; do
  if [[ ! -f "$SCREENSHOT_DIR/$expected_file" ]]; then
    echo "[ios-screenshot-verify] ERROR: expected screenshot '$SCREENSHOT_DIR/$expected_file' is missing" >&2
    exit 1
  fi
done

if [[ "$(wc -l < "$SCREENSHOT_DIR/legend.txt" | tr -d '[:space:]')" != "${#EXPECTED_SCREENSHOTS[@]}" ]]; then
  echo "[ios-screenshot-verify] ERROR: legend.txt does not contain ${#EXPECTED_SCREENSHOTS[@]} entries" >&2
  exit 1
fi

printf '%s\n' "${EXPECTED_SCREENSHOTS[@]}" > "$tmp_manifest"
if ! cmp -s "$tmp_manifest" "$SCREENSHOT_DIR/manifest.txt"; then
  echo "[ios-screenshot-verify] ERROR: manifest.txt does not match the expected deterministic screenshot list" >&2
  diff -u "$tmp_manifest" "$SCREENSHOT_DIR/manifest.txt" || true
  exit 1
fi

(
  cd "$SCREENSHOT_DIR"
  shasum -a 256 "${EXPECTED_SCREENSHOTS[@]}"
) > "$tmp_hashes"
if ! cmp -s "$tmp_hashes" "$SCREENSHOT_DIR/sha256.txt"; then
  echo "[ios-screenshot-verify] ERROR: sha256.txt does not match the current screenshot files" >&2
  diff -u "$tmp_hashes" "$SCREENSHOT_DIR/sha256.txt" || true
  exit 1
fi

for expected_file in "${EXPECTED_SCREENSHOTS[@]}"; do
  legend_count="$(awk -F ' \\| ' -v file_name="$expected_file" '$1 == file_name { count += 1 } END { print count + 0 }' "$SCREENSHOT_DIR/legend.txt")"
  if [[ "$legend_count" != "1" ]]; then
    echo "[ios-screenshot-verify] ERROR: legend.txt should contain exactly one entry for '$expected_file' but found $legend_count" >&2
    exit 1
  fi
  sources_count="$(awk -F ' \\| ' -v file_name="$expected_file" '$1 == file_name { count += 1 } END { print count + 0 }' "$SCREENSHOT_DIR/sources.txt")"
  if [[ "$sources_count" != "1" ]]; then
    echo "[ios-screenshot-verify] ERROR: sources.txt should contain exactly one entry for '$expected_file' but found $sources_count" >&2
    exit 1
  fi
  if ! grep -Fq "\"name\": \"$expected_file\"" "$SCREENSHOT_DIR/metadata.json"; then
    echo "[ios-screenshot-verify] ERROR: metadata.json is missing the screenshot entry for '$expected_file'" >&2
    exit 1
  fi
done

if ! grep -Fq "command=./scripts/mobile-validation/ios_screenshots.sh" "$SCREENSHOT_DIR/command.txt"; then
  echo "[ios-screenshot-verify] ERROR: command.txt does not record the expected screenshot shortcut" >&2
  exit 1
fi

if ! grep -Fq "artifact_root=$ARTIFACTS_DIR" "$SCREENSHOT_DIR/command.txt"; then
  echo "[ios-screenshot-verify] ERROR: command.txt does not record the expected artifact root '$ARTIFACTS_DIR'" >&2
  exit 1
fi

if ! grep -Fq "\"artifact_root\": \"$ARTIFACTS_DIR\"" "$SCREENSHOT_DIR/metadata.json"; then
  echo "[ios-screenshot-verify] ERROR: metadata.json does not point at the expected artifact root '$ARTIFACTS_DIR'" >&2
  exit 1
fi

if ! grep -Fq "\"lane\": \"ios-sim-screenshots\"" "$SCREENSHOT_DIR/metadata.json"; then
  echo "[ios-screenshot-verify] ERROR: metadata.json does not record the expected lane name" >&2
  exit 1
fi

if ! grep -Fq "\"screenshots_dir\": \"$SCREENSHOT_DIR\"" "$SCREENSHOT_DIR/metadata.json"; then
  echo "[ios-screenshot-verify] ERROR: metadata.json does not point at the expected screenshot directory '$SCREENSHOT_DIR'" >&2
  exit 1
fi

echo "[ios-screenshot-verify] Verified screenshot artifact bundle at $SCREENSHOT_DIR"
echo "[ios-screenshot-verify] Manifest, legend, command, hashes, sources, and metadata are internally consistent."
