# Contributing

Thanks for helping. Keep changes small and focused; one topic per pull request.

## Set up

```bash
git clone https://github.com/xihuny/claudex.git
cd claudex
pnpm install
./setup.sh --no-start        # builds once and creates a password
node --watch server/index.js # backend on :8090
pnpm dev                     # UI with hot reload on :5173 (proxies to :8090)
```

Log in at http://localhost:5173 with the password from `~/.claude-web/.password`.

## Before you open a pull request

- `pnpm typecheck` passes.
- `node --check server/*.js` passes.
- The app builds: `pnpm build`.
- You tried the change in the browser (desktop and, if it touches layout, a phone-sized viewport).
- No personal hostnames, paths, emails or tokens in the diff. Machine-specific values belong in `~/.claude-web/env`, not in the repo.
- If the change touches authentication, file serving, child processes or shares, say so in the description and read [SECURITY.md](SECURITY.md) first.

## Style

- Match the surrounding code. The server is plain Node (ES modules), the UI is React 19 + Tailwind 4 + zustand.
- Comments explain why, not what. Keep the existing ones unless they are wrong.
- No new runtime dependencies without a good reason; the project deliberately stays small.
- Use `pnpm`, not npm or yarn.

## Security issues

Report them privately. See [SECURITY.md](SECURITY.md).
