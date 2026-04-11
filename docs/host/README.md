# MagicHat Host Service (Subworker 2)

## Scope
Windows-only PC host service for mobile control of Team App instances.

- LAN-only access policy (private/loopback source IP required).
- One-time pairing code generated on the PC host.
- Bearer session token after pairing.
- Beacon + file IPC adapter over Team App automation contract.
- HTTP + SSE transport for mobile clients.

## Contract Source
Host routes are aligned to `docs/contract/magichat_api_v1.yaml`.

## Team App Command Mapping
The host forwards only Team App commands in the contract:

- `POST /v1/instances/{pid}/prompt` -> `submit_initial_prompt`
- `POST /v1/instances/{pid}/follow-up` -> `submit_follow_up`
- `POST /v1/instances/{pid}/restore` -> `restore_session`
- `GET /v1/instances/{pid}` and `GET /v1/instances/{pid}/poll` -> `inspect`
- `DELETE /v1/instances/{pid}` -> `close_instance` then lifecycle close verification
- `GET /v1/instances/{pid}/updates` -> `events_path` tail, fallback inspect polling

Beacon fields consumed: `instance_id`, `pid`, `hwnd`, `session_id`, `phase`, `cmd_path`, `resp_path`, `events_path`, `run_artifact_dir`, `run_log_path`, `restore_state_path`, `result_summary`, `health`, `started_at`.

## API Surface
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

## Run
From `MagicHat/host`:

```bash
npm install
npm start
```

Environment variables:

- `MAGICHAT_BIND_HOST` (default `0.0.0.0`)
- `MAGICHAT_PORT` (default `18765`)
- `MAGICHAT_BEACON_PATH`
- `MAGICHAT_STATE_PATH`
- `MAGICHAT_TEAM_APP_CMD`
- `MAGICHAT_TEAM_APP_ARGS`
- `MAGICHAT_TEAM_APP_CWD`
- `MAGICHAT_ALLOW_NON_WINDOWS=1` (non-Windows test/dev only)

## Tests
From `MagicHat/host`:

```bash
npm test
npm run contract:replay
```

`contract:replay` replays `tests/contracts/**` and fails on unsupported fixture schema or contract-marker drift.
