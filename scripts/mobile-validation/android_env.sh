normalize_android_path() {
  local raw_path="${1:-}"
  if [[ -z "$raw_path" ]]; then
    return 1
  fi

  if command -v cygpath >/dev/null 2>&1; then
    cygpath -u "$raw_path"
    return 0
  fi

  printf '%s\n' "$raw_path"
}

android_try_set_java_home() {
  local candidate="${1:-}"
  if [[ -z "$candidate" ]]; then
    return 1
  fi

  candidate="$(normalize_android_path "$candidate")" || return 1
  if [[ -x "$candidate/bin/java" || -x "$candidate/bin/java.exe" ]]; then
    export JAVA_HOME="$candidate"
    return 0
  fi

  return 1
}

android_try_set_sdk_root() {
  local candidate="${1:-}"
  if [[ -z "$candidate" ]]; then
    return 1
  fi

  candidate="$(normalize_android_path "$candidate")" || return 1
  if [[ -d "$candidate" ]]; then
    export ANDROID_HOME="$candidate"
    export ANDROID_SDK_ROOT="$candidate"
    return 0
  fi

  return 1
}

prepare_android_env() {
  local lane_name="${1:-android}"
  local windows_program_files="${ProgramFiles:-${PROGRAMFILES:-${ProgramW6432:-${PROGRAMW6432:-}}}}"
  local windows_local_app_data="${LOCALAPPDATA:-${LocalAppData:-}}"

  if [[ -n "${JAVA_HOME:-}" ]]; then
    android_try_set_java_home "$JAVA_HOME" || true
  fi

  if [[ -z "${JAVA_HOME:-}" ]]; then
    if android_try_set_java_home "/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home"; then
      :
    elif [[ -x "/usr/libexec/java_home" ]]; then
      android_try_set_java_home "$("/usr/libexec/java_home" -v 17 2>/dev/null || true)" || true
    elif android_try_set_java_home "$windows_program_files/Android/Android Studio/jbr"; then
      :
    elif android_try_set_java_home "$windows_program_files/Android/Android Studio/jre"; then
      :
    fi
  fi

  if [[ -z "${JAVA_HOME:-}" || (! -x "$JAVA_HOME/bin/java" && ! -x "$JAVA_HOME/bin/java.exe") ]]; then
    echo "[$lane_name] ERROR: JAVA_HOME is not configured for JDK 17" >&2
    exit 1
  fi

  export PATH="$JAVA_HOME/bin:$PATH"

  if [[ -n "${ANDROID_SDK_ROOT:-}" ]]; then
    android_try_set_sdk_root "$ANDROID_SDK_ROOT" || true
  elif [[ -n "${ANDROID_HOME:-}" ]]; then
    android_try_set_sdk_root "$ANDROID_HOME" || true
  fi

  if [[ -z "${ANDROID_SDK_ROOT:-}" ]]; then
    if android_try_set_sdk_root "/opt/homebrew/share/android-commandlinetools"; then
      :
    elif android_try_set_sdk_root "$windows_local_app_data/Android/Sdk"; then
      :
    fi
  fi

  if [[ -z "${ANDROID_SDK_ROOT:-}" || ! -d "$ANDROID_SDK_ROOT" ]]; then
    echo "[$lane_name] ERROR: ANDROID_SDK_ROOT or ANDROID_HOME must point to a valid Android SDK" >&2
    exit 1
  fi
}
