#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
IOS_SMOKE_DIR="$ROOT_DIR/tests/ios-sim"
HOST_URL="${MAGICHAT_HOST_URL:-http://127.0.0.1:18787}"
PAIRING_CODE="${MAGICHAT_PAIRING_CODE:-123456}"
SIMULATOR_DEVICE="${MAGICHAT_IOS_SIM_DEVICE:-iPhone 15}"
SIMULATOR_OS="${MAGICHAT_IOS_SIM_OS:-}"
RUN_HOST_SMOKE="${MAGICHAT_IOS_RUN_HOST_SMOKE:-1}"
LANE_NAME="ios-sim-screenshots"
ARTIFACTS_DIR="${MAGICHAT_IOS_SIM_ARTIFACTS_DIR:-$ROOT_DIR/.magichat/artifacts/ios-sim}"
SCREENSHOT_DIR="$ARTIFACTS_DIR/screenshots"
RAW_ATTACHMENT_DIR="$ARTIFACTS_DIR/raw-attachments"
RESULT_BUNDLE_PATH="$ARTIFACTS_DIR/visual-tests.xcresult"
DERIVED_DATA_DIR="$ARTIFACTS_DIR/derived-data"
SCREENSHOT_MANIFEST_PATH="$SCREENSHOT_DIR/manifest.txt"
SCREENSHOT_LEGEND_PATH="$SCREENSHOT_DIR/legend.txt"
SCREENSHOT_COMMAND_PATH="$SCREENSHOT_DIR/command.txt"
SCREENSHOT_SOURCES_PATH="$SCREENSHOT_DIR/sources.txt"
SCREENSHOT_INDEX_PATH="$SCREENSHOT_DIR/index.html"
SCREENSHOT_HASH_PATH="$SCREENSHOT_DIR/sha256.txt"
SCREENSHOT_METADATA_PATH="$SCREENSHOT_DIR/metadata.json"
EXPECTED_SCREENSHOTS=(
  "01_launch_pairing.png"
  "02_pairing_connected.png"
  "03_connected_instances.png"
  "04_prompt_composer.png"
  "05_status_trust_prompt.png"
  "06_restore_flow.png"
  "07_error_banner.png"
)

describe_screenshot() {
  case "$1" in
    "01_launch_pairing.png") echo "Pair tab in the launch or unpaired state" ;;
    "02_pairing_connected.png") echo "Pair tab with a connected host context" ;;
    "03_connected_instances.png") echo "Instances tab with the connected shell baseline" ;;
    "04_prompt_composer.png") echo "Prompts tab with prompt and follow-up receipts" ;;
    "05_status_trust_prompt.png") echo "Status tab showing the trust prompt flow" ;;
    "06_restore_flow.png") echo "Restore tab after selecting a restore flow state" ;;
    "07_error_banner.png") echo "Error banner state over the connected shell" ;;
    *) echo "Unknown screenshot state" ;;
  esac
}

if [[ -z "${DEVELOPER_DIR:-}" && -d "/Applications/Xcode.app/Contents/Developer" ]]; then
  export DEVELOPER_DIR="/Applications/Xcode.app/Contents/Developer"
fi

HOST_OS="$(uname -s)"
if [[ "$HOST_OS" != "Darwin" ]]; then
  echo "[ios-smoke] ERROR: iOS simulator screenshots require macOS with Xcode; current host is '$HOST_OS'" >&2
  exit 1
fi

if ! command -v xcrun >/dev/null 2>&1; then
  echo "[ios-smoke] ERROR: xcrun is required" >&2
  exit 1
fi

if ! command -v xcodebuild >/dev/null 2>&1; then
  echo "[ios-smoke] ERROR: xcodebuild is required for the simulator visual harness" >&2
  exit 1
fi

if ! xcrun simctl list devices available | grep -Fq "${SIMULATOR_DEVICE} ("; then
  echo "[ios-smoke] ERROR: iOS Simulator device '${SIMULATOR_DEVICE}' is not available" >&2
  echo "[ios-smoke] Set MAGICHAT_IOS_SIM_DEVICE to an installed simulator name before rerunning." >&2
  exit 1
fi

if ! xcrun xcresulttool export attachments --help >/dev/null 2>&1; then
  echo "[ios-smoke] ERROR: xcresulttool export attachments is required (Xcode 16.3 or newer)." >&2
  exit 1
fi

