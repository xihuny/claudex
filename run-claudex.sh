#!/usr/bin/env bash
# ┌─────────────────────────────────────────────────────────────────────────┐
# │  Build + (re)start Claudex under pm2 (macOS + Linux).  ./run-claudex.sh  │
# │  Run it after `git pull`, after changing the password, or any time.      │
# │                                                                          │
# │  Environment (optional):                                                 │
# │    HOST=0.0.0.0         also listen on the LAN (default 127.0.0.1)       │
# │    CX_TUNNEL_NAME=...   the named tunnel this host runs (default claudex)│
# │    CX_TUNNEL_CONFIG=... its config file (default ~/.cloudflared/claudex.yml)│
# │  Put them in ~/.claude-web/env to make them permanent (sourced below).    │
# └─────────────────────────────────────────────────────────────────────────┘
set -euo pipefail
cd "$(dirname "$0")"

# Run from a terminal inside Claudex itself, this script is a descendant of the very
# backend it restarts: cycling pm2 below would kill the script mid-flight. Re-exec
# detached (new session, own process group) so we reparent to init and outlive the
# restart. The marker is an ARGUMENT, not an env var: an env flag would be inherited by
# every shell Claudex spawns and make a later run believe it is already detached.
if [ "${1:-}" != "--detached-child" ]; then
  LOG="$HOME/.claude-web/run.log"
  mkdir -p "$HOME/.claude-web"; : > "$LOG"
  if command -v setsid >/dev/null 2>&1; then
    setsid nohup "$PWD/$(basename "$0")" --detached-child "$@" >"$LOG" 2>&1 </dev/null &
  else
    nohup "$PWD/$(basename "$0")" --detached-child "$@" >"$LOG" 2>&1 </dev/null &
  fi
  CHILD=$!
  echo "→ Detached. Build + restart continue in the background."
  echo "   Launched from inside Claudex? This session drops for ~20s while the"
  echo "   backend restarts. It comes back on its own."
  echo "   Watch progress:  tail -f $LOG"
  # From a real terminal, mirror the log here until the detached child finishes.
  if [ -t 1 ]; then
    tail -n +1 -f "$LOG" & TP=$!
    while kill -0 "$CHILD" 2>/dev/null; do sleep 1; done
    sleep 1; kill "$TP" 2>/dev/null || true
  fi
  exit 0
fi
shift

export PATH="$HOME/.local/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:$PATH"
command -v pm2 >/dev/null 2>&1 || { export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && nvm use default >/dev/null 2>&1 || true; }
command -v pm2 >/dev/null 2>&1 || { echo "pm2 not found. Run ./setup.sh first."; exit 1; }
# Per-host settings (HOST, CX_TUNNEL_NAME, PREVIEW_DOMAIN, ...), kept out of the repo.
[ -f "$HOME/.claude-web/env" ] && set -a && . "$HOME/.claude-web/env" && set +a

echo "→ Building production bundle (dist/) …"
pnpm run build

# Stopping `claudex` kills its whole process tree. We're already detached from it, but
# arm an independent watchdog anyway: if this script dies at the worst moment, the guard
# brings the backend back instead of leaving it down until someone notices.
if command -v setsid >/dev/null 2>&1; then
  setsid nohup "$PWD/claudex-guard.sh" 90 >"$HOME/.claude-web/guard.log" 2>&1 </dev/null &
else
  nohup "$PWD/claudex-guard.sh" 90 >"$HOME/.claude-web/guard.log" 2>&1 </dev/null &
fi

echo "→ Starting services …"
export HOST="${HOST:-127.0.0.1}"
# No `pm2 delete` first: delete-then-start leaves a window where Claudex exists nowhere.
# startOrReload does the same job in one daemon-side step.
pm2 startOrReload ecosystem.config.cjs --update-env
pm2 save >/dev/null

PORT="${PORT:-8090}"
echo "→ Waiting for http://127.0.0.1:$PORT …"
ok=0
for _ in $(seq 1 40); do
  code=$(curl -s -o /dev/null -m 2 -w '%{http_code}' "http://127.0.0.1:$PORT/" || true)
  if [ -n "$code" ] && [ "$code" != "000" ]; then ok=1; break; fi
  sleep 0.5
done
echo; pm2 status; echo
if [ "$ok" != "1" ]; then
  echo "❌ Backend did not answer on :$PORT within 20s. The watchdog will retry; recent logs:"
  pm2 logs claudex --lines 40 --nostream || true
  exit 1
fi
echo "✅ Claudex is LIVE:"
echo "     Local        : http://localhost:$PORT"
if [ "$HOST" = "0.0.0.0" ]; then
  IP="$(ipconfig getifaddr en0 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}' || true)"
  [ -n "${IP:-}" ] && echo "     LAN          : http://$IP:$PORT"
fi
CFG="${CX_TUNNEL_CONFIG:-$HOME/.cloudflared/claudex.yml}"
if [ -f "$CFG" ]; then
  H="$(grep -m1 -E '^\s*-?\s*hostname:' "$CFG" | sed -E 's/.*hostname:[[:space:]]*"?([^" *]+)"?.*/\1/')"
  [ -n "$H" ] && echo "     Public       : https://$H"
fi
echo
echo "   Runs in the background via pm2. Run this again any time to rebuild."
