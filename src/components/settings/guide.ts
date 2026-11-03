// Step-by-step "run Claudex on a VPS" guide, as data.
//
// This is the interactive twin of docs/SETUP.md - keep the two in sync when the
// deployment story changes. Every string may contain {{placeholders}}, substituted from
// the user's own values (see `fill`) so every command is copy-paste ready.
//
// Style: commands carry their explanation as `#` comments (rendered as captions, never
// copied). Prose blocks are for things a comment can't say. Keep it short.
import type { LucideIcon } from "lucide-react";
import { Server, Boxes, Globe, Rocket, Smartphone, Wrench } from "lucide-react";

export type Block =
  | { t: "p"; text: string }
  | { t: "list"; items: string[] }
  | { t: "code"; code: string; file?: string }
  | { t: "note"; kind: "warn" | "tip" | "info"; text: string }
  | { t: "table"; head: string[]; rows: string[][] };

export interface GuideStep {
  id: string;          // stable - it keys the saved "done" set
  title: string;
  sub: string;
  time: string;
  blocks: Block[];
}

export interface GuidePhase {
  id: string;
  title: string;
  desc: string;
  icon: LucideIcon;
  steps: GuideStep[];
}

export interface Vars { user: string; ip: string; domain: string; tunnel: string }

export const DEFAULT_VARS: Vars = {
  user: "claudex",
  ip: "SERVER_IP",
  domain: "example.com",
  tunnel: "claudex",
};

export const VAR_FIELDS: { key: keyof Vars; label: string; hint: string; placeholder: string }[] = [
  { key: "user", label: "Linux user", hint: "the non-root account", placeholder: "claudex" },
  { key: "ip", label: "Server IP", hint: "from your host", placeholder: "203.0.113.10" },
  { key: "domain", label: "Cloudflare zone", hint: "your domain", placeholder: "example.com" },
  { key: "tunnel", label: "Tunnel name", hint: "also this host's subdomain", placeholder: "claudex" },
];

/** Substitute {{user}}, {{ip}}, {{domain}}, {{tunnel}} and the derived {{host}}. */
export function fill(s: string, v: Vars): string {
  const host = `${v.tunnel}.${v.domain}`;
  return s
    .replace(/\{\{user\}\}/g, v.user || "user")
    .replace(/\{\{ip\}\}/g, v.ip || "SERVER_IP")
    .replace(/\{\{domain\}\}/g, v.domain || "example.com")
    .replace(/\{\{tunnel\}\}/g, v.tunnel || "claudex")
    .replace(/\{\{host\}\}/g, host);
}

/** Every shell line in a step, for the "copy all commands" button. */
export function stepCommands(step: GuideStep, v: Vars): string {
  return step.blocks.filter((b): b is Extract<Block, { t: "code" }> => b.t === "code" && !b.file)
    .map((b) => fill(b.code, v)).join("\n\n");
}

