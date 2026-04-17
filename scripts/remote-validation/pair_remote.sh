#!/usr/bin/env bash
# Single-action remote QR pairing on PC.
# Starts the loopback relay + host, opens the pairing QR, then prompts once to
# approve the phone's claim.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

RELAY_PORT="${MAGICHAT_RELAY_PORT:-18795}"
HOST_PORT="${MAGICHAT_PORT:-18765}"
RELAY_BIND_HOST="${MAGICHAT_RELAY_BIND_HOST:-0.0.0.0}"
RELAY_LOCAL_URL="http://127.0.0.1:${RELAY_PORT}"
HOST_URL="http://127.0.0.1:${HOST_PORT}"
ADMIN_BASE="${HOST_URL}/admin/v2/remote"

LOG_DIR="${TMPDIR:-/tmp}/magichat_pair_remote"
mkdir -p "${LOG_DIR}"
RELAY_LOG="${LOG_DIR}/relay.log"
HOST_LOG="${LOG_DIR}/host.log"
SVG_PATH="${LOG_DIR}/pair_qr.svg"

detect_advertise_host() {
  if [[ -n "${MAGICHAT_RELAY_ADVERTISE_HOST:-}" ]]; then
    printf '%s\n' "${MAGICHAT_RELAY_ADVERTISE_HOST}"
    return 0
  fi

  if command -v ip >/dev/null 2>&1; then
    local ip_route
    ip_route="$(ip route get 1.1.1.1 2>/dev/null | awk '{for (i=1;i<=NF;i++) if ($i=="src") {print $(i+1); exit}}')"
    if [[ -n "${ip_route}" ]]; then
      printf '%s\n' "${ip_route}"
      return 0
    fi
  fi

  if command -v hostname >/dev/null 2>&1; then
    local host_ip
    host_ip="$(hostname -I 2>/dev/null | awk '{for (i=1;i<=NF;i++) if ($i !~ /^127\./ && $i !~ /^169\.254\./) {print $i; exit}}')"
    if [[ -n "${host_ip}" ]]; then
      printf '%s\n' "${host_ip}"
      return 0
    fi
  fi

  echo "No LAN IPv4 address detected. Set MAGICHAT_RELAY_ADVERTISE_HOST to your PC's reachable IP." >&2
  return 1
}

RELAY_ADVERTISE_HOST="$(detect_advertise_host)"
RELAY_ADVERTISE_URL="http://${RELAY_ADVERTISE_HOST}:${RELAY_PORT}"

echo "[pair_remote] relay local      : ${RELAY_LOCAL_URL}"
echo "[pair_remote] relay advertised : ${RELAY_ADVERTISE_URL}"
echo "[pair_remote] host   : ${HOST_URL}"
echo "[pair_remote] logs   : ${LOG_DIR}"
echo

RELAY_PID=""
HOST_PID=""

