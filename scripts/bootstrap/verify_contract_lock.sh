#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOCK_FILE="$ROOT_DIR/tests/contracts/contract_lock.json"
GATE_FILE="$ROOT_DIR/GATE_1_CONTRACT_SHA"

fail() {
  echo "[contract-gate] ERROR: $*" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "required command missing: $1"
}

need_cmd jq

if command -v shasum >/dev/null 2>&1; then
  SHA256_CMD=(shasum -a 256)
elif command -v sha256sum >/dev/null 2>&1; then
  SHA256_CMD=(sha256sum)
else
  fail "required command missing: shasum or sha256sum"
fi

[[ -f "$LOCK_FILE" ]] || fail "missing lock file: $LOCK_FILE"

cd "$ROOT_DIR"

jq -e . "$LOCK_FILE" >/dev/null || fail "invalid JSON: $LOCK_FILE"

required_files=(
  "docs/contract/team_app_surface_v1.md"
  "docs/contract/magichat_api_v1.yaml"
  "tests/contracts/contract_lock.json"
)

for file in "${required_files[@]}"; do
  [[ -f "$file" ]] || fail "missing required file: $file"
done

# Authority order hard lock.
expected_authority=(
  "beacon_identity"
  "ipc_command_response"
  "events_or_inspect_status"
  "run_log_read_only_fallback"
)

for i in "${!expected_authority[@]}"; do
  actual="$(jq -r ".authority_order[$i].source // empty" "$LOCK_FILE")"
  [[ "$actual" == "${expected_authority[$i]}" ]] || \
    fail "authority_order[$i] expected '${expected_authority[$i]}' got '$actual'"
done

# Command catalog must contain all required command mappings.
while IFS= read -r cmd; do
  [[ -z "$cmd" ]] && continue
  jq -e --arg cmd "$cmd" '.team_app.command_catalog | index($cmd)' "$LOCK_FILE" >/dev/null || \
    fail "required command missing from command_catalog: $cmd"
done < <(jq -r '.team_app.required_for_magichat[]' "$LOCK_FILE")

# Endpoint mappings may only reference known Team App commands.
while IFS= read -r mapped_cmd; do
  [[ -z "$mapped_cmd" ]] && continue
  jq -e --arg cmd "$mapped_cmd" '.team_app.command_catalog | index($cmd)' "$LOCK_FILE" >/dev/null || \
    fail "endpoint mapping references unknown Team App command: $mapped_cmd"
done < <(jq -r '.magichat.endpoint_to_team_app[].team_app_command[]?' "$LOCK_FILE")

# API path presence in OpenAPI file (simple textual gate by locked paths).
OPENAPI_PATH="$(jq -r '.magichat.open_api' "$LOCK_FILE")"
[[ -f "$OPENAPI_PATH" ]] || fail "missing OpenAPI file: $OPENAPI_PATH"

grep -q '^openapi: 3\.1\.0$' "$OPENAPI_PATH" || fail "OpenAPI version must be 3.1.0"

while IFS= read -r api_path; do
  [[ -z "$api_path" ]] && continue
  grep -Fq "  $api_path:" "$OPENAPI_PATH" || fail "required API path missing from OpenAPI: $api_path"
done < <(jq -r '.magichat.required_api_paths[]' "$LOCK_FILE")

# Fixture validation.
beacon_fixture="$(jq -r '.fixtures.beacon_sample' "$LOCK_FILE")"
[[ -f "$beacon_fixture" ]] || fail "missing beacon fixture: $beacon_fixture"
jq -e . "$beacon_fixture" >/dev/null || fail "invalid JSON fixture: $beacon_fixture"

while IFS= read -r fixture; do
  [[ -z "$fixture" ]] && continue
  [[ -f "$fixture" ]] || fail "missing IPC fixture: $fixture"
  jq -e . "$fixture" >/dev/null || fail "invalid JSON fixture: $fixture"
done < <(jq -r '.fixtures.ipc_samples[]' "$LOCK_FILE")

validate_jsonl_file() {
  local file="$1"
  local has_line=0
  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ -z "${line//[[:space:]]/}" ]]; then
      continue
    fi
    has_line=1
    echo "$line" | jq -e . >/dev/null || fail "invalid JSONL line in $file"
  done < "$file"
  [[ "$has_line" -eq 1 ]] || fail "empty JSONL fixture: $file"
}

while IFS= read -r fixture; do
  [[ -z "$fixture" ]] && continue
  [[ -f "$fixture" ]] || fail "missing stream fixture: $fixture"
  validate_jsonl_file "$fixture"
done < <(jq -r '.fixtures.stream_samples[]' "$LOCK_FILE")

# Deterministic gate hash from locked contract files.
gate_hash_input=""
while IFS= read -r file; do
  [[ -z "$file" ]] && continue
  [[ -f "$file" ]] || fail "missing contract file listed in gate.contract_files: $file"
  gate_hash_input+=$("${SHA256_CMD[@]}" "$file")
  gate_hash_input+=$'\n'
done < <(jq -r '.gate.contract_files[]' "$LOCK_FILE")

computed_hash="$(printf '%s' "$gate_hash_input" | "${SHA256_CMD[@]}" | awk '{print $1}')"

if [[ "${1:-}" == "--write-gate" ]]; then
  echo "$computed_hash" > "$GATE_FILE"
  echo "[contract-gate] wrote $GATE_FILE"
fi

[[ -f "$GATE_FILE" ]] || fail "missing gate file: $GATE_FILE"
actual_hash="$(tr -d '[:space:]' < "$GATE_FILE")"
[[ "$actual_hash" == "$computed_hash" ]] || fail "GATE_1_CONTRACT_SHA mismatch (expected $computed_hash got $actual_hash)"

echo "[contract-gate] OK"
echo "[contract-gate] contract_sha256=$computed_hash"
