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

export type ClientMessage =
  | ({ type: 'start'; command: string } & TermSize)
  | { type: 'input'; data: string }
  | ({ type: 'resize' } & TermSize)
  | { type: 'stop' };

export type ServerMessage =
  | { type: 'reset' } // clear the terminal; fresh output follows
  | { type: 'output'; data: string }
  | { type: 'state'; state: SessionState }
  | { type: 'error'; message: string };
