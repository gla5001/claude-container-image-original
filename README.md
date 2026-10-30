# Session Runner

A web UI that runs Claude Code (`claude`) in a pseudo-terminal and lets you drive it from the browser. The app only ever runs `claude`: the browser can't choose a different command. It shows live output, the last ~1000 lines of history, and whether the process is **Working** or **Needs input**.

Claude starts on its own when the first page opens. Other tabs join the same session. **Restart** stops Claude if it's running and starts it again on the same conversation (`claude --continue`, or a fresh `claude` if there's nothing to resume). If you quit Claude (`/exit`, Ctrl-C twice), it stays stopped until you press Restart. For a fresh conversation, use `/clear` inside Claude.

Requires Node 26 (`nvm use` picks it up from `.nvmrc`).

```sh
npm install
npm run dev      # web on http://localhost:5173, session server on 127.0.0.1:3001
npm test         # session lifecycle tests
npm run lint     # ESLint + Prettier check
npm run format   # auto-fix both
```

Prettier handles formatting. ESLint enforces two rules on top: braces on every `if`/`else`/loop (`curly`), and a blank line after every block (`padding-line-between-statements`).

### Production

```sh
npm run build    # dist/index.js (server bundle) + dist/public (client)
npm start        # serves everything from http://127.0.0.1:3001
```

To deploy, ship `package.json`, `package-lock.json` and `dist/`, then run `npm ci --omit=dev`. That installs only `express`, `ws` and `node-pty`. Configure with `PORT` (default 3001) and `SESSION_CWD`.

Claude runs in `SESSION_CWD` (default: the directory the server was started from). The browser can't change it.

### Docker

