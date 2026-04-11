#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

export MAGICHAT_RELAY_BIND_HOST="${MAGICHAT_RELAY_BIND_HOST:-127.0.0.1}"
export MAGICHAT_RELAY_PORT="${MAGICHAT_RELAY_PORT:-18795}"

if [[ -z "${MAGICHAT_RELAY_SQLITE_PATH:-}" ]]; then
  TEMP_ROOT="${TMPDIR:-/tmp}/wizard_team_app"
  mkdir -p "${TEMP_ROOT}"
  export MAGICHAT_RELAY_SQLITE_PATH="${TEMP_ROOT}/magichat_relay.sqlite"
fi

if [[ "${MAGICHAT_RELAY_BIND_HOST}" == "127.0.0.1" || "${MAGICHAT_RELAY_BIND_HOST}" == "localhost" || "${MAGICHAT_RELAY_BIND_HOST}" == "::1" ]]; then
  export MAGICHAT_RELAY_ALLOW_INSECURE_HTTP="${MAGICHAT_RELAY_ALLOW_INSECURE_HTTP:-1}"
fi

cd "${REPO_ROOT}/relay"
exec npm start
