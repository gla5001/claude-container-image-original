// Messages exchanged over the /ws WebSocket. Shared by server and client.

// starting: launched, and not yet quiet for the first time (its startup screen isn't work)
export type SessionStatus = 'idle' | 'starting' | 'running' | 'waiting' | 'exited';

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
  | { type: 'setOAuthToken'; token: string } // empty clears it
  | { type: 'subscribe'; subscription: PushSubscriptionJSON } // this browser's Web Push subscription
  | { type: 'focus'; focused: boolean }; // whether someone is looking at this page

export type ServerMessage =
  | { type: 'reset' } // clear the terminal; fresh output follows
  | { type: 'output'; data: string }
  | { type: 'state'; state: SessionState }
  | { type: 'settings'; settings: Settings }
  | { type: 'pushKey'; key: string } // the server's VAPID public key, for pushManager.subscribe
  | { type: 'error'; message: string };