DESTINATION="platform=iOS Simulator,name=${SIMULATOR_DEVICE}"
if [[ -n "$SIMULATOR_OS" ]]; then
  DESTINATION="${DESTINATION},OS=${SIMULATOR_OS}"
fi

rm -rf "$RESULT_BUNDLE_PATH" "$SCREENSHOT_DIR" "$RAW_ATTACHMENT_DIR" "$DERIVED_DATA_DIR"
mkdir -p "$SCREENSHOT_DIR" "$RAW_ATTACHMENT_DIR" "$DERIVED_DATA_DIR"

echo "[ios-smoke] Artifact root: $ARTIFACTS_DIR"
echo "[ios-smoke] Lane: $LANE_NAME"
echo "[ios-smoke] Destination: $DESTINATION"
echo "[ios-smoke] Result bundle: $RESULT_BUNDLE_PATH"
echo "[ios-smoke] Raw attachments: $RAW_ATTACHMENT_DIR"
echo "[ios-smoke] Screenshots: $SCREENSHOT_DIR"
echo "[ios-smoke] Manifest: $SCREENSHOT_MANIFEST_PATH"
echo "[ios-smoke] Legend: $SCREENSHOT_LEGEND_PATH"
echo "[ios-smoke] Command: $SCREENSHOT_COMMAND_PATH"
echo "[ios-smoke] Sources: $SCREENSHOT_SOURCES_PATH"
echo "[ios-smoke] Checksums: $SCREENSHOT_HASH_PATH"
echo "[ios-smoke] Gallery: $SCREENSHOT_INDEX_PATH"
echo "[ios-smoke] Metadata: $SCREENSHOT_METADATA_PATH"
echo "[ios-smoke] Capturing iOS simulator screenshots into $SCREENSHOT_DIR"
xcodebuild test \
  -packagePath "$IOS_SMOKE_DIR" \
  -scheme "MagicHatIOSSimSmoke-Package" \
  -destination "$DESTINATION" \
  -derivedDataPath "$DERIVED_DATA_DIR" \
  -only-testing:MagicHatIOSSimSmokeTests/MagicHatIOSVisualHarnessTests \
  -resultBundlePath "$RESULT_BUNDLE_PATH" \
  -resultBundleVersion 3

xcrun xcresulttool export attachments \
  --path "$RESULT_BUNDLE_PATH" \
  --output-path "$RAW_ATTACHMENT_DIR"

: > "$SCREENSHOT_SOURCES_PATH"
SCREENSHOT_METADATA_ITEMS=""
for expected_file in "${EXPECTED_SCREENSHOTS[@]}"; do
  mapfile -t source_matches < <(find "$RAW_ATTACHMENT_DIR" -type f -name "$expected_file" | sort)
  if [[ "${#source_matches[@]}" -eq 0 ]]; then
    echo "[ios-smoke] ERROR: expected screenshot '$expected_file' was not exported from the visual harness" >&2
    exit 1
  fi
  if [[ "${#source_matches[@]}" -ne 1 ]]; then
    echo "[ios-smoke] ERROR: expected exactly one exported attachment for '$expected_file' but found ${#source_matches[@]}" >&2
    printf '[ios-smoke]   %s\n' "${source_matches[@]}" >&2
    exit 1
  fi
  source_file="${source_matches[0]}"
  description="$(describe_screenshot "$expected_file")"
  cp "$source_file" "$SCREENSHOT_DIR/$expected_file"
  printf '%s | %s\n' "$expected_file" "$source_file" >> "$SCREENSHOT_SOURCES_PATH"
  file_size_bytes="$(wc -c < "$SCREENSHOT_DIR/$expected_file" | tr -d '[:space:]')"
  file_sha256="$(shasum -a 256 "$SCREENSHOT_DIR/$expected_file" | awk '{print $1}')"
  if [[ -n "$SCREENSHOT_METADATA_ITEMS" ]]; then
    SCREENSHOT_METADATA_ITEMS+=$',\n'
  fi
  SCREENSHOT_METADATA_ITEMS+="    {\"name\": \"$expected_file\", \"description\": \"$description\", \"normalized_path\": \"$SCREENSHOT_DIR/$expected_file\", \"raw_source\": \"$source_file\", \"sha256\": \"$file_sha256\", \"bytes\": $file_size_bytes}"
done

printf '%s\n' "${EXPECTED_SCREENSHOTS[@]}" > "$SCREENSHOT_MANIFEST_PATH"

