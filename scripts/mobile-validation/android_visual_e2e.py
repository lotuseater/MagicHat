#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
HOST_DIR = ROOT / "host"
ARTIFACT_ROOT = ROOT / ".magichat" / "artifacts" / "android-e2e"
PACKAGE_ID = "com.magichat.mobile"
MAIN_ACTIVITY = f"{PACKAGE_ID}/.MainActivity"
DEFAULT_AVD = "Medium_Phone_API_36.1"
DEFAULT_BASE_URL = "http://10.0.2.2:18765/"
DEFAULT_PROMPT = "Summarize the current Team App status without editing files."
BEACON_PATH = Path(tempfile.gettempdir()) / "wizard_team_app" / "active_instances.json"


class HarnessError(RuntimeError):
    pass


def run(cmd: list[str], *, cwd: Path | None = None, timeout: float = 60.0, check: bool = True) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(
        cmd,
        cwd=str(cwd) if cwd else None,
        text=True,
        capture_output=True,
        timeout=timeout,
        check=False,
    )
    if check and result.returncode != 0:
        raise HarnessError(
            f"command failed ({result.returncode}): {' '.join(cmd)}\nstdout:\n{result.stdout}\nstderr:\n{result.stderr}"
        )
    return result


def sdk_root() -> Path:
    for candidate in (
        os.environ.get("ANDROID_SDK_ROOT", "").strip(),
        os.environ.get("ANDROID_HOME", "").strip(),
        str(Path.home() / "AppData" / "Local" / "Android" / "Sdk"),
    ):
        if candidate and Path(candidate).exists():
            return Path(candidate)
    raise HarnessError("Android SDK root not found")


def tool_path(relative: str, fallback_name: str) -> str:
    candidate = sdk_root() / relative
    if candidate.exists():
        return str(candidate)
    return fallback_name


ADB = tool_path("platform-tools/adb.exe", "adb")
EMULATOR = tool_path("emulator/emulator.exe", "emulator")


def adb(serial: str, *args: str, timeout: float = 60.0, check: bool = True) -> subprocess.CompletedProcess[str]:
    return run([ADB, "-s", serial, *args], timeout=timeout, check=check)


def adb_shell(serial: str, command: str, *, timeout: float = 60.0, check: bool = True) -> str:
    return adb(serial, "shell", command, timeout=timeout, check=check).stdout


def swipe(serial: str, x1: int, y1: int, x2: int, y2: int, *, duration_ms: int = 250) -> None:
    adb(serial, "shell", "input", "swipe", str(x1), str(y1), str(x2), str(y2), str(duration_ms), timeout=15)
    time.sleep(1)


def ensure_emulator(avd: str) -> str:
    devices = run([ADB, "devices"], timeout=15).stdout.splitlines()
    for line in devices:
        if "\tdevice" in line and line.startswith("emulator-"):
            return line.split()[0]

    ARTIFACT_ROOT.mkdir(parents=True, exist_ok=True)
    stdout_log = ARTIFACT_ROOT / "emulator-launch.stdout.log"
    stderr_log = ARTIFACT_ROOT / "emulator-launch.stderr.log"
    with stdout_log.open("w", encoding="utf-8") as stdout_handle, stderr_log.open("w", encoding="utf-8") as stderr_handle:
        subprocess.Popen(
            [EMULATOR, "-avd", avd, "-no-snapshot-save", "-netdelay", "none", "-netspeed", "full"],
            stdout=stdout_handle,
            stderr=stderr_handle,
        )

    deadline = time.time() + 240
    serial = ""
    while time.time() < deadline:
        devices = run([ADB, "devices"], timeout=15).stdout.splitlines()
        for line in devices:
            if "\tdevice" in line and line.startswith("emulator-"):
                serial = line.split()[0]
                break
        if serial:
            break
        time.sleep(3)
    if not serial:
        raise HarnessError("emulator did not appear in adb devices")

    run([ADB, "-s", serial, "wait-for-device"], timeout=30)
    boot_deadline = time.time() + 300
    while time.time() < boot_deadline:
        if adb_shell(serial, "getprop sys.boot_completed", timeout=15).strip() == "1":
            break
        time.sleep(2)
    else:
        raise HarnessError(f"emulator {serial} did not finish booting")

    for setting in ("window_animation_scale", "transition_animation_scale", "animator_duration_scale"):
        adb_shell(serial, f"settings put global {setting} 0", timeout=15)
    return serial


def build_and_install(serial: str, *, skip_build: bool) -> None:
    command = ["pwsh", "scripts/mobile-validation/build_and_run_android.ps1"]
    if skip_build:
        command.append("-SkipBuild")
    run(command, cwd=ROOT, timeout=1200)
    adb(serial, "shell", "wm", "dismiss-keyguard", timeout=15)


def reset_app_state(serial: str) -> None:
    adb(serial, "shell", "am", "force-stop", PACKAGE_ID, timeout=15, check=False)
    adb(serial, "shell", "pm", "clear", PACKAGE_ID, timeout=30, check=False)
    adb(serial, "shell", "wm", "dismiss-keyguard", timeout=15, check=False)


def get_live_local_pairing() -> tuple[str, int]:
    try:
        with urllib.request.urlopen("http://127.0.0.1:18765/admin/v1/pairing", timeout=5) as response:
            payload = json.loads(response.read().decode("utf-8"))
            return (
                str(payload.get("pairing_code") or "").strip(),
                int(payload.get("pairing_expires_at_ms") or 0),
            )
    except Exception:
        return "", 0


