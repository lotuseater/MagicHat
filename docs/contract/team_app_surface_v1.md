# Team App Surface v1 (Contract Lock)

This document locks the Team App automation and beacon surface that MagicHat v1 is allowed to consume.

## Source Of Truth

Verified directly from `Wizard_Erasmus` commit:

- Repo: `/Users/oleh/Documents/GitHub/Wizard_Erasmus`
- Commit: `625b5305cf29f0319dfec7222c4a37ccd857d1e2`

Primary files inspected:

- `src/team_app/automation_controller.cpp`
- `src/team_app/docs/automation_contract_v1.json`
- `src/team_app/README.md`
- `src/team_app/session_restore_service.cpp`

## Contract Rules

- MagicHat treats the Team App beacon plus per-instance file IPC as authoritative.
- MagicHat prefers the frozen v1 product actions over legacy UI command choreography when both exist.
- MagicHat may still rely on legacy-compatible commands only when the v1 product action does not cover the behavior.

## Discovery And Lifecycle Identity

Beacon file path:

- `%TEMP%/wizard_team_app/active_instances.json`

Each live beacon entry includes the fields MagicHat depends on:

- `instance_id`
- `automation_prefix`
- `pid`
- `hwnd`
- `session_id`
- `phase`
- `current_task_state`
- `artifact_dir`
- `cmd_path`
- `resp_path`
- `events_path`
- `run_artifact_dir`
- `run_log_path`
- `restore_state_path`
- `started_at`
- `heartbeat_ts`
- `last_activity_ts`
- `result_summary`
- `health`

Notes:

- Team App registers the beacon entry during startup and refreshes it on heartbeat/activity.
- Team App prunes stale entries by pid and heartbeat health.
- Team App removes its own beacon entry on clean shutdown.
- `instance_id` is the stable cross-surface identity for product actions; `pid` is still a valid selector and fallback.

## IPC Transport Contract

Per instance, Team App automation uses file IPC:

- command input: `<prefix>_cmd.json` (`cmd_path`)
- response stream: `<prefix>_resp.jsonl` (`resp_path`)
- event stream: `<prefix>_events.jsonl` (`events_path`)

Request envelope:

- required: `seq` (number), `cmd` (string)
- write requests atomically (`.tmp` then rename)
- match responses by `seq`

Protocol semantics:

- Team App ignores commands where `seq <= last_seen_seq`.
- Responses are appended to `resp_path` as JSON lines.
- `events_path` is the preferred lifecycle/update stream when present.

## Team App Commands Used By MagicHat

Primary v1 product actions:

- `launch_instance`
- `close_instance`
- `submit_initial_prompt`
- `submit_follow_up`
- `set_startup_profile`
- `restore_session`

Inspection/discovery:

- `snapshot`
- `inspect`

Legacy-compatible commands still present in Team App but not preferred by MagicHat:

- `create_team`
- `ui_set_text`
- `ui_click`
- `ui_send_key`
- `ui_select_combo`
- `ui_set_check`
- `ui_select_tab`
- `ui_invoke`
- `get_chat`
- `select_agent`
- `send_terminal`
- `get_control_text`
- `get_view_metrics`
- `capture_window`
- `get_terminal_text`
- `set_headless_prompts`
- `answer_trust_prompt`
- `request_project_trust`
- `get_automation_paths`

## Snapshot And Inspect Surface Used By MagicHat

`inspect` is the preferred detail/status surface and may include:

- `snapshot`
- `chat`
- `summary_text`
- `terminals_by_agent`

Fields MagicHat currently relies on from `snapshot`:

- `phase`
- `instance.instance_id`
- `instance.session_id`
- `instance.pid`
- `task_state`
- `restore_refs`
- `result_summary`
- `health`
- `beacon`

## Event And Output Priority Order

MagicHat status/output priority is fixed:

1. `events_path` stream when present.
2. `inspect` polling for live state, chat, summary, and terminals.
3. `run_log_path` as read-only telemetry fallback.

## MagicHat v1 Mapping To Team App

- List instances:
  - read beacon array from `%TEMP%/wizard_team_app/active_instances.json`
- Get instance detail:
  - send `{"cmd":"inspect","include_chat":true,"include_summary":true,"include_terminals":true}`
- Launch instance:
  - spawn Team App process and wait for new beacon entry
- Close instance:
  - send `{"cmd":"close_instance","instance_id":"...","pid":12345}`
- Send initial prompt:
  - send `{"cmd":"submit_initial_prompt","instance_id":"...","prompt":"..."}`
- Send follow-up:
  - send `{"cmd":"submit_follow_up","instance_id":"...","prompt":"..."}`
- Restore session into an existing instance:
  - send `{"cmd":"restore_session","path":".../session_restore.json"}`
- Poll/subscribe updates:
  - consume `events_path`
  - plus `inspect` polling for richer state

No extra Team App control semantics are allowed in MagicHat v1.