export const PHASES: GuidePhase[] = [
  // ── 1 ───────────────────────────────────────────────────────────────────────
  {
    id: "provision",
    title: "Provision the box",
    desc: "Order it, get a safe login",
    icon: Server,
    steps: [
      {
        id: "order",
        title: "Order the VPS",
        sub: "8 vCPU · 24 GB · NVMe · Ubuntu 24.04",
        time: "10 min",
        blocks: [
          { t: "list", items: [
            "8 vCPU / 24 GB RAM / 200 GB - each open project pins a warm claude process",
            "NVMe, not SSD - builds and node_modules are IOPS-bound",
            "Region closest to you - terminal latency",
            "Ubuntu 24.04 LTS",
            "Paste an SSH public key if the panel offers it",
          ] },
          { t: "code", code: "# on your own machine, if you have no key yet\nssh-keygen -t ed25519 -f ~/.ssh/claudex -C claudex\ncat ~/.ssh/claudex.pub" },
          { t: "note", kind: "info", text: "Only SSH ever needs to be reachable. Claudex goes public through an outbound tunnel, so no other inbound port is opened." },
        ],
      },
      {
        id: "user",
        title: "Create your user",
        sub: "Claudex never runs as root",
        time: "5 min",
        blocks: [
          { t: "code", code: "ssh root@{{ip}}" },
          { t: "code", code: "adduser {{user}}\nusermod -aG sudo {{user}}\nmkdir -p /home/{{user}}/.ssh\nnano /home/{{user}}/.ssh/authorized_keys   # paste your claudex.pub\nchmod 700 /home/{{user}}/.ssh\nchmod 600 /home/{{user}}/.ssh/authorized_keys\nchown -R {{user}}:{{user}} /home/{{user}}/.ssh" },
          { t: "note", kind: "warn", text: "Prove the new login works in a second terminal before the next step locks root out. Keep the root session open until it does." },
          { t: "code", code: "ssh -i ~/.ssh/claudex {{user}}@{{ip}}" },
        ],
      },
      {
        id: "harden",
        title: "Lock down SSH + firewall",
        sub: "Keys only, port 22 only",
        time: "5 min",
        blocks: [
          { t: "code", code: "sudo nano /etc/ssh/sshd_config" },
          { t: "code", file: "/etc/ssh/sshd_config", code: "PermitRootLogin no\nPasswordAuthentication no\nPubkeyAuthentication yes" },
          { t: "code", code: "sudo systemctl reload ssh" },
          { t: "code", code: "sudo ufw default deny incoming\nsudo ufw default allow outgoing\nsudo ufw allow OpenSSH\nsudo ufw enable\nsudo ufw status" },
          { t: "code", code: "# brute-force protection + automatic security updates\nsudo apt update\nsudo apt install -y fail2ban unattended-upgrades\nsudo dpkg-reconfigure -plow unattended-upgrades" },
        ],
      },
    ],
  },

  // ── 2 ───────────────────────────────────────────────────────────────────────
  {
    id: "runtime",
    title: "Runtime",
    desc: "Toolchain, Node, Claude, Git",
    icon: Boxes,
    steps: [
      {
        id: "base",
        title: "Packages + swap",
        sub: "node-pty needs a real toolchain",
        time: "5 min",
        blocks: [
          { t: "code", code: "sudo apt update && sudo apt -y upgrade\n# build-essential + python3 compile node-pty; without them terminals won't spawn\nsudo apt install -y build-essential python3 git curl ca-certificates" },
          { t: "code", code: "# 8 GB swap absorbs build + warm-process spikes\nsudo fallocate -l 8G /swapfile\nsudo chmod 600 /swapfile\nsudo mkswap /swapfile\nsudo swapon /swapfile\necho '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab\nfree -h" },
        ],
      },
      {
        id: "node",
        title: "Node 22 + pnpm",
        sub: "nvm and corepack",
        time: "5 min",
        blocks: [
          { t: "code", code: "curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash\nsource ~/.bashrc\nnvm install 22\nnvm alias default 22\nnode -v" },
          { t: "code", code: "corepack enable\ncorepack prepare pnpm@latest --activate\npnpm -v" },
        ],
      },
      {
        id: "cli",
        title: "Claude Code CLI",
        sub: "the binary Claudex drives",
        time: "5 min",
        blocks: [
          { t: "code", code: "curl -fsSL https://claude.ai/install.sh | bash\n# ~/.local/bin is where the native installer lands, and is on no default PATH\ngrep -q '.local/bin' ~/.bashrc || echo 'export PATH=\"$HOME/.local/bin:$PATH\"' >> ~/.bashrc\nsource ~/.bashrc\nclaude --version" },
          { t: "p", text: "Headless login: `claude` prints a URL. Open it in your own browser, approve, paste the code back, then `/exit`. Saved under `~/.claude`." },
          { t: "code", code: "claude" },
        ],
      },
      {
        id: "git",
        title: "Git + GitHub access",
        sub: "clone, push, and the in-app GitHub panel",
        time: "5 min",
        blocks: [
          { t: "code", code: "git config --global user.name \"Your Name\"\ngit config --global user.email \"you@example.com\"" },
          { t: "p", text: "Claudex reads your GitHub token through `git credential fill`, so a stored HTTPS credential powers both `git push` and the in-app repo list. An SSH deploy key covers pushing only." },
          { t: "code", code: "git config --global credential.helper store\n# create a PAT at github.com/settings/tokens (repo scope), then:\nprintf 'https://USERNAME:YOUR_TOKEN@github.com\\n' > ~/.git-credentials\nchmod 600 ~/.git-credentials" },
          { t: "code", code: "# verify - should list refs without prompting\ngit ls-remote https://github.com/USERNAME/some-private-repo" },
          { t: "note", kind: "warn", text: "~/.git-credentials holds the token in plaintext. Scope the PAT to what you actually need and set an expiry." },
        ],
      },
    ],
  },

  // ── 3 ───────────────────────────────────────────────────────────────────────
  {
    id: "tunnel",
    title: "Go public",
    desc: "A named Cloudflare tunnel",
    icon: Globe,
    steps: [
      {
        id: "cf-install",
        title: "Install cloudflared",
        sub: "and authorize your zone",
        time: "3 min",
        blocks: [
          { t: "code", code: "curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o /tmp/cloudflared.deb\nsudo dpkg -i /tmp/cloudflared.deb\ncloudflared --version" },
          { t: "code", code: "# prints a URL - open it locally and pick the zone for {{domain}}\ncloudflared tunnel login" },
        ],
      },
      {
        id: "cf-create",
        title: "Create this host's tunnel",
        sub: "one tunnel per machine",
        time: "3 min",
        blocks: [
          { t: "note", kind: "warn", text: "A named tunnel is one endpoint. Run the same one from two machines and Cloudflare load-balances between them - your hostname serves one box on one request, the other on the next. If another machine already runs a Claudex tunnel, give this host its own name (and set CX_TUNNEL_NAME to it in ~/.claude-web/env)." },
          { t: "code", code: "cloudflared tunnel create {{tunnel}}\n# note the TUNNEL_ID (UUID) - the config below references it\ncloudflared tunnel list" },
        ],
      },
      {
        id: "cf-dns",
        title: "DNS records",
        sub: "the app, plus a wildcard for previews",
        time: "3 min",
        blocks: [
          { t: "code", code: "cloudflared tunnel route dns {{tunnel}} {{host}}\n# the wildcard is what gives previews stable dev-* subdomains\ncloudflared tunnel route dns {{tunnel}} '*.{{domain}}'" },
          { t: "note", kind: "info", text: "A wildcard only answers names with no more specific record, so existing subdomains keep working. If the CLI refuses it, add it in the dashboard: CNAME, name `*`, target `<TUNNEL_ID>.cfargotunnel.com`, proxied." },
        ],
      },
      {
        id: "cf-config",
        title: "Tunnel config file",
        sub: "~/.cloudflared/claudex.yml",
        time: "3 min",
        blocks: [
          { t: "note", kind: "info", text: "`~/.cloudflared/claudex.yml` is the default path Claudex looks for. To use another, set CX_TUNNEL_CONFIG in ~/.claude-web/env." },
          { t: "code", code: "nano ~/.cloudflared/claudex.yml" },
          { t: "code", file: "~/.cloudflared/claudex.yml", code: "tunnel: {{tunnel}}\ncredentials-file: /home/{{user}}/.cloudflared/<TUNNEL_ID>.json\n\ningress:\n  - hostname: {{host}}\n    service: http://127.0.0.1:8090\n  # previews: the wildcard lands here, and the backend routes by Host header\n  - hostname: \"*.{{domain}}\"\n    service: http://127.0.0.1:8090\n  - service: http_status:404" },
          { t: "p", text: "PM2 also passes `run {{tunnel}}` on the command line (from CX_TUNNEL_NAME, default `claudex`), which overrides the `tunnel:` key. Keep both the same." },
        ],
      },
    ],
  },

  // ── 4 ───────────────────────────────────────────────────────────────────────
  {
    id: "deploy",
    title: "Deploy Claudex",
    desc: "Clone, configure, supervise",
    icon: Rocket,
    steps: [
      {
        id: "clone",
        title: "Clone + setup",
        sub: "one script installs, builds and starts it",
        time: "5 min",
        blocks: [
          { t: "code", code: "cd ~\ngit clone https://github.com/xihuny/claudex.git\ncd claudex\n./setup.sh" },
          { t: "p", text: "`setup.sh` checks Node and pnpm, builds the app, generates a login password (printed once, saved to `~/.claude-web/.password`), installs pm2 and starts Claudex on 127.0.0.1:8090." },
          { t: "note", kind: "info", text: "The `postinstall` chmod targets macOS node-pty prebuilds and no-ops on Linux. Expected." },
        ],
      },
      {
        id: "config",
        title: "Per-host settings",
        sub: "~/.claude-web/env and config.json",
        time: "3 min",
        blocks: [
          { t: "p", text: "Settings that differ per machine live outside the repo. `run-claudex.sh` sources `~/.claude-web/env` before starting pm2." },
          { t: "code", file: "~/.claude-web/env", code: "CX_TUNNEL_NAME={{tunnel}}\n# optional: stable dev-<project>.{{domain}} previews (needs the wildcard DNS + ingress rule)\nPREVIEW_DOMAIN={{domain}}\n# optional: contact for web push (Apple requires a real address or https URL)\nPUSH_CONTACT=mailto:you@example.com" },
          { t: "code", code: "# change the password any time: edit the file (no trailing newline), then redeploy\nprintf 'YOUR_STRONG_PASSWORD' > ~/.claude-web/.password\nchmod 600 ~/.claude-web/.password" },
        ],
      },
      {
        id: "pm2",
        title: "Autostart on reboot",
        sub: "register the systemd hook once",
        time: "3 min",
        blocks: [
          { t: "p", text: "`ecosystem.config.cjs` runs `claudex` (backend on :8090) and, once `~/.cloudflared/claudex.yml` exists, `claudex-tunnel` (cloudflared)." },
          { t: "code", code: "# this PRINTS a `sudo env PATH=… pm2 …` line - run that exactly as printed\npm2 startup systemd -u {{user}} --hp /home/{{user}}\npm2 save" },
        ],
      },
      {
        id: "launch",
        title: "Deploy / redeploy",
        sub: "./run-claudex.sh",
        time: "2 min",
        blocks: [
          { t: "code", code: "cd ~/claudex\n./run-claudex.sh" },
          { t: "list", items: [
            "re-execs detached, so it survives restarting the backend it was launched from",
            "pnpm build",
            "arms claudex-guard.sh - a 90s watchdog that revives the backend if the deploy dies",
            "sources ~/.claude-web/env, then pm2 startOrReload --update-env",
            "pm2 save - refreshes the reboot snapshot",
            "polls :8090 for 20s and reports",
          ] },
          { t: "p", text: "Run from a terminal inside Claudex it prints “Detached” and returns; that session drops for ~20s, then comes back." },
          { t: "code", code: "tail -f ~/.claude-web/run.log" },
        ],
      },
      {
        id: "verify",
        title: "Verify + reboot test",
        sub: "prove autostart works",
        time: "3 min",
        blocks: [
          { t: "p", text: "Open **https://{{host}}** - you should get the login gate. Enter the password from `~/.claude-web/.password`." },
          { t: "code", code: "sudo reboot" },
          { t: "code", code: "# reconnect after ~30s - both should be back with no intervention\npm2 status\npm2 describe claudex-tunnel | grep -i args   # must read: run {{tunnel}}" },
          { t: "note", kind: "tip", text: "Reboots are safe: resurrect replays the saved args, which already contain the tunnel name." },
        ],
      },
    ],
  },

  // ── 5 ───────────────────────────────────────────────────────────────────────
  {
    id: "use",
    title: "Daily use",
    desc: "Install it, get pinged, add work",
    icon: Smartphone,
    steps: [
      {
        id: "pwa",
        title: "Install as an app",
        sub: "iOS, Android, desktop",
        time: "2 min",
        blocks: [
          { t: "list", items: [
            "iOS Safari - open https://{{host}}, Share → Add to Home Screen",
            "Android Chrome - menu → Install app",
            "Desktop Chrome/Edge - install icon in the address bar",
          ] },
          { t: "note", kind: "info", text: "On iOS, push notifications only work from the installed Home Screen app - not from a Safari tab." },
        ],
      },
      {
        id: "push",
        title: "Notifications",
        sub: "Settings → Notifications → Enable",
        time: "2 min",
        blocks: [
          { t: "p", text: "Enabling subscribes this device and installs the Claude hooks that report turn events. Do it once per device." },
          { t: "list", items: [
            "When Claude finishes a turn",
            "When Claude needs my input",
            "Stay quiet for the project I'm viewing",
          ] },
          { t: "p", text: "“Send a test” confirms delivery end to end. If hooks show as missing, install them from the same pane." },
        ],
      },
      {
        id: "projects",
        title: "Add your projects",
        sub: "clone, then pick the folder",
        time: "3 min",
        blocks: [
          { t: "code", code: "mkdir -p ~/Projects\ncd ~/Projects\ngit clone https://github.com/USERNAME/your-repo.git" },
          { t: "p", text: "Sidebar → **+** → browse to the folder → Add. `~/Projects`, `~/code`, `~/repos`, `~/dev`, `~/src` and `~/Developer` show up as shortcuts in the picker. Saved to `~/.claude-web/projects.json`." },
          { t: "note", kind: "tip", text: "A project can hold several sessions - separate Claude conversations against the same folder." },
        ],
      },
      {
        id: "previews",
        title: "Project previews",
        sub: "dev-<project>.{{domain}}",
        time: "reference",
        blocks: [
          { t: "p", text: "Run project → Expose starts the dev server and publishes it. The wildcard record and `*.{{domain}}` ingress rule already point here; the backend proxies by Host header, WebSockets included, so HMR works." },
          { t: "p", text: "Default label `dev-<slug>` - the prefix stops a preview shadowing a real subdomain. Override per project in the Expose UI (saved as `devName`). Must be a valid DNS label; the hostnames in your tunnel config, `www`, `mail`, `api`, `app` and `admin` are reserved." },
          { t: "note", kind: "warn", text: "`PREVIEW_DOMAIN` is read once at startup. After editing ~/.claude-web/env, redeploy with ./run-claudex.sh." },
        ],
      },
    ],
  },

  // ── 6 ───────────────────────────────────────────────────────────────────────
  {
    id: "operate",
    title: "Operate",
    desc: "Update, back up, fix",
    icon: Wrench,
    steps: [
      {
        id: "update",
        title: "Deploy updates",
        sub: "pull, then one script",
        time: "reference",
        blocks: [
          { t: "code", code: "cd ~/claudex\ngit pull\npnpm install          # only if deps changed\n./run-claudex.sh" },
          { t: "code", code: "# stop, and stay stopped across reboots\n./stop-claudex.sh" },
          { t: "note", kind: "tip", text: "Prefer the script over `pnpm build && pm2 restart`: it carries the tunnel name, arms the watchdog, and refreshes the reboot snapshot in one step." },
        ],
      },
      {
        id: "logs",
        title: "Logs",
        sub: "tail, and keep them from filling the disk",
        time: "reference",
        blocks: [
          { t: "code", code: "pm2 logs claudex\npm2 logs claudex-tunnel\ntail -f ~/.claude-web/run.log     # last deploy\ntail -f ~/.claude-web/guard.log   # watchdog" },
          { t: "code", code: "# rotate, or pm2's logs grow without bound\npm2 install pm2-logrotate\npm2 set pm2-logrotate:max_size 10M\npm2 set pm2-logrotate:retain 7\npm2 set pm2-logrotate:compress true" },
          { t: "code", code: "pm2 flush          # truncate now\ndf -h              # disk\nfree -h            # memory + swap" },
        ],
      },
      {
        id: "backup",
        title: "Backup + move box",
        sub: "four directories hold everything",
        time: "reference",
        blocks: [
          { t: "table", head: ["Path", "Holds"], rows: [
            ["~/.claude", "Claude login + session history"],
            ["~/.claude-web", "projects.json, env, password, push subs, sessions"],
            ["~/.cloudflared", "tunnel credentials + claudex.yml"],
            ["~/claudex", "the app"],
          ] },
          { t: "code", code: "tar czf ~/claudex-state.tgz -C ~ .claude .claude-web .cloudflared\n# pull it down from your own machine\nscp {{user}}@{{ip}}:~/claudex-state.tgz ." },
          { t: "code", code: "# on the new box: run every step above through “PM2 + autostart”, then\nscp claudex-state.tgz {{user}}@NEW_IP:~\nssh {{user}}@NEW_IP\ntar xzf ~/claudex-state.tgz -C ~\ncd ~/claudex && ./run-claudex.sh" },
          { t: "note", kind: "info", text: "The tunnel credentials move with the state, so the hostname follows the new box as soon as the old one stops. Never run both at once." },
        ],
      },
      {
        id: "maintain",
        title: "Maintenance",
        sub: "password, upgrades, uninstall",
        time: "reference",
        blocks: [
          { t: "code", code: "claude update && pm2 restart claudex" },
          { t: "code", code: "# change the access password, then restart so it is re-read\nprintf 'NEW_PASSWORD' > ~/.claude-web/.password\ncd ~/claudex && ./run-claudex.sh" },
          { t: "code", code: "# upgrading Node breaks node-pty's native build until it's rebuilt\nnvm install 24 && nvm alias default 24\ncd ~/claudex && pnpm rebuild node-pty && ./run-claudex.sh" },
          { t: "code", code: "# remove it completely\ncd ~/claudex && ./stop-claudex.sh\npm2 delete all && pm2 save\npm2 unstartup systemd" },
        ],
      },
      {
        id: "trouble",
        title: "Troubleshooting",
        sub: "symptom → check",
        time: "reference",
        blocks: [
          { t: "table", head: ["Symptom", "Check"], rows: [
            ["Public URL 502", "pm2 status - is claudex online? It must listen on 127.0.0.1:8090."],
            ["Tunnel won't start", "credentials-file in claudex.yml must match the real <TUNNEL_ID>.json."],
            ["Hostname serves the wrong box", "Two machines on one tunnel. pm2 describe claudex-tunnel must say run {{tunnel}}."],
            ["claude: command not found", "~/.local/bin missing from PATH. Reinstall, then ./run-claudex.sh."],
            ["Terminals won't spawn", "pnpm rebuild node-pty (needs build-essential + python3)."],
            ["Too many attempts", "10 wrong passwords in 15 minutes locks that address out for the rest of the window."],
            ["Password change ignored", "The file is read at start. Restart with ./run-claudex.sh."],
            ["Changes don't appear", "Skipped pnpm build, or the service worker cached - hard-refresh."],
            ["Preview doesn't resolve", "Wildcard DNS record or the *.{{domain}} ingress rule is missing."],
            ["Preview shows Claudex itself", "PREVIEW_DOMAIN unset, not reloaded, or the label is reserved."],
            ["GitHub panel says no login", "git credential fill returns nothing - redo ~/.git-credentials."],
            ["Out of memory", "Each open project pins a warm claude. Close projects, or size up."],
            ["Disk full", "pm2 flush, install pm2-logrotate, prune old node_modules."],
          ] },
        ],
      },
    ],
  },
];

export const ALL_STEP_IDS = PHASES.flatMap((p) => p.steps.map((s) => s.id));

export const DONE_KEY = "cx_vps_done";
export const VARS_KEY = "cx_vps_vars";

/** Saved progress, filtered to steps that still exist (ids survive content edits). */
export function loadDoneIds(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(DONE_KEY) || "[]") as string[];
    return raw.filter((id) => ALL_STEP_IDS.includes(id));
  } catch { return []; }
}