def get_live_local_pairing_code() -> str:
    code, _ = get_live_local_pairing()
    return code


def get_stable_local_pairing_code(*, min_remaining_ms: int = 120_000) -> str:
    deadline = time.time() + 30
    while time.time() < deadline:
        code, expires_at_ms = get_live_local_pairing()
        if not code:
            time.sleep(1)
            continue
        remaining_ms = expires_at_ms - int(time.time() * 1000)
        if remaining_ms >= min_remaining_ms:
            return code
        sleep_s = max(1.0, min(remaining_ms / 1000.0 + 1.0, 5.0))
        time.sleep(sleep_s)
    return get_live_local_pairing_code()


def existing_local_pairing_code() -> str:
    if not http_ok("http://127.0.0.1:18765/healthz"):
        return ""
    live_pairing = get_live_local_pairing_code()
    if live_pairing:
        return live_pairing
    result = run(["node", "scripts/print_pairing_code.js", "--json"], cwd=ROOT, timeout=30)
    payload = json.loads(result.stdout)
    return str(payload.get("pairing_code") or "").strip()


def start_host() -> tuple[subprocess.Popen[bytes] | None, str, Path | None, Path | None]:
    existing_pairing = existing_local_pairing_code()
    if existing_pairing:
        return None, existing_pairing, None, None

    HOST_DIR.mkdir(parents=True, exist_ok=True)
    stdout_log = ARTIFACT_ROOT / "host.stdout.log"
    stderr_log = ARTIFACT_ROOT / "host.stderr.log"
    stdout_handle = stdout_log.open("wb")
    stderr_handle = stderr_log.open("wb")
    process = subprocess.Popen(
        ["node", "src/index.js"],
        cwd=str(HOST_DIR),
        stdout=stdout_handle,
        stderr=stderr_handle,
    )

    deadline = time.time() + 30
    pairing_code = ""
    while time.time() < deadline:
        if process.poll() is not None:
            raise HarnessError(f"MagicHat host exited early with code {process.returncode}")
        if stdout_log.exists():
            text = stdout_log.read_text(encoding="utf-8", errors="replace")
            for line in text.splitlines():
                if line.startswith("Pairing code: "):
                    pairing_code = line.split("Pairing code: ", 1)[1].split(" ", 1)[0].strip()
                    break
        if pairing_code:
            break
        time.sleep(0.5)
    if not pairing_code:
        raise HarnessError("MagicHat host did not report a pairing code")
    return process, pairing_code, stdout_log, stderr_log


def stop_process(process: subprocess.Popen[bytes] | None) -> None:
    if process is None or process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)


def http_ok(url: str) -> bool:
    try:
        with urllib.request.urlopen(url, timeout=5) as response:
            return 200 <= response.status < 500
    except Exception:
        return False


def launch_app(serial: str, *, extras: dict[str, str | bool] | None = None) -> None:
    launch_args = [ADB, "-s", serial, "shell", "am", "start", "-W", "-n", MAIN_ACTIVITY]
    for key, value in (extras or {}).items():
        if isinstance(value, bool):
            launch_args.extend(["--ez", key, "true" if value else "false"])
        else:
            launch_args.extend(["--es", key, value])

    last_error: Exception | None = None
    for attempt in range(1, 4):
        adb(serial, "shell", "am", "force-stop", PACKAGE_ID, timeout=15, check=False)
        adb(serial, "shell", "wm", "dismiss-keyguard", timeout=15, check=False)
        try:
            run(launch_args, timeout=90)
            adb(serial, "shell", "input", "keyevent", "82", timeout=15, check=False)
            time.sleep(1)
            return
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            if attempt == 3:
                break
            time.sleep(3)

    fallback_args = [ADB, "-s", serial, "shell", "am", "start", "-n", MAIN_ACTIVITY]
    for key, value in (extras or {}).items():
        if isinstance(value, bool):
            fallback_args.extend(["--ez", key, "true" if value else "false"])
        else:
            fallback_args.extend(["--es", key, value])
    run(fallback_args, timeout=30)
    adb(serial, "shell", "input", "keyevent", "82", timeout=15, check=False)
    time.sleep(2)


def dump_ui(serial: str, target: Path, *, attempts: int = 3) -> ET.Element:
    target.parent.mkdir(parents=True, exist_ok=True)
    last_error: Exception | None = None
    max_attempts = max(attempts, 6)
    for attempt in range(1, max_attempts + 1):
        try:
            adb(serial, "shell", "uiautomator", "dump", "/sdcard/window_dump.xml", timeout=30)
            xml_text = adb(serial, "shell", "cat", "/sdcard/window_dump.xml", timeout=30).stdout
            root = ET.fromstring(xml_text)
            if dismiss_system_dialogs(serial, root):
                time.sleep(2)
                continue
            target.write_text(xml_text, encoding="utf-8")
            return root
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            if attempt == max_attempts:
                break
            time.sleep(2)
    raise HarnessError(f"uiautomator dump failed after {max_attempts} attempts: {last_error}")


