# MagicHat

MagicHat is a LAN-only mobile control surface for `Wizard_Erasmus` Team App instances.

Current v1 scope:

- Windows host service that discovers Team App instances from the Team App beacon
- Android client for pairing, instance list/detail, prompt/follow-up, and restore-by-path
- Contract lock files that pin MagicHat to the current Team App automation surface
- Local mock-host and transport tests so the mobile side can be exercised without a real Windows box

## Repo Layout

- `host/` — Node/Express host service that pairs devices and proxies Team App beacon/file-IPC
- `relay/` — Node/Express/WebSocket remote relay for secure off-LAN mobile access
- `mobile/android/` — Android client
- `mobile/ios/` — early iOS shell/runtime work
- `docs/architecture/` — forward-looking v2 remote-access and system design work
- `docs/contract/` — locked Team App + MagicHat API surface
- `tests/` — host tests, Android transport tests, integration fixtures, and iOS smoke probes

## Host Contract

The current host API is documented in [docs/contract/magichat_api_v1.yaml](docs/contract/magichat_api_v1.yaml).

Key routes:

- `POST /v1/pairing/session`
- `GET /v1/host`
- `GET /v1/instances`
- `POST /v1/instances`
- `GET /v1/instances/{pid}`
- `DELETE /v1/instances/{pid}`
- `POST /v1/instances/{pid}/prompt`
- `POST /v1/instances/{pid}/follow-up`
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

## Notes

- The Android client currently assumes a manually entered base URL for the paired PC host.
- The Android client now supports both LAN pairing and v2 remote pairing from a `magichat://pair?...` URI.
- Remote pairing requires the host-local admin surface on `http://127.0.0.1:<host-port>/admin/v2/remote/*` to generate a bootstrap URI/QR and approve new devices.
- The relay is trusted for payload visibility in v2.0, but the envelopes and stored metadata are versioned so later end-to-end encrypted payloads can be added without breaking paired hosts.
- LAN restore still uses the Team App `session_restore.json` path on the paired PC; remote restore uses opaque host-generated restore refs so raw Team App filesystem paths do not leave the PC.
- The relay now enforces a clearer startup rule: loopback-only development may use HTTP, while non-loopback binds require TLS certificate paths or an explicit insecure override.
- The mobile validation scripts auto-detect Homebrew Android SDK and JDK 17 paths on macOS, but they still honor explicit `JAVA_HOME`, `ANDROID_HOME`, `ANDROID_SDK_ROOT`, `MAGICHAT_HOST_URL`, and `DEVELOPER_DIR` overrides.
- The repo now has a real git `HEAD`, so follow-up contract pins should use normal commits plus the contract gate hash rather than treating `GATE_1_CONTRACT_SHA` like a commit id.
