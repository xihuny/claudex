#!/usr/bin/env bash
# Stop Claudex (backend + tunnel). They stay stopped, also after a reboot, until you run
# ./run-claudex.sh again.
set -euo pipefail
cd "$(dirname "$0")"

export PATH="$HOME/.local/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:$PATH"
command -v pm2 >/dev/null 2>&1 || { export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && nvm use default >/dev/null 2>&1 || true; }
command -v pm2 >/dev/null 2>&1 || { echo "pm2 not found; nothing to stop."; exit 0; }

echo "→ Stopping Claudex processes …"
pm2 stop claudex claudex-tunnel 2>/dev/null || true
pm2 save >/dev/null

echo
pm2 status
echo
echo "🛑 Claudex is stopped. It will stay down (including after a reboot)."
echo "   Run ./run-claudex.sh to start it again."