def screencap(serial: str, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("wb") as handle:
        process = subprocess.run(
            [ADB, "-s", serial, "exec-out", "screencap", "-p"],
            stdout=handle,
            stderr=subprocess.PIPE,
            timeout=30,
            check=False,
        )
    if process.returncode != 0:
        raise HarnessError(f"screencap failed: {process.stderr.decode('utf-8', errors='replace')}")


def parse_bounds(value: str) -> tuple[int, int, int, int]:
    left, top, right, bottom = value.replace("][", ",").replace("[", "").replace("]", "").split(",")
    return int(left), int(top), int(right), int(bottom)


def center(bounds: tuple[int, int, int, int]) -> tuple[int, int]:
    left, top, right, bottom = bounds
    return (left + right) // 2, (top + bottom) // 2


def find_nodes(root: ET.Element, *, text: str) -> list[ET.Element]:
    return [node for node in root.iter("node") if (node.attrib.get("text") or "").strip() == text]


def find_nodes_containing(root: ET.Element, *, text: str) -> list[ET.Element]:
    needle = text.strip()
    return [node for node in root.iter("node") if needle and needle in (node.attrib.get("text") or "").strip()]


def find_nodes_by_content_desc(root: ET.Element, content_desc: str) -> list[ET.Element]:
    needle = content_desc.strip()
    return [node for node in root.iter("node") if (node.attrib.get("content-desc") or "").strip() == needle]


def find_nodes_by_content_desc_prefix(root: ET.Element, prefix: str) -> list[ET.Element]:
    needle = prefix.strip()
    return [
        node for node in root.iter("node")
        if needle and (node.attrib.get("content-desc") or "").strip().startswith(needle)
    ]


def tap_text(serial: str, root: ET.Element, text: str, *, occurrence: int = -1) -> None:
    matches = find_nodes(root, text=text)
    if not matches:
        raise HarnessError(f"UI text not found: {text!r}")
    bounds = parse_bounds(matches[occurrence].attrib["bounds"])
    x, y = center(bounds)
    adb(serial, "shell", "input", "tap", str(x), str(y), timeout=15)
    time.sleep(1)


def tap_content_desc(serial: str, root: ET.Element, content_desc: str, *, occurrence: int = -1) -> None:
    matches = find_nodes_by_content_desc(root, content_desc)
    if not matches:
        raise HarnessError(f"UI content-desc not found: {content_desc!r}")
    bounds = parse_bounds(matches[occurrence].attrib["bounds"])
    x, y = center(bounds)
    adb(serial, "shell", "input", "tap", str(x), str(y), timeout=15)
    time.sleep(1)


def tap_content_desc_prefix(serial: str, root: ET.Element, prefix: str, *, occurrence: int = -1) -> str:
    matches = find_nodes_by_content_desc_prefix(root, prefix)
    if not matches:
        raise HarnessError(f"UI content-desc prefix not found: {prefix!r}")
    match = matches[occurrence]
    bounds = parse_bounds(match.attrib["bounds"])
    x, y = center(bounds)
    adb(serial, "shell", "input", "tap", str(x), str(y), timeout=15)
    time.sleep(1)
    return match.attrib.get("content-desc", "")


def maybe_tap_text(serial: str, root: ET.Element, text: str, *, occurrence: int = -1) -> bool:
    matches = find_nodes(root, text=text)
    if not matches:
        return False
    bounds = parse_bounds(matches[occurrence].attrib["bounds"])
    x, y = center(bounds)
    adb(serial, "shell", "input", "tap", str(x), str(y), timeout=15)
    time.sleep(1)
    return True


def maybe_tap_text_containing(serial: str, root: ET.Element, text: str, *, occurrence: int = -1) -> bool:
    matches = find_nodes_containing(root, text=text)
    if not matches:
        return False
    bounds = parse_bounds(matches[occurrence].attrib["bounds"])
    x, y = center(bounds)
    adb(serial, "shell", "input", "tap", str(x), str(y), timeout=15)
    time.sleep(1)
    return True


def maybe_tap_content_desc(serial: str, root: ET.Element, content_desc: str, *, occurrence: int = -1) -> bool:
    matches = find_nodes_by_content_desc(root, content_desc)
    if not matches:
        return False
    bounds = parse_bounds(matches[occurrence].attrib["bounds"])
    x, y = center(bounds)
    adb(serial, "shell", "input", "tap", str(x), str(y), timeout=15)
    time.sleep(1)
    return True


def dismiss_system_dialogs(serial: str, root: ET.Element) -> bool:
    if root.attrib.get("package") == "android" or any((node.attrib.get("package") or "") == "android" for node in root.iter("node")):
        if find_nodes_containing(root, text="isn't responding"):
            if maybe_tap_text(serial, root, "Wait"):
                time.sleep(2)
                return True
            if maybe_tap_text(serial, root, "Close app"):
                time.sleep(2)
                return True
    return False


def wait_for_text(serial: str, text: str, ui_path: Path, *, timeout_s: float = 60.0) -> ET.Element:
    deadline = time.time() + timeout_s
    last_error = None
    while time.time() < deadline:
        try:
            root = dump_ui(serial, ui_path)
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            time.sleep(1)
            continue
        if dismiss_system_dialogs(serial, root):
            continue
        if find_nodes(root, text=text):
            return root
        time.sleep(1)
    raise HarnessError(f"UI text {text!r} did not appear; last_error={last_error}")


def wait_for_content_desc(serial: str, content_desc: str, ui_path: Path, *, timeout_s: float = 60.0) -> ET.Element:
    deadline = time.time() + timeout_s
    last_error = None
    while time.time() < deadline:
        try:
            root = dump_ui(serial, ui_path)
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            time.sleep(1)
            continue
        if dismiss_system_dialogs(serial, root):
            continue
        if find_nodes_by_content_desc(root, content_desc):
            return root
        time.sleep(1)
    raise HarnessError(f"UI content-desc {content_desc!r} did not appear; last_error={last_error}")


def wait_for_any_text(serial: str, texts: list[str], ui_path: Path, *, timeout_s: float = 60.0) -> tuple[ET.Element, str]:
    deadline = time.time() + timeout_s
    last_error = None
    while time.time() < deadline:
        try:
            root = dump_ui(serial, ui_path)
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            time.sleep(1)
            continue
        if dismiss_system_dialogs(serial, root):
            continue
        for text in texts:
            if find_nodes(root, text=text) or find_nodes_containing(root, text=text):
                return root, text
        time.sleep(1)
    raise HarnessError(f"None of the UI texts appeared: {texts}; last_error={last_error}")


def adb_input_text(serial: str, text: str) -> None:
    normalized = re.sub(r"\s+", "%s", text.strip())
    normalized = re.sub(r"[^A-Za-z0-9%._:/-]", "", normalized)
    if not normalized:
        raise HarnessError(f"Unable to enter empty/unsupported text: {text!r}")
    adb(serial, "shell", "input", "text", normalized, timeout=20)
    time.sleep(1)


def focus_and_type(serial: str, root: ET.Element, content_desc: str, text: str) -> None:
    tap_content_desc(serial, root, content_desc)
    adb_input_text(serial, text)


def wait_for_detail_prompt_ready(serial: str, ui_path: Path, *, timeout_s: float = 45.0) -> ET.Element:
    deadline = time.time() + timeout_s
    last_error = None
    while time.time() < deadline:
        try:
            root = dump_ui(serial, ui_path)
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            time.sleep(1)
            continue
        if dismiss_system_dialogs(serial, root):
            continue
        if find_nodes_by_content_desc(root, "detail-prompt-input") or find_nodes(root, text="New prompt"):
            return root
        if find_nodes_by_content_desc(root, "detail-tab-overview"):
            maybe_tap_content_desc(serial, root, "detail-tab-overview")
        time.sleep(1)
    raise HarnessError(f"Session detail prompt editor did not become ready; last_error={last_error}")


def runtime_entries() -> list[dict]:
    try:
        entries = beacon_entries()
    except Exception:
        return []
    return [
        entry for entry in entries
        if int(entry.get("hwnd") or 0) == 0 and entry.get("cmd_path")
    ]


def wait_for_new_runtime_entry(previous_ids: set[str], *, timeout_s: float = 120.0) -> dict:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        try:
            entries = runtime_entries()
        except Exception:
            entries = []
        for entry in entries:
            instance_id = str(entry.get("instance_id") or "")
            if instance_id and instance_id not in previous_ids:
                return entry
        time.sleep(1)
    raise HarnessError("No new Team App runtime beacon entry appeared")


def wait_for_runtime_entry_absent(instance_id: str, *, timeout_s: float = 90.0) -> None:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        ids = {str(entry.get("instance_id") or "") for entry in runtime_entries()}
        if instance_id not in ids:
            return
        time.sleep(1)
    raise HarnessError(f"Runtime beacon entry did not disappear: {instance_id}")


def scroll_until_text(serial: str, text: str, ui_path: Path, *, timeout_s: float = 30.0) -> ET.Element:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        root = dump_ui(serial, ui_path)
        if find_nodes(root, text=text) or find_nodes_containing(root, text=text):
            return root
        swipe(serial, 540, 1900, 540, 1250)
    raise HarnessError(f"UI text {text!r} did not become visible after scrolling")


def scroll_until_any_text(serial: str, texts: list[str], ui_path: Path, *, timeout_s: float = 30.0) -> tuple[ET.Element, str]:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        root = dump_ui(serial, ui_path)
        if dismiss_system_dialogs(serial, root):
            continue
        for text in texts:
            if find_nodes(root, text=text) or find_nodes_containing(root, text=text):
                return root, text
        swipe(serial, 540, 1850, 540, 1100)
    raise HarnessError(f"UI texts {texts!r} did not become visible after scrolling")


def scroll_until_content_desc(
    serial: str,
    content_desc: str,
    ui_path: Path,
    *,
    timeout_s: float = 30.0,
    minimum_height: int = 1,
) -> ET.Element:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        root = dump_ui(serial, ui_path)
        if dismiss_system_dialogs(serial, root):
            continue
        matches = find_nodes_by_content_desc(root, content_desc)
        if matches:
            left, top, right, bottom = parse_bounds(matches[-1].attrib["bounds"])
            if (bottom - top) >= minimum_height:
                return root
        swipe(serial, 540, 1900, 540, 1250)
    raise HarnessError(f"UI content-desc {content_desc!r} did not become visible after scrolling")


def scroll_until_content_desc_prefix(serial: str, prefix: str, ui_path: Path, *, timeout_s: float = 30.0) -> ET.Element:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        root = dump_ui(serial, ui_path)
        if dismiss_system_dialogs(serial, root):
            continue
        if find_nodes_by_content_desc_prefix(root, prefix):
            return root
        swipe(serial, 540, 1850, 540, 1100)
    raise HarnessError(f"UI content-desc prefix {prefix!r} did not become visible after scrolling")


def wait_for_open_sessions(serial: str, ui_path: Path, *, timeout_s: float = 45.0) -> ET.Element:
    deadline = time.time() + timeout_s
    refreshed = False
    while time.time() < deadline:
        root = dump_ui(serial, ui_path)
        if dismiss_system_dialogs(serial, root):
            continue
        if find_nodes_by_content_desc_prefix(root, "close-session-button-") or find_nodes_by_content_desc_prefix(root, "open-session-button-"):
            return root
        empty_state = find_nodes_containing(root, text="does not currently expose any open Team App sessions")
        if not refreshed or empty_state:
            if maybe_tap_text(serial, root, " Refresh") or maybe_tap_text(serial, root, "Refresh"):
                refreshed = True
                time.sleep(3)
                continue
        swipe(serial, 540, 1850, 540, 1100)
    raise HarnessError("Open session rows did not become visible")


def wait_for_sessions_prompt_ready(serial: str, ui_path: Path, *, timeout_s: float = 60.0) -> ET.Element:
    deadline = time.time() + timeout_s
    last_error = None
    while time.time() < deadline:
        try:
            root = dump_ui(serial, ui_path)
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            time.sleep(1)
            continue
        if dismiss_system_dialogs(serial, root):
            continue
        if find_nodes_by_content_desc(root, "start-session-prompt-input"):
            return root
        if find_nodes_by_content_desc(root, "nav-sessions"):
            maybe_tap_content_desc(serial, root, "nav-sessions")
        elif find_nodes(root, text="Sessions"):
            maybe_tap_text(serial, root, "Sessions")
        time.sleep(1)
    raise HarnessError(f"Sessions launch prompt did not become ready; last_error={last_error}")


def ensure_active_host_selected(serial: str, run_root: Path) -> ET.Element:
    sessions_root = dump_ui(serial, run_root / "screenshots" / "ensure-active-host-sessions.xml")
    offline = find_nodes_containing(sessions_root, text="Host is offline or unreachable")
    no_host = find_nodes_containing(sessions_root, text="No host selected")
    if not offline and not no_host:
        return sessions_root

    tap_content_desc(serial, sessions_root, "nav-hosts")
    wait_for_text(serial, "Saved Hosts", run_root / "screenshots" / "wait-saved-hosts.xml", timeout_s=60.0)
    hosts_root = scroll_until_any_text(
        serial,
        ["Use", "Selected"],
        run_root / "screenshots" / "wait-host-use.xml",
        timeout_s=45.0,
    )[0]
    if not maybe_tap_text(serial, hosts_root, "Use"):
        maybe_tap_text(serial, hosts_root, "Selected")
    tap_content_desc(serial, dump_ui(serial, run_root / "screenshots" / "return-to-sessions.xml"), "nav-sessions")
    refreshed_root = wait_for_text(serial, "Sessions", run_root / "screenshots" / "wait-sessions-after-host-select.xml", timeout_s=60.0)
    if find_nodes_containing(refreshed_root, text="No host selected"):
        raise HarnessError("Saved host selection did not activate a host for Sessions")
    return refreshed_root


def capture_step(serial: str, run_root: Path, name: str, note: str) -> dict[str, str]:
    screenshot_path = run_root / "screenshots" / f"{name}.png"
    ui_path = run_root / "screenshots" / f"{name}.xml"
    screencap(serial, screenshot_path)
    payload = {
        "name": name,
        "note": note,
        "screenshot_path": str(screenshot_path),
        "ui_dump_path": str(ui_path),
        "captured_at": time.time(),
    }
    try:
        dump_ui(serial, ui_path)
    except Exception as exc:  # noqa: BLE001
        payload["ui_dump_error"] = str(exc)
    with (run_root / "screenshots" / f"{name}.json").open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)
    return payload


