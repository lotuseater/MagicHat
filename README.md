# MagicHat

MagicHat is a LAN-only mobile control surface for `Wizard_Erasmus` Team App instances.

Current v1 scope:

- Windows host service that discovers Team App instances from the Team App beacon
- Android client for pairing, instance list/detail, prompt/follow-up, and restore-by-path
- Contract lock files that pin MagicHat to the current Team App automation surface
- Local mock-host and transport tests so the mobile side can be exercised without a real Windows box

## Repo Layout

- `host/` — Node/Express host service that pairs devices and proxies Team App beacon/file-IPC
- `mobile/android/` — Android client
- `mobile/ios/` — early iOS shell/runtime work
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

## Development

Host tests:

```bash
cd host
npm test
```

Python transport tests:

```bash
python3 -m pytest tests -q
```

Contract gate:

```bash
./scripts/bootstrap/verify_contract_lock.sh
```

Android build:

```bash
cd mobile/android
./gradlew assembleDebug
```

## Notes

- The Android client currently assumes a manually entered base URL for the paired PC host.
- Restore on mobile uses the Team App `session_restore.json` path that exists on the paired PC.
- The repo now has a real git `HEAD`, so follow-up contract pins should use normal commits plus the contract gate hash rather than treating `GATE_1_CONTRACT_SHA` like a commit id.
