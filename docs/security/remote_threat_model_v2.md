# MagicHat Remote Threat Model v2

This document records the first production security assumptions for MagicHat remote access.

## Assets

- Team App control authority on the paired PC
- host Ed25519 private key
- device Ed25519 private key
- access and refresh tokens
- bootstrap tokens and pending claims
- audit event history

## Trust Boundaries

- Team App is local-only and trusted by the host
- host and relay communicate over outbound TLS WebSocket
- mobile and relay communicate over TLS HTTP/SSE
- relay is trusted for payload visibility in v2.0
- local admin routes on the host are localhost-only and treated as same-machine privileged operations

## Main Threats

### Public Exposure Of Team App Internals

Risk:

- beacon entries, IPC file paths, or raw host filesystem paths leak into remote payloads

Mitigation:

- remote DTOs exclude `cmd_path`, `resp_path`, `events_path`, and raw artifact paths
- restore commands accept only known restore refs already collected by the host

### Stolen Bootstrap QR

Risk:

- attacker scans or copies the QR before the legitimate device completes pairing

Mitigation:

- bootstrap tokens expire in 10 minutes
- tokens are one-time use
- relay records first valid claim and rejects reuse
- host requires explicit on-PC approval before registration completes

### Relay Credential Replay

Risk:

- stolen refresh token is replayed after rotation

Mitigation:

- refresh tokens rotate on every refresh
- reuse of any non-active refresh token revokes the device
- reuse is written to audit log and active sessions are invalidated

### Host Socket Hijack

Risk:

- attacker impersonates a host and receives remote commands

Mitigation:

- relay challenges every host connection
- host signs the challenge with the persisted Ed25519 private key
- host public key is registered per `host_id`

### Device Impersonation

Risk:

- attacker claims to be a paired device and obtains access tokens

Mitigation:

- device registration requires proof-of-possession signature over relay challenge
- device public key is stored and bound to device metadata
- revoke immediately invalidates refresh and access tokens

### Command Queue Abuse

Risk:

- offline host accumulates stale commands

Mitigation:

- relay does not queue instance commands for offline hosts
- commands fail fast with `host_offline`

### Brute Force / Flooding

Risk:

- attackers hammer bootstrap, refresh, or command routes

Mitigation:

- per-IP and per-host rate limits on bootstrap, refresh, and command routes
- audit failed attempts

## Production Requirements

- TLS only outside localhost development
- no long-lived bearer token as the sole persistent credential
- access tokens expire after 15 minutes
- refresh tokens expire after 30 days
- device and host private keys never leave their local device
- relay stores only public keys and token metadata
- host is marked offline after 60 seconds without heartbeat
- mobile clients must fail closed on pin mismatches in production HTTPS mode

## Deferred Hardening

- relay-untrusted end-to-end encrypted payloads
- dual approval mode for new device registration
- hardware-backed attestation proofs beyond key possession
- multi-user policy and role separation