def beacon_entries() -> list[dict]:
    deadline = time.time() + 30
    last_error = "beacon file is empty"
    while time.time() < deadline:
        if not BEACON_PATH.exists():
            last_error = f"beacon file not found: {BEACON_PATH}"
            time.sleep(1)
            continue
        try:
            raw = BEACON_PATH.read_text(encoding="utf-8").strip()
            if not raw:
                last_error = "beacon file is empty"
                time.sleep(1)
                continue
            entries = json.loads(raw)
        except json.JSONDecodeError as exc:
            last_error = f"beacon file is not valid JSON yet: {exc}"
            time.sleep(1)
            continue
        if not isinstance(entries, list) or not entries:
            last_error = "beacon file is empty"
            time.sleep(1)
            continue
        entries.sort(key=lambda item: int(item.get("heartbeat_ts") or 0), reverse=True)
        return entries
    raise HarnessError(last_error)


def latest_beacon_entry() -> dict:
    return beacon_entries()[0]


def capture_partner_for(instance: dict) -> dict:
    entries = beacon_entries()
    instance_id = str(instance.get("instance_id") or "")
    automation_prefix = str(instance.get("automation_prefix") or "")
    session_id = str(instance.get("session_id") or "")
    prefix_base = automation_prefix.removesuffix("_console")

    for entry in entries:
        if int(entry.get("hwnd") or 0) == 0:
            continue
        if session_id and str(entry.get("session_id") or "") == session_id:
            return entry
        entry_prefix = str(entry.get("automation_prefix") or "")
        if prefix_base and entry_prefix == prefix_base:
            return entry
        if instance_id and str(entry.get("instance_id") or "") == prefix_base:
            return entry

    raise HarnessError(f"No GUI Team App beacon entry found for capture: {automation_prefix or instance_id}")


