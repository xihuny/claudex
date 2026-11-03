# Setting up Claudex

This covers every way to run Claudex: on the computer in front of you, on a Linux server, and reachable from the internet. Each part is independent; do only the parts you need.

- [1. Requirements](#1-requirements)
- [2. Personal machine (macOS or Linux)](#2-personal-machine-macos-or-linux)
- [3. VPS (Ubuntu)](#3-vps-ubuntu)
- [4. Public access](#4-public-access)
- [5. Project previews on your own domain](#5-project-previews-on-your-own-domain)
- [6. Phone, notifications, voice typing](#6-phone-notifications-voice-typing)
- [7. Operate: update, password, backup, uninstall](#7-operate-update-password-backup-uninstall)
- [8. Troubleshooting](#8-troubleshooting)

## 1. Requirements

| Need | Why | Install |
|---|---|---|
| Node 20 or newer | runs the server and the build | https://nodejs.org or `nvm install 22` |
| pnpm | package manager | `corepack enable` (setup.sh does this) |
| Claude Code CLI, logged in | every chat and terminal drives it | `curl -fsSL https://claude.ai/install.sh \| bash`, then run `claude` once and log in |
| git | git features, cloning | usually present |
| Linux only: `build-essential python3` | compiles node-pty (terminals) | `sudo apt install -y build-essential python3` |
| Optional: `cloudflared` or Tailscale | public access | see part 4 |
| Optional: `tmux` | terminals that survive a server restart (`USE_TMUX=1`) | package manager |

Windows is not supported as a host (node-pty and the shell helpers assume a Unix shell). WSL2 works like Linux.

## 2. Personal machine (macOS or Linux)

```bash
git clone https://github.com/xihuny/claudex.git
cd claudex
./setup.sh
```

What `setup.sh` does, in order:

1. Checks Node, pnpm and `claude`. Tells you what is missing and how to get it.
2. `pnpm install` and `pnpm build`.
3. Creates `~/.claude-web/.password` with a random password if there is none, and prints it once.
4. Installs pm2 and starts Claudex on **http://localhost:8090**, bound to 127.0.0.1 only.

Open the URL, enter the password, add a project with the **+** in the sidebar.

Options:

- `./setup.sh --no-start`: do steps 1 to 3 only. Then run `node server/index.js` in the foreground whenever you want it.
- `./setup.sh --lan`: also listen on your Wi-Fi (`HOST=0.0.0.0`). Other devices on the same network can open `http://<your-ip>:8090`. This is plain HTTP; use it only on networks you trust. To make it permanent, put `HOST=0.0.0.0` in `~/.claude-web/env`.

Start at login:

- macOS: Settings (gear icon) → System status → "Launch on startup" (asks for your account password once), or run `pm2 startup` and the command it prints.
- Linux: `pm2 startup` prints a `sudo env PATH=... pm2 startup systemd ...` command. Run it, then `pm2 save`.

macOS extras: `Run Claudex.command` and `Stop Claudex.command` can be double-clicked in Finder. Settings → System status can also disable sleep so the Mac stays reachable.

## 3. VPS (Ubuntu)

A 2 vCPU / 4 GB box runs Claudex comfortably for one person; every open project keeps a warm `claude` process (a few hundred MB each), so size memory by the number of projects you keep open.

### 3.1 First login and a non-root user

```bash
ssh root@SERVER_IP
adduser claudex
usermod -aG sudo claudex
mkdir -p /home/claudex/.ssh
cp ~/.ssh/authorized_keys /home/claudex/.ssh/   # or paste your public key
chmod 700 /home/claudex/.ssh && chmod 600 /home/claudex/.ssh/authorized_keys
chown -R claudex:claudex /home/claudex/.ssh
```

Open a second terminal and check `ssh claudex@SERVER_IP` works before you continue.

### 3.2 Harden SSH and the firewall

```bash
sudo sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/; s/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo systemctl reload ssh
sudo ufw default deny incoming && sudo ufw default allow outgoing
sudo ufw allow OpenSSH && sudo ufw enable
sudo apt update && sudo apt install -y fail2ban unattended-upgrades
```

Only SSH is ever open. Claudex becomes public through an outbound tunnel (part 4), so port 8090 stays closed.

### 3.3 Tools

```bash
sudo apt install -y build-essential python3 git curl ca-certificates lsof
# swap helps builds and warm processes on small boxes
sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Node 22 via nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc
nvm install 22 && nvm alias default 22

# Claude Code
curl -fsSL https://claude.ai/install.sh | bash
grep -q '.local/bin' ~/.bashrc || echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
claude          # prints a login URL: open it in your own browser, paste the code back, then /exit
```

Git identity and GitHub access (needed for push and the in-app GitHub panel):

```bash
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
git config --global credential.helper store
# create a fine-grained token at github.com/settings/tokens with repo access, then:
printf 'https://USERNAME:YOUR_TOKEN@github.com\n' > ~/.git-credentials
chmod 600 ~/.git-credentials
```

### 3.4 Claudex

```bash
cd ~ && git clone https://github.com/xihuny/claudex.git && cd claudex
./setup.sh
pm2 startup      # run the sudo command it prints
pm2 save
```

Claudex now listens on 127.0.0.1:8090 on the server. Continue with part 4 to reach it from outside.

## 4. Public access

Two options. Both give you HTTPS with no inbound ports.

### 4.1 Cloudflare named tunnel (recommended, needs a domain on Cloudflare)

```bash
# install cloudflared
# macOS:  brew install cloudflared
# Ubuntu: curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o /tmp/cf.deb && sudo dpkg -i /tmp/cf.deb

cloudflared tunnel login                 # opens a browser: pick your zone
cloudflared tunnel create claudex        # note the TUNNEL_ID
cloudflared tunnel route dns claudex claudex.example.com
```

Create `~/.cloudflared/claudex.yml`:

```yaml
tunnel: claudex
credentials-file: /home/claudex/.cloudflared/<TUNNEL_ID>.json   # ~/.cloudflared/... on macOS

ingress:
  - hostname: claudex.example.com
    service: http://127.0.0.1:8090
  - service: http_status:404
```

Then:

```bash
cd ~/claudex && ./run-claudex.sh
```

`run-claudex.sh` sees the config file and adds the `claudex-tunnel` process to pm2. Open **https://claudex.example.com**.

One tunnel per machine. If you run Claudex on two machines, give each its own tunnel name and hostname, and put `CX_TUNNEL_NAME=<name>` in that machine's `~/.claude-web/env`. Running the same tunnel from two machines makes Cloudflare load-balance between them.

Add Cloudflare Access (Zero Trust) in front of the hostname if you want a second login layer; Claudex works unchanged behind it.

### 4.2 Tailscale Funnel

Install Tailscale on the host, then Settings → Public access → Tailscale. Claudex turns Funnel on for you and shows the `https://<host>.<tailnet>.ts.net` URL. Only your tailnet's devices, or anyone with the URL if Funnel is on, can reach it; the password still applies.

## 5. Project previews on your own domain

"Run project → Expose" starts a project's dev server and publishes it.

- Without configuration, each preview gets a random `*.trycloudflare.com` URL (needs `cloudflared` installed).
- With a named tunnel you can have stable `https://dev-<project>.example.com` URLs instead:

```bash
cloudflared tunnel route dns claudex '*.example.com'
```

Add the wildcard to `~/.cloudflared/claudex.yml` above the 404 rule:

```yaml
  - hostname: "*.example.com"
    service: http://127.0.0.1:8090
```

Put `PREVIEW_DOMAIN=example.com` in `~/.claude-web/env` and redeploy (`./run-claudex.sh`). Claudex routes each preview hostname to the right dev server, websockets included, so hot reload works. The label defaults to `dev-<project>` and can be changed per project in the Expose dialog; the hostnames in your tunnel config and a few common names (`www`, `api`, `app`, `mail`, `admin`) are reserved.

Previews are public to anyone who knows the URL. They are your project's dev server, not Claudex, and have no password.

## 6. Phone, notifications, voice typing

**Install as an app**: iOS Safari → Share → Add to Home Screen. Android Chrome → menu → Install app. Desktop Chrome/Edge → install icon in the address bar.

**Notifications**: Settings → Notifications → Enable, once per device. Claudex pushes when Claude finishes a turn or asks you something. On iOS this works only from the Home Screen app. If your deployment is public, set `PUSH_CONTACT=mailto:you@example.com` in `~/.claude-web/env` (Apple's push service wants a real contact).

**Voice typing** (optional, fully local): `./server/asr-install-models.sh` downloads a 68 MB streaming model (checksummed), then restart Claudex. A mic button appears in the composer. The model is CC-BY-SA.

## 7. Operate: update, password, backup, uninstall

```bash
# update (pnpm install only matters when package.json changed; it is quick when nothing did)
cd ~/claudex && git pull && pnpm install && ./run-claudex.sh

# update Claude Code
claude update && pm2 restart claudex

# change the password (no trailing newline), then restart
printf 'NEW_PASSWORD' > ~/.claude-web/.password && chmod 600 ~/.claude-web/.password
./run-claudex.sh

# logs
pm2 logs claudex
pm2 logs claudex-tunnel
tail -f ~/.claude-web/run.log      # last deploy
pm2 install pm2-logrotate          # once, so logs don't grow without bound

# stop (stays stopped across reboots)
./stop-claudex.sh
```

Backup: four directories hold everything.

| Path | Holds |
|---|---|
| `~/.claude` | Claude Code login and conversation history |
| `~/.claude-web` | projects, password, env, sessions, push subscriptions, chat transcripts |
| `~/.cloudflared` | tunnel credentials and config |
| `~/claudex` | the app |

```bash
tar czf ~/claudex-state.tgz -C ~ .claude .claude-web .cloudflared
```

Restore on a new box: do parts 2 or 3 up to `./setup.sh --no-start`, unpack the archive in `~`, then `./run-claudex.sh`. Stop the old machine first if it runs the same tunnel.

Uninstall:

```bash
cd ~/claudex && ./stop-claudex.sh
pm2 delete all && pm2 save && pm2 unstartup
rm -rf ~/claudex ~/.claude-web ~/claude-uploads ~/claude-uploads-guests
```

## 8. Troubleshooting

| Symptom | Check |
|---|---|
| Public URL gives 502 | `pm2 status`: is `claudex` online? It must listen on 127.0.0.1:8090. |
| Tunnel won't start | `credentials-file` in `claudex.yml` must match the real `<TUNNEL_ID>.json`. |
| Hostname serves the wrong machine | Two machines on one tunnel. `pm2 describe claudex-tunnel` must show `run <this host's tunnel>`. |
| `claude: command not found` in chats | `~/.local/bin` is not on PATH for pm2. Reinstall Claude Code, then `./run-claudex.sh`. |
| Terminals won't open | `pnpm rebuild node-pty` (Linux needs `build-essential python3`). |
| "Too many attempts" | 10 wrong passwords within 15 minutes block that address until the window passes. |
| Password change ignored | The file is read at start. `./run-claudex.sh`. |
| Images in chat don't load | The file cookie is set after login; reload the page once. |
| UI changes don't show after an update | Hard-refresh; the service worker updates in the background. |
| Preview hostname doesn't resolve | Wildcard DNS record or the `*.example.com` ingress rule is missing. |
| Preview shows Claudex itself | `PREVIEW_DOMAIN` unset or not reloaded, or the label is reserved. |
| GitHub panel says no login | `git credential fill` returns nothing for github.com. Redo the credential step. |
| High memory | Each open project pins a warm `claude`. Close projects, or set `CHAT_IDLE_MS`. |
| Disk filling up | `pm2 flush`, install `pm2-logrotate`, prune old `node_modules`. |