: > "$SCREENSHOT_LEGEND_PATH"
for expected_file in "${EXPECTED_SCREENSHOTS[@]}"; do
  printf '%s | %s\n' "$expected_file" "$(describe_screenshot "$expected_file")" >> "$SCREENSHOT_LEGEND_PATH"
done

cat > "$SCREENSHOT_COMMAND_PATH" <<EOF
lane=$LANE_NAME
command=./scripts/mobile-validation/ios_screenshots.sh
destination=$DESTINATION
artifact_root=$ARTIFACTS_DIR
screenshots_dir=$SCREENSHOT_DIR
EOF

(
  cd "$SCREENSHOT_DIR"
  shasum -a 256 "${EXPECTED_SCREENSHOTS[@]}"
) > "$SCREENSHOT_HASH_PATH"

cat > "$SCREENSHOT_INDEX_PATH" <<'EOF'
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>MagicHat iOS Simulator Screenshots</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 24px; background: #f5f5f7; color: #1d1d1f; }
    h1 { margin-bottom: 8px; }
    p { margin-top: 0; color: #555; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 18px; }
    figure { margin: 0; padding: 16px; background: #fff; border-radius: 14px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08); }
    img { width: 100%; height: auto; border-radius: 10px; background: #e5e5ea; }
    figcaption { margin-top: 10px; font-size: 14px; word-break: break-word; }
  </style>
</head>
<body>
  <h1>MagicHat iOS Simulator Screenshots</h1>
  <p>Deterministic screenshot baseline exported by <code>scripts/mobile-validation/ios_smoke.sh</code>.</p>
  <div class="grid">
EOF

for expected_file in "${EXPECTED_SCREENSHOTS[@]}"; do
  description="$(describe_screenshot "$expected_file")"
  cat >> "$SCREENSHOT_INDEX_PATH" <<EOF
    <figure>
      <img src="$expected_file" alt="$expected_file">
      <figcaption><strong>$expected_file</strong><br>$description</figcaption>
    </figure>
EOF
done

cat >> "$SCREENSHOT_INDEX_PATH" <<'EOF'
  </div>
</body>
</html>
EOF

cat > "$SCREENSHOT_METADATA_PATH" <<EOF
{
  "lane": "$LANE_NAME",
  "artifact_root": "$ARTIFACTS_DIR",
  "destination": "$DESTINATION",
  "result_bundle": "$RESULT_BUNDLE_PATH",
  "raw_attachments": "$RAW_ATTACHMENT_DIR",
  "screenshots_dir": "$SCREENSHOT_DIR",
  "manifest": "$SCREENSHOT_MANIFEST_PATH",
  "legend": "$SCREENSHOT_LEGEND_PATH",
  "command": "$SCREENSHOT_COMMAND_PATH",
  "sources": "$SCREENSHOT_SOURCES_PATH",
  "checksums": "$SCREENSHOT_HASH_PATH",
  "gallery": "$SCREENSHOT_INDEX_PATH",
  "device": "$SIMULATOR_DEVICE",
  "os": "${SIMULATOR_OS:-latest-available}",
  "screenshots": [
${SCREENSHOT_METADATA_ITEMS}
  ]
}
EOF

echo "[ios-smoke] Simulator screenshots exported to $SCREENSHOT_DIR"
echo "[ios-smoke] Screenshot manifest written to $SCREENSHOT_MANIFEST_PATH"
echo "[ios-smoke] Screenshot legend written to $SCREENSHOT_LEGEND_PATH"
echo "[ios-smoke] Screenshot command written to $SCREENSHOT_COMMAND_PATH"
echo "[ios-smoke] Screenshot sources written to $SCREENSHOT_SOURCES_PATH"
echo "[ios-smoke] Screenshot checksums written to $SCREENSHOT_HASH_PATH"
echo "[ios-smoke] Screenshot gallery written to $SCREENSHOT_INDEX_PATH"
echo "[ios-smoke] Screenshot metadata written to $SCREENSHOT_METADATA_PATH"
echo "[ios-smoke] Review the captures by opening $SCREENSHOT_INDEX_PATH"

if [[ "$RUN_HOST_SMOKE" == "0" ]]; then
  echo "[ios-smoke] Skipping host API smoke checks because MAGICHAT_IOS_RUN_HOST_SMOKE=0"
  exit 0
fi

cd "$IOS_SMOKE_DIR"
echo "[ios-smoke] Running host API smoke checks against $HOST_URL"
MAGICHAT_HOST_URL="$HOST_URL" MAGICHAT_PAIRING_CODE="$PAIRING_CODE" xcrun swift test
