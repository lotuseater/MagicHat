# MagicHat Remote Protocol v2

This document locks the first production remote protocol for MagicHat.

It is intentionally additive to the existing LAN-only v1 contract:

- v1 direct host HTTP remains unchanged
- v2 adds `mobile <-> relay <-> host <-> Team App`
- Team App beacon files and file IPC remain host-local only

## Scope

This protocol covers:

- host registration and presence
- QR bootstrap
- device approval and registration
- mobile auth and token refresh
- remote instance command forwarding
- live update streaming

This protocol does not cover:

- push notifications
- multi-user sharing
- peer-to-peer fallback
- end-to-end encrypted envelopes

## Transport

- Mobile uses HTTPS for request/response and SSE for live updates.
- Host uses one outbound WebSocket to the relay.
- Relay is trusted for payload visibility in v2.0.
- All protocol envelopes are versioned and reserve `enc` and `meta` fields for later E2E payload wrapping.

## Identifiers

- `host_id`: stable host identity string
- `device_id`: stable mobile-device identity string
- `claim_id`: pending bootstrap/device-approval claim
- `request_id`: one relay command request
- `subscription_id`: one live update stream subscription
- `refresh_token_id`: one refresh-token record family member

## QR Pair URI

The host generates a pair URI:

```text
magichat://pair?v=2&relay=https%3A%2F%2Frelay.example&host_id=host_123&host_name=Office%20PC&bootstrap_token=bt_123&host_fingerprint=sha256%3Aabc&exp=2026-04-11T20%3A30%3A00Z
```

Required fields:

- `v`
- `relay`
- `host_id`
- `host_name`
- `bootstrap_token`
- `host_fingerprint`
- `exp`

## Bootstrap Token

Bootstrap tokens are signed by the host and validated by the relay.

Payload:

```json
{
  "v": 2,
  "jti": "bt_01JREMOTE",
  "host_id": "host_01JREMOTE",
  "host_name": "Office PC",
  "exp": "2026-04-11T20:30:00Z"
}
```

Rules:

- TTL: 10 minutes
- single use
- signed with the host Ed25519 private key
- consumed by the relay on first valid claim

## Host WebSocket

Endpoint:

- `GET /v2/host/connect`

Expected client headers:

- `x-magichat-host-id`
- `x-magichat-protocol-version: 2`

### Relay Challenge

After socket open, relay sends:

```json
{
  "type": "host_challenge",
  "protocol_version": 2,
  "challenge": "base64-random",
  "ts": "2026-04-11T17:00:00Z"
}
```

### Host Hello

Host replies:

```json
{
  "type": "host_hello",
  "protocol_version": 2,
  "host_id": "host_01JREMOTE",
  "host_name": "Office PC",
  "host_public_key": "base64-spki",
  "signature": "base64-sig",
  "challenge": "base64-random",
  "meta": {
    "app_version": "0.1.0",
    "platform": "windows"
  }
}
```

Successful auth response:

```json
{
  "type": "host_attest",
  "protocol_version": 2,
  "host_id": "host_01JREMOTE",
  "session_id": "hs_01JSESSION",
  "heartbeat_interval_sec": 20
}
```

### Host Heartbeat

```json
{
  "type": "heartbeat",
  "protocol_version": 2,
  "host_id": "host_01JREMOTE",
  "session_id": "hs_01JSESSION",
  "ts": "2026-04-11T17:00:20Z",
  "summary": {
    "instance_count": 2
  }
}
```

The relay marks the host offline after 60 seconds without heartbeat.

## Device Pairing Flow

### 1. Claim QR Bootstrap

`POST /v2/mobile/pair/bootstrap/claim`

Request:

```json
{
  "bootstrap_token": "bt_...",
  "device_name": "Alice Pixel 9",
  "platform": "android",
  "device_public_key": "base64-spki"
}
```

Response:

```json
{
  "claim_id": "claim_01JREMOTE",
  "status": "pending_approval",
  "host_id": "host_01JREMOTE",
  "host_name": "Office PC"
}
```

Side effect:

- relay sends `device_approval_required` to the host socket

### 2. Host Approval

Host sends:

```json
{
  "type": "device_registration_approved",
  "protocol_version": 2,
  "claim_id": "claim_01JREMOTE"
}
```

Or:

```json
{
  "type": "disconnect_reason",
  "protocol_version": 2,
  "claim_id": "claim_01JREMOTE",
  "reason": "approval_rejected"
}
```

### 3. Poll Claim Status

`GET /v2/mobile/pair/bootstrap/claims/{claim_id}`

Pending:

```json
{
  "claim_id": "claim_01JREMOTE",
  "status": "pending_approval"
}
```

Approved:

```json
{
  "claim_id": "claim_01JREMOTE",
  "status": "approved",
  "challenge": "base64-random",
  "host_id": "host_01JREMOTE",
  "host_name": "Office PC"
}
```

### 4. Complete Device Registration

`POST /v2/mobile/pair/device/register`

