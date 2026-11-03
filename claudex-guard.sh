#!/usr/bin/env bash
# ┌─────────────────────────────────────────────────────────────────────────┐
# │  Watchdog. Armed by run-claudex.sh right before it cycles pm2, and left  │
# │  running outside everyone's process tree.                                │
# │                                                                          │
# │      ./claudex-guard.sh [delay-seconds]        (default 60)              │
# │                                                                          │
# │  It sleeps, then checks the backend. If the port doesn't answer, it      │
# │  starts Claudex from ecosystem.config.cjs. So even if the deploy script  │
# │  is killed at its worst possible moment, the service comes back by       │
# │  itself instead of waiting for someone to notice.                        │
# └─────────────────────────────────────────────────────────────────────────┘
set -uo pipefail                      # NOT -e: this script must never abort early

cd "$(dirname "$0")" || exit 1
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:$PATH"
command -v pm2 >/dev/null 2>&1 || { export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && nvm use default >/dev/null 2>&1 || true; }
[ -f "$HOME/.claude-web/env" ] && set -a && . "$HOME/.claude-web/env" && set +a
export HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-8090}"

DELAY="${1:-60}"
ts() { date '+%H:%M:%S'; }
# Any HTTP status means the server is listening; / is password-gated so 401/200 both count.
healthy() { c=$(curl -s -o /dev/null -m 2 -w '%{http_code}' "http://127.0.0.1:$PORT/" 2>/dev/null); [ -n "$c" ] && [ "$c" != "000" ]; }

echo "[$(ts)] guard armed - pid $$, checking in ${DELAY}s"
sleep "$DELAY"

for i in 1 2 3 4 5 6; do
  if healthy; then echo "[$(ts)] backend is answering on :$PORT - nothing to do"; exit 0; fi
  echo "[$(ts)] no answer yet (try $i/6) …"
  sleep 5
done

echo "[$(ts)] backend DOWN after 30s of checks - forcing it back up"
pm2 startOrReload ecosystem.config.cjs --update-env || pm2 start ecosystem.config.cjs --update-env
pm2 save >/dev/null 2>&1
sleep 3
if healthy; then echo "[$(ts)] ✅ recovered by guard"; else echo "[$(ts)] ❌ still down - check: pm2 logs claudex"; exit 1; fi
