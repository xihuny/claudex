# Claudex setup, written for an AI agent

Paste this whole file into Claude Code (or another coding agent) running on the machine where Claudex should live. The agent reads the instructions, asks the few questions it needs, and does the rest. A human can follow it too.

---

You are setting up **Claudex**, a self-hosted web UI for Claude Code, from https://github.com/xihuny/claudex. Work on this machine, step by step, and check each step before the next. Never print the contents of `~/.claude-web/.password` except once, at the end, to the person you are helping. Never commit or paste it anywhere else.

## Step 0: ask three questions

Ask the user, with short options:

1. **Where will this run?** (a) this personal computer, only for me, (b) a server/VPS I reach over SSH.
2. **Do you want to reach it from other devices?** (a) no, localhost only, (b) yes, over the internet with a domain on Cloudflare, (c) yes, via Tailscale, (d) only on my home Wi-Fi.
3. If 2(b): **which hostname?** (for example `claudex.example.com`), and do they also want preview URLs for their projects (`dev-<project>.example.com`)?

## Step 1: check the machine

Run and report:

```bash
uname -s; node -v 2>/dev/null; pnpm -v 2>/dev/null; claude --version 2>/dev/null; git --version
```

Rules:
- Linux or macOS is required. Windows must use WSL2.
- Node must be 20 or newer. If missing or old: on Linux install nvm (`curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash`, then `source ~/.bashrc && nvm install 22 && nvm alias default 22`); on macOS prefer `brew install node` or nvm.
- On Linux also run `sudo apt install -y build-essential python3 git curl lsof` (Debian/Ubuntu) or the equivalent. node-pty will not compile without it.
- If `claude` is missing: `curl -fsSL https://claude.ai/install.sh | bash`, make sure `~/.local/bin` is on PATH (add `export PATH="$HOME/.local/bin:$PATH"` to the shell rc file), then tell the user to run `claude` once in a terminal and log in. You cannot do the login for them; it opens a browser URL and needs their account. Wait until they confirm.
- Never run anything as root. If you are root on a fresh server, create a user first (`adduser claudex && usermod -aG sudo claudex`), copy the SSH key to it, and continue as that user.

## Step 2: install Claudex

```bash
cd ~
git clone https://github.com/xihuny/claudex.git
cd claudex
./setup.sh --no-start
```

Expected: it prints the detected tools, installs, builds, and prints a generated password once. Save that output for the final summary; do not echo the password again.

If `pnpm install` fails on node-pty, the build tools from Step 1 are missing. Fix that and re-run `./setup.sh --no-start`.

## Step 3: per-host settings

Create `~/.claude-web/env` from the answers in Step 0. Start from this and keep only what applies:

```bash
# listen on the LAN too (only if they chose "home Wi-Fi"; it is plain HTTP)
HOST=0.0.0.0
# named Cloudflare tunnel (only for the Cloudflare option; the name must match Step 4)
CX_TUNNEL_NAME=claudex
# stable preview URLs (only if they want them; needs the wildcard DNS + ingress rule from Step 4)
PREVIEW_DOMAIN=example.com
# contact for web push on a public deployment
PUSH_CONTACT=mailto:you@example.com
```

`chmod 600 ~/.claude-web/env`.

## Step 4: public access (skip for localhost-only)

### Cloudflare named tunnel

1. Install cloudflared: macOS `brew install cloudflared`; Ubuntu `curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o /tmp/cf.deb && sudo dpkg -i /tmp/cf.deb`.
2. `cloudflared tunnel login`. This prints a URL; the user must open it and pick the zone. Wait for them.
3. `cloudflared tunnel create <name>` where `<name>` is the `CX_TUNNEL_NAME` from Step 3 (default `claudex`). Record the tunnel ID it prints.
4. `cloudflared tunnel route dns <name> <hostname>`. If previews were requested, also `cloudflared tunnel route dns <name> '*.<domain>'`. If the wildcard is refused, tell the user to add a CNAME `*` → `<TUNNEL_ID>.cfargotunnel.com` (proxied) in the Cloudflare dashboard.
5. Write `~/.cloudflared/claudex.yml`:

```yaml
tunnel: <name>
credentials-file: <absolute path to ~/.cloudflared/<TUNNEL_ID>.json>

ingress:
  - hostname: <hostname>
    service: http://127.0.0.1:8090
  # include the next rule only if previews were requested
  - hostname: "*.<domain>"
    service: http://127.0.0.1:8090
  - service: http_status:404
```

Use the real absolute home path in `credentials-file` (no `~`).

### Tailscale

Install Tailscale and log in (`tailscale up`). Nothing else now; the user turns Funnel on later from Settings → Public access inside Claudex.

### Home Wi-Fi only

Nothing to install. `HOST=0.0.0.0` from Step 3 is enough. Tell the user it is plain HTTP.

## Step 5: start it

```bash
cd ~/claudex
./run-claudex.sh
```

Expected output ends with "Claudex is LIVE" and the URLs. If it reports the backend did not answer, run `pm2 logs claudex --lines 50` and fix what it says (usually a missing tool from Step 1).

Then make it survive reboots:

- Linux: `pm2 startup` prints a `sudo env PATH=... pm2 startup systemd -u <user> --hp /home/<user>` command. Run exactly that, then `pm2 save`.
- macOS: `pm2 startup` likewise, or tell the user to use Settings → System status → "Launch on startup" inside Claudex.

## Step 6: verify

1. `curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8090/` must print `200`.
2. `curl -s -X POST http://127.0.0.1:8090/api/login -H 'content-type: application/json' -d '{"password":"wrong"}' -w ' %{http_code}\n'` must print `401`.
3. If a tunnel was set up: `pm2 status` shows `claudex` and `claudex-tunnel` online, and `curl -sI https://<hostname>` returns `200`.
4. Ask the user to open the URL in a browser, log in with the password from Step 2, and add one project with the **+** button.

## Step 7: final summary to the user

Give them, in one short message:

- the URL(s) to open (localhost, LAN, public),
- the password, once, and where it is stored (`~/.claude-web/.password`),
- how to update: `cd ~/claudex && git pull && pnpm install && ./run-claudex.sh`,
- how to stop: `./stop-claudex.sh`,
- a reminder that whoever has the password can run commands as this user account, so the password must stay private, and that Claude runs without permission prompts in their own chats (see SECURITY.md in the repo).

Do not start additional services, open firewall ports, or change SSH settings unless the user asked for the VPS hardening in docs/SETUP.md part 3.2.
