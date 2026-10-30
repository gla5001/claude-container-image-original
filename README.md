# Session Runner

A web UI that runs a command (default: `claude`) in a pseudo-terminal and lets you drive it from the browser. It shows live output, the last ~1000 lines of history, and whether the process is **Working** or **Needs input**.

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

The command runs in `SESSION_CWD` (default: the directory the server was started from). The browser can't change it.

## How it works

- `server/session.ts`: spawns the command through `$SHELL -c` in a PTY (`node-pty`), keeps a short output buffer for clients that reconnect, and tracks status. **Needs input** means the live process has printed nothing for 1.5s.
- `server/index.ts`: Express + `ws`. Relays output, input, and resize events between the session and every connected tab.
- `src/`: React + xterm.js terminal, quick keys for TUI prompts (↑ ↓ Enter Esc 1/2/3…), and a reply box. When the session blocks, the tab title changes and a desktop notification fires if the tab is hidden.
- `shared/protocol.ts`: the WebSocket message types both sides use.

## Status detection

**Needs input** is shown when the process has been quiet for 1.5s, or when a known blocking prompt appears (`BLOCKED_MARKERS` in `server/session.ts`). The second check covers prompts like the destruction-blocker mod's, where Claude's spinner keeps animating during the hold. It stays on until the user sends input.

## Destruction blocker mod

Claude loads the mod from `~/.claude/settings.json` like it does in any other terminal. Answer with the **1** (Proceed) or **2** (Cancel) quick keys, or **Esc** to interrupt (which also refuses the command). The mod's panel only appears when the terminal is at least 144 columns wide, which is roughly a 1200px+ browser window. In a narrower terminal the mod says it moved to the band above the prompt, but Claude never draws that band, so the hold is invisible and `1`/`2` get typed into the prompt. If that happens, press Esc.

## Security

This is a remote shell. The server binds to `127.0.0.1` and only accepts WebSocket connections from `localhost` origins. Don't expose it without adding authentication.