def send_team_app_command(instance: dict, command: dict, *, timeout_s: float = 30.0) -> dict:
    cmd_path = Path(instance["cmd_path"])
    resp_path = Path(instance["resp_path"])
    seq = 0
    if resp_path.exists():
        for line in resp_path.read_text(encoding="utf-8", errors="replace").splitlines():
            if not line.strip():
                continue
            seq = max(seq, int(json.loads(line).get("seq") or 0))
    seq += 1
    payload = {"seq": seq, **command}
    tmp = cmd_path.with_suffix(cmd_path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload), encoding="utf-8")
    os.replace(tmp, cmd_path)

    deadline = time.time() + timeout_s
    while time.time() < deadline:
        if resp_path.exists():
            for line in resp_path.read_text(encoding="utf-8", errors="replace").splitlines():
                if not line.strip():
                    continue
                response = json.loads(line)
                if int(response.get("seq") or 0) == seq:
                    return response
        time.sleep(0.2)
    raise HarnessError(f"Team App command timed out: {command['cmd']}")


def capture_team_app(runtime_entry: dict, run_root: Path, name: str) -> dict[str, str]:
    inspect_path = run_root / "screenshots" / f"{name}-team-app-inspect.json"
    inspect = send_team_app_command(
        runtime_entry,
        {"cmd": "inspect", "include_chat": True, "include_summary": True, "include_terminals": True},
        timeout_s=45.0,
    )
    inspect_path.write_text(json.dumps(inspect, indent=2), encoding="utf-8")
    payload = {
        "team_app_inspect_path": str(inspect_path),
        "team_app_runtime_instance_id": str(runtime_entry.get("instance_id") or ""),
    }
    try:
        capture_entry = capture_partner_for(runtime_entry)
        bmp_path = run_root / "screenshots" / f"{name}-team-app.bmp"
        capture = send_team_app_command(capture_entry, {"cmd": "capture_window", "path": str(bmp_path)})
        if capture.get("status") == "ok" and bmp_path.exists():
            payload["team_app_capture_path"] = str(bmp_path)
            payload["team_app_capture_instance_id"] = str(capture_entry.get("instance_id") or "")
        else:
            payload["team_app_capture_error"] = f"capture_window failed: {capture}"
    except Exception as exc:  # noqa: BLE001
        payload["team_app_capture_error"] = str(exc)
    return payload