Request:

```json
{
  "claim_id": "claim_01JREMOTE",
  "challenge": "base64-random",
  "signature": "base64-sig"
}
```

Response:

```json
{
  "host_id": "host_01JREMOTE",
  "host_name": "Office PC",
  "device_id": "device_01JREMOTE",
  "access_token": "at_...",
  "access_token_expires_at": "2026-04-11T17:15:00Z",
  "refresh_token": "rt_...",
  "refresh_token_expires_at": "2026-05-11T17:00:00Z",
  "certificate_pinset_version": "dev-insecure"
}
```

## Session Refresh

`POST /v2/mobile/session/refresh`

Request:

```json
{
  "refresh_token": "rt_..."
}
```

Response:

```json
{
  "access_token": "at_...",
  "access_token_expires_at": "2026-04-11T17:30:00Z",
  "refresh_token": "rt_...",
  "refresh_token_expires_at": "2026-05-11T17:15:00Z"
}
```

Rules:

- access tokens last 15 minutes
- refresh tokens last 30 days
- refresh tokens rotate on every refresh
- reuse of a non-active refresh token revokes the device

## Mobile API

Authenticated routes require `Authorization: Bearer <access_token>`.

### Hosts

- `GET /v2/mobile/hosts`
- `GET /v2/mobile/devices`
- `DELETE /v2/mobile/devices/{device_id}`

`GET /v2/mobile/hosts` response:

```json
{
  "hosts": [
    {
      "host_id": "host_01JREMOTE",
      "host_name": "Office PC",
      "status": "online",
      "last_seen_at": "2026-04-11T17:00:20Z"
    }
  ]
}
```

### Instances

- `GET /v2/mobile/hosts/{host_id}/instances`
- `POST /v2/mobile/hosts/{host_id}/instances`
- `GET /v2/mobile/hosts/{host_id}/instances/{instance_id}`
- `POST /v2/mobile/hosts/{host_id}/instances/{instance_id}/prompt`
- `POST /v2/mobile/hosts/{host_id}/instances/{instance_id}/follow-up`
- `POST /v2/mobile/hosts/{host_id}/instances/{instance_id}/restore`
- `DELETE /v2/mobile/hosts/{host_id}/instances/{instance_id}`
- `GET /v2/mobile/hosts/{host_id}/instances/{instance_id}/updates`

Remote instance operations use `instance_id` only. Host-local `pid` may be returned as metadata but must not be used as the routing key.

## Relay To Host Command Envelope

```json
{
  "type": "command_envelope",
  "protocol_version": 2,
  "request_id": "req_01JREMOTE",
  "host_id": "host_01JREMOTE",
  "command": {
    "kind": "list_instances",
    "params": {}
  }
}
```

Other `kind` values:

- `get_instance_detail`
- `launch_instance`
- `close_instance`
- `send_prompt`
- `send_follow_up`
- `restore_instance`
- `subscribe_instance_updates`
- `unsubscribe_instance_updates`
- `list_known_restore_refs`

## Host To Relay Command Result

```json
{
  "type": "command_result",
  "protocol_version": 2,
  "request_id": "req_01JREMOTE",
  "ok": true,
  "result": {
    "instances": []
  }
}
```

Error form:

```json
{
  "type": "command_result",
  "protocol_version": 2,
  "request_id": "req_01JREMOTE",
  "ok": false,
  "error": {
    "code": "instance_not_found",
    "message": "Instance not found"
  }
}
```

## Live Update Envelope

Host sends:

```json
{
  "type": "instance_update",
  "protocol_version": 2,
  "subscription_id": "sub_01JREMOTE",
  "host_id": "host_01JREMOTE",
  "instance_id": "wizard_team_app_311_1000",
  "event": {
    "type": "events",
    "message": "worker finished"
  }
}
```

Relay forwards this as SSE:

```text
event: instance_update
data: {"type":"events","message":"worker finished"}
```

## Error Codes

Standard mobile API error codes:

- `unauthorized`
- `forbidden`
- `host_offline`
- `instance_not_found`
- `restore_ref_not_allowed`
- `bootstrap_token_invalid`
- `bootstrap_token_expired`
- `bootstrap_token_used`
- `claim_not_found`
- `claim_not_ready`
- `claim_rejected`
- `device_revoked`
- `refresh_token_invalid`
- `refresh_token_reused`
- `rate_limited`
- `internal_error`

## Audit Events

The relay must record:

- `host_registered`
- `host_connected`
- `host_disconnected`
- `bootstrap_claimed`
- `device_approval_requested`
- `device_approved`
- `device_rejected`
- `device_registered`
- `device_revoked`
- `refresh_rotated`
- `refresh_reuse_detected`
- `command_denied`
- `auth_failed`

## Compatibility Rules

- v1 routes stay unchanged
- v2 never returns Team App file IPC paths
- v2 restore only accepts restore refs already known to the host
- relay/mobile payloads may include `protocol_version` and optional `enc` fields for future encrypted envelopes
