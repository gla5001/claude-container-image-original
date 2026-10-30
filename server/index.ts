import express from 'express';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import type { ClientMessage, ServerMessage } from '../shared/protocol';
import { Session } from './session';

const PORT = Number(process.env.PORT ?? 3001);
const HOST = '127.0.0.1'; // never expose beyond localhost: this is a remote shell
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
      session.start({ command: msg.command, cols: msg.cols, rows: msg.rows, cwd: CWD });
      broadcast({ type: 'reset' });
      break;
    case 'input':
      session.write(msg.data);
      break;
    case 'resize':
      session.resize(msg);
      break;
    case 'stop':
      session.stop();
      break;
  }
}

wss.on('connection', (ws) => {
  send(ws, { type: 'reset' });
  send(ws, { type: 'state', state: session.state });
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
