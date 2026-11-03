#!/bin/bash
# macOS double-click launcher: builds and (re)starts Claudex in the background via pm2.
# First time? Run ./setup.sh in a terminal once (it installs pm2 and creates a password).
# Add `HOST=0.0.0.0` to ~/.claude-web/env to also reach it from other devices on your Wi-Fi.
set -euo pipefail
cd "$(dirname "$0")"

export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:$HOME/.local/bin:/usr/local/bin:$PATH"
if ! command -v pm2 >/dev/null 2>&1; then
  export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && nvm use default >/dev/null 2>&1 || true
fi
if ! command -v pm2 >/dev/null 2>&1; then
  echo "pm2 is not installed yet. Run ./setup.sh once, then double-click this again."
  echo; read -r -p "Press Enter to close…" _; exit 1
fi

./run-claudex.sh --detached-child
echo
echo "   Closing this window…"

# Auto-close THIS Terminal window (everything keeps running in the background via pm2).
# Targets only the window whose active tab matches this shell's tty.
TTY="$(tty)"
nohup /usr/bin/osascript >/dev/null 2>&1 <<OSA &
delay 1
tell application "Terminal"
  repeat with w in windows
    try
      if tty of selected tab of w is "$TTY" then close w
    end try
  end repeat
end tell
OSA
exit 0
