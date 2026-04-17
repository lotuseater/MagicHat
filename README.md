# MagicHat

MagicHat is a mobile control surface for `Wizard_Erasmus` Team App instances, with both LAN v1 control and relay-backed remote v2 access.

Current v1 scope:

- Windows host service that discovers Team App instances from the Team App beacon
- Android client for pairing, instance list/detail, prompt/follow-up, trust handling, and restore-by-ref
- Contract lock files that pin MagicHat to the current Team App automation surface
- Local mock-host and transport tests so the mobile side can be exercised without a real Windows box

## Repo Layout

- `host/` — Node/Express host service that pairs devices and proxies Team App beacon/file-IPC
- `relay/` — Node/Express/WebSocket remote relay for secure off-LAN mobile access
- `mobile/android/` — Android client
- `mobile/ios/` — iOS shell/runtime and relay/LAN client support
- `docs/architecture/` — forward-looking v2 remote-access and system design work
- `docs/contract/` — locked Team App + MagicHat API surface
- `tests/` — host tests, Android transport tests, integration fixtures, and iOS smoke probes

## Host Contract

The current host API is documented in [docs/contract/magichat_api_v1.yaml](docs/contract/magichat_api_v1.yaml).

Key routes:

- `POST /v1/pairing/session`
- `GET /v1/host`
- `GET /v1/instances`
- `GET /v1/restore-refs`
- `POST /v1/instances`
- `GET /v1/instances/{pid}`
- `DELETE /v1/instances/{pid}`
- `POST /v1/instances/{pid}/prompt`
- `POST /v1/instances/{pid}/follow-up`
- `POST /v1/instances/{pid}/trust`
- `POST /v1/instances/{pid}/restore`
- `GET /v1/instances/{pid}/updates`
- `GET /v1/instances/{pid}/poll`

MagicHat v1 prefers the Team App product actions `close_instance`, `submit_initial_prompt`, `submit_follow_up`, and `restore_session` over legacy UI command choreography.

## Remote Access Direction

MagicHat v1 is intentionally LAN-only.

The proposed secure remote-access architecture for v2 is documented in [docs/architecture/remote_access_v2.md](docs/architecture/remote_access_v2.md).

The concrete wire contract and threat model for the first implementation are now documented in:

- [docs/architecture/remote_protocol_v2.md](docs/architecture/remote_protocol_v2.md)
- [docs/security/remote_threat_model_v2.md](docs/security/remote_threat_model_v2.md)

## Quick Start: Pair an Android Device

There are two pairing modes. Pick the one that matches where the phone will live.

### A. LAN pairing (same Wi-Fi as the PC) — no QR needed

1. Build/install the Android app once:
   ```bash
   pwsh scripts/mobile-validation/build_and_run_android.ps1
   ```
   (Or double-click `scripts/mobile-validation/build_and_run_android.bat`.) This builds the debug APK and `adb install`s it on an attached phone or running emulator.
2. Start the host on the PC:
   ```bash
   cd host
   npm install        # first run only
   npm start
   ```
   It prints, e.g.:
   ```
   MagicHat host listening on http://0.0.0.0:18765
   Pairing code: 4F7K-9PLQ (expires at 2026-04-17T20:05:00.000Z)
   ```
   The pairing code lasts 5 min; fetch a fresh one any time without restarting via:
   ```bash
   node scripts/print_pairing_code.js
   ```
3. Find the PC's LAN IP (`ipconfig` on Windows → look for IPv4 on your Wi-Fi adapter, e.g. `192.168.1.10`).
4. On the phone, open MagicHat and on the **Paired PC Selection** screen:
   - **PC Host Base URL (LAN)**: `http://192.168.1.10:18765/`
   - Tap **Probe Host** to confirm it answers.
   - **One-Time Pairing Code**: paste the code from step 2.
   - Tap **Pair Host**.
5. Instances from every running Team App on the PC appear under that host. Use the host list to switch between paired PCs.

### B. Remote QR pairing (phone off-LAN, via relay)

One PC action — start the loopback relay + host, pop the QR, and prompt once to approve the phone:

```powershell
pwsh scripts/remote-validation/pair_remote.ps1
```
(Or double-click `scripts/remote-validation/pair_remote.bat`; on macOS/Linux use `./scripts/remote-validation/pair_remote.sh`.)

The script:

