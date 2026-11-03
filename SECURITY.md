# Security

Claudex gives a browser full control of a machine through Claude Code. This page explains what protects that, what it does not protect, and how to report a problem.

## Reporting a vulnerability

Please do not open a public issue for a security problem. Use GitHub's private vulnerability reporting on this repository ("Security" tab, "Report a vulnerability"). You should get a first reply within a week.

## Threat model

Claudex is a single-owner tool. The owner is trusted completely; the goal is to keep everyone else out, and to keep an invited guest inside one project.

| Who | Can do |
|---|---|
| Owner (knows the password) | Everything the server's user account can do: shell, files, git, Claude Code in bypass mode. |
| Guest (holds a share link) | Prompt-only chat on one project, in a restricted Claude Code permission mode. |
| Anyone else | See the login page. |

## What is enforced

**Authentication**
- There is no password-less mode. If `~/.claude-web/.password` is missing, a random one is generated at first start and printed once.
- Login (`POST /api/login`) trades the password for a random session token. The browser stores the token, never the password. Tokens are stored hashed on the server and expire after 180 days idle; `POST /api/logout` revokes one.
- All comparisons of secrets are constant-time. Ten failed attempts from one address within 15 minutes block that address for the rest of the window. Behind Cloudflare, the address comes from `CF-Connecting-IP`.
- Every API route and websocket requires the token. Websocket handshakes must be same-origin (the `Origin` header has to match `Host`), which also stops DNS-rebinding and cross-site pages from reaching a local server. A socket that does not authenticate within 10 seconds is closed.
- Tokens never appear in URLs. Images and downloads (`/uploads/*`, `/api/fs/file`) are gated by an `HttpOnly; SameSite=Strict` cookie holding a random ticket, minted after login.

**Secrets at rest**
- `~/.claude-web/` is created `0700`; the password, guest tokens, session store, push keys and MCP configs are written `0600`.
- Child processes (Claude, terminals, dev servers, helpers) never inherit the password or other Claudex secrets in their environment.
- Claude Code hooks authenticate with their own random token, not the password.

**Served files**
- Uploaded and project files are served with `X-Content-Type-Options: nosniff`, a `Content-Security-Policy: sandbox` and, for anything that is not an image, audio, video or PDF, `Content-Disposition: attachment`. Nothing uploaded can run as a page on the app's origin.
- Markdown in chat renders no raw HTML; remote images are shown as links rather than fetched.
- The file browser is confined to the project directory (realpath-checked, symlinks included).

**Shares (guests)**
- A guest's Claude process runs in `acceptEdits` mode, not bypass mode: edits inside the project are auto-approved, everything that would need a permission prompt is auto-denied. It loads only the built-in `ask_user` MCP server (`--strict-mcp-config`), never the owner's MCP servers or their credentials. This is enforced by Claude Code itself: a guest's `Read` of `~/.zshrc` returns "denied by your permission settings" (verified against a live session), while files inside the project read normally.
- Deny rules additionally cover home-directory dot-files and config, other projects, system directories, the project's `.git/`, `.claude/`, `.mcp.json` and `.env*` files, and other guests' uploads.
- Guests upload images only (8 MB each, 200 per share) into their own folder, cannot run `!` shell commands, cannot use slash commands other than `/clear`, and are limited to two concurrent voice-typing sessions.
- Git for a guest goes through the server (commit + push of that one project), never a shell.
- "Let them run commands" grants Bash. That is a real shell as the server's user; the project boundary becomes advisory. The UI says so.

**Previews**
- A project's dev server is proxied by `Host` header only to a port that is verified to be listened on by that dev server's own process group, so a project's output cannot redirect its public preview to another local service.

**Other**
- No CORS headers are sent; the custom `X-Token` header and JSON bodies prevent classic CSRF.
- Request bodies are limited to 2 MB (30 MB for uploads); websocket frames to 1 MB.
- `pnpm audit --prod` is clean at release time; Dependabot is enabled on the repository.

## What is not enforced, and what you accept by running it

- **The owner's Claude runs with `--dangerously-skip-permissions`.** Claude will edit files and run commands without asking. A prompt injection (a crafted README, issue, or fetched page) can steer it. Treat repositories you open in Claudex as code you would run.
- **The password is a shell.** Anyone who obtains it, or a session token from a logged-in browser, owns the account Claudex runs as. Run Claudex as a dedicated user if you can, and never as root.
- **Plain HTTP on a LAN** (`HOST=0.0.0.0`) exposes the password in transit on that network. Prefer a tunnel (HTTPS) for anything beyond localhost.
- **Shares bill your Claude subscription**, and a guest with commands enabled is effectively a co-owner. Check your Anthropic terms before sharing access.
- **Usage pill**: Claudex reads Claude Code's OAuth token (Keychain on macOS, `~/.claude/.credentials.json` on Linux) to show your plan usage, and refreshes it when expired, writing the rotated token back. Set `CX_OAUTH_REFRESH=0` to make it read-only.
- **Settings actions that need sudo** (start at login, disable sleep on macOS) send your account password in the request. They are accepted only over HTTPS or from the machine itself, and the password is passed to `sudo -S` on stdin, never logged.
- The git and GitHub features use the credentials `git credential fill` returns for `github.com`.

## Hardening checklist for a public deployment

1. Put it behind a Cloudflare named tunnel or Tailscale Funnel (HTTPS, no inbound ports). `HOST` stays `127.0.0.1`.
2. Keep the generated password, or set one with 20+ random characters.
3. Run Claudex under its own OS user with access only to the projects it should see.
4. Keep `~/.claude-web/` at `0700` (the server enforces this on start).
5. Update regularly: `git pull && ./run-claudex.sh`, and `claude update`.
6. Review active shares in the UI from time to time and revoke the ones you no longer need.
