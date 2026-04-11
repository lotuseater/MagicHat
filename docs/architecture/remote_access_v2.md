# MagicHat Remote Access v2

This document proposes the first secure remote-access architecture for MagicHat.

It is intentionally separate from the locked v1 LAN contract:

- v1 remains LAN-only and host-local to the paired PC
- v2 adds secure remote access from a phone without exposing Team App directly to the public internet

## Goals

- Let a user manage Team App instances from a mobile phone when away from the PC and away from the local network.
- Preserve the current Team App isolation boundary:
  - Team App stays local to the PC
  - Team App beacon and file IPC never leave the PC
- Avoid dependence on third-party tunnel/VPN tooling.
- Support Android and iPhone clients.
- Support foreground remote control first, then background notifications.
- Make per-device revoke, rotate, and audit straightforward.

## Non-Goals

- Exposing Team App directly to the internet.
- Using the Team App beacon or file IPC as a remote protocol.
- Building custom cryptography.
- Solving multi-tenant SaaS hosting in the first cut.
- Replacing the existing LAN v1 flow immediately.

## Current State

Today MagicHat works like this:

1. Mobile client talks to the MagicHat host over local HTTP + bearer auth + SSE.
2. MagicHat host reads Team App beacon state from the local machine.
3. MagicHat host sends Team App commands through per-instance file IPC.

This is intentionally LAN-only.

Relevant current implementation:

- Host API: [host/src/app.js](/Users/oleh/Documents/GitHub/MagicHat/host/src/app.js)
- LAN guard: [host/src/network/lanGuard.js](/Users/oleh/Documents/GitHub/MagicHat/host/src/network/lanGuard.js)
- Team App beacon adapter: [host/src/teamapp/beaconStore.js](/Users/oleh/Documents/GitHub/MagicHat/host/src/teamapp/beaconStore.js)
- Team App IPC adapter: [host/src/teamapp/ipcClient.js](/Users/oleh/Documents/GitHub/MagicHat/host/src/teamapp/ipcClient.js)
- Android host client: [mobile/android/app/src/main/java/com/magichat/mobile/network/MagicHatApiService.kt](/Users/oleh/Documents/GitHub/MagicHat/mobile/android/app/src/main/java/com/magichat/mobile/network/MagicHatApiService.kt)
- Android live updates: [mobile/android/app/src/main/java/com/magichat/mobile/network/SseEventStreamClient.kt](/Users/oleh/Documents/GitHub/MagicHat/mobile/android/app/src/main/java/com/magichat/mobile/network/SseEventStreamClient.kt)

## Recommended v2 Architecture

Use a first-party MagicHat relay service.

High-level topology:

1. The PC host opens an outbound TLS connection to the relay.
2. The mobile app opens an outbound TLS connection to the relay.
3. The relay brokers authenticated request/response and update streams.
4. The PC host remains the only component allowed to talk to Team App.

This keeps the PC off inbound public exposure and preserves the existing Team App boundary.

## Why Relay Instead Of Direct Internet Exposure

Direct exposure of the current host is the wrong default because:

- the current host API was built for LAN trust assumptions
- bearer-token-only auth is too weak for public exposure
- home NAT, dynamic IPs, and router config create reliability problems
- exposing the PC host directly increases attack surface dramatically

The relay approach gives us:

- outbound-only connectivity from the PC
- stable addressability for the phone
- a clean place for device registration, revocation, and audit
- room for push-notification fanout later

## Trust Model

There are three principals:

- `host`: the MagicHat host on the PC
- `mobile-device`: one installed Android or iOS client
- `relay`: the MagicHat rendezvous and policy service

The relay is trusted for transport coordination and policy enforcement.

Optional later hardening:

- end-to-end encrypt command and update envelopes between host and phone so the relay cannot inspect payload contents

That is a later phase, not required for a secure first production version.

## Pairing And Onboarding

### Bootstrap Flow

Initial pairing should happen locally, near the PC, with a QR code shown on the PC host.

The QR payload should contain:

- relay URL
- host ID
- host display name
- short-lived bootstrap token
- host public-key fingerprint
- token expiry
- protocol version

Example conceptual payload:

```json
{
  "v": 2,
  "relay": "https://relay.magichat.example",
  "host_id": "host_01JREMOTEABC123",
  "host_name": "Office PC",
  "bootstrap_token": "bt_...",
  "host_fingerprint": "sha256:...",
  "exp": "2026-04-11T20:30:00Z"
}
```

### What The QR Must Not Contain

- long-lived bearer tokens
- Team App file paths
- public direct PC endpoints
- reusable static secrets

### Device Registration

After scanning:

1. The phone generates a device keypair.
2. The private key is stored in Secure Enclave / Android Keystore where available.
3. The phone presents the bootstrap token to the relay.
4. The relay asks the host to approve the device registration.
5. The host binds the new device public key to the account/host.
6. The relay issues a device certificate or a device-bound refresh credential.

## Authentication And Session Security

Recommended model:

- TLS everywhere
- device-bound authentication after bootstrap
- short-lived access tokens
- rotating refresh credentials
- per-request nonce and issued-at / expiry checks
- server-side revoke list

Good first implementation choices:

- Relay terminates TLS.
- Host authenticates with a client certificate or Ed25519-signed session bootstrap.
- Mobile authenticates with a client certificate or device-key proof-of-possession.
- API tokens are short-lived and bound to the device identity.

## Transport Shape

Keep the current host-internal Team App bridge unchanged.

