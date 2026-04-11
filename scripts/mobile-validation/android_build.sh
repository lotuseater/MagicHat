#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ANDROID_DIR="$ROOT_DIR/mobile/android"

if [[ -z "${JAVA_HOME:-}" ]]; then
  if [[ -x "/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home/bin/java" ]]; then
    export JAVA_HOME="/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home"
  elif [[ -x "/usr/libexec/java_home" ]]; then
    export JAVA_HOME="$("/usr/libexec/java_home" -v 17 2>/dev/null || true)"
  fi
fi

if [[ -z "${JAVA_HOME:-}" || ! -x "$JAVA_HOME/bin/java" ]]; then
  echo "[android-build] ERROR: JAVA_HOME is not configured for JDK 17" >&2
  exit 1
fi

export PATH="$JAVA_HOME/bin:$PATH"

if [[ -z "${ANDROID_HOME:-}" && -d "/opt/homebrew/share/android-commandlinetools" ]]; then
  export ANDROID_HOME="/opt/homebrew/share/android-commandlinetools"
fi
if [[ -z "${ANDROID_SDK_ROOT:-}" && -n "${ANDROID_HOME:-}" ]]; then
  export ANDROID_SDK_ROOT="$ANDROID_HOME"
fi

if [[ -z "${ANDROID_SDK_ROOT:-}" || ! -d "$ANDROID_SDK_ROOT" ]]; then
  echo "[android-build] ERROR: ANDROID_SDK_ROOT or ANDROID_HOME must point to a valid Android SDK" >&2
  exit 1
fi

cd "$ANDROID_DIR"
./gradlew --no-daemon assembleDebug
