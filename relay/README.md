# MagicHat Relay

The relay is the remote-access rendezvous layer for MagicHat v2.

## Local Development

Install dependencies and start a loopback-only relay:

```bash
cd relay
npm ci
../scripts/remote-validation/start_relay.sh
```

This starts the relay on `127.0.0.1:18795` with SQLite storage under the local temp directory.

## TLS and Exposure Rules

- Loopback-only development on `127.0.0.1`, `localhost`, or `::1` may run over plain HTTP.
- Non-loopback bind addresses require either:
  - `MAGICHAT_RELAY_TLS_CERT_PATH` and `MAGICHAT_RELAY_TLS_KEY_PATH`, or
  - an explicit `MAGICHAT_RELAY_ALLOW_INSECURE_HTTP=1` override for non-production testing.
- Production deployments should terminate TLS directly in the relay or behind a trusted reverse proxy.

## Useful Environment Variables

- `MAGICHAT_RELAY_BIND_HOST`
- `MAGICHAT_RELAY_PORT`
- `MAGICHAT_RELAY_SQLITE_PATH`
- `MAGICHAT_RELAY_DATABASE_URL`
- `MAGICHAT_RELAY_TLS_CERT_PATH`
- `MAGICHAT_RELAY_TLS_KEY_PATH`
- `MAGICHAT_RELAY_ALLOW_INSECURE_HTTP`

## Tests

```bash
cd relay
npm test
```