1. Starts the relay on `127.0.0.1:18795` and the host on `127.0.0.1:18765`, pointing the host at the relay (dev loopback HTTP, allowed only on localhost).
2. Calls `POST /admin/v2/remote/bootstrap` and opens the generated QR in your default viewer. The raw `magichat://pair?...` URI is also printed if you need to paste it.
3. Watches `/admin/v2/remote/pending-devices`. When the phone scans the QR it registers a claim; the script prints the device name + platform and asks `Approve? [y/N/q]`. Press `y` and the phone completes registration over the relay.
4. Keeps the host + relay running so the phone stays online. Ctrl+C stops both.

Revoke a paired device later with `DELETE /admin/v2/remote/devices/<device_id>`.

For production: swap the loopback relay for an HTTPS one — set `MAGICHAT_RELAY_CERTIFICATE_PINSET_VERSION=v1` on the relay and build the Android app with the matching pin hashes via `MAGICHAT_ANDROID_RELAY_PINSET_V1=sha256/...[,sha256/...]` (Gradle property or env var). Mobile clients fail closed on unknown pinset versions.

## Development

Host tests:

```bash
cd host
npm test
```

Relay tests:

```bash
cd relay
npm test
```

Loopback relay dev start:

```bash
./scripts/remote-validation/start_relay.sh
```

Remote relay round-trip smoke:

```bash
node ./scripts/remote-validation/remote_roundtrip_smoke.mjs
```

Remote stack fixture for client-runtime smoke:

```bash
node ./scripts/remote-validation/start_remote_stack_fixture.mjs
```

Python transport tests:

```bash
python3 -m pytest tests -q
```

Focused Android transport checks:

```bash
python3 -m pytest tests/android/android_transport_scenarios_test.py -q
```

Contract gate:

```bash
./scripts/bootstrap/verify_contract_lock.sh
```

Android build:

```bash
./scripts/mobile-validation/android_build.sh
```

Sequential Android validation:

```bash
./scripts/mobile-validation/android_validate.sh
```

Android remote client smoke:

```bash
./scripts/mobile-validation/android_remote_client_smoke.sh
```

Android unit tests:

```bash
./scripts/mobile-validation/android_unit_tests.sh
```

Local mock host for mobile smoke checks:

```bash
./scripts/mobile-validation/start_mock_host.sh
```

iOS smoke package against the local mock host:

```bash
MAGICHAT_HOST_URL=http://127.0.0.1:18787 ./scripts/mobile-validation/ios_smoke.sh
```

iOS source typecheck:

```bash
./scripts/mobile-validation/ios_typecheck.sh
```

iOS core package tests:

```bash
./scripts/mobile-validation/ios_core_tests.sh
```

## Notes

- The Android client still assumes a manually entered base URL for direct LAN pairing unless you use a `magichat://...` pairing URI.
- The Android client now supports both LAN pairing and v2 remote pairing from a `magichat://pair?...` URI, including Android deep-link intake for QR scans that resolve to that URI.
- Remote relay URLs must use HTTPS unless they target a true local development relay such as `localhost`, `127.0.0.1`, or the Android emulator host alias `10.0.2.2`.
- Mobile clients now fail closed on unknown relay certificate pinset versions instead of silently accepting them.
- Production relay pinning is configured by having the relay advertise `MAGICHAT_RELAY_CERTIFICATE_PINSET_VERSION` and building Android with matching pin hashes such as `MAGICHAT_ANDROID_RELAY_PINSET_V1=sha256/...[,sha256/...]`.
- Remote pairing requires the host-local admin surface on `http://127.0.0.1:<host-port>/admin/v2/remote/*` to generate a bootstrap URI/QR and approve new devices.
- The relay is trusted for payload visibility in v2.0, but the envelopes and stored metadata are versioned so later end-to-end encrypted payloads can be added without breaking paired hosts.
- LAN and remote restore now both prefer opaque host-generated restore refs; direct LAN callers may still send a raw `session_restore.json` path for compatibility/debugging, but the mobile apps no longer need to expose that path model by default.
- The relay now enforces a clearer startup rule: loopback-only development may use HTTP, while non-loopback binds require TLS certificate paths or an explicit insecure override.
- The mobile validation scripts auto-detect Homebrew Android SDK and JDK 17 paths on macOS, but they still honor explicit `JAVA_HOME`, `ANDROID_HOME`, `ANDROID_SDK_ROOT`, `MAGICHAT_HOST_URL`, and `DEVELOPER_DIR` overrides.
- The repo now has a real git `HEAD`, so follow-up contract pins should use normal commits plus the contract gate hash rather than treating `GATE_1_CONTRACT_SHA` like a commit id.