The image contains the app, Claude Code, and everything the [coding-agents](https://github.com/gla5001/coding-agents) need: `git`, `gh`, `jq`, `acli` (Jira board mode) and the Playwright MCP server with Chromium (for the QA agent). The coding-agents repo is cloned to `/home/node/coding-agents`, outside `/workspace`, and its `install.sh` links the agents, skills, hooks and mods into `~/.claude`.

#### Build

coding-agents is a private repo, so the build needs a GitHub token. It is passed as a build secret, which exists only during the clone step and is never stored in the image:

```sh
GH_TOKEN=$(gh auth token) docker build --secret id=gh_token,env=GH_TOKEN -t session-runner .
```

To add tools for the projects Claude will work on, pass Debian packages and/or global npm packages at build time. Node 26 and npm are always included.

```sh
GH_TOKEN=$(gh auth token) docker build --secret id=gh_token,env=GH_TOKEN \
  --build-arg EXTRA_APT_PACKAGES="python3 python3-venv python3-pip make" \
  --build-arg EXTRA_NPM_PACKAGES="pnpm yarn" \
  -t session-runner .
```

Both take a space-separated list. `EXTRA_APT_PACKAGES` uses Debian 13 (trixie) package names, for example `python3`, `golang`, `build-essential`, `postgresql-client`.

The repo defaults to `gla5001/coding-agents`. To use a fork or another copy, pass `--build-arg CODING_AGENTS_REPO=owner/repo` (a GitHub URL also works). It must have the same layout, with the install script at `claude-agents/install.sh`, and your token must be able to read it.

The clone is cached like any other build step, so a rebuild won't pick up new coding-agents commits on its own. Add `--no-cache` when you want the latest.

#### Credentials

Claude signs in with an OAuth token from your Claude subscription (Pro, Max, Team or Enterprise). Create one once on your machine: `claude setup-token` opens a browser sign-in and prints a token that lasts a year.

```sh
claude setup-token
export CLAUDE_CODE_OAUTH_TOKEN=<the token it printed>
```

#### Run

```sh
docker run --rm --init -p 127.0.0.1:3001:3001 \
  -e CLAUDE_CODE_OAUTH_TOKEN \
  -e GH_TOKEN="$(gh auth token)" \
  -e GIT_AUTHOR_NAME="$(git config user.name)" -e GIT_AUTHOR_EMAIL="$(git config user.email)" \
  -e GIT_COMMITTER_NAME="$(git config user.name)" -e GIT_COMMITTER_EMAIL="$(git config user.email)" \
  session-runner
```

Open http://localhost:3001. Ctrl+C stops the container.

- `-e CLAUDE_CODE_OAUTH_TOKEN` passes the token through from your shell, so it never appears in the command line. The image marks Claude's first-run setup as done, so Claude uses the token without asking for a browser login. To use a Console API key instead, pass `-e ANTHROPIC_API_KEY`. Pass only one of the two: an API key takes precedence over the token.
- To switch Claude accounts or replace an expired token without restarting the container, open **Settings** (the gear in the header) and paste a new token. It applies to every session started afterwards and replaces any `ANTHROPIC_API_KEY`. With **Restart the running session now** ticked, Claude restarts on the new token and picks up the same conversation (`claude --continue`, or a fresh `claude` if there's nothing to resume). The server keeps the token in memory only. It is never sent back to a browser and is gone when the container stops.
- `GH_TOKEN` logs `gh` in, and `git` uses `gh` for GitHub credentials, so the agents can clone, push and open PRs. The image stores no GitHub login of its own.
- The `GIT_*` variables give commits your name and email. Without them, `git commit` fails with "Author identity unknown".
- `acli` isn't logged in. If you use Jira board mode, run `acli jira auth login` inside a session.
- Claude still asks whether to trust `/workspace` the first time in each new container. Answer with ↓ then Enter.
- `-p 127.0.0.1:3001:3001` publishes the port only on your own machine. Keep the `127.0.0.1:` prefix: anyone who can reach the port gets a shell in the container, along with the tokens you passed in.
- Sessions run in `/workspace`, an empty folder inside the container. Anything created there is deleted when the container stops, so push work you want to keep.
- `--init` lets Ctrl+C and `docker stop` shut the server down.
- The image runs Node 26 on Debian trixie and is about 2.7 GB, mostly Chromium. It installs Claude Code with the [native installer](https://code.claude.com/docs/en/quickstart#step-1-install-claude-code) into `/home/node/.local/bin`.

## How it works

- `server/session.ts`: spawns `claude` through `$SHELL -c` in a PTY (`node-pty`), keeps a short output buffer for clients that reconnect, and tracks status. **Needs input** means the live process has printed nothing for 1.5s.
- `server/index.ts`: Express + `ws`. Relays output, input, and resize events between the session and every connected tab.
- `src/`: React + xterm.js terminal, quick keys for TUI prompts (↑ ↓ Enter Esc 1/2/3…), and a reply box. When the session blocks, the tab title changes and a desktop notification fires if the tab is hidden.
- `shared/protocol.ts`: the WebSocket message types both sides use.

## Status detection

**Needs input** is shown when the process has been quiet for 1.5s, or when a known blocking prompt appears (`BLOCKED_MARKERS` in `server/session.ts`). The second check covers prompts like the destruction-blocker mod's, where Claude's spinner keeps animating during the hold. It stays on until the user sends input.

## Destruction blocker mod

Claude loads the mod from `~/.claude/settings.json` like it does in any other terminal. Answer with the **1** (Proceed) or **2** (Cancel) quick keys, or **Esc** to interrupt (which also refuses the command). The mod's panel only appears when the terminal is at least 144 columns wide, which is roughly a 1200px+ browser window. In a narrower terminal the mod says it moved to the band above the prompt, but Claude never draws that band, so the hold is invisible and `1`/`2` get typed into the prompt. If that happens, press Esc.

## Security

This is a remote shell. The server binds to `127.0.0.1` by default (`HOST` overrides it; the Docker image uses `0.0.0.0`). It only accepts WebSocket connections from `localhost` origins. Don't expose it without adding authentication.
