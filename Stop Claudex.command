#!/bin/bash
# macOS double-click: stop the background Claudex processes (they stay stopped until you
# run "Run Claudex.command" again).
set -euo pipefail
cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:$HOME/.local/bin:/usr/local/bin:$PATH"
./stop-claudex.sh
echo