def inspect_runtime(runtime_entry: dict) -> dict:
    return send_team_app_command(
        runtime_entry,
        {"cmd": "inspect", "include_chat": True, "include_summary": True, "include_terminals": True},
        timeout_s=45.0,
    )


def cleanup_screenshots(run_root: Path) -> None:
    shutil.rmtree(run_root / "screenshots", ignore_errors=True)


def run_flow(args: argparse.Namespace) -> dict:
    run_root = ARTIFACT_ROOT / time.strftime("run-%Y%m%d-%H%M%S")
    (run_root / "screenshots").mkdir(parents=True, exist_ok=True)

    serial = ensure_emulator(args.avd)
    host_process = None
    result: dict[str, object] = {
        "run_root": str(run_root),
        "serial": serial,
        "steps": [],
        "success": False,
        "screenshots_cleaned": False,
    }

    try:
        if args.host_url:
            base_url = args.host_url
            pairing_code = args.pairing_code or ""
        else:
            host_process, pairing_code, stdout_log, stderr_log = start_host()
            if stdout_log is not None:
                result["host_stdout_log"] = str(stdout_log)
            if stderr_log is not None:
                result["host_stderr_log"] = str(stderr_log)
            base_url = DEFAULT_BASE_URL

        if not http_ok("http://127.0.0.1:18765/healthz"):
            raise HarnessError("MagicHat host health endpoint did not respond")

        build_and_install(serial, skip_build=args.skip_build)
        reset_app_state(serial)

        launch_app(serial)
        try:
            wait_for_text(serial, "Pair New Host", run_root / "screenshots" / "wait-hosts.xml", timeout_s=90.0)
        except Exception:
            reset_app_state(serial)
            launch_app(serial)
            wait_for_text(serial, "Pair New Host", run_root / "screenshots" / "wait-hosts-retry.xml", timeout_s=90.0)
        result["steps"].append(capture_step(serial, run_root, "01_hosts_initial", "Fresh app launch on the Hosts screen after the splash screen clears."))

        launch_app(
            serial,
            extras={
                "magichat.automation.lan_base_url": base_url,
                "magichat.automation.pairing_code": get_stable_local_pairing_code() or pairing_code,
            },
        )
        wait_for_text(serial, "Advanced LAN Pairing", run_root / "screenshots" / "wait-lan-ready.xml", timeout_s=90.0)
        result["steps"].append(capture_step(serial, run_root, "02_lan_prefilled", "LAN pairing fields prefilled by automation extras before any UI interaction."))

        lan_root = dump_ui(serial, run_root / "screenshots" / "lan-before-expand.xml")
        if not find_nodes_by_content_desc(lan_root, "probe-host-button"):
            if not maybe_tap_content_desc(serial, lan_root, "Expand LAN pairing"):
                maybe_tap_text(serial, lan_root, "Advanced LAN Pairing")
        lan_root, _ = scroll_until_any_text(
            serial,
            ["Probe Host", "probe-host-button"],
            run_root / "screenshots" / "wait-probe-host.xml",
            timeout_s=45.0,
        )
        if find_nodes_by_content_desc(lan_root, "probe-host-button"):
            tap_content_desc(serial, lan_root, "probe-host-button")
        else:
            if not maybe_tap_text(serial, lan_root, "Probe Host"):
                if not maybe_tap_text_containing(serial, lan_root, "Probe Host"):
                    raise HarnessError("Probe Host button was visible but could not be tapped")
        wait_for_any_text(serial, ["LAN Hosts", "Team App Host"], run_root / "screenshots" / "wait-lan-hosts.xml", timeout_s=45.0)
        result["steps"].append(capture_step(serial, run_root, "03_host_probed", "Host probe completed and the LAN host card became visible."))

        pair_root, _ = scroll_until_any_text(
            serial,
            ["Pair LAN Host", "Use This Host"],
            run_root / "screenshots" / "wait-pair-lan-host.xml",
            timeout_s=45.0,
        )
        if find_nodes_by_content_desc(pair_root, "pair-lan-host-button"):
            tap_content_desc(serial, pair_root, "pair-lan-host-button")
        else:
            if not maybe_tap_text(serial, pair_root, "Pair LAN Host"):
                if not maybe_tap_text(serial, pair_root, "Use This Host"):
                    raise HarnessError("No visible LAN pairing action was available")
        post_pair_root = dump_ui(serial, run_root / "screenshots" / "after-pair.xml")
        if not find_nodes(post_pair_root, text="Start Session"):
            maybe_tap_text(serial, post_pair_root, "Sessions")
        wait_for_text(serial, "Start Session", run_root / "screenshots" / "wait-sessions.xml", timeout_s=90.0)
        ensure_active_host_selected(serial, run_root)
        wait_for_sessions_prompt_ready(
            serial,
            run_root / "screenshots" / "wait-sessions-prompt-ready.xml",
            timeout_s=45.0,
        )
        result["steps"].append(capture_step(serial, run_root, "04_sessions_paired", "Host paired over LAN through the visible UI and Sessions loaded."))

        sessions_root = wait_for_sessions_prompt_ready(
            serial,
            run_root / "screenshots" / "wait-start-session-input.xml",
            timeout_s=45.0,
        )
        focus_and_type(serial, sessions_root, "start-session-prompt-input", args.prompt)
        result["steps"].append(capture_step(serial, run_root, "05_session_prompt_ready", "Sessions screen with the launch prompt entered through the visible UI."))

        previous_runtime_ids = {str(entry.get("instance_id") or "") for entry in runtime_entries()}
        sessions_root = wait_for_content_desc(
            serial,
            "start-session-button",
            run_root / "screenshots" / "wait-start-session-button.xml",
            timeout_s=30.0,
        )
        tap_content_desc(serial, sessions_root, "start-session-button")
        result["steps"].append(capture_step(serial, run_root, "06_session_launching", "Start Session pressed from the paired Sessions screen."))

        beacon_entry = wait_for_new_runtime_entry(previous_runtime_ids, timeout_s=180.0)
        wait_for_content_desc(
            serial,
            "detail-send-prompt-button",
            run_root / "screenshots" / "wait-detail-actions.xml",
            timeout_s=180.0,
        )
        result["steps"].append(capture_step(serial, run_root, "07_session_detail", "Session detail screen after Team App launched and the session became controllable."))
        result["team_app_initial"] = capture_team_app(beacon_entry, run_root, "07_session_detail")

        detail_root = dump_ui(serial, run_root / "screenshots" / "trust-check.xml")
        if find_nodes(detail_root, text="Project Trust Required"):
            result["steps"].append(capture_step(serial, run_root, "08_trust_prompt", "Session detail showed a project trust prompt."))
            tap_content_desc(serial, detail_root, "trust-approve-button")
            wait_for_content_desc(
                serial,
                "detail-send-prompt-button",
                run_root / "screenshots" / "wait-after-trust.xml",
                timeout_s=90.0,
            )
            result["steps"].append(capture_step(serial, run_root, "09_trust_approved", "Project trust approved from the Android UI."))

        prompt_text = "android prompt status summary"
        detail_root = wait_for_detail_prompt_ready(
            serial,
            run_root / "screenshots" / "wait-detail-prompt-input.xml",
            timeout_s=45.0,
        )
        if find_nodes_by_content_desc(detail_root, "detail-prompt-input"):
            focus_and_type(serial, detail_root, "detail-prompt-input", prompt_text)
        else:
            tap_text(serial, detail_root, "New prompt")
            adb_input_text(serial, prompt_text)
        send_root = wait_for_content_desc(
            serial,
            "detail-send-prompt-button",
            run_root / "screenshots" / "wait-detail-send-prompt.xml",
            timeout_s=30.0,
        )
        tap_content_desc(serial, send_root, "detail-send-prompt-button")
        time.sleep(5)
        result["steps"].append(capture_step(serial, run_root, "10_prompt_sent", "Prompt sent from the Android Session screen."))
        result["team_app_after_prompt"] = capture_team_app(beacon_entry, run_root, "10_prompt_sent")

        follow_up_text = "android follow up smallest fix"
        detail_root = wait_for_content_desc(
            serial,
            "detail-follow-up-input",
            run_root / "screenshots" / "wait-detail-follow-up-input.xml",
            timeout_s=45.0,
        )
        focus_and_type(serial, detail_root, "detail-follow-up-input", follow_up_text)
        send_root = wait_for_content_desc(
            serial,
            "detail-send-follow-up-button",
            run_root / "screenshots" / "wait-detail-send-follow-up.xml",
            timeout_s=30.0,
        )
        tap_content_desc(serial, send_root, "detail-send-follow-up-button")
        time.sleep(5)
        result["steps"].append(capture_step(serial, run_root, "11_follow_up_sent", "Follow-up sent from the Android Session screen."))
        result["team_app_after_follow_up"] = capture_team_app(beacon_entry, run_root, "11_follow_up_sent")

        nav_root = dump_ui(serial, run_root / "screenshots" / "before-close-nav.xml")
        tap_content_desc(serial, nav_root, "nav-sessions")
        wait_for_text(serial, "Sessions", run_root / "screenshots" / "wait-open-sessions.xml", timeout_s=60.0)
        wait_for_open_sessions(
            serial,
            run_root / "screenshots" / "wait-open-sessions-ready.xml",
            timeout_s=60.0,
        )
        sessions_root = scroll_until_content_desc_prefix(
            serial,
            "close-session-button-",
            run_root / "screenshots" / "sessions-before-close.xml",
            timeout_s=45.0,
        )
        tap_content_desc_prefix(serial, sessions_root, "close-session-button-")
        confirm_root = wait_for_text(serial, "Close session?", run_root / "screenshots" / "wait-close-confirm.xml", timeout_s=30.0)
        tap_text(serial, confirm_root, "Close session")
        wait_for_runtime_entry_absent(str(beacon_entry.get("instance_id") or ""), timeout_s=120.0)
        time.sleep(3)
        result["steps"].append(capture_step(serial, run_root, "12_session_closed", "Session closed from the Android Sessions screen and disappeared from Team App beacon runtime entries."))

        sessions_root = wait_for_content_desc(
            serial,
            "restore-session-button",
            run_root / "screenshots" / "wait-restore-card.xml",
            timeout_s=60.0,
        )
        if not maybe_tap_text(serial, sessions_root, "Use"):
            raise HarnessError("No restore ref chip was available to drive the restore flow")
        sessions_root = wait_for_content_desc(
            serial,
            "restore-session-button",
            run_root / "screenshots" / "wait-restore-button.xml",
            timeout_s=30.0,
        )
        post_close_ids = {str(entry.get("instance_id") or "") for entry in runtime_entries()}
        tap_content_desc(serial, sessions_root, "restore-session-button")
        restored_entry = wait_for_new_runtime_entry(post_close_ids, timeout_s=180.0)
        wait_for_detail_prompt_ready(
            serial,
            run_root / "screenshots" / "wait-restored-detail.xml",
            timeout_s=180.0,
        )
        result["steps"].append(capture_step(serial, run_root, "13_session_restored", "Restore flow reopened a Team App session from the Android Sessions screen."))
        result["team_app_after_restore"] = capture_team_app(restored_entry, run_root, "13_session_restored")

        result["success"] = True
        return result
    finally:
        adb(serial, "shell", "am", "force-stop", PACKAGE_ID, timeout=15, check=False)
        try:
            for entry in runtime_entries():
                if entry.get("cmd_path") and Path(entry["cmd_path"]).exists():
                    send_team_app_command(entry, {"cmd": "close_app"}, timeout_s=10.0)
        except Exception:
            pass
        stop_process(host_process)


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the Android emulator MagicHat visual E2E flow.")
    parser.add_argument("--avd", default=DEFAULT_AVD, help="Android Virtual Device name.")
    parser.add_argument("--skip-build", action="store_true", help="Reuse the existing debug APK.")
    parser.add_argument("--keep-screenshots", action="store_true", help="Keep per-step screenshots and UI dumps after a successful run.")
    parser.add_argument("--host-url", default="", help="Reuse an already-running host URL instead of starting a local host.")
    parser.add_argument("--pairing-code", default="", help="Pairing code for --host-url runs.")
    parser.add_argument("--prompt", default=DEFAULT_PROMPT, help="Initial prompt to prefill before launching the session.")
    args = parser.parse_args()

    try:
        result = run_flow(args)
    except Exception as exc:  # noqa: BLE001
        failure = {
            "success": False,
            "error": str(exc),
        }
        ARTIFACT_ROOT.mkdir(parents=True, exist_ok=True)
        (ARTIFACT_ROOT / "last-result.json").write_text(json.dumps(failure, indent=2), encoding="utf-8")
        print(json.dumps(failure, indent=2))
        return 1

    run_root = Path(result["run_root"])
    if result.get("success") and not args.keep_screenshots:
        cleanup_screenshots(run_root)
        result["screenshots_cleaned"] = True

    (run_root / "result.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    (ARTIFACT_ROOT / "last-result.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
