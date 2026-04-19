#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ANDROID_DIR="$ROOT_DIR/mobile/android"
source "$ROOT_DIR/scripts/mobile-validation/android_env.sh"

prepare_android_env "android-unit-tests"

cd "$ANDROID_DIR"
./gradlew --no-daemon testDebugUnitTest
