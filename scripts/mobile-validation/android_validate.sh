#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

"$ROOT_DIR/scripts/mobile-validation/android_unit_tests.sh"
"$ROOT_DIR/scripts/mobile-validation/android_build.sh"
