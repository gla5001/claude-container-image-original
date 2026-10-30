// Messages exchanged over the /ws WebSocket. Shared by server and client.

export type SessionStatus = 'idle' | 'running' | 'waiting' | 'exited';

export interface SessionState {
  status: SessionStatus;
  command?: string;
  cwd?: string;
  exitCode?: number;
}

export interface TermSize {
  cols: number;
  rows: number;
}

export interface Settings {
  oauthTokenSet: boolean; // a Claude OAuth token was set in the app; the token itself is never sent back
}

export type ClientMessage =
  | ({ type: 'start' } & TermSize) // sent by every page on load; starts claude only if it has never run
  | ({ type: 'restart' } & TermSize) // stop claude if running, start it again on its latest conversation
  | { type: 'input'; data: string }
  | ({ type: 'resize' } & TermSize)
  | { type: 'setOAuthToken'; token: string }; // empty clears it

export type ServerMessage =
  | { type: 'reset' } // clear the terminal; fresh output follows
  | { type: 'output'; data: string }
  | { type: 'state'; state: SessionState }
  | { type: 'settings'; settings: Settings }
  | { type: 'error'; message: string };
