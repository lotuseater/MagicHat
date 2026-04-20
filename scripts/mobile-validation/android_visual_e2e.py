#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
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


def get_live_local_pairing_code() -> str:
    try:
        with urllib.request.urlopen("http://127.0.0.1:18765/admin/v1/pairing", timeout=5) as response:
            payload = json.loads(response.read().decode("utf-8"))
            return str(payload.get("pairing_code") or "").strip()
    except Exception:
        return ""


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
    adb(serial, "shell", "am", "force-stop", PACKAGE_ID, timeout=15)
    cmd = [ADB, "-s", serial, "shell", "am", "start", "-W", "-n", MAIN_ACTIVITY]
    for key, value in (extras or {}).items():
        if isinstance(value, bool):
            cmd.extend(["--ez", key, "true" if value else "false"])
        else:
            cmd.extend(["--es", key, value])
    run(cmd, timeout=30)
    adb(serial, "shell", "input", "keyevent", "82", timeout=15, check=False)
    time.sleep(1)


def dump_ui(serial: str, target: Path, *, attempts: int = 3) -> ET.Element:
    target.parent.mkdir(parents=True, exist_ok=True)
    last_error: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            adb(serial, "shell", "uiautomator", "dump", "/sdcard/window_dump.xml", timeout=30)
            xml_text = adb(serial, "shell", "cat", "/sdcard/window_dump.xml", timeout=30).stdout
            target.write_text(xml_text, encoding="utf-8")
            return ET.fromstring(xml_text)
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            if attempt == attempts:
                break
            time.sleep(2)
    raise HarnessError(f"uiautomator dump failed after {attempts} attempts: {last_error}")


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
        if find_nodes(root, text=text):
            return root
        time.sleep(1)
    raise HarnessError(f"UI text {text!r} did not appear; last_error={last_error}")


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
        for text in texts:
            if find_nodes(root, text=text) or find_nodes_containing(root, text=text):
                return root, text
        time.sleep(1)
    raise HarnessError(f"None of the UI texts appeared: {texts}; last_error={last_error}")


def scroll_until_text(serial: str, text: str, ui_path: Path, *, timeout_s: float = 30.0) -> ET.Element:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        root = dump_ui(serial, ui_path)
        if find_nodes(root, text=text):
            return root
        swipe(serial, 540, 1900, 540, 1250)
    raise HarnessError(f"UI text {text!r} did not become visible after scrolling")


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
        matches = find_nodes_by_content_desc(root, content_desc)
        if matches:
            left, top, right, bottom = parse_bounds(matches[-1].attrib["bounds"])
            if (bottom - top) >= minimum_height:
                return root
        swipe(serial, 540, 1900, 540, 1250)
    raise HarnessError(f"UI content-desc {content_desc!r} did not become visible after scrolling")


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
    if not BEACON_PATH.exists():
        raise HarnessError(f"beacon file not found: {BEACON_PATH}")
    entries = json.loads(BEACON_PATH.read_text(encoding="utf-8"))
    if not isinstance(entries, list) or not entries:
        raise HarnessError("beacon file is empty")
    entries.sort(key=lambda item: int(item.get("heartbeat_ts") or 0), reverse=True)
    return entries


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
    capture_entry = capture_partner_for(runtime_entry)
    bmp_path = run_root / "screenshots" / f"{name}-team-app.bmp"
    inspect_path = run_root / "screenshots" / f"{name}-team-app-inspect.json"
    capture = send_team_app_command(capture_entry, {"cmd": "capture_window", "path": str(bmp_path)})
    if capture.get("status") != "ok" or not bmp_path.exists():
        raise HarnessError(f"Team App capture failed: {capture}")
    inspect = send_team_app_command(
        runtime_entry,
        {"cmd": "inspect", "include_chat": True, "include_summary": True, "include_terminals": True},
        timeout_s=45.0,
    )
    inspect_path.write_text(json.dumps(inspect, indent=2), encoding="utf-8")
    return {
        "team_app_capture_path": str(bmp_path),
        "team_app_inspect_path": str(inspect_path),
        "team_app_capture_instance_id": str(capture_entry.get("instance_id") or ""),
        "team_app_runtime_instance_id": str(runtime_entry.get("instance_id") or ""),
    }


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

        launch_app(serial)
        wait_for_text(serial, "Pair New Host", run_root / "screenshots" / "wait-hosts.xml", timeout_s=90.0)
        result["steps"].append(capture_step(serial, run_root, "01_hosts_initial", "Fresh app launch on the Hosts screen after the splash screen clears."))

        launch_app(
            serial,
            extras={
                "magichat.automation.lan_base_url": base_url,
                "magichat.automation.pairing_code": pairing_code,
                "magichat.automation.launch_prompt": args.prompt,
            },
        )
        wait_for_text(serial, "Advanced LAN Pairing", run_root / "screenshots" / "wait-lan-ready.xml", timeout_s=90.0)
        result["steps"].append(capture_step(serial, run_root, "02_lan_prefilled", "LAN pairing fields prefilled by automation extras before any UI interaction."))

        lan_root = scroll_until_content_desc(
            serial,
            "probe-host-button",
            run_root / "screenshots" / "wait-probe-host.xml",
            timeout_s=30.0,
        )
        tap_content_desc(serial, lan_root, "probe-host-button")
        wait_for_any_text(serial, ["LAN Hosts", "Team App Host"], run_root / "screenshots" / "wait-lan-hosts.xml", timeout_s=45.0)
        result["steps"].append(capture_step(serial, run_root, "03_host_probed", "Host probe completed and the LAN host card became visible."))

        pair_root = scroll_until_content_desc(
            serial,
            "pair-lan-host-button",
            run_root / "screenshots" / "wait-pair-lan-host.xml",
            timeout_s=20.0,
        )
        tap_content_desc(serial, pair_root, "pair-lan-host-button")
        wait_for_text(serial, "Start Session", run_root / "screenshots" / "wait-sessions.xml", timeout_s=90.0)
        result["steps"].append(capture_step(serial, run_root, "04_sessions_paired", "Host paired over LAN through the visible UI and Sessions loaded."))

        sessions_root = scroll_until_content_desc(
            serial,
            "start-session-button",
            run_root / "screenshots" / "sessions-before-start.xml",
            timeout_s=45.0,
            minimum_height=40,
        )
        tap_content_desc(serial, sessions_root, "start-session-button")
        result["steps"].append(capture_step(serial, run_root, "05_session_launching", "Start Session pressed from the paired Sessions screen."))

        wait_for_any_text(
            serial,
            ["Session", "Actions", "Project Trust Required"],
            run_root / "screenshots" / "wait-detail.xml",
            timeout_s=120.0,
        )
        result["steps"].append(capture_step(serial, run_root, "06_session_detail", "Session detail screen after the host launched Team App."))

        deadline = time.time() + 90
        beacon_entry = None
        while time.time() < deadline:
            try:
                beacon_entry = latest_beacon_entry()
                if beacon_entry.get("cmd_path") and Path(beacon_entry["cmd_path"]).exists():
                    break
            except Exception:  # noqa: BLE001
                pass
            time.sleep(1)
        if not beacon_entry:
            raise HarnessError("Team App beacon entry never became available")

        result["team_app"] = capture_team_app(beacon_entry, run_root, "06_session_detail")
        result["success"] = True
        return result
    finally:
        adb(serial, "shell", "am", "force-stop", PACKAGE_ID, timeout=15, check=False)
        try:
            entry = latest_beacon_entry()
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
