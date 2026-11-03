#!/usr/bin/env bash
# ┌─────────────────────────────────────────────────────────────────────────┐
# │  Claudex first-time setup (macOS + Linux).  ./setup.sh                   │
# │                                                                          │
# │  1. checks Node >= 20, pnpm (via corepack) and the `claude` CLI          │
# │  2. installs dependencies and builds the app                             │
# │  3. creates ~/.claude-web/.password if there is none (and prints it)     │
# │  4. installs pm2 and starts Claudex in the background                    │
# │                                                                          │
# │  Safe to re-run. Flags:                                                  │
# │    --no-start   do everything except start it                            │
# │    --lan        also listen on your Wi-Fi/LAN (HOST=0.0.0.0)             │
# └─────────────────────────────────────────────────────────────────────────┘
set -euo pipefail
cd "$(dirname "$0")"

START=1; LAN=0
for a in "$@"; do
  case "$a" in
    --no-start) START=0 ;;
    --lan) LAN=1 ;;
    *) echo "unknown flag: $a"; exit 2 ;;
  esac
done

export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null 2>&1; then
  export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && nvm use default >/dev/null 2>&1 || true
fi

say() { printf '\n\033[1m→ %s\033[0m\n' "$*"; }
die() { printf '\n\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

say "Checking tools"
command -v node >/dev/null 2>&1 || die "Node.js is not installed. Install Node 20 or newer: https://nodejs.org (or nvm), then re-run."
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || die "Node $(node -v) is too old. Claudex needs Node 20 or newer."
echo "  node $(node -v)"
if ! command -v pnpm >/dev/null 2>&1; then
  command -v corepack >/dev/null 2>&1 || die "pnpm is missing and corepack is unavailable. Install pnpm: npm install -g pnpm"
  corepack enable >/dev/null 2>&1 || true
  corepack prepare pnpm@latest --activate >/dev/null 2>&1 || npm install -g pnpm >/dev/null 2>&1 || die "Could not install pnpm."
fi
echo "  pnpm $(pnpm -v)"
if command -v claude >/dev/null 2>&1; then
  echo "  claude $(claude --version 2>/dev/null | tail -1)"
else
  echo "  claude: NOT FOUND. Install it with:  curl -fsSL https://claude.ai/install.sh | bash   then run \`claude\` once to log in."
  echo "  (Claudex starts without it, but every chat and terminal needs it.)"
fi
if [ "$(uname -s)" = "Linux" ] && ! command -v make >/dev/null 2>&1; then
  echo "  build tools missing: node-pty needs them. On Debian/Ubuntu:  sudo apt install -y build-essential python3"
fi

say "Installing dependencies"
pnpm install --frozen-lockfile 2>/dev/null || pnpm install

say "Building the app"
pnpm run build

say "Access password"
mkdir -p "$HOME/.claude-web" && chmod 700 "$HOME/.claude-web"
PW_FILE="$HOME/.claude-web/.password"
if [ -s "$PW_FILE" ]; then
  chmod 600 "$PW_FILE"
  echo "  using the existing password in $PW_FILE"
else
  PW="$(node -e 'process.stdout.write(require("crypto").randomBytes(18).toString("base64url"))')"
  ( umask 077; printf '%s' "$PW" > "$PW_FILE" )
  echo "  generated a new password and saved it to $PW_FILE"
  echo
  echo "      $PW"
  echo
  echo "  You log in with it. To change it later: edit that file (no trailing newline), then ./run-claudex.sh"
fi

if [ "$START" != "1" ]; then
  say "Done (not started). Start it with:  ./run-claudex.sh    or in the foreground:  node server/index.js"
  exit 0
fi

say "Installing pm2 (keeps Claudex running in the background)"
command -v pm2 >/dev/null 2>&1 || npm install -g pm2 >/dev/null 2>&1 || die "Could not install pm2. Install it with: npm install -g pm2"

say "Starting Claudex"
if [ "$LAN" = "1" ]; then export HOST=0.0.0.0; else export HOST=127.0.0.1; fi
pm2 startOrReload ecosystem.config.cjs --update-env >/dev/null
pm2 save >/dev/null
sleep 1
echo
echo "✅ Claudex is running:  http://localhost:8090"
if [ "$LAN" = "1" ]; then
  IP="$(ipconfig getifaddr en0 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}' || true)"
  [ -n "${IP:-}" ] && echo "   On your network:      http://$IP:8090   (plain HTTP: use only on networks you trust)"
fi
echo
echo "   Start on boot:   pm2 startup     (run the command it prints, then: pm2 save)"
echo "   Public URL:      see docs/SETUP.md, section \"Public access\""
echo "   Logs:            pm2 logs claudex"
echo "   Stop:            ./stop-claudex.sh"