Add a new remote transport between relay and host:

- host opens a persistent outbound stream to relay
- WebSocket is acceptable for the first cut
- HTTP/2 streaming or gRPC is also acceptable

Add a new remote transport between mobile and relay:

- request/response over HTTPS
- live instance updates over WebSocket or SSE

Suggested public surfaces:

- `POST /v2/mobile/pair/bootstrap/claim`
- `POST /v2/mobile/session/refresh`
- `GET /v2/mobile/hosts`
- `GET /v2/mobile/hosts/{host_id}/instances`
- `POST /v2/mobile/hosts/{host_id}/instances`
- `POST /v2/mobile/hosts/{host_id}/instances/{instance_id}/prompt`
- `POST /v2/mobile/hosts/{host_id}/instances/{instance_id}/follow-up`
- `POST /v2/mobile/hosts/{host_id}/instances/{instance_id}/restore`
- `DELETE /v2/mobile/hosts/{host_id}/instances/{instance_id}`
- `GET /v2/mobile/hosts/{host_id}/instances/{instance_id}/updates`

Suggested host relay channel message classes:

- `host_hello`
- `host_attest`
- `device_registration_approval`
- `command_envelope`
- `command_result`
- `instance_update`
- `heartbeat`
- `revoke_device`

## Command And Data Boundaries

This is a hard rule for v2:

- mobile never talks to Team App directly
- relay never talks to Team App directly
- only the PC host talks to Team App

The PC host remains responsible for:

- reading beacon state
- launching Team App
- writing Team App file IPC commands
- reading Team App responses/events
- translating those local artifacts into remote-safe API payloads

## Device And Session Management

The host should expose a device-management view to the PC user.

Minimum capabilities:

- list paired phones/devices
- show last-seen timestamp
- show device name and platform
- revoke a device immediately
- rotate host keys
- invalidate all active device sessions

## Notifications And Background Behavior

Remote control while the app is open should work through the relay connection.

Background wakeups and alerts require platform-native push:

- APNs for iPhone
- FCM for Android

Push should be used for:

- host online/offline
- instance completed
- approval required
- security events like device revoked or new device paired

Push should not contain sensitive payload contents.

## Security Requirements

Required before production:

- TLS only
- no plaintext HTTP anywhere outside localhost development
- no long-lived bearer token as sole credential
- per-device registration and revoke
- audit log for admin and security events
- rate limits on pairing and auth endpoints
- replay protection on bootstrap and command submission
- certificate pinning in mobile clients for the relay
- signed host identity bootstrap
- explicit versioned protocol envelopes

Recommended:

- optional relay-untrusted end-to-end encrypted command payloads
- hardware-backed key storage when available
- dual approval for adding new devices in high-security mode

## Deployment Modes

MagicHat v2 should support two deployment modes:

### 1. Self-Hosted Relay

For individual users or teams running their own infrastructure.

Advantages:

- no vendor lock-in
- fits the "without external tools" goal

Requirements:

- public HTTPS endpoint
- persistent storage for device and host registrations

### 2. First-Party Managed Relay

For a future hosted MagicHat offering.

Advantages:

- easier onboarding
- simpler mobile UX

This is not required for v2 architecture correctness.

## Phased Implementation Plan

### Phase 0: Lock The Design

- add this v2 architecture document
- add a remote-access threat model
- define remote protocol envelopes and key lifecycle

### Phase 1: Host Identity And Relay Skeleton

- add host key generation and local persistence
- add relay service skeleton
- add outbound host connection to relay
- add host heartbeat and registration

Deliverable:

- relay can show registered host presence

### Phase 2: QR Bootstrap And Device Registration

- add PC-side QR code generation
- add Android QR scan/import flow
- add iOS QR scan/import flow
- implement bootstrap token redemption
- issue device-bound credentials

Deliverable:

- phone can pair remotely-capable trust with the PC via QR bootstrap

### Phase 3: Remote Command Channel

- relay forwards authenticated command envelopes to host
- host maps them onto existing Team App host operations
- relay returns command results and update streams

Deliverable:

- mobile can list, launch, prompt, follow up, restore, and close remotely

### Phase 4: Background Notifications

- APNs/FCM integration
- device notification preferences
- host online/offline and job-complete alerts

Deliverable:

- practical day-to-day remote UX

### Phase 5: Hardening

- cert rotation
- revoke-all and emergency lockout
- audit export
- penetration review
- optional end-to-end encrypted envelopes

## Recommended Repo Changes For The Next Implementation Slice

The next concrete code slice should be:

1. Add `docs/architecture/remote_protocol_v2.md`.
2. Add a relay workspace:
   - `relay/`
3. Add host identity persistence:
   - host keypair
   - host registration state
4. Add QR bootstrap payload generation on the host.
5. Add Android QR bootstrap import.

That sequence keeps v1 stable while building v2 beside it.

## Open Questions

- Should the relay be fully trusted for payload visibility, or should command envelopes be end-to-end encrypted?
- Should one phone pair to one host only, or should one identity manage multiple hosts?
- Should remote access require explicit on-PC confirmation for every new device?
- Should remote restore allow arbitrary restore paths, or only restore paths already known from beacon state?
- Should we support direct peer-to-peer fallback later, or keep relay-only networking?

## Decision

Recommended decision:

- Keep v1 LAN-only.
- Build v2 around a first-party relay with outbound-only host connectivity.
- Use QR bootstrap plus device-bound trust.
- Do not expose Team App or the current host directly to the public internet.
