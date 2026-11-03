// Claudex process set, managed by pm2 (started by ./run-claudex.sh).
//
//   claudex        backend: serves the built SPA (dist/) + API + websockets on :8090
//   claudex-tunnel cloudflared named tunnel (only when its config file exists)
//
// Autostart after a reboot: `pm2 startup` (prints a one-time command) + `pm2 save`.
// ./setup.sh and ./run-claudex.sh take care of `pm2 save`.
//
// Environment (all optional):
//   HOST               127.0.0.1 (default) or 0.0.0.0 to expose on the LAN
//   PORT               8090
//   CX_TUNNEL_CONFIG   ~/.cloudflared/claudex.yml   the named tunnel's config file
//   CX_TUNNEL_NAME     claudex                       the tunnel that config describes
//   PREVIEW_DOMAIN     e.g. example.com              stable dev-<project>.<domain> previews
//   PUSH_CONTACT       mailto:you@example.com        VAPID contact for web push
// The access password is NOT passed here: the backend reads ~/.claude-web/.password
// itself, so it never sits in pm2's saved environment dump.

const fs = require("fs");
const os = require("os");
const path = require("path");

const HOME = os.homedir();
const NODE_BIN = path.dirname(process.execPath); // nvm node/pm2 bin dir
// ~/.local/bin first: that's where the native Claude Code installer (claude.ai/install.sh)
// puts the `claude` binary, and it is on no system default PATH.
const PATH = `${HOME}/.local/bin:/opt/homebrew/bin:/opt/homebrew/sbin:${NODE_BIN}:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`;

const expand = (p) => (p && p.startsWith("~") ? path.join(HOME, p.slice(1)) : p);
const TUNNEL_CONFIG = expand(process.env.CX_TUNNEL_CONFIG || path.join(HOME, ".cloudflared", "claudex.yml"));
const TUNNEL = process.env.CX_TUNNEL_NAME || "claudex";
// /usr/bin is where the Linux .deb lands; the first two are Homebrew on macOS.
const CLOUDFLARED =
  ["/opt/homebrew/bin/cloudflared", "/usr/local/bin/cloudflared", "/usr/bin/cloudflared"].find((p) => fs.existsSync(p)) || "cloudflared";

const passthrough = {};
for (const k of ["PORT", "PREVIEW_DOMAIN", "PUSH_CONTACT", "CX_TUNNEL_CONFIG", "CX_RESERVED_LABELS", "CHAT_IDLE_MS", "CHAT_CTX_WARN", "USE_TMUX", "ASR_MODEL", "SHERPA_DIR"])
  if (process.env[k]) passthrough[k] = process.env[k];

const apps = [
  {
    name: "claudex",
    cwd: __dirname,
    script: "server/index.js",
    // NOTE: intentionally NOT setting NODE_ENV=production. The backend never reads
    // it, and a global production value leaks into every spawned child (preview dev
    // servers, terminals), breaking `next dev`/Vite HMR (bundlers pick dev-vs-prod
    // from NODE_ENV, not the command). Dev spawns default to development instead.
    // No TOKEN here on purpose. pm2 keeps env keys from earlier configs (and ignores empty
    // values on --update-env), so a password passed this way once would stick around for
    // good. The backend reads ~/.claude-web/.password itself, and that file always wins.
    env: { PATH, HOST: process.env.HOST || "127.0.0.1", PORT: "8090", ...passthrough },
    autorestart: true,
    max_restarts: 20,
  },
];

// The tunnel is part of the set only once it has been configured; otherwise pm2 would
// restart a failing cloudflared forever on a local-only install.
if (fs.existsSync(TUNNEL_CONFIG)) {
  apps.push({
    name: "claudex-tunnel",
    script: CLOUDFLARED,
    interpreter: "none",
    args: `tunnel --config ${TUNNEL_CONFIG} --no-autoupdate run ${TUNNEL}`,
    env: { PATH },
    autorestart: true,
    max_restarts: 20,
  });
}

module.exports = { apps };
