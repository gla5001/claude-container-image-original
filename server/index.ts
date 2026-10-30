import express from 'express';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import type { ClientMessage, ServerMessage, TermSize } from '../shared/protocol';
import { Session } from './session';

const PORT = Number(process.env.PORT ?? 3001);
// This is a remote shell with no login: it listens on loopback unless told otherwise. Only local
// Docker sets HOST=0.0.0.0, and then publishes the port on the host's loopback only.
const HOST = process.env.HOST ?? '127.0.0.1';
const CWD = process.env.SESSION_CWD ?? process.cwd(); // set by the operator, never by the browser

// Block cross-site WebSocket hijacking: only pages served from this machine may drive the shell.
function isLocalOrigin(origin?: string) {
  if (!origin) {
    return true; // non-browser client
  }

  try {
    return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname);
  } catch {
    return false;
  }
}

// ponytail: one shared session for every tab; key sessions by id if you need several at once
const session = new Session();

// A Claude OAuth token set from the app's settings. It replaces the CLAUDE_CODE_OAUTH_TOKEN the server
// started with for every session started afterwards. Kept in memory only and never sent to a browser,
// so it is gone when the server restarts.
let oauthToken: string | undefined;

// claude ranks an API key above an OAuth token, so a token set in the app also hides any API key.
const sessionEnv = () => (oauthToken ? { CLAUDE_CODE_OAUTH_TOKEN: oauthToken, ANTHROPIC_API_KEY: undefined } : {});
const settingsMessage = (): ServerMessage => ({ type: 'settings', settings: { oauthTokenSet: Boolean(oauthToken) } });

// Validated here because it lands in the environment of every session. Empty clears it.
function parseToken(token: unknown) {
  if (typeof token !== 'string') {
    throw new Error('The token must be text.');
  }

  const trimmed = token.trim();
  if (trimmed && !/^[\x21-\x7e]{1,4096}$/.test(trimmed)) {
    throw new Error("That doesn't look like a token: it should be one line with no spaces.");
  }

  return trimmed || undefined;
}

// The app only ever runs claude: the browser can't choose a command.
// A restart resumes claude's latest conversation. `--continue` exits with "No conversation found"
// when there is none, so fall back to a fresh claude. Normal quits exit 0 and Stop kills the shell
// too, so the fallback only runs when the resume fails. Clients see just `claude --continue`.
function startSession({ cols, rows }: TermSize, resume = false) {
  session.start({
    command: resume ? 'claude --continue || claude' : 'claude',
    label: resume ? 'claude --continue' : 'claude',
    cwd: CWD,
    cols,
    rows,
    env: sessionEnv(),
  });
  broadcast({ type: 'reset' });
}

// The built client sits next to the built server (dist/public beside dist/index.js); in dev, Vite serves it.
const app = express().use(express.static(fileURLToPath(new URL('./public', import.meta.url))));
const server = createServer(app);
const wss = new WebSocketServer({
  server,
  path: '/ws',
  verifyClient: ({ origin }: { origin?: string }) => isLocalOrigin(origin),
});

const send = (ws: WebSocket, msg: ServerMessage) => {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
};

const broadcast = (msg: ServerMessage) => wss.clients.forEach((ws) => send(ws, msg));

session.on('output', (data) => broadcast({ type: 'output', data }));
session.on('state', (state) => broadcast({ type: 'state', state }));

function handle(msg: ClientMessage) {
  switch (msg.type) {
    case 'start':
      // Every page asks on load, so only the first one after the server starts gets claude running.
      // Once claude has run, only an explicit restart brings it back: quitting it stays quit.
      if (session.state.status === 'idle') {
        startSession(msg);
      }

      break;
    case 'restart':
      startSession(msg, true);
      break;
    case 'setOAuthToken':
      oauthToken = parseToken(msg.token);
      broadcast(settingsMessage());
      break;
    case 'input':
      session.write(msg.data);
      break;
    case 'resize':
      session.resize(msg);
      break;
  }
}

wss.on('connection', (ws) => {
  send(ws, { type: 'reset' });
  send(ws, { type: 'state', state: session.state });
  send(ws, settingsMessage());
  if (session.history) {
    send(ws, { type: 'output', data: session.history });
  }

  ws.on('message', (raw) => {
    try {
      handle(JSON.parse(raw.toString()) as ClientMessage);
    } catch (err) {
      send(ws, { type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  });
});

server.listen(PORT, HOST, () => console.log(`session server on http://${HOST}:${PORT}`));