cleanup() {
  echo
  echo "[pair_remote] stopping background relay + host"
  [[ -n "${HOST_PID}"  ]] && kill "${HOST_PID}"  2>/dev/null || true
  [[ -n "${RELAY_PID}" ]] && kill "${RELAY_PID}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

http_up() {
  curl -fsS --max-time 2 "$1" >/dev/null 2>&1
}

wait_up() {
  local url="$1" label="$2" timeout="${3:-45}"
  local deadline=$(( $(date +%s) + timeout ))
  while (( $(date +%s) < deadline )); do
    if http_up "${url}"; then echo "[pair_remote] ${label} up"; return 0; fi
    sleep 0.5
  done
  echo "[pair_remote] ${label} not reachable at ${url} after ${timeout}s — check ${LOG_DIR}" >&2
  return 1
}

assert_advertised_relay_reachable() {
  if ! http_up "${RELAY_ADVERTISE_URL}/healthz"; then
    echo "[pair_remote] relay is loopback-only; restarting it with LAN-visible bind"
    stop_listeners_on_port "${RELAY_PORT}" "relay"
  fi
}

stop_listeners_on_port() {
  local port="$1" label="$2"
  if command -v lsof >/dev/null 2>&1; then
    local pids
    pids="$(lsof -tiTCP:${port} -sTCP:LISTEN 2>/dev/null || true)"
    if [[ -n "${pids}" ]]; then
      echo "[pair_remote] stopping ${label} listener(s) on port ${port}: ${pids}"
      kill ${pids} 2>/dev/null || true
      sleep 1
    fi
  fi
}

open_viewer() {
  local path="$1"
  if command -v xdg-open >/dev/null 2>&1; then xdg-open "${path}" >/dev/null 2>&1 &
  elif command -v open     >/dev/null 2>&1; then open "${path}" >/dev/null 2>&1 &
  fi
}

if http_up "${RELAY_LOCAL_URL}/healthz"; then
  echo "[pair_remote] relay already running — reusing"
  assert_advertised_relay_reachable
fi
if ! http_up "${RELAY_LOCAL_URL}/healthz"; then
  (
    cd "${REPO_ROOT}/relay"
    MAGICHAT_RELAY_BIND_HOST="${RELAY_BIND_HOST}" \
    MAGICHAT_RELAY_PORT="${RELAY_PORT}" \
    MAGICHAT_RELAY_ALLOW_INSECURE_HTTP=1 \
    npm start
  ) >"${RELAY_LOG}" 2>&1 &
  RELAY_PID=$!
  wait_up "${RELAY_LOCAL_URL}/healthz" 'relay'
  if ! http_up "${RELAY_ADVERTISE_URL}/healthz"; then
    echo "[pair_remote] relay started on ${RELAY_LOCAL_URL} but is still not reachable on ${RELAY_ADVERTISE_URL}" >&2
    echo "[pair_remote] check firewall or set MAGICHAT_RELAY_ADVERTISE_HOST explicitly" >&2
    exit 1
  fi
fi

if http_up "${HOST_URL}/healthz"; then
  STATUS_RELAY_URL="$(curl -fsS "${ADMIN_BASE}/status" | node -e 'let b="";process.stdin.on("data",c=>b+=c).on("end",()=>{process.stdout.write((JSON.parse(b).relay_url)||"")})')"
  if [[ "${STATUS_RELAY_URL}" != "${RELAY_ADVERTISE_URL}" ]]; then
    echo "[pair_remote] host relay URL mismatch; restarting host"
    stop_listeners_on_port "${HOST_PORT}" "host"
  fi
fi
if http_up "${HOST_URL}/healthz"; then
  echo "[pair_remote] host already running — reusing (relay URL matches advertised endpoint)"
else
  (
    cd "${REPO_ROOT}/host"
    MAGICHAT_RELAY_URL="${RELAY_ADVERTISE_URL}" \
    MAGICHAT_ALLOW_INSECURE_RELAY=1 \
    MAGICHAT_BIND_HOST=0.0.0.0 \
    MAGICHAT_PORT="${HOST_PORT}" \
    npm start
  ) >"${HOST_LOG}" 2>&1 &
  HOST_PID=$!
  wait_up "${HOST_URL}/healthz" 'host'
fi

BOOTSTRAP_JSON="$(curl -fsS -X POST "${ADMIN_BASE}/bootstrap")"
PAIR_URI="$(printf '%s' "${BOOTSTRAP_JSON}" | node -e 'let b="";process.stdin.on("data",c=>b+=c).on("end",()=>{process.stdout.write(JSON.parse(b).pair_uri||"")})')"
printf '%s' "${BOOTSTRAP_JSON}" | node -e 'let b="";process.stdin.on("data",c=>b+=c).on("end",()=>{process.stdout.write(JSON.parse(b).qr_svg||"")})' > "${SVG_PATH}"

echo
echo "=== Scan this QR on the phone ==="
echo "  pair_uri : ${PAIR_URI}"
echo "  relay    : ${RELAY_ADVERTISE_URL}"
echo "  qr_svg   : ${SVG_PATH}"
open_viewer "${SVG_PATH}"

echo
echo "Waiting for the phone to register a claim. Ctrl+C to cancel."

node - "${ADMIN_BASE}" <<'NODE'
const base = process.argv[2];
const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((r) => rl.question(q, r));
const decided = new Map();
async function poll() {
  while (true) {
    await new Promise((r) => setTimeout(r, 2000));
    let list;
    try {
      const resp = await fetch(`${base}/pending-devices`);
      list = (await resp.json()).pending_approvals || [];
    } catch (err) {
      console.log(`[pair_remote] admin poll failed: ${err.message}`);
      continue;
    }
    for (const p of list) {
      if (decided.has(p.claim_id)) continue;
      if (p.status !== 'pending') { decided.set(p.claim_id, p.status); continue; }
      const label = p.device_name || '(unnamed device)';
      console.log(`\nPending claim: ${label} [${p.platform}]  claim_id=${p.claim_id}`);
      const ans = (await ask('Approve? [y/N/q to quit] ')).trim().toLowerCase();
      if (ans.startsWith('y')) {
        await fetch(`${base}/pending-devices/${p.claim_id}/approve`, { method: 'POST' });
        decided.set(p.claim_id, 'approved');
        console.log('[pair_remote] approved — phone is completing registration');
        rl.close();
        return;
      } else if (ans.startsWith('q')) {
        rl.close();
        process.exit(1);
      } else {
        await fetch(`${base}/pending-devices/${p.claim_id}/reject`, { method: 'POST' });
        decided.set(p.claim_id, 'rejected');
        console.log('[pair_remote] rejected — still watching for new claims');
      }
    }
  }
}
poll().catch((err) => { console.error(err); process.exit(1); });
NODE

echo
echo "=== Paired. Keep this terminal open to stay online. Ctrl+C to stop host+relay. ==="
while true; do sleep 60; done
