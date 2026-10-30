import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { ClientMessage, ServerMessage, SessionState, TermSize } from '../shared/protocol';
import type { TerminalHandle } from './Terminal';

/** Connects to the session server, pipes output into `terminal`, and reconnects on drop. */
export function useSession(terminal: RefObject<TerminalHandle | null>) {
  const socket = useRef<WebSocket>(null);
  const [connected, setConnected] = useState(false);
  const [state, setState] = useState<SessionState>({ status: 'idle' });
  const [error, setError] = useState<string>();

  useEffect(() => {
    let disposed = false;
    let retry: number | undefined;

    const connect = () => {
      const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
      socket.current = ws;
      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        if (!disposed) {
          retry = window.setTimeout(connect, 1000);
        }
      };

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data) as ServerMessage;
        switch (msg.type) {
          case 'reset':
            terminal.current?.reset();
            setError(undefined);
            break;
          case 'output':
            terminal.current?.write(msg.data);
            break;
          case 'state':
            setState(msg.state);
            break;
          case 'error':
            setError(msg.message);
            break;
        }
      };
    };

    connect();
    return () => {
      disposed = true;
      clearTimeout(retry);
      socket.current?.close();
    };
  }, [terminal]);

  // Stable identities so the terminal can subscribe once.
  const actions = useMemo(() => {
    const send = (msg: ClientMessage) => {
      if (socket.current?.readyState === WebSocket.OPEN) {
        socket.current.send(JSON.stringify(msg));
      }
    };

    return {
      start: (command: string) => {
        setError(undefined);
        send({ type: 'start', command, ...terminal.current!.size() });
      },
      stop: () => send({ type: 'stop' }),
      input: (data: string) => send({ type: 'input', data }),
      resize: (size: TermSize) => send({ type: 'resize', ...size }),
    };
  }, [terminal]);

  return { connected, state, error, ...actions };
}
